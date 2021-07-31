// First Slide
async function renderFirstChart() {
    const margin = {top: 10, right: 20, bottom: 30, left: 50},
        width = 1000 - margin.left - margin.right,
        height = 800 - margin.top - margin.bottom;
    const data = await d3.csv("https://rohitmukherjee.github.io/data/1-annual-working-hours-vs-gdp-per-capita-pwt.csv");
    const year = 2015
    const filteredData = data.filter(function (d) {
        return d.year == year && d.total_population != "" && d.average_annual_hours_worked != "" && d.gdp_per_capita != "";
    });

    let svg = d3.select("#chart-1").append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform",
            "translate(" + margin.left + "," + margin.top + ")");

    // Add X axis
    const x = d3.scaleLinear()
        .domain([1000, 70000])
        .range([0, width]);
    svg.append("g")
        .attr("transform", "translate(0," + height + ")")
        .call(d3.axisBottom(x).tickFormat(d => d + " $/yr"));

    // Add Y axis
    const y = d3.scaleLinear()
        .domain([1200, 2800])
        .range([height, 0]);
    svg.append("g")
        .call(d3.axisLeft(y).tickFormat(d => d + " hr"));

    // Add a scale for bubble size
    const z = getBubbleSizeScale()

    // Add a scale for bubble color
    const myColor = d3.scaleOrdinal()
        .domain(getContinentKeys())
        .range(d3.schemeSet2);

    // -1- Create a tooltip div that is hidden by default:
    const tooltip = d3.select("#slide-1")
        .append("div")
        .style("opacity", 0)
        .attr("class", "tooltip")
        .style("background-color", "black")
        .style("border-radius", "5px")
        .style("padding", "10")
        .style("color", "white")
        .style("height", "50px")

    // Add dots
    svg.append('g')
        .selectAll("scatterplot-dot")
        .data(filteredData)
        .enter()
        .append("circle")
        .attr("class", "bubbles")
        .attr("cx", function (d) {
            return x(Number(d.gdp_per_capita));
        })
        .attr("cy", function (d) {
            return y(Number(d.average_annual_hours_worked));
        })
        .attr("id", function (d) {
            return "bubble-" + d.code;
        })
        .attr("r", function (d) {
            return z(Number(d.total_population));
        })
        .on("mouseover", function (event, d) {
            tooltip.transition()
                .duration(200)
                .style("opacity", .9);
            tooltip.html(firstChartTooltipHTML(d));
            tooltip.style("left", (event.pageX) + "px")
                .style("top", (event.pageY - 28) + "px")
        })
        .on("mouseout", function (d) {
            tooltip.transition()
                .duration(500)
                .style("opacity", 0);
        })
        .style("fill", function (d) {
            return myColor(d.continent);
        });
    renderLegend(svg, getContinentKeys(), width, myColor);
    countryCodesToAnnotate().forEach(function (countryCode) {
        for (let i = 0; i < filteredData.length; i++) {
            if (filteredData[i].code === countryCode) {
                const countryData = filteredData[i];
                renderFirstChartAnnotations(countryData, x(Number(countryData.gdp_per_capita)), y(Number(countryData.average_annual_hours_worked)), margin);
            }
        }
    })
}

function renderFirstChartAnnotations(d, x, y, margin) {
    const annotations = [
        {
            note: {
                label: d.total_population + " people $" + d.gdp_per_capita + "/year",
                lineType: "none",
                bgPadding: {"top": 15, "left": 10, "right": 10, "bottom": 10},
                title: d.entity,
                orientation: "leftRight",
                "align": "middle"
            },
            type: d3.annotationCallout,
            subject: {radius: 30},
            x: x,
            y: y,
            dx: 30,
            dy: 0
        },
    ];
    const makeAnnotations = d3.annotation().annotations(annotations);

    d3.select("svg")
        .append("g")
        .attr("transform",
            "translate(" + margin.left + "," + margin.top + ")")
        .attr("class", "annotation-group")
        .call(makeAnnotations)
}

function renderSecondChartAnnotations(d, x, y, margin) {
    const annotations = [
        {
            note: {
                label: d.total_population + " people   " + d.productivity + " $/hour",
                lineType: "none",
                bgPadding: {"top": 15, "left": 10, "right": 10, "bottom": 10},
                title: d.entity,
                orientation: "leftRight",
                "align": "middle"
            },
            type: d3.annotationCallout,
            subject: {radius: 30},
            x: x,
            y: y,
            dx: 30,
            dy: 0
        },
    ];
    const makeAnnotations = d3.annotation().annotations(annotations);

    d3.select("svg")
        .append("g")
        .attr("transform",
            "translate(" + margin.left + "," + margin.top + ")")
        .attr("class", "annotation-group")
        .call(makeAnnotations)
}

function firstChartTooltipHTML(object) {
    return "<div>" + object.entity + "</div><div>" + object.total_population + " people</div><div>$" + object.gdp_per_capita + "/year</div>";
}

function countryCodesToAnnotate() {
    return ["MMR", "FRA", "USA"]
}

// Second Slide
async function renderSecondChart() {
    const margin = {top: 10, right: 20, bottom: 30, left: 50},
        width = 1000 - margin.left - margin.right,
        height = 800 - margin.top - margin.bottom;
    const data = await d3.csv("https://rohitmukherjee.github.io/data/3-productivity-vs-annual-hours-worked.csv");
    const year = 2015
    const filteredData = data.filter(function (d) {
        return d.year == year && d.total_population != "" && d.average_annual_hours_worked != "" && d.productivity != "";
    });

    let svg = d3.select("#chart-2").append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform",
            "translate(" + margin.left + "," + margin.top + ")");

    // Add X axis
    const x = d3.scaleLinear()
        .domain([0, 100])
        .range([0, width]);
    svg.append("g")
        .attr("transform", "translate(0," + height + ")")
        .call(d3.axisBottom(x).tickFormat(d => d + " $/hr"));

    // Add Y axis
    const y = d3.scaleLinear()
        .domain([1200, 2800])
        .range([height, 0]);
    svg.append("g")
        .call(d3.axisLeft(y).tickFormat(d => d + " hr"));
    const z = getBubbleSizeScale();

    // Add a scale for bubble color
    const myColor = d3.scaleOrdinal()
        .domain(getContinentKeys())
        .range(d3.schemeSet2);

    // -1- Create a tooltip div that is hidden by default:
    var tooltip = d3.select("#chart-2")
        .append("div")
        .style("opacity", 0)
        .attr("class", "tooltip")
        .style("background-color", "black")
        .style("border-radius", "5px")
        .style("padding", "10px")
        .style("color", "white")

    // Add dots
    svg.append('g')
        .selectAll("dot")
        .data(filteredData)
        .enter()
        .append("circle")
        .attr("class", "bubbles")
        .attr("id", function (d) {
            return "bubble-" + d.code;
        })
        .attr("cx", function (d) {
            return x(Number(d.productivity));
        })
        .attr("cy", function (d) {
            return y(Number(d.average_annual_hours_worked));
        })
        .attr("r", function (d) {
            return z(Number(d.total_population));
        })
        .style("fill", function (d) {
            return myColor(d.continent);
        })
        // -3- Trigger the functions
        .on("mouseover", function (event, d) {
            tooltip.transition()
                .duration(200)
                .style("opacity", .9);
            tooltip.html(secondChartTooltipHTML(d));
            tooltip.style("left", (event.pageX) + "px")
                .style("top", (event.pageY - 28) + "px")
        })
        .on("mouseout", function (d) {
            tooltip.transition()
                .duration(500)
                .style("opacity", 0);
        })
        .style("fill", function (d) {
            return myColor(d.continent);
        });
    renderLegend(svg, getContinentKeys(), width, myColor);
    countryCodesToAnnotate().forEach(function (countryCode) {
        for (let i = 0; i < filteredData.length; i++) {
            if (filteredData[i].code === countryCode) {
                const countryData = filteredData[i];
                renderSecondChartAnnotations(countryData, x(Number(countryData.productivity)), y(Number(countryData.average_annual_hours_worked)), margin);
            }
        }
    })
}

function secondChartTooltipHTML(object) {
    return "<div>" + object.entity + "</div><div>" + object.total_population + " people</div><div>$" + object.productivity + "\/hour</div>";
}


// Third Slide
async function renderThirdChart() {
    const margin = {top: 10, right: 20, bottom: 30, left: 50},
        width = 800 - margin.left - margin.right,
        height = 600 - margin.top - margin.bottom;
    const data = await d3.csv("https://rohitmukherjee.github.io/data/4-labor-productivity-per-hour-PennWorldTable.csv");
    // append the svg object to the body of the page
    const svg = d3.select("#chart-3")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform",
            "translate(" + margin.left + "," + margin.top + ")");
    const filteredData = data.filter(function (d) {
        return d.productivity != "" && d.year != "";
    });

    const entities = getEntities();
    d3.select("#select-country")
        .selectAll('country-options')
        .data(entities)
        .enter()
        .append('option')
        .text(function (d) {
            return d;
        }) // text showed in the menu
        .attr("value", function (d) {
            return d;
        }) // corresponding value returned by the button


    // A color scale: one color for each group
    const myColor = d3.scaleOrdinal()
        .domain(entities)
        .range(d3.schemeSet2);

    // Add X axis to measure time
    const x = d3.scaleLinear()
        .domain([1950, 2017])
        .range([0, width]);
    svg.append("g")
        .attr("transform", "translate(0," + height + ")")
        .call(d3.axisBottom(x).tickFormat(d3.format("d")));
    // Add Y axis
    const y = d3.scaleLinear()
        .domain([0, 100])
        .range([height, 0]);
    svg.append("g")
        .call(d3.axisLeft(y).tickFormat(d => d + " $/hr"));

    // Initialize line with group a
    const line = svg
        .append('g')
        .append("path")
        .attr("id", "line-" + entities[0])
        .datum(filteredData.filter(function (d) {
            return d.entity === entities[0];
        }))
        .attr("d", d3.line()
            .x(function (d) {
                return x(Number(d.year))
            })
            .y(function (d) {
                return y(Number(d.productivity))
            })
        )
        .attr("stroke", function (d) {
            return myColor(d.entity)
        })
        .style("stroke-width", 4)
        .style("fill", "none")

    function update(selectedGroup) {
        // Create new data with the selection?
        const dataFilter = filteredData.filter(function (d) {
            return d.entity === selectedGroup;
        });

        // Give these new data to update line
        line
            .datum(dataFilter)
            .transition()
            .duration(1000)
            .attr("id", "line-" + selectedGroup)
            .attr("d", d3.line()
                .x(function (d) {
                    return x(Number(d.year))
                })
                .y(function (d) {
                    return y(Number(d.productivity))
                })
            )
            .attr("stroke", function (d) {
                return myColor(selectedGroup)
            })
    }

    // When the button is changed, run the updateChart function
    d3.select("#select-country").on("change", function (d) {
        // recover the option that has been chosen
        const selectedOption = d3.select(this).property("value")
        // run the updateChart function with this selected option
        update(selectedOption)
    })

}

// Fourth slide
function renderFourthChart() {
    // The svg
    const svg = d3.select("svg"),
        width = +svg.attr("width"),
        height = +svg.attr("height");

// Map and projection
    const projection = d3.geoMercator()
        .scale(70)
        .center([0, 20])
        .translate([width / 2, height / 2]);

    const tooltip = d3.select("#slide-4")
        .append("div")
        .style("opacity", 0)
        .attr("class", "tooltip")
        .style("background-color", "black")
        .style("border-radius", "5px")
        .style("padding", "10")
        .style("color", "white")
        .style("height", "50px")

// Data and color scale
    let data = new Map()
    const colorScale = d3.scaleOrdinal()
        .domain(getContinentKeys())
        .range(d3.schemeSet2);

// Load external data and boot
    Promise.all([
        d3.json("https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson"),
        d3.csv("https://rohitmukherjee.github.io/data/1-annual-working-hours-vs-gdp-per-capita-pwt.csv", function (d) {
            if (d.year == 2015) {
                data.set(d.code,
                    {
                        year: d.year,
                        gdp_per_capita: Number(d.gdp_per_capita),
                        name: d.entity,
                        continent: d.continent
                    });
            }
        })
    ]).then(function (loadData) {
        let topo = loadData[0]

        // Draw the map
        svg.append("g")
            .selectAll("path")
            .data(topo.features)
            .join("path")
            // draw each country
            .attr("d", d3.geoPath()
                .projection(projection)
            )
            // set the color of each country
            .attr("fill", function (d) {
                if (!data.has(d.id)) {
                    return 0;
                } else {
                    return colorScale(data.get(d.id).continent);
                }
            })
            .on("mouseover", function (event, d) {
                tooltip.transition()
                    .duration(200)
                    .style("opacity", .9);
                tooltip.html(fourthChartTooltipHTML(data.get(d.id)));
                tooltip.style("left", (event.pageX) + "px")
                    .style("top", (event.pageY - 28) + "px")
            })
            .on("mouseout", function (d) {
                tooltip.transition()
                    .duration(500)
                    .style("opacity", 0);
            })
    })

}

function fourthChartTooltipHTML(d) {
    return d.name + " $" + d.gdp_per_capita;
}

// Common functions
function getBubbleSizeScale() {
    // Add a scale for bubble size
    const z = d3.scaleLog()
        .domain([200000, 1310000000])
        .range([1, 30]);
    return z;
}

function renderLegend(svg, continentKeys, width, myColor) {
    // Add one dot in the legend for each name.
    svg.selectAll("legend-dots")
        .data(continentKeys)
        .enter()
        .append("circle")
        .attr("cx", width - 100)
        .attr("cy", function (d, i) {
            return 50 + i * 25
        }) // 100 is where the first dot appears. 25 is the distance between dots
        .attr("r", 2)
        .style("fill", function (d) {
            return myColor(d)
        })

    svg.selectAll("legend-labels")
        .data(continentKeys)
        .enter()
        .append("text")
        .attr("x", width + 8 - 100)
        .attr("y", function (d, i) {
            return 50 + i * 25
        }) // 100 is where the first dot appears. 25 is the distance between dots
        .style("fill", function (d) {
            return myColor(d)
        })
        .text(function (d) {
            return d
        })
        .attr("text-anchor", "left")
        .style("alignment-baseline", "middle")
}

function getContinentKeys() {
    return ["Asia", "Europe", "North America", "South America", "Africa", "Oceania"];
}

function getEntities() {
    return ["Argentina", "Australia", "Austria", "Bangladesh", "Barbados", "Belgium", "Brazil", "Bulgaria", "Cambodia", "Canada", "Chile", "China",
        "Colombia", "Costa Rica", "Croatia", "Cyprus", "Czechia", "Denmark", "Ecuador", "Estonia", "Finland", "France", "Germany", "Greece", "Hong Kong",
        "Hungary", "Iceland", "India", "Indonesia", "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Latvia", "Lithuania", "Luxembourg", "Malaysia", "Malta",
        "Mexico", "Myanmar", "Netherlands", "New Zealand", "Nigeria", "Norway", "Pakistan", "Peru", "Philippines", "Poland", "Portugal", "Romania", "Russia",
        "Saint Lucia", "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain", "Sri Lanka",
        "Sweden", "Switzerland", "Taiwan", "Thailand", "Trinidad and Tobago", "Turkey", "United Kingdom", "United States", "Uruguay", "Venezuela", "Vietnam"]
}


