(function() {
  "use strict";

  var DATA_ROOT = "../data/";
  var requestedNovelId = new URLSearchParams(window.location.search).get("novel");
  var plot = document.getElementById("cluster-plot");
  var clusterFilter = document.getElementById("cluster-filter");
  var allButton = document.getElementById("clusters-all");
  var noneButton = document.getElementById("clusters-none");
  var tableBody = document.querySelector("#centroid-table tbody");
  var datasetCount = document.getElementById("dataset-count");
  var clusterPalette = [
    "#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
    "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52"
  ];
  var state = {
    characters: [],
    chapters: [],
    clusters: [],
    fragments: [],
    traceGroups: {}
  };

  document.querySelectorAll(".view-tab-btn").forEach(function(button) {
    button.addEventListener("click", function() { setView(button.dataset.view); });
  });

  function setView(view) {
    document.querySelectorAll(".view-tab-btn").forEach(function(button) {
      var active = button.dataset.view === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".view-panel").forEach(function(panel) {
      panel.classList.toggle("active", panel.id === "view-" + view);
    });
    if (view === "chart" && window.Plotly) Plotly.Plots.resize(plot);
  }

  AtlasData.loadNovelContext(requestedNovelId, { catalogUrl: DATA_ROOT + "catalog.json" }).then(function(context) {
    state.manifest = context.novelManifest;
    state.base = context.dataBaseUrl;
    var backLink = document.getElementById("back-link");
    if (backLink) backLink.href = "../novel.html?id=" + encodeURIComponent(context.novel.id) + "&feature=emotion-vad";
    return Promise.all([
      fetchJson(state.base + state.manifest.files.characters),
      fetchJson(state.base + state.manifest.files.chapters),
      fetchJson(state.base + state.manifest.files.clusters)
    ]);
  })
    .then(function(results) {
      state.characters = results[0].characters || [];
      state.chapters = results[1].chapters || [];
      state.clusters = results[2].clusters || [];
      return loadFragments();
    })
    .then(function(fragments) {
      state.fragments = fragments;
      renderControls();
      renderTable();
      renderPlot();
    })
    .catch(function(error) {
      plot.innerHTML = '<div class="error-state">Не удалось загрузить данные: ' +
        escapeHtml(error.message) + '</div>';
    });

  function loadFragments() {
    var requests = [];
    state.characters.forEach(function(character) {
      state.chapters.forEach(function(chapter) {
        if ((chapter.character_counts[character.id] || 0) < 1) return;
        var path = state.base + character.fragments_path_template.replace("{chapter_id}", chapter.id);
        requests.push(
          fetchJson(path).then(function(data) {
            return (data.fragments || []).map(function(fragment) {
              fragment.character_id = data.character_id || character.id;
              fragment.chapter_id = data.chapter_id || chapter.id;
              return fragment;
            });
          })
        );
      });
    });

    return Promise.all(requests).then(function(groups) {
      return groups.reduce(function(all, group) { return all.concat(group); }, []);
    });
  }

  function renderControls() {
    clusterFilter.innerHTML = state.clusters.map(function(cluster) {
      var color = clusterColor(cluster);
      return '<label><input type="checkbox" class="cluster-toggle" data-cluster="' +
        escapeHtml(cluster.id) + '" checked> <span style="--swatch:' +
        escapeHtml(color) + '">' + escapeHtml(cluster.display_id + " — " + cluster.name) + '</span></label>';
    }).join("");

    document.querySelectorAll(".cluster-toggle").forEach(function(toggle) {
      toggle.addEventListener("change", applyVisibility);
    });
    allButton.addEventListener("click", function() { setClusters(true); });
    noneButton.addEventListener("click", function() { setClusters(false); });
  }

  function renderTable() {
    var charactersById = indexBy(state.characters, "id");
    tableBody.innerHTML = state.clusters.map(function(cluster) {
      var character = charactersById[cluster.character_id] || {};
      var color = clusterColor(cluster);
      return '<tr>' +
        '<td><span class="table-swatch" style="--swatch:' + escapeHtml(color) + '"></span>' +
          escapeHtml(cluster.display_id + " — " + cluster.name) + '</td>' +
        '<td>' + escapeHtml(character.label || cluster.character_id) + '</td>' +
        '<td>' + formatNumber(cluster.centroid[0]) + '</td>' +
        '<td>' + formatNumber(cluster.centroid[1]) + '</td>' +
        '<td>' + formatNumber(cluster.centroid[2]) + '</td>' +
        '<td>' + cluster.size.toLocaleString("ru-RU") + '</td>' +
      '</tr>';
    }).join("");

    datasetCount.textContent = state.fragments.length.toLocaleString("ru-RU") + " фрагментов";
  }

  function renderPlot() {
    plot.innerHTML = "";
    var traces = [];
    var layout = {
      title: { text: "" },
      margin: { l: 24, r: 24, t: 28, b: 24 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, system-ui, sans-serif", color: getCss("--text-color") },
      showlegend: false,
      scene: sceneLayout(),
      xaxis: axisLayout("Valence (V)", [0.72, 1]),
      yaxis: axisLayout("Arousal (A)", [0.69, 1]),
      xaxis2: axisLayout("Valence (V)", [0.72, 1]),
      yaxis2: axisLayout("Dominance (D)", [0.345, 0.655]),
      xaxis3: axisLayout("Arousal (A)", [0.72, 1]),
      yaxis3: axisLayout("Dominance (D)", [0, 0.31])
    };

    addCoordinateFrame(traces);
    state.traceGroups = {};
    state.clusters.forEach(function(cluster) {
      var fragments = state.fragments.filter(function(fragment) {
        return fragment.cluster_id === cluster.id;
      });
      if (!fragments.length) return;

      state.traceGroups[cluster.id] = [];
      addClusterTraces(traces, cluster, fragments);
    });

    Plotly.newPlot(plot, traces, layout, { responsive: true, displaylogo: false });
  }

  function addCoordinateFrame(traces) {
    var axisColor = "rgba(125,132,137,.75)";
    var gridColor = "rgba(125,132,137,.5)";
    var axisTraces = [
      { name: "V axis", x: [-1, 1], y: [0, 0], z: [0, 0] },
      { name: "A axis", x: [0, 0], y: [-1, 1], z: [0, 0] },
      { name: "D axis", x: [0, 0], y: [0, 0], z: [-1, 1] }
    ];

    axisTraces.forEach(function(axis) {
      traces.push({
        type: "scatter3d",
        mode: "lines",
        name: axis.name,
        x: axis.x,
        y: axis.y,
        z: axis.z,
        line: { color: axisColor, width: 4 },
        showlegend: false,
        hoverinfo: "skip"
      });
    });

    [
      centerGridTrace("VA", "z", gridColor),
      centerGridTrace("VD", "y", gridColor),
      centerGridTrace("AD", "x", gridColor)
    ].forEach(function(trace) {
      traces.push(trace);
    });

    [
      centerPlaneTrace("VA plane", [[-1, 1], [-1, 1]], [[-1, -1], [1, 1]], [[0, 0], [0, 0]], "#dce7f5"),
      centerPlaneTrace("VD plane", [[-1, 1], [-1, 1]], [[0, 0], [0, 0]], [[-1, -1], [1, 1]], "#e3f0e5"),
      centerPlaneTrace("AD plane", [[0, 0], [0, 0]], [[-1, 1], [-1, 1]], [[-1, -1], [1, 1]], "#f4e5df")
    ].forEach(function(trace) {
      traces.push(trace);
    });

    traces.push({
      type: "scatter3d",
      mode: "markers",
      name: "origin",
      x: [0],
      y: [0],
      z: [0],
      marker: { size: 4, color: getCss("--text-color"), symbol: "diamond" },
      showlegend: false,
      hovertemplate: "origin (0, 0, 0)<extra></extra>"
    });
  }

  function centerGridTrace(label, fixedAxis, color) {
    var values = [-1, -.75, -.5, -.25, .25, .5, .75, 1];
    var x = [];
    var y = [];
    var z = [];

    values.forEach(function(tick) {
      if (fixedAxis === "z") {
        x.push(-1, 1, null, tick, tick, null);
        y.push(tick, tick, null, -1, 1, null);
        z.push(0, 0, null, 0, 0, null);
      } else if (fixedAxis === "y") {
        x.push(-1, 1, null, tick, tick, null);
        y.push(0, 0, null, 0, 0, null);
        z.push(tick, tick, null, -1, 1, null);
      } else {
        x.push(0, 0, null, 0, 0, null);
        y.push(-1, 1, null, tick, tick, null);
        z.push(tick, tick, null, -1, 1, null);
      }
    });

    return {
      type: "scatter3d",
      mode: "lines",
      name: label,
      x: x,
      y: y,
      z: z,
      line: { color: color, width: 1 },
      showlegend: false,
      hoverinfo: "skip"
    };
  }

  function centerPlaneTrace(name, x, y, z, color) {
    return {
      type: "surface",
      name: name,
      x: x,
      y: y,
      z: z,
      surfacecolor: [[0, 0], [0, 0]],
      colorscale: [[0, color], [1, color]],
      showscale: false,
      opacity: .18,
      showlegend: false,
      hoverinfo: "skip",
      lighting: { ambient: 1, diffuse: 0, specular: 0 }
    };
  }

  function addClusterTraces(traces, cluster, fragments) {
    var character = state.characters.find(function(item) { return item.id === cluster.character_id; }) || {};
    var label = cluster.display_id + " — " + cluster.name;
    var hover = fragments.map(function(fragment) {
      var chapter = state.chapters.find(function(item) { return item.id === fragment.chapter_id; });
      return escapeHtml(fragment.id) + "<br>" +
        escapeHtml(character.name || cluster.character_id) + " · " +
        escapeHtml(chapter ? chapter.label : fragment.chapter_id) + "<br>" +
        escapeHtml(label) + "<br>" +
        "position " + fragment.character_position + " · distance " + formatNumber(fragment.distance_to_centroid) + "<br>" +
        escapeHtml(fragment.text);
    });
    var x = fragments.map(function(fragment) { return fragment.vad[0]; });
    var y = fragments.map(function(fragment) { return fragment.vad[1]; });
    var z = fragments.map(function(fragment) { return fragment.vad[2]; });
    var color = clusterColor(cluster);
    var marker = { size: 2.7, opacity: .74, color: color, symbol: "circle" };

    pushTrace({
      type: "scatter3d",
      mode: "markers",
      name: label,
      legendgroup: cluster.id,
      x: x,
      y: y,
      z: z,
      text: hover,
      marker: marker,
      customdata: fragments.map(function() { return [cluster.id, cluster.character_id]; }),
      hovertemplate: "%{text}<br>V %{x:.3f} · A %{y:.3f} · D %{z:.3f}<extra></extra>"
    }, cluster.id, traces);

    pushTrace(projectionTrace(label, cluster, x, y, hover, "x", "y"), cluster.id, traces);
    pushTrace(projectionTrace(label, cluster, x, z, hover, "x2", "y2"), cluster.id, traces);
    pushTrace(projectionTrace(label, cluster, y, z, hover, "x3", "y3"), cluster.id, traces);

    addCentroidTraces(traces, cluster, label);
  }

  function addCentroidTraces(traces, cluster, label) {
    var color = clusterColor(cluster);
    var cx = cluster.centroid[0];
    var cy = cluster.centroid[1];
    var cz = cluster.centroid[2];
    var hover = escapeHtml(label) + " centroid<br>V " + formatNumber(cx) +
      " · A " + formatNumber(cy) + " · D " + formatNumber(cz) + "<extra></extra>";
    var outline = getCss("--text-color");

    pushTrace({
      type: "scatter3d",
      mode: "markers",
      name: label + " centroid",
      legendgroup: cluster.id,
      showlegend: false,
      x: [cx],
      y: [cy],
      z: [cz],
      marker: { size: 5, symbol: "cross", color: color, line: { color: outline, width: .5 } },
      hovertemplate: hover
    }, cluster.id, traces);

    pushTrace(centroidProjectionTrace(cx, cy, "x", "y", color, hover, cluster.id), cluster.id, traces);
    pushTrace(centroidProjectionTrace(cx, cz, "x2", "y2", color, hover, cluster.id), cluster.id, traces);
    pushTrace(centroidProjectionTrace(cy, cz, "x3", "y3", color, hover, cluster.id), cluster.id, traces);
  }

  function centroidProjectionTrace(x, y, xaxis, yaxis, color, hover, clusterId) {
    return {
      type: "scattergl",
      mode: "markers",
      name: "centroid",
      legendgroup: clusterId,
      showlegend: false,
      x: [x],
      y: [y],
      xaxis: xaxis,
      yaxis: yaxis,
      marker: { size: 13, symbol: "cross-thin", line: { color: color, width: 1.5 } },
      hovertemplate: hover
    };
  }

  function pushTrace(trace, clusterId, traces) {
    state.traceGroups[clusterId].push(traces.length);
    traces.push(trace);
  }

  function projectionTrace(label, cluster, x, y, hover, xaxis, yaxis) {
    return {
      type: "scattergl",
      mode: "markers",
      name: label,
      legendgroup: cluster.id,
      showlegend: false,
      x: x,
      y: y,
      xaxis: xaxis,
      yaxis: yaxis,
      text: hover,
      marker: { size: 3.3, opacity: .64, color: clusterColor(cluster) },
      hovertemplate: "%{text}<br>%{x:.3f} · %{y:.3f}<extra></extra>"
    };
  }

  function clusterColor(cluster) {
    var index = state.clusters.findIndex(function(item) { return item.id === cluster.id; });
    return clusterPalette[(index < 0 ? 0 : index) % clusterPalette.length];
  }

  function applyVisibility() {
    var indices = [];
    var visible = [];
    Object.keys(state.traceGroups).forEach(function(clusterId) {
      var isVisible = clusterEnabled(clusterId);
      state.traceGroups[clusterId].forEach(function(index) {
        indices.push(index);
        visible.push(isVisible);
      });
    });
    Plotly.restyle(plot, { visible: visible }, indices);
  }

  function setClusters(value) {
    document.querySelectorAll(".cluster-toggle").forEach(function(toggle) {
      toggle.checked = value;
    });
    applyVisibility();
  }

  function clusterEnabled(clusterId) {
    var toggle = document.querySelector('.cluster-toggle[data-cluster="' + cssEscape(clusterId) + '"]');
    return toggle ? toggle.checked : true;
  }

  function sceneLayout() {
    return {
      domain: { x: [0, 0.66], y: [0, 1] },
      xaxis: sceneAxis("Valence (V)"),
      yaxis: sceneAxis("Arousal (A)"),
      zaxis: sceneAxis("Dominance (D)"),
      camera: { eye: { x: 1.45, y: 1.45, z: 1.15 } },
      aspectmode: "cube"
    };
  }

  function sceneAxis(title) {
    return {
      title: { text: title },
      range: [-1.05, 1.05],
      showgrid: false,
      zeroline: false,
      showspikes: false,
      backgroundcolor: "rgba(0,0,0,0)",
      color: getCss("--text-muted")
    };
  }

  function axisLayout(title, domain) {
    return {
      title: { text: title },
      domain: domain,
      range: [-1.05, 1.05],
      zeroline: true,
      zerolinewidth: 1,
      zerolinecolor: getCss("--border-color"),
      gridcolor: getCss("--border-color"),
      color: getCss("--text-muted")
    };
  }

  function fetchJson(path) {
    return fetch(path).then(function(response) {
      if (!response.ok) throw new Error("HTTP " + response.status + ": " + path);
      return response.json();
    });
  }

  function indexBy(items, key) {
    return items.reduce(function(map, item) {
      map[item[key]] = item;
      return map;
    }, {});
  }

  function getCss(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  function formatNumber(value) {
    return Number(value).toFixed(3).replace("-0.000", "0.000");
  }

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }
})();
