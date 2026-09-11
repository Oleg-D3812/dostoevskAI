(function() {
  "use strict";

  var DATA_ROOT = "../data/";
  var requestedNovelId = new URLSearchParams(window.location.search).get("novel");
  var characterFilter = document.getElementById("character-filter");
  var tableBody = document.querySelector("#chapter-table tbody");
  var modalOverlay = document.getElementById("modalOverlay");
  var modal = document.getElementById("modal");
  var modalTitle = document.getElementById("modalTitle");
  var modalPlot = document.getElementById("radar-modal-plot");
  var textModal = document.getElementById("chapter-text-modal");
  var closeBtn = document.getElementById("closeBtn");

  var LABELS8 = ["joy", "trust", "fear", "surprise", "sadness", "disgust", "anger", "anticipation"];
  var LABELS16 = ["joy", "love", "trust", "submission", "fear", "awe", "surprise", "disapproval", "sadness", "remorse", "disgust", "contempt", "anger", "aggressiveness", "anticipation", "optimism"];

  var state = { characters: [], chapters: [], profiles: {}, characterId: null, textCache: {}, fragmentsCache: {} };

  AtlasData.loadNovelContext(requestedNovelId, { catalogUrl: DATA_ROOT + "catalog.json" }).then(function(context) {
    state.manifest = context.novelManifest;
    state.base = context.dataBaseUrl;
    var backLink = document.getElementById("back-link");
    if (backLink) backLink.href = "../novel.html?id=" + encodeURIComponent(context.novel.id) + "&feature=emotion-vad";
    return Promise.all([
      fetchJson(state.base + state.manifest.files.characters),
      fetchJson(state.base + state.manifest.files.chapters)
    ]);
  }).then(function(results) {
    state.characters = results[0].characters || [];
    state.chapters = (results[1].chapters || []).slice().sort(function(a, b) { return a.timeline_start_index - b.timeline_start_index; });
    return Promise.all(state.characters.map(function(character) {
      return fetchJson(state.base + character.profile_path).then(function(profile) {
        state.profiles[character.id] = profile.chapters || {};
      });
    }));
  }).then(function() {
    renderCharacterFilter();
    state.characterId = state.characters.length ? state.characters[0].id : null;
    renderTable();
  }).catch(function(error) {
    showError("Не удалось загрузить данные: " + error.message);
  });

  function currentCharacter() {
    return state.characters.find(function(item) { return item.id === state.characterId; }) || {};
  }

  function renderCharacterFilter() {
    characterFilter.innerHTML = state.characters.map(function(character, index) {
      return '<label><input type="radio" name="character" class="character-radio" value="' + escapeHtml(character.id) + '"' + (index === 0 ? " checked" : "") +
        '> <span style="--swatch:' + escapeHtml(character.color) + '">' + escapeHtml(character.label || character.name) + '</span></label>';
    }).join("");
    characterFilter.addEventListener("change", function(event) {
      if (!event.target.classList.contains("character-radio")) return;
      state.characterId = event.target.value;
      renderTable();
    });
  }

  function renderTable() {
    var character = currentCharacter();
    var profiles = state.profiles[state.characterId] || {};
    tableBody.innerHTML = state.chapters.map(function(chapter) {
      var profile = profiles[chapter.id];
      var count = profile ? profile.count : 0;
      return '<tr>' +
        '<td class="col-chapter">' + escapeHtml(chapter.label) + '</td>' +
        '<td class="col-desc">' + escapeHtml(chapter.description || "") + '</td>' +
        '<td class="col-count">' + Number(count).toLocaleString("ru-RU") + '</td>' +
        '<td class="col-chart">' + textCell(profile, chapter) + '</td>' +
        '<td class="col-chart">' + radarCell(profile, "mean8", character, chapter, 8) + '</td>' +
        '<td class="col-chart">' + radarCell(profile, "mean16", character, chapter, 16) + '</td>' +
        '<td class="col-chart">' + barCell(profile, character, chapter) + '</td>' +
      '</tr>';
    }).join("");
    Array.from(tableBody.querySelectorAll(".radar-thumb")).forEach(function(button) {
      button.addEventListener("click", function() { openRadarModal(button.dataset.chapterId, Number(button.dataset.axes)); });
    });
    Array.from(tableBody.querySelectorAll(".bar-thumb")).forEach(function(button) {
      button.addEventListener("click", function() { openBarModal(button.dataset.chapterId); });
    });
    Array.from(tableBody.querySelectorAll(".text-link")).forEach(function(button) {
      button.addEventListener("click", function() { openTextModal(button.dataset.chapterId); });
    });
  }

  function textCell(profile, chapter) {
    if (!profile || !profile.count) return '<span class="chapter-empty">—</span>';
    return '<button type="button" class="text-link" data-chapter-id="' + escapeHtml(chapter.id) + '" aria-label="Текст главы ' + escapeHtml(chapter.label) + ' с выделенными фрагментами">Текст</button>';
  }

  function radarCell(profile, key, character, chapter, axes) {
    if (!profile || !profile.count) return '<span class="chapter-empty">—</span>';
    var label = axes + "-component profile · " + escapeHtml(chapter.label);
    return '<button type="button" class="radar-thumb" data-chapter-id="' + escapeHtml(chapter.id) + '" data-axes="' + axes + '" aria-label="' + label + '">' +
      svgRadar(profile[key], character.color) + '</button>';
  }

  function barCell(profile, character, chapter) {
    if (!profile || !profile.count) return '<span class="chapter-empty">—</span>';
    var label = "16-component bar chart · " + escapeHtml(chapter.label);
    return '<button type="button" class="bar-thumb" data-chapter-id="' + escapeHtml(chapter.id) + '" aria-label="' + label + '">' +
      svgBar(profile.mean16, character.color) + '</button>';
  }

  function svgRadar(values, color) {
    var size = 60, center = size / 2, radius = size / 2 - 7, count = values.length;
    var maximum = Math.max.apply(null, values) || 1;
    var ring = ringPoints(count, center, radius, function() { return radius; });
    var shape = ringPoints(count, center, radius, function(index) { return (values[index] / maximum) * radius; });
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<polygon points="' + ring + '" fill="none" stroke="var(--border-color)" stroke-width="1"/>' +
      '<polygon points="' + shape + '" fill="' + escapeHtml(color) + '" fill-opacity=".35" stroke="' + escapeHtml(color) + '" stroke-width="1.4"/>' +
    '</svg>';
  }

  function ringPoints(count, center, radius, radiusAt) {
    var points = [];
    for (var index = 0; index < count; index += 1) {
      var angle = -Math.PI / 2 + index * (2 * Math.PI / count);
      var r = radiusAt(index);
      points.push((center + r * Math.cos(angle)).toFixed(1) + "," + (center + r * Math.sin(angle)).toFixed(1));
    }
    return points.join(" ");
  }

  function svgBar(values, color) {
    var width = 92, height = 60, padding = 3, gap = 1, count = values.length;
    var maximum = Math.max.apply(null, values) || 1;
    var barWidth = (width - padding * 2 - gap * (count - 1)) / count;
    var bars = values.map(function(value, index) {
      var barHeight = Math.max(0, (value / maximum) * (height - padding * 2));
      var x = padding + index * (barWidth + gap);
      var y = height - padding - barHeight;
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + barHeight.toFixed(1) + '" fill="' + escapeHtml(color) + '" fill-opacity=".8"/>';
    }).join("");
    return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" aria-hidden="true">' +
      '<line x1="' + padding + '" y1="' + (height - padding) + '" x2="' + (width - padding) + '" y2="' + (height - padding) + '" stroke="var(--border-color)" stroke-width="1"/>' +
      bars + '</svg>';
  }

  function showChart() {
    modal.classList.remove("modal-text");
    modalPlot.hidden = false;
    textModal.hidden = true;
  }

  function showText() {
    modal.classList.add("modal-text");
    modalPlot.hidden = true;
    textModal.hidden = false;
  }

  function openRadarModal(chapterId, axes) {
    var character = currentCharacter();
    var chapter = state.chapters.find(function(item) { return item.id === chapterId; }) || {};
    var profile = (state.profiles[state.characterId] || {})[chapterId];
    if (!profile) return;
    var labels = axes === 8 ? LABELS8 : LABELS16;
    var values = profile[axes === 8 ? "mean8" : "mean16"];
    showChart();
    modalTitle.textContent = (character.label || character.name) + " · " + chapter.label + " · " + axes + "-компонентный профиль (mean, n=" + profile.count + ")";
    var theta = labels.concat([labels[0]]);
    var closed = values.concat([values[0]]);
    var maximum = Math.max.apply(null, values) * 1.15 || .05;
    Plotly.react(modalPlot, [
      {
        type: "scatterpolar", r: closed, theta: theta, mode: "lines+markers", fill: "toself",
        fillcolor: hexToRgba(character.color, .22), line: { color: character.color, width: 2 },
        marker: { color: character.color, size: 5 }, hovertemplate: "%{theta}<br>weight=%{r:.4f}<extra></extra>"
      }
    ], {
      margin: { l: 46, r: 46, t: 20, b: 20 }, paper_bgcolor: "rgba(0,0,0,0)", showlegend: false,
      font: { family: "Inter, system-ui, sans-serif", color: css("--text-color") },
      polar: {
        bgcolor: "rgba(0,0,0,0)",
        angularaxis: { direction: "clockwise", rotation: 90, gridcolor: css("--border-color"), tickfont: { size: axes === 8 ? 11 : 9 } },
        radialaxis: { range: [0, maximum], tickformat: ".2f", gridcolor: css("--border-color"), tickfont: { size: 9 } }
      }
    }, { responsive: true, displaylogo: false });
    modalOverlay.style.display = "flex";
  }

  function openBarModal(chapterId) {
    var character = currentCharacter();
    var chapter = state.chapters.find(function(item) { return item.id === chapterId; }) || {};
    var profile = (state.profiles[state.characterId] || {})[chapterId];
    if (!profile) return;
    var values = profile.mean16;
    showChart();
    modalTitle.textContent = (character.label || character.name) + " · " + chapter.label + " · 16-компонентный профиль, столбцы (mean, n=" + profile.count + ")";
    Plotly.react(modalPlot, [
      { type: "bar", x: LABELS16, y: values, marker: { color: character.color }, hovertemplate: "%{x}<br>weight=%{y:.4f}<extra></extra>" }
    ], {
      margin: { l: 46, r: 20, t: 20, b: 90 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, system-ui, sans-serif", color: css("--text-color") },
      xaxis: { tickangle: -40, color: css("--text-muted"), gridcolor: css("--border-color") },
      yaxis: { rangemode: "tozero", tickformat: ".2f", color: css("--text-muted"), gridcolor: css("--border-color") }
    }, { responsive: true, displaylogo: false });
    modalOverlay.style.display = "flex";
  }

  function openTextModal(chapterId) {
    var character = currentCharacter();
    var chapter = state.chapters.find(function(item) { return item.id === chapterId; }) || {};
    showText();
    modalTitle.textContent = (character.label || character.name) + " · " + chapter.label + " · текст главы";
    textModal.innerHTML = '<div class="loading-state">Загрузка текста…</div>';
    modalOverlay.style.display = "flex";
    Promise.all([loadChapterText(chapterId), loadFragments(character.id, chapterId)]).then(function(results) {
      renderHighlightedText(results[0].sentences || [], results[1].fragments || [], character.color);
    }).catch(function(error) {
      textModal.innerHTML = '<div class="error-state">Не удалось загрузить текст: ' + escapeHtml(error.message) + '</div>';
    });
  }

  function loadChapterText(chapterId) {
    if (!state.textCache[chapterId]) {
      var path = state.manifest.files.novel_chapter_template.replace("{chapter_id}", chapterId);
      state.textCache[chapterId] = fetchJson(state.base + path);
    }
    return state.textCache[chapterId];
  }

  function loadFragments(characterId, chapterId) {
    var key = characterId + ":" + chapterId;
    if (!state.fragmentsCache[key]) {
      var character = state.characters.find(function(item) { return item.id === characterId; });
      var path = character.fragments_path_template.replace("{chapter_id}", chapterId);
      state.fragmentsCache[key] = fetchJson(state.base + path);
    }
    return state.fragmentsCache[key];
  }

  function renderHighlightedText(sentences, fragments, color) {
    var rangesBySentence = new Map();
    fragments.forEach(function(fragment) {
      (fragment.highlights || []).forEach(function(segment) {
        if (!rangesBySentence.has(segment.chapter_sentence)) rangesBySentence.set(segment.chapter_sentence, []);
        rangesBySentence.get(segment.chapter_sentence).push({ start: segment.start, end: segment.end, title: fragment.text });
      });
    });
    var fragmentEl = document.createDocumentFragment();
    sentences.forEach(function(sentence) {
      var paragraph = document.createElement("p"); paragraph.className = "novel-sentence";
      var number = document.createElement("span"); number.className = "sentence-number"; number.textContent = sentence.number;
      paragraph.append(number, document.createTextNode(" "));
      appendHighlightedText(paragraph, sentence.text, rangesBySentence.get(sentence.number) || [], color);
      fragmentEl.appendChild(paragraph);
    });
    textModal.replaceChildren(fragmentEl);
  }

  function appendHighlightedText(parent, text, ranges, color) {
    var boundaries = Array.from(new Set([0, text.length].concat(ranges.reduce(function(all, range) {
      return all.concat([clamp(range.start, 0, text.length), clamp(range.end, 0, text.length)]);
    }, [])))).sort(function(a, b) { return a - b; });
    for (var i = 0; i < boundaries.length - 1; i += 1) {
      var start = boundaries[i], finish = boundaries[i + 1];
      if (finish <= start) continue;
      var covering = ranges.filter(function(range) { return range.start < finish && range.end > start; });
      var content = text.slice(start, finish);
      if (!covering.length) { parent.appendChild(document.createTextNode(content)); continue; }
      var mark = document.createElement("mark");
      mark.textContent = content;
      mark.style.backgroundColor = hexToRgba(color, .3);
      mark.title = covering.map(function(range) { return range.title; }).join("\n");
      parent.appendChild(mark);
    }
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }

  function hideModal(event) {
    if (event && event.target !== event.currentTarget) return;
    modalOverlay.style.display = "none";
  }

  modalOverlay.addEventListener("click", hideModal);
  modal.addEventListener("click", function(event) { event.stopPropagation(); });
  closeBtn.addEventListener("click", function() { hideModal(); });
  document.addEventListener("keydown", function(event) { if (event.key === "Escape") hideModal(); });

  function hexToRgba(hex, alpha) {
    var value = String(hex || "#888888").replace("#", "");
    if (value.length === 3) value = value.split("").map(function(c) { return c + c; }).join("");
    return "rgba(" + parseInt(value.slice(0, 2), 16) + "," + parseInt(value.slice(2, 4), 16) + "," + parseInt(value.slice(4, 6), 16) + "," + alpha + ")";
  }

  function fetchJson(path) {
    return fetch(path).then(function(response) {
      if (!response.ok) throw new Error("HTTP " + response.status + ": " + path);
      return response.json();
    });
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function showError(message) {
    tableBody.innerHTML = '<tr><td colspan="7" class="error-state">' + escapeHtml(message) + '</td></tr>';
  }

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }
})();
