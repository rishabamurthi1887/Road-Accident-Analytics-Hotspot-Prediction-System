from __future__ import annotations

from pathlib import Path

import joblib
import pandas as pd


BASE_DIR = Path(__file__).resolve().parents[1]
MODEL_PATH = BASE_DIR / "ml" / "risk_model.pkl"

DEFAULT_INPUT = {
    "city": "Chennai",
    "state": "Tamil Nadu",
    "latitude": 13.08,
    "longitude": 80.27,
    "hour": 18,
    "day_of_week": "Friday",
    "is_weekend": 0,
    "road_type": "urban",
    "lanes": 4,
    "traffic_signal": 1,
    "weather": "clear",
    "temperature": 30,
    "traffic_density": "high",
    "cause": "overspeeding",
    "vehicles_involved": 2,
    "is_peak_hour": 1,
    "festival": "None",
    "Year": 2024,
    "Month Number": 6,
    "Month Name": "June",
    "month": 6,
    "year": 2024,
}


def main() -> None:
    if not MODEL_PATH.exists():
        print(f"ERROR: Model file not found: {MODEL_PATH}")
        print("Run this command first: python ml/train_risk_model.py")
        raise SystemExit(1)

    pipeline = joblib.load(MODEL_PATH)
    feature_columns = getattr(pipeline, "feature_columns_", list(DEFAULT_INPUT))
    sample = pd.DataFrame([{column: DEFAULT_INPUT.get(column, None) for column in feature_columns}])

    prediction = pipeline.predict(sample)[0]
    print(f"Predicted Risk Category: {prediction}")

    if hasattr(pipeline, "predict_proba"):
        probabilities = pipeline.predict_proba(sample)[0]
        class_labels = pipeline.named_steps["model"].classes_
        print("Risk Probabilities:")
        for label, probability in zip(class_labels, probabilities):
            print(f"{label}: {probability:.2%}")


if __name__ == "__main__":
    main()
