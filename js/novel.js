(function() {
  "use strict";
  var params = new URLSearchParams(window.location.search);
  var novelId = params.get("id");
  var requestedFeatureId = params.get("feature");
  var pageContext = null;
  var activeController = null;

  window.AtlasFeatureRenderers = { loadGraph: loadGraph, renderExplorerIndex: renderExplorerIndex };

  if (!novelId) { showPageError("Произведение не указано. Добавьте параметр ?id=<novel-id>."); return; }
  AtlasData.loadNovelContext(novelId).then(function(context) {
    pageContext = context;
    setNovelHeader(context.novel);
    configureFeatures(context.novelManifest.features || []);
  }).catch(function(error) { showPageError(readableLoadError(error)); });

  function configureFeatures(features) {
    renderFeatureTabs(features);
    var ready = features.filter(function(feature) { return feature.status === "ready"; });
    if (!ready.length) { showFeatureMessage("Для этого произведения пока нет готовых разделов."); return; }
    var requested = requestedFeatureId && features.find(function(feature) { return feature.id === requestedFeatureId; });
    if (requested && requested.status === "ready") { openFeature(requested, false); return; }
    var explanation = requestedFeatureId ? (requested ? "Запрошенный раздел пока недоступен. " : "Запрошенный раздел не найден. ") : "";
    openFeature(ready[0], false, explanation);
  }

  function renderFeatureTabs(features) {
    var tabBar = document.querySelector(".tab-bar");
    var panels = document.getElementById("featurePanels");
    tabBar.innerHTML = ""; panels.innerHTML = "";
    features.forEach(function(feature) {
      if (!feature || !feature.id) return;
      var button = document.createElement("button");
      button.id = "tab-" + feature.id; button.className = "tab-btn"; button.dataset.featureId = feature.id;
      button.textContent = AtlasData.localized(feature.label); button.disabled = feature.status !== "ready";
      if (feature.status !== "ready") {
        var badge = document.createElement("span"); badge.className = "tab-badge";
        badge.textContent = feature.status === "planned" ? "скоро" : "недоступно"; button.appendChild(badge);
      }
      button.addEventListener("click", function() { openFeature(feature, true); });
      tabBar.appendChild(button);
      var panel = document.createElement("div"); panel.id = "panel-" + feature.id; panel.className = "tab-panel";
      panel.setAttribute("role", "tabpanel"); panels.appendChild(panel);
    });
  }

  function openFeature(feature, updateUrl, explanation) {
    if (activeController) activeController.abort();
    activeController = new AbortController(); activateFeature(feature.id);
    if (updateUrl) {
      var url = new URL(window.location.href); url.searchParams.set("id", pageContext.novel.id);
      url.searchParams.set("feature", feature.id); history.pushState(null, "", url);
    }
    var panel = document.getElementById("panel-" + feature.id);
    panel.innerHTML = explanation ? '<div class="placeholder">' + escapeHtml(explanation) + "Открыт первый доступный раздел.</div>" : "";
    var renderer = AtlasFeatureRegistry.getFeatureRenderer(feature.renderer);
    if (!renderer) { renderPanelError(panel, "Этот тип визуализации не поддерживается: " + feature.renderer); return; }
    if (!feature.entry) { renderPanelError(panel, "Для раздела не указан файл данных."); return; }
    renderer.load({ novel: pageContext.novel, novelManifest: pageContext.novelManifest, feature: feature,
      dataBaseUrl: pageContext.dataBaseUrl, manifestUrl: pageContext.manifestUrl, panel: panel, signal: activeController.signal });
  }

  function activateFeature(featureId) {
    document.querySelectorAll(".tab-btn").forEach(function(button) { button.classList.toggle("active", button.dataset.featureId === featureId); });
    document.querySelectorAll(".tab-panel").forEach(function(panel) { panel.classList.toggle("active", panel.id === "panel-" + featureId); });
  }

  function loadGraph(context) {
    context.panel.classList.add("graph-panel");
    var container = document.createElement("div"); container.id = "graph-container";
    container.innerHTML = '<div class="loading-state">Загрузка графа…</div>';
    var entryUrl = AtlasData.resolveRelative(context.manifestUrl, context.feature.entry);
    return AtlasData.fetchJson(entryUrl, context.signal).then(function(data) {
      if (data && Array.isArray(data.interaction_types)) {
        return setupNetworkGraph(context, container, data);
      }
      context.panel.appendChild(container); container.innerHTML = "";
      initGraph(container, data.nodes || [], data.edges || [], function(node) { showModal(node.label, "герой", node.desc); },
        function(edge, fromNode, toNode) { var title = (fromNode ? fromNode.label : edge.from) + " → " + (toNode ? toNode.label : edge.to); showModal(title, "связь", (edge.label || "") + "\n\n" + (edge.desc || "")); });
    }).catch(function(error) { if (error.name !== "AbortError") renderPanelError(container, "Не удалось загрузить граф: " + error.message); });
  }

  // Self-contained character network (character-network.json, schema_version 1):
  // one "Отношения" mode (edge.relation, coloured by category) plus one mode per
  // interaction type (edge.types[typeId]). Edge weights arrive pre-normalised 1..5.
  function setupNetworkGraph(context, container, data) {
    var files = context.novelManifest && context.novelManifest.files;
    var chaptersRel = (files && files.chapters) || "chapters.json";
    var chaptersUrl = AtlasData.resolveRelative(context.manifestUrl, chaptersRel);
    return AtlasData.fetchJson(chaptersUrl, context.signal).catch(function() { return null; }).then(function(chaptersDoc) {
      var chapterById = {};
      var chList = chaptersDoc && chaptersDoc.chapters ? chaptersDoc.chapters : (Array.isArray(chaptersDoc) ? chaptersDoc : []);
      chList.forEach(function(c) { if (c && c.id) chapterById[c.id] = c; });
      buildNetworkGraph(context, container, data, chapterById);
    });
  }

  // Resolve "chapter_2_1_2" to a chapters.json entry, falling back to the parent
  // logical chapter ("2_1_2" -> "2_1") when the sub-section isn't listed.
  function resolveChapter(chapterById, introChapter) {
    if (!introChapter) return null;
    var key = String(introChapter).replace(/^chapter_/, "");
    while (key) {
      if (chapterById[key]) return chapterById[key];
      var cut = key.lastIndexOf("_");
      if (cut < 0) return null;
      key = key.slice(0, cut);
    }
    return null;
  }

  function nodeModalBody(node, chapterById) {
    var body = node.desc || "";
    var ch = resolveChapter(chapterById, node.intro_chapter);
    if (ch) {
      body += (body ? "\n\n" : "") + "──────────\nВпервые появляется: " + (ch.label || node.intro_chapter);
      if (ch.description) body += "\n\n" + ch.description;
    }
    return body;
  }

  function buildNetworkGraph(context, container, data, chapterById) {
    var catColor = {};
    (data.categories || []).forEach(function(c) { catColor[c.id] = c.color; });
    var typeLabel = {};
    (data.interaction_types || []).forEach(function(t) { typeLabel[t.id] = AtlasData.localized(t.label); });

    var nodesData = (data.nodes || []).map(function(n) {
      return { id: n.id, label: n.label || n.id, desc: n.desc || "", intro_chapter: n.intro_chapter };
    });
    var nameById = {};
    nodesData.forEach(function(n) { nameById[n.id] = n.label; });

    var modes = [{ id: "relations", label: "Отношения", kind: "relations" }].concat(
      (data.interaction_types || []).map(function(t) { return { id: t.id, label: typeLabel[t.id], kind: "type" }; }));

    var modeEdges = {};
    modes.forEach(function(mode) {
      var list = [];
      (data.edges || []).forEach(function(e) {
        if (mode.kind === "relations") {
          if (!e.relation) return;
          list.push({ from: e.a, to: e.b, label: "",
            color: catColor[e.relation.category] || catColor["прочее"],
            weight: { N: e.relation.weight || 1 },
            desc: relationDesc(e, nameById) });
        } else {
          var t = e.types && e.types[mode.id];
          if (!t) return;
          list.push({ from: e.a, to: e.b, label: String(t.count),
            weight: { N: t.weight || 1 },
            desc: typeDesc(e, mode.id, typeLabel) });
        }
      });
      modeEdges[mode.id] = list;
    });

    // Superset used once to lay out the nodes; every mode is a subset of it,
    // so positions stay put when the filter changes.
    var layoutEdges = (data.edges || []).map(function(e) {
      var rw = e.relation ? e.relation.weight : 1;
      return { from: e.a, to: e.b, weight: { N: rw || 1 } };
    });

    var graph;
    var bar = document.createElement("div"); bar.className = "graph-modes";
    var legend = document.createElement("div"); legend.className = "graph-legend";
    modes.forEach(function(mode, index) {
      var button = document.createElement("button");
      button.className = "graph-mode-btn" + (index === 0 ? " active" : "");
      button.textContent = mode.label;
      button.addEventListener("click", function() {
        bar.querySelectorAll(".graph-mode-btn").forEach(function(x) { x.classList.remove("active"); });
        button.classList.add("active");
        if (graph) graph.applyEdges(modeEdges[mode.id]);
        renderLegend(mode);
      });
      bar.appendChild(button);
    });

    context.panel.appendChild(bar);
    context.panel.appendChild(legend);
    context.panel.appendChild(container);
    container.innerHTML = "";

    graph = initGraph(container, nodesData, modeEdges[modes[0].id],
      function(node) { showModal(node.label, "герой", nodeModalBody(node, chapterById)); },
      function(edge, fromNode, toNode) {
        var title = (fromNode ? fromNode.label : edge.from) + " ↔ " + (toNode ? toNode.label : edge.to);
        showModal(title, "связь", edge.desc || edge.label || "");
      },
      layoutEdges);
    renderLegend(modes[0]);

    function renderLegend(mode) {
      if (mode.kind === "relations") {
        legend.innerHTML = (data.categories || []).map(function(c) {
          return '<span class="graph-legend-item"><i style="background:' + c.color + '"></i>' + escapeHtml(c.id) + "</span>";
        }).join("");
      } else {
        legend.innerHTML = '<span class="graph-legend-note">Толщина линии — сила взаимодействия, число на ней — количество реплик. Персонажи без связей этого типа приглушены.</span>';
      }
    }
  }

  function relationDesc(e, nameById) {
    var r = e.relation || {};
    var na = nameById[e.a] || e.a, nb = nameById[e.b] || e.b;
    var roles = r.roles || [];
    var lines = ["Категория: " + r.category];
    if (roles[0] || roles[1]) {
      lines.push(na + " → " + nb + ": " + (roles[0] || "—"));
      lines.push(nb + " → " + na + ": " + (roles[1] || "—"));
    }
    if (r.evolves) lines.push("Отношения меняются по ходу романа.");
    if (r.note) lines.push("\n" + r.note);
    lines.push("\nВзаимодействий: " + (e.interactions || 0) + " · глав: " + ((r.chapters || []).length));
    return lines.join("\n");
  }

  function typeDesc(e, typeId, typeLabel) {
    var types = e.types || {};
    var here = types[typeId] || {};
    var order = Object.keys(types).sort(function(x, y) { return (types[y].count || 0) - (types[x].count || 0); });
    var lines = [typeLabel[typeId] || typeId, "Реплик: " + here.count + " · сила: " + here.raw_weight, "", "Все типы для этой пары:"];
    order.forEach(function(k) {
      lines.push("· " + (typeLabel[k] || k) + " — " + types[k].count + " реплик (сила " + types[k].raw_weight + ")");
    });
    lines.push("\nВсего взаимодействий: " + (e.interactions || 0));
    return lines.join("\n");
  }

  function renderExplorerIndex(context) {
    var explorers = context.feature.explorers || [];
    if (!explorers.length) { renderPanelError(context.panel, "Для этого раздела пока нет доступных исследовательских интерфейсов."); return; }
    context.panel.insertAdjacentHTML("beforeend", '<div class="emotion-landing"><section class="emotion-hero"><div>' +
      '<p class="landing-eyebrow">' + escapeHtml(AtlasData.localized(context.novel.title)) + ' · VAD Atlas</p><h2>' + escapeHtml(AtlasData.localized(context.feature.label)) + '</h2>' +
      '<p class="landing-lede">Интерактивные исследовательские шаги для просмотра эмоциональных состояний, кластеров и VAD-пространства романа.</p></div>' +
      '<div class="vad-orbit" aria-label="Valence, Arousal and Dominance axes"><span class="axis-letter axis-v">V</span><span class="axis-letter axis-a">A</span><span class="axis-letter axis-d">D</span><span class="orbit-center"></span></div></section>' +
      '<section class="explorer-section"><div class="landing-section-head"><div><p class="landing-kicker">Current pipeline</p><h3>Explore the data</h3></div></div><div class="explorer-grid">' +
      explorers.map(function(explorer, index) { return explorerCard(context, explorer, index); }).join("") + '</div></section></div>');
  }

  function explorerCard(context, explorer, index) {
    var href = explorer.entry ? AtlasData.resolveRelative(context.manifestUrl, explorer.entry) : "";
    if (href) { var url = new URL(href); url.searchParams.set("novel", context.novel.id); href = url.toString(); }
    var tag = href ? "a" : "span";
    return '<' + tag + ' class="explorer-card' + (href ? "" : " disabled") + '"' + (href ? ' href="' + escapeHtml(href) + '"' : ' aria-disabled="true"') + '>' +
      '<div class="explorer-visual" aria-hidden="true">' + explorerVisual(explorer) + '</div><div class="explorer-body"><div class="explorer-meta"><span>Step ' + (index + 1) +
      '</span><span class="card-arrow">' + (href ? "↗" : "скоро") + '</span></div><h4>' + escapeHtml(explorer.name || "Untitled explorer") + '</h4><p>' + escapeHtml(explorer.description || "") + '</p></div></' + tag + '>';
  }

  function explorerVisual(explorer) {
    var key = ((explorer.entry || "") + " " + (explorer.name || "")).toLowerCase();
    if (/pipeline|diagram/.test(key)) return visualPipeline();
    if (/chapter_plutchik_table|profiles by chapter|table/.test(key)) return visualChapterTable();
    if (/radar|plutchik/.test(key)) return visualRadar();
    if (/centroid.*sphere|sphere/.test(key)) return visualSpheres();
    if (/sentence.window|animation/.test(key)) return visualAnimation();
    if (/kmeans_interactive|cluster space/.test(key)) return visualClusterScatter();
    return visualCloud();
  }

  // Plutchik profiles by chapter: three small radar shapes in a row, each a different silhouette.
  function visualChapterTable() {
    return '<svg viewBox="0 0 360 130">' +
      '<polygon class="chart-line" fill="none" stroke-width="1.2" points="75,37 99,51 99,79 75,93 51,79 51,51"/>' +
      '<polygon class="series-v" opacity=".8" points="75,55 91,56 85,75 75,81 57,72 63,54"/>' +
      '<polygon class="chart-line" fill="none" stroke-width="1.2" points="180,37 204,51 204,79 180,93 156,79 156,51"/>' +
      '<polygon class="series-a" opacity=".8" points="180,41 200,59 188,77 180,75 158,77 170,47"/>' +
      '<polygon class="chart-line" fill="none" stroke-width="1.2" points="285,37 309,51 309,79 285,93 261,79 261,51"/>' +
      '<polygon class="series-d" opacity=".8" points="285,49 299,53 307,73 285,85 275,71 265,57"/></svg>';
  }

  // VAD -> Plutchik pipeline: a row of connected stage boxes, final step highlighted.
  function visualPipeline() {
    return '<svg viewBox="0 0 360 130">' +
      '<rect class="chart-line" fill="none" stroke-width="1.5" x="12" y="52" width="62" height="26" rx="7"/>' +
      '<rect class="chart-line" fill="none" stroke-width="1.5" x="100" y="52" width="62" height="26" rx="7"/>' +
      '<rect class="chart-line" fill="none" stroke-width="1.5" x="188" y="52" width="62" height="26" rx="7"/>' +
      '<rect class="series-v" opacity=".85" x="276" y="52" width="62" height="26" rx="7"/>' +
      '<path class="chart-line" fill="none" stroke-width="1.5" d="M74,65 L98,65 M92,59 L98,65 L92,71"/>' +
      '<path class="chart-line" fill="none" stroke-width="1.5" d="M162,65 L186,65 M180,59 L186,65 L180,71"/>' +
      '<path class="chart-line" fill="none" stroke-width="1.5" d="M250,65 L274,65 M268,59 L274,65 L268,71"/></svg>';
  }

  // Multi-character cluster space: axes + colored fragment clusters with cross centroids.
  function visualClusterScatter() {
    return '<svg viewBox="0 0 360 130">' +
      '<path class="chart-line" fill="none" stroke-width="2" d="M50,106 L322,106 M50,106 L50,16 M50,106 L128,126"/>' +
      '<circle class="dot-accent" cx="100" cy="46" r="6"/><circle class="dot-accent" cx="118" cy="64" r="6"/><circle class="dot-accent" cx="86" cy="70" r="6"/>' +
      '<circle class="dot" cx="182" cy="36" r="6"/><circle class="dot" cx="204" cy="56" r="6"/><circle class="dot" cx="168" cy="66" r="6"/>' +
      '<circle class="dot-violet" cx="256" cy="80" r="6"/><circle class="dot-violet" cx="276" cy="96" r="6"/><circle class="dot-violet" cx="238" cy="92" r="6"/>' +
      '<path class="series-v" stroke-width="3" stroke-linecap="round" d="M103,58 L103,44 M96,51 L110,51"/>' +
      '<path class="series-a" stroke-width="3" stroke-linecap="round" d="M188,58 L188,44 M181,51 L195,51"/>' +
      '<path class="series-d" stroke-width="3" stroke-linecap="round" d="M256,94 L256,80 M249,87 L263,87"/></svg>';
  }

  // Chapter VAD and Plutchik profiles: radar/spider chart with a filled emotion profile.
  function visualRadar() {
    return '<svg viewBox="0 0 360 130">' +
      '<polygon class="chart-line" fill="none" stroke-width="1.5" points="180,10 234,38 234,90 180,118 126,90 126,38"/>' +
      '<polygon class="chart-line" fill="none" stroke-width="1" points="180,30 211,46 211,82 180,98 149,82 149,46"/>' +
      '<polygon class="series-v" opacity=".55" stroke-width="2.5" points="180,20 224,42 219,86 178,106 143,80 137,44"/></svg>';
  }

  // Chapter VAD clouds: a plain two-character point cloud in the VAD axes, no clusters or centroids.
  function visualCloud() {
    return '<svg viewBox="0 0 360 130">' +
      '<path class="chart-line" fill="none" stroke-width="2" d="M50,106 L322,106 M50,106 L50,16 M50,106 L128,126"/>' +
      '<circle class="dot-accent" cx="100" cy="46" r="4"/><circle class="dot-accent" cx="116" cy="62" r="4"/><circle class="dot-accent" cx="88" cy="72" r="4"/>' +
      '<circle class="dot-accent" cx="128" cy="36" r="4"/><circle class="dot-accent" cx="106" cy="80" r="4"/>' +
      '<circle class="dot" cx="196" cy="42" r="4"/><circle class="dot" cx="216" cy="60" r="4"/><circle class="dot" cx="184" cy="70" r="4"/>' +
      '<circle class="dot" cx="230" cy="46" r="4"/><circle class="dot" cx="204" cy="82" r="4"/></svg>';
  }

  // K-Means centroids and spheres: overlapping cluster spheres with centroid dots.
  function visualSpheres() {
    return '<svg viewBox="0 0 360 130">' +
      '<circle class="outline-v" stroke-width="2.5" opacity=".85" cx="146" cy="68" r="40"/>' +
      '<circle class="outline-a" stroke-width="2.5" opacity=".85" cx="208" cy="48" r="32"/>' +
      '<circle class="outline-d" stroke-width="2.5" opacity=".85" cx="224" cy="90" r="28"/>' +
      '<circle class="dot-accent" cx="146" cy="68" r="5"/><circle class="dot" cx="208" cy="48" r="5"/><circle class="dot-violet" cx="224" cy="90" r="5"/></svg>';
  }

  // Sentence-window VAD animation: text lines with a moving highlighted window and a VAD point trail.
  function visualAnimation() {
    return '<svg viewBox="0 0 360 130">' +
      '<rect class="chart-line" fill="none" stroke-width="1.5" x="26" y="18" width="220" height="15" rx="3"/>' +
      '<rect class="chart-line" fill="none" stroke-width="1.5" x="26" y="40" width="180" height="15" rx="3"/>' +
      '<rect class="series-v" opacity=".22" x="20" y="61" width="232" height="21" rx="4"/>' +
      '<rect class="chart-line" fill="none" stroke-width="1.5" x="26" y="64" width="200" height="15" rx="3"/>' +
      '<rect class="chart-line" fill="none" stroke-width="1.5" x="26" y="86" width="160" height="15" rx="3"/>' +
      '<rect class="chart-line" fill="none" stroke-width="1.5" x="26" y="108" width="190" height="15" rx="3"/>' +
      '<circle class="dot-accent" cx="292" cy="44" r="5"/><circle class="dot" cx="306" cy="70" r="5"/><circle class="dot-violet" cx="288" cy="94" r="5"/>' +
      '<path class="chart-line" fill="none" stroke-width="1.5" stroke-dasharray="3 4" d="M292,44 L306,70 L288,94"/></svg>';
  }

  function setNovelHeader(novel) { var title = AtlasData.localized(novel.title); document.title = title + " — анализ"; document.getElementById("novelTitle").textContent = title; document.getElementById("novelMeta").textContent = AtlasData.localized(novel.author) + " · " + novel.year; }
  function showFeatureMessage(message) { document.getElementById("featurePanels").innerHTML = '<div class="tab-panel active"><div class="placeholder">' + escapeHtml(message) + '</div></div>'; }
  function renderPanelError(element, message) { element.innerHTML = '<div class="error-state">' + escapeHtml(message) + '</div>'; }
  function showPageError(message) { document.getElementById("novelTitle").textContent = "Ошибка загрузки"; document.getElementById("novelMeta").textContent = message; showFeatureMessage(message); }
  function readableLoadError(error) { if (/Unknown novel ID/.test(error.message)) return "Произведение с таким идентификатором отсутствует в каталоге."; if (/HTTP 404/.test(error.message)) return "Не удалось найти манифест произведения."; return "Не удалось загрузить данные произведения: " + error.message; }
  function escapeHtml(value) { var div = document.createElement("div"); div.textContent = value == null ? "" : String(value); return div.innerHTML; }
})();
