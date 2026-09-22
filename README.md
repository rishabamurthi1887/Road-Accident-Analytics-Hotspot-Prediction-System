# RoadSafe Analytics

RoadSafe Analytics is an interactive accident risk intelligence system for PS42: Road Accident Analytics & Hotspot Prediction System in the Smart City and Transportation domain.

The project combines historical accident analytics, two machine-learning classifiers, geographic hotspot detection, explainable safety recommendations, a Flask REST API, and an existing Leaflet/Chart.js dashboard.

## Problem Statement

Traffic police records contain accident location, time, road, weather, vehicle, cause, and severity information. The system analyzes those records to identify historical risk patterns and geographic accident hotspots that can support road-safety planning.

This project uses historical CSV data. It is not a real-time traffic or accident prediction service.

## Objective

- Clean and validate accident records.
- Analyze location, time, cause, road, weather, traffic, and severity patterns.
- Predict accident severity and categorical risk using saved scikit-learn pipelines.
- Detect dense historical geographic clusters using DBSCAN.
- Generate transparent, data-driven decision-support recommendations.
- Present the results through the existing dashboard and Flask API.

## Features

- KPI dashboard backed by the processed accident data and API summary.
- Existing Leaflet accident map with state, city, risk, year, and search interactions.
- API-backed hotspot table and hotspot circles with popup details.
- Chart.js analytics for state, monthly, severity, causes, road type, and traffic density.
- Random Forest accident severity prediction with class probabilities.
- Random Forest risk-category prediction with class probabilities.
- DBSCAN geographic hotspot analysis.
- Recommendation cards linked to hotspot evidence and rule reasons.
- Model comparison, class-distribution, hotspot, and recommendation reports.

## System Workflow

```text
raw accidents.csv
        |
        v
ml/preprocessing.py
        |
        v
processed_accidents.csv
        |
        +--> train_severity_model.py --> severity_model.pkl
        |
        +--> train_risk_model.py ------> risk_model.pkl
        |
        +--> hotspot_analysis.py -------> hotspots.csv
                                      |
                                      v
                              recommendation_engine.py
                                      |
                                      v
                              recommendations.csv
                                      |
                                      v
                                  Flask API
                                      |
                                      v
                         Leaflet / Chart.js dashboard
```

## Dataset

The source file is `data/accidents.csv`. The verified processed dataset contains 20,000 records and 31 columns, including city, state, latitude, longitude, date/time fields, road type, traffic, weather, cause, accident severity, casualties, risk fields, and derived month/year fields.

Generated data files:

- `data/processed_accidents.csv` - cleaned and feature-engineered records.
- `data/hotspots.csv` - one row per detected geographic hotspot.
- `data/recommendations.csv` - one row per generated recommendation.

## Data Preprocessing

`ml/preprocessing.py` removes duplicate rows, converts numeric fields, parses dates and times, validates coordinates, handles missing values where possible, and creates derived fields such as `is_weekend`, `is_peak_hour`, `month`, and `year`.

The processed dataset currently has a completely missing `visibility` column and a mostly missing `festival` field. Visibility has not been fixed. The affected model pipelines handle the existing schema as recorded in the evaluation reports.

Run preprocessing only when rebuilding generated data:

```powershell
python ml/preprocessing.py
```

## Severity ML Model

`ml/train_severity_model.py` trains a `RandomForestClassifier` in a complete preprocessing pipeline and saves `ml/severity_model.pkl`. Target: `accident_severity` with the classes `minor`, `major`, and `fatal`.

Verified test-set metrics:

| Metric | Value |
| --- | ---: |
| Accuracy | 48.05% |
| Weighted Precision | 41.72% |
| Weighted Recall | 48.05% |
| Weighted F1 | 43.26% |
| Macro F1 | 31.54% |

The fatal class has the weakest recorded recall and F1-score in the severity report.

Prediction script:

```powershell
python ml/predict_severity.py
```

## Risk ML Model

`ml/train_risk_model.py` trains a `RandomForestClassifier` in a complete preprocessing pipeline and saves `ml/risk_model.pkl`. Target: `Risk Category` with the classes `Low`, `Moderate`, `High`, and `Critical`.

Verified test-set metrics:

| Metric | Value |
| --- | ---: |
| Accuracy | 76.18% |
| Weighted Precision | 75.04% |
| Weighted Recall | 76.18% |
| Weighted F1 | 75.33% |
| Macro F1 | 57.82% |

The Risk model has very low recall for the Critical class: 0.0093, with an F1-score of 0.0179. This limitation is important because weighted metrics are influenced by the larger classes.

Prediction script:

```powershell
python ml/predict_risk.py
```

## Model Evaluation

`ml/evaluate_models.py` evaluates the existing model artifacts without retraining them. It creates:

- `assets/model_comparison.txt`
- `assets/class_distribution_analysis.txt`
- `assets/ml_evaluation_report.txt`
- `assets/model_metrics_comparison.png`

The severity class distribution is minor 55.12%, major 29.94%, and fatal 14.94%. The risk distribution is Moderate 41.27%, Low 34.68%, High 21.37%, and Critical 2.69%.

## Hotspot Detection

`ml/hotspot_analysis.py` uses DBSCAN with haversine distance on latitude/longitude values converted to radians. The verified configuration uses an approximately 0.50 km radius and `min_samples=10`.

The current output contains 38 detected hotspots from 20,000 valid geographic records. The hotspots are historical geographic accident clusters, not guaranteed future predictions. Results depend on coordinate quality and DBSCAN parameters.

Outputs:

- `data/hotspots.csv`
- `assets/hotspot_analysis_report.txt`
- `assets/hotspot_clusters.png`

## Recommendation Engine

`ml/recommendation_engine.py` applies transparent rules based on measured accident and hotspot statistics. Rules cover hotspot priority, fatality prevention, nighttime safety, weather, traffic management, road engineering, intersections, and common causes.

The verified output analyzes 38 hotspots and generates 372 recommendations. Each recommendation includes a priority, location, recommendation text, and measurable reason. These are historical decision-support suggestions and do not guarantee accident reduction.

Outputs:

- `data/recommendations.csv`
- `assets/recommendation_report.txt`
- `assets/recommendation_summary.png`

## Flask API

`api/app.py` loads the existing data files and saved models. It uses project-root-based paths, Flask, and Flask-CORS.

Endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API health check |
| GET | `/api/hotspots` | Return generated hotspot records |
| GET | `/api/recommendations` | Return generated recommendations |
| GET | `/api/summary` | Return dashboard summary statistics |
| POST | `/api/predict/severity` | Predict accident severity and probabilities |
| POST | `/api/predict/risk` | Predict risk category and probabilities |

Prediction requests must include the feature fields required by the saved pipeline. Invalid JSON, missing fields, missing files, and prediction errors return JSON error responses without exposing stack traces.

## Frontend

The frontend is the existing `index.html`, `style.css`, and `script.js` application. It uses Leaflet for mapping and Chart.js for analytics. CSV-based accident loading and filters remain in place, while the Flask API supplies summary data, hotspots, recommendations, and predictions.

Do not open the frontend using `file://`. Browser API requests require an HTTP server.

## Technology Stack

- HTML
- CSS
- JavaScript
- Chart.js
- Leaflet.js
- Python
- Pandas
- NumPy
- Scikit-learn
- Joblib
- Flask
- Flask-CORS
- Matplotlib
- Seaborn

## Project Structure

```text
RoadSafe Analytics/
├── api/
│   ├── app.py
│   └── requirements.txt
├── assets/
│   ├── class_distribution_analysis.txt
│   ├── hotspot_analysis_report.txt
│   ├── hotspot_clusters.png
│   ├── ml_evaluation_report.txt
│   ├── model_comparison.txt
│   ├── model_metrics_comparison.png
│   ├── recommendation_report.txt
│   ├── recommendation_summary.png
│   ├── risk_confusion_matrix.png
│   ├── risk_model_metrics.txt
│   ├── severity_confusion_matrix.png
│   └── severity_model_metrics.txt
├── data/
│   ├── accidents.csv
│   ├── processed_accidents.csv
│   ├── hotspots.csv
│   └── recommendations.csv
├── ml/
│   ├── preprocessing.py
│   ├── train_severity_model.py
│   ├── predict_severity.py
│   ├── train_risk_model.py
│   ├── predict_risk.py
│   ├── evaluate_models.py
│   ├── hotspot_analysis.py
│   ├── recommendation_engine.py
│   ├── severity_model.pkl
│   └── risk_model.pkl
├── index.html
├── style.css
├── script.js
├── requirements.txt
└── README.md
```

`Power_BI/` is also present in the workspace as an existing project directory.

## Installation

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install -r api\requirements.txt
```

The second install command is safe for the API-specific dependency list. The root requirements file contains the broader data-science and visualization dependencies.

## How To Run

From the project root:

```powershell
.venv\Scripts\activate
python api\app.py
```

Keep the API terminal running. Then open `index.html` in VS Code, right-click it,
and choose **Open with Live Server**. The frontend should open at a URL similar to:

```text
http://127.0.0.1:5500/index.html
```

Do not double-click `index.html` and do not open it through a `file://` URL. The
browser must load the relative CSV path `data/accidents.csv` over HTTP.

If Live Server is not installed, serve the frontend over HTTP from a second terminal:

```powershell
python -m http.server 5500
```

Then open `http://127.0.0.1:5500/index.html`.

The Flask API remains available locally at `http://127.0.0.1:5000`. The frontend
uses the centralized configuration at the top of `script.js`: local HTTP pages
automatically use the local API, while a public deployment requires setting
`PUBLIC_BACKEND_URL` to the HTTPS URL of the separately hosted Flask backend.

For a Render-style deployment with the repository root as the service root, use:

```text
Build command: pip install -r api/requirements.txt
Start command: gunicorn --chdir api app:app
```

Set the backend environment variable `FRONTEND_ORIGIN` to the exact public
frontend origin, such as `https://username.github.io`. For local development,
the API allows the local Live Server origins listed in `api/app.py`.

The full rebuild sequence, when needed, is:

```powershell
python ml\preprocessing.py
python ml\train_severity_model.py
python ml\train_risk_model.py
python ml\evaluate_models.py
python ml\hotspot_analysis.py
python ml\recommendation_engine.py
```

These commands regenerate outputs and retrain models, so they are not required for normal use of the saved project artifacts.

## Limitations

- The data is historical and CSV-based, not real-time.
- The Risk model has low recall for the Critical class.
- The severity model has uneven class-level performance.
- Visibility was completely missing in the cleaned dataset and was skipped during relevant model training; it has not been fixed.
- Festival data is mostly missing.
- DBSCAN hotspots are sensitive to coordinate density and parameter choices.
- Recommendations are decision-support suggestions, not guaranteed interventions.
- The current API is a local Flask development server.

## Future Improvements

- Repair and validate visibility data.
- Preserve accident-level cluster assignments for more specific recommendations.
- Improve minority-class Critical risk detection with additional representative data and careful validation.
- Add cross-validation, calibration, and monitoring before operational use.
- Add authentication, production WSGI hosting, and rate limiting to the API.

## Deployment Note

The static frontend can be deployed with GitHub Pages. Normal GitHub Pages hosting cannot run the Flask API, Python models, or server-side prediction endpoints.

For full functionality, host the Flask API separately on a Python-capable service,
set `PUBLIC_BACKEND_URL` in `script.js` to that HTTPS backend URL before publishing,
and deploy the static frontend to GitHub Pages or another HTTPS static host. A
static-only GitHub Pages deployment can still display CSV-backed analytics, but
API-backed summaries, hotspots, recommendations, and ML predictions require the
separately hosted backend. Do not use `127.0.0.1` or `localhost` for a public
deployment.
