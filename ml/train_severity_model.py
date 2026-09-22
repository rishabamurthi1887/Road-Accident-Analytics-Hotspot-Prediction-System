from __future__ import annotations

import json
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


BASE_DIR = Path(__file__).resolve().parents[1]
DATA_PATH = BASE_DIR / "data" / "processed_accidents.csv"
MODEL_PATH = BASE_DIR / "ml" / "severity_model.pkl"
ASSET_DIR = BASE_DIR / "assets"
CONFUSION_PATH = ASSET_DIR / "severity_confusion_matrix.png"
METRICS_PATH = ASSET_DIR / "severity_model_metrics.txt"


def print_error(message: str) -> None:
    print(f"\nERROR: {message}")


def detect_target_column(df: pd.DataFrame) -> str:
    for column in df.columns:
        if "severity" in str(column).lower():
            return column
    available = ", ".join(df.columns.tolist()) if not df.empty else "No columns found"
    raise ValueError(f"Required severity column was not found. Available columns: {available}")


def main() -> None:
    print("Loading processed dataset...")

    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Processed dataset not found: {DATA_PATH}")

    df = pd.read_csv(DATA_PATH)
    print(f"Dataset shape: {df.shape}")
    print(f"Columns: {list(df.columns)}")
    print(f"Missing values:\n{df.isna().sum().to_dict()}")

    target_column = detect_target_column(df)
    print(f"Severity target column: {target_column}")

    if target_column not in df.columns:
        raise KeyError(f"Required column '{target_column}' was not found in the dataset.")

    classes = sorted(df[target_column].dropna().astype(str).str.strip().str.lower().unique().tolist())
    print(f"Severity classes: {classes}")
    print(f"Class distribution:\n{df[target_column].astype(str).str.strip().str.lower().value_counts().to_string()}")

    excluded_columns = [
        "accident_id",
        "date",
        "time",
        "casualties",
        "risk_score",
        "Risk Index",
        "Risk Category",
        "Month Number",
        "Month Name",
        "Year",
    ]

    feature_candidates = [
        "city",
        "state",
        "hour",
        "day_of_week",
        "is_weekend",
        "road_type",
        "lanes",
        "traffic_signal",
        "weather",
        "visibility",
        "temperature",
        "traffic_density",
        "cause",
        "vehicles_involved",
        "is_peak_hour",
        "festival",
        "month",
        "year",
    ]

    available_features = [col for col in feature_candidates if col in df.columns and col not in excluded_columns]
    missing_features = [col for col in ["city", "state", "hour", "day_of_week", "road_type", "weather", "traffic_density", "cause", "vehicles_involved", "festival"] if col not in df.columns]
    if missing_features:
        print_error(f"Required feature columns are missing: {missing_features}")
        print(f"Available columns: {list(df.columns)}")
        raise SystemExit(1)

    X = df[available_features].copy()
    y = df[target_column].astype(str).str.strip().str.lower()

    categorical_features = X.select_dtypes(include=["object", "string"]).columns.tolist()
    numerical_features = [col for col in X.columns if col not in categorical_features]

    if not categorical_features and not numerical_features:
        raise ValueError("No usable feature columns were found in the processed dataset.")

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(steps=[("imputer", SimpleImputer(strategy="median"))]),
                numerical_features,
            ),
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical_features,
            ),
        ],
        remainder="drop",
    )

    model = RandomForestClassifier(
        n_estimators=200,
        random_state=42,
        class_weight="balanced",
    )

    pipeline = Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("model", model),
        ]
    )

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.20,
        random_state=42,
        stratify=y,
    )

    print(f"Training samples: {len(X_train)}")
    print(f"Testing samples: {len(X_test)}")
    print("Training Random Forest...")

    pipeline.fit(X_train, y_train)

    predictions = pipeline.predict(X_test)

    accuracy = accuracy_score(y_test, predictions)
    weighted_precision = precision_score(y_test, predictions, average="weighted", zero_division=0)
    weighted_recall = recall_score(y_test, predictions, average="weighted", zero_division=0)
    weighted_f1 = f1_score(y_test, predictions, average="weighted", zero_division=0)
    macro_precision = precision_score(y_test, predictions, average="macro", zero_division=0)
    macro_recall = recall_score(y_test, predictions, average="macro", zero_division=0)
    macro_f1 = f1_score(y_test, predictions, average="macro", zero_division=0)

    print("\nMODEL EVALUATION")
    print(f"Accuracy: {accuracy:.4f}")
    print(f"Weighted Precision: {weighted_precision:.4f}")
    print(f"Weighted Recall: {weighted_recall:.4f}")
    print(f"Weighted F1: {weighted_f1:.4f}")
    print(f"Macro Precision: {macro_precision:.4f}")
    print(f"Macro Recall: {macro_recall:.4f}")
    print(f"Macro F1: {macro_f1:.4f}")
    print("\nClassification Report:\n")
    print(classification_report(y_test, predictions, digits=4))

    labels = sorted(y.unique().tolist())
    cm = confusion_matrix(y_test, predictions, labels=labels)

    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.imshow(cm, interpolation="nearest", cmap="Blues")
    ax.set_title("Accident Severity Prediction — Confusion Matrix")
    ax.set_xlabel("Predicted label")
    ax.set_ylabel("True label")
    ax.set_xticks(range(len(labels)))
    ax.set_yticks(range(len(labels)))
    ax.set_xticklabels(labels)
    ax.set_yticklabels(labels)
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, int(cm[i, j]), ha="center", va="center", color="black", fontsize=9)
    plt.tight_layout()
    fig.savefig(CONFUSION_PATH, dpi=200)
    plt.close(fig)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, MODEL_PATH)

    metrics_text = f"""Model: RandomForestClassifier
Training samples: {len(X_train)}
Testing samples: {len(X_test)}

Accuracy: {accuracy:.4f}
Weighted Precision: {weighted_precision:.4f}
Weighted Recall: {weighted_recall:.4f}
Weighted F1: {weighted_f1:.4f}
Macro Precision: {macro_precision:.4f}
Macro Recall: {macro_recall:.4f}
Macro F1: {macro_f1:.4f}

Class distribution:
{y.value_counts().to_string()}

Features used:
{json.dumps(available_features, indent=2)}

Features excluded:
{json.dumps(excluded_columns, indent=2)}

Reason for excluded features:
- risk_score, Risk Index, and Risk Category are target-related or derived risk indicators and can leak information about accident severity.
- accident_id is just an identifier and does not describe the accident context.
- date and time are not used as direct predictors in this model because the feature set is based on accident conditions rather than raw record metadata.
- casualties is also an outcome-like field and should not be used as an input when predicting severity.
"""
    METRICS_PATH.write_text(metrics_text, encoding="utf-8")

    print(f"\nModel saved: {MODEL_PATH}")
    print(f"Confusion matrix saved: {CONFUSION_PATH}")
    print(f"Metrics summary saved: {METRICS_PATH}")


if __name__ == "__main__":
    main()
