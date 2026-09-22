from __future__ import annotations

from collections import Counter
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd


BASE_DIR = Path(__file__).resolve().parents[1]
ACCIDENTS_PATH = BASE_DIR / "data" / "processed_accidents.csv"
HOTSPOTS_PATH = BASE_DIR / "data" / "hotspots.csv"
OUTPUT_PATH = BASE_DIR / "data" / "recommendations.csv"
REPORT_PATH = BASE_DIR / "assets" / "recommendation_report.txt"
CHART_PATH = BASE_DIR / "assets" / "recommendation_summary.png"
PRIORITIES = {"High", "Medium", "Low"}


def require_columns(df: pd.DataFrame, required: list[str], name: str) -> None:
    missing = [column for column in required if column not in df.columns]
    if missing:
        raise ValueError(f"{name} is missing required columns: {missing}. Available columns: {list(df.columns)}")


def numeric_series(df: pd.DataFrame, column: str, default: float = 0) -> pd.Series:
    if column not in df.columns:
        return pd.Series(default, index=df.index, dtype="float64")
    return pd.to_numeric(df[column], errors="coerce").fillna(default)


def add_recommendation(
    rows: list[dict[str, object]],
    hotspot: pd.Series,
    priority: str,
    recommendation: str,
    reason: str,
) -> None:
    if priority not in PRIORITIES or not recommendation.strip() or not reason.strip():
        raise ValueError("Recommendation rows require valid priority, text, and reason.")
    rows.append(
        {
            "hotspot_cluster": int(hotspot["hotspot_cluster"]),
            "city": str(hotspot["city"]),
            "state": str(hotspot["state"]),
            "hotspot_level": str(hotspot["hotspot_level"]),
            "hotspot_score": float(hotspot["hotspot_score"]),
            "priority": priority,
            "recommendation": recommendation,
            "recommendation_reason": reason,
        }
    )


def main() -> None:
    print("Loading accident and hotspot datasets...")
    if not ACCIDENTS_PATH.exists():
        raise FileNotFoundError(f"Accident dataset not found: {ACCIDENTS_PATH}")
    if not HOTSPOTS_PATH.exists():
        raise FileNotFoundError(f"Hotspot dataset not found: {HOTSPOTS_PATH}")

    accidents = pd.read_csv(ACCIDENTS_PATH)
    hotspots = pd.read_csv(HOTSPOTS_PATH)
    print(f"Accident dataset shape: {accidents.shape}")
    print(f"Accident columns: {list(accidents.columns)}")
    print(f"Accident missing values: {accidents.isna().sum().to_dict()}")
    print(f"Hotspot dataset shape: {hotspots.shape}")
    print(f"Hotspot columns: {list(hotspots.columns)}")
    print(f"Hotspot missing values: {hotspots.isna().sum().to_dict()}")

    require_columns(
        accidents,
        ["city", "state", "road_type", "traffic_signal", "weather", "traffic_density", "cause", "accident_severity", "hour", "is_peak_hour", "is_weekend", "Risk Category"],
        "processed_accidents.csv",
    )
    require_columns(
        hotspots,
        ["hotspot_cluster", "city", "state", "hotspot_level", "hotspot_score", "accident_count", "fatal_accidents", "total_casualties", "high_risk_count", "critical_risk_count"],
        "hotspots.csv",
    )
    if hotspots.empty:
        raise ValueError("Hotspot dataset is empty; no recommendations can be generated.")

    accidents["_hour"] = numeric_series(accidents, "hour")
    accidents["_peak"] = numeric_series(accidents, "is_peak_hour")
    accidents["_signal"] = numeric_series(accidents, "traffic_signal")
    accidents["_casualties"] = numeric_series(accidents, "casualties")
    accidents["_risk"] = accidents["Risk Category"].astype(str).str.strip().str.lower()
    accidents["_severity"] = accidents["accident_severity"].astype(str).str.strip().str.lower()
    accidents["_density"] = accidents["traffic_density"].astype(str).str.strip().str.lower()
    accidents["_weather"] = accidents["weather"].astype(str).str.strip().str.lower()
    accidents["_road_type"] = accidents["road_type"].astype(str).str.strip().str.lower()
    accidents["_cause"] = accidents["cause"].astype(str).str.strip().str.lower()

    total_accidents = len(accidents)
    night_mask = (accidents["_hour"] < 6) | (accidents["_hour"] >= 20)
    fatal_pct = float((accidents["_severity"] == "fatal").mean())
    night_pct = float(night_mask.mean())
    peak_pct = float((accidents["_peak"] == 1).mean())
    high_critical_pct = float(accidents["_risk"].isin(["high", "critical"]).mean())

    density_counts = accidents["_density"].value_counts()
    density_shares = density_counts / total_accidents
    dominant_density = str(density_shares.index[0])
    dominant_density_share = float(density_shares.iloc[0])
    density_q75 = float(density_shares.quantile(0.75))

    weather_counts = accidents["_weather"].value_counts()
    weather_shares = weather_counts / total_accidents
    adverse_weather = {"fog", "rain", "storm", "haze", "dust", "snow", "mist"}
    adverse_share = float(accidents["_weather"].isin(adverse_weather).mean())
    dominant_weather = str(weather_shares.index[0])
    dominant_weather_share = float(weather_shares.iloc[0])

    road_shares = accidents["_road_type"].value_counts(normalize=True)
    dominant_road = str(road_shares.index[0])
    dominant_road_share = float(road_shares.iloc[0])
    road_share_threshold = float(road_shares.quantile(0.75))

    signal_pct = float((accidents["_signal"] == 1).mean())
    cause_counts = accidents["_cause"].value_counts()
    dominant_cause = str(cause_counts.index[0])
    dominant_cause_share = float(cause_counts.iloc[0] / total_accidents)

    thresholds = {
        "fatal_pct": max(fatal_pct, 0.05),
        "night_pct": max(night_pct, 0.25),
        "peak_pct": max(peak_pct, 0.25),
        "high_critical_pct": max(high_critical_pct, 0.25),
        "dominant_density_share": max(dominant_density_share, density_q75),
        "adverse_weather_share": max(adverse_share, 0.10),
        "dominant_road_share": max(dominant_road_share, road_share_threshold),
        "signal_pct": max(signal_pct, 0.25),
        "dominant_cause_share": max(dominant_cause_share, 0.10),
        "high_risk_count_q75": float(numeric_series(hotspots, "high_risk_count").quantile(0.75)),
        "critical_risk_count_q75": float(numeric_series(hotspots, "critical_risk_count").quantile(0.75)),
        "hotspot_score_q75": float(numeric_series(hotspots, "hotspot_score").quantile(0.75)),
    }

    rows: list[dict[str, object]] = []
    global_rules: list[tuple[bool, str, str, str]] = [
        (
            dominant_density_share >= thresholds["dominant_density_share"],
            "Traffic management",
            "Increase traffic monitoring and enforcement during high-density periods.",
            f"{dominant_density.title()} traffic density is the dominant category at {dominant_density_share:.2%} of records; threshold used: {thresholds['dominant_density_share']:.2%}.",
        ),
        (
            fatal_pct >= thresholds["fatal_pct"],
            "Fatality prevention",
            "Prioritize road-safety intervention and speed enforcement.",
            f"Fatal accidents represent {fatal_pct:.2%} of records; data-driven review threshold: {thresholds['fatal_pct']:.2%}.",
        ),
        (
            night_pct >= thresholds["night_pct"],
            "Night safety",
            "Evaluate street lighting, nighttime visibility, and nighttime enforcement.",
            f"Nighttime accidents represent {night_pct:.2%} of records using hours before 06:00 or from 20:00; threshold: {thresholds['night_pct']:.2%}.",
        ),
        (
            peak_pct >= thresholds["peak_pct"],
            "Peak-hour management",
            "Increase traffic management during peak hours.",
            f"Peak-hour records represent {peak_pct:.2%} of accidents; threshold: {thresholds['peak_pct']:.2%}.",
        ),
        (
            adverse_share >= thresholds["adverse_weather_share"],
            "Weather safety",
            "Issue weather-related warnings and improve visibility controls during adverse conditions.",
            f"Adverse-weather records represent {adverse_share:.2%} of accidents; conditions counted: {', '.join(sorted(adverse_weather))}; threshold: {thresholds['adverse_weather_share']:.2%}.",
        ),
        (
            dominant_road_share >= thresholds["dominant_road_share"],
            "Road engineering",
            f"Prioritize {dominant_road} road safety inspection and engineering improvements.",
            f"The dominant road type is {dominant_road} at {dominant_road_share:.2%} of records; threshold: {thresholds['dominant_road_share']:.2%}.",
        ),
        (
            signal_pct >= thresholds["signal_pct"],
            "Intersection safety",
            "Review signal timing, intersection design, and enforcement.",
            f"Records with traffic signals represent {signal_pct:.2%} of accidents; threshold: {thresholds['signal_pct']:.2%}.",
        ),
        (
            dominant_cause_share >= thresholds["dominant_cause_share"],
            "Cause-focused enforcement",
            f"Target enforcement and education toward {dominant_cause} incidents.",
            f"The most common recorded cause is {dominant_cause} at {dominant_cause_share:.2%} of accidents; threshold: {thresholds['dominant_cause_share']:.2%}.",
        ),
    ]

    for _, hotspot in hotspots.iterrows():
        score = float(hotspot["hotspot_score"])
        high_count = int(hotspot["high_risk_count"])
        critical_count = int(hotspot["critical_risk_count"])
        level = str(hotspot["hotspot_level"])
        base_priority = "High" if level == "Critical Hotspot" or score >= thresholds["hotspot_score_q75"] else "Medium" if level == "High Risk Hotspot" else "Low"
        add_recommendation(
            rows,
            hotspot,
            base_priority,
            "Prioritize this hotspot for targeted road-safety intervention.",
            f"Hotspot score is {score:.2f}, classified as {level}; the dataset-derived upper-quartile score threshold is {thresholds['hotspot_score_q75']:.2f}.",
        )
        if high_count >= thresholds["high_risk_count_q75"] or critical_count >= thresholds["critical_risk_count_q75"]:
            add_recommendation(
                rows,
                hotspot,
                "High" if critical_count > 0 or level == "Critical Hotspot" else "Medium",
                "Increase targeted enforcement and monitoring at this hotspot.",
                f"This hotspot contains {high_count} High/Critical risk accidents and {critical_count} Critical risk accidents; upper-quartile thresholds are {thresholds['high_risk_count_q75']:.2f} and {thresholds['critical_risk_count_q75']:.2f}.",
            )
        if int(hotspot["fatal_accidents"]) > 0:
            add_recommendation(
                rows,
                hotspot,
                "High" if int(hotspot["fatal_accidents"]) >= numeric_series(hotspots, "fatal_accidents").quantile(0.75) else "Medium",
                "Review speed control, road design, and emergency response coverage near this hotspot.",
                f"The hotspot contains {int(hotspot['fatal_accidents'])} fatal accidents out of {int(hotspot['accident_count'])} records.",
            )

    for condition, category, recommendation, reason in global_rules:
        if condition:
            for _, hotspot in hotspots.iterrows():
                priority = "High" if str(hotspot["hotspot_level"]) == "Critical Hotspot" else "Medium"
                add_recommendation(rows, hotspot, priority, recommendation, reason)

    recommendations = pd.DataFrame(rows)
    recommendations = recommendations.drop_duplicates().reset_index(drop=True)
    if recommendations.empty:
        raise ValueError("No recommendations were generated from the evidence-based rules.")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    recommendations.to_csv(OUTPUT_PATH, index=False)

    categories = recommendations["recommendation"].map(
        lambda text: next((category for _, category, rec, _ in global_rules if rec == text), "Hotspot prioritization")
    )
    category_counts = categories.value_counts()
    figure, axis = plt.subplots(figsize=(10, 6))
    category_counts.sort_values().plot.barh(ax=axis)
    axis.set_xlabel("Number of recommendations")
    axis.set_ylabel("Recommendation category")
    axis.set_title("RoadSafe Analytics - Recommendation Summary")
    figure.tight_layout()
    figure.savefig(CHART_PATH, dpi=200)
    plt.close(figure)

    high_priority = recommendations[recommendations["priority"] == "High"]
    most_common = category_counts.sort_values(ascending=False)
    high_lines = [
        f"cluster={int(row.hotspot_cluster)} | {row.city}, {row.state} | {row.recommendation}"
        for _, row in high_priority.head(20).iterrows()
    ]
    rules_text = "\n".join(
        f"- {category}: {'enabled' if condition else 'not enabled'}; {reason}"
        for condition, category, _, reason in global_rules
    )
    report = f"""ROADSAFE ANALYTICS
ROAD SAFETY RECOMMENDATION REPORT

1. Methodology
The engine combines transparent rules from processed_accidents.csv with measured
statistics from hotspots.csv. Each generated row is linked to a detected hotspot.
Global accident patterns are used as evidence because hotspots.csv contains aggregate
cluster statistics rather than the original accident-to-cluster assignments.

2. Rules used
{rules_text}
- Hotspot prioritization: every detected hotspot receives a baseline intervention rule.
- Hotspot risk concentration: High/Critical counts at or above the hotspot upper quartile
  trigger targeted enforcement. Fatal accidents trigger a separate safety review rule.

3. Thresholds
{chr(10).join(f"- {name}: {value:.4f}" for name, value in thresholds.items())}
Thresholds are derived from dataset percentages, category shares, medians/upper quartiles,
or explicit time definitions. Night means hour < 6 or hour >= 20.

4. High-priority hotspots
{chr(10).join(high_lines) if high_lines else 'None'}

5. Most common recommendations
{chr(10).join(f"- {name}: {int(count)}" for name, count in most_common.items())}

6. Data limitations
- Recommendations use historical accident records and detected hotspots; they do not
  guarantee accident reduction or predict future accidents.
- Cluster-level hotspot statistics do not include each source accident's cluster ID,
  so broad pattern rules cannot be attributed to individual source records.
- The visibility field is completely missing in the cleaned dataset and was not used
  to create a new recommendation rule.
- The festival field is mostly missing and was not used as a recommendation trigger.

7. Future improvements
- Preserve accident-level cluster assignments when generating hotspots.
- Repair and validate visibility data before adding visibility-specific recommendations.
- Add time-window and road-segment monitoring when operational data becomes available.

These are data-driven decision-support recommendations based on historical accident data.
They do not guarantee accident reduction.
"""
    REPORT_PATH.write_text(report, encoding="utf-8")

    print(f"Hotspots analyzed: {len(hotspots)}")
    print(f"Recommendations generated: {len(recommendations)}")
    print(f"High-priority recommendations: {len(high_priority)}")
    print(f"Recommendation categories: {category_counts.to_dict()}")
    print(f"Saved recommendations: {OUTPUT_PATH}")
    print(f"Saved report: {REPORT_PATH}")
    print(f"Saved visualization: {CHART_PATH}")


if __name__ == "__main__":
    main()
