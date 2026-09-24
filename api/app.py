from __future__ import annotations

from pathlib import Path
import os
from typing import Any

import joblib
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
MODEL_DIR = ROOT_DIR / "ml"

ACCIDENTS_PATH = DATA_DIR / "processed_accidents.csv"
HOTSPOTS_PATH = DATA_DIR / "hotspots.csv"
RECOMMENDATIONS_PATH = DATA_DIR / "recommendations.csv"
SEVERITY_MODEL_PATH = MODEL_DIR / "severity_model.pkl"
RISK_MODEL_PATH = MODEL_DIR / "risk_model.pkl"

app = Flask(__name__)

configured_origins = os.getenv("FRONTEND_ORIGIN", "").strip()
configured_origin_list = [
    origin.strip()
    for origin in configured_origins.split(",")
    if origin.strip()
]
cors_origins = [
    "https://rishabamurthi1887.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
] + [origin for origin in configured_origin_list if origin not in {
    "https://rishabamurthi1887.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
}]
CORS(
    app,
    resources={r"/api/*": {"origins": cors_origins}},
    methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"]
)

_model_cache: dict[str, Any] = {}


def error_response(message: str, status_code: int):
    return jsonify({"error": message}), status_code


def read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Required data file not found: {path.name}")
    return pd.read_csv(path)


def records_response(path: Path):
    data = read_csv(path)
    return jsonify(data.where(pd.notna(data), None).to_dict(orient="records"))


def load_model(name: str, path: Path):
    if name not in _model_cache:
        if not path.exists():
            raise FileNotFoundError(f"Model file not found: {path.name}")
        _model_cache[name] = joblib.load(path)
    return _model_cache[name]


def model_feature_columns(model: Any) -> list[str]:
    saved_columns = getattr(model, "feature_columns_", None)
    if saved_columns:
        return list(saved_columns)

    preprocessor = model.named_steps.get("preprocessor")
    if preprocessor is None:
        raise ValueError("Saved model does not contain a preprocessing step.")

    columns: list[str] = []
    for _, _, transformer_columns in preprocessor.transformers:
        if transformer_columns == "drop" or transformer_columns == "passthrough":
            continue
        columns.extend(list(transformer_columns))
    if not columns:
        raise ValueError("Could not determine the saved model input columns.")
    return columns


def parse_prediction_payload(model: Any) -> pd.DataFrame:
    if not request.is_json:
        raise ValueError("Request body must be JSON.")
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ValueError("Request body must contain a JSON object.")

    required_columns = model_feature_columns(model)
    missing = [column for column in required_columns if column not in payload]
    if missing:
        raise ValueError(f"Missing required prediction fields: {missing}")

    return pd.DataFrame([{column: payload[column] for column in required_columns}])


def prediction_response(model: Any):
    sample = parse_prediction_payload(model)
    prediction = model.predict(sample)[0]
    response: dict[str, Any] = {"prediction": str(prediction)}
    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba(sample)[0]
        classes = model.named_steps["model"].classes_
        response["probabilities"] = {
            str(label): round(float(probability), 6)
            for label, probability in zip(classes, probabilities)
        }
    return jsonify(response)


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "message": "RoadSafe Analytics API is running"})


@app.get("/api/hotspots")
def hotspots():
    try:
        return records_response(HOTSPOTS_PATH)
    except FileNotFoundError as error:
        return error_response(str(error), 404)
    except Exception:
        app.logger.exception("Failed to read hotspot data")
        return error_response("Could not load hotspot data.", 500)


@app.get("/api/recommendations")
def recommendations():
    try:
        return records_response(RECOMMENDATIONS_PATH)
    except FileNotFoundError as error:
        return error_response(str(error), 404)
    except Exception:
        app.logger.exception("Failed to read recommendation data")
        return error_response("Could not load recommendation data.", 500)


@app.get("/api/summary")
def summary():
    try:
        accidents = read_csv(ACCIDENTS_PATH)
        hotspots_data = read_csv(HOTSPOTS_PATH)
        recommendations_data = read_csv(RECOMMENDATIONS_PATH)
        required = {"accident_severity", "casualties", "Risk Category"}
        missing = sorted(required - set(accidents.columns))
        if missing:
            return error_response(f"Accident data is missing columns: {missing}", 500)

        severity = accidents["accident_severity"].astype(str).str.strip().str.lower()
        risk = accidents["Risk Category"].astype(str).str.strip().str.lower()
        casualties = pd.to_numeric(accidents["casualties"], errors="coerce").fillna(0)
        return jsonify(
            {
                "total_accidents": int(len(accidents)),
                "fatal_accidents": int((severity == "fatal").sum()),
                "total_casualties": float(casualties.sum()),
                "high_risk_accidents": int((risk == "high").sum()),
                "critical_risk_accidents": int((risk == "critical").sum()),
                "number_of_hotspots": int(len(hotspots_data)),
                "number_of_recommendations": int(len(recommendations_data)),
            }
        )
    except FileNotFoundError as error:
        return error_response(str(error), 404)
    except Exception:
        app.logger.exception("Failed to calculate summary")
        return error_response("Could not calculate dashboard summary.", 500)


@app.post("/api/predict/severity")
def predict_severity():
    try:
        model = load_model("severity", SEVERITY_MODEL_PATH)
        return prediction_response(model)
    except ValueError as error:
        return error_response(str(error), 400)
    except FileNotFoundError as error:
        return error_response(str(error), 404)
    except Exception:
        app.logger.exception("Severity prediction failed")
        return error_response("Severity prediction failed. Check the supplied feature values.", 500)


@app.post("/api/predict/risk")
def predict_risk():
    try:
        model = load_model("risk", RISK_MODEL_PATH)
        return prediction_response(model)
    except ValueError as error:
        return error_response(str(error), 400)
    except FileNotFoundError as error:
        return error_response(str(error), 404)
    except Exception:
        app.logger.exception("Risk prediction failed")
        return error_response("Risk prediction failed. Check the supplied feature values.", 500)


@app.errorhandler(400)
def bad_request(_error):
    return error_response("Invalid request.", 400)


@app.errorhandler(404)
def not_found(_error):
    return error_response("API endpoint not found.", 404)


@app.errorhandler(405)
def method_not_allowed(_error):
    return error_response("HTTP method is not allowed for this endpoint.", 405)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
