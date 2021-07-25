async function renderFirstChart() {
    const margin = {top: 10, right: 20, bottom: 30, left: 50},
        width = 800 - margin.left - margin.right,
        height = 600 - margin.top - margin.bottom;
    const data = await d3.csv("https://rohitmukherjee.github.io/data/3-productivity-vs-annual-hours-worked.csv");
    const year = 2015
    const filteredData = data.filter(function (d) {
        return d.year == year && d.total_population != "" && d.average_annual_hours_worked != "" && d.productivity != "";
    });

    console.log(filteredData);
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
        .domain(["Asia", "Europe", "North America", "South America", "Africa", "Oceania"])
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
            tooltip.html(tooltipHTML(d));
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

}

function tooltipHTML(object) {
    return "<div>Country: " + object.entity + "</div><div>Population: " + object.total_population + "</div><div>Productivity: $" + object.productivity + "\/hour</div>";
}