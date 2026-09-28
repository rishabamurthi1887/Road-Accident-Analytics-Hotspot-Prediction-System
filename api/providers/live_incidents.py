from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class ProviderUnavailableError(RuntimeError):
    """Raised when a configured provider cannot return a usable response."""


def _fetch_json(url: str, params: dict[str, str], timeout: int = 15) -> Any:
    request = Request(
        f"{url}?{urlencode(params)}",
        headers={"Accept": "application/json", "User-Agent": "RoadSafe-Analytics/1.0"},
    )
    with urlopen(request, timeout=timeout) as response:
        import json

        return json.loads(response.read().decode("utf-8"))


def _tomtom_category(value: Any) -> str:
    categories = {
        1: "Accident",
        2: "Fog",
        3: "Dangerous Conditions",
        4: "Rain",
        5: "Ice",
        6: "Jam",
        7: "Lane Closed",
        8: "Road Closed",
        9: "Road Works",
        10: "Wind",
        11: "Flooding",
        14: "Broken Down Vehicle",
    }
    return categories.get(int(value), "Traffic Incident") if str(value).isdigit() else "Traffic Incident"


def fetch_tomtom_incidents(
    latitude: float,
    longitude: float,
    radius_km: float,
    api_key: str,
) -> dict[str, Any]:
    lat_delta = radius_km / 111.0
    lon_delta = radius_km / max(111.0 * math.cos(math.radians(latitude)), 1.0)
    bbox = ",".join(
        f"{value:.6f}"
        for value in (
            longitude - lon_delta,
            latitude - lat_delta,
            longitude + lon_delta,
            latitude + lat_delta,
        )
    )
    payload = _fetch_json(
        "https://api.tomtom.com/traffic/services/5/incidentDetails",
        {
            "bbox": bbox,
            "fields": "{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description,startTime,endTime},from,to,roadNumbers}}}",
            "language": "en-GB",
            "timeValidityFilter": "present",
            "key": api_key,
        },
    )
    incidents = []
    for item in payload.get("incidents", []) if isinstance(payload, dict) else []:
        properties = item.get("properties") or {}
        geometry = item.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if geometry.get("type") == "Point":
            point = coordinates
        else:
            point = coordinates[0] if coordinates and isinstance(coordinates[0], list) else []
        if len(point) < 2:
            continue
        events = properties.get("events") or []
        event = events[0] if events else {}
        incidents.append(
            {
                "id": str(item.get("id") or f"tomtom-{len(incidents)}"),
                "type": _tomtom_category(properties.get("iconCategory")),
                "description": event.get("description") or "Traffic incident reported by TomTom.",
                "latitude": float(point[1]),
                "longitude": float(point[0]),
                "road_name": properties.get("from") or properties.get("to"),
                "start_time": event.get("startTime"),
                "end_time": event.get("endTime"),
                "severity": str(properties.get("magnitudeOfDelay") or "unknown"),
                "delay": properties.get("magnitudeOfDelay"),
                "source": "TomTom",
            }
        )
    return {
        "status": "ok",
        "source": "live_provider",
        "provider": "tomtom",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "incidents": incidents,
    }
