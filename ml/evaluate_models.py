from __future__ import annotations

import json
import re
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from PIL import Image
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split


BASE_DIR = Path(__file__).resolve().parents[1]
DATA_PATH = BASE_DIR / "data" / "processed_accidents.csv"
SEVERITY_MODEL_PATH = BASE_DIR / "ml" / "severity_model.pkl"
RISK_MODEL_PATH = BASE_DIR / "ml" / "risk_model.pkl"
SEVERITY_METRICS_PATH = BASE_DIR / "assets" / "severity_model_metrics.txt"
RISK_METRICS_PATH = BASE_DIR / "assets" / "risk_model_metrics.txt"
SEVERITY_CM_PATH = BASE_DIR / "assets" / "severity_confusion_matrix.png"
RISK_CM_PATH = BASE_DIR / "assets" / "risk_confusion_matrix.png"
COMPARISON_PATH = BASE_DIR / "assets" / "model_comparison.txt"
DISTRIBUTION_PATH = BASE_DIR / "assets" / "class_distribution_analysis.txt"
REPORT_PATH = BASE_DIR / "assets" / "ml_evaluation_report.txt"
CHART_PATH = BASE_DIR / "assets" / "model_metrics_comparison.png"


def require_file(path: Path) -> None:
    if not path.exists() or path.stat().st_size == 0:
        raise FileNotFoundError(f"Required file is missing or empty: {path}")


def parse_metrics(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")

    def metric(pattern: str) -> float | None:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
        return float(match.group(1)) if match else None

    report_match = re.search(
        r"Classification Report:\s*\n(?P<report>.*?)(?:\n\s*$|\Z)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    report = report_match.group("report").strip() if report_match else "Not recorded."

    model_match = re.search(r"^Model:\s*(.+)$", text, flags=re.IGNORECASE | re.MULTILINE)
    training_match = re.search(r"Training samples:\s*(\d+)", text, flags=re.IGNORECASE)
    testing_match = re.search(r"Testing samples:\s*(\d+)", text, flags=re.IGNORECASE)
    target_match = re.search(r"^Target:\s*(.+)$", text, flags=re.IGNORECASE | re.MULTILINE)

    return {
        "text": text,
        "model": model_match.group(1).strip() if model_match else "Not recorded",
        "training_samples": int(training_match.group(1)) if training_match else None,
        "testing_samples": int(testing_match.group(1)) if testing_match else None,
        "target": target_match.group(1).strip() if target_match else "Not recorded",
        "accuracy": metric(r"^Accuracy:\s*([0-9.]+)"),
        "precision": metric(r"^(?:Weighted )?Precision(?: \(weighted\))?:\s*([0-9.]+)"),
        "recall": metric(r"^(?:Weighted )?Recall(?: \(weighted\))?:\s*([0-9.]+)"),
        "macro_f1": metric(r"^Macro F1:\s*([0-9.]+)"),
        "weighted_f1": metric(r"^Weighted F1:\s*([0-9.]+)"),
        "report": report,
    }


def format_percent(value: float | None) -> str:
    return f"{value * 100:.2f}%" if value is not None else "Not recorded"


def derive_existing_model_report(
    model: object,
    metrics_text: str,
    df: pd.DataFrame,
    target_column: str,
) -> str:
    feature_match = re.search(
        r"Features used:\s*(\[.*?\])",
        metrics_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not feature_match:
        return "Not recorded and could not be derived from the saved metrics file."

    features = json.loads(feature_match.group(1))
    X = df[features].copy()
    y = df[target_column].astype(str).str.strip().str.lower()
    _, X_test, _, y_test = train_test_split(
        X,
        y,
        test_size=0.20,
        random_state=42,
        stratify=y,
    )
    predictions = model.predict(X_test)
    return classification_report(y_test, predictions, digits=4, zero_division=0)


def distribution_section(series: pd.Series, title: str) -> tuple[str, dict[str, object]]:
    counts = series.astype(str).value_counts()
    total = int(counts.sum())
    rows = [title, "-" * len(title), "Class                 Count       Percentage"]
    for label, count in counts.items():
        rows.append(f"{label:<22}{int(count):>5}       {count / total:.2%}")

    largest_label = str(counts.index[0])
    smallest_label = str(counts.index[-1])
    largest_count = int(counts.iloc[0])
    smallest_count = int(counts.iloc[-1])
    ratio = largest_count / smallest_count if smallest_count else float("inf")
    imbalance = "imbalanced" if ratio >= 2 else "not strongly imbalanced"
    rows.extend(
        [
            "",
            f"Largest class: {largest_label} ({largest_count}, {largest_count / total:.2%})",
            f"Smallest class: {smallest_label} ({smallest_count}, {smallest_count / total:.2%})",
            f"Largest/smallest class ratio: {ratio:.2f}:1",
            f"Assessment: The distribution is {imbalance} by the 2:1 ratio rule.",
        ]
    )
    return "\n".join(rows), {
        "counts": counts,
        "total": total,
        "largest_label": largest_label,
        "smallest_label": smallest_label,
        "largest_count": largest_count,
        "smallest_count": smallest_count,
        "ratio": ratio,
        "imbalance": imbalance,
    }


def validate_confusion_matrix(path: Path) -> tuple[bool, str]:
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            return True, f"valid image ({image.width}x{image.height})"
    except Exception as error:
        return False, str(error)


def summarize_class_weaknesses(report: str, labels: list[str]) -> str:
    scores = {}
    for label in labels:
        match = re.search(
            rf"^\s*{re.escape(label)}\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)",
            report,
            flags=re.IGNORECASE | re.MULTILINE,
        )
        if match:
            scores[label] = {
                "precision": float(match.group(1)),
                "recall": float(match.group(2)),
                "f1": float(match.group(3)),
            }

    if not scores:
        return "Class-level weakness analysis was not available from the recorded report."

    lowest_recall = min(scores, key=lambda label: scores[label]["recall"])
    lowest_f1 = min(scores, key=lambda label: scores[label]["f1"])
    strongest = sorted(scores, key=lambda label: scores[label]["f1"], reverse=True)[:2]
    strong_text = ", ".join(
        f"{label} (F1 {scores[label]['f1']:.4f})" for label in strongest
    )
    return (
        f"Lowest recall: {lowest_recall} ({scores[lowest_recall]['recall']:.4f}).\n"
        f"Lowest F1-score: {lowest_f1} ({scores[lowest_f1]['f1']:.4f}).\n"
        f"Relatively strong classes by F1-score: {strong_text}."
    )


def build_chart(severity: dict[str, object], risk: dict[str, object]) -> None:
    metrics = ["Accuracy", "Macro F1", "Weighted F1"]
    severity_values = [severity["accuracy"], severity["macro_f1"], severity["weighted_f1"]]
    risk_values = [risk["accuracy"], risk["macro_f1"], risk["weighted_f1"]]

    figure, axis = plt.subplots(figsize=(9, 6))
    positions = range(len(metrics))
    width = 0.36
    axis.bar([position - width / 2 for position in positions], severity_values, width, label="Severity Model")
    axis.bar([position + width / 2 for position in positions], risk_values, width, label="Risk Model")
    axis.set_xticks(list(positions), metrics)
    axis.set_ylim(0, 1)
    axis.set_ylabel("Score")
    axis.set_title("RoadSafe Analytics - ML Metrics Comparison")
    axis.legend()
    axis.grid(axis="y", alpha=0.25)
    figure.tight_layout()
    figure.savefig(CHART_PATH, dpi=200)
    plt.close(figure)


def main() -> None:
    print("Loading existing models and evaluation artifacts...")
    for path in [
        DATA_PATH,
        SEVERITY_MODEL_PATH,
        RISK_MODEL_PATH,
        SEVERITY_METRICS_PATH,
        RISK_METRICS_PATH,
        SEVERITY_CM_PATH,
        RISK_CM_PATH,
    ]:
        require_file(path)

    severity_model = joblib.load(SEVERITY_MODEL_PATH)
    joblib.load(RISK_MODEL_PATH)
    severity_cm_valid, severity_cm_detail = validate_confusion_matrix(SEVERITY_CM_PATH)
    risk_cm_valid, risk_cm_detail = validate_confusion_matrix(RISK_CM_PATH)
    if not severity_cm_valid or not risk_cm_valid:
        raise ValueError(
            f"Invalid confusion matrix image(s): severity={severity_cm_detail}; risk={risk_cm_detail}"
        )

    df = pd.read_csv(DATA_PATH)
    severity_metrics = parse_metrics(SEVERITY_METRICS_PATH)
    risk_metrics = parse_metrics(RISK_METRICS_PATH)
    if severity_metrics["report"] == "Not recorded.":
        severity_metrics["report"] = derive_existing_model_report(
            severity_model,
            str(severity_metrics["text"]),
            df,
            "accident_severity",
        )
    severity_distribution, severity_stats = distribution_section(
        df["accident_severity"], "Severity Class Distribution"
    )
    risk_distribution, risk_stats = distribution_section(
        df["Risk Category"], "Risk Class Distribution"
    )

    comparison = f"""ROADSAFE ANALYTICS - MODEL COMPARISON

Metric                  Severity Model       Risk Model
--------------------------------------------------------
Accuracy                {format_percent(severity_metrics['accuracy']):<20}{format_percent(risk_metrics['accuracy'])}
Macro F1                {format_percent(severity_metrics['macro_f1']):<20}{format_percent(risk_metrics['macro_f1'])}
Weighted F1             {format_percent(severity_metrics['weighted_f1']):<20}{format_percent(risk_metrics['weighted_f1'])}

Severity model type: {severity_metrics['model']}
Risk model type: {risk_metrics['model']}
Severity classes: {df['accident_severity'].nunique()}
Risk classes: {df['Risk Category'].nunique()}
Severity training/testing samples: {severity_metrics['training_samples']} / {severity_metrics['testing_samples']}
Risk training/testing samples: {risk_metrics['training_samples']} / {risk_metrics['testing_samples']}

These models predict different targets. Their metrics should be interpreted separately,
not used to declare one model better overall.
"""
    COMPARISON_PATH.write_text(comparison, encoding="utf-8")

    distribution_text = f"""ROADSAFE ANALYTICS - CLASS DISTRIBUTION ANALYSIS

Dataset: processed_accidents.csv
Total records: {len(df)}

{severity_distribution}

{risk_distribution}

Interpretation:
Accuracy alone may not represent performance equally across all classes when classes
are imbalanced. Macro F1 gives each class equal importance, while weighted F1 is
influenced more by the larger classes. Minority classes should not be removed solely
to improve these scores.
"""
    DISTRIBUTION_PATH.write_text(distribution_text, encoding="utf-8")

    build_chart(severity_metrics, risk_metrics)

    severity_report = str(severity_metrics["report"])
    risk_report = str(risk_metrics["report"])
    severity_weaknesses = summarize_class_weaknesses(
        severity_report,
        sorted(df["accident_severity"].astype(str).unique().tolist()),
    )
    risk_weaknesses = summarize_class_weaknesses(
        risk_report,
        sorted(df["Risk Category"].astype(str).unique().tolist()),
    )
    report = f"""ROADSAFE ANALYTICS
ML MODEL EVALUATION REPORT

1. Dataset
The evaluation used data/processed_accidents.csv with {len(df)} records and {len(df.columns)} columns.
The severity target was accident_severity. The risk target was Risk Category.
No model was retrained during this evaluation step.

2. Severity Prediction Model
Model: {severity_metrics['model']}
Training samples: {severity_metrics['training_samples']}
Testing samples: {severity_metrics['testing_samples']}
Accuracy: {format_percent(severity_metrics['accuracy'])}
Weighted Precision: {format_percent(severity_metrics['precision'])}
Weighted Recall: {format_percent(severity_metrics['recall'])}
Macro F1: {format_percent(severity_metrics['macro_f1'])}
Weighted F1: {format_percent(severity_metrics['weighted_f1'])}

Classification report:
{severity_report}

3. Risk Prediction Model
Model: {risk_metrics['model']}
Training samples: {risk_metrics['training_samples']}
Testing samples: {risk_metrics['testing_samples']}
Accuracy: {format_percent(risk_metrics['accuracy'])}
Weighted Precision: {format_percent(risk_metrics['precision'])}
Weighted Recall: {format_percent(risk_metrics['recall'])}
Macro F1: {format_percent(risk_metrics['macro_f1'])}
Weighted F1: {format_percent(risk_metrics['weighted_f1'])}

Classification report:
{risk_report}

4. Model Metrics
The severity and risk models predict different targets, so their metrics must be
interpreted separately. Accuracy, macro F1, and weighted F1 are all reported.

5. Class Distribution
{severity_distribution}

{risk_distribution}

6. Confusion Matrix Analysis
Severity confusion matrix: {SEVERITY_CM_PATH.name} - {severity_cm_detail}.
Risk confusion matrix: {RISK_CM_PATH.name} - {risk_cm_detail}.
Severity class analysis:
{severity_weaknesses}

Risk class analysis:
{risk_weaknesses}
The Critical class has low recall, meaning many actual Critical cases are not
correctly identified.

7. Model Limitations
- The Risk model has low recall and F1-score for the Critical class.
- Class imbalance means weighted metrics can look stronger than minority-class performance.
- The severity model has lower macro F1 than weighted F1, also indicating uneven class performance.
- These models are based on historical CSV data and should not be treated as guaranteed predictions.

8. Data Quality Issues
The visibility feature was completely missing in the cleaned dataset and was skipped
during the risk-model training step. Visibility has not been fixed in this evaluation.
The festival field is also mostly missing in the processed data and is handled by the
saved model pipeline's categorical imputation.

9. Future Improvements
- Repair and validate visibility data at the preprocessing stage.
- Collect more Critical-risk examples or use carefully validated imbalance methods.
- Evaluate cross-validation and calibration in a future model iteration.
- Review false negatives for Critical risk before any operational use.
"""
    REPORT_PATH.write_text(report, encoding="utf-8")

    print("\nMODEL COMPARISON")
    print(comparison)
    print("CLASS DISTRIBUTION")
    print(distribution_text)
    print("CONFUSION MATRICES")
    print(f"Severity: {severity_cm_valid} ({severity_cm_detail})")
    print(f"Risk: {risk_cm_valid} ({risk_cm_detail})")
    print(f"Created: {COMPARISON_PATH}")
    print(f"Created: {DISTRIBUTION_PATH}")
    print(f"Created: {REPORT_PATH}")
    print(f"Created: {CHART_PATH}")


if __name__ == "__main__":
    main()
