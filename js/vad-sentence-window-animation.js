(function () {
  "use strict";

  var DATA_ROOT = "../data/";
  var params = new URLSearchParams(window.location.search);
  var requestedNovelId = params.get("novel");
  var plot = document.getElementById("sentence-animation-plot");
  var controls = document.getElementById("character-controls");
  var timeline = document.getElementById("timeline");
  var timelineMarkers = document.getElementById("timeline-markers");
  var windowInput = document.getElementById("window-size");
  var speedInput = document.getElementById("speed");
  var playButton = document.getElementById("play-pause");
  var rangeLabel = document.getElementById("range-label");
  var statusLabel = document.getElementById("animation-status");
  var workspace = document.getElementById("animation-workspace");
  var plotWrap = document.getElementById("animation-plot-wrap");
  var splitter = document.getElementById("animation-splitter");
  var textPanel = document.getElementById("novel-panel");
  var novelText = document.getElementById("novel-text");
  var state = {
    characters: [], chapters: [], clusters: [], locations: [], events: [],
    clusterById: {}, characterById: {}, animationTraces: {}, centroidIndices: [],
    sphereIndices: [], hiddenClusters: new Set(), chapterById: {}, chapterLoads: {},
    position: 0, windowSize: 50, playing: false, timer: 0, resizeFrame: 0, renderRequest: 0
  };

  loadData().then(function () {
    renderCharacterControls();
    bindControls();
    renderTimelineMarkers();
    return buildPlot().then(updateVisibility);
  }).then(resizePlot).catch(showError);

  function loadData() {
    setLoading("Чтение каталога романов…");
    return AtlasData.loadNovelContext(requestedNovelId, { catalogUrl: DATA_ROOT + "catalog.json" }).then(function (context) {
        var manifest = context.novelManifest;
        state.manifest = manifest;
        state.base = context.dataBaseUrl;
        var title = AtlasData.localized(context.novel.title);
        document.title = title + " — анимация VAD";
        document.querySelector(".animation-page h1").textContent = title + ": анимация VAD";
        document.getElementById("back-link").href = "../novel.html?id=" + encodeURIComponent(context.novel.id) + "&feature=emotion-vad";
        setLoading("Загрузка структуры и персонажей…");
        return Promise.all([
          fetchJson(state.base + manifest.files.characters),
          fetchJson(state.base + manifest.files.chapters),
          fetchJson(state.base + manifest.files.clusters)
        ]);
    }).then(function (results) {
      state.characters = results[0].characters || [];
      state.chapters = (results[1].chapters || []).slice().sort(function (a, b) { return a.timeline_start_index - b.timeline_start_index; });
      state.clusters = results[2].clusters || [];
      state.characters.forEach(function (item) { state.characterById[item.id] = item; });
      state.clusters.forEach(function (item) { state.clusterById[item.id] = item; });
      state.chapters.forEach(function (chapter) { state.chapterById[chapter.id] = chapter; });
      var total = state.chapters.reduce(function (maximum, chapter) {
        return Math.max(maximum, Number(chapter.timeline_start_index) + Number(chapter.sentence_count));
      }, 0);
      state.locations = new Array(total);
      state.chapters.forEach(function (chapter) {
        for (var sentence = 0; sentence < Number(chapter.sentence_count); sentence += 1) {
          var index = Number(chapter.timeline_start_index) + sentence;
          state.locations[index] = { timeline_index: index, part: chapter.part, chapter: chapter.chapter, chapter_id: chapter.id, sentence: sentence + 1, text: null };
        }
      });
      if (!state.locations.length) throw new Error("В данных романа нет предложений");
    });
  }

  function loadChapter(chapter) {
    if (state.chapterLoads[chapter.id]) return state.chapterLoads[chapter.id];
    var novelPath = chapter.novel_path || state.manifest.files.novel_chapter_template.replace("{chapter_id}", chapter.id);
    var fragmentRequests = state.characters.filter(function (character) {
      return Number((chapter.character_counts || {})[character.id] || 0) > 0;
    }).map(function (character) {
      return fetchJson(state.base + character.fragments_path_template.replace("{chapter_id}", chapter.id));
    });
    state.chapterLoads[chapter.id] = Promise.all([fetchJson(state.base + novelPath), Promise.all(fragmentRequests)]).then(function (groups) {
      (groups[0].sentences || []).forEach(function (sentence) {
        var index = Number(sentence.timeline_index);
        state.locations[index] = { timeline_index: index, part: chapter.part, chapter: chapter.chapter, chapter_id: chapter.id, sentence: sentence.number, text: sentence.text };
      });
      groups[1].forEach(function (fragmentData) {
        var character = state.characterById[fragmentData.character_id] || {};
        (fragmentData.fragments || []).forEach(function (fragment) {
          var cluster = state.clusterById[fragment.cluster_id] || {};
          state.events.push({
            fragment_id: fragment.id,
            character_id: fragmentData.character_id,
            character_label: character.label || character.name || fragmentData.character_id,
            cluster_id: fragment.cluster_id,
            cluster_name: cluster.name || fragment.cluster_id,
            start: fragment.timeline_start_index,
            end: fragment.timeline_end_index,
            part: chapter.part,
            chapter: chapter.chapter,
            sentence_start: fragment.chapter_sentence_start,
            sentence_end: fragment.chapter_sentence_end,
            segments: (fragment.highlights || []).map(function (segment) {
              return { sentence: Number(chapter.timeline_start_index) + Number(segment.chapter_sentence || 1) - 1, start: segment.start, end: segment.end };
            }),
            vad: fragment.vad,
            text: fragment.text,
            warning: fragment.warning || ""
          });
        });
      });
      return chapter;
    });
    return state.chapterLoads[chapter.id];
  }

  function chaptersInRange(start, end) {
    return state.chapters.filter(function (chapter) {
      var chapterStart = Number(chapter.timeline_start_index), chapterEnd = chapterStart + Number(chapter.sentence_count) - 1;
      return chapterStart <= end && chapterEnd >= start;
    });
  }

  function ensureWindowLoaded(start, end) {
    return Promise.all(chaptersInRange(start, end).map(loadChapter));
  }

  function prefetchAfter(end) {
    var index = state.chapters.findIndex(function (chapter) {
      return Number(chapter.timeline_start_index) + Number(chapter.sentence_count) - 1 >= end;
    });
    if (index >= 0 && index + 1 < state.chapters.length) loadChapter(state.chapters[index + 1]).catch(function () {});
  }

  function renderCharacterControls() {
    controls.innerHTML = state.characters.map(function (character) {
      return '<label class="character-choice"><input type="checkbox" class="character-toggle" data-character="' + escapeHtml(character.id) + '" checked><span class="character-dot" style="--character-color:' + escapeHtml(character.color) + '"></span><span>' + escapeHtml(character.label || character.name) + '</span></label>';
    }).join("");
  }

  function buildPlot() {
    var traces = coordinateFrame();
    state.clusters.forEach(function (cluster) {
      var character = state.characterById[cluster.character_id] || {};
      var label = cluster.display_id + " — " + cluster.name + " · n=" + Number(cluster.size || 0).toLocaleString("ru-RU");
      state.centroidIndices.push(traces.length);
      traces.push({
        type: "scatter3d", mode: "markers", name: label, legendgroup: "cluster-" + cluster.id,
        meta: "centroid:" + cluster.character_id + ":" + cluster.id,
        x: [cluster.centroid[0]], y: [cluster.centroid[1]], z: [cluster.centroid[2]],
        marker: { size: 4, color: cluster.color || character.color, symbol: "circle", line: { color: "#fff", width: 1 } },
        hovertemplate: escapeHtml(label) + "<br>V %{x:.3f} · A %{y:.3f} · D %{z:.3f}<extra></extra>"
      });
      state.sphereIndices.push(traces.length);
      traces.push(sphereTrace(cluster));
    });
    state.characters.forEach(function (character) {
      state.animationTraces[character.id] = traces.length;
      traces.push({
        type: "scatter3d", mode: "markers", name: character.label || character.name,
        meta: "animation:" + character.id, showlegend: false,
        x: [], y: [], z: [], text: [], marker: { size: 5, color: character.color, opacity: .9, symbol: "circle", line: { color: "rgba(255,255,255,.75)", width: .7 } },
        hovertemplate: "%{text}<extra></extra>"
      });
    });
    plot.innerHTML = "";
    return Plotly.newPlot(plot, traces, {
      margin: { l: 0, r: 10, t: 70, b: 10 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, system-ui, sans-serif", color: css("--text-color") },
      showlegend: true, legend: { groupclick: "togglegroup", orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "center", x: .5 },
      scene: { xaxis: axis("Valence (V)"), yaxis: axis("Arousal (A)"), zaxis: axis("Dominance (D)"), aspectmode: "cube", camera: { eye: { x: .82, y: .82, z: .65 } }, uirevision: "vad-animation" },
      uirevision: "vad-animation"
    }, { responsive: true, displaylogo: false }).then(function () {
      plot.on("plotly_legendclick", function (event) {
        var id = clusterId(plot.data[event.curveNumber]);
        if (!id) return true;
        state.hiddenClusters.has(id) ? state.hiddenClusters.delete(id) : state.hiddenClusters.add(id);
        updateVisibility();
        return false;
      });
    });
  }

  function bindControls() {
    controls.addEventListener("change", function (event) { if (event.target.classList.contains("character-toggle")) updateVisibility(); });
    document.getElementById("show-spheres").addEventListener("change", updateVisibility);
    playButton.addEventListener("click", function () { state.playing ? stop() : play(); });
    document.getElementById("step-back").addEventListener("click", function () { stop(); state.position = Math.max(0, state.position - 1); render(); });
    document.getElementById("step-forward").addEventListener("click", function () { stop(); state.position = Math.min(maximumPosition(), state.position + 1); render(); });
    document.getElementById("restart").addEventListener("click", function () { stop(); state.position = 0; render(); });
    timeline.addEventListener("input", function () { stop(); state.position = Number(timeline.value); render(); });
    windowInput.addEventListener("input", function () { state.windowSize = Number(windowInput.value); state.position = Math.min(state.position, maximumPosition()); render(); });
    splitter.addEventListener("pointerdown", function (event) { if (window.matchMedia("(max-width:1000px)").matches) return; event.preventDefault(); splitter.setPointerCapture(event.pointerId); splitter.classList.add("dragging"); });
    splitter.addEventListener("pointermove", function (event) { if (splitter.hasPointerCapture(event.pointerId)) resizePanels(event.clientX); });
    splitter.addEventListener("pointerup", function (event) { if (!splitter.hasPointerCapture(event.pointerId)) return; splitter.releasePointerCapture(event.pointerId); splitter.classList.remove("dragging"); resizePlot(); });
    splitter.addEventListener("keydown", function (event) { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); var rect = workspace.getBoundingClientRect(); resizePanels(rect.right - textPanel.getBoundingClientRect().width + (event.key === "ArrowLeft" ? -24 : 24)); });
    if (window.ResizeObserver) new ResizeObserver(resizePlot).observe(plotWrap);
    window.addEventListener("resize", resizePlot);
  }

  function renderTimelineMarkers() {
    var fragment = document.createDocumentFragment();
    state.locations.forEach(function (location, index) {
      var previous = index ? state.locations[index - 1] : null;
      var startsPart = !previous || previous.part !== location.part;
      var startsChapter = startsPart || previous.chapter !== location.chapter;
      if (!startsChapter) return;
      var marker = document.createElement("span");
      marker.className = "timeline-marker " + (startsPart ? "part-marker" : "chapter-marker") + (index === 0 ? " at-start" : "");
      marker.style.left = (100 * index / Math.max(1, state.locations.length - 1)) + "%";
      marker.title = "Часть " + location.part + ", глава " + location.chapter + " · предложение " + (index + 1);
      var tick = document.createElement("span"); tick.className = "timeline-tick"; marker.appendChild(tick);
      if (startsPart) { var label = document.createElement("span"); label.className = "timeline-part-label"; label.textContent = "Ч" + location.part; marker.appendChild(label); }
      fragment.appendChild(marker);
    });
    timelineMarkers.replaceChildren(fragment);
  }

  function render() {
    var request = ++state.renderRequest;
    var end = Math.min(state.locations.length - 1, state.position + state.windowSize - 1);
    statusLabel.textContent = "Загрузка текущего окна…";
    return ensureWindowLoaded(state.position, end).then(function () {
      if (request !== state.renderRequest) return;
      return renderLoaded(end);
    });
  }

  function renderLoaded(end) {
    var active = activeEvents(end);
    var characterIds = state.characters.map(function (item) { return item.id; });
    var payloads = characterIds.map(function (id) {
      var selected = active.filter(function (event) { return event.character_id === id; });
      return { x: selected.map(vad(0)), y: selected.map(vad(1)), z: selected.map(vad(2)), text: selected.map(eventHover) };
    });
    var traceIndices = characterIds.map(function (id) { return state.animationTraces[id]; });
    var update = Plotly.restyle(plot, { x: payloads.map(prop("x")), y: payloads.map(prop("y")), z: payloads.map(prop("z")), text: payloads.map(prop("text")) }, traceIndices);
    timeline.max = maximumPosition(); timeline.value = state.position;
    document.getElementById("window-size-value").textContent = state.windowSize;
    document.getElementById("timeline-value").textContent = (state.position + 1) + "–" + (end + 1) + " / " + state.locations.length;
    rangeLabel.textContent = locationLabel(state.locations[state.position]) + " → " + locationLabel(state.locations[end]);
    statusLabel.textContent = active.length + " активных фрагм.";
    renderNovelText(active, end);
    prefetchAfter(end);
    return update;
  }

  function activeEvents(end) {
    return state.events.filter(function (event) { return event.start <= end && event.end >= state.position && enabled(event.character_id) && !state.hiddenClusters.has(event.cluster_id); });
  }

  function renderNovelText(active, end) {
    var rangesBySentence = new Map();
    active.forEach(function (event) {
      event.segments.forEach(function (segment) {
        if (segment.sentence < state.position || segment.sentence > end) return;
        if (!rangesBySentence.has(segment.sentence)) rangesBySentence.set(segment.sentence, []);
        rangesBySentence.get(segment.sentence).push({ start: segment.start, end: segment.end, color: (state.characterById[event.character_id] || {}).color, fragmentId: event.fragment_id, label: event.character_label + " · " + event.cluster_name });
      });
    });
    var fragment = document.createDocumentFragment();
    for (var sentenceIndex = state.position; sentenceIndex <= end; sentenceIndex += 1) {
      var location = state.locations[sentenceIndex];
      var paragraph = document.createElement("p"); paragraph.className = "novel-sentence"; paragraph.dataset.sentence = sentenceIndex;
      var number = document.createElement("span"); number.className = "sentence-number"; number.textContent = location.part + "." + location.chapter + "." + location.sentence;
      paragraph.append(number, document.createTextNode(" "));
      appendHighlightedText(paragraph, location.text, rangesBySentence.get(sentenceIndex) || []);
      fragment.appendChild(paragraph);
    }
    novelText.replaceChildren(fragment);
    var highlighted = Array.from(novelText.querySelectorAll("mark"));
    if (highlighted.length) {
      var middle = state.position + (end - state.position) / 2;
      var focus = highlighted.reduce(function (best, mark) { return Math.abs(Number(mark.closest(".novel-sentence").dataset.sentence) - middle) < Math.abs(Number(best.closest(".novel-sentence").dataset.sentence) - middle) ? mark : best; }, highlighted[0]);
      textPanel.scrollTop = Math.max(0, focus.offsetTop - textPanel.clientHeight / 2 + focus.offsetHeight / 2);
    } else textPanel.scrollTop = 0;
  }

  function appendHighlightedText(parent, text, ranges) {
    var boundaries = Array.from(new Set([0, text.length].concat(ranges.reduce(function (all, range) { return all.concat([clamp(range.start, 0, text.length), clamp(range.end, 0, text.length)]); }, [])))).sort(function (a, b) { return a - b; });
    for (var i = 0; i < boundaries.length - 1; i += 1) {
      var start = boundaries[i], finish = boundaries[i + 1];
      if (finish <= start) continue;
      var covering = ranges.filter(function (range) { return range.start < finish && range.end > start; });
      var content = text.slice(start, finish);
      if (!covering.length) parent.appendChild(document.createTextNode(content));
      else { var mark = document.createElement("mark"); mark.textContent = content; mark.style.backgroundColor = alpha(covering[0].color, .3); mark.title = Array.from(new Set(covering.map(function (range) { return range.label; }))).join("\n"); parent.appendChild(mark); }
    }
  }

  function updateVisibility() {
    var indices = [], visibility = [], legends = [];
    state.centroidIndices.forEach(function (index) {
      var trace = plot.data[index], meta = String(trace.meta).slice("centroid:".length).split(":"), characterVisible = enabled(meta[0]), clusterHidden = state.hiddenClusters.has(meta.slice(1).join(":"));
      indices.push(index); visibility.push(!characterVisible ? false : clusterHidden ? "legendonly" : true); legends.push(characterVisible);
    });
    var showSpheres = document.getElementById("show-spheres").checked;
    state.sphereIndices.forEach(function (index) {
      var trace = plot.data[index], meta = String(trace.meta).slice("sphere:".length).split(":"), characterVisible = enabled(meta[0]), clusterHidden = state.hiddenClusters.has(meta.slice(1).join(":"));
      indices.push(index); visibility.push(showSpheres && characterVisible && !clusterHidden); legends.push(false);
    });
    Object.keys(state.animationTraces).forEach(function (id) { indices.push(state.animationTraces[id]); visibility.push(enabled(id)); legends.push(false); });
    return Plotly.restyle(plot, { visible: visibility, showlegend: legends }, indices).then(render);
  }

  function coordinateFrame() {
    var traces = [], axisColor = "rgba(150,158,165,.85)", gridColor = "rgba(125,134,142,.58)";
    traces.push(line([-1,1],[0,0],[0,0],axisColor,4), line([0,0],[-1,1],[0,0],axisColor,4), line([0,0],[0,0],[-1,1],axisColor,4));
    ["z","y","x"].forEach(function (fixed) { traces.push(gridTrace(fixed, gridColor)); });
    traces.push(planeTrace([[-1,1],[-1,1]],[[-1,-1],[1,1]],[[0,0],[0,0]],"#dce7f5"));
    traces.push(planeTrace([[-1,1],[-1,1]],[[0,0],[0,0]],[[-1,-1],[1,1]],"#e3f0e5"));
    traces.push(planeTrace([[0,0],[0,0]],[[-1,1],[-1,1]],[[-1,-1],[1,1]],"#f4e5df"));
    traces.push({ type:"scatter3d", mode:"markers", x:[0], y:[0], z:[0], marker:{size:5,color:css("--text-color"),symbol:"diamond"}, showlegend:false, hoverinfo:"skip" });
    traces.push({ type:"scatter3d", mode:"text", x:[-1.02,1.02,0,0,0,0], y:[0,0,-1.02,1.02,0,0], z:[0,0,0,0,-1.02,1.02], text:["неприятно","приятно","спокоен","возбуждён","бесконтрольность","контроль"], textfont:{size:12,color:css("--text-color")}, showlegend:false, hoverinfo:"skip" });
    return traces;
  }
  function line(x,y,z,color,width){ return {type:"scatter3d",mode:"lines",x:x,y:y,z:z,line:{color:color,width:width},showlegend:false,hoverinfo:"skip"}; }
  function gridTrace(fixed,color){ var values=[-1,-.75,-.5,-.25,.25,.5,.75,1],x=[],y=[],z=[]; values.forEach(function(t){ if(fixed==="z"){x.push(-1,1,null,t,t,null);y.push(t,t,null,-1,1,null);z.push(0,0,null,0,0,null);}else if(fixed==="y"){x.push(-1,1,null,t,t,null);y.push(0,0,null,0,0,null);z.push(t,t,null,-1,1,null);}else{x.push(0,0,null,0,0,null);y.push(-1,1,null,t,t,null);z.push(t,t,null,-1,1,null);} }); return line(x,y,z,color,1); }
  function planeTrace(x,y,z,color){return {type:"surface",x:x,y:y,z:z,surfacecolor:[[0,0],[0,0]],colorscale:[[0,color],[1,color]],showscale:false,opacity:.18,showlegend:false,hoverinfo:"skip",lighting:{ambient:1,diffuse:0,specular:0}};}
  function sphereTrace(cluster){ var center=cluster.centroid,r=Number(cluster.sphere_radius||0),lon=12,lat=8,vertices=[[center[0],center[1],center[2]+r]],i=[],j=[],k=[]; for(var a=1;a<lat;a++)for(var b=0;b<lon;b++){var ph=Math.PI*a/lat,th=2*Math.PI*b/lon;vertices.push([center[0]+r*Math.sin(ph)*Math.cos(th),center[1]+r*Math.sin(ph)*Math.sin(th),center[2]+r*Math.cos(ph)]);}var bottom=vertices.length;vertices.push([center[0],center[1],center[2]-r]);for(var q=0;q<lon;q++){i.push(0);j.push(1+q);k.push(1+(q+1)%lon);}for(var ring=0;ring<lat-2;ring++)for(var n=0;n<lon;n++){var c=1+ring*lon+n,d=1+ring*lon+(n+1)%lon,e=c+lon,f=d+lon;i.push(c,c);j.push(e,f);k.push(f,d);}var last=1+(lat-2)*lon;for(var q2=0;q2<lon;q2++){i.push(last+q2);j.push(bottom);k.push(last+(q2+1)%lon);}return {type:"mesh3d",name:cluster.display_id+" sphere",legendgroup:"cluster-"+cluster.id,meta:"sphere:"+cluster.character_id+":"+cluster.id,x:vertices.map(prop(0)),y:vertices.map(prop(1)),z:vertices.map(prop(2)),i:i,j:j,k:k,color:cluster.color,opacity:.22,flatshading:false,showlegend:false,visible:false,hoverinfo:"skip",lighting:{ambient:.72,diffuse:.58,specular:.12,roughness:.8,fresnel:.08}}; }
  function axis(title){return {title:{text:title},range:[-1.08,1.08],showgrid:false,zeroline:false,showspikes:false,backgroundcolor:"rgba(0,0,0,0)",color:css("--text-muted")};}

  function stop(){state.playing=false;clearTimeout(state.timer);playButton.textContent="Старт";playButton.setAttribute("aria-pressed","false");}
  function play(){if(state.position>=maximumPosition())state.position=0;state.playing=true;playButton.textContent="Пауза";playButton.setAttribute("aria-pressed","true");tick();}
  function tick(){if(!state.playing)return;if(state.position>=maximumPosition()){stop();return;}state.position+=1;Promise.resolve(render()).then(function(){if(state.playing)state.timer=setTimeout(tick,1000/Number(speedInput.value));});}
  function maximumPosition(){return Math.max(0,state.locations.length-state.windowSize);}
  function enabled(id){var box=controls.querySelector('[data-character="'+cssEscape(id)+'"]');return box ? box.checked : true;}
  function clusterId(trace){var group=String(trace.legendgroup||"");return group.indexOf("cluster-")===0?group.slice(8):null;}
  function locationLabel(item){return "Часть "+item.part+", глава "+item.chapter+", предложение "+item.sentence;}
  function eventHover(event){return escapeHtml(event.fragment_id)+"<br>"+escapeHtml(event.character_label)+" · "+escapeHtml(event.cluster_name)+"<br>Часть "+event.part+", глава "+event.chapter+", предложение "+event.sentence_start+(event.sentence_end!==event.sentence_start?"–"+event.sentence_end:"")+"<br>"+escapeHtml(event.text)+"<br>V "+Number(event.vad[0]).toFixed(3)+" · A "+Number(event.vad[1]).toFixed(3)+" · D "+Number(event.vad[2]).toFixed(3)+(event.warning?"<br>warning: "+escapeHtml(event.warning):"");}
  function resizePlot(){cancelAnimationFrame(state.resizeFrame);state.resizeFrame=requestAnimationFrame(function(){if(plot.data)Plotly.Plots.resize(plot);});}
  function resizePanels(clientX){var rect=workspace.getBoundingClientRect(),available=rect.width-splitter.offsetWidth,requested=rect.right-clientX,width=Math.max(300,Math.min(Math.max(300,available-360),requested));workspace.style.setProperty("--text-width",width+"px");resizePlot();}
  function setLoading(message){plot.innerHTML='<div class="loading-state">'+escapeHtml(message)+'</div>';}
  function showError(error){plot.innerHTML='<div class="error-state">Не удалось загрузить данные: '+escapeHtml(error.message)+'</div>';controls.innerHTML="";}
  function fetchJson(url){return fetch(url).then(function(response){if(!response.ok)throw new Error("HTTP "+response.status+" — "+url);return response.json();});}
  function vad(index){return function(event){return Number(event.vad[index]);};}
  function prop(key){return function(item){return item[key];};}
  function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)));}
  function alpha(hex,opacity){var value=String(hex||"#777777").replace("#","");if(value.length===3)value=value.split("").map(function(c){return c+c;}).join("");return "rgba("+parseInt(value.slice(0,2),16)+","+parseInt(value.slice(2,4),16)+","+parseInt(value.slice(4,6),16)+","+opacity+")";}
  function css(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim()||"#d9e1df";}
  function cssEscape(value){return window.CSS&&CSS.escape?CSS.escape(value):String(value).replace(/"/g,"\\\"");}
  function escapeHtml(value){return String(value==null?"":value).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  window.__vadSentenceAnimation={state:function(){return {position:state.position,windowSize:state.windowSize,playing:state.playing,maximumPosition:maximumPosition(),locations:state.locations.length,events:state.events.length};},render:render};
})();
