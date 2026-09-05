(function () {
  "use strict";

  var DATA_ROOT = "../data/";
  var requestedNovel = new URLSearchParams(window.location.search).get("novel");
  var plot = document.getElementById("centroid-spheres");
  var backLink = document.getElementById("back-link");
  var emotionColors = {
    anger: "#eb5757", anticipation: "#f2994a", disgust: "#9b51e0", fear: "#219653",
    joy: "#f2c94c", sadness: "#2f80ed", surprise: "#56ccf2", trust: "#6fcf97"
  };
  var state = {
    characters: [], clusters: [], emotions: [], opposites: [],
    characterEnabled: {}, emotionEnabled: {}, showSpheres: true, showOpposites: false,
    clusterTraces: {}, emotionTraces: {}, oppositeTraces: {}, sphereIndices: [], initialized: false
  };

  AtlasData.loadNovelContext(requestedNovel, { catalogUrl: DATA_ROOT + "catalog.json" }).then(function (context) {
      var manifest = context.novelManifest;
      state.manifest = manifest;
      state.base = context.dataBaseUrl;
      var title = AtlasData.localized(context.novel.title);
      document.title = title + " — центроиды и сферы";
      backLink.href = "../novel.html?id=" + encodeURIComponent(context.novel.id) + "&feature=emotion-vad";
      backLink.textContent = "← " + title;
      return Promise.all([
        fetchJson(state.base + manifest.files.characters),
        fetchJson(state.base + manifest.files.clusters),
        fetchJson(state.base + manifest.emotion_model.path)
      ]);
  }).then(function (data) {
    state.characters = data[0].characters || [];
    state.clusters = data[1].clusters || [];
    state.emotions = data[2].emotions || [];
    state.opposites = data[2].opposite_pairs || [];
    state.characters.forEach(function (item) { state.characterEnabled[item.id] = true; });
    state.emotions.forEach(function (item) { state.emotionEnabled[item.id] = true; });
    renderControls();
    buildPlot();
  }).catch(showError);

  function renderControls() {
    document.getElementById("character-filter").innerHTML = state.characters.map(function (character) {
      return '<label><input type="checkbox" class="character-toggle" data-id="' + character.id + '" checked>' +
        escapeHtml(character.label || character.name) + '</label>';
    }).join("");
    document.getElementById("emotion-filter").innerHTML = state.emotions.map(function (emotion) {
      return '<label><input type="checkbox" class="emotion-toggle" data-id="' + emotion.id + '" checked>' +
        '<span class="swatch" style="background:' + emotionColor(emotion.id) + '"></span>' + titleCase(emotion.id) + '</label>';
    }).join("") +
      '<label><input id="show-opposites" type="checkbox"> Connect opposite emotions</label>' +
      '<span class="opposite-note">Joy ↔ Sadness · Trust ↔ Disgust · Fear ↔ Anger · Surprise ↔ Anticipation</span>' +
      '<label><input id="show-spheres" type="checkbox" checked> Show spheres</label>';

    document.querySelectorAll(".character-toggle").forEach(function (input) {
      input.addEventListener("change", function () {
        state.characterEnabled[input.dataset.id] = input.checked;
        updateCharacter(input.dataset.id);
      });
    });
    document.querySelectorAll(".emotion-toggle").forEach(function (input) {
      input.addEventListener("change", function () {
        state.emotionEnabled[input.dataset.id] = input.checked;
        updateEmotion(input.dataset.id);
      });
    });
    document.getElementById("show-spheres").addEventListener("change", function (event) {
      state.showSpheres = event.target.checked;
      updateAllSpheres();
    });
    document.getElementById("show-opposites").addEventListener("change", function (event) {
      state.showOpposites = event.target.checked;
      updateOpposites();
    });
  }

  function buildPlot() {
    var traces = coordinateFrame();
    state.clusterTraces = {};
    state.emotionTraces = {};
    state.oppositeTraces = {};
    state.sphereIndices = [];

    state.clusters.forEach(function (cluster) {
      var sphereIndex = traces.length;
      traces.push(clusterSphere(cluster));
      var centroidIndex = traces.length;
      traces.push(clusterCentroid(cluster));
      state.clusterTraces[cluster.id] = {
        characterId: cluster.character_id,
        sphere: sphereIndex,
        centroid: centroidIndex
      };
      state.sphereIndices.push(sphereIndex);
    });
    state.opposites.forEach(function (pair) {
      var first = findEmotion(pair[0]);
      var second = findEmotion(pair[1]);
      if (!first || !second) return;
      state.oppositeTraces[pair.join(":")] = traces.length;
      traces.push(oppositeLine(first, second));
    });
    state.emotions.forEach(function (emotion) {
      state.emotionTraces[emotion.id] = traces.length;
      traces.push(emotionAnchor(emotion));
    });

    Plotly.newPlot(plot, traces, plotLayout(), { responsive: true, displaylogo: false }).then(function () {
      state.initialized = true;
    });
  }

  function updateCharacter(characterId) {
    if (!state.initialized) return;
    var indices = [];
    var visible = [];
    Object.keys(state.clusterTraces).forEach(function (clusterId) {
      var group = state.clusterTraces[clusterId];
      if (group.characterId !== characterId) return;
      var enabled = state.characterEnabled[characterId];
      var centroidVisible = plot.data[group.centroid].visible;
      var clusterHiddenByLegend = centroidVisible === "legendonly";
      indices.push(group.centroid, group.sphere);
      visible.push(enabled ? (clusterHiddenByLegend ? "legendonly" : true) : false);
      visible.push(enabled && !clusterHiddenByLegend);
    });
    if (indices.length) Plotly.restyle(plot, { visible: visible }, indices);
  }

  function updateAllSpheres() {
    if (!state.initialized) return;
    Plotly.restyle(plot, { opacity: state.showSpheres ? .32 : 0 }, state.sphereIndices);
  }

  function updateEmotion(emotionId) {
    if (!state.initialized) return;
    Plotly.restyle(plot, { visible: state.emotionEnabled[emotionId] }, [state.emotionTraces[emotionId]]);
    updateOpposites();
  }

  function updateOpposites() {
    if (!state.initialized) return;
    var indices = [];
    var visible = [];
    Object.keys(state.oppositeTraces).forEach(function (key) {
      var pair = key.split(":");
      indices.push(state.oppositeTraces[key]);
      visible.push(Boolean(state.showOpposites && state.emotionEnabled[pair[0]] && state.emotionEnabled[pair[1]]));
    });
    if (indices.length) Plotly.restyle(plot, { visible: visible }, indices);
  }

  function plotLayout() {
    return {
      margin: { l: 8, r: 8, t: 58, b: 8 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, system-ui, sans-serif", color: css("--text-color") },
      title: { text: "Separate K-Means · " + state.characters.length + " characters · centroids and emotion anchors", x: .025, font: { size: 10 } },
      legend: { groupclick: "togglegroup", title: { text: "Click to show/hide" }, x: .99, xanchor: "right", y: .98 },
      scene: {
        xaxis: sceneAxis("Valence (V)"), yaxis: sceneAxis("Arousal (A)"), zaxis: sceneAxis("Dominance (D)"),
        camera: { eye: { x: 1.45, y: 1.45, z: 1.15 } }, aspectmode: "cube"
      }
    };
  }

  function clusterSphere(cluster) {
    var mesh = sphereMesh(cluster.centroid, Number(cluster.sphere_radius || 0), 12, 8);
    return {
      type: "mesh3d", name: cluster.display_id + " — " + cluster.name + " sphere",
      meta: "sphere:" + cluster.id, legendgroup: cluster.id, showlegend: false, visible: true,
      x: mesh.x, y: mesh.y, z: mesh.z, i: mesh.i, j: mesh.j, k: mesh.k,
      color: cluster.color, opacity: .32, flatshading: false,
      lighting: { ambient: .72, diffuse: .65, roughness: .75, specular: .25 },
      hovertemplate: "cluster " + escapeHtml(cluster.display_id + " — " + cluster.name) +
        "<br>size: " + cluster.size + "<br>centroid: (" + cluster.centroid.map(format).join(", ") +
        ")<br>diameter: " + format(Number(cluster.sphere_radius || 0) * 2) +
        "<br>within-cluster spread: " + format(cluster.within_cluster_spread) + "<extra></extra>"
    };
  }

  function sphereMesh(center, radius, longitudeCount, latitudeCount) {
    var vertices = [[center[0], center[1], center[2] + radius]];
    var latitude, longitude;
    for (latitude = 1; latitude < latitudeCount; latitude += 1) {
      var phi = Math.PI * latitude / latitudeCount;
      for (longitude = 0; longitude < longitudeCount; longitude += 1) {
        var theta = 2 * Math.PI * longitude / longitudeCount;
        vertices.push([
          center[0] + radius * Math.sin(phi) * Math.cos(theta),
          center[1] + radius * Math.sin(phi) * Math.sin(theta),
          center[2] + radius * Math.cos(phi)
        ]);
      }
    }
    var bottom = vertices.length;
    vertices.push([center[0], center[1], center[2] - radius]);
    var faces = [];
    for (longitude = 0; longitude < longitudeCount; longitude += 1) faces.push([0, 1 + longitude, 1 + (longitude + 1) % longitudeCount]);
    for (var ring = 0; ring < latitudeCount - 2; ring += 1) {
      var upper = 1 + ring * longitudeCount;
      var lower = upper + longitudeCount;
      for (longitude = 0; longitude < longitudeCount; longitude += 1) {
        var next = (longitude + 1) % longitudeCount;
        faces.push([upper + longitude, lower + longitude, lower + next]);
        faces.push([upper + longitude, lower + next, upper + next]);
      }
    }
    var lastRing = 1 + (latitudeCount - 2) * longitudeCount;
    for (longitude = 0; longitude < longitudeCount; longitude += 1) faces.push([lastRing + longitude, bottom, lastRing + (longitude + 1) % longitudeCount]);
    return {
      x: vertices.map(function (point) { return point[0]; }), y: vertices.map(function (point) { return point[1]; }), z: vertices.map(function (point) { return point[2]; }),
      i: faces.map(function (face) { return face[0]; }), j: faces.map(function (face) { return face[1]; }), k: faces.map(function (face) { return face[2]; })
    };
  }

  function clusterCentroid(cluster) {
    return {
      type: "scatter3d", mode: "markers", name: cluster.display_id + " — " + cluster.name + " · n=" + cluster.size,
      meta: "centroid:" + cluster.id, legendgroup: cluster.id, showlegend: true,
      x: [cluster.centroid[0]], y: [cluster.centroid[1]], z: [cluster.centroid[2]],
      marker: { color: cluster.color, size: 4, symbol: "circle", line: { color: css("--surface-solid"), width: 1 } },
      hovertemplate: "cluster " + escapeHtml(cluster.display_id + " — " + cluster.name) +
        "<br>size: " + cluster.size + "<br>centroid: (%{x:.3f}, %{y:.3f}, %{z:.3f})" +
        "<br>diameter: " + format(Number(cluster.sphere_radius || 0) * 2) +
        "<br>within-cluster spread: " + format(cluster.within_cluster_spread) + "<extra></extra>"
    };
  }

  function emotionAnchor(emotion) {
    var color = emotionColor(emotion.id);
    return {
      type: "scatter3d", mode: "markers+text", name: titleCase(emotion.id) + " · emotion anchor",
      meta: "emotion:" + emotion.id, showlegend: false, visible: true,
      x: [emotion.centroid[0]], y: [emotion.centroid[1]], z: [emotion.centroid[2]],
      text: [titleCase(emotion.id)], textposition: "top center", textfont: { color: color, size: 12 },
      marker: { color: color, size: 7, symbol: "diamond", line: { color: css("--surface-solid"), width: 1 } },
      hovertemplate: "<b>" + titleCase(emotion.id) + "</b><br>V %{x:.2f} · A %{y:.2f} · D %{z:.2f}" +
        "<br>single-emotion terms: " + emotion.sample_size + "<extra></extra>"
    };
  }

  function oppositeLine(first, second) {
    return {
      type: "scatter3d", mode: "lines", name: titleCase(first.id) + " ↔ " + titleCase(second.id),
      meta: "opposite:" + first.id + ":" + second.id, showlegend: false, visible: false,
      x: [first.centroid[0], second.centroid[0]], y: [first.centroid[1], second.centroid[1]], z: [first.centroid[2], second.centroid[2]],
      line: { color: "rgba(125,132,137,.72)", dash: "dot", width: 4 }, hoverinfo: "skip"
    };
  }

  function coordinateFrame() {
    var traces = [
      lineTrace([-1, 1], [0, 0], [0, 0], "rgba(125,132,137,.75)", 4),
      lineTrace([0, 0], [-1, 1], [0, 0], "rgba(125,132,137,.75)", 4),
      lineTrace([0, 0], [0, 0], [-1, 1], "rgba(125,132,137,.75)", 4)
    ];
    traces.push(gridTrace("z"), gridTrace("y"), gridTrace("x"));
    traces.push(planeTrace("VA", [[-1,1],[-1,1]], [[-1,-1],[1,1]], [[0,0],[0,0]], "#dce7f5"));
    traces.push(planeTrace("VD", [[-1,1],[-1,1]], [[0,0],[0,0]], [[-1,-1],[1,1]], "#e3f0e5"));
    traces.push(planeTrace("AD", [[0,0],[0,0]], [[-1,1],[-1,1]], [[-1,-1],[1,1]], "#f4e5df"));
    traces.push({
      type: "scatter3d", mode: "text", showlegend: false, hoverinfo: "skip",
      x: [-1,1,0,0,0,0], y: [0,0,-1,1,0,0], z: [0,0,0,0,-1,1],
      text: ["неприятно","приятно","спокоен","возбуждён","бесконтрольность","контроль"],
      textfont: { color: css("--text-color"), size: 13 }, textposition: "top center"
    });
    return traces;
  }

  function gridTrace(fixed) {
    var ticks = [-1,-.75,-.5,-.25,.25,.5,.75,1], x=[], y=[], z=[];
    ticks.forEach(function (tick) {
      if (fixed === "z") { x.push(-1,1,null,tick,tick,null); y.push(tick,tick,null,-1,1,null); z.push(0,0,null,0,0,null); }
      else if (fixed === "y") { x.push(-1,1,null,tick,tick,null); y.push(0,0,null,0,0,null); z.push(tick,tick,null,-1,1,null); }
      else { x.push(0,0,null,0,0,null); y.push(-1,1,null,tick,tick,null); z.push(tick,tick,null,-1,1,null); }
    });
    return lineTrace(x, y, z, "rgba(125,132,137,.5)", 1);
  }
  function lineTrace(x,y,z,color,width){return{type:"scatter3d",mode:"lines",x:x,y:y,z:z,line:{color:color,width:width},showlegend:false,hoverinfo:"skip"};}
  function planeTrace(name,x,y,z,color){return{type:"surface",name:name,x:x,y:y,z:z,surfacecolor:[[0,0],[0,0]],colorscale:[[0,color],[1,color]],showscale:false,opacity:.18,showlegend:false,hoverinfo:"skip",lighting:{ambient:1,diffuse:0,specular:0}};}
  function sceneAxis(title){return{title:{text:title},range:[-1.05,1.05],showgrid:false,zeroline:false,showspikes:false,backgroundcolor:"rgba(0,0,0,0)",color:css("--text-muted")};}
  function findEmotion(id){return state.emotions.find(function(item){return item.id===id;});}
  function emotionColor(id){return emotionColors[id]||"#777";}
  function titleCase(value){return value.charAt(0).toUpperCase()+value.slice(1);}
  function format(value){return Number(value).toFixed(3).replace("-0.000","0.000");}
  function fetchJson(path){return fetch(path).then(function(response){if(!response.ok)throw new Error("HTTP "+response.status+" — "+path);return response.json();});}
  function css(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim();}
  function escapeHtml(value){var div=document.createElement("div");div.textContent=value==null?"":String(value);return div.innerHTML;}
  function showError(error){plot.innerHTML='<div class="error-state">Не удалось загрузить данные: '+escapeHtml(error.message)+'</div>';}
})();
