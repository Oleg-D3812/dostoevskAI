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
    container.innerHTML = '<div class="loading-state">Загрузка графа…</div>'; context.panel.appendChild(container);
    return AtlasData.fetchJson(AtlasData.resolveRelative(context.manifestUrl, context.feature.entry), context.signal).then(function(data) {
      initGraph(container, data.nodes || [], data.edges || [], function(node) { showModal(node.label, "герой", node.desc); },
        function(edge, fromNode, toNode) { var title = (fromNode ? fromNode.label : edge.from) + " → " + (toNode ? toNode.label : edge.to); showModal(title, "связь", (edge.label || "") + "\n\n" + (edge.desc || "")); });
    }).catch(function(error) { if (error.name !== "AbortError") renderPanelError(container, "Не удалось загрузить граф: " + error.message); });
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
    if (/radar|plutchik/.test(key)) return visualRadar();
    if (/centroid.*sphere|sphere/.test(key)) return visualSpheres();
    if (/sentence.window|animation/.test(key)) return visualAnimation();
    if (/kmeans_interactive|cluster space/.test(key)) return visualClusterScatter();
    return visualCloud();
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
