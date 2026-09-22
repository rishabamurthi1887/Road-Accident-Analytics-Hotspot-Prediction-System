from __future__ import annotations

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN


BASE_DIR = Path(__file__).resolve().parents[1]
DATA_PATH = BASE_DIR / "data" / "processed_accidents.csv"
HOTSPOTS_PATH = BASE_DIR / "data" / "hotspots.csv"
REPORT_PATH = BASE_DIR / "assets" / "hotspot_analysis_report.txt"
PLOT_PATH = BASE_DIR / "assets" / "hotspot_clusters.png"
EARTH_RADIUS_KM = 6371.0088
BASE_EPS_KM = 0.5
MIN_SAMPLES = 10


def find_column(df: pd.DataFrame, candidates: list[str], label: str) -> str:
    for candidate in candidates:
        if candidate in df.columns:
            return candidate
    raise ValueError(f"Required {label} column was not found. Available columns: {list(df.columns)}")


def choose_dbscan_labels(coordinates: np.ndarray) -> tuple[np.ndarray, float, list[str]]:
    # 0.5 km is the baseline. Larger radii are only considered if the baseline
    # produces no clusters, avoiding parameter selection based on cluster count.
    candidates = [BASE_EPS_KM, 0.75, 1.0]
    diagnostics = []
    for eps_km in candidates:
        labels = DBSCAN(
            eps=eps_km / EARTH_RADIUS_KM,
            min_samples=MIN_SAMPLES,
            metric="haversine",
            algorithm="ball_tree",
            n_jobs=-1,
        ).fit_predict(coordinates)
        cluster_count = len(set(labels)) - (1 if -1 in labels else 0)
        hotspot_records = int((labels >= 0).sum())
        noise_records = int((labels == -1).sum())
        diagnostics.append(
            f"eps={eps_km:.2f} km -> clusters={cluster_count}, "
            f"hotspot_accidents={hotspot_records}, noise_accidents={noise_records}"
        )
        if cluster_count > 0:
            return labels, eps_km, diagnostics
    return labels, candidates[-1], diagnostics


def min_max_normalize(values: pd.Series) -> pd.Series:
    minimum = values.min()
    maximum = values.max()
    if maximum == minimum:
        return pd.Series(1.0, index=values.index)
    return (values - minimum) / (maximum - minimum)


def hotspot_level(score: float) -> str:
    if score >= 75:
        return "Critical Hotspot"
    if score >= 50:
        return "High Risk Hotspot"
    if score >= 25:
        return "Moderate Hotspot"
    return "Low Risk Hotspot"


def main() -> None:
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Processed dataset not found: {DATA_PATH}")

    df = pd.read_csv(DATA_PATH)
    latitude_column = find_column(df, ["latitude", "Latitude", "lat"], "latitude")
    longitude_column = find_column(df, ["longitude", "Longitude", "lon", "lng"], "longitude")
    city_column = find_column(df, ["city", "City"], "city")
    state_column = find_column(df, ["state", "State"], "state")
    severity_column = find_column(df, ["accident_severity", "Accident Severity"], "accident severity")
    risk_column = find_column(df, ["Risk Category", "risk_category", "risk_category"], "risk category")

    print(f"Dataset shape: {df.shape}")
    print(f"Latitude column: {latitude_column}")
    print(f"Longitude column: {longitude_column}")
    print(f"City column: {city_column}")
    print(f"State column: {state_column}")
    print(f"Accident severity column: {severity_column}")
    print(f"Risk category column: {risk_column}")

    working = df.copy()
    working[latitude_column] = pd.to_numeric(working[latitude_column], errors="coerce")
    working[longitude_column] = pd.to_numeric(working[longitude_column], errors="coerce")
    original_rows = len(working)
    valid_coordinates = (
        working[latitude_column].notna()
        & working[longitude_column].notna()
        & working[latitude_column].between(-90, 90)
        & working[longitude_column].between(-180, 180)
    )
    working = working.loc[valid_coordinates].copy()
    removed_rows = original_rows - len(working)
    print(f"Original rows: {original_rows}")
    print(f"Valid geographic rows: {len(working)}")
    print(f"Removed rows: {removed_rows}")
    if working.empty:
        raise ValueError("No valid geographic records remain after coordinate validation.")

    coordinates = np.radians(working[[latitude_column, longitude_column]].to_numpy())
    labels, eps_km, diagnostics = choose_dbscan_labels(coordinates)
    working["hotspot_cluster"] = labels
    non_noise = working[working["hotspot_cluster"] >= 0].copy()
    noise_count = int((working["hotspot_cluster"] == -1).sum())
    cluster_count = int(non_noise["hotspot_cluster"].nunique())
    if non_noise.empty:
        raise ValueError("DBSCAN produced zero hotspots. Investigate eps and min_samples before continuing.")

    working["_severity"] = working[severity_column].astype(str).str.strip().str.lower()
    working["_risk"] = working[risk_column].astype(str).str.strip().str.lower()
    if "casualties" in working.columns:
        working["_casualties"] = pd.to_numeric(working["casualties"], errors="coerce").fillna(0)
    else:
        working["_casualties"] = 0.0
    if "risk_score" in working.columns:
        working["_risk_score"] = pd.to_numeric(working["risk_score"], errors="coerce")
    else:
        working["_risk_score"] = np.nan

    records = []
    for cluster_id, group in working[working["hotspot_cluster"] >= 0].groupby("hotspot_cluster"):
        city_mode = group[city_column].dropna().astype(str).mode()
        state_mode = group[state_column].dropna().astype(str).mode()
        records.append(
            {
                "hotspot_cluster": int(cluster_id),
                "accident_count": int(len(group)),
                "average_latitude": float(group[latitude_column].mean()),
                "average_longitude": float(group[longitude_column].mean()),
                "city": city_mode.iloc[0] if not city_mode.empty else "Unknown",
                "state": state_mode.iloc[0] if not state_mode.empty else "Unknown",
                "fatal_accidents": int((group["_severity"] == "fatal").sum()),
                "major_accidents": int((group["_severity"] == "major").sum()),
                "minor_accidents": int((group["_severity"] == "minor").sum()),
                "total_casualties": float(group["_casualties"].sum()),
                "average_risk_score": float(group["_risk_score"].mean()) if group["_risk_score"].notna().any() else np.nan,
                "high_risk_count": int(group["_risk"].isin(["high", "critical"]).sum()),
                "critical_risk_count": int((group["_risk"] == "critical").sum()),
            }
        )

    hotspots = pd.DataFrame(records)
    hotspots["frequency_component"] = min_max_normalize(hotspots["accident_count"])
    hotspots["fatal_component"] = min_max_normalize(hotspots["fatal_accidents"])
    hotspots["high_risk_component"] = min_max_normalize(hotspots["high_risk_count"])
    hotspots["casualty_component"] = min_max_normalize(hotspots["total_casualties"])
    hotspots["hotspot_score"] = (
        100
        * (
            0.35 * hotspots["frequency_component"]
            + 0.30 * hotspots["fatal_component"]
            + 0.20 * hotspots["high_risk_component"]
            + 0.15 * hotspots["casualty_component"]
        )
    ).round(2)
    hotspots["hotspot_level"] = hotspots["hotspot_score"].map(hotspot_level)
    hotspots = hotspots.sort_values(["hotspot_score", "accident_count"], ascending=False).reset_index(drop=True)
    output_columns = [
        "hotspot_cluster",
        "hotspot_score",
        "hotspot_level",
        "accident_count",
        "fatal_accidents",
        "major_accidents",
        "minor_accidents",
        "total_casualties",
        "average_latitude",
        "average_longitude",
        "city",
        "state",
        "average_risk_score",
        "high_risk_count",
        "critical_risk_count",
    ]
    hotspots = hotspots[output_columns]

    HOTSPOTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    hotspots.to_csv(HOTSPOTS_PATH, index=False)

    figure, axis = plt.subplots(figsize=(10, 7))
    scatter = axis.scatter(
        working[longitude_column],
        working[latitude_column],
        c=working["hotspot_cluster"],
        s=8,
        alpha=0.55,
        cmap="tab20",
    )
    axis.set_xlabel("Longitude")
    axis.set_ylabel("Latitude")
    axis.set_title("RoadSafe Analytics - Geographic Accident Clusters")
    axis.grid(alpha=0.2)
    figure.colorbar(scatter, ax=axis, label="DBSCAN cluster ID (-1 = noise)")
    figure.tight_layout()
    figure.savefig(PLOT_PATH, dpi=200)
    plt.close(figure)

    level_counts = hotspots["hotspot_level"].value_counts().to_dict()
    top_hotspots = hotspots.head(10)
    top_lines = [
        f"#{index + 1} {row.city}, {row.state} | cluster={int(row.hotspot_cluster)} | "
        f"accidents={int(row.accident_count)} | score={row.hotspot_score:.2f} | {row.hotspot_level}"
        for index, row in top_hotspots.iterrows()
    ]
    formula = (
        "hotspot_score = 100 * (0.35 * normalized accident frequency + "
        "0.30 * normalized fatal accidents + 0.20 * normalized high/critical risk "
        "+ 0.15 * normalized casualties). Normalization is min-max across detected clusters. "
        "Levels: Critical >= 75, High Risk >= 50, Moderate >= 25, otherwise Low."
    )
    report = f"""ROADSAFE ANALYTICS - HOTSPOT ANALYSIS REPORT

1. Method
DBSCAN was applied to valid latitude/longitude coordinates using the haversine metric.
Coordinates were converted to radians. DBSCAN identifies dense geographic regions without
requiring a preselected number of clusters.

2. Dataset size
Original records: {original_rows}
Valid geographic records: {len(working)}
Removed invalid geographic records: {removed_rows}

3. DBSCAN parameters
Selected eps: {eps_km:.2f} km ({eps_km / EARTH_RADIUS_KM:.8f} radians)
min_samples: {MIN_SAMPLES}
Parameter checks:
{chr(10).join(diagnostics)}
The 0.5 km baseline was retained when it produced at least one dense cluster; larger
radii were fallback checks rather than an attempt to maximize cluster count.

4. Cluster results
Number of clusters: {cluster_count}
Hotspot accidents: {len(non_noise)}
Noise accidents: {noise_count}
Detected hotspots: {len(hotspots)}

5. Hotspot scoring and classification
{formula}
The score combines measurable accident frequency, fatal accidents, high/critical risk
records, and casualties. It does not classify every dense cluster as Critical.

6. Top hotspots
{chr(10).join(top_lines)}

Hotspot levels:
{chr(10).join(f"{level}: {int(count)}" for level, count in sorted(level_counts.items()))}

7. Limitations
These are data-driven geographic hotspots identified from historical accident records,
not predictions of future accidents. DBSCAN results depend on coordinate quality, radius,
and minimum sample settings. Cluster-level city/state labels use the most common value in
each cluster, and the score is relative to the detected clusters in this dataset.
"""
    REPORT_PATH.write_text(report, encoding="utf-8")

    print(f"DBSCAN eps: {eps_km:.2f} km")
    print(f"DBSCAN min_samples: {MIN_SAMPLES}")
    print(f"Clusters detected: {cluster_count}")
    print(f"Noise accidents: {noise_count}")
    print(f"Hotspots detected: {len(hotspots)}")
    print("Hotspot levels:", level_counts)
    print("Top 10 hotspots:")
    print(hotspots.head(10).to_string(index=False))
    print(f"Saved hotspot dataset: {HOTSPOTS_PATH}")
    print(f"Saved report: {REPORT_PATH}")
    print(f"Saved visualization: {PLOT_PATH}")


if __name__ == "__main__":
    main()
