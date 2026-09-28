from __future__ import annotations

import json
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

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

cors_origins = [
    "https://rishabamurthi1887.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
]
CORS(
    app,
    resources={r"/api/*": {"origins": cors_origins}},
    methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"]
)

_model_cache: dict[str, Any] = {}


def error_response(message: str, status_code: int):
    return jsonify({"error": message}), status_code


def safe_fetch_json(url: str, params: dict[str, Any] | None = None, timeout: int = 15) -> Any:
    final_url = url
    if params:
        final_url = f"{url}?{urlencode(params)}"
    request = Request(
        final_url,
        headers={
            "User-Agent": "RoadSafe-Analytics/1.0 (+https://github.com/rishabamurthi1887/Road-Accident-Analytics-Hotspot-Prediction-System)",
            "Accept": "application/json",
        },
    )
    with urlopen(request, timeout=timeout) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    lat_1, lon_1, lat_2, lon_2 = map(math.radians, (lat1, lon1, lat2, lon2))
    delta_lat = lat_2 - lat_1
    delta_lon = lon_2 - lon_1
    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat_1) * math.cos(lat_2) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * radius_km * math.asin(math.sqrt(a))


def parse_address_fields(address: dict[str, Any] | None) -> dict[str, str | None]:
    if not isinstance(address, dict):
        return {}
    city = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("municipality")
        or address.get("hamlet")
        or address.get("county")
    )
    state = (
        address.get("state")
        or address.get("province")
        or address.get("region")
        or address.get("county")
        or address.get("state_district")
    )
    country = address.get("country")
    district = address.get("district") or address.get("suburb") or address.get("city_district")
    road = address.get("road") or address.get("path") or address.get("neighbourhood")
    return {
        "country": country,
        "state": state,
        "city": city,
        "district": district,
        "road": road,
    }


def geocode_location(query: str) -> list[dict[str, Any]]:
    if not isinstance(query, str) or not query.strip():
        return []
    payload = safe_fetch_json(
        "https://nominatim.openstreetmap.org/search",
        {
            "format": "jsonv2",
            "limit": 5,
            "q": query.strip(),
        },
        timeout=20,
    )
    if not isinstance(payload, list):
        return []

    results: list[dict[str, Any]] = []
    for item in payload:
        try:
            lat = float(item.get("lat"))
            lon = float(item.get("lon"))
        except (TypeError, ValueError):
            continue
        address = parse_address_fields(item.get("address"))
        display_name = item.get("display_name") or ""
        display_parts = [part.strip() for part in display_name.split(",") if part and part.strip()]
        if not address.get("country") and len(display_parts) >= 1:
            address["country"] = display_parts[-1]
        if not address.get("state") and len(display_parts) >= 2:
            address["state"] = display_parts[-2]
        if not address.get("city") and len(display_parts) >= 3:
            address["city"] = display_parts[-3]
        results.append(
            {
                "display_name": display_name,
                "lat": lat,
                "lon": lon,
                "country": address.get("country"),
                "state": address.get("state"),
                "city": address.get("city"),
                "district": address.get("district"),
                "road": address.get("road"),
                "type": item.get("type"),
                "importance": item.get("importance"),
            }
        )
    return results


def reverse_geocode(lat: float, lon: float) -> dict[str, Any]:
    payload = safe_fetch_json(
        "https://nominatim.openstreetmap.org/reverse",
        {
            "format": "jsonv2",
            "lat": lat,
            "lon": lon,
            "zoom": 18,
            "addressdetails": 1,
        },
        timeout=20,
    )
    if not isinstance(payload, dict):
        return {"lat": lat, "lon": lon, "display_name": "Unknown location"}
    address = parse_address_fields(payload.get("address"))
    return {
        "display_name": payload.get("display_name") or "Unknown location",
        "lat": lat,
        "lon": lon,
        "country": address.get("country"),
        "state": address.get("state"),
        "city": address.get("city"),
        "district": address.get("district"),
        "road": address.get("road"),
        "type": payload.get("type"),
    }


def local_time_for_coordinates(lat: float, lon: float) -> dict[str, Any]:
    timezone_name = "UTC"
    tz = timezone.utc
    current_time = datetime.now(timezone.utc)
    try:
        payload = safe_fetch_json(
            "https://api.open-meteo.com/v1/forecast",
            {
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
                "timezone": "auto",
                "forecast_days": 1,
            },
            timeout=20,
        )
        if isinstance(payload, dict):
            candidate_timezone = payload.get("timezone")
            if isinstance(candidate_timezone, str) and candidate_timezone:
                timezone_name = candidate_timezone
                try:
                    tz = ZoneInfo(candidate_timezone)
                except Exception:
                    tz = timezone.utc
            current = payload.get("current") or {}
            raw_time = current.get("time")
            if isinstance(raw_time, str):
                try:
                    parsed_time = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
                    if parsed_time.tzinfo is None:
                        parsed_time = parsed_time.replace(tzinfo=timezone.utc)
                    current_time = parsed_time.astimezone(timezone.utc)
                except ValueError:
                    current_time = datetime.now(timezone.utc)
    except Exception:
        timezone_name = "UTC"
        tz = timezone.utc

    if timezone_name and timezone_name != "UTC":
        try:
            tz = ZoneInfo(timezone_name)
        except Exception:
            tz = timezone.utc

    local_dt = current_time.astimezone(tz)
    offset_seconds = int(local_dt.utcoffset().total_seconds()) if local_dt.utcoffset() else 0
    return {
        "timezone": timezone_name,
        "utc_offset_seconds": offset_seconds,
        "local_datetime": local_dt.isoformat(),
        "date": local_dt.strftime("%Y-%m-%d"),
        "time": local_dt.strftime("%H:%M:%S"),
        "day": local_dt.strftime("%A"),
        "hour": int(local_dt.strftime("%H")),
        "last_updated": local_dt.strftime("%Y-%m-%d %H:%M:%S %Z"),
    }


def historical_accident_context(lat: float, lon: float, radius_km: float = 5.0) -> dict[str, Any]:
    accidents_path = ACCIDENTS_PATH
    try:
        accidents = read_csv(accidents_path)
    except Exception:
        return {
            "status": "unavailable",
            "message": "Historical dataset is not available for this location.",
            "accident_count": 0,
        }

    required_cols = {"latitude", "longitude", "accident_severity", "cause", "road_type", "hour", "Risk Category"}
    missing = sorted(required_cols - set(accidents.columns))
    if missing:
        return {
            "status": "unavailable",
            "message": f"Historical dataset is missing required fields: {missing}",
            "accident_count": 0,
        }

    filtered = accidents.copy()
    filtered["latitude"] = pd.to_numeric(filtered["latitude"], errors="coerce")
    filtered["longitude"] = pd.to_numeric(filtered["longitude"], errors="coerce")
    filtered = filtered.dropna(subset=["latitude", "longitude"]).copy()
    filtered["distance_km"] = filtered.apply(
        lambda row: haversine_km(float(row["latitude"]), float(row["longitude"]), lat, lon),
        axis=1,
    )
    filtered = filtered[filtered["distance_km"] <= radius_km].copy()

    if filtered.empty:
        return {
            "status": "no_data",
            "message": "No historical accident records are available within the selected radius.",
            "radius_km": radius_km,
            "accident_count": 0,
        }

    cause_counts = filtered["cause"].fillna("Unknown").astype(str).str.strip()
    cause_counts = cause_counts[cause_counts != ""]
    dominant_cause = cause_counts.mode().iloc[0] if not cause_counts.empty else "Unknown"

    risk_counts = filtered["Risk Category"].fillna("Unknown").astype(str).str.strip().str.lower()
    risk_counts = risk_counts[risk_counts != ""]
    dominant_risk = risk_counts.mode().iloc[0] if not risk_counts.empty else "unknown"

    road_counts = filtered["road_type"].fillna("Unknown").astype(str).str.strip()
    road_counts = road_counts[road_counts != ""]
    dominant_road = road_counts.mode().iloc[0] if not road_counts.empty else "Unknown"

    hour_values = pd.to_numeric(filtered["hour"], errors="coerce").dropna()
    peak_hour = int(hour_values.mode().iloc[0]) if not hour_values.empty else None

    severity_counts = filtered["accident_severity"].fillna("Unknown").astype(str).str.strip().str.lower()
    return {
        "status": "ok",
        "radius_km": radius_km,
        "accident_count": int(len(filtered)),
        "fatal_count": int((severity_counts == "fatal").sum()),
        "major_count": int((severity_counts == "major").sum()),
        "minor_count": int((severity_counts == "minor").sum()),
        "dominant_cause": dominant_cause,
        "dominant_risk": dominant_risk.title(),
        "dominant_road_type": dominant_road,
        "peak_hour": peak_hour,
        "max_distance_km": round(float(filtered["distance_km"].max()), 2),
        "sample_records": filtered.head(10).to_dict(orient="records"),
    }


def live_intelligence_context(lat: float, lon: float, radius_km: float = 5.0) -> dict[str, Any]:
    try:
        weather_payload = safe_fetch_json(
            "https://api.open-meteo.com/v1/forecast",
            {
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature",
                "timezone": "auto",
            },
            timeout=20,
        )
        current = weather_payload.get("current", {}) if isinstance(weather_payload, dict) else {}
        return {
            "status": "provider_unavailable",
            "provider": "open-meteo",
            "message": "No real-time traffic or incident provider is configured for this location. Live map feeds are unavailable.",
            "weather_summary": {
                "temperature_c": current.get("temperature_2m"),
                "apparent_temperature_c": current.get("apparent_temperature"),
                "wind_speed_kmh": current.get("wind_speed_10m"),
                "humidity_percent": current.get("relative_humidity_2m"),
                "weather_code": current.get("weather_code"),
            },
            "radius_km": radius_km,
        }
    except Exception:
        return {
            "status": "provider_unavailable",
            "provider": "none",
            "message": "Live traffic or incident data is unavailable for this coordinate.",
            "radius_km": radius_km,
        }


def build_location_profile(lat: float, lon: float, query: str | None = None, radius_km: float = 5.0) -> dict[str, Any]:
    resolved_location = reverse_geocode(lat, lon)
    if query and isinstance(query, str) and query.strip():
        candidate_results = geocode_location(query)
        if candidate_results:
            best = candidate_results[0]
            resolved_location = {
                "display_name": best.get("display_name") or resolved_location.get("display_name"),
                "lat": float(best.get("lat", lat)),
                "lon": float(best.get("lon", lon)),
                "country": best.get("country") or resolved_location.get("country"),
                "state": best.get("state") or resolved_location.get("state"),
                "city": best.get("city") or resolved_location.get("city"),
                "district": best.get("district") or resolved_location.get("district"),
                "road": best.get("road") or resolved_location.get("road"),
            }

    local_time = local_time_for_coordinates(lat, lon)
    historical = historical_accident_context(lat, lon, radius_km=radius_km)
    live = live_intelligence_context(lat, lon, radius_km=radius_km)

    return {
        "status": "ok",
        "query": query,
        "resolved_location": resolved_location,
        "local_time": local_time,
        "historical": historical,
        "live": live,
        "recommended_radius_km": radius_km,
    }


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


@app.get("/api/location/search")
def location_search():
    query = request.args.get("query") or request.args.get("q") or request.get_json(silent=True, force=False)
    if isinstance(query, dict):
        query = query.get("query") or query.get("q")
    if not isinstance(query, str) or not query.strip():
        return error_response("A location search query is required.", 400)
    try:
        results = geocode_location(query)
        return jsonify({"query": query, "results": results})
    except Exception:
        app.logger.exception("Location search failed")
        return error_response("Location search failed. Try a different place name.", 500)


@app.get("/api/location/reverse")
def location_reverse():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return error_response("Latitude and longitude query parameters are required.", 400)
    try:
        return jsonify(reverse_geocode(lat, lon))
    except Exception:
        app.logger.exception("Reverse geocoding failed")
        return error_response("Location lookup failed.", 500)


@app.get("/api/location/historical")
def location_historical():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return error_response("Latitude and longitude query parameters are required.", 400)
    radius_km = float(request.args.get("radius_km", "5"))
    try:
        return jsonify(historical_accident_context(lat, lon, radius_km=radius_km))
    except Exception:
        app.logger.exception("Historical location analysis failed")
        return error_response("Historical location analysis failed.", 500)


@app.get("/api/location/live")
def location_live():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return error_response("Latitude and longitude query parameters are required.", 400)
    radius_km = float(request.args.get("radius_km", "5"))
    try:
        return jsonify(live_intelligence_context(lat, lon, radius_km=radius_km))
    except Exception:
        app.logger.exception("Live location analysis failed")
        return error_response("Live location analysis failed.", 500)


@app.get("/api/location/intelligence")
@app.post("/api/location/intelligence")
def location_intelligence():
    payload = request.get_json(silent=True) if request.is_json else {}
    query = request.args.get("query") or request.args.get("q")
    if isinstance(payload, dict):
        query = payload.get("query") or payload.get("q") or query
    radius_km = float(request.args.get("radius_km", payload.get("radius_km", 5.0) if isinstance(payload, dict) else 5.0))
    try:
        lat = float(request.args.get("lat", payload.get("lat") if isinstance(payload, dict) else None))
        lon = float(request.args.get("lon", payload.get("lon") if isinstance(payload, dict) else None))
    except (TypeError, ValueError):
        lat = None
        lon = None

    if lat is None or lon is None:
        if not isinstance(query, str) or not query.strip():
            return error_response("Either a query or latitude/longitude values are required.", 400)
        results = geocode_location(query)
        if not results:
            return error_response("No matching location was found for the supplied search query.", 404)
        lat = float(results[0]["lat"])
        lon = float(results[0]["lon"])

    try:
        profile = build_location_profile(lat, lon, query=query, radius_km=radius_km)
        return jsonify(profile)
    except Exception:
        app.logger.exception("Location intelligence failed")
        return error_response("Location intelligence could not be generated.", 500)


@app.get("/api/health")
def health():
    artifacts = {
        "dataset": ACCIDENTS_PATH.exists(),
        "risk_model": RISK_MODEL_PATH.exists(),
        "severity_model": SEVERITY_MODEL_PATH.exists(),
    }
    ready = all(artifacts.values())
    return jsonify(
        {
            "status": "ok" if ready else "degraded",
            "message": "RoadSafe Analytics API is running" if ready else "API is running with unavailable artifacts",
            "artifacts": artifacts,
        }
    )


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
