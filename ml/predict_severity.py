from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import pandas as pd


BASE_DIR = Path(__file__).resolve().parents[1]
MODEL_PATH = BASE_DIR / "ml" / "severity_model.pkl"


def build_payload(args) -> pd.DataFrame:
    payload = {
        "city": args.city,
        "state": args.state,
        "hour": args.hour,
        "day_of_week": args.day_of_week,
        "is_weekend": args.is_weekend,
        "road_type": args.road_type,
        "lanes": args.lanes,
        "traffic_signal": args.traffic_signal,
        "weather": args.weather,
        "visibility": args.visibility,
        "temperature": args.temperature,
        "traffic_density": args.traffic_density,
        "cause": args.cause,
        "vehicles_involved": args.vehicles_involved,
        "is_peak_hour": args.is_peak_hour,
        "festival": args.festival,
    }
    return pd.DataFrame([payload])


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict accident severity from accident features.")
    parser.add_argument("--city", default="Chennai")
    parser.add_argument("--state", default="Tamil Nadu")
    parser.add_argument("--hour", type=int, default=18)
    parser.add_argument("--day_of_week", default="Friday")
    parser.add_argument("--is_weekend", type=int, default=0)
    parser.add_argument("--road_type", default="Urban")
    parser.add_argument("--lanes", type=int, default=4)
    parser.add_argument("--traffic_signal", type=int, default=1)
    parser.add_argument("--weather", default="Clear")
    parser.add_argument("--visibility", default="High")
    parser.add_argument("--temperature", type=int, default=30)
    parser.add_argument("--traffic_density", default="High")
    parser.add_argument("--cause", default="Overspeeding")
    parser.add_argument("--vehicles_involved", type=int, default=2)
    parser.add_argument("--is_peak_hour", type=int, default=1)
    parser.add_argument("--festival", default="None")
    args = parser.parse_args()

    if not MODEL_PATH.exists():
        print(f"ERROR: Model file not found: {MODEL_PATH}")
        print("Please run: python ml/train_severity_model.py")
        raise SystemExit(1)

    pipeline = joblib.load(MODEL_PATH)
    sample = build_payload(args)
    prediction = pipeline.predict(sample)[0]
    probabilities = pipeline.predict_proba(sample)[0]
    class_labels = pipeline.named_steps["model"].classes_

    print("Predicted Severity:", prediction)
    print("Prediction Probability:", max(probabilities))
    print("Probability by class:")
    for label, prob in zip(class_labels, probabilities):
        print(f"  {label}: {prob:.4f}")


if __name__ == "__main__":
    main()
