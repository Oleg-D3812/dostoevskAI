(function() {
  "use strict";

  var emotionNames = {
    joy: "Радость",
    trust: "Доверие",
    fear: "Страх",
    surprise: "Удивление",
    sadness: "Печаль",
    disgust: "Отвращение",
    anger: "Гнев",
    anticipation: "Ожидание"
  };
  var emotionColors = {
    joy: "#f6c344",
    trust: "#48bb78",
    fear: "#7f9cf5",
    surprise: "#b794f4",
    sadness: "#63b3ed",
    disgust: "#68d391",
    anger: "#fc8181",
    anticipation: "#ed8936"
  };

  var params = new URLSearchParams(window.location.search);
  var novelId = params.get("id");
  var catalogNovel;
  var catalogFeatures = [];
  var analysis = {
    base: "",
    manifest: null,
    characters: [],
    chapters: [],
    clusters: [],
    profile: null,
    character: null
  };

  if (!novelId) {
    showPageError("Произведение не указано");
    return;
  }

  fetchJson("data/catalog.json")
    .then(function(catalog) {
      catalogNovel = catalog.novels.find(function(novel) { return novel.id === novelId; });
      if (!catalogNovel) throw new Error("Произведение отсутствует в каталоге");
      setNovelHeader(catalogNovel);
      configureFeatures(catalogNovel.features || []);
    })
    .catch(function(error) {
      showPageError(error.message);
    });

  function bindTabs(buttons) {
    buttons.forEach(function(button) {
      button.addEventListener("click", function() {
        if (button.disabled || button.hidden) return;
        openFeature({
          name: button.dataset.featureName,
          data: button.dataset.featureData
        });
      });
    });
  }

  function activateTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach(function(button) {
      button.classList.toggle("active", button.dataset.tab === tabName);
    });
    document.querySelectorAll(".tab-panel").forEach(function(panel) {
      panel.classList.toggle("active", panel.id === "panel-" + tabName);
    });
  }

  function setNovelHeader(novel) {
    document.title = novel.title + " — анализ";
    document.getElementById("novelTitle").textContent = novel.title;
    document.getElementById("novelMeta").textContent = novel.author + " · " + novel.year;
  }

  function configureFeatures(features) {
    if (!Array.isArray(features)) {
      features = legacyFeatures(features);
    }

    catalogFeatures = features;
    var availableFeatures = features.filter(featureIsAvailable);
    renderFeatureTabs(features);

    if (!availableFeatures.length) {
      throw new Error("Для произведения не опубликованы доступные разделы");
    }

    openFeature(availableFeatures[0]);
  }

  function renderFeatureTabs(features) {
    var tabBar = document.querySelector(".tab-bar");
    var buttons = [];
    tabBar.innerHTML = "";

    features.forEach(function(feature) {
      if (!feature || !feature.name) return;

      var tabName = featureTabName(feature.name);
      var button = document.createElement("button");
      button.className = "tab-btn";
      button.dataset.tab = tabName;
      button.textContent = feature.name;
      button.disabled = !featureIsAvailable(feature);
      button.dataset.featureName = feature.name;

      if (!featureIsAvailable(feature)) {
        var badge = document.createElement("span");
        badge.className = "tab-badge";
        badge.textContent = "скоро";
        button.appendChild(badge);
      }

      tabBar.appendChild(button);
      buttons.push(button);
    });

    bindTabs(buttons);
  }

  function openFeature(feature) {
    feature = findCatalogFeature(feature.name) || feature;
    var tabName = featureTabName(feature.name);
    activateTab(tabName);

    if (tabName === "graph") {
      loadGraph(feature.data);
    } else if (tabName === "emotion") {
      if (feature.explorers && feature.explorers.length) {
        renderEmotionLanding(feature);
      } else {
        loadEmotionAnalysis(feature.data);
      }
    }
  }

  function featureIsAvailable(feature) {
    return Boolean(feature && (feature.data || (feature.explorers && feature.explorers.length)));
  }

  function findCatalogFeature(name) {
    return catalogFeatures.find(function(feature) { return feature.name === name; });
  }

  function featureTabName(name) {
    if (name === "Граф связей") return "graph";
    if (name === "Эмоциональный анализ") return "emotion";
    if (name === "Хронология") return "timeline";
    return "feature-" + name.toLowerCase().replace(/\s+/g, "-");
  }

  function legacyFeatures(features) {
    var list = [];
    if (features.graph) list.push({ name: "Граф связей", data: features.graph });
    if (features.emotion) list.push({ name: "Эмоциональный анализ", data: features.emotion });
    if (features.timeline) list.push({ name: "Хронология", data: features.timeline });
    return list;
  }

  function renderEmotionLanding(feature) {
    var panel = document.getElementById("panel-emotion");
    var explorers = feature.explorers || [];

    panel.innerHTML =
      '<div class="emotion-landing">' +
        '<section class="emotion-hero">' +
          '<div>' +
            '<p class="landing-eyebrow">' + escapeHtml(catalogNovel.title) + ' · VAD Atlas</p>' +
            '<h2>Эмоциональный анализ</h2>' +
            '<p class="landing-lede">Интерактивные исследовательские шаги для просмотра эмоциональных состояний, кластеров и VAD-пространства романа.</p>' +
          '</div>' +
          '<div class="vad-orbit" aria-label="Valence, Arousal and Dominance axes">' +
            '<span class="axis-letter axis-v">V</span>' +
            '<span class="axis-letter axis-a">A</span>' +
            '<span class="axis-letter axis-d">D</span>' +
            '<span class="orbit-center" aria-hidden="true"></span>' +
          '</div>' +
        '</section>' +
        '<section class="explorer-section" aria-labelledby="explorer-title">' +
          '<div class="landing-section-head">' +
            '<div>' +
              '<p class="landing-kicker">Current pipeline</p>' +
              '<h3 id="explorer-title">Explore the data</h3>' +
            '</div>' +
          '</div>' +
          '<div class="explorer-grid">' + explorers.map(renderExplorerCard).join("") + '</div>' +
        '</section>' +
      '</div>';
  }

  function renderExplorerCard(explorer, index) {
    var href = explorer.data ? explorerHref(explorer.data) : "";
    var tag = href ? "a" : "span";
    var attrs = href ? ' href="' + escapeHtml(href) + '"' : ' aria-disabled="true"';
    var classes = "explorer-card" + (href ? "" : " disabled");

    return '<' + tag + ' class="' + classes + '"' + attrs + '>' +
      '<div class="explorer-visual" aria-hidden="true">' + explorerVisual(index) + '</div>' +
      '<div class="explorer-body">' +
        '<div class="explorer-meta"><span>' + escapeHtml(explorer.step || ("Step " + (index + 1))) + '</span>' +
          '<span class="card-arrow">' + (href ? "↗" : "скоро") + '</span></div>' +
        '<h4>' + escapeHtml(explorer.name || "Untitled explorer") + '</h4>' +
        '<p>' + escapeHtml(explorer.description || "") + '</p>' +
      '</div>' +
    '</' + tag + '>';
  }

  function explorerHref(data) {
    if (/^(https?:|file:)/.test(data)) return data;
    return data.indexOf("/") === 0 ? data : data;
  }

  function explorerVisual(index) {
    var variant = index % 3;
    if (variant === 1) {
      return '<svg viewBox="0 0 360 176" preserveAspectRatio="none">' +
        '<g class="chart-line" stroke-width="1"><line x1="30" y1="46" x2="330" y2="46"/><line x1="30" y1="88" x2="330" y2="88"/><line x1="30" y1="130" x2="330" y2="130"/></g>' +
        '<g fill="none" stroke-width="5" stroke-linecap="round"><path class="series-v" d="M38,61 C88,31 120,83 168,56 S250,38 323,67"/><path class="series-a" d="M38,93 C86,120 123,72 169,101 S257,119 323,88"/><path class="series-d" d="M38,136 C94,101 119,145 168,127 S260,112 323,140"/></g>' +
        '<g><circle class="dot-accent" cx="168" cy="56" r="6"/><circle class="dot" cx="169" cy="101" r="6"/><circle class="dot-violet" cx="168" cy="127" r="6"/></g>' +
      '</svg>';
    }
    if (variant === 2) {
      return '<svg viewBox="0 0 360 176" preserveAspectRatio="none">' +
        '<g class="chart-line" fill="none"><path d="M44 143 L177 166 L307 137 L176 112 Z"/><path d="M176 112 L176 20"/><path d="M44 143 L44 58 L176 20 L307 52 L307 137"/></g>' +
        '<g opacity=".88"><circle class="dot-accent" cx="102" cy="91" r="6"/><circle class="dot" cx="219" cy="64" r="6"/><circle class="dot-violet" cx="244" cy="119" r="7"/><circle class="dot" cx="156" cy="133" r="5"/><circle class="dot-accent" cx="79" cy="121" r="5"/></g>' +
      '</svg>';
    }
    return '<svg viewBox="0 0 360 176" preserveAspectRatio="none">' +
      '<g class="chart-line" stroke-width="1"><line x1="28" y1="38" x2="332" y2="38"/><line x1="28" y1="76" x2="332" y2="76"/><line x1="28" y1="114" x2="332" y2="114"/><line x1="28" y1="152" x2="332" y2="152"/><line x1="180" y1="18" x2="180" y2="160"/></g>' +
      '<g opacity=".9"><rect class="series-v" x="92" y="28" width="88" height="17" rx="3"/><rect class="series-a" x="180" y="28" width="62" height="17" rx="3"/><rect class="series-d" x="242" y="28" width="44" height="17" rx="3"/><rect class="series-a" x="110" y="66" width="70" height="17" rx="3"/><rect class="series-v" x="180" y="66" width="111" height="17" rx="3"/></g>' +
    '</svg>';
  }

  function loadGraph(path) {
    fetchJson("data/" + path)
      .then(function(data) {
        initGraph(
          document.getElementById("graph-container"),
          data.nodes,
          data.edges,
          function(node) { showModal(node.label, "герой", node.desc); },
          function(edge, fromNode, toNode) {
            var title = (fromNode ? fromNode.label : edge.from) + " \u2192 " +
              (toNode ? toNode.label : edge.to);
            showModal(title, "связь", edge.label + "\n\n" + edge.desc);
          }
        );
      })
      .catch(function(error) {
        renderError(document.getElementById("graph-container"), error);
      });
  }

  function loadEmotionAnalysis(manifestPath) {
    analysis.base = manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1);
    fetchJson("data/" + manifestPath)
      .then(function(manifest) {
        analysis.manifest = manifest;
        return Promise.all([
          fetchJson("data/" + analysis.base + manifest.files.characters),
          fetchJson("data/" + analysis.base + manifest.files.chapters),
          fetchJson("data/" + analysis.base + manifest.files.clusters)
        ]);
      })
      .then(function(results) {
        analysis.characters = results[0].characters;
        analysis.chapters = results[1].chapters;
        analysis.clusters = results[2].clusters;
        populateCharacterSelect();
        document.getElementById("characterSelect").addEventListener("change", selectCharacter);
        document.getElementById("chapterSelect").addEventListener("change", selectChapter);
        selectCharacter();
      })
      .catch(function(error) {
        renderError(document.querySelector(".analysis-main"), error);
      });
  }

  function populateCharacterSelect() {
    var select = document.getElementById("characterSelect");
    select.innerHTML = "";
    analysis.characters.forEach(function(character) {
      var option = document.createElement("option");
      option.value = character.id;
      option.textContent = character.name;
      select.appendChild(option);
    });
  }

  function selectCharacter() {
    var characterId = document.getElementById("characterSelect").value;
    analysis.character = analysis.characters.find(function(item) { return item.id === characterId; });
    if (!analysis.character) return;

    populateChapterSelect();
    renderStats();
    renderClusters();
    setLoading(document.getElementById("emotionBars"));

    fetchJson("data/" + analysis.base + analysis.character.profile_path)
      .then(function(profile) {
        analysis.profile = profile;
        renderProfile();
        selectChapter();
      })
      .catch(function(error) {
        renderError(document.getElementById("emotionBars"), error);
      });
  }

  function populateChapterSelect() {
    var select = document.getElementById("chapterSelect");
    select.innerHTML = "";
    var all = document.createElement("option");
    all.value = "";
    all.textContent = "Весь роман";
    select.appendChild(all);

    analysis.chapters.forEach(function(chapter) {
      if ((chapter.character_counts[analysis.character.id] || 0) < 1) return;
      var option = document.createElement("option");
      option.value = chapter.id;
      option.textContent = chapter.label + " · " + chapter.character_counts[analysis.character.id] + " фр.";
      select.appendChild(option);
    });
  }

  function selectChapter() {
    if (!analysis.profile) return;
    renderProfile();
    var chapterId = document.getElementById("chapterSelect").value;
    var list = document.getElementById("fragmentList");
    var count = document.getElementById("fragmentCount");

    if (!chapterId) {
      count.textContent = analysis.character.fragment_count + " всего";
      list.innerHTML = '<div class="empty-state">Выберите главу, чтобы увидеть фрагменты и их координаты VAD.</div>';
      return;
    }

    setLoading(list);
    count.textContent = "";
    var path = analysis.character.fragments_path_template.replace("{chapter_id}", chapterId);
    fetchJson("data/" + analysis.base + path)
      .then(function(data) { renderFragments(data.fragments); })
      .catch(function(error) { renderError(list, error); });
  }

  function renderProfile() {
    var chapterId = document.getElementById("chapterSelect").value;
    var values;
    var scope;

    if (chapterId && analysis.profile.chapters[chapterId]) {
      values = analysis.profile.chapters[chapterId].mean8;
      var chapter = analysis.chapters.find(function(item) { return item.id === chapterId; });
      scope = chapter ? chapter.label : chapterId;
    } else {
      values = overallMean8(analysis.profile);
      scope = "Весь роман";
    }

    document.getElementById("emotionHeading").textContent = analysis.character.name;
    document.getElementById("profileScope").textContent = scope;
    var bars = document.getElementById("emotionBars");
    bars.innerHTML = "";
    analysis.profile.components8.forEach(function(emotion, index) {
      var value = values[index] || 0;
      var row = document.createElement("div");
      row.className = "emotion-row";
      row.innerHTML =
        '<span class="emotion-name">' + escapeHtml(emotionNames[emotion] || emotion) + '</span>' +
        '<div class="emotion-track"><span style="width:' + Math.max(1, value * 100) + '%;background:' +
          (emotionColors[emotion] || "#718096") + '"></span></div>' +
        '<strong>' + Math.round(value * 100) + '%</strong>';
      bars.appendChild(row);
    });
  }

  function overallMean8(profile) {
    var sums = profile.components8.map(function() { return 0; });
    var total = 0;
    Object.keys(profile.chapters).forEach(function(key) {
      var chapter = profile.chapters[key];
      total += chapter.count;
      chapter.sum8.forEach(function(value, index) { sums[index] += value; });
    });
    return sums.map(function(value) { return total ? value / total : 0; });
  }

  function renderStats() {
    document.getElementById("analysisStats").innerHTML =
      '<div><strong>' + analysis.character.fragment_count.toLocaleString("ru-RU") + '</strong><span>фрагментов</span></div>' +
      '<div><strong>' + analysis.character.chapter_count + '</strong><span>глав</span></div>';
  }

  function renderClusters() {
    var clusters = analysis.clusters.filter(function(cluster) {
      return cluster.character_id === analysis.character.id;
    });
    var list = document.getElementById("clusterList");
    list.innerHTML = "";
    clusters.forEach(function(cluster) {
      var item = document.createElement("div");
      item.className = "cluster-item";
      item.innerHTML =
        '<span class="cluster-dot" style="background:' + escapeHtml(cluster.color) + '"></span>' +
        '<div><strong>' + escapeHtml(cluster.name) + '</strong><span>V ' + formatVad(cluster.centroid[0]) +
          ' · A ' + formatVad(cluster.centroid[1]) + ' · D ' + formatVad(cluster.centroid[2]) + '</span></div>' +
        '<b>' + cluster.size + '</b>';
      list.appendChild(item);
    });
  }

  function renderFragments(fragments) {
    var list = document.getElementById("fragmentList");
    document.getElementById("fragmentCount").textContent = fragments.length + " фр.";
    list.innerHTML = "";
    fragments.forEach(function(fragment) {
      var cluster = analysis.clusters.find(function(item) { return item.id === fragment.cluster_id; });
      var article = document.createElement("article");
      article.className = "fragment-item";
      article.tabIndex = 0;
      article.innerHTML =
        '<div class="fragment-meta"><span>Предложение ' + fragment.chapter_sentence_start + '</span>' +
        (cluster ? '<span class="cluster-chip"><i style="background:' + escapeHtml(cluster.color) + '"></i>' +
          escapeHtml(cluster.name) + '</span>' : '') + '</div>' +
        '<p>' + escapeHtml(fragment.text) + '</p>' +
        '<div class="vad-values"><span>V <b>' + formatVad(fragment.vad[0]) + '</b></span>' +
        '<span>A <b>' + formatVad(fragment.vad[1]) + '</b></span>' +
        '<span>D <b>' + formatVad(fragment.vad[2]) + '</b></span></div>';
      article.addEventListener("click", function() {
        showModal(analysis.character.label + " · предложение " + fragment.chapter_sentence_start,
          "фрагмент", fragment.text + "\n\nV " + formatVad(fragment.vad[0]) +
          " · A " + formatVad(fragment.vad[1]) + " · D " + formatVad(fragment.vad[2]));
      });
      article.addEventListener("keydown", function(event) {
        if (event.key === "Enter" || event.key === " ") article.click();
      });
      list.appendChild(article);
    });
  }

  function fetchJson(path) {
    return fetch(path).then(function(response) {
      if (!response.ok) throw new Error("HTTP " + response.status + ": " + path);
      return response.json();
    });
  }

  function setLoading(element) {
    element.innerHTML = '<div class="loading-state">Загрузка данных…</div>';
  }

  function renderError(element, error) {
    element.innerHTML = '<div class="error-state">Не удалось загрузить данные: ' +
      escapeHtml(error.message) + '</div>';
  }

  function showPageError(message) {
    document.getElementById("novelTitle").textContent = "Ошибка загрузки";
    document.getElementById("novelMeta").textContent = message;
  }

  function formatVad(value) {
    return Number(value).toFixed(2).replace("-0.00", "0.00");
  }

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }
})();
