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
    updateHelpLink(feature);
    if (updateUrl) {
      var url = new URL(window.location.href); url.searchParams.set("id", pageContext.novel.id);
      url.searchParams.set("feature", feature.id); url.searchParams.delete("spec"); history.pushState(null, "", url);
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

  function updateHelpLink(feature) {
    var link = document.getElementById("helpLink");
    if (!link) return;
    if (!feature.help) { link.hidden = true; return; }
    var url = new URL(AtlasData.resolveRelative(pageContext.manifestUrl, feature.help));
    url.searchParams.set("novel", pageContext.novel.id);
    link.href = url.toString();
    link.dataset.helpTitle = AtlasData.localized(feature.label);
    link.hidden = false;
  }

  // Help pops up in an overlay (like the chapter reader) instead of navigating
  // away; Ctrl/Cmd/Shift-click and middle-click still open it as a real link.
  (function initHelpOverlay() {
    var link = document.getElementById("helpLink");
    var overlay = document.getElementById("helpOverlay");
    if (!link || !overlay) return;
    var frame = document.getElementById("helpFrame");
    var titleEl = document.getElementById("helpModalTitle");
    var newTabLink = document.getElementById("helpOpenNewTab");

    function openHelp() {
      titleEl.textContent = "Помощь — " + (link.dataset.helpTitle || "");
      newTabLink.href = link.href;
      frame.src = link.href;
      overlay.hidden = false;
    }
    function closeHelp() {
      overlay.hidden = true;
      frame.src = "about:blank";
    }

    link.addEventListener("click", function(e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      openHelp();
    });
    document.getElementById("helpCloseBtn").addEventListener("click", closeHelp);
    overlay.addEventListener("click", function(e) { if (e.target === overlay) closeHelp(); });
    document.addEventListener("keydown", function(e) { if (e.key === "Escape" && !overlay.hidden) closeHelp(); });
  })();

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
      var nodesData = (data.nodes || []).map(function(n) {
        return { id: n.id, label: n.label, graphLabel: n.short_label || n.label, desc: n.desc };
      });
      initGraph(container, nodesData, data.edges || [], function(node) { showModal(node.label, "герой", node.desc); },
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

  function resolveChapter(chapterById, chapterId) { return AtlasData.resolveChapter(chapterById, chapterId); }

  function normalizeYo(s) { return s.replace(/Ё/g, "Е").replace(/ё/g, "е"); }

  // Highlight every occurrence of any alias from any group in `text`
  // (е/ё-insensitive, whole words only), tagging each match with its group's
  // CSS class so several characters can be picked out in different colours.
  // `text` is escaped first, so the result is safe to use as HTML.
  // groups: [{ aliases: [string], className: string }]
  function highlightNames(text, groups) {
    var escaped = escapeHtml(text);
    var entries = [];
    (groups || []).forEach(function(g) {
      (g.aliases || []).filter(Boolean).forEach(function(a) { entries.push({ alias: a, cls: g.className || "" }); });
    });
    if (!entries.length) return escaped;
    entries.sort(function(a, b) { return b.alias.length - a.alias.length; });
    var boundary = "A-Za-zА-Яа-яЁё";
    var pattern = entries.map(function(e) {
      return e.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[её]/gi, "[её]");
    }).join("|");
    var re = new RegExp("(^|[^" + boundary + "])(" + pattern + ")(?![" + boundary + "])", "gi");
    return escaped.replace(re, function(m, pre, name) {
      var norm = normalizeYo(name.toLowerCase());
      var hit = entries.find(function(e) { return normalizeYo(e.alias.toLowerCase()) === norm; });
      return pre + '<mark class="' + (hit ? hit.cls : "") + '">' + name + "</mark>";
    });
  }

  function buildNetworkGraph(context, container, data, chapterById) {
    var files = context.novelManifest && context.novelManifest.files;
    // Guards against a slow async render (chapter text, scene list) landing
    // after the user has already clicked something else.
    var renderSeq = 0;
    var catColor = {};
    (data.categories || []).forEach(function(c) { catColor[c.id] = c.color; });
    var typeLabel = {};
    (data.interaction_types || []).forEach(function(t) { typeLabel[t.id] = AtlasData.localized(t.label); });

    var nodesData = (data.nodes || []).map(function(n) {
      var label = n.label || n.id;
      return { id: n.id, label: label, graphLabel: n.short_label || label, desc: n.desc || "", intro_chapter: n.intro_chapter };
    });
    var nameById = {};
    nodesData.forEach(function(n) { nameById[n.id] = n.label; });

    // Importance filters (character-network.json nodes[].importance.tier and
    // nodes[].core) — independent groupings; the user picks ONE dimension to
    // filter by (a picker row appears only when 2+ dimensions are available),
    // and within it any number of values stay toggled on/off (OR). A novel
    // with neither field yet, or with a field that only has one value, gets
    // no filter UI at all — same "not there yet" degradation as chapters.json.
    var TIER_LABELS = { main: "Главные", secondary: "Второстепенные", minor: "Малозначительные" };
    var TIER_ORDER = ["main", "secondary", "minor"];

    // `order` names an explicit sequence (falls back to sorted leftovers);
    // `sortNumericDesc` sorts any leftovers as numbers, highest first —
    // used for core, so "Уровень-4" (most important) leads, matching the
    // main-before-secondary convention tier already uses.
    function buildImportanceDimension(id, label, valueOf, labelOf, order, sortNumericDesc) {
      var byNodeId = {};
      (data.nodes || []).forEach(function(n) {
        var v = valueOf(n);
        if (v !== null && v !== undefined) byNodeId[n.id] = v;
      });
      var seen = {};
      Object.keys(byNodeId).forEach(function(nid) { seen[byNodeId[nid]] = true; });
      var known = (order || []).filter(function(v) { return seen[v]; });
      var rest = Object.keys(seen).filter(function(v) { return known.indexOf(v) < 0; });
      rest.sort(sortNumericDesc ? function(a, b) { return Number(b) - Number(a); } : undefined);
      var values = known.concat(rest);
      if (values.length < 2) return null;
      return { id: id, label: label, byNodeId: byNodeId, values: values, labelOf: labelOf };
    }

    var importanceDimensions = [
      buildImportanceDimension("tier", "Уровень",
        function(n) { return n.importance && n.importance.tier; },
        function(v) { return TIER_LABELS[v] || (v.charAt(0).toUpperCase() + v.slice(1)); },
        TIER_ORDER),
      buildImportanceDimension("core", "Ядро",
        function(n) { return n.core !== null && n.core !== undefined ? String(n.core) : null; },
        function(v) { return "Уровень-" + v; },
        null, true)
    ].filter(Boolean);

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
            kind: "relations", raw: e });
        } else {
          var t = e.types && e.types[mode.id];
          if (!t) return;
          list.push({ from: e.a, to: e.b, label: String(t.count),
            weight: { N: t.weight || 1 },
            kind: "type", typeId: mode.id, raw: e });
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
    var body = document.createElement("div"); body.className = "graph-body";
    var side = document.createElement("div"); side.className = "graph-side";
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

    var clearFilterBtn = document.createElement("button");
    clearFilterBtn.type = "button";
    clearFilterBtn.className = "graph-mode-btn graph-filter-clear";
    clearFilterBtn.textContent = "Показать всех";
    clearFilterBtn.disabled = true;
    clearFilterBtn.title = "Двойной клик по герою — показать только его связи. Ctrl+клик — добавить ещё одного.";
    clearFilterBtn.addEventListener("click", function() { if (graph) graph.clearFilter(); });
    bar.appendChild(clearFilterBtn);

    // Picker (only when 2+ dimensions exist) + one row of value pills for
    // whichever dimension is currently picked. Each dimension keeps its own
    // on/off state across switches, so flipping back to it restores it as
    // you left it.
    var importanceBar = null;
    var showImportanceDimension = null;
    if (importanceDimensions.length) {
      importanceBar = document.createElement("div"); importanceBar.className = "graph-tiers";

      var activeByDim = {};
      importanceDimensions.forEach(function(dim) {
        var active = {};
        dim.values.forEach(function(v) { active[v] = true; });
        activeByDim[dim.id] = active;
      });

      function applyImportanceFilter(dim) {
        var active = activeByDim[dim.id];
        var hidden = Object.keys(dim.byNodeId).filter(function(nid) { return !active[dim.byNodeId[nid]]; });
        if (graph) graph.setHiddenByFilter(hidden);
      }

      var pickerRow = null;
      if (importanceDimensions.length > 1) {
        pickerRow = document.createElement("div"); pickerRow.className = "graph-tiers-picker";
        importanceDimensions.forEach(function(dim, index) {
          var pickBtn = document.createElement("button");
          pickBtn.type = "button"; pickBtn.className = "graph-tiers-picker-btn" + (index === 0 ? " active" : "");
          pickBtn.textContent = dim.label;
          pickBtn.addEventListener("click", function() {
            pickerRow.querySelectorAll(".graph-tiers-picker-btn").forEach(function(x) { x.classList.remove("active"); });
            pickBtn.classList.add("active");
            showImportanceDimension(dim.id);
          });
          pickerRow.appendChild(pickBtn);
        });
      }

      var valuesRow = document.createElement("div"); valuesRow.className = "graph-tiers-values";
      var valuesCaption = document.createElement("span"); valuesCaption.className = "graph-tiers-label";
      valuesRow.appendChild(valuesCaption);

      showImportanceDimension = function(dimId) {
        var dim = importanceDimensions.filter(function(d) { return d.id === dimId; })[0];
        valuesCaption.textContent = dim.label + ":";
        valuesRow.querySelectorAll(".graph-mode-btn").forEach(function(x) { x.remove(); });
        dim.values.forEach(function(v) {
          var valBtn = document.createElement("button");
          valBtn.type = "button";
          valBtn.className = "graph-mode-btn" + (activeByDim[dim.id][v] ? " active" : "");
          valBtn.textContent = dim.labelOf(v);
          valBtn.addEventListener("click", function() {
            activeByDim[dim.id][v] = !activeByDim[dim.id][v];
            valBtn.classList.toggle("active", activeByDim[dim.id][v]);
            applyImportanceFilter(dim);
          });
          valuesRow.appendChild(valBtn);
        });
        applyImportanceFilter(dim);
      };

      if (pickerRow) importanceBar.appendChild(pickerRow);
      importanceBar.appendChild(valuesRow);
    }

    context.panel.appendChild(bar);
    if (importanceBar) context.panel.appendChild(importanceBar);
    context.panel.appendChild(legend);
    context.panel.appendChild(body);
    body.appendChild(container);
    body.appendChild(side);
    container.innerHTML = "";

    graph = initGraph(container, nodesData, modeEdges[modes[0].id],
      renderNodeDetails, renderEdgeDetails, layoutEdges, renderEmptyDetails,
      function(hasFilter) { clearFilterBtn.disabled = !hasFilter; });
    renderLegend(modes[0]);
    renderEmptyDetails();
    if (importanceDimensions.length) showImportanceDimension(importanceDimensions[0].id);

    function renderLegend(mode) {
      if (mode.kind === "relations") {
        legend.innerHTML = (data.categories || []).map(function(c) {
          return '<span class="graph-legend-item"><i style="background:' + c.color + '"></i>' + escapeHtml(c.id) + "</span>";
        }).join("");
      } else {
        legend.innerHTML = '<span class="graph-legend-note">Толщина линии — сила взаимодействия, число на ней — количество реплик. Персонажи без связей этого типа приглушены.</span>';
      }
    }

    function renderEmptyDetails() {
      renderSeq++;
      side.innerHTML = '<p class="side-hint">Кликните героя или связь на графе, чтобы увидеть подробности.</p>';
    }

    function renderNodeDetails(node) {
      renderSeq++;
      var html = "<h3>" + escapeHtml(node.label) + '</h3><span class="pill pill-hero">герой</span>' +
        '<p class="side-desc">' + escapeHtml(node.desc || "") + "</p>";
      var ch = resolveChapter(chapterById, node.intro_chapter);
      if (ch) {
        html += '<hr class="side-sep"><p class="side-kicker">Впервые появляется</p>' +
          '<p class="side-chapter-label">' + escapeHtml(ch.label || node.intro_chapter) + "</p>";
        if (ch.description) {
          html += '<button type="button" class="side-chapter-link" data-chapter="' + escapeHtml(ch.id) +
            '" data-label="' + escapeHtml(ch.label || "") + '">' + escapeHtml(ch.description) + "</button>";
        }
      }
      side.innerHTML = html;
      var link = side.querySelector(".side-chapter-link");
      if (link) link.addEventListener("click", function() {
        showChapterReader(ch.id, ch.label, [{ id: node.id, label: node.label, className: "mark-solo" }],
          node.label, function() { renderNodeDetails(node); });
      });
    }

    function renderEdgeDetails(edge, fromNode, toNode) {
      var mySeq = ++renderSeq;
      var fromLabel = fromNode ? fromNode.label : (nameById[edge.from] || edge.from);
      var toLabel = toNode ? toNode.label : (nameById[edge.to] || edge.to);
      var title = fromLabel + " ↔ " + toLabel;
      var html = "<h3>" + escapeHtml(title) + '</h3><span class="pill pill-edge">связь</span>';
      if (edge.kind === "relations") {
        var r = edge.raw.relation || {};
        var roles = r.roles || [];
        var catLine = "Категория: " + (r.category || "");
        if (roles[0] || roles[1]) catLine += " (" + (roles[0] || "—") + "/" + (roles[1] || "—") + ")";
        html += '<p class="side-desc">' + escapeHtml(catLine) + "</p>";
        if (r.note) html += '<p class="side-desc">' + escapeHtml(r.note) + "</p>";
      } else {
        html += '<div class="side-edge-text">' + escapeHtml(typeDesc(edge.raw, edge.typeId, typeLabel)) + "</div>";
      }
      side.innerHTML = html + '<p class="side-hint side-scene-loading">Загрузка сцен…</p>';

      var sceneIds = edge.raw.scenes || [];
      loadScenes().then(function(sceneById) {
        if (mySeq !== renderSeq) return;
        var placeholder = side.querySelector(".side-scene-loading");
        if (!placeholder) return;
        var known = sceneIds.map(function(id) { return sceneById[id]; }).filter(Boolean);
        if (!known.length) { placeholder.remove(); return; }
        var kicker = document.createElement("p");
        kicker.className = "side-kicker"; kicker.textContent = "Сцены";
        var list = document.createElement("div");
        list.className = "side-scene-list";
        var lastChapterId = null;
        known.forEach(function(sc) {
          var ch = resolveChapter(chapterById, sc.chapter);
          var chapterKey = ch ? ch.id : sc.chapter;
          if (chapterKey !== lastChapterId) {
            var chapterHead = document.createElement("p");
            chapterHead.className = "side-chapter-label";
            chapterHead.textContent = ch ? ch.label : sc.chapter;
            list.appendChild(chapterHead);
            lastChapterId = chapterKey;
          }
          var btn = document.createElement("button");
          btn.type = "button"; btn.className = "side-scene-link";
          btn.textContent = sc.summary || sc.title || sc.id;
          btn.addEventListener("click", function() {
            if (!ch) return;
            showChapterReader(ch.id, ch.label,
              [{ id: edge.from, label: fromLabel, className: "mark-a" }, { id: edge.to, label: toLabel, className: "mark-b" }],
              title, function() { renderEdgeDetails(edge, fromNode, toNode); });
          });
          list.appendChild(btn);
        });
        placeholder.replaceWith(kicker, list);
      });
    }

    var chapterTextCache = {};
    function loadChapterText(chapterId) {
      if (chapterTextCache[chapterId]) return Promise.resolve(chapterTextCache[chapterId]);
      var tmpl = (files && files.novel_chapter_template) || "novel/{chapter_id}.json";
      var url = AtlasData.resolveRelative(context.manifestUrl, tmpl.replace("{chapter_id}", chapterId));
      return AtlasData.fetchJson(url, context.signal).then(function(doc) {
        var text = (doc.sentences || []).map(function(s) { return s.text; }).join(" ");
        chapterTextCache[chapterId] = text;
        return text;
      });
    }

    var aliasesByIdPromise = null;
    function loadAliases() {
      if (!aliasesByIdPromise) {
        var url = AtlasData.resolveRelative(context.manifestUrl, "characters_full.json");
        aliasesByIdPromise = AtlasData.fetchJson(url, context.signal).then(function(doc) {
          var map = {};
          (doc.characters || []).forEach(function(c) {
            map[c.id] = (c.aliases && c.aliases.length ? c.aliases : [c.name]).filter(Boolean);
          });
          return map;
        }).catch(function() { return {}; });
      }
      return aliasesByIdPromise;
    }

    var scenesByIdPromise = null;
    function loadScenes() {
      if (!scenesByIdPromise) {
        var url = AtlasData.resolveRelative(context.manifestUrl, "scenes.json");
        scenesByIdPromise = AtlasData.fetchJson(url, context.signal).then(function(list) {
          var map = {};
          (Array.isArray(list) ? list : []).forEach(function(s) { if (s && s.id) map[s.id] = s; });
          return map;
        }).catch(function() { return {}; });
      }
      return scenesByIdPromise;
    }

    // groups: [{ id: characterId, label: fallbackLabel, className }] — names to
    // highlight in the chapter text, resolved to real aliases once loaded.
    function showChapterReader(chapterId, chapterLabel, groups, backLabel, onBack) {
      var mySeq = ++renderSeq;
      side.innerHTML = '<p class="side-hint">Загрузка главы…</p>';
      Promise.all([loadChapterText(chapterId), loadAliases()]).then(function(res) {
        if (mySeq !== renderSeq) return;
        var text = res[0], aliasMap = res[1];
        var resolvedGroups = groups.map(function(g) {
          return { aliases: (aliasMap[g.id] && aliasMap[g.id].length ? aliasMap[g.id] : [g.label]), className: g.className };
        });
        side.innerHTML = '<button type="button" class="side-back">← ' + escapeHtml(backLabel) + "</button>" +
          "<h3>" + escapeHtml(chapterLabel) + '</h3><div class="side-chapter-text">' + highlightNames(text, resolvedGroups) + "</div>";
        side.querySelector(".side-back").addEventListener("click", onBack);
      }).catch(function(error) {
        if (error.name === "AbortError" || mySeq !== renderSeq) return;
        side.innerHTML = '<button type="button" class="side-back">← ' + escapeHtml(backLabel) + "</button>" +
          '<p class="side-hint">Не удалось загрузить главу: ' + escapeHtml(error.message) + "</p>";
        side.querySelector(".side-back").addEventListener("click", onBack);
      });
    }
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
