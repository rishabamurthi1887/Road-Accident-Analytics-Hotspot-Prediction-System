const API_BASE_URL = "http://127.0.0.1:5000/api";

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
}

applyTheme(localStorage.getItem("roadSafeTheme") || "dark");
document.getElementById("themeToggle")?.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});

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
        updateDashboard(
            data.length,
            data.filter(row => String(row.accident_severity).toLowerCase() === "fatal").length,
            data.reduce((sum, row) => sum + Number(row.casualties || 0), 0),
            data.filter(row => getRowRisk(row) === "critical").length
        );
        updateRiskProfile(data);
        createAnalyticsCharts(data);
        updateSafetyInsights(data);
    })
    .catch(error => console.error("Error loading CSV:", error));

function updateDashboard(total, fatal, casualties, critical) {
    const values = { totalAccidents: total, fatalAccidents: fatal, totalCasualties: casualties, criticalLocations: critical };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = Number(value).toLocaleString();
    });
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
    return new Chart(canvas, { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, ...options } });
}

function createAnalyticsCharts(data) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthOf = row => {
        const parsed = new Date(row.date);
        return isNaN(parsed) ? "" : parsed.toLocaleString("en-US", { month: "short" });
    };
    const countBy = field => data.reduce((counts, row) => { const value = String(row[field] || "").trim(); if (value) counts[value] = (counts[value] || 0) + 1; return counts; }, {});
    const monthCounts = data.reduce((counts, row) => { const month = monthOf(row); if (month) counts[month] = (counts[month] || 0) + 1; return counts; }, {});
    makeChart("accidentsByStateChart", "bar", Object.entries(countBy("state")).sort((a, b) => b[1] - a[1]).slice(0, 10).map(item => item[0]), [{ label: "Accidents", data: Object.entries(countBy("state")).sort((a, b) => b[1] - a[1]).slice(0, 10).map(item => item[1]) }], { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } });
    makeChart("monthlyAccidentChart", "line", months, [{ label: "Accidents", data: months.map(month => monthCounts[month] || 0), tension: 0.4 }], { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } });

    const stateCounts = {};
    data.forEach(row => { const month = monthOf(row); const state = String(row.state || "").trim(); if (month && state) { stateCounts[state] ||= {}; stateCounts[state][month] = (stateCounts[state][month] || 0) + 1; } });
    makeChart("monthlyAccidentsByStateChart", "bar", months, Object.keys(stateCounts).sort().map(state => ({ label: state, data: months.map(month => stateCounts[state][month] || 0), stack: "states" })), { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }, plugins: { legend: { position: "bottom" } } });
    const severity = countBy("accident_severity");
    makeChart("severityDistributionChart", "doughnut", Object.keys(severity), [{ label: "Accidents", data: Object.values(severity) }], { plugins: { legend: { position: "bottom" } } });
    const causes = Object.entries(countBy("cause")).sort((a, b) => b[1] - a[1]).slice(0, 7);
    makeChart("topAccidentCausesChart", "bar", causes.map(item => item[0]), [{ label: "Accidents", data: causes.map(item => item[1]) }], { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } });
    const roads = countBy("road_type");
    makeChart("roadTypeAnalysisChart", "bar", Object.keys(roads), [{ label: "Accidents", data: Object.values(roads) }], { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } });
    const traffic = countBy("traffic_density");
    makeChart("trafficDensityChart", "bar", Object.keys(traffic), [{ label: "Accidents", data: Object.values(traffic) }], { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } });
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
// ==========================================
// RISK MAP
// ==========================================

let riskMap;
let accidentMarkers = [];
let allAccidentData = [];

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

    // Add accident markers
    displayAccidentMarkers(data);
    addApiHotspotMarkers();

    console.log("Risk Map created successfully");
}


// ==========================================
// DISPLAY ACCIDENT MARKERS
// ==========================================

function displayAccidentMarkers(data) {

    // Remove previous markers
    accidentMarkers.forEach(marker => {
        riskMap.removeLayer(marker);
    });

    accidentMarkers = [];

    let emptyState = document.getElementById("mapEmptyState");
    if (!emptyState) {
        emptyState = document.createElement("div");
        emptyState.id = "mapEmptyState";
        emptyState.className = "map-empty-state";
        emptyState.textContent = "No accident records match the selected filters.";
        document.getElementById("map")?.appendChild(emptyState);
    }
    emptyState.hidden = data.length > 0;

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

        const marker = L.circleMarker(
            [latitude, longitude],
            {
                radius: 6,
                fillColor: color,
                color: "#ffffff",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            }
        );

        marker.bindPopup(`
            <div>
                <strong>Accident Location</strong><br>
                <b>City:</b> ${row.city || "Unknown"}<br>
                <b>State:</b> ${row.state || "Unknown"}<br>
                <b>Risk:</b> ${row["Risk Category"] || row.risk_category || "Unknown"}<br>
                <b>Severity:</b> ${row.accident_severity || "Unknown"}<br>
                <b>Casualties:</b> ${row.casualties || 0}
            </div>
        `);

        marker.addTo(riskMap);

        accidentMarkers.push(marker);
    });

    console.log(
        "Markers displayed:",
        accidentMarkers.length
    );
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

if (resetViewBtn) {

    resetViewBtn.addEventListener(
        "click",
        function () {

            if (riskMap) {

                riskMap.setView(
                    [20.5937, 78.9629],
                    5
                );

            }

        }
    );
}


// ==========================================
// SEARCH MAP
// ==========================================

const mapSearchInput =
    document.getElementById("mapSearchInput");

if (mapSearchInput) {

    mapSearchInput.addEventListener(
        "input",
        function () {

            const searchText =
                this.value.toLowerCase().trim();

            if (!searchText) {

                displayAccidentMarkers(
                    allAccidentData
                );

                return;
            }

const filteredData = allAccidentData.filter(function (row) {

    const searchableText = [
        row.city,
        row.state,
        row.road_type,
        getRowRisk(row),
        row.cause
    ].join(" ").toLowerCase();

    return searchableText.includes(searchText);
});

displayAccidentMarkers(filteredData);

        }
    );
}


// ==========================================
// LOCATE USER
// ==========================================

const locateBtn =
    document.getElementById("locateBtn");

if (locateBtn) {

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
                function (position) {

                    const lat =
                        position.coords.latitude;

                    const lng =
                        position.coords.longitude;

                    riskMap.setView(
                        [lat, lng],
                        12
                    );

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


// ==========================================
// APPLY ALL FILTERS
// ==========================================

function applyMapFilters() {

    let filteredData = allAccidentData.filter(row => {

        const state = normalizeMapValue(row.state);
        const city = normalizeMapValue(row.city);
        const risk = getRowRisk(row);
        const year = getRowYear(row);

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

        return (
            stateMatch &&
            cityMatch &&
            riskMatch &&
            yearMatch
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

function setUnifiedLabel(id, label) {
    const button = document.getElementById(id);
    if (!button) return;
    button.querySelector("span").textContent = label;
    button.classList.toggle("is-selected", !["State", "City", "Risk", "Year"].includes(label));
}

function closeUnifiedMenus() {
    document.querySelectorAll(".map-filter-menu").forEach(menu => menu.remove());
    document.querySelectorAll(".filter-select.is-open").forEach(button => button.classList.remove("is-open"));
}

function openUnifiedMenu(button, definition) {
    if (document.getElementById(definition.menuId)) { closeUnifiedMenus(); return; }
    closeUnifiedMenus();
    button.classList.add("is-open");
    const menu = document.createElement("div");
    menu.id = definition.menuId;
    menu.className = "map-filter-menu";
    [definition.allLabel, ...definition.values()].forEach(value => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "map-filter-option";
        option.textContent = value;
        option.addEventListener("click", () => {
            definition.choose(value === definition.allLabel ? "" : value);
            applyMapFilters();
            closeUnifiedMenus();
        });
        menu.appendChild(option);
    });
    button.parentElement.appendChild(menu);
}

Object.entries(unifiedFilterDefinitions).forEach(([id, definition]) => {
    document.getElementById(id)?.addEventListener("click", event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        openUnifiedMenu(event.currentTarget, definition);
    }, true);
});
document.addEventListener("click", event => {
    if (!event.target.closest(".map-controls")) closeUnifiedMenus();
}, true);
document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeUnifiedMenus();
});

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

let apiHotspots = [];
let apiHotspotMarkers = [];
const hotspotMarkerByCluster = {};
let showAllHotspots = false;

function escapeApiText(value) {
    return String(value ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function fetchApiJson(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, options);
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

function showApiUnavailable(element, error) {
    if (!element) return;
    element.textContent = "Prediction service is unavailable. Please start the RoadSafe Analytics API.";
    console.error("RoadSafe API error:", error);
}

async function loadApiSummary() {
    try {
        const summary = await fetchApiJson("/summary");
        const total = document.getElementById("totalAccidents");
        const fatal = document.getElementById("fatalAccidents");
        const casualties = document.getElementById("totalCasualties");
        const hotspots = document.getElementById("criticalLocations");

        if (total) total.textContent = Number(summary.total_accidents || 0).toLocaleString();
        if (fatal) fatal.textContent = Number(summary.fatal_accidents || 0).toLocaleString();
        if (casualties) casualties.textContent = Number(summary.total_casualties || 0).toLocaleString();
        if (hotspots) hotspots.textContent = Number(summary.number_of_hotspots || 0).toLocaleString();
    } catch (error) {
        console.error("Summary API error:", error);
        const status = document.getElementById("predictionStatus");
        if (status) status.textContent = "ML/API service is currently offline. Start the RoadSafe API to enable backend data and predictions.";
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
    if (!riskMap || typeof L === "undefined") return;

    apiHotspotMarkers.forEach(marker => riskMap.removeLayer(marker));
    apiHotspotMarkers = [];

    apiHotspots.forEach(hotspot => {
        const latitude = Number(hotspot.average_latitude);
        const longitude = Number(hotspot.average_longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

        const marker = L.circle([latitude, longitude], {
            radius: 500,
            color: "#ff3b30",
            weight: 2,
            fillColor: "#ff3b30",
            fillOpacity: 0.12
        });

        marker.bindPopup(`
            <div>
                <strong>Accident Hotspot</strong><br>
                <b>City:</b> ${escapeApiText(hotspot.city)}<br>
                <b>State:</b> ${escapeApiText(hotspot.state)}<br>
                <b>Level:</b> ${escapeApiText(hotspot.hotspot_level)}<br>
                <b>Accidents:</b> ${Number(hotspot.accident_count || 0).toLocaleString()}<br>
                <b>Score:</b> ${Number(hotspot.hotspot_score || 0).toFixed(2)}
            </div>
        `);
        marker.addTo(riskMap);
        apiHotspotMarkers.push(marker);
        hotspotMarkerByCluster[String(hotspot.hotspot_cluster)] = marker;
    });
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
        const highestRiskArea = document.getElementById("highestRiskArea");
        if (highestRiskArea && apiHotspots[0]) {
            highestRiskArea.textContent = `${apiHotspots[0].city}, ${apiHotspots[0].state}`;
        }
    } catch (error) {
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="10">Unable to load hotspots from the API.</td></tr>';
        console.error("Hotspots API error:", error);
    }
}

async function loadApiRecommendations() {
    const status = document.getElementById("recommendationsStatus");
    const list = document.getElementById("recommendationsList");
    if (!status || !list) return;

    try {
        const recommendations = await fetchApiJson("/recommendations");
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
                    <strong>${escapeApiText(item.recommendation)}</strong>
                    <p class="recommendation-card__reason">${escapeApiText(item.recommendation_reason)}</p>
                </article>
            `;
        }).join("");
    } catch (error) {
        status.textContent = "Recommendations are unavailable. Please start the RoadSafe Analytics API.";
        console.error("Recommendations API error:", error);
    }
}

function predictionPayload() {
    const form = document.getElementById("predictionForm");
    const values = Object.fromEntries(new FormData(form).entries());
    ["hour", "is_weekend", "lanes", "traffic_signal", "temperature", "vehicles_involved", "is_peak_hour", "latitude", "longitude", "Year", "Month Number"].forEach(field => {
        values[field] = Number(values[field]);
    });
    values.month = values["Month Number"];
    values.year = values.Year;
    // The current processed dataset has no observed visibility values, and the
    // saved severity pipeline treats this numeric column as missing.
    values.visibility = null;
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

function renderRiskScenario(result, payload) {
    const results = document.getElementById("predictionResults");
    const summary = document.getElementById("scenarioSummary");
    const explanation = document.getElementById("scenarioExplanation");
    const riskClasses = { low: "low", moderate: "moderate", high: "high", critical: "critical" };
    const bars = Object.entries(result.probabilities || {}).map(([label, value]) => {
        const normalized = String(label).toLowerCase();
        return `<div class="risk-probability-row"><span>${escapeApiText(label)}</span><span class="risk-probability-track"><span class="risk-probability-bar risk-probability-bar--${riskClasses[normalized] || "moderate"}" style="width:${Number(value) * 100}%"></span></span><span class="risk-probability-value">${(Number(value) * 100).toFixed(1)}%</span></div>`;
    }).join("");
    const card = document.createElement("article");
    card.className = "prediction-result";
    card.innerHTML = `<h3>PREDICTED RISK</h3><strong>${escapeApiText(result.prediction)}</strong><div class="risk-probability-list">${bars}</div>`;
    results.prepend(card);

    const fields = [
        ["Location", `${payload.city}, ${payload.state}`],
        ["Road", payload.road_type],
        ["Weather", payload.weather],
        ["Traffic", payload.traffic_density],
        ["Hour", `${String(payload.hour).padStart(2, "0")}:00`],
        ["Cause", payload.cause]
    ];
    summary.hidden = false;
    summary.innerHTML = `<h3>Scenario Summary</h3><div class="scenario-summary">${fields.map(([label, value]) => `<span><b>${escapeApiText(label)}:</b> ${escapeApiText(value)}</span>`).join("")}</div>`;
    explanation.hidden = false;
    explanation.innerHTML = `<h3>Explain This Risk</h3><p>The model predicts <strong>${escapeApiText(result.prediction)}</strong> for the selected scenario. This is a decision-support result based on the existing historical accident dataset and model; it does not guarantee that changing any single condition will reduce accidents.</p>`;
}

async function runPrediction(kind) {
    const status = document.getElementById("predictionStatus");
    const endpoint = kind === "severity" ? "/predict/severity" : "/predict/risk";
    const button = kind === "severity" ? document.getElementById("predictSeverityBtn") : document.getElementById("predictRiskBtn");
    const payload = predictionPayload();
    const requiredFields = ["city", "state", "road_type", "weather", "traffic_density", "cause", "hour"];
    const missingField = requiredFields.find(field => payload[field] === "" || payload[field] === undefined || Number.isNaN(payload[field]));
    if (missingField) {
        status.textContent = `Please provide a value for ${missingField}.`;
        return;
    }
    status.textContent = "Predicting...";
    if (button) { button.disabled = true; button.textContent = kind === "risk" ? "Running..." : "Predicting..."; }
    try {
        const result = await fetchApiJson(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (kind === "risk") renderRiskScenario(result, payload);
        else renderPredictionCard("Predicted Severity", result);
        status.textContent = "Prediction complete.";
    } catch (error) {
        status.textContent = error.status
            ? `Prediction could not be completed: ${error.message}`
            : "Prediction service is unavailable. Please start the RoadSafe Analytics API.";
        console.error("Prediction API error:", error);
    } finally {
        if (button) { button.disabled = false; button.textContent = kind === "risk" ? "Run Scenario" : "Predict Severity"; }
    }
}

function initializeApiIntegration() {
    loadApiSummary();
    loadApiHotspots();
    loadApiRecommendations();
    document.getElementById("predictSeverityBtn")?.addEventListener("click", () => runPrediction("severity"));
    document.getElementById("predictRiskBtn")?.addEventListener("click", () => runPrediction("risk"));
}

initializeApiIntegration();