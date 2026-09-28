const API_BASE_URL = "https://roadsafe-analytics-api.onrender.com";

console.log("RoadSafe Analytics started");

function applyTheme(theme) {
    const selectedTheme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = selectedTheme;
    localStorage.setItem("roadSafeTheme", selectedTheme);
    const toggle = document.getElementById("themeToggle");
    if (!toggle) return;
    const lightMode = selectedTheme === "light";
    toggle.setAttribute("aria-pressed", String(lightMode));
    toggle.setAttribute("aria-label", lightMode ? "Switch to dark mode" : "Switch to light mode");
    toggle.querySelector("span:first-child").textContent = lightMode ? "☀" : "☾";
    toggle.querySelector(".theme-toggle__label").textContent = lightMode ? "Light" : "Dark";
    if (typeof refreshChartTheme === "function") refreshChartTheme();
}

applyTheme(localStorage.getItem("roadSafeTheme") || "dark");
document.getElementById("themeToggle")?.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});

const LOCATION_API_BASE = (() => {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        return "";
    }
    return "https://roadsafe-analytics-api.onrender.com";
})();

let currentSelectedLocation = null;

function escapeApiText(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function fetchLocationSearch(query) {
    const trimmedQuery = String(query || "").trim();
    if (!trimmedQuery) return null;
    const endpoint = `${LOCATION_API_BASE}/api/location/search?query=${encodeURIComponent(trimmedQuery)}`;
    const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!response.ok) {
        throw new Error("Location search failed");
    }
    return response.json();
}

async function analyzeLocationProfile(lat, lon, query = "", radiusKm = 5) {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon), radius_km: String(radiusKm) });
    if (query) params.set("query", query);
    const endpoint = `${LOCATION_API_BASE}/api/location/intelligence?${params.toString()}`;
    const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!response.ok) {
        throw new Error("Location intelligence request failed");
    }
    const data = await response.json();
    currentSelectedLocation = data;
    updateLocationInsightCard(data);
    return data;
}

function ensureLocationInsightCard() {
    const existingCard = document.getElementById("locationInsightCard");
    if (existingCard) return existingCard;
    const mapElement = document.getElementById("map");
    if (!mapElement) return null;
    const card = document.createElement("div");
    card.id = "locationInsightCard";
    card.className = "location-insight-card";
    mapElement.appendChild(card);
    return card;
}

function updateLocationInsightCard(payload) {
    const card = ensureLocationInsightCard();
    if (!card) return;
    const location = payload?.resolved_location || payload?.location || {};
    const localTime = payload?.local_time || {};
    const historical = payload?.historical || {};
    const live = payload?.live || {};
    const placeLabel = [location.city, location.state, location.country].filter(Boolean).join(", ") || location.display_name || "Selected location";
    const statusText = historical?.status === "no_data" ? "No historical records within radius" : historical?.status === "ok" ? `${historical.accident_count.toLocaleString()} historical incidents within ${payload?.recommended_radius_km || 5} km` : historical?.message || "Historical data unavailable";
    const liveAvailable = live.status === "ok" && Array.isArray(live.incidents);
    card.innerHTML = `
        <div class="location-insight-card__eyebrow">Location intelligence</div>
        <div class="location-insight-card__title">${escapeApiText(placeLabel)}</div>
        <div class="location-insight-card__time">${escapeApiText(localTime.time || "--:--:--")} · ${escapeApiText(localTime.day || "--")} · ${escapeApiText(localTime.timezone || "UTC")}</div>
        <div class="location-insight-card__section">
            <span class="location-insight-card__label">Historical</span>
            <strong>${escapeApiText(statusText)}</strong>
        </div>
        <div class="location-insight-card__section">
            <span class="location-insight-card__label">${liveAvailable ? "Live incidents" : "Live data"}</span>
            <strong>${escapeApiText(liveAvailable ? `${live.incidents.length} incidents reported` : "Unavailable — no incident provider configured")}</strong>
        </div>
    `;
}

function getRowRisk(row) {
    return String(row["Risk Category"] || row.risk_category || "low")
        .toLowerCase()
        .trim();
}

function normalizeMapValue(value) {
    return String(value ?? "").trim().toLowerCase();
}

function getRowYear(row) {
    return normalizeMapValue(row.year || row.Year);
}


// ==========================================
// LOAD CSV DATA
// ==========================================

fetch("data/accidents.csv")
    .then(response => {
        if (!response.ok) throw new Error("Could not load accidents.csv");
        return response.text();
    })
    .then(csv => {
        const lines = csv.trim().split("\n");
        const headers = lines[0].split(",");
        const data = lines.slice(1).map(line => {
            const values = line.split(",");
            return Object.fromEntries(headers.map((header, index) => [header.trim(), (values[index] || "").trim()]));
        });
        allAccidentData = data;
        updateDashboard(
            data.length,
            data.filter(row => String(row.accident_severity).toLowerCase() === "fatal").length,
            data.reduce((sum, row) => sum + Number(row.casualties || 0), 0),
            data.filter(row => getRowRisk(row) === "critical").length
        );
        updateRiskProfile(data);
        createAnalyticsCharts(data);
        updateSafetyInsights(data);
        initializePredictionControls(data);
        setSystemStatus("dataset", "ready", `${data.length.toLocaleString()} records available`);
        initializeCityProfile(data);
        initializeSafetyReport(data);
        initializeAccidentExplorer(data);
    })
    .catch(error => console.error("Error loading CSV:", error));

function updateDashboard(total, fatal, casualties, critical) {
    const values = { totalAccidents: total, fatalAccidents: fatal, totalCasualties: casualties, criticalLocations: critical };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = Number(value).toLocaleString();
    });
}

const explorerCharts = {};
let explorerRows = [];

function explorerDisplay(value) {
    const text = String(value ?? "").trim();
    if (!text) return "Unknown";
    return text.replace(/\b\w/g, character => character.toUpperCase());
}

function explorerHour(value) {
    const hour = Number(value);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return "Unknown";
    const normalized = Math.trunc(hour);
    return `${normalized % 12 || 12}:00 ${normalized < 12 ? "AM" : "PM"}`;
}

function explorerField(row, field) {
    const aliases = {
        year: ["year", "Year"],
        month: ["month", "Month Number"],
        day: ["day_of_week", "Day of Week"],
        weekend: ["is_weekend", "Weekend"],
        signal: ["traffic_signal", "Traffic Signal"],
        severity: ["accident_severity", "severity"],
        risk: ["Risk Category", "risk_category"],
        road: ["road_type", "Road Type"]
    };
    const candidates = aliases[field] || [field];
    for (const candidate of candidates) {
        if (row[candidate] !== undefined && String(row[candidate]).trim() !== "") return row[candidate];
    }
    return "";
}

function explorerCount(rows, field, limit = 8) {
    const counts = new Map();
    rows.forEach(row => {
        const value = String(explorerField(row, field) || "Unknown").trim();
        counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function renderExplorerChart(id, rows, field, type = "bar") {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart !== "function") return;
    if (explorerCharts[id]) explorerCharts[id].destroy();
    const values = explorerCount(rows, field);
    explorerCharts[id] = new Chart(canvas, {
        type,
        data: {
            labels: values.map(([label]) => explorerDisplay(label)),
            datasets: [{ data: values.map(([, count]) => count), backgroundColor: ["#4DA3FF", "#8C7BFF", "#34C759", "#FFD60A", "#FF9500", "#FF3B30", "#70C4FF", "#B6A9FF"], borderWidth: 0 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: type === "doughnut", labels: { color: "rgba(245,248,255,.75)" } } },
            scales: type === "bar" ? { x: { ticks: { color: "rgba(245,248,255,.65)" }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: "rgba(245,248,255,.65)", precision: 0 }, grid: { color: "rgba(255,255,255,.08)" } } } : {}
        }
    });
}

function updateAccidentExplorer(rows) {
    explorerRows = rows;
    const count = document.getElementById("explorerResultCount");
    const description = document.getElementById("explorerResultDescription");
    if (count) count.textContent = `${rows.length.toLocaleString()} record${rows.length === 1 ? "" : "s"}`;
    if (description) description.textContent = rows.length ? "Matching historical accident records" : "No records match the selected filters";

    renderExplorerChart("explorerSeverityChart", rows, "severity", "doughnut");
    renderExplorerChart("explorerCauseChart", rows, "cause");
    renderExplorerChart("explorerWeatherChart", rows, "weather");
    renderExplorerChart("explorerHourChart", rows.map(row => ({ ...row, hour: Math.trunc(Number(row.hour)) })), "hour");

    const body = document.getElementById("explorerTableBody");
    if (!body) return;
    const visibleRows = rows.slice(0, 100);
    body.innerHTML = visibleRows.length ? visibleRows.map(row => `
        <tr>
            <td>${escapeApiText(row.accident_id || "—")}</td>
            <td>${escapeApiText([row.city, row.state].filter(Boolean).map(explorerDisplay).join(", ") || "Unknown")}</td>
            <td>${escapeApiText(row.time || explorerHour(row.hour))}</td>
            <td>${escapeApiText(explorerDisplay(explorerField(row, "road")))}</td>
            <td>${escapeApiText(explorerDisplay(row.weather))}</td>
            <td>${escapeApiText(explorerDisplay(explorerField(row, "severity")))}</td>
            <td>${escapeApiText(explorerDisplay(explorerField(row, "risk")))}</td>
            <td>${escapeApiText(row.casualties || "0")}</td>
        </tr>
    `).join("") : '<tr><td colspan="8">No accident records match these filters.</td></tr>';
    if (rows.length > visibleRows.length) {
        body.insertAdjacentHTML("beforeend", `<tr><td colspan="8">Showing the first 100 of ${rows.length.toLocaleString()} matching records.</td></tr>`);
    }
}

function initializeAccidentExplorer(data) {
    const container = document.getElementById("explorerFilters");
    if (!container || container.dataset.ready === "true") return;
    container.dataset.ready = "true";
    const configs = [
        ["state", "State"], ["city", "City"], ["cause", "Cause"], ["severity", "Severity"],
        ["risk", "Risk Category"], ["road", "Road Type"], ["weather", "Weather"],
        ["traffic_density", "Traffic Density"], ["year", "Year"], ["month", "Month"],
        ["day", "Day of Week"], ["weekend", "Weekend"], ["festival", "Festival"],
        ["signal", "Traffic Signal"], ["vehicles_involved", "Vehicles Involved"]
    ];
    const availableVehicleField = ["vehicle_type", "vehicle_types_involved"].find(field => data.some(row => String(row[field] || "").trim()));
    const vehicleNote = document.getElementById("explorerVehicleNote");
    if (vehicleNote) vehicleNote.hidden = Boolean(availableVehicleField);
    if (availableVehicleField) configs.splice(2, 0, [availableVehicleField, "Vehicle Type"]);

    configs.forEach(([field, label]) => {
        const values = [...new Set(data.map(row => String(explorerField(row, field) || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const wrapper = document.createElement("label");
        wrapper.textContent = label;
        if (field === "vehicles_involved") {
            const input = document.createElement("input");
            input.type = "number";
            input.min = "0";
            input.placeholder = "Any number";
            input.dataset.explorerField = field;
            wrapper.appendChild(input);
        } else {
            const select = document.createElement("select");
            select.dataset.explorerField = field;
            select.innerHTML = `<option value="">All ${escapeApiText(label.toLowerCase())}</option>${values.map(value => `<option value="${escapeApiText(value)}">${escapeApiText(explorerDisplay(value))}</option>`).join("")}`;
            wrapper.appendChild(select);
        }
        container.appendChild(wrapper);
    });

    const apply = () => {
        const values = {};
        container.querySelectorAll("[data-explorer-field]").forEach(control => {
            values[control.dataset.explorerField] = String(control.value || "").trim().toLowerCase();
        });
        const filtered = data.filter(row => Object.entries(values).every(([field, value]) => {
            if (!value) return true;
            const actual = String(explorerField(row, field)).trim().toLowerCase();
            return actual === value;
        }));
        updateAccidentExplorer(filtered);
        if (typeof displayAccidentMarkers === "function" && riskMap) displayAccidentMarkers(filtered);
    };
    document.getElementById("explorerApplyBtn")?.addEventListener("click", apply);
    document.getElementById("explorerResetBtn")?.addEventListener("click", () => {
        container.querySelectorAll("[data-explorer-field]").forEach(control => { control.value = ""; });
        updateAccidentExplorer(data);
        if (typeof displayAccidentMarkers === "function" && riskMap) displayAccidentMarkers(data);
    });
    updateAccidentExplorer(data);
}

function updateRiskProfile(data) {
    const rowsElement = document.getElementById("riskProfileRows");
    const totalElement = document.getElementById("riskProfileTotal");
    if (!rowsElement || !totalElement) return;

    const categories = [
        { key: "low", label: "Low", className: "low" },
        { key: "moderate", label: "Moderate", className: "moderate" },
        { key: "high", label: "High", className: "high" },
        { key: "critical", label: "Critical", className: "critical" }
    ];
    const counts = categories.reduce((result, category) => {
        result[category.key] = data.filter(row => getRowRisk(row) === category.key).length;
        return result;
    }, {});
    const total = data.length;
    const maximum = Math.max(...Object.values(counts), 1);
    totalElement.textContent = `${total.toLocaleString()} records`;
    rowsElement.innerHTML = categories.map(category => {
        const count = counts[category.key];
        const percentage = total ? (count / total) * 100 : 0;
        return `
            <div class="risk-profile__row">
                <span class="risk-profile__label"><i class="risk-profile__dot risk-profile__dot--${category.className}"></i>${category.label}</span>
                <div class="risk-profile__track"><span class="risk-profile__bar risk-profile__bar--${category.className}" style="width: ${count / maximum * 100}%"></span></div>
                <span class="risk-profile__value" title="${category.label}: ${count.toLocaleString()} accidents, ${percentage.toFixed(1)}% of total">${count.toLocaleString()} <small>${percentage.toFixed(1)}%</small></span>
            </div>
        `;
    }).join("");
}

function makeChart(id, type, labels, datasets, options = {}) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === "undefined") return;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    const chartText = getComputedStyle(document.documentElement).getPropertyValue("--text-secondary").trim() || "#91a2b6";
    const chartMuted = getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim() || "#91a2b6";
    const chartGrid = getComputedStyle(document.documentElement).getPropertyValue("--border-visible").trim() || "rgba(145, 171, 201, .16)";
    const defaults = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
            legend: { labels: { color: chartText, usePointStyle: true, boxWidth: 8 } },
            tooltip: { callbacks: { label: context => `${context.dataset.label || "Accidents"}: ${Number(context.raw || 0).toLocaleString()}` } }
        },
        scales: {
            x: { ticks: { color: chartMuted, maxRotation: 0, autoSkip: true }, grid: { color: chartGrid } },
            y: { beginAtZero: true, ticks: { color: chartMuted }, grid: { color: chartGrid } }
        }
    };
    const mergedOptions = { ...defaults, ...options, plugins: { ...defaults.plugins, ...options.plugins }, scales: { ...defaults.scales, ...options.scales } };
    return new Chart(canvas, { type, data: { labels, datasets }, options: mergedOptions });
}

function refreshChartTheme() {
    if (typeof Chart === "undefined" || !Chart.instances) return;
    const chartText = getComputedStyle(document.documentElement).getPropertyValue("--text-secondary").trim();
    const chartMuted = getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim();
    const chartGrid = getComputedStyle(document.documentElement).getPropertyValue("--border-visible").trim();
    Object.values(Chart.instances).forEach(chart => {
        const scales = chart.options.scales || {};
        ["x", "y"].forEach(axis => {
            if (!scales[axis]) return;
            if (scales[axis].ticks) scales[axis].ticks.color = chartMuted;
            if (scales[axis].grid) scales[axis].grid.color = chartGrid;
        });
        if (chart.options.plugins?.legend?.labels) chart.options.plugins.legend.labels.color = chartText;
        chart.update("none");
    });
}

function createAnalyticsCharts(data) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const titleCase = value => String(value || "").replace(/\b\w/g, character => character.toUpperCase());
    const displayLabel = value => titleCase(String(value).replace(/_/g, " "));
    const monthOf = row => {
        const parsed = new Date(row.date);
        return isNaN(parsed) ? "" : parsed.toLocaleString("en-US", { month: "short" });
    };
    const countBy = field => data.reduce((counts, row) => { const value = String(row[field] || "").trim(); if (value) counts[value] = (counts[value] || 0) + 1; return counts; }, {});
    const sortedEntries = field => Object.entries(countBy(field)).sort((a, b) => b[1] - a[1]);
    const monthCounts = data.reduce((counts, row) => { const month = monthOf(row); if (month) counts[month] = (counts[month] || 0) + 1; return counts; }, {});
    const topStates = sortedEntries("state").slice(0, 10);
    makeChart("accidentsByStateChart", "bar", topStates.map(item => displayLabel(item[0])), [{ label: "Accidents", data: topStates.map(item => item[1]), backgroundColor: "rgba(77, 163, 255, .72)", borderRadius: 4 }], { indexAxis: "y", plugins: { legend: { display: false } } });
    makeChart("monthlyAccidentChart", "line", months, [{ label: "Accidents", data: months.map(month => monthCounts[month] || 0), tension: 0.35, borderColor: "#4DA3FF", backgroundColor: "rgba(77, 163, 255, .16)", fill: true, pointRadius: 2 }], { plugins: { legend: { display: false } } });

    const yearCounts = data.reduce((counts, row) => { const year = String(row.year || row.Year || "").trim(); if (year) counts[year] = (counts[year] || 0) + 1; return counts; }, {});
    const years = Object.keys(yearCounts).sort((a, b) => Number(a) - Number(b));
    makeChart("yearlyAccidentChart", "line", years, [{ label: "Accidents", data: years.map(year => yearCounts[year]), tension: 0.35, borderColor: "#8C7BFF", backgroundColor: "rgba(140, 123, 255, .15)", fill: true, pointRadius: 3 }], { plugins: { legend: { display: false } } });

    const stateCounts = {};
    data.forEach(row => { const month = monthOf(row); const state = String(row.state || "").trim(); if (month && state) { stateCounts[state] ||= {}; stateCounts[state][month] = (stateCounts[state][month] || 0) + 1; } });
    makeChart("monthlyAccidentsByStateChart", "bar", months, Object.keys(stateCounts).sort().map(state => ({ label: state, data: months.map(month => stateCounts[state][month] || 0), stack: "states" })), { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }, plugins: { legend: { position: "bottom" } } });
    const severity = countBy("accident_severity");
    makeChart("severityDistributionChart", "doughnut", Object.keys(severity).map(displayLabel), [{ label: "Accidents", data: Object.values(severity), backgroundColor: ["#34C759", "#FF9500", "#FF3B30"], borderWidth: 0 }], { plugins: { legend: { position: "bottom" } }, scales: {} });
    const causes = sortedEntries("cause").slice(0, 7);
    makeChart("topAccidentCausesChart", "bar", causes.map(item => displayLabel(item[0])), [{ label: "Accidents", data: causes.map(item => item[1]), backgroundColor: "rgba(255, 149, 0, .72)", borderRadius: 4 }], { indexAxis: "y", plugins: { legend: { display: false } } });
    const roads = countBy("road_type");
    makeChart("roadTypeAnalysisChart", "bar", Object.keys(roads).map(displayLabel), [{ label: "Accidents", data: Object.values(roads), backgroundColor: "rgba(52, 199, 89, .72)", borderRadius: 4 }], { plugins: { legend: { display: false } } });
    const traffic = countBy("traffic_density");
    makeChart("trafficDensityChart", "bar", Object.keys(traffic).map(displayLabel), [{ label: "Accidents", data: Object.values(traffic), backgroundColor: "rgba(77, 163, 255, .62)", borderRadius: 4 }], { plugins: { legend: { display: false } } });
    const weather = sortedEntries("weather");
    makeChart("weatherAnalysisChart", "bar", weather.map(item => displayLabel(item[0])), [{ label: "Accidents", data: weather.map(item => item[1]), backgroundColor: "rgba(140, 123, 255, .68)", borderRadius: 4 }], { plugins: { legend: { display: false } } });

    const hourCounts = data.reduce((counts, row) => { const hour = Number(row.hour); if (Number.isFinite(hour) && hour >= 0 && hour <= 23) counts[hour] = (counts[hour] || 0) + 1; return counts; }, {});
    const hourLabel = hour => { const suffix = hour >= 12 ? "PM" : "AM"; const displayHour = hour % 12 || 12; return `${displayHour} ${suffix}`; };
    makeChart("hourAnalysisChart", "bar", Array.from({ length: 24 }, (_, hour) => hourLabel(hour)), [{ label: "Accidents", data: Array.from({ length: 24 }, (_, hour) => hourCounts[hour] || 0), backgroundColor: "rgba(255, 59, 48, .62)", borderRadius: 3 }], { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 12 } } } });

    const risks = { Low: 0, Moderate: 0, High: 0, Critical: 0 };
    data.forEach(row => { const risk = titleCase(getRowRisk(row)); if (risk in risks) risks[risk] += 1; });
    makeChart("riskDistributionChart", "doughnut", Object.keys(risks), [{ label: "Accidents", data: Object.values(risks), backgroundColor: ["#34C759", "#FFD60A", "#FF9500", "#FF3B30"], borderWidth: 0 }], { plugins: { legend: { position: "bottom" } }, scales: {} });
}

function updateSafetyInsights(data) {
    const titleCase = value => String(value || "").replace(/\b\w/g, character => character.toUpperCase());
    const countValue = field => titleCase(Object.entries(data.reduce((counts, row) => { const value = String(row[field] || "").trim(); if (value) counts[value] = (counts[value] || 0) + 1; return counts; }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] || "No data");
    const hours = data.reduce((counts, row) => { const hour = Number(row.hour); if (Number.isFinite(hour)) counts[hour] = (counts[hour] || 0) + 1; return counts; }, {});
    const peak = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
    document.getElementById("majorAccidentCause").textContent = countValue("cause");
    document.getElementById("dangerousRoadType").textContent = countValue("road_type");
    if (peak) {
        const hour = Number(peak[0]);
        const period = hour >= 12 ? "PM" : "AM";
        const displayHour = hour % 12 || 12;
        document.getElementById("peakAccidentPeriod").textContent = `${displayHour}:00 ${period}`;
    } else {
        document.getElementById("peakAccidentPeriod").textContent = "No data";
    }

}

function setSystemStatus(key, state, detail) {
    const item = document.querySelector(`[data-status-key="${key}"]`);
    if (!item) return;
    item.dataset.state = state;
    const label = item.querySelector("small");
    if (label) label.textContent = detail;
}

function initializePredictionControls(data) {
    const form = document.getElementById("predictionForm");
    if (!form || form.dataset.controlsReady === "true") return;
    form.dataset.controlsReady = "true";
    const fields = [
        ["weather", "Weather"], ["road_type", "Road type"], ["traffic_density", "Traffic density"],
        ["cause", "Cause"], ["day_of_week", "Day of week"], ["festival", "Festival"]
    ];
    fields.forEach(([field, label]) => {
        const input = form.elements[field];
        if (!input || input.tagName === "SELECT") return;
        const values = [...new Set(data.map(row => String(row[field] || "").trim()).filter(Boolean))].sort();
        if (!values.length) return;
        const select = document.createElement("select");
        select.name = field;
        select.setAttribute("aria-label", label);
        select.innerHTML = values.map(value => `<option value="${escapeApiText(value)}">${escapeApiText(value.replace(/\b\w/g, character => character.toUpperCase()))}</option>`).join("");
        select.value = String(input.value || "").trim();
        if (!select.value) select.selectedIndex = 0;
        input.replaceWith(select);
    });
}

function validatePredictionPayload(payload, kind) {
    const errors = [];
    const numberChecks = [
        ["hour", 0, 23, "Please enter a valid hour between 0 and 23."],
        ["Month Number", 1, 12, "Please enter a valid month between 1 and 12."],
        ["latitude", -90, 90, "Please enter a valid latitude between -90 and 90."],
        ["longitude", -180, 180, "Please enter a valid longitude between -180 and 180."]
    ];
    numberChecks.forEach(([field, min, max, message]) => {
        if (kind === "severity" && ["latitude", "longitude", "Month Number"].includes(field)) return;
        const value = Number(payload[field]);
        if (!Number.isFinite(value) || value < min || value > max) errors.push(message);
    });
    if (!Number.isInteger(Number(payload.lanes)) || Number(payload.lanes) <= 0) errors.push("Please enter a positive number of lanes.");
    if (!Number.isInteger(Number(payload.vehicles_involved)) || Number(payload.vehicles_involved) <= 0) errors.push("Please enter a positive number of vehicles involved.");
    if (!Number.isFinite(Number(payload.temperature))) errors.push("Please enter a valid temperature.");
    return errors;
}

async function initializeSystemStatus() {
    setSystemStatus("frontend", "ready", "Connected");
    setSystemStatus("dataset", allAccidentData.length ? "ready" : "error", allAccidentData.length ? `${allAccidentData.length.toLocaleString()} records available` : "Unavailable");
    setSystemStatus("api", "loading", "Checking…");
    setSystemStatus("risk-model", "loading", "Checking…");
    setSystemStatus("severity-model", "loading", "Checking…");
    setSystemStatus("live-data", "error", "Not configured");
    try {
        const health = await fetchApiJson("/health");
        const artifacts = health.artifacts || {};
        setSystemStatus("api", "ready", health.status === "ok" ? "Connected" : "Degraded");
        setSystemStatus("risk-model", artifacts.risk_model ? "ready" : "error", artifacts.risk_model ? "Ready" : "Unavailable");
        setSystemStatus("severity-model", artifacts.severity_model ? "ready" : "error", artifacts.severity_model ? "Ready" : "Unavailable");
        setSystemStatus("live-data", health.live_data?.available ? "ready" : "error", health.live_data?.available ? "Available" : health.live_data?.configured ? "Provider not enabled" : "Not configured");
        const message = document.getElementById("systemStatusMessage");
        if (message) message.textContent = health.status === "ok" ? "All connected services and project artifacts are available." : "The API is connected, but one or more project artifacts are unavailable.";
    } catch (error) {
        setSystemStatus("api", "error", "Unavailable");
        setSystemStatus("risk-model", "error", "Unavailable");
        setSystemStatus("severity-model", "error", "Unavailable");
        setSystemStatus("live-data", "error", "Not configured");
        const message = document.getElementById("systemStatusMessage");
        if (message) message.textContent = "The analytics interface remains available, but API-powered features may be unavailable.";
        console.error("System status check failed:", error);
    }
}

function cityProfileTitleCase(value) {
    return String(value || "").replace(/\b\w/g, character => character.toUpperCase()).replace(/_/g, " ");
}

function profileHourLabel(hour) {
    const numericHour = Number(hour);
    const suffix = numericHour >= 12 ? "PM" : "AM";
    return `${numericHour % 12 || 12} ${suffix}`;
}

function profileCountBy(rows, field) {
    return rows.reduce((counts, row) => {
        const value = String(row[field] || "").trim();
        if (value) counts[value] = (counts[value] || 0) + 1;
        return counts;
    }, {});
}

function profileSortedEntries(rows, field, limit = 6) {
    return Object.entries(profileCountBy(rows, field)).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function updateCityProfileOptions(data) {
    const stateSelect = document.getElementById("profileStateSelect");
    if (!stateSelect) return;
    const states = [...new Set(data.map(row => String(row.state || "").trim()).filter(Boolean))].sort();
    stateSelect.innerHTML = `<option value="">Select state</option>${states.map(state => `<option value="${escapeApiText(state)}">${escapeApiText(state)}</option>`).join("")}`;
}

function updateCityProfile() {
    const state = document.getElementById("profileStateSelect")?.value || "";
    const city = document.getElementById("profileCitySelect")?.value || "";
    const empty = document.getElementById("cityProfileEmpty");
    const content = document.getElementById("cityProfileContent");
    if (!state || !city || !allAccidentData.length) {
        if (empty) { empty.hidden = false; empty.textContent = "Select a state and city to view the profile."; }
        if (content) content.hidden = true;
        return;
    }

    const rows = allAccidentData.filter(row => normalizeMapValue(row.state) === normalizeMapValue(state) && normalizeMapValue(row.city) === normalizeMapValue(city));
    if (!rows.length) {
        if (empty) { empty.hidden = false; empty.textContent = "No recorded accidents found for this selection."; }
        if (content) content.hidden = true;
        return;
    }

    const severity = profileCountBy(rows, "accident_severity");
    const majorRows = rows.filter(row => String(row.accident_severity || "").trim().toLowerCase() === "major");
    const risks = { low: 0, moderate: 0, high: 0, critical: 0 };
    rows.forEach(row => { const risk = getRowRisk(row); if (risk in risks) risks[risk] += 1; });
    const riskScores = rows.map(row => Number(row.risk_score)).filter(Number.isFinite);
    const matchingHotspots = apiHotspots.filter(hotspot => normalizeMapValue(hotspot.state) === normalizeMapValue(state) && normalizeMapValue(hotspot.city) === normalizeMapValue(city));
    const profileValues = {
        profileTotalAccidents: rows.length,
        profileFatalAccidents: severity.fatal || 0,
        profileMajorAccidents: severity.major || 0,
        profileMinorAccidents: severity.minor || 0,
        profileAverageRisk: riskScores.length ? (riskScores.reduce((sum, value) => sum + value, 0) / riskScores.length).toFixed(3) : "Unavailable",
        profileHotspotCount: apiHotspots.length ? matchingHotspots.length : "Unavailable"
    };
    Object.entries(profileValues).forEach(([id, value]) => { const element = document.getElementById(id); if (element) element.textContent = typeof value === "number" ? value.toLocaleString() : value; });
    document.getElementById("cityProfileName").textContent = `${city}, ${state}`;
    empty.hidden = true;
    content.hidden = false;

    const profileHours = rows.reduce((counts, row) => { const hour = Number(row.hour); if (Number.isFinite(hour) && hour >= 0 && hour <= 23) counts[hour] = (counts[hour] || 0) + 1; return counts; }, {});
    const chartOptions = { plugins: { legend: { display: false } } };
    const majorCauses = profileSortedEntries(majorRows, "cause");
    makeChart("profileCausesChart", "bar", majorCauses.map(item => cityProfileTitleCase(item[0])), [{ label: "Major accidents", data: majorCauses.map(item => item[1]), backgroundColor: "rgba(255, 149, 0, .72)", borderRadius: 4 }], { ...chartOptions, indexAxis: "y" });
    makeChart("profileRoadsChart", "bar", profileSortedEntries(rows, "road_type").map(item => cityProfileTitleCase(item[0])), [{ label: "Accidents", data: profileSortedEntries(rows, "road_type").map(item => item[1]), backgroundColor: "rgba(52, 199, 89, .72)", borderRadius: 4 }], chartOptions);
    makeChart("profileRiskChart", "doughnut", Object.keys(risks).map(cityProfileTitleCase), [{ label: "Accidents", data: Object.values(risks), backgroundColor: ["#34C759", "#FFD60A", "#FF9500", "#FF3B30"], borderWidth: 0 }], { plugins: { legend: { position: "bottom" } }, scales: {} });
    makeChart("profileHoursChart", "bar", Array.from({ length: 24 }, (_, hour) => profileHourLabel(hour)), [{ label: "Accidents", data: Array.from({ length: 24 }, (_, hour) => profileHours[hour] || 0), backgroundColor: "rgba(77, 163, 255, .7)", borderRadius: 3 }], { ...chartOptions, scales: { x: { ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 12 } } } });
}

function initializeCityProfile(data) {
    updateCityProfileOptions(data);
    const stateSelect = document.getElementById("profileStateSelect");
    const citySelect = document.getElementById("profileCitySelect");
    stateSelect?.addEventListener("change", event => {
        const state = event.currentTarget.value;
        const cities = [...new Set(allAccidentData.filter(row => !state || normalizeMapValue(row.state) === normalizeMapValue(state)).map(row => String(row.city || "").trim()).filter(Boolean))].sort();
        citySelect.innerHTML = `<option value="">Select city</option>${cities.map(city => `<option value="${escapeApiText(city)}">${escapeApiText(city)}</option>`).join("")}`;
        citySelect.disabled = !state;
        updateCityProfile();
    });
    citySelect?.addEventListener("change", updateCityProfile);
}

function reportOptionLabel(value) {
    return String(value || "").replace(/\b\w/g, character => character.toUpperCase());
}

function initializeSafetyReport(data) {
    const stateSelect = document.getElementById("reportStateSelect");
    const citySelect = document.getElementById("reportCitySelect");
    const yearSelect = document.getElementById("reportYearSelect");
    if (!stateSelect || !citySelect || !yearSelect) return;
    const states = [...new Set(data.map(row => String(row.state || "").trim()).filter(Boolean))].sort();
    const years = [...new Set(data.map(row => String(row.year || row.Year || "").trim()).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
    stateSelect.innerHTML = `<option value="">All states</option>${states.map(value => `<option value="${escapeApiText(value)}">${escapeApiText(value)}</option>`).join("")}`;
    yearSelect.innerHTML = `<option value="">All years</option>${years.map(value => `<option value="${escapeApiText(value)}">${escapeApiText(value)}</option>`).join("")}`;
    const refreshCities = () => {
        const state = stateSelect.value;
        const cities = [...new Set(data.filter(row => !state || normalizeMapValue(row.state) === normalizeMapValue(state)).map(row => String(row.city || "").trim()).filter(Boolean))].sort();
        citySelect.innerHTML = `<option value="">All cities</option>${cities.map(value => `<option value="${escapeApiText(value)}">${escapeApiText(value)}</option>`).join("")}`;
    };
    stateSelect.addEventListener("change", refreshCities);
    document.getElementById("generateReportBtn")?.addEventListener("click", generateSafetyReport);
    document.getElementById("printReportBtn")?.addEventListener("click", printSafetyReport);
}

function reportFilteredRows() {
    const state = document.getElementById("reportStateSelect")?.value || "";
    const city = document.getElementById("reportCitySelect")?.value || "";
    const year = document.getElementById("reportYearSelect")?.value || "";
    const risk = document.getElementById("reportRiskSelect")?.value || "";
    return allAccidentData.filter(row => (!state || normalizeMapValue(row.state) === normalizeMapValue(state)) && (!city || normalizeMapValue(row.city) === normalizeMapValue(city)) && (!year || getRowYear(row) === normalizeMapValue(year)) && (!risk || getRowRisk(row) === normalizeMapValue(risk)));
}

function reportCountBy(rows, field) {
    return rows.reduce((counts, row) => { const value = String(row[field] || "").trim(); if (value) counts[value] = (counts[value] || 0) + 1; return counts; }, {});
}

function reportTopList(rows, field, limit = 5) {
    return Object.entries(reportCountBy(rows, field)).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function reportList(items, formatter = value => value) {
    return items.length ? `<ul>${items.map(item => `<li>${escapeApiText(formatter(item))}</li>`).join("")}</ul>` : "<p>No recorded data available for this selection.</p>";
}

function reportHourText(rows) {
    const counts = rows.reduce((result, row) => { const hour = Number(row.hour); if (Number.isFinite(hour)) result[hour] = (result[hour] || 0) + 1; return result; }, {});
    const peak = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!peak) return "No recorded hour data available.";
    return `${profileHourLabel(Number(peak[0]))} (${Number(peak[1]).toLocaleString()} accidents)`;
}

function generateSafetyReport() {
    const rows = reportFilteredRows();
    const status = document.getElementById("reportStatus");
    const preview = document.getElementById("safetyReportPreview");
    const printButton = document.getElementById("printReportBtn");
    const state = document.getElementById("reportStateSelect")?.value || "All states";
    const city = document.getElementById("reportCitySelect")?.value || "All cities";
    const year = document.getElementById("reportYearSelect")?.value || "All years";
    const risk = document.getElementById("reportRiskSelect")?.value || "All categories";
    if (!rows.length) {
        status.textContent = "No recorded accidents match the selected filters.";
        preview.hidden = true;
        printButton.hidden = true;
        return;
    }
    const severity = reportCountBy(rows, "accident_severity");
    const risks = { low: 0, moderate: 0, high: 0, critical: 0 };
    rows.forEach(row => { const value = getRowRisk(row); if (value in risks) risks[value] += 1; });
    const riskScores = rows.map(row => Number(row.risk_score)).filter(Number.isFinite);
    const matchingHotspots = apiHotspots.filter(item => (!state || state === "All states" || normalizeMapValue(item.state) === normalizeMapValue(state)) && (!city || city === "All cities" || normalizeMapValue(item.city) === normalizeMapValue(city)) && (!risk || risk === "All categories" || normalizeMapValue(item.hotspot_level).includes(normalizeMapValue(risk))));
    const matchingRecommendations = apiRecommendations.filter(item => (!state || state === "All states" || normalizeMapValue(item.state) === normalizeMapValue(state)) && (!city || city === "All cities" || normalizeMapValue(item.city) === normalizeMapValue(city)) && (!risk || risk === "All categories" || normalizeMapValue(item.hotspot_level).includes(normalizeMapValue(risk))));
    const selectedFilters = [["State", state], ["City", city], ["Year", year], ["Risk Category", risk]];
    const causes = reportTopList(rows, "cause");
    const roads = reportTopList(rows, "road_type");
    const averageRisk = riskScores.length ? (riskScores.reduce((sum, value) => sum + value, 0) / riskScores.length).toFixed(3) : "Unavailable";
    preview.innerHTML = `<header class="report-header"><span class="eyebrow">ROADSAFE ANALYTICS</span><h2>Safety Report</h2><p>Data summary generated from selected project records.</p></header><section class="report-block"><h3>Selected Filters</h3><div class="report-filter-list">${selectedFilters.map(([label, value]) => `<span><b>${label}:</b> ${escapeApiText(value)}</span>`).join("")}</div></section><section class="report-block"><h3>Accident Summary</h3><div class="report-stat-grid"><span>Total accidents<strong>${rows.length.toLocaleString()}</strong></span><span>Average risk<strong>${averageRisk}</strong></span><span>Total casualties<strong>${rows.reduce((sum, row) => sum + (Number(row.casualties) || 0), 0).toLocaleString()}</strong></span></div></section><section class="report-block report-columns"><div><h3>Severity Summary</h3>${reportList([["Fatal", severity.fatal || 0], ["Major", severity.major || 0], ["Minor", severity.minor || 0]], item => `${item[0]}: ${Number(item[1]).toLocaleString()}`)}</div><div><h3>Risk Distribution</h3>${reportList(Object.entries(risks), item => `${reportOptionLabel(item[0])}: ${Number(item[1]).toLocaleString()}`)}</div></section><section class="report-block report-columns"><div><h3>Major Causes</h3>${reportList(causes, item => `${reportOptionLabel(item[0])}: ${Number(item[1]).toLocaleString()}`)}</div><div><h3>Road Types</h3>${reportList(roads, item => `${reportOptionLabel(item[0])}: ${Number(item[1]).toLocaleString()}`)}</div></section><section class="report-block"><h3>Time Pattern</h3><p>Most recorded accident time: <strong>${escapeApiText(reportHourText(rows))}</strong>.</p></section><section class="report-block"><h3>Relevant Hotspots</h3>${apiHotspots.length ? reportList(matchingHotspots.slice(0, 8), item => `${item.city}, ${item.state} — ${item.hotspot_level}, ${Number(item.accident_count || 0).toLocaleString()} accidents`) : "<p>Hotspot API data is currently unavailable.</p>"}</section><section class="report-block"><h3>Existing Recommendations</h3>${apiRecommendations.length ? reportList(matchingRecommendations.slice(0, 8), item => `${item.city}, ${item.state}: ${item.recommendation}`) : "<p>Recommendation API data is currently unavailable.</p>"}</section><footer class="report-footer">This report describes recorded project data for the selected filters. It does not establish causal relationships or make external safety claims.</footer>`;
    preview.hidden = false;
    printButton.hidden = false;
    status.textContent = `Report generated from ${rows.length.toLocaleString()} recorded accident(s).`;
}

function printSafetyReport() {
    const preview = document.getElementById("safetyReportPreview");
    if (!preview || preview.hidden) return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) return;
    printWindow.document.write(`<html><head><title>RoadSafe Analytics Safety Report</title><style>body{font-family:Arial,sans-serif;color:#172033;max-width:900px;margin:40px auto;padding:0 24px;line-height:1.5}h2{margin:4px 0}h3{margin-bottom:8px;border-bottom:1px solid #d9e0ea;padding-bottom:5px}.report-block{margin:24px 0}.report-columns{display:grid;grid-template-columns:1fr 1fr;gap:28px}.report-filter-list{display:flex;gap:8px;flex-wrap:wrap}.report-filter-list span,.report-stat-grid span{border:1px solid #d9e0ea;padding:8px;border-radius:4px}.report-stat-grid{display:flex;gap:8px;flex-wrap:wrap}.report-stat-grid span{display:grid;gap:4px}.report-stat-grid strong{font-size:20px}li{margin:4px 0}.report-footer{margin-top:32px;border-top:1px solid #d9e0ea;padding-top:12px;font-size:12px;color:#5d6b7e}@media print{body{margin:0}}</style></head><body>${preview.innerHTML}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}
// ==========================================
// RISK MAP
// ==========================================

let riskMap;
let accidentMarkers = [];
let allAccidentData = [];
let apiHotspots = [];
let apiRecommendations = [];
let apiHotspotMarkers = [];
const hotspotMarkerByCluster = {};
let showAllHotspots = false;
let mapMode = "accidents";
let filteredMapData = [];
let mapHeatLayer;

// Load CSV for Risk Map
fetch("data/accidents.csv")
    .then(response => response.text())
    .then(csv => {

        console.log("Risk Map: CSV loaded");

        const lines = csv.trim().split("\n");
        const headers = lines[0].split(",");

        allAccidentData = lines.slice(1).map(line => {

            const values = line.split(",");
            const row = {};

            headers.forEach((header, index) => {
                row[header.trim()] =
                    values[index] ? values[index].trim() : "";
            });

            row.risk_category = row["Risk Category"] || row.risk_category || "";
            row.year = row.year || row.Year || "";

            return row;
        });

        console.log(
            "Risk Map records:",
            allAccidentData.length
        );

        initializeRiskMap(allAccidentData);

    })
    .catch(error => {

        console.error(
            "Risk Map CSV Error:",
            error
        );

    });


// ==========================================
// INITIALIZE MAP
// ==========================================

function initializeRiskMap(data) {

    const mapElement = document.getElementById("map");

    if (!mapElement) {
        console.log("Risk Map element not found");
        return;
    }

    // Create map
    riskMap = L.map("map").setView(
        [20.5937, 78.9629],
        5
    );

    // OpenStreetMap layer
    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            attribution: "&copy; OpenStreetMap contributors"
        }
    ).addTo(riskMap);

    riskMap.on("click", async event => {
        const lat = Number(event.latlng.lat);
        const lon = Number(event.latlng.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        try {
            const profile = await analyzeLocationProfile(lat, lon, "", 5);
            if (profile?.resolved_location?.display_name) {
                console.log("Selected map location:", profile.resolved_location.display_name);
            }
        } catch (error) {
            console.error("Location analysis failed:", error);
        }
    });

    const areaButton = document.createElement("button");
    areaButton.type = "button";
    areaButton.textContent = "Analyze This Area";
    areaButton.style.cssText = "position:absolute;right:12px;bottom:12px;z-index:500;border:none;border-radius:10px;padding:10px 12px;background:#4da3ff;color:white;font-weight:600;cursor:pointer;box-shadow:0 12px 28px rgba(0,0,0,.2);";
    areaButton.addEventListener("click", async () => {
        const center = riskMap.getCenter();
        const lat = Number(center.lat);
        const lon = Number(center.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        try {
            await analyzeLocationProfile(lat, lon, "", 5);
        } catch (error) {
            console.error("Area analysis failed:", error);
        }
    });
    mapElement.appendChild(areaButton);

    filteredMapData = data;
    renderMapLayers();

    console.log("Risk Map created successfully");
}


// ==========================================
// DISPLAY ACCIDENT MARKERS
// ==========================================

function displayAccidentMarkers(data) {
    filteredMapData = data;
    renderMapLayers();
}

function clearMapLayers() {
    accidentMarkers.forEach(marker => riskMap?.removeLayer(marker));
    apiHotspotMarkers.forEach(marker => riskMap?.removeLayer(marker));
    if (mapHeatLayer && riskMap) riskMap.removeLayer(mapHeatLayer);
    accidentMarkers = [];
    apiHotspotMarkers = [];
    mapHeatLayer = null;
    Object.keys(hotspotMarkerByCluster).forEach(key => delete hotspotMarkerByCluster[key]);
}

function mapPopupRow(label, value) {
    const displayValue = String(value ?? "").trim();
    return displayValue ? `<div class="map-popup__row"><b>${label}</b><span>${escapeApiText(displayValue)}</span></div>` : "";
}

function accidentPopup(row) {
    return `<div class="map-popup"><strong>Accident Information</strong>${mapPopupRow("City", row.city)}${mapPopupRow("State", row.state)}${mapPopupRow("Road Type", row.road_type)}${mapPopupRow("Weather", row.weather)}${mapPopupRow("Risk Category", row["Risk Category"] || row.risk_category)}${mapPopupRow("Accident Severity", row.accident_severity)}${mapPopupRow("Time", row.time)}${mapPopupRow("Casualties", row.casualties)}</div>`;
}

function renderAccidentMarkers(data) {
    const emptyState = document.getElementById("mapEmptyState");
    if (emptyState) emptyState.hidden = data.length > 0;

    data.forEach(row => {

        const latitude = Number(row.latitude);
        const longitude = Number(row.longitude);

        // Skip invalid coordinates
        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            return;
        }

        const risk = getRowRisk(row);

        const color = getRiskColor(risk);
        const casualties = Math.max(0, Number(row.casualties) || 0);

        const marker = L.circleMarker(
            [latitude, longitude],
            {
                radius: Math.min(10, 4 + Math.sqrt(casualties)),
                fillColor: color,
                color: "#ffffff",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            }
        );

        marker.bindPopup(accidentPopup(row));

        marker.addTo(riskMap);

        accidentMarkers.push(marker);
    });

    console.log("Markers displayed:", accidentMarkers.length);
}

function renderHeatmap(data) {
    const points = data.map(row => {
        const latitude = Number(row.latitude);
        const longitude = Number(row.longitude);
        const risk = getRowRisk(row);
        const intensity = risk === "critical" ? 1 : risk === "high" ? 0.8 : risk === "moderate" ? 0.55 : 0.3;
        return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude, intensity] : null;
    }).filter(Boolean);
    if (typeof L.heatLayer === "function" && points.length) {
        mapHeatLayer = L.heatLayer(points, { radius: 24, blur: 18, maxZoom: 12, max: 1 }).addTo(riskMap);
    }
    const emptyState = document.getElementById("mapEmptyState");
    if (emptyState) emptyState.hidden = points.length > 0;
}

function renderHotspotMarkers() {
    const visibleHotspots = apiHotspots.filter(hotspot => {
        const stateMatch = !selectedState || normalizeMapValue(hotspot.state) === normalizeMapValue(selectedState);
        const cityMatch = !selectedCity || normalizeMapValue(hotspot.city) === normalizeMapValue(selectedCity);
        const level = normalizeMapValue(hotspot.hotspot_level).replace(" hotspot", "");
        const riskMatch = !selectedRisk || level.includes(normalizeMapValue(selectedRisk));
        return stateMatch && cityMatch && riskMatch;
    });
    visibleHotspots.forEach(hotspot => {
        const latitude = Number(hotspot.average_latitude);
        const longitude = Number(hotspot.average_longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        const risk = normalizeMapValue(hotspot.hotspot_level);
        const marker = L.circle([latitude, longitude], {
            radius: Math.max(350, Math.min(900, Number(hotspot.accident_count || 0) * 18)),
            color: getRiskColor(risk),
            weight: 2,
            fillColor: getRiskColor(risk),
            fillOpacity: 0.2
        }).addTo(riskMap);
        marker.bindPopup(`<div class="map-popup"><strong>Risk Hotspot</strong>${mapPopupRow("City", hotspot.city)}${mapPopupRow("State", hotspot.state)}${mapPopupRow("Level", hotspot.hotspot_level)}${mapPopupRow("Accidents", hotspot.accident_count)}${mapPopupRow("Score", Number(hotspot.hotspot_score || 0).toFixed(2))}</div>`);
        apiHotspotMarkers.push(marker);
        hotspotMarkerByCluster[String(hotspot.hotspot_cluster)] = marker;
    });
    const emptyState = document.getElementById("mapEmptyState");
    if (emptyState) emptyState.hidden = visibleHotspots.length > 0;
}

function renderMapLayers() {
    if (!riskMap) return;
    let emptyState = document.getElementById("mapEmptyState");
    if (!emptyState) {
        emptyState = document.createElement("div");
        emptyState.id = "mapEmptyState";
        emptyState.className = "map-empty-state";
        emptyState.textContent = "No matching accidents found";
        document.getElementById("map")?.appendChild(emptyState);
    }
    clearMapLayers();
    if (mapMode === "hotspots") renderHotspotMarkers();
    else if (mapMode === "heatmap") renderHeatmap(filteredMapData);
    else renderAccidentMarkers(filteredMapData);
}


// ==========================================
// RISK COLOR
// ==========================================

function getRiskColor(risk) {

    if (risk.includes("critical")) {
        return "#ef4444";
    }

    if (risk.includes("high")) {
        return "#f97316";
    }

    if (
        risk.includes("moderate") ||
        risk.includes("medium")
    ) {
        return "#eab308";
    }

    return "#22c55e";
}


// ==========================================
// RESET MAP
// ==========================================

const resetViewBtn =
    document.getElementById("resetViewBtn");

const mapSearchInput =
    document.getElementById("mapSearchInput");

if (mapSearchInput) {
    const searchResults = document.createElement("div");
    searchResults.id = "locationSearchResults";
    searchResults.style.cssText = "position:absolute;top:calc(100% + 8px);left:0;right:0;background:rgba(10,16,28,.96);border:1px solid rgba(153,173,214,.2);border-radius:12px;box-shadow:0 14px 30px rgba(0,0,0,.28);overflow:hidden;display:none;z-index:1000;max-height:260px;overflow-y:auto;";
    mapSearchInput.parentElement?.appendChild(searchResults);

    function renderLocationResults(results) {
        const items = Array.isArray(results) ? results : [];
        if (!items.length) {
            searchResults.style.display = "none";
            searchResults.innerHTML = "";
            return;
        }
        searchResults.innerHTML = items.map((location, index) => {
            const city = location.city || location.state || "Location";
            const state = location.state || "Unknown region";
            const country = location.country || "Unknown country";
            return `
                <button type="button" data-location-index="${index}" style="display:block;width:100%;text-align:left;padding:12px 14px;border:0;border-bottom:1px solid rgba(153,173,214,.12);background:transparent;color:#edf5ff;cursor:pointer;">
                    <div style="font-weight:700;line-height:1.35;">${escapeApiText(city)}</div>
                    <div style="font-size:12px;color:#cfe3ff;">${escapeApiText(state)} • ${escapeApiText(country)}</div>
                </button>
            `;
        }).join("");
        searchResults.style.display = "block";
    }

    mapSearchInput.addEventListener("input", async function () {
        mapSearchText = this.value.toLowerCase().trim();
        applyMapFilters();
        const query = this.value.trim();
        if (!query) {
            renderLocationResults([]);
            return;
        }
        try {
            const result = await fetchLocationSearch(query);
            renderLocationResults(result?.results || []);
        } catch (error) {
            renderLocationResults([]);
        }
    });

    searchResults.addEventListener("click", async function (event) {
        const button = event.target.closest("[data-location-index]");
        if (!button) return;
        const index = Number(button.getAttribute("data-location-index"));
        const result = (await fetchLocationSearch(mapSearchInput.value.trim()))?.results?.[index];
        if (!result) return;
        renderLocationResults([]);
        if (riskMap) {
            riskMap.setView([Number(result.lat), Number(result.lon)], 11);
        }
        await analyzeLocationProfile(Number(result.lat), Number(result.lon), mapSearchInput.value.trim(), 5);
    });

    mapSearchInput.addEventListener("keydown", async function (event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const query = this.value.trim();
        if (!query) return;
        try {
            const result = await fetchLocationSearch(query);
            const matches = result?.results || [];
            if (!matches.length) {
                renderLocationResults([]);
                return;
            }
            renderLocationResults(matches);
            const location = matches[0];
            if (riskMap) {
                riskMap.setView([Number(location.lat), Number(location.lon)], 11);
            }
            await analyzeLocationProfile(Number(location.lat), Number(location.lon), query, 5);
        } catch (error) {
            console.error("Global location search failed:", error);
        }
    });
}

// ==========================================
// LOCATE USER
// ==========================================

const locateBtn =
    document.getElementById("locateBtn");

if (locateBtn) {
    locateBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        <span>Use My Location</span>
    `;

    locateBtn.addEventListener(
        "click",
        function () {

            if (!navigator.geolocation) {

                alert(
                    "Geolocation is not supported."
                );

                return;
            }

            navigator.geolocation.getCurrentPosition(
                async function (position) {

                    const lat =
                        position.coords.latitude;

                    const lng =
                        position.coords.longitude;

                    riskMap?.setView(
                        [lat, lng],
                        12
                    );

                    try {
                        await analyzeLocationProfile(lat, lng, "My location", 5);
                    } catch (error) {
                        console.error("My location analysis failed:", error);
                    }

                    L.marker([lat, lng])
                        .addTo(riskMap)
                        .bindPopup(
                            "You are here"
                        )
                        .openPopup();

                },

                function () {

                    alert(
                        "Unable to get your location."
                    );

                }
            );
        }
    );

}
// ==========================================
// MAP FILTERS
// ==========================================

let selectedState = "";
let selectedCity = "";
let selectedRisk = "";
let selectedYear = "";
let mapSearchText = "";


// ==========================================
// APPLY ALL FILTERS
// ==========================================

function applyMapFilters() {

    let filteredData = allAccidentData.filter(row => {

        const state = normalizeMapValue(row.state);
        const city = normalizeMapValue(row.city);
        const risk = getRowRisk(row);
        const year = getRowYear(row);
        const searchableText = [row.city, row.state, row.road_type, risk, row.cause]
            .join(" ")
            .toLowerCase();

        const stateMatch =
            !selectedState ||
            state === normalizeMapValue(selectedState);

        const cityMatch =
            !selectedCity ||
            city === normalizeMapValue(selectedCity);

        const riskMatch =
            !selectedRisk ||
            risk === normalizeMapValue(selectedRisk);

        const yearMatch =
            !selectedYear ||
            year === normalizeMapValue(selectedYear);

        const searchMatch = !mapSearchText || searchableText.includes(mapSearchText);

        return (
            stateMatch &&
            cityMatch &&
            riskMatch &&
            yearMatch &&
            searchMatch
        );
    });

    displayAccidentMarkers(filteredData);

    console.log("Map filter results:", { total: allAccidentData.length, final: filteredData.length });
}
// ==========================================
// STATE FILTER DROPDOWN
// ==========================================

const stateButton = document.getElementById("filterState");

if (stateButton) {

    stateButton.addEventListener("click", function () {

        // Remove existing dropdown
        const oldDropdown = document.getElementById("stateDropdown");

        if (oldDropdown) {
            oldDropdown.remove();
            return;
        }

        // Get unique states
        const states = [...new Set(
            allAccidentData
                .map(row => row.state)
                .filter(Boolean)
        )].sort();

        // Create dropdown
        const dropdown = document.createElement("div");

        dropdown.id = "stateDropdown";
        dropdown.className = "state-dropdown";

        // All States
        const allOption = document.createElement("div");

        allOption.className = "state-option";
        allOption.textContent = "All States";

        allOption.addEventListener("click", function () {

            displayAccidentMarkers(allAccidentData);

            stateButton.querySelector("span").textContent = "State";

            dropdown.remove();

        });

        dropdown.appendChild(allOption);

        // Add each state
        states.forEach(function (state) {

            const option = document.createElement("div");

            option.className = "state-option";
            option.textContent = state;

            option.addEventListener("click", function () {

                filterMarkersByState(state);

                stateButton.querySelector("span").textContent = state;

                dropdown.remove();

            });

            dropdown.appendChild(option);
        });

        stateButton.parentElement.appendChild(dropdown);
    });
}


// ==========================================
// FILTER MAP BY STATE
// ==========================================

function filterMarkersByState(selectedState) {

    // Remove existing markers
    accidentMarkers.forEach(function (marker) {
        riskMap.removeLayer(marker);
    });

    accidentMarkers = [];

    // Show only selected state
    allAccidentData.forEach(function (row) {

        if (
            row.state &&
            row.state.toLowerCase() === selectedState.toLowerCase()
        ) {

            const latitude = Number(row.latitude);
            const longitude = Number(row.longitude);

            if (
                Number.isNaN(latitude) ||
                Number.isNaN(longitude)
            ) {
                return;
            }

            const risk = (
                getRowRisk(row)
            ).toLowerCase();

            const color = getRiskColor(risk);

            const marker = L.circleMarker(
                [latitude, longitude],
                {
                    radius: 5,
                    fillColor: color,
                    color: "#ffffff",
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                }
            );

            marker.bindPopup(`
                <strong>Accident Location</strong><br>
                City: ${row.city || "Unknown"}<br>
                State: ${row.state || "Unknown"}<br>
                Risk: ${row["Risk Category"] || row.risk_category || "Unknown"}<br>
                Severity: ${row.accident_severity || "Unknown"}<br>
                Casualties: ${row.casualties || 0}
            `);

            marker.addTo(riskMap);

            accidentMarkers.push(marker);
        }
    });

    console.log(
        "State selected:",
        selectedState,
        "Markers:",
        accidentMarkers.length
    );
}
// ==========================================
// CITY FILTER DROPDOWN
// ==========================================

const cityButton = document.getElementById("filterCity");

if (cityButton) {

    cityButton.addEventListener("click", function () {

        // Close dropdown if already open
        const oldDropdown = document.getElementById("cityDropdown");

        if (oldDropdown) {
            oldDropdown.remove();
            return;
        }

        // Get currently selected state
        const selectedState =
            stateButton.querySelector("span").textContent.trim();

        // Get cities
        let cityData = allAccidentData;

        // If a state is selected, show only cities from that state
        if (selectedState !== "State") {

            cityData = allAccidentData.filter(function (row) {

                return row.state &&
                    row.state.toLowerCase() ===
                    selectedState.toLowerCase();

            });
        }

        // Get unique cities
        const cities = [...new Set(
            cityData
                .map(row => row.city)
                .filter(Boolean)
        )].sort();

        // Create dropdown
        const dropdown = document.createElement("div");

        dropdown.id = "cityDropdown";
        dropdown.className = "city-dropdown";

        // All Cities option
        const allOption = document.createElement("div");

        allOption.className = "city-option";
        allOption.textContent = "All Cities";

        allOption.addEventListener("click", function () {

            cityButton.querySelector("span").textContent = "City";

            // If State is selected, show that state's markers
            if (selectedState !== "State") {

                filterMarkersByState(selectedState);

            } else {

                displayAccidentMarkers(allAccidentData);

            }

            dropdown.remove();

        });

        dropdown.appendChild(allOption);

        // Add cities
        cities.forEach(function (city) {

            const option = document.createElement("div");

            option.className = "city-option";
            option.textContent = city;

            option.addEventListener("click", function () {

                filterMarkersByCity(city);

                cityButton.querySelector("span").textContent = city;

                dropdown.remove();

            });

            dropdown.appendChild(option);

        });

        cityButton.parentElement.appendChild(dropdown);
    });
}


// ==========================================
// FILTER MAP BY CITY
// ==========================================

function filterMarkersByCity(selectedCity) {

    // Get selected state
    const selectedState =
        stateButton.querySelector("span").textContent.trim();

    // Remove current markers
    accidentMarkers.forEach(function (marker) {
        riskMap.removeLayer(marker);
    });

    accidentMarkers = [];

    // Filter accident data
    allAccidentData.forEach(function (row) {

        // Check city
        const cityMatch =
            row.city &&
            row.city.toLowerCase() ===
            selectedCity.toLowerCase();

        // Check state if selected
        const stateMatch =
            selectedState === "State" ||
            (
                row.state &&
                row.state.toLowerCase() ===
                selectedState.toLowerCase()
            );

        if (cityMatch && stateMatch) {

            const latitude = Number(row.latitude);
            const longitude = Number(row.longitude);

            if (
                Number.isNaN(latitude) ||
                Number.isNaN(longitude)
            ) {
                return;
            }

            const risk = (
                getRowRisk(row)
            ).toLowerCase();

            const color = getRiskColor(risk);

            const marker = L.circleMarker(
                [latitude, longitude],
                {
                    radius: 5,
                    fillColor: color,
                    color: "#ffffff",
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                }
            );

            marker.bindPopup(`
                <strong>Accident Location</strong><br>
                City: ${row.city || "Unknown"}<br>
                State: ${row.state || "Unknown"}<br>
                Risk: ${row["Risk Category"] || row.risk_category || "Unknown"}<br>
                Severity: ${row.accident_severity || "Unknown"}<br>
                Casualties: ${row.casualties || 0}
            `);

            marker.addTo(riskMap);

            accidentMarkers.push(marker);
        }
    });

    console.log(
        "City selected:",
        selectedCity,
        "Markers:",
        accidentMarkers.length
    );
}
// ==========================================
// RISK FILTER
// ==========================================

const riskButton = document.getElementById("filterRisk");

if (riskButton) {

    riskButton.addEventListener("click", function () {

        const oldDropdown = document.getElementById("riskDropdown");

        if (oldDropdown) {
            oldDropdown.remove();
            return;
        }

        const risks = [
            "Low",
            "Moderate",
            "High",
            "Critical"
        ];

        const dropdown = document.createElement("div");

        dropdown.id = "riskDropdown";
        dropdown.className = "risk-dropdown";

        // All Risk option
        const allOption = document.createElement("div");

        allOption.className = "risk-option";
        allOption.textContent = "All Risk";

        allOption.addEventListener("click", function () {

            riskButton.querySelector("span").textContent = "Risk";

            displayAccidentMarkers(allAccidentData);

            dropdown.remove();

        });

        dropdown.appendChild(allOption);


        // Risk options
        risks.forEach(function (risk) {

            const option = document.createElement("div");

            option.className = "risk-option";
            option.textContent = risk;

            option.addEventListener("click", function () {

                console.log("Selected risk:", risk);

                console.log(
                    "Risk values:",
                    [
                        ...new Set(
                            allAccidentData.map(
                                row => row["Risk Category"]
                            )
                        )
                    ]
                );

                const filteredData =
                    allAccidentData.filter(function (row) {

                        const rowRisk =
                            String(row["Risk Category"] || "")
                            .trim()
                            .toLowerCase();

                        const selectedRisk =
                            String(risk)
                            .trim()
                            .toLowerCase();

                        return rowRisk === selectedRisk;

                    });

                console.log(
                    "Risk selected:",
                    risk,
                    "Markers:",
                    filteredData.length
                );

                riskButton.querySelector("span").textContent = risk;

                displayAccidentMarkers(filteredData);

                dropdown.remove();

            });

            dropdown.appendChild(option);

        });

        riskButton.parentElement.appendChild(dropdown);

    });

}

// ==========================================
// YEAR FILTER DROPDOWN
// ==========================================

const yearButton = document.getElementById("filterYear");

if (yearButton) {
    yearButton.addEventListener("click", function () {
        const oldDropdown = document.getElementById("yearDropdown");

        if (oldDropdown) {
            oldDropdown.remove();
            return;
        }

        const years = [...new Set(
            allAccidentData
                .map(row => String(row.year || row.Year || "").trim())
                .filter(Boolean)
        )].sort((a, b) => Number(b) - Number(a));

        const dropdown = document.createElement("div");
        dropdown.id = "yearDropdown";
        dropdown.className = "year-dropdown";

        const options = ["All Years", ...years];
        options.forEach(year => {
            const option = document.createElement("div");
            option.className = "year-option";
            option.textContent = year;
            option.addEventListener("click", function () {
                const selectedYearValue = year === "All Years" ? "" : year;
                const filteredData = allAccidentData.filter(row => {
                    const rowYear = String(row.year || row.Year || "").trim();
                    return !selectedYearValue || rowYear === selectedYearValue;
                });
                yearButton.querySelector("span").textContent = year === "All Years" ? "Year" : year;
                displayAccidentMarkers(filteredData);
                dropdown.remove();
            });
            dropdown.appendChild(option);
        });

        yearButton.parentElement.appendChild(dropdown);
    });
}
// ==========================================
// UNIFIED MAP FILTER OVERRIDE
// ==========================================

const unifiedFilterDefinitions = {
    filterState: {
        menuId: "stateDropdown",
        allLabel: "All States",
        values: () => [...new Set(allAccidentData.map(row => String(row.state || "").trim()).filter(Boolean))].sort(),
        choose(value) { selectedState = value; selectedCity = ""; setUnifiedLabel("filterState", value || "State"); setUnifiedLabel("filterCity", "City"); }
    },
    filterCity: {
        menuId: "cityDropdown",
        allLabel: "All Cities",
        values: () => [...new Set(allAccidentData.filter(row => !selectedState || String(row.state || "").toLowerCase() === selectedState.toLowerCase()).map(row => String(row.city || "").trim()).filter(Boolean))].sort(),
        choose(value) { selectedCity = value; setUnifiedLabel("filterCity", value || "City"); }
    },
    filterRisk: {
        menuId: "riskDropdown",
        allLabel: "All Risk",
        values: () => ["Low", "Moderate", "High", "Critical"],
        choose(value) { selectedRisk = value; setUnifiedLabel("filterRisk", value || "Risk"); }
    },
    filterYear: {
        menuId: "yearDropdown",
        allLabel: "All Years",
        values: () => [...new Set(allAccidentData.map(row => String(row.year || row.Year || "").trim()).filter(Boolean))].sort((a, b) => Number(b) - Number(a)),
        choose(value) { selectedYear = value; setUnifiedLabel("filterYear", value || "Year"); }
    }
};

document.getElementById("mapModeSelect")?.addEventListener("change", event => {
    mapMode = event.currentTarget.value;
    renderMapLayers();
});

resetViewBtn?.addEventListener("click", () => {
    if (riskMap) riskMap.setView([20.5937, 78.9629], 5);
});

function setUnifiedLabel(id, label) {
    const button = document.getElementById(id);
    if (!button) return;
    button.querySelector("span").textContent = label;
    button.classList.toggle("is-selected", !["State", "City", "Risk", "Year"].includes(label));
}

function closeUnifiedMenus() {
    document.querySelectorAll(".map-filter-menu").forEach(menu => menu.remove());
    document.querySelectorAll(".filter-select.is-open").forEach(button => {
        button.classList.remove("is-open");
        button.setAttribute("aria-expanded", "false");
    });
    closeCustomSelectMenus();
}

function positionFloatingMenu(trigger, menu) {
    const bounds = trigger.getBoundingClientRect();
    const gap = 6;
    const viewportPadding = 12;
    const maxHeight = Math.min(300, Math.max(140, window.innerHeight - viewportPadding * 2));

    menu.style.position = "fixed";
    menu.style.width = `${Math.min(Math.max(bounds.width, 160), window.innerWidth - viewportPadding * 2)}px`;
    menu.style.maxHeight = `${maxHeight}px`;

    const naturalHeight = Math.min(menu.scrollHeight, maxHeight);
    const availableBelow = Math.max(0, window.innerHeight - viewportPadding - bounds.bottom - gap);
    const availableAbove = Math.max(0, bounds.top - viewportPadding - gap);
    const opensAbove = availableBelow < naturalHeight && availableAbove > availableBelow;
    const availableSpace = opensAbove ? availableAbove : availableBelow;
    const menuHeight = Math.min(naturalHeight, Math.max(0, availableSpace));
    menu.style.maxHeight = `${Math.max(40, menuHeight)}px`;
    const horizontalLimit = window.innerWidth - menu.offsetWidth - viewportPadding;
    const left = Math.max(viewportPadding, Math.min(bounds.left, horizontalLimit));
    const top = opensAbove
        ? Math.max(viewportPadding, bounds.top - menuHeight - gap)
        : Math.min(window.innerHeight - viewportPadding - menuHeight, bounds.bottom + gap);

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.dataset.placement = opensAbove ? "above" : "below";
}

function wireDropdownOptionKeyboard(option, menu, onSelect, onClose) {
    option.addEventListener("keydown", event => {
        const options = [...menu.querySelectorAll(".custom-select-option:not(:disabled)")];
        const index = options.indexOf(option);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            options[(index + direction + options.length) % options.length]?.focus();
        } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            (event.key === "Home" ? options[0] : options[options.length - 1])?.focus();
        } else if (event.key === "Enter") {
            event.preventDefault();
            onSelect();
        } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
        } else if (event.key === "Tab") {
            setTimeout(onClose, 0);
        }
    });
}

function openUnifiedMenu(button, definition) {
    if (document.getElementById(definition.menuId)) { closeUnifiedMenus(); return; }
    closeUnifiedMenus();
    button.classList.add("is-open");
    button.setAttribute("aria-expanded", "true");
    const menu = document.createElement("div");
    menu.id = definition.menuId;
    menu.className = "custom-select-menu map-filter-menu";
    [definition.allLabel, ...definition.values()].forEach(value => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "custom-select-option map-filter-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(value === button.querySelector("span").textContent));
        option.textContent = value;
        const choose = () => {
            definition.choose(value === definition.allLabel ? "" : value);
            applyMapFilters();
            closeUnifiedMenus();
        };
        option.addEventListener("click", choose);
        wireDropdownOptionKeyboard(option, menu, choose, closeUnifiedMenus);
        menu.appendChild(option);
    });
    document.body.appendChild(menu);
    positionFloatingMenu(button, menu);
}

Object.entries(unifiedFilterDefinitions).forEach(([id, definition]) => {
    document.getElementById(id)?.addEventListener("click", event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        openUnifiedMenu(event.currentTarget, definition);
    }, true);
    document.getElementById(id)?.addEventListener("keydown", event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) return;
        event.preventDefault();
        const button = event.currentTarget;
        openUnifiedMenu(button, definition);
        const menu = document.getElementById(definition.menuId);
        if (!menu) return;
        const options = [...menu.querySelectorAll(".custom-select-option:not(:disabled)")];
        const target = event.key === "ArrowUp" || event.key === "End" ? options[options.length - 1] : options[0];
        target?.focus();
    }, true);
});
document.addEventListener("click", event => {
    if (!event.target.closest(".map-controls") && !event.target.closest(".custom-select-menu")) closeUnifiedMenus();
}, true);
document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeUnifiedMenus();
});

// ==========================================
// REUSABLE NATIVE SELECT PRESENTATION
// ==========================================

const customSelectState = new WeakMap();

function closeCustomSelectMenus(except = null) {
    document.querySelectorAll(".custom-select.is-open").forEach(select => {
        if (select !== except) {
            select.classList.remove("is-open");
            select.querySelector(".custom-select-trigger")?.setAttribute("aria-expanded", "false");
            const state = customSelectState.get(select);
            if (state) state.menu.remove();
        }
    });
}

function positionCustomSelectMenu(wrapper, menu) {
    const trigger = wrapper.querySelector(".custom-select-trigger");
    if (!trigger) return;
    positionFloatingMenu(trigger, menu);
}

function buildCustomSelectMenu(wrapper) {
    const nativeSelect = wrapper.querySelector("select");
    const trigger = wrapper.querySelector(".custom-select-trigger");
    if (!nativeSelect || !trigger) return;

    const existing = customSelectState.get(wrapper);
    if (existing) existing.menu.remove();
    const menu = document.createElement("div");
    menu.className = "custom-select-menu";
    menu.setAttribute("role", "listbox");
    menu.id = `${nativeSelect.id || nativeSelect.name || "select"}Menu`;
    trigger.setAttribute("aria-controls", menu.id);

    [...nativeSelect.options].forEach(option => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "custom-select-option";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(option.selected));
        item.disabled = option.disabled || nativeSelect.disabled;
        item.innerHTML = `<span>${escapeApiText(option.textContent)}</span>${option.selected ? '<span class="custom-select-check" aria-hidden="true">✓</span>' : ""}`;
        const choose = () => {
            if (item.disabled) return;
            nativeSelect.value = option.value;
            nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
            syncCustomSelect(wrapper);
            closeCustomSelectMenus();
        };
        item.addEventListener("click", choose);
        wireDropdownOptionKeyboard(item, menu, choose, () => {
            closeCustomSelectMenus();
            trigger.focus();
        });
        menu.appendChild(item);
    });
    document.body.appendChild(menu);
    customSelectState.set(wrapper, { menu });
    positionCustomSelectMenu(wrapper, menu);
}

function syncCustomSelect(wrapper) {
    const nativeSelect = wrapper.querySelector("select");
    const trigger = wrapper.querySelector(".custom-select-trigger");
    if (!nativeSelect || !trigger) return;
    const selected = nativeSelect.options[nativeSelect.selectedIndex];
    trigger.querySelector(".custom-select-value").textContent = selected ? selected.textContent : "";
    trigger.disabled = nativeSelect.disabled;
    wrapper.classList.toggle("is-disabled", nativeSelect.disabled);
    const state = customSelectState.get(wrapper);
    if (state) {
        state.menu.querySelectorAll(".custom-select-option").forEach((item, index) => {
            const option = nativeSelect.options[index];
            item.disabled = nativeSelect.disabled || option.disabled;
            item.setAttribute("aria-selected", String(option.selected));
            item.querySelector(".custom-select-check")?.remove();
            if (option.selected) item.insertAdjacentHTML("beforeend", '<span class="custom-select-check" aria-hidden="true">✓</span>');
        });
        positionCustomSelectMenu(wrapper, state.menu);
    }
}

function initializeCustomSelect(nativeSelect) {
    if (nativeSelect.closest(".custom-select")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "custom-select";
    nativeSelect.parentElement.insertBefore(wrapper, nativeSelect);
    wrapper.appendChild(nativeSelect);
    nativeSelect.classList.add("custom-select-native");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML = '<span class="custom-select-value"></span><span class="custom-select-chevron" aria-hidden="true">⌄</span>';
    wrapper.insertBefore(trigger, nativeSelect);

    nativeSelect.addEventListener("change", () => syncCustomSelect(wrapper));
    const observer = new MutationObserver(() => {
        if (wrapper.classList.contains("is-open")) {
            buildCustomSelectMenu(wrapper);
        } else {
            const state = customSelectState.get(wrapper);
            if (state) state.menu.remove();
        }
        syncCustomSelect(wrapper);
    });
    observer.observe(nativeSelect, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });

    trigger.addEventListener("click", () => {
        if (nativeSelect.disabled) return;
        const isOpen = wrapper.classList.contains("is-open");
        closeCustomSelectMenus();
        if (isOpen) return;
        wrapper.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
        buildCustomSelectMenu(wrapper);
        customSelectState.get(wrapper).menu.querySelector(".custom-select-option[aria-selected='true']")?.focus();
    });
    trigger.addEventListener("keydown", event => {
        if (["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            trigger.click();
            const state = customSelectState.get(wrapper);
            const options = state ? [...state.menu.querySelectorAll(".custom-select-option:not(:disabled)")] : [];
            const target = event.key === "ArrowUp" || event.key === "End" ? options[options.length - 1] : options[0];
            target?.focus();
        }
    });
    syncCustomSelect(wrapper);
}

function initializeAllCustomSelects() {
    document.querySelectorAll("select").forEach(initializeCustomSelect);
}

document.addEventListener("click", event => {
    if (!event.target.closest(".custom-select")) closeCustomSelectMenus();
});
window.addEventListener("resize", () => {
    document.querySelectorAll(".custom-select.is-open").forEach(wrapper => {
        const state = customSelectState.get(wrapper);
        if (state) positionCustomSelectMenu(wrapper, state.menu);
    });
});
window.addEventListener("scroll", () => {
    closeUnifiedMenus();
}, { passive: true });

initializeAllCustomSelects();

// =========================
// HOTSPOT ANALYSIS
// =========================

function loadHotspots() {

    if (!allAccidentData || allAccidentData.length === 0) {
        console.log("No accident data available for hotspots");
        return;
    }

    const cityCounts = {};

    allAccidentData.forEach(row => {

        const city = String(row.city || "Unknown").trim();
        const state = String(row.state || "Unknown").trim();
        const risk = getRowRisk(row);

        const key = city + "|" + state;

        if (!cityCounts[key]) {
            cityCounts[key] = {
                city: city,
                state: state,
                accidents: 0,
                high: 0,
                critical: 0
            };
        }

        cityCounts[key].accidents++;

        if (risk === "high") {
            cityCounts[key].high++;
        }

        if (risk === "critical") {
            cityCounts[key].critical++;
        }
    });

    const hotspots = Object.values(cityCounts)
        .sort((a, b) => b.accidents - a.accidents)
        .slice(0, 10);

    const totalElement = document.getElementById("hotspotTotal");
    const highElement = document.getElementById("hotspotHigh");
    const criticalElement = document.getElementById("hotspotCritical");
    const tableBody = document.getElementById("hotspotTableBody");

    if (!tableBody) return;

    if (totalElement) {
        totalElement.textContent = hotspots.length;
    }

    if (highElement) {
        highElement.textContent =
            hotspots.filter(x => x.high > 0).length;
    }

    if (criticalElement) {
        criticalElement.textContent =
            hotspots.filter(x => x.critical > 0).length;
    }

    tableBody.innerHTML = "";

    hotspots.forEach((item, index) => {

        let risk = "High";
        let riskClass = "risk-high";

        if (item.critical > item.high) {
            risk = "Critical";
            riskClass = "risk-critical";
        }

        const row = document.createElement("tr");

        row.innerHTML = `
            <td><strong>#${index + 1}</strong></td>
            <td>${item.city}</td>
            <td>${item.state}</td>
            <td>${item.accidents}</td>
            <td class="${riskClass}">${risk}</td>
        `;

        tableBody.appendChild(row);
    });

    console.log("Hotspots loaded:", hotspots);
    loadHotspots();
    allAccidentData = results.data;
}
function generateHotspots() {

    const tableBody = document.getElementById("hotspotsTableBody");

    if (!tableBody) {
        console.error("Hotspots table not found");
        return;
    }

    if (!allAccidentData || allAccidentData.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5">No accident data available</td>
            </tr>
        `;
        return;
    }

    // Group accidents by city and state
    const cityData = {};

    allAccidentData.forEach(row => {

        const city = String(row.city || "Unknown").trim();
        const state = String(row.state || "Unknown").trim();
        const risk = String(
            row["Risk Category"] ||
            row.risk_category ||
            "Unknown"
        ).trim();

        const key = city + "|" + state;

        if (!cityData[key]) {
            cityData[key] = {
                city: city,
                state: state,
                accidents: 0,
                risks: {}
            };
        }

        cityData[key].accidents++;

        cityData[key].risks[risk] =
            (cityData[key].risks[risk] || 0) + 1;
    });

    // Convert object to array
    const hotspots = Object.values(cityData);

    // Determine highest risk category
    hotspots.forEach(place => {

        let highestRisk = "Low";
        let highestCount = 0;

        Object.entries(place.risks).forEach(([risk, count]) => {

            if (count > highestCount) {
                highestCount = count;
                highestRisk = risk;
            }

        });

        place.risk = highestRisk;
    });

    // Sort by accident count
    hotspots.sort((a, b) => b.accidents - a.accidents);

    // Show top 10
    const topHotspots = hotspots.slice(0, 10);

    tableBody.innerHTML = "";

    topHotspots.forEach((place, index) => {

        let riskClass =
            place.risk.toLowerCase();

        const row = document.createElement("tr");

        row.innerHTML = `
            <td>
                <strong>#${index + 1}</strong>
            </td>

            <td>
                <strong>${place.city}</strong>
            </td>

            <td>
                ${place.state}
            </td>

            <td>
                ${place.accidents.toLocaleString()}
            </td>

            <td>
                <span class="risk-badge ${riskClass}">
                    ${place.risk}
                </span>
            </td>
        `;

        tableBody.appendChild(row);
    });

    console.log(
        "Hotspots generated:",
        topHotspots
    );
}

// ==========================================
// API-BACKED INTELLIGENCE
// ==========================================

function escapeApiText(value) {
    return String(value ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function fetchApiJson(path, options = {}) {
    const normalizedPath = String(path).replace(/^\/+/, "");
    const response = await fetch(`${API_BASE_URL}/api/${normalizedPath}`, options);
    let payload;

    try {
        payload = await response.json();
    } catch (error) {
        throw new Error("The API returned an invalid response.");
    }

    if (!response.ok) {
        const apiError = new Error(payload.error || "The API request could not be completed.");
        apiError.status = response.status;
        throw apiError;
    }

    return payload;
}

async function checkApiHealth() {
    try {
        await fetchApiJson("/health");
        console.log("RoadSafe API health check passed");
    } catch (error) {
        console.error("RoadSafe API health check failed:", error);
    }
}

function showApiUnavailable(element, error) {
    if (!element) return;
    element.textContent = "The RoadSafe Analytics API is currently unavailable.";
    console.error("RoadSafe API error:", error);
}

async function loadApiSummary() {
    try {
        const summary = await fetchApiJson("/summary");
        const total = document.getElementById("totalAccidents");
        const fatal = document.getElementById("fatalAccidents");
        const casualties = document.getElementById("totalCasualties");
        const criticalLocations = document.getElementById("criticalLocations");

        if (total) total.textContent = Number(summary.total_accidents || 0).toLocaleString();
        if (fatal) fatal.textContent = Number(summary.fatal_accidents || 0).toLocaleString();
        if (casualties) casualties.textContent = Number(summary.total_casualties || 0).toLocaleString();
        if (criticalLocations) criticalLocations.textContent = Number(summary.critical_risk_accidents || 0).toLocaleString();
    } catch (error) {
        console.error("Summary API error:", error);
        const status = document.getElementById("predictionStatus");
        if (status) status.textContent = "Backend data is currently unavailable.";
    }
}

function renderApiHotspots() {
    const tableBody = document.getElementById("hotspotsTableBody");
    if (!tableBody) return;

    if (!apiHotspots.length) {
        tableBody.innerHTML = '<tr><td colspan="10">No hotspot data available.</td></tr>';
        return;
    }

    const visibleHotspots = apiHotspots;
    tableBody.innerHTML = visibleHotspots.map((hotspot, index) => `
        <tr data-hotspot-cluster="${escapeApiText(hotspot.hotspot_cluster)}" tabindex="0">
            <td><strong>#${index + 1}</strong></td>
            <td>${escapeApiText(hotspot.city)}</td>
            <td>${escapeApiText(hotspot.state)}</td>
            <td>${Number(hotspot.average_latitude || 0).toFixed(5)}</td>
            <td>${Number(hotspot.average_longitude || 0).toFixed(5)}</td>
            <td>${Number(hotspot.accident_count || 0).toLocaleString()}</td>
            <td>${escapeApiText(hotspot.hotspot_level)}</td>
            <td>${Number(hotspot.hotspot_score || 0).toFixed(2)}</td>
            <td>${Number(hotspot.fatal_accidents || 0).toLocaleString()}</td>
            <td>${Number(hotspot.total_casualties || 0).toLocaleString()}</td>
        </tr>
    `).join("");

    tableBody.querySelectorAll("tr[data-hotspot-cluster]").forEach(row => {
        const focusHotspot = () => focusApiHotspot(row.dataset.hotspotCluster);
        row.addEventListener("click", focusHotspot);
        row.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") focusHotspot();
        });
    });

}

function addApiHotspotMarkers() {
    renderMapLayers();
}

function focusApiHotspot(clusterId) {
    const hotspot = apiHotspots.find(item => String(item.hotspot_cluster) === String(clusterId));
    const marker = hotspotMarkerByCluster[String(clusterId)];
    if (!hotspot || !riskMap) return;

    const location = [Number(hotspot.average_latitude), Number(hotspot.average_longitude)];
    riskMap.setView(location, 13);
    if (marker) marker.openPopup();
    document.getElementById("risk-map")?.scrollIntoView({ behavior: "smooth" });
}

async function loadApiHotspots() {
    const tableBody = document.getElementById("hotspotsTableBody");
    try {
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="10">Loading hotspots...</td></tr>';
        apiHotspots = await fetchApiJson("/hotspots");
        renderApiHotspots();
        addApiHotspotMarkers();
        updateCityProfile();
        const highestRiskArea = document.getElementById("highestRiskArea");
        if (highestRiskArea && apiHotspots[0]) {
            highestRiskArea.textContent = `${apiHotspots[0].city}, ${apiHotspots[0].state}`;
        }
    } catch (error) {
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="10"><strong>Unable to load historical hotspots.</strong><br><button class="btn btn--tertiary inline-retry" type="button">Retry</button></td></tr>';
        tableBody?.querySelector(".inline-retry")?.addEventListener("click", loadApiHotspots);
        console.error("Hotspots API error:", error);
    }
}

async function loadApiRecommendations() {
    const status = document.getElementById("recommendationsStatus");
    const list = document.getElementById("recommendationsList");
    if (!status || !list) return;

    try {
        const recommendations = await fetchApiJson("/recommendations");
        apiRecommendations = recommendations;
        const visibleRecommendations = recommendations
            .slice()
            .sort((a, b) => (a.priority === "High" ? -1 : 1) - (b.priority === "High" ? -1 : 1) || Number(b.hotspot_score) - Number(a.hotspot_score))
            .slice(0, 24);

        status.textContent = `Showing ${visibleRecommendations.length} of ${recommendations.length} data-driven recommendations.`;
        list.innerHTML = visibleRecommendations.map(item => {
            const priority = String(item.priority || "Low").toLowerCase();
            return `
                <article class="recommendation-card">
                    <div class="recommendation-card__top">
                        <div>
                            <div class="recommendation-card__location">${escapeApiText(item.city)}, ${escapeApiText(item.state)}</div>
                            <div class="recommendation-card__meta">Hotspot #${escapeApiText(item.hotspot_cluster)} · ${escapeApiText(item.hotspot_level)} · Score ${Number(item.hotspot_score || 0).toFixed(2)}</div>
                        </div>
                        <span class="priority-badge priority-badge--${priority}">${escapeApiText(item.priority)}</span>
                    </div>
                    <div class="recommendation-card__block">
                        <span class="recommendation-card__label">Observed evidence</span>
                        <p class="recommendation-card__reason">${escapeApiText(item.recommendation_reason)}</p>
                    </div>
                    <div class="recommendation-card__block">
                        <span class="recommendation-card__label">Detection logic</span>
                        <p class="recommendation-card__reason">Rule-based recommendation generated from the measured hotspot and accident pattern.</p>
                    </div>
                    <div class="recommendation-card__block recommendation-card__action">
                        <span class="recommendation-card__label">Recommended action</span>
                        <strong>${escapeApiText(item.recommendation)}</strong>
                    </div>
                </article>
            `;
        }).join("");
    } catch (error) {
        status.innerHTML = 'Recommendations are currently unavailable. <button class="btn btn--tertiary inline-retry" type="button">Retry</button>';
        status.querySelector(".inline-retry")?.addEventListener("click", loadApiRecommendations);
        list.innerHTML = '<div class="empty-state">The analytics dashboard remains available. Try again when the recommendation service is connected.</div>';
        console.error("Recommendations API error:", error);
    }
}

function predictionPayload(kind = "severity") {
    const form = document.getElementById("predictionForm");
    const values = Object.fromEntries(new FormData(form).entries());
    ["hour", "is_weekend", "lanes", "traffic_signal", "temperature", "vehicles_involved", "is_peak_hour", "latitude", "longitude", "Year", "Month Number", "month", "year"].forEach(field => {
        values[field] = Number(values[field]);
    });
    values.month = values["Month Number"];
    values.year = values.Year;
    if (kind === "severity") values.visibility = null;
    else delete values.visibility;
    return values;
}

function renderPredictionCard(title, result) {
    const results = document.getElementById("predictionResults");
    const probabilities = Object.entries(result.probabilities || {})
        .map(([label, value]) => `<div>${escapeApiText(label)}: ${(Number(value) * 100).toFixed(2)}%</div>`)
        .join("");
    const card = document.createElement("article");
    card.className = "prediction-result";
    card.innerHTML = `<h3>${escapeApiText(title)}</h3><strong>${escapeApiText(result.prediction)}</strong><div class="probability-list">${probabilities}</div>`;
    results.prepend(card);
}

function riskProbabilityRows(result) {
    const riskClasses = { low: "low", moderate: "moderate", high: "high", critical: "critical" };
    const probabilityOrder = ["Critical", "High", "Moderate", "Low"];
    const probabilities = result.probabilities || {};
    return probabilityOrder.filter(label => label in probabilities).map(label => {
        const value = probabilities[label];
        const normalized = String(label).toLowerCase();
        return `<div class="risk-probability-row"><span>${escapeApiText(label)}</span><span class="risk-probability-track"><span class="risk-probability-bar risk-probability-bar--${riskClasses[normalized] || "moderate"}" style="width:${Number(value) * 100}%"></span></span><span class="risk-probability-value">${(Number(value) * 100).toFixed(1)}%</span></div>`;
    }).join("");
}

function renderRiskPredictionCard(title, result) {
    return `<article class="prediction-result comparison-result"><h3>${escapeApiText(title)}</h3><strong>${escapeApiText(result.prediction)}</strong><div class="risk-probability-list">${riskProbabilityRows(result)}</div></article>`;
}

function renderRiskScenario(result, payload) {
    const results = document.getElementById("predictionResults");
    const summary = document.getElementById("scenarioSummary");
    const explanation = document.getElementById("scenarioExplanation");
    const card = document.createElement("article");
    card.className = "prediction-result";
    card.innerHTML = `<h3>Risk Prediction</h3><strong>${escapeApiText(result.prediction)}</strong><div class="risk-probability-list">${riskProbabilityRows(result)}</div><p class="prediction-model-note">Model: Random Forest Risk Classifier</p>`;
    results.prepend(card);

    const fields = [
        ["Location", `${payload.city}, ${payload.state}`],
        ["Road", payload.road_type],
        ["Weather", payload.weather],
        ["Traffic", payload.traffic_density],
        ["Time", `${Number(payload.hour) % 12 || 12}:00 ${Number(payload.hour) < 12 ? "AM" : "PM"}`],
        ["Cause", payload.cause]
    ];
    const titleCase = value => String(value || "").replace(/\b\w/g, character => character.toUpperCase());
    const hour = Number(payload.hour);
    const timeLabel = hour >= 18 || hour < 6 ? "Night-time" : "Daytime";
    const scenarioFactors = [
        `${titleCase(payload.road_type)} road`,
        `${titleCase(payload.traffic_density)} traffic density`,
        timeLabel,
        `${titleCase(payload.weather)} weather`,
        `${payload.lanes} lanes`,
        `${titleCase(payload.cause)} reported cause`,
        `${payload.temperature}° temperature`,
        ...(Number(payload.is_weekend) ? ["Weekend conditions"] : []),
        ...(Number(payload.traffic_signal) ? ["Traffic signal present"] : [])
    ];
    summary.hidden = false;
    summary.innerHTML = `<h3>Scenario Summary</h3><div class="scenario-summary">${fields.map(([label, value]) => `<span><b>${escapeApiText(label)}:</b> ${escapeApiText(value)}</span>`).join("")}</div>`;
    explanation.hidden = false;
    explanation.innerHTML = `
        <h3>WHY THIS RISK?</h3>
        <p class="scenario-label">Scenario factors</p>
        <ul class="scenario-factors">${scenarioFactors.map(factor => `<li>${escapeApiText(factor)}</li>`).join("")}</ul>
        <div class="condition-flow" aria-label="Condition to model prediction to risk category">
            <span>Selected conditions</span><b aria-hidden="true">→</b><span>Model prediction</span><b aria-hidden="true">→</b><strong>${escapeApiText(result.prediction)}</strong>
        </div>
        <h4>Why This Result?</h4>
        <p>The selected scenario is associated with a <strong>${escapeApiText(result.prediction.toLowerCase())}</strong> predicted risk category under the current model. These are input conditions and model output; they do not establish that any individual condition causes accidents.</p>
        <h4>Safety Guidance</h4>
        <p>Use this model-based interpretation as a decision-support signal. Prioritize speed control, attentive driving, and appropriate traffic management for these selected conditions.</p>
    `;
}

function comparisonPayload(basePayload) {
    const formValues = Object.fromEntries(new FormData(document.getElementById("comparisonForm")).entries());
    const modifiedPayload = { ...basePayload };
    modifiedPayload.hour = Number(formValues.hour);
    modifiedPayload.weather = formValues.weather;
    modifiedPayload.traffic_density = formValues.traffic_density;
    modifiedPayload.day_of_week = formValues.day_of_week;
    return modifiedPayload;
}

function renderRiskComparison(firstResult, secondResult) {
    const comparison = document.getElementById("scenarioComparison");
    const categoryChanged = firstResult.prediction !== secondResult.prediction;
    const comparisonNote = categoryChanged
        ? "Model prediction changed under the selected scenario; this does not guarantee fewer accidents."
        : "The model prediction remained the same under the selected scenario; this does not guarantee any accident outcome.";
    comparison.hidden = false;
    comparison.innerHTML = `
        <div class="scenario-comparison__heading"><h3>Scenario Comparison</h3><span>Real predictions from the existing risk model</span></div>
        <div class="comparison-results">
            ${renderRiskPredictionCard("Current Scenario", firstResult)}
            ${renderRiskPredictionCard("Modified Scenario", secondResult)}
        </div>
        <div class="scenario-difference"><strong>Scenario Difference</strong><p>${categoryChanged
            ? `Predicted category changed from <strong>${escapeApiText(firstResult.prediction)}</strong> to <strong>${escapeApiText(secondResult.prediction)}</strong>.`
            : `The predicted category remained <strong>${escapeApiText(firstResult.prediction)}</strong> under the selected scenario.`}</p><small>${comparisonNote}</small></div>
    `;
}

async function runPrediction(kind) {
    const status = document.getElementById("predictionStatus");
    const retryButton = document.getElementById("retryPredictionBtn");
    const comparison = document.getElementById("scenarioComparison");
    const endpoint = kind === "severity" ? "/predict/severity" : "/predict/risk";
    const button = kind === "severity" ? document.getElementById("predictSeverityBtn") : document.getElementById("predictRiskBtn");
    const payload = predictionPayload(kind);
    const validationErrors = validatePredictionPayload(payload, kind);
    if (validationErrors.length) {
        status.textContent = validationErrors[0];
        retryButton.hidden = true;
        return;
    }
    const requiredFields = kind === "risk"
        ? ["city", "state", "latitude", "longitude", "hour", "day_of_week", "is_weekend", "road_type", "lanes", "traffic_signal", "weather", "temperature", "traffic_density", "cause", "vehicles_involved", "is_peak_hour", "festival", "Year", "Month Number", "Month Name"]
        : ["city", "state", "road_type", "weather", "traffic_density", "cause", "hour"];
    const missingField = requiredFields.find(field => payload[field] === "" || payload[field] === undefined || payload[field] === null || Number.isNaN(payload[field]));
    if (missingField) {
        status.textContent = `Please provide a value for ${missingField}.`;
        retryButton.hidden = true;
        return;
    }
    status.textContent = kind === "risk" ? "Waking the prediction service and running your scenario..." : "Predicting...";
    retryButton.hidden = true;
    if (kind === "risk") comparison.hidden = true;
    if (button) { button.disabled = true; button.textContent = kind === "risk" ? "Running..." : "Predicting..."; }
    try {
        const result = await fetchApiJson(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (kind === "risk" && document.getElementById("compareScenarioToggle").checked) {
            status.textContent = "Running modified scenario...";
            const modifiedResult = await fetchApiJson(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(comparisonPayload(payload))
            });
            renderRiskComparison(result, modifiedResult);
            document.getElementById("scenarioSummary").hidden = true;
            document.getElementById("scenarioExplanation").hidden = true;
        } else if (kind === "risk") renderRiskScenario(result, payload);
        else renderPredictionCard("Predicted Severity", result);
        status.textContent = "Prediction complete.";
        retryButton.hidden = true;
    } catch (error) {
        status.textContent = error.status
            ? `Prediction could not be completed: ${error.message}`
            : "The prediction service may be waking from a cold start or is temporarily unavailable. Please retry.";
        retryButton.hidden = false;
        console.error("Prediction API error:", error);
    } finally {
        if (button) { button.disabled = false; button.textContent = kind === "risk" ? "Run Risk Scenario" : "Predict Severity"; }
    }
}

function initializeApiIntegration() {
    initializeSystemStatus();
    checkApiHealth();
    loadApiSummary();
    loadApiHotspots();
    loadApiRecommendations();
    document.getElementById("predictSeverityBtn")?.addEventListener("click", () => runPrediction("severity"));
    document.getElementById("predictRiskBtn")?.addEventListener("click", () => runPrediction("risk"));
    document.getElementById("retryPredictionBtn")?.addEventListener("click", () => runPrediction("risk"));
    document.getElementById("compareScenarioToggle")?.addEventListener("change", event => {
        const comparisonForm = document.getElementById("comparisonForm");
        comparisonForm.hidden = !event.currentTarget.checked;
        if (event.currentTarget.checked) {
            const baseForm = document.getElementById("predictionForm");
            ["weather", "traffic_density", "hour", "day_of_week"].forEach(field => {
                comparisonForm.elements[field].value = baseForm.elements[field].value;
            });
        }
    });
}

initializeApiIntegration();