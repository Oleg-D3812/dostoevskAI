// Draws a playground result: Plotly for line/bar/scatter/scatter3d, a
// sortable HTML table for "table". Plotly is loaded lazily on first use.
(function(global) {
  "use strict";

  var PLOTLY_URL = "https://cdn.plot.ly/plotly-3.7.0.min.js";
  var MAX_TABLE_ROWS = 500;
  var plotlyPromise = null;

  function loadPlotly() {
    if (global.Plotly) return Promise.resolve(global.Plotly);
    if (!plotlyPromise) plotlyPromise = new Promise(function(resolve, reject) {
      var script = document.createElement("script");
      script.src = PLOTLY_URL;
      script.onload = function() { resolve(global.Plotly); };
      script.onerror = function() { plotlyPromise = null; reject(new Error("Не удалось загрузить Plotly")); };
      document.head.appendChild(script);
    });
    return plotlyPromise;
  }

  function getCss(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function escapeHtml(v) { var d = document.createElement("div"); d.textContent = v == null ? "" : String(v); return d.innerHTML; }

  function formatValue(v) {
    if (v == null || v === "") return "—";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
    return String(v);
  }

  // Break long quotes into lines so Plotly hover boxes stay readable.
  function wrap(text, width) {
    var words = String(text == null ? "" : text).split(/\s+/), lines = [], line = "";
    words.forEach(function(w) {
      if (line && (line + " " + w).length > width) { lines.push(line); line = w; } else line = line ? line + " " + w : w;
    });
    if (line) lines.push(line);
    return lines.map(escapeHtml).join("<br>");
  }

  function fieldLabel(fields, name) {
    var f = fields.find(function(item) { return item.name === name; });
    return f ? f.label : name;
  }

  function groupRows(rows, colorField) {
    if (!colorField) return [{ name: "", rows: rows }];
    var groups = new Map();
    rows.forEach(function(r) {
      var key = r[colorField] == null ? "—" : String(r[colorField]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    return Array.from(groups, function(entry) { return { name: entry[0], rows: entry[1] }; });
  }

  function scaleSizes(rows, sizeField) {
    var values = rows.map(function(r) { return Number(r[sizeField]); }).filter(function(v) { return !isNaN(v); });
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    return function(v) { return max > min ? 6 + 20 * (Number(v) - min) / (max - min) : 10; };
  }

  function renderPlot(el, spec, rows, fields, colors) {
    var chart = spec.chart;
    var palette = (colors && chart.color && colors[chart.color]) || {};
    var sizeOf = chart.size ? scaleSizes(rows, chart.size) : null;
    var is3d = chart.type === "scatter3d";
    var xIsNumber = (fields.find(function(f) { return f.name === chart.x; }) || {}).type === "number";

    var hoverLines = [];
    if (chart.color) hoverLines.push("<b>%{fullData.name}</b>");
    if (chart.text) hoverLines.push("%{customdata}");
    hoverLines.push(escapeHtml(fieldLabel(fields, chart.x)) + ": %{x}");
    hoverLines.push(escapeHtml(fieldLabel(fields, chart.y)) + ": %{y}");
    if (is3d) hoverLines.push(escapeHtml(fieldLabel(fields, chart.z)) + ": %{z}");
    var hovertemplate = hoverLines.join("<br>") + "<extra></extra>";

    var traces = groupRows(rows, chart.color).map(function(group) {
      var gRows = group.rows;
      if (chart.type === "line" && xIsNumber) gRows = gRows.slice().sort(function(a, b) { return AtlasPlaygroundEngine.compare(a[chart.x], b[chart.x]); });
      var trace = {
        name: group.name,
        x: gRows.map(function(r) { return r[chart.x]; }),
        y: gRows.map(function(r) { return r[chart.y]; }),
        hovertemplate: hovertemplate
      };
      if (chart.text) trace.customdata = gRows.map(function(r) { return wrap(r[chart.text], 60); });
      var color = palette[group.name];
      if (chart.type === "bar") {
        trace.type = "bar";
        if (color) trace.marker = { color: color };
      } else {
        trace.type = is3d ? "scatter3d" : "scatter";
        trace.mode = chart.type === "line" ? "lines+markers" : "markers";
        trace.marker = { size: sizeOf ? gRows.map(function(r) { return sizeOf(r[chart.size]); }) : (is3d ? 4 : 7), opacity: chart.type === "line" ? 1 : 0.78 };
        if (color) { trace.marker.color = color; trace.line = { color: color }; }
        if (is3d) trace.z = gRows.map(function(r) { return r[chart.z]; });
      }
      return trace;
    });

    var text = getCss("--text-color"), muted = getCss("--text-muted"), grid = getCss("--border-color");
    function axis(name) { return { title: { text: fieldLabel(fields, name) }, gridcolor: grid, zerolinecolor: grid, color: muted }; }
    var layout = {
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, system-ui, sans-serif", color: text, size: 12 },
      margin: { l: 56, r: 16, t: 16, b: 56 },
      showlegend: !!chart.color, legend: { orientation: "h", y: -0.2 },
      hoverlabel: { align: "left" },
      barmode: chart.color ? "stack" : "group"
    };
    if (is3d) {
      layout.margin = { l: 0, r: 0, t: 0, b: 0 };
      layout.scene = { xaxis: axis(chart.x), yaxis: axis(chart.y), zaxis: axis(chart.z) };
      layout.legend.y = 0;
    } else {
      // automargin only on 2D axes: in a 3D scene it shrinks the plot to a speck.
      layout.xaxis = axis(chart.x); layout.yaxis = axis(chart.y);
      layout.xaxis.automargin = layout.yaxis.automargin = true;
      // Keep the engine's row order for categorical axes (e.g. sorted bars).
      if (!xIsNumber) layout.xaxis.categoryorder = "trace";
    }
    return loadPlotly().then(function(Plotly) {
      Plotly.purge(el);
      el.innerHTML = "";
      el.classList.add("playground-plot");
      return Plotly.newPlot(el, traces, layout, { responsive: true, displaylogo: false });
    });
  }

  function renderTable(el, spec, rows, fields) {
    var byName = {};
    fields.forEach(function(f) { byName[f.name] = f; });
    var columns = (spec.chart.columns && spec.chart.columns.length ? spec.chart.columns : fields.map(function(f) { return f.name; }))
      .filter(function(name) { return byName[name]; });
    var sortState = null;

    function draw() {
      var shown = rows;
      if (sortState) shown = rows.slice().sort(function(a, b) {
        return AtlasPlaygroundEngine.compare(a[sortState.field], b[sortState.field], sortState.dir);
      });
      shown = shown.slice(0, MAX_TABLE_ROWS);
      var html = '<div class="playground-table-wrap"><table class="playground-table"><thead><tr><th>#</th>' +
        columns.map(function(name) {
          var mark = sortState && sortState.field === name ? (sortState.dir === "desc" ? " ↓" : " ↑") : "";
          return '<th data-field="' + escapeHtml(name) + '" title="' + escapeHtml(byName[name].description || "") + '">' + escapeHtml(byName[name].label) + mark + "</th>";
        }).join("") + "</tr></thead><tbody>" +
        shown.map(function(r, i) {
          return "<tr><td>" + (i + 1) + "</td>" + columns.map(function(name) {
            var v = formatValue(r[name]);
            var cls = byName[name].type === "number" ? ' class="num"' : "";
            if (v.length > 160) return "<td" + cls + ' title="' + escapeHtml(v) + '">' + escapeHtml(v.slice(0, 160)) + "…</td>";
            return "<td" + cls + ">" + escapeHtml(v) + "</td>";
          }).join("") + "</tr>";
        }).join("") + "</tbody></table></div>";
      if (rows.length > MAX_TABLE_ROWS) html += '<p class="playground-note">Показаны первые ' + MAX_TABLE_ROWS + " строк из " + rows.length + ". Добавьте фильтр или лимит.</p>";
      el.innerHTML = html;
      el.querySelectorAll("th[data-field]").forEach(function(th) {
        th.addEventListener("click", function() {
          var f = th.dataset.field;
          sortState = sortState && sortState.field === f ? { field: f, dir: sortState.dir === "desc" ? "asc" : "desc" } : { field: f, dir: "desc" };
          draw();
        });
      });
    }
    if (global.Plotly) global.Plotly.purge(el);
    el.classList.remove("playground-plot");
    draw();
    return Promise.resolve();
  }

  function render(el, spec, rows, fields, colors) {
    if (spec.chart.type === "table") return renderTable(el, spec, rows, fields);
    return renderPlot(el, spec, rows, fields, colors);
  }

  global.AtlasPlaygroundRender = { render: render, formatValue: formatValue, loadPlotly: loadPlotly };
})(window);
