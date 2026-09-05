(function() {
  "use strict";

  var DATA_ROOT = "../data/";
  var params = new URLSearchParams(window.location.search);
  var requestedNovelId = params.get("novel");
  var plot = document.getElementById("vad-plot");
  var radar8 = document.getElementById("radar-8");
  var radar16 = document.getElementById("radar-16");
  var characterSelect = document.getElementById("character-select");
  var chapterSelect = document.getElementById("chapter-select");
  var aggregationSelect = document.getElementById("aggregation-select");
  var spheresCheck = document.getElementById("show-spheres");
  var status = document.getElementById("dashboard-status");
  var backLink = document.getElementById("back-link");
  var state = { root: null, manifest: null, characters: [], chapters: [], clusters: [], profiles: {}, fragments: [], traceIndices: [], sphereIndices: [], request: 0 };

  AtlasData.loadNovelContext(requestedNovelId, { catalogUrl: DATA_ROOT + "catalog.json" })
    .then(function(context) {
      var manifest = context.novelManifest;
        state.manifest = manifest;
        state.base = context.dataBaseUrl;
        var title = AtlasData.localized(context.novel.title);
        document.title = title + " — VAD и Plutchik";
        backLink.href = "../novel.html?id=" + encodeURIComponent(context.novel.id) + "&feature=emotion-vad";
        backLink.textContent = "← " + title;
        return Promise.all([
          fetchJson(state.base + manifest.files.characters),
          fetchJson(state.base + manifest.files.chapters),
          fetchJson(state.base + manifest.files.clusters)
        ]);
    })
    .then(function(results) {
      state.characters = results[0].characters || [];
      state.chapters = results[1].chapters || [];
      state.clusters = results[2].clusters || [];
      return Promise.all(state.characters.map(function(character) {
        return fetchJson(state.base + character.profile_path).then(function(profile) {
          state.profiles[character.id] = profile;
        });
      }));
    })
    .then(function() {
      renderControls();
      characterSelect.disabled = false;
      chapterSelect.disabled = false;
      refreshChapters();
      loadSelection();
    })
    .catch(function(error) {
      plot.innerHTML = '<div class="error-state">Не удалось загрузить данные: ' + escapeHtml(error.message) + '</div>';
    });

  function renderControls() {
    characterSelect.innerHTML = state.characters.map(function(character) {
      return '<option value="' + escapeHtml(character.id) + '">' + escapeHtml(character.label || character.name) + '</option>';
    }).join("");
    characterSelect.addEventListener("change", function() {
      refreshChapters();
      loadSelection();
    });
    chapterSelect.addEventListener("change", loadSelection);
    aggregationSelect.addEventListener("change", function() { renderRadars(); });
    spheresCheck.addEventListener("change", updateSphereVisibility);
  }

  function refreshChapters() {
    var characterId = characterSelect.value;
    var current = chapterSelect.value;
    var firstAvailable = "";
    var selectedAvailable = false;
    chapterSelect.innerHTML = state.chapters.map(function(chapter) {
      var count = Number((chapter.character_counts || {})[characterId] || 0);
      var available = count > 0;
      if (available && !firstAvailable) firstAvailable = chapter.id;
      if (available && chapter.id === current) selectedAvailable = true;
      return '<option value="' + escapeHtml(chapter.id) + '"' + (available ? "" : " disabled") + '>' +
        escapeHtml(chapter.label + " — " + (chapter.description || "")) + " · " + count.toLocaleString("ru-RU") + " фрагм." + '</option>';
    }).join("");
    if (!selectedAvailable) chapterSelect.value = firstAvailable;
  }

  function loadSelection() {
    var character = characterSelect.value;
    var chapter = chapterSelect.value;
    if (!character || !chapter) return;
    var request = ++state.request;
    var characterMeta = state.characters.find(function(item) { return item.id === character; });
    var path = state.base + characterMeta.fragments_path_template.replace("{chapter_id}", chapter);
    status.textContent = "Загрузка фрагментов…";
    fetchJson(path).then(function(payload) {
      if (request !== state.request) return;
      state.fragments = payload.fragments || [];
      drawPlot();
      renderRadars();
      status.textContent = state.fragments.length.toLocaleString("ru-RU") + " фрагментов · " + (characterMeta.label || characterMeta.name);
    }).catch(function(error) {
      if (request !== state.request) return;
      status.textContent = "Ошибка: " + error.message;
    });
  }

  function drawPlot() {
    var characterId = characterSelect.value;
    var visibleClusters = state.clusters.filter(function(cluster) { return cluster.character_id === characterId; });
    var colors = {};
    visibleClusters.forEach(function(cluster) { colors[cluster.id] = cluster.color; });
    var traces = coordinateFrame();
    state.traceIndices = [];
    state.sphereIndices = [];
    visibleClusters.forEach(function(cluster) {
      traces.push({
        type: "scatter3d", mode: "markers", name: cluster.display_id + " — " + cluster.name,
        legendgroup: cluster.id, meta: "centroid:" + cluster.id,
        x: [cluster.centroid[0]], y: [cluster.centroid[1]], z: [cluster.centroid[2]],
        marker: { size: 4, color: cluster.color, symbol: "diamond" },
        hovertemplate: escapeHtml(cluster.display_id + " — " + cluster.name) + "<br>n=" + cluster.size +
          "<br>centroid (%{x:.3f}, %{y:.3f}, %{z:.3f})<extra></extra>"
      });
      state.traceIndices.push(traces.length - 1);
      var sphere = sphereTrace(cluster, spheresCheck.checked);
      traces.push(sphere);
      state.sphereIndices.push(traces.length - 1);
    });
    var points = state.fragments;
    traces.push({
      type: "scatter3d", mode: "markers", name: "Фрагменты главы", showlegend: false, meta: "selected-points",
      x: points.map(function(item) { return item.vad[0]; }), y: points.map(function(item) { return item.vad[1]; }), z: points.map(function(item) { return item.vad[2]; }),
      marker: { size: 3.2, opacity: .78, color: points.map(function(item) { return colors[item.cluster_id] || "#636EFA"; }) },
      text: points.map(function(item) { return hoverText(item, characterId); }),
      hovertemplate: "%{text}<br>V %{x:.3f} · A %{y:.3f} · D %{z:.3f}<extra></extra>"
    });
    state.pointIndex = traces.length - 1;
    Plotly.react(plot, traces, {
      margin: { l: 0, r: 0, t: 24, b: 0 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, system-ui, sans-serif", color: getCss("--text-color") },
      showlegend: true, legend: { orientation: "h", y: 1.02, x: .5, xanchor: "center" }, scene: sceneLayout()
    }, { responsive: true, displaylogo: false });
  }

  function hoverText(fragment, characterId) {
    var character = state.characters.find(function(item) { return item.id === characterId; });
    var cluster = state.clusters.find(function(item) { return item.id === fragment.cluster_id; });
    var warning = fragment.warning ? "<br>⚠ " + escapeHtml(fragment.warning) : "";
    return escapeHtml(fragment.id) + "<br>" + escapeHtml(character ? (character.name || character.label) : characterId) +
      "<br>" + escapeHtml(cluster ? cluster.display_id + " — " + cluster.name : fragment.cluster_id) +
      "<br>sentence " + fragment.chapter_sentence_start + " · distance " + Number(fragment.distance_to_centroid).toFixed(3) +
      warning + "<br>" + escapeHtml(fragment.text);
  }

  function updateSphereVisibility() {
    if (!state.sphereIndices || !state.sphereIndices.length) return;
    Plotly.restyle(plot, { visible: state.sphereIndices.map(function() { return spheresCheck.checked; }) }, state.sphereIndices);
  }

  function renderRadars() {
    var profile = (state.profiles[characterSelect.value] || {}).chapters || {};
    var chapterProfile = profile[chapterSelect.value];
    renderRadar(radar8, "8", chapterProfile);
    renderRadar(radar16, "16", chapterProfile);
  }

  function renderRadar(container, axes, profile) {
    var isEight = axes === "8";
    var labels = isEight ? (state.manifest ? ["joy", "trust", "fear", "surprise", "sadness", "disgust", "anger", "anticipation"] : []) : ["joy", "love", "trust", "submission", "fear", "awe", "surprise", "disapproval", "sadness", "remorse", "disgust", "contempt", "anger", "aggressiveness", "anticipation", "optimism"];
    var aggregation = aggregationSelect.value;
    var profileKey = isEight ? (aggregation === "sum" ? "sum8" : "mean8") : (aggregation === "sum" ? "sum16" : "mean16");
    var values = profile ? profile[profileKey] : labels.map(function() { return 0; });
    var count = profile ? profile.count : 0;
    var threshold = (isEight ? .002 : .01) * (aggregation === "sum" ? count : 1);
    var theta = labels.concat([labels[0]]);
    var closed = values.concat([values[0]]);
    var maximum = Math.max(aggregation === "sum" ? 1 : .05, ...values) * 1.12;
    var band = theta.map(function() { return threshold; });
    Plotly.react(container, [
      { type: "scatterpolar", r: band, theta: theta, mode: "lines", fill: "toself", fillcolor: "rgba(112,118,128,.26)", line: { color: "rgba(112,118,128,.54)", width: 1 }, hoverinfo: "skip", name: "Negligible ≤ " + threshold.toFixed(aggregation === "sum" ? 2 : 3) },
      { type: "scatterpolar", r: closed, theta: theta, mode: "lines+markers", fill: "toself", fillcolor: isEight ? "rgba(201,68,56,.15)" : "rgba(47,111,186,.15)", line: { color: isEight ? "#c94438" : "#2f6fba", width: 2 }, marker: { color: isEight ? "#c94438" : "#2f6fba", size: isEight ? 5 : 3 }, name: axes + " components", hovertemplate: "%{theta}<br>weight=%{r:.4f}<extra></extra>" }
    ], {
      title: { text: axes + "-component profile · " + aggregation + " · n=" + count, x: .5, font: { size: 14 } },
      margin: { l: 42, r: 42, t: 48, b: 30 }, paper_bgcolor: "rgba(0,0,0,0)", showlegend: true,
      legend: { orientation: "h", x: .5, xanchor: "center", y: -.01, font: { size: 10 } },
      polar: { bgcolor: "rgba(0,0,0,0)", angularaxis: { direction: "clockwise", rotation: 90, gridcolor: "rgba(98,107,120,.25)", tickfont: { size: isEight ? 10 : 8 } }, radialaxis: { range: [0, maximum], tickformat: aggregation === "mean" ? ".2f" : ".1f", gridcolor: "rgba(98,107,120,.25)", tickfont: { size: 9 } } }
    }, { responsive: true, displaylogo: false });
  }

  function coordinateFrame() {
    var axis = "rgba(125,132,137,.75)", grid = "rgba(125,132,137,.5)";
    var traces = [
      { type: "scatter3d", mode: "lines", x: [-1,1], y: [0,0], z: [0,0], line: { color: axis, width: 4 }, showlegend: false, hoverinfo: "skip" },
      { type: "scatter3d", mode: "lines", x: [0,0], y: [-1,1], z: [0,0], line: { color: axis, width: 4 }, showlegend: false, hoverinfo: "skip" },
      { type: "scatter3d", mode: "lines", x: [0,0], y: [0,0], z: [-1,1], line: { color: axis, width: 4 }, showlegend: false, hoverinfo: "skip" }
    ];
    ["z", "y", "x"].forEach(function(fixed) {
      var values = [-1,-.75,-.5,-.25,.25,.5,.75,1], x=[], y=[], z=[];
      values.forEach(function(value) {
        if (fixed === "z") { x.push(-1,1,null,value,value,null); y.push(value,value,null,-1,1,null); z.push(0,0,null,0,0,null); }
        else if (fixed === "y") { x.push(-1,1,null,value,value,null); y.push(0,0,null,0,0,null); z.push(value,value,null,-1,1,null); }
        else { x.push(0,0,null,0,0,null); y.push(-1,1,null,value,value,null); z.push(value,value,null,-1,1,null); }
      });
      traces.push({ type: "scatter3d", mode: "lines", x:x, y:y, z:z, line:{color:grid,width:1}, showlegend:false, hoverinfo:"skip" });
    });
    traces.push(surface("VA plane", [[-1,1],[-1,1]], [[-1,-1],[1,1]], [[0,0],[0,0]], "#dce7f5"));
    traces.push(surface("VD plane", [[-1,1],[-1,1]], [[0,0],[0,0]], [[-1,-1],[1,1]], "#e3f0e5"));
    traces.push(surface("AD plane", [[0,0],[0,0]], [[-1,1],[-1,1]], [[-1,-1],[1,1]], "#f4e5df"));
    return traces;
  }

  function surface(name, x, y, z, color) {
    return { type:"surface", name:name, x:x, y:y, z:z, surfacecolor:[[0,0],[0,0]], colorscale:[[0,color],[1,color]], showscale:false, opacity:.18, showlegend:false, hoverinfo:"skip", lighting:{ambient:1,diffuse:0,specular:0} };
  }

  function sphereTrace(cluster, visible) {
    var longitude = 12, latitude = 8, vertices = [[cluster.centroid[0],cluster.centroid[1],cluster.centroid[2] + cluster.sphere_radius]];
    for (var lat=1; lat<latitude; lat++) for (var lon=0; lon<longitude; lon++) {
      var phi=Math.PI*lat/latitude, theta=2*Math.PI*lon/longitude, r=cluster.sphere_radius;
      vertices.push([cluster.centroid[0]+r*Math.sin(phi)*Math.cos(theta),cluster.centroid[1]+r*Math.sin(phi)*Math.sin(theta),cluster.centroid[2]+r*Math.cos(phi)]);
    }
    var bottom=vertices.length; vertices.push([cluster.centroid[0],cluster.centroid[1],cluster.centroid[2]-cluster.sphere_radius]);
    var faces=[];
    for (var l=0;l<longitude;l++) faces.push([0,1+l,1+(l+1)%longitude]);
    for (var ring=0;ring<latitude-2;ring++) for (var k=0;k<longitude;k++) { var a=1+ring*longitude,b=a+longitude,n=(k+1)%longitude; faces.push([a+k,b+k,b+n],[a+k,b+n,a+n]); }
    var last=1+(latitude-2)*longitude; for (var q=0;q<longitude;q++) faces.push([last+q,bottom,last+(q+1)%longitude]);
    return { type:"mesh3d", x:vertices.map(function(v){return v[0];}), y:vertices.map(function(v){return v[1];}), z:vertices.map(function(v){return v[2];}), i:faces.map(function(f){return f[0];}), j:faces.map(function(f){return f[1];}), k:faces.map(function(f){return f[2];}), color:cluster.color, opacity:.055, visible:visible, showlegend:false, legendgroup:cluster.id, meta:"sphere:"+cluster.id, hoverinfo:"skip", lighting:{ambient:.9,diffuse:.25,specular:.02,roughness:1} };
  }

  function sceneLayout() {
    return { xaxis: sceneAxis("Valence (V)"), yaxis: sceneAxis("Arousal (A)"), zaxis: sceneAxis("Dominance (D)"), camera:{eye:{x:1.45,y:1.45,z:1.15}}, aspectmode:"cube" };
  }
  function sceneAxis(title) { return { title:{text:title}, range:[-1.05,1.05], showgrid:false, zeroline:false, showspikes:false, backgroundcolor:"rgba(0,0,0,0)", color:getCss("--text-muted") }; }
  function fetchJson(path) { return fetch(path).then(function(response) { if (!response.ok) throw new Error("HTTP " + response.status + ": " + path); return response.json(); }); }
  function getCss(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function escapeHtml(value) { var div=document.createElement("div"); div.textContent=value == null ? "" : String(value); return div.innerHTML; }
})();
