console.log("RoadSafe Analytics started");


// ==========================================
// LOAD CSV DATA
// ==========================================

fetch("data/accidents.csv")

    .then(response => {

        if (!response.ok) {
            throw new Error("Could not load accidents.csv");
        }

        return response.text();
    })

    .then(csv => {

        console.log("CSV loaded successfully");


        // ==========================================
        // CONVERT CSV INTO OBJECTS
        // ==========================================

        const lines = csv.trim().split("\n");

        const headers = lines[0].split(",");

        const data = lines.slice(1).map(line => {

            const values = line.split(",");

            const row = {};

            headers.forEach((header, index) => {

                row[header.trim()] =
                    values[index]
                        ? values[index].trim()
                        : "";

            });

            return row;
        });


        console.log("Total records:", data.length);
        console.log("First accident:", data[0]);


        // ==========================================
        // DASHBOARD CALCULATIONS
        // ==========================================

        // Total accidents
        const totalAccidents = data.length;


        // Fatal accidents
        const fatalAccidents = data.filter(row =>

            row.accident_severity &&
            row.accident_severity.toLowerCase() === "fatal"

        ).length;


        // Total casualties
        const totalCasualties = data.reduce(

            (sum, row) => {

                return sum + Number(row.casualties || 0);

            },

            0

        );


        // Critical locations
        const criticalLocations = data.filter(row =>

            row.risk_category &&
            row.risk_category.toLowerCase() === "critical"

        ).length;


        // ==========================================
        // SHOW RESULTS IN CONSOLE
        // ==========================================

        console.log(
            "Total Accidents:",
            totalAccidents
        );

        console.log(
            "Fatal Accidents:",
            fatalAccidents
        );

        console.log(
            "Total Casualties:",
            totalCasualties
        );

        console.log(
            "Critical Locations:",
            criticalLocations
        );


        // ==========================================
        // UPDATE DASHBOARD
        // ==========================================

        updateDashboard(
            totalAccidents,
            fatalAccidents,
            totalCasualties,
            criticalLocations
        );


        // ==========================================
        // CREATE ANALYTICS CHART
        // ==========================================

        createAnalyticsCharts(data);

    })


    // ==========================================
    // ERROR HANDLING
    // ==========================================

    .catch(error => {

        console.error(
            "Error loading CSV:",
            error
        );

    });



// ==========================================
// UPDATE DASHBOARD CARDS
// ==========================================

function updateDashboard(
    totalAccidents,
    fatalAccidents,
    totalCasualties,
    criticalLocations
) {

    console.log("Dashboard updated");


    // Total accidents
    const totalAccidentsElement =
        document.getElementById("totalAccidents");

    if (totalAccidentsElement) {

        totalAccidentsElement.textContent =
            totalAccidents.toLocaleString();

    }


    // Fatal accidents
    const fatalAccidentsElement =
        document.getElementById("fatalAccidents");

    if (fatalAccidentsElement) {

        fatalAccidentsElement.textContent =
            fatalAccidents.toLocaleString();

    }


    // Total casualties
    const totalCasualtiesElement =
        document.getElementById("totalCasualties");

    if (totalCasualtiesElement) {

        totalCasualtiesElement.textContent =
            totalCasualties.toLocaleString();

    }


    // Critical locations
    const criticalLocationsElement =
        document.getElementById("criticalLocations");

    if (criticalLocationsElement) {

        criticalLocationsElement.textContent =
            criticalLocations.toLocaleString();

    }

}



// ==========================================
// CREATE ANALYTICS CHARTS
// ==========================================

function createAnalyticsCharts(data) {

    console.log("Creating analytics charts...");


    // ==========================================
    // 1. ACCIDENTS BY STATE
    // ==========================================

    const stateCounts = {};


    data.forEach(row => {

        const state = row.state;

        if (state) {

            stateCounts[state] =
                (stateCounts[state] || 0) + 1;

        }

    });


    // Sort states from highest to lowest
    const topStates = Object.entries(stateCounts)

        .sort((a, b) => b[1] - a[1])

        .slice(0, 10);


    console.log(
        "Top states:",
        topStates
    );


    // Find chart canvas
    const chartElement =
        document.getElementById(
            "accidentsByStateChart"
        );


    // Check whether canvas exists
    if (!chartElement) {

        console.error(
            "accidentsByStateChart canvas not found"
        );

        return;
    }


    // Check whether Chart.js loaded
    if (typeof Chart === "undefined") {

        console.error(
            "Chart.js is not loaded"
        );

        return;
    }


    // Create chart
    new Chart(

        chartElement,

        {

            type: "bar",

            data: {

                labels:
                    topStates.map(
                        item => item[0]
                    ),

                datasets: [

                    {

                        label: "Accidents",

                        data:
                            topStates.map(
                                item => item[1]
                            )

                    }

                ]

            },


            options: {

                responsive: true,

                maintainAspectRatio: false,


                plugins: {

                    legend: {

                        display: false

                    }

                },


                scales: {

                    y: {

                        beginAtZero: true

                    }

                }

            }

        }

    );


    console.log(
        "Accidents by State chart created successfully"
    );

    // ==============================
// MONTHLY ACCIDENT TREND
// ==============================

const monthCounts = {};

data.forEach(row => {

    if (!row.date) return;

    const date = new Date(row.date);

    if (isNaN(date)) return;

    const month = date.toLocaleString("en-US", {
        month: "short"
    });

    monthCounts[month] =
        (monthCounts[month] || 0) + 1;
});

const months = [
    "Jan", "Feb", "Mar", "Apr",
    "May", "Jun", "Jul", "Aug",
    "Sep", "Oct", "Nov", "Dec"
];

const monthlyValues = months.map(
    month => monthCounts[month] || 0
);

const monthlyCanvas =
    document.getElementById("monthlyAccidentChart");

if (monthlyCanvas) {

    const oldChart =
        Chart.getChart(monthlyCanvas);

    if (oldChart) {
        oldChart.destroy();
    }

    new Chart(monthlyCanvas, {

        type: "line",

        data: {

            labels: months,

            datasets: [{
                label: "Accidents",
                data: monthlyValues,
                tension: 0.4
            }]

        },

        options: {

            responsive: true,

            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false
                }
            },

            scales: {

                y: {
                    beginAtZero: true
                }

            }

        }

    });

    console.log(
        "Monthly Accident Trend created successfully"
    );
}

// ==========================================
// 3. SEVERITY DISTRIBUTION
// ==========================================

const severityCounts = {};

data.forEach(row => {

    const severity = row.accident_severity;

    if (severity) {
        severityCounts[severity] =
            (severityCounts[severity] || 0) + 1;
    }

});

const severityLabels = Object.keys(severityCounts);
const severityValues = Object.values(severityCounts);

new Chart(
    document.getElementById("severityDistributionChart"),
    {
        type: "doughnut",

        data: {
            labels: severityLabels,

            datasets: [{
                label: "Accidents",
                data: severityValues
            }]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    position: "bottom"
                }
            }
        }
    }
);

console.log("Severity Distribution chart created successfully");
// ==========================================
// 4. TOP ACCIDENT CAUSES
// ==========================================

const causeCounts = {};

data.forEach(row => {

    const cause = row.cause;

    if (cause) {
        causeCounts[cause] =
            (causeCounts[cause] || 0) + 1;
    }

});

const topCauses = Object.entries(causeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7);

new Chart(
    document.getElementById("topAccidentCausesChart"),
    {
        type: "bar",

        data: {
            labels: topCauses.map(item => item[0]),

            datasets: [{
                label: "Accidents",
                data: topCauses.map(item => item[1])
            }]
        },

        options: {
            indexAxis: "y",

            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false
                }
            },

            scales: {
                x: {
                    beginAtZero: true
                }
            }
        }
    }
);

console.log("Top Accident Causes chart created successfully");

// ==========================================
// 5. ROAD TYPE ANALYSIS
// ==========================================

const roadTypeCounts = {};

data.forEach(row => {

    const roadType = row.road_type;

    if (roadType) {
        roadTypeCounts[roadType] =
            (roadTypeCounts[roadType] || 0) + 1;
    }

});

const roadTypeLabels = Object.keys(roadTypeCounts);
const roadTypeValues = Object.values(roadTypeCounts);

new Chart(
    document.getElementById("roadTypeAnalysisChart"),
    {
        type: "bar",

        data: {
            labels: roadTypeLabels,

            datasets: [{
                label: "Accidents",
                data: roadTypeValues
            }]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false
                }
            },

            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    }
);

console.log("Road Type Analysis chart created successfully");

// ==========================================
// 6. TRAFFIC DENSITY
// ==========================================

const trafficCounts = {};

data.forEach(row => {

    const traffic = row.traffic_density;

    if (traffic) {
        trafficCounts[traffic] =
            (trafficCounts[traffic] || 0) + 1;
    }

});

const trafficLabels = Object.keys(trafficCounts);
const trafficValues = Object.values(trafficCounts);

new Chart(
    document.getElementById("trafficDensityChart"),
    {
        type: "bar",

        data: {
            labels: trafficLabels,

            datasets: [{
                label: "Accidents",
                data: trafficValues
            }]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false
                }
            },

            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    }
);

console.log("Traffic Density chart created successfully");
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

        const risk =
            (row.risk_category || "low")
                .toLowerCase()
                .trim();

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
                <b>Risk:</b> ${row.risk_category || "Unknown"}<br>
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

console.log(
    "Risk values:",
    [...new Set(
        allAccidentData.map(row => row["Risk Category"])
    )]
);

const filteredData = allAccidentData.filter(function (row) {

    const rowRisk = String(row["Risk Category"] || "")
        .toLowerCase()
        .trim();

    const selectedRisk = String(risk || "")
        .toLowerCase()
        .trim();

    return rowRisk === selectedRisk;
});

console.log("Risk selected:", risk);
console.log("Risk markers:", filteredData.length);

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

        const state = (row.state || "").toLowerCase().trim();
        const city = (row.city || "").toLowerCase().trim();
        const risk = (row.risk_category || "").toLowerCase().trim();
        const year = (row.year || "").toString().trim();

        const stateMatch =
            !selectedState ||
            state === selectedState.toLowerCase();

        const cityMatch =
            !selectedCity ||
            city === selectedCity.toLowerCase();

        const riskMatch =
            !selectedRisk ||
            risk === selectedRisk.toLowerCase();

        const yearMatch =
            !selectedYear ||
            year === selectedYear;

        return (
            stateMatch &&
            cityMatch &&
            riskMatch &&
            yearMatch
        );
    });

    displayAccidentMarkers(filteredData);

    console.log(
        "Filtered records:",
        filteredData.length
    );
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
                row.risk_category || "low"
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
                Risk: ${row.risk_category || "Unknown"}<br>
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
                row.risk_category || "low"
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
                Risk: ${row.risk_category || "Unknown"}<br>
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
        const risk = String(row.risk_category || "Unknown")
            .trim()
            .toLowerCase();

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