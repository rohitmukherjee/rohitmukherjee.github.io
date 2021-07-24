async function init() {
    const margin = {top: 10, right: 20, bottom: 30, left: 50},
        width = 800 - margin.left - margin.right,
        height = 600 - margin.top - margin.bottom;
    const data = await d3.csv("https://rohitmukherjee.github.io/data/1-annual-working-hours-vs-gdp-per-capita-pwt.csv");
    const year = 2015
    const filteredData = data.filter(function (d) {
        return d.year == year && d.total_population != "" && d.average_annual_hours_worked != "" && d.gdp_per_capita != "";
    });

    console.log(filteredData);
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
        .call(d3.axisBottom(x));

    // Add Y axis
    const y = d3.scaleLinear()
        .domain([1200, 2800])
        .range([height, 0]);
    svg.append("g")
        .call(d3.axisLeft(y));

    // Add a scale for bubble size
    const z = d3.scaleLog()
        .domain([200000, 1310000000])
        .range([1, 30]);

    // Add a scale for bubble color
    const myColor = d3.scaleOrdinal()
        .domain(["Asia", "Europe", "Americas", "Africa", "Oceania"])
        .range(d3.schemeSet2);

    // -1- Create a tooltip div that is hidden by default:
    var tooltip = d3.select("#chart-1")
        .append("div")
        .style("opacity", 0)
        .attr("class", "tooltip")
        .style("background-color", "black")
        .style("border-radius", "5px")
        .style("padding", "10px")
        .style("color", "white")

    // -2- Create 3 functions to show / update (when mouse move but stay on same circle) / hide the tooltip
    const showTooltip = function (d, i) {
        tooltip
            .transition()
            .duration(200)
        tooltip
            .style("opacity", 1)
            .html("Country: " + i.entity)
            .style("left", (d3.pointer(this)[0] + 30) + "px")
            .style("top", (d3.pointer(this)[1] + 30) + "px")
    }
    const moveTooltip = function (d) {
        tooltip
            .style("left", (d3.pointer(this)[0] + 30) + "px")
            .style("top", (d3.pointer(this)[1] + 30) + "px")
    }
    const hideTooltip = function (d) {
        tooltip
            .transition()
            .duration(200)
            .style("opacity", 0)
    }
    // Add dots
    svg.append('g')
        .selectAll("dot")
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
        .attr("r", function (d) {
            return z(Number(d.total_population));
        })
        .style("fill", function (d) {
            return myColor(d.continent);
        })
        // -3- Trigger the functions
        .on("mouseover", showTooltip)
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip)

}