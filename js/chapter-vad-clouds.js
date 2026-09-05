(function () {
  "use strict";

  var DATA_ROOT = "../data/";
  var params = new URLSearchParams(window.location.search);
  var requestedNovelId = params.get("novel");
  var plot = document.getElementById("chapter-cloud-plot");
  var tree = document.getElementById("chapter-tree");
  var status = document.getElementById("selection-status");
  var spheresCheck = document.getElementById("show-spheres");
  var state = { characters: [], chapters: [], clusters: [], selected: new Set(), fragments: {}, request: 0, sphereIndices: [] };

  AtlasData.loadNovelContext(requestedNovelId, { catalogUrl: DATA_ROOT + "catalog.json" }).then(function (context) {
      var manifest = context.novelManifest;
      state.base = context.dataBaseUrl;
      document.title = AtlasData.localized(context.novel.title) + " — VAD облака глав";
      document.getElementById("back-link").href = "../novel.html?id=" + encodeURIComponent(context.novel.id) + "&feature=emotion-vad";
      return Promise.all([fetchJson(state.base + manifest.files.characters), fetchJson(state.base + manifest.files.chapters), fetchJson(state.base + manifest.files.clusters)]);
  }).then(function (r) {
    state.characters = r[0].characters || [];
    state.chapters = r[1].chapters || [];
    state.clusters = r[2].clusters || [];
    renderTree();
    bindControls();
    document.getElementById("grid-opacity").value = .5;
    document.getElementById("grid-color").value = "#7d8489";
    document.getElementById("plane-opacity").value = .18;
    document.querySelectorAll("output[data-for]").forEach(function (o) { o.value = document.getElementById(o.dataset.for).value; });
    var first = document.querySelector(".chapter-check:enabled");
    if (first) { first.checked = true; state.selected.add(key(first.dataset.character, first.dataset.chapter)); }
    refresh();
  }).catch(function (e) { plot.innerHTML = '<div class="error-state">Не удалось загрузить данные: ' + escapeHtml(e.message) + '</div>'; });

  function key(c, h) { return c + "::" + h; }
  function renderTree() {
    tree.innerHTML = state.characters.map(function (c) {
      var parts = {};
      state.chapters.forEach(function (ch) { var n = Number((ch.character_counts || {})[c.id] || 0); if (n) (parts[ch.part] || (parts[ch.part] = [])).push({ ch: ch, n: n }); });
      var body = Object.keys(parts).sort(function (a, b) { return a - b; }).map(function (part) {
        var rows = parts[part].map(function (x) { return '<label class="chapter-row"><input type="checkbox" class="chapter-check" data-character="' + c.id + '" data-chapter="' + x.ch.id + '"><span>' + escapeHtml(x.ch.label) + ' · ' + x.n.toLocaleString("ru-RU") + ' фрагм.</span></label>'; }).join("");
        return '<details open><summary><label class="group-row"><input type="checkbox" class="part-check" data-character="' + c.id + '" data-part="' + part + '"><span>Часть ' + part + '</span></label></summary><div class="chapter-list">' + rows + '</div></details>'; }).join("");
      return '<details open class="character-group"><summary><label class="group-row"><input type="checkbox" class="character-check" data-character="' + c.id + '"><span class="character-dot" style="background:' + c.color + '"></span><span>' + escapeHtml(c.label || c.name) + '</span></label></summary>' + body + '</details>'; }).join("");
  }
  function bindControls() {
    tree.addEventListener("change", function (e) {
      var t = e.target;
      if (t.classList.contains("character-check")) tree.querySelectorAll('.chapter-check[data-character="' + t.dataset.character + '"]').forEach(function (x) { x.checked = t.checked; });
      if (t.classList.contains("part-check")) tree.querySelectorAll('.chapter-check[data-character="' + t.dataset.character + '"]').forEach(function (x) { var ch = state.chapters.find(function (c) { return c.id === x.dataset.chapter; }); if (ch && String(ch.part) === t.dataset.part) x.checked = t.checked; });
      state.selected = new Set(Array.from(tree.querySelectorAll(".chapter-check:checked")).map(function (x) { return key(x.dataset.character, x.dataset.chapter); }));
      refresh();
    });
    document.getElementById("clear-selection").addEventListener("click", function () { tree.querySelectorAll("input").forEach(function (x) { x.checked = false; }); state.selected.clear(); refresh(); });
    spheresCheck.addEventListener("change", function () { if (state.sphereIndices.length) Plotly.restyle(plot, { visible: state.sphereIndices.map(function () { return spheresCheck.checked; }) }, state.sphereIndices); });
    document.querySelectorAll(".grid-control").forEach(function (el) { el.addEventListener("input", function () { var out = document.querySelector('output[data-for="' + el.id + '"]'); if (out) out.value = el.value; draw(); }); });
    document.getElementById("style-reset").addEventListener("click", function () { document.getElementById("grid-width").value = 1; document.getElementById("grid-opacity").value = .5; document.getElementById("grid-color").value = "#7d8489"; document.getElementById("grid-dash").value = "solid"; document.getElementById("plane-opacity").value = .18; document.querySelectorAll("output[data-for]").forEach(function (o) { o.value = document.getElementById(o.dataset.for).value; }); draw(); });
  }
  function refresh() {
    status.textContent = state.selected.size + " выбранных глав · загрузка…";
    var req = ++state.request;
    Promise.all(Array.from(state.selected).map(function (k) { if (state.fragments[k]) return Promise.resolve(); var a = k.split("::"), c = state.characters.find(function (x) { return x.id === a[0]; }); return fetchJson(state.base + c.fragments_path_template.replace("{chapter_id}", a[1])).then(function (p) { state.fragments[k] = p.fragments || []; }); })).then(function () { if (req !== state.request) return; draw(); var n = Object.keys(state.fragments).filter(function (k) { return state.selected.has(k); }).reduce(function (s, k) { return s + state.fragments[k].length; }, 0); status.textContent = state.selected.size + " выбранных глав · " + n + " фрагментов"; });
  }
  function draw() {
    var traces = referenceFrame(); state.sphereIndices = [];
    var colors = {}; state.clusters.forEach(function (c) { colors[c.id] = c.color; });
    state.characters.forEach(function (ch) { if (!Array.from(state.selected).some(function (k) { return k.indexOf(ch.id + "::") === 0; })) return; state.clusters.filter(function (c) { return c.character_id === ch.id; }).forEach(function (c) { traces.push({ type: "scatter3d", mode: "markers", name: c.display_id + " — " + c.name, legendgroup: c.id, x: [c.centroid[0]], y: [c.centroid[1]], z: [c.centroid[2]], marker: { size: 4, color: c.color, symbol: "diamond" }, hovertemplate: escapeHtml(c.display_id + " — " + c.name) + "<br>n=" + c.size + "<extra></extra>" }); traces.push(sphere(c, spheresCheck.checked)); state.sphereIndices.push(traces.length - 1); }); });
    state.characters.forEach(function (ch) { var pts = Array.from(state.selected).filter(function (k) { return k.indexOf(ch.id + "::") === 0; }).reduce(function (a, k) { return a.concat(state.fragments[k] || []); }, []); if (!pts.length) return; traces.push({ type: "scatter3d", mode: "markers", name: ch.label || ch.name, legendgroup: ch.id, x: pts.map(function (p) { return p.vad[0]; }), y: pts.map(function (p) { return p.vad[1]; }), z: pts.map(function (p) { return p.vad[2]; }), marker: { size: 3.5, color: ch.color, opacity: .8 }, text: pts.map(function (p) { return escapeHtml(p.id) + "<br>" + escapeHtml(p.text) + "<br>V " + p.vad[0].toFixed(3) + " · A " + p.vad[1].toFixed(3) + " · D " + p.vad[2].toFixed(3); }), hovertemplate: "%{text}<extra></extra>" }); });
    Plotly.react(plot, traces, { margin: { l: 0, r: 0, t: 32, b: 0 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { family: "Inter, system-ui, sans-serif", color: getCss("--text-color") }, legend: { orientation: "h", y: 1.02, x: .5, xanchor: "center" }, scene: { xaxis: axis("Valence (V)"), yaxis: axis("Arousal (A)"), zaxis: axis("Dominance (D)"), aspectmode: "cube", camera: { eye: { x: 1.45, y: 1.45, z: 1.15 } } } }, { responsive: true, displaylogo: false });
  }
  function frame() { var a = document.getElementById("grid-color").value, w = Number(document.getElementById("grid-width").value), o = Number(document.getElementById("grid-opacity").value), dash = document.getElementById("grid-dash").value, p = Number(document.getElementById("plane-opacity").value); var t = [{ type: "scatter3d", mode: "lines", x: [-1,1], y: [0,0], z: [0,0], line: { color: a, width: 4 }, showlegend: false, hoverinfo: "skip" }, { type: "scatter3d", mode: "lines", x: [0,0], y: [-1,1], z: [0,0], line: { color: a, width: 4 }, showlegend: false, hoverinfo: "skip" }, { type: "scatter3d", mode: "lines", x: [0,0], y: [0,0], z: [-1,1], line: { color: a, width: 4 }, showlegend: false, hoverinfo: "skip" }]; [-.75,-.5,-.25,.25,.5,.75].forEach(function (v) { t.push({ type: "scatter3d", mode: "lines", x: [-1,1,null,v,v], y: [v,v,null,-1,1], z: [0,0,null,0,0], line: { color: a, width: w, dash: dash }, opacity: o, showlegend: false, hoverinfo: "skip" }); }); return t.concat([{ type: "mesh3d", x: [-1,1,1,-1], y: [-1,-1,1,1], z: [0,0,0,0], i:[0,0],j:[1,2],k:[2,3], color:"#dce7f5", opacity:p, hoverinfo:"skip", showlegend:false }, { type: "mesh3d", x: [-1,1,1,-1], y: [0,0,0,0], z: [-1,-1,1,1], i:[0,0],j:[1,2],k:[2,3], color:"#e3f0e5", opacity:p, hoverinfo:"skip", showlegend:false }, { type: "mesh3d", x: [0,0,0,0], y: [-1,1,1,-1], z: [-1,-1,1,1], i:[0,0],j:[1,2],k:[2,3], color:"#f4e5df", opacity:p, hoverinfo:"skip", showlegend:false }]); }
  function referenceFrame() {
    function line(x,y,z,color,width) { return {type:"scatter3d",mode:"lines",x:x,y:y,z:z,line:{color:color,width:width},showlegend:false,hoverinfo:"skip"}; }
    function plane(x,y,z,color) { return {type:"surface",x:x,y:y,z:z,surfacecolor:[[0,0],[0,0]],colorscale:[[0,color],[1,color]],showscale:false,opacity:.18,showlegend:false,hoverinfo:"skip",lighting:{ambient:1,diffuse:0,specular:0}}; }
    var traces=[line([-1,1],[0,0],[0,0],"rgba(125,132,137,.75)",4),line([0,0],[-1,1],[0,0],"rgba(125,132,137,.75)",4),line([0,0],[0,0],[-1,1],"rgba(125,132,137,.75)",4)];
    ["z","y","x"].forEach(function(fixed){var x=[],y=[],z=[];[-1,-.75,-.5,-.25,.25,.5,.75,1].forEach(function(v){if(fixed==="z"){x.push(-1,1,null,v,v,null);y.push(v,v,null,-1,1,null);z.push(0,0,null,0,0,null);}else if(fixed==="y"){x.push(-1,1,null,v,v,null);y.push(0,0,null,0,0,null);z.push(v,v,null,-1,1,null);}else{x.push(0,0,null,0,0,null);y.push(-1,1,null,v,v,null);z.push(v,v,null,-1,1,null);}});traces.push(line(x,y,z,"rgba(125,132,137,.5)",1));});
    traces.push(plane([[-1,1],[-1,1]],[[-1,-1],[1,1]],[[0,0],[0,0]],"#dce7f5"),plane([[-1,1],[-1,1]],[[0,0],[0,0]],[[-1,-1],[1,1]],"#e3f0e5"),plane([[0,0],[0,0]],[[-1,1],[-1,1]],[[-1,-1],[1,1]],"#f4e5df"));
    traces.push({type:"scatter3d",mode:"text",showlegend:false,hoverinfo:"skip",x:[-1,1,0,0,0,0],y:[0,0,-1,1,0,0],z:[0,0,0,0,-1,1],text:["неприятно","приятно","спокоен","возбуждён","бесконтрольность","контроль"],textfont:{color:getCss("--text-color"),size:13},textposition:"top center"});
    return traces;
  }
  function axis(title) { return { title: { text: title }, range: [-1.05, 1.05], showgrid: false, zeroline: false, showspikes: false, backgroundcolor: "rgba(0,0,0,0)", color: getCss("--text-muted") }; }
  function sphere(c, visible) { var r = Number(c.sphere_radius || 0), lon = 12, lat = 8, v = [[c.centroid[0], c.centroid[1], c.centroid[2] + r]]; for (var y=1;y<lat;y++) for (var x=0;x<lon;x++) { var ph=Math.PI*y/lat, th=2*Math.PI*x/lon; v.push([c.centroid[0]+r*Math.sin(ph)*Math.cos(th),c.centroid[1]+r*Math.sin(ph)*Math.sin(th),c.centroid[2]+r*Math.cos(ph)]); } var bot=v.length; v.push([c.centroid[0],c.centroid[1],c.centroid[2]-r]); var i=[],j=[],k=[]; for(var q=0;q<lon;q++){i.push(0);j.push(1+q);k.push(1+(q+1)%lon);} for(var ring=0;ring<lat-2;ring++) for(var q2=0;q2<lon;q2++){var a=1+ring*lon,b=a+lon,n=(q2+1)%lon;i.push(a+q2,a+q2);j.push(b+q2,b+n);k.push(b+n,a+n);} var last=1+(lat-2)*lon; for(var q3=0;q3<lon;q3++){i.push(last+q3);j.push(bot);k.push(last+(q3+1)%lon);} return {type:"mesh3d",x:v.map(function(a){return a[0];}),y:v.map(function(a){return a[1];}),z:v.map(function(a){return a[2];}),i:i,j:j,k:k,color:c.color,opacity:.08,visible:visible,showlegend:false,hoverinfo:"skip"}; }
  function fetchJson(path) { return fetch(path).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  function getCss(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function escapeHtml(v) { var d = document.createElement("div"); d.textContent = v == null ? "" : String(v); return d.innerHTML; }
})();
