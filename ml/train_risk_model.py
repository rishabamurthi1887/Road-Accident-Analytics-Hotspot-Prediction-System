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
MODEL_PATH = BASE_DIR / "ml" / "risk_model.pkl"
ASSET_DIR = BASE_DIR / "assets"
CONFUSION_PATH = ASSET_DIR / "risk_confusion_matrix.png"
METRICS_PATH = ASSET_DIR / "risk_model_metrics.txt"


def find_risk_target(df: pd.DataFrame) -> str:
    preferred_targets = ["Risk Category", "risk_category"]
    for column in preferred_targets:
        if column in df.columns:
            return column

    for column in ["Risk Index", "risk_index", "risk_score"]:
        if column in df.columns:
            return column

    available = ", ".join(df.columns.tolist()) if not df.empty else "No columns found"
    raise ValueError(
        "No supported risk target was found. Expected one of Risk Category, "
        f"risk_category, Risk Index, risk_index, risk_score. Available columns: {available}"
    )


def main() -> None:
    print("Loading processed dataset...")
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Processed dataset not found: {DATA_PATH}")

    df = pd.read_csv(DATA_PATH)
    print(f"Dataset shape: {df.shape}")
    print(f"Columns: {list(df.columns)}")
    print(f"Missing values: {df.isna().sum().to_dict()}")
    print(f"Duplicate rows: {int(df.duplicated().sum())}")

    target_column = find_risk_target(df)
    if target_column not in ["Risk Category", "risk_category"]:
        raise ValueError(
            f"The dataset does not contain a categorical Risk Category target. Found: {target_column}"
        )

    y = df[target_column].astype(str).str.strip()
    if y.isna().any() or (y.str.lower() == "nan").any():
        raise ValueError(f"Target column '{target_column}' contains missing values.")

    print(f"Risk target detected: {target_column}")
    print(f"Unique risk classes: {sorted(y.unique().tolist())}")
    print(f"Class distribution:\n{y.value_counts().to_string()}")

    feature_candidates = [
        "city",
        "state",
        "latitude",
        "longitude",
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
        "Year",
        "Month Number",
        "Month Name",
        "month",
        "year",
    ]
    excluded_columns = [
        "accident_id",
        "Risk Category",
        "risk_category",
        "Risk Index",
        "risk_index",
        "risk_score",
        "accident_severity",
        "casualties",
        "date",
        "time",
    ]

    available_features = [
        column for column in feature_candidates
        if column in df.columns and column not in excluded_columns and df[column].notna().any()
    ]
    excluded_all_missing = [
        column for column in feature_candidates
        if column in df.columns and not df[column].notna().any()
    ]
    if not available_features:
        raise ValueError("No usable independent feature columns were found.")

    print(f"Features used: {available_features}")
    print(f"Features excluded: {excluded_columns}")
    if excluded_all_missing:
        print(f"Features skipped because all values are missing: {excluded_all_missing}")

    X = df[available_features].copy()
    categorical_features = X.select_dtypes(include=["object", "string"]).columns.tolist()
    numerical_features = [column for column in X.columns if column not in categorical_features]

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

    pipeline = Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            (
                "model",
                RandomForestClassifier(
                    n_estimators=200,
                    random_state=42,
                    class_weight="balanced",
                ),
            ),
        ]
    )

    stratify = y if y.value_counts().min() >= 2 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.20,
        random_state=42,
        stratify=stratify,
    )

    print(f"Training samples: {len(X_train)}")
    print(f"Testing samples: {len(X_test)}")
    print("Training Random Forest...")
    pipeline.fit(X_train, y_train)

    predictions = pipeline.predict(X_test)
    labels = sorted(y.unique().tolist())
    accuracy = accuracy_score(y_test, predictions)
    weighted_precision = precision_score(y_test, predictions, average="weighted", zero_division=0)
    weighted_recall = recall_score(y_test, predictions, average="weighted", zero_division=0)
    weighted_f1 = f1_score(y_test, predictions, average="weighted", zero_division=0)
    macro_precision = precision_score(y_test, predictions, average="macro", zero_division=0)
    macro_recall = recall_score(y_test, predictions, average="macro", zero_division=0)
    macro_f1 = f1_score(y_test, predictions, average="macro", zero_division=0)
    report = classification_report(y_test, predictions, labels=labels, digits=4, zero_division=0)

    print("\nRisk Model Evaluation")
    print("---------------------")
    print(f"Accuracy: {accuracy:.4%}")
    print(f"Macro F1: {macro_f1:.4%}")
    print(f"Weighted F1: {weighted_f1:.4%}")
    print("\nClassification Report:")
    print(report)

    cm = confusion_matrix(y_test, predictions, labels=labels)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(8, 6))
    image = ax.imshow(cm, interpolation="nearest", cmap="Blues")
    ax.figure.colorbar(image, ax=ax)
    ax.set(
        xticks=range(len(labels)),
        yticks=range(len(labels)),
        xticklabels=labels,
        yticklabels=labels,
        ylabel="Actual risk category",
        xlabel="Predicted risk category",
        title="Accident Risk Prediction - Confusion Matrix",
    )
    threshold = cm.max() / 2 if cm.size else 0
    for row in range(cm.shape[0]):
        for column in range(cm.shape[1]):
            ax.text(
                column,
                row,
                int(cm[row, column]),
                ha="center",
                va="center",
                color="white" if cm[row, column] > threshold else "black",
            )
    fig.tight_layout()
    fig.savefig(CONFUSION_PATH, dpi=200)
    plt.close(fig)

    pipeline.feature_columns_ = available_features
    pipeline.target_column_ = target_column
    pipeline.risk_classes_ = labels
    joblib.dump(pipeline, MODEL_PATH)

    metrics_text = f"""Model: Random Forest\nDataset: processed_accidents.csv\nTarget: {target_column}\n\nNumber of training samples: {len(X_train)}\nNumber of testing samples: {len(X_test)}\n\nFeatures:\n{json.dumps(available_features, indent=2)}\n\nExcluded features and leakage controls:\n{json.dumps(excluded_columns + excluded_all_missing, indent=2)}\nRisk Index and risk_score are excluded because they encode the categorical risk target. accident_severity and casualties are outcome-related fields and are excluded to avoid target leakage.\n\nAccuracy: {accuracy:.4f}\nPrecision (weighted): {weighted_precision:.4f}\nRecall (weighted): {weighted_recall:.4f}\nMacro F1: {macro_f1:.4f}\nWeighted F1: {weighted_f1:.4f}\n\nClass distribution:\n{y.value_counts().to_string()}\n\nClassification Report:\n{report}\n"""
    METRICS_PATH.write_text(metrics_text, encoding="utf-8")

    print(f"Confusion matrix saved: {CONFUSION_PATH}")
    print(f"Model saved: {MODEL_PATH}")
    print(f"Metrics saved: {METRICS_PATH}")


if __name__ == "__main__":
    main()
