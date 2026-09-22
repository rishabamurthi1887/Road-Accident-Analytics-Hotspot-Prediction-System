from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
RAW_DATA_PATH = ROOT / "data" / "accidents.csv"
PROCESSED_DATA_PATH = ROOT / "data" / "processed_accidents.csv"


def print_section(title: str) -> None:
    print(f"\n===== {title} =====")


def load_dataset() -> pd.DataFrame:
    if not RAW_DATA_PATH.exists():
        raise FileNotFoundError(f"Dataset not found: {RAW_DATA_PATH}")

    df = pd.read_csv(RAW_DATA_PATH)
    print_section("Dataset information")
    print(f"Original records: {len(df)}")
    print(f"Original columns: {list(df.columns)}")
    print(f"Shape: {df.shape}")
    print("Missing values before cleaning:")
    print(df.isna().sum())
    print(f"Duplicate rows: {int(df.duplicated().sum())}")
    return df


def clean_dataset(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = df.columns.map(lambda col: str(col).strip())

    original_rows = len(df)
    df = df.drop_duplicates().copy()
    duplicates_removed = original_rows - len(df)

    print_section("Cleaning summary")
    print(f"Duplicates removed: {duplicates_removed}")

    for col in ["city", "state", "road_type", "weather", "traffic_density", "cause", "accident_severity", "festival", "Risk Category"]:
        if col in df.columns:
            df[col] = df[col].astype("string")
            df[col] = df[col].str.strip()
            df[col] = df[col].replace({"": pd.NA, "None": "None", "nan": pd.NA, "NaN": pd.NA})

    numeric_columns = [
        "latitude",
        "longitude",
        "hour",
        "day_of_week",
        "lanes",
        "traffic_signal",
        "visibility",
        "temperature",
        "vehicles_involved",
        "casualties",
        "risk_score",
        "Risk Index",
        "Year",
        "Month Number",
    ]

    for col in numeric_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    for col in numeric_columns:
        if col in df.columns:
            median_value = df[col].median()
            df[col] = df[col].fillna(median_value)

    categorical_columns = [
        col for col in df.columns
        if col not in {"accident_id", "date", "time", "latitude", "longitude", "hour", "day_of_week", "lanes", "traffic_signal", "visibility", "temperature", "vehicles_involved", "casualties", "risk_score", "Risk Index", "Year", "Month Number"}
        and df[col].dtype == "object"
    ]

    for col in categorical_columns:
        if col in df.columns:
            df[col] = df[col].astype("string")
            df[col] = df[col].str.strip()
            df[col] = df[col].replace({"": pd.NA, "nan": pd.NA, "NaN": pd.NA})
            mode_value = df[col].mode(dropna=True)
            if not mode_value.empty:
                df[col] = df[col].fillna(mode_value.iloc[0])
            else:
                df[col] = df[col].fillna("Unknown")

    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], errors="coerce")

    if "time" in df.columns:
        df["time"] = pd.to_datetime(df["time"], errors="coerce", format="%I:%M:%S %p")

    if "latitude" in df.columns:
        df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
        df.loc[(df["latitude"] < -90) | (df["latitude"] > 90), "latitude"] = np.nan
        df["latitude"] = df["latitude"].fillna(df["latitude"].median())

    if "longitude" in df.columns:
        df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
        df.loc[(df["longitude"] < -180) | (df["longitude"] > 180), "longitude"] = np.nan
        df["longitude"] = df["longitude"].fillna(df["longitude"].median())

    df["hour"] = pd.to_numeric(df.get("hour", 0), errors="coerce").fillna(0).astype(int)
    df["day_of_week"] = df["day_of_week"].fillna("Unknown")
    df["is_weekend"] = df.get("is_weekend", 0)
    if "is_weekend" in df.columns:
        df["is_weekend"] = pd.to_numeric(df["is_weekend"], errors="coerce").fillna(0).astype(int)
    if "day_of_week" in df.columns and "date" in df.columns:
        df["day_of_week"] = df["date"].dt.day_name().fillna(df["day_of_week"])
        df["is_weekend"] = df["day_of_week"].isin(["Saturday", "Sunday"]).astype(int)

    if "is_peak_hour" not in df.columns:
        df["is_peak_hour"] = df["hour"].isin([7, 8, 9, 10, 17, 18, 19, 20]).astype(int)
    else:
        df["is_peak_hour"] = pd.to_numeric(df["is_peak_hour"], errors="coerce").fillna(0).astype(int)

    if "date" in df.columns:
        df["month"] = df["date"].dt.month
        df["year"] = df["date"].dt.year
    else:
        if "Month Number" in df.columns:
            df["month"] = pd.to_numeric(df["Month Number"], errors="coerce").fillna(0).astype(int)
        if "Year" in df.columns:
            df["year"] = pd.to_numeric(df["Year"], errors="coerce").fillna(0).astype(int)

    if "festival" in df.columns:
        df["festival"] = df["festival"].fillna("None")

    if "road_type" in df.columns:
        df["road_type"] = df["road_type"].astype("string").str.lower().fillna("unknown")

    if "weather" in df.columns:
        df["weather"] = df["weather"].astype("string").str.lower().fillna("unknown")

    if "traffic_density" in df.columns:
        df["traffic_density"] = df["traffic_density"].astype("string").str.lower().fillna("unknown")

    if "cause" in df.columns:
        df["cause"] = df["cause"].astype("string").str.lower().fillna("unknown")

    if "accident_severity" in df.columns:
        df["accident_severity"] = df["accident_severity"].astype("string").str.lower().fillna("unknown")

    if "Risk Category" in df.columns:
        df["Risk Category"] = df["Risk Category"].astype("string").str.strip().fillna("Unknown")

    print("Missing values after cleaning:")
    print(df.isna().sum().sort_values(ascending=False).head(20))

    return df


def save_processed_data(df: pd.DataFrame) -> None:
    PROCESSED_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(PROCESSED_DATA_PATH, index=False)
    print_section("Processed dataset")
    print(f"Saved cleaned dataset to: {PROCESSED_DATA_PATH}")
    print(f"Cleaned records: {len(df)}")


def print_preprocessing_summary(original_rows: int, cleaned_df: pd.DataFrame, duplicates_removed: int) -> None:
    missing_count = int(cleaned_df.isna().sum().sum())
    features_created = [
        col for col in ["is_weekend", "is_peak_hour", "month", "year"] if col in cleaned_df.columns
    ]

    print_section("Preprocessing summary")
    print(f"Original records: {original_rows}")
    print(f"Cleaned records: {len(cleaned_df)}")
    print(f"Duplicates removed: {duplicates_removed}")
    print(f"Missing values handled: {missing_count}")
    print(f"Features created: {features_created}")


def main() -> None:
    df = load_dataset()
    original_rows = len(df)
    cleaned_df = clean_dataset(df)
    duplicates_removed = original_rows - len(cleaned_df)
    save_processed_data(cleaned_df)
    print_preprocessing_summary(original_rows, cleaned_df, duplicates_removed)


if __name__ == "__main__":
    main()
