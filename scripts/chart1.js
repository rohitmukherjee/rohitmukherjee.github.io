async function init() {
    const height = 200;
    const margin = 50;
    const data = await d3.csv("https://flunky.github.io/cars2017.csv");
    let svg = d3.selectAll("svg");

    svg.append("g").attr("transform", "translate(" + margin + "," + margin + ")")
    var yScale = d3.scaleLog()
        .domain([10, 150])
        .range([height, 0])
        .base(10);
    const xScale = d3.scaleLog()
        .domain([10, 150])
        .range([0, height])
        .base(10);
    // Add dots
    svg.selectAll("dot")
        .data(data)
        .enter()
        .append("circle")
        .attr("cx", function (d) {
            return xScale(d.AverageCityMPG);
        })
        .attr("cy", function (d) {
            return yScale(d.AverageHighwayMPG);
        })
        .attr("r", function (d) {
            return parseInt(d.EngineCylinders) + 2;
        });
    // Add Y axis
    svg.append("g")
        .attr("transform", "translate(" + margin + "," + margin + ")")
        .call(d3.axisLeft(yScale).tickValues([10, 20, 50, 100]).tickFormat(d3.format("~s")));
    // Add X axis
    svg.append("g")
        .attr("transform", "translate(" + margin + "," + (height + margin) + ")")
        .call(d3.axisBottom(xScale).tickValues([10, 20, 50, 100]).tickFormat(d3.format("~s")));
}

