(function(global) {
  "use strict";

  function fetchJson(url, signal) {
    return fetch(url, { signal: signal }).then(function(response) {
      if (!response.ok) throw new Error("HTTP " + response.status + " while loading " + url);
      return response.json();
    });
  }

  function resolveRelative(baseUrl, relativePath) {
    if (!relativePath || typeof relativePath !== "string") return null;
    return new URL(relativePath, new URL(baseUrl, window.location.href)).toString();
  }

  function localized(value, language) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    return value[language || "ru"] || value.ru || value.en || value[Object.keys(value)[0]] || "";
  }

  // "chapter_02_01_02" -> "2_1_2": drops the prefix and zero padding so source
  // section ids match chapters.json ids.
  function normalizeChapterId(chapterId) {
    if (!chapterId) return "";
    return String(chapterId).replace(/^chapter_/, "")
      .split("_").map(function(seg) { return seg.replace(/^0+(?=\d)/, ""); }).join("_");
  }

  // Resolve a chapter id to a chapters.json entry, falling back to the parent
  // logical chapter ("2_1_2" -> "2_1") when the sub-section isn't listed.
  function resolveChapter(chapterById, chapterId) {
    var key = normalizeChapterId(chapterId);
    while (key) {
      if (chapterById[key]) return chapterById[key];
      var cut = key.lastIndexOf("_");
      if (cut < 0) return null;
      key = key.slice(0, cut);
    }
    return null;
  }

  function loadNovelContext(novelId, options) {
    options = options || {};
    var catalogUrl = options.catalogUrl || "data/catalog.json";
    if (!novelId) return Promise.reject(new Error("Novel ID is required"));
    return fetchJson(catalogUrl, options.signal).then(function(catalog) {
      var novel = (catalog.novels || []).find(function(item) { return item.id === novelId; });
      if (!novel) throw new Error("Unknown novel ID: " + novelId);
      if (!novel.manifest) throw new Error("The catalog record has no novel manifest");
      var manifestUrl = resolveRelative(catalogUrl, novel.manifest);
      return fetchJson(manifestUrl, options.signal).then(function(novelManifest) {
        return {
          catalog: catalog,
          novel: novel,
          novelManifest: novelManifest,
          manifestUrl: manifestUrl,
          dataBaseUrl: new URL(".", manifestUrl).toString()
        };
      });
    });
  }

  // ---- Schema v2 characters --------------------------------------------------------------
  // characters_full.json is the one master list (id, name, short_label, kind, intro_chapter);
  // characters_detail.json (aliases, desc, ...) is lazy; emo-characters.json only keeps colour/counts.
  // Each file is fetched at most once per page (cached on the context).
  function cached(context, key, make) {
    context.dataCache = context.dataCache || {};
    if (!context.dataCache[key]) context.dataCache[key] = make();
    return context.dataCache[key];
  }
  function manifestFile(context, key, fallback) {
    var files = (context.novelManifest && context.novelManifest.files) || {};
    var rel = files[key] || fallback;
    return rel ? resolveRelative(context.manifestUrl, rel) : null;
  }

  // -> { list: [character], byId: { id: character } }
  function loadCharacterIndex(context) {
    return cached(context, "characterIndex", function() {
      return fetchJson(manifestFile(context, "character_index"), context.signal).then(function(doc) {
        var list = doc.characters || [], byId = {};
        list.forEach(function(c) { byId[c.id] = c; });
        return { list: list, byId: byId };
      });
    });
  }

  // -> { id: { aliases, desc, intro_desc, note } }  ({} when the novel has no details file)
  function loadCharacterDetails(context) {
    return cached(context, "characterDetails", function() {
      var url = manifestFile(context, "character_details");
      if (!url) return Promise.resolve({});
      return fetchJson(url, context.signal).then(function(doc) { return doc.characters || {}; }).catch(function(error) {
        if (error && error.name === "AbortError") throw error;
        return {};
      });
    });
  }

  // Emotion characters in the shape every explorer already uses:
  // { characters: [{ id, name, label, color, fragment_count, chapter_count, clusters_path, fragments_path_template, profile_path }] }
  function loadEmoCharactersDoc(context) {
    return cached(context, "emoDoc", function() {
      var files = context.novelManifest.files;
      return Promise.all([fetchJson(manifestFile(context, "characters"), context.signal), loadCharacterIndex(context)]).then(function(r) {
        var doc = r[0], index = r[1].byId, out = {};
        Object.keys(doc).forEach(function(k) { out[k] = doc[k]; });
        out.characters = (doc.characters || []).map(function(c) {
          var ch = index[c.id] || {}, merged = {};
          Object.keys(c).forEach(function(k) { merged[k] = c[k]; });
          merged.name = ch.name || c.id;
          merged.label = ch.short_label || ch.name || c.id;
          merged.clusters_path = files.clusters;
          merged.fragments_path_template = files.fragment_template.replace("{character_id}", c.id);
          merged.profile_path = files.profile_template.replace("{character_id}", c.id);
          return merged;
        });
        return out;
      });
    });
  }

  // character-network.json nodes only keep graph data; add name / short_label / intro_chapter from the master list.
  function joinNetwork(network, index) {
    var out = {};
    Object.keys(network).forEach(function(k) { out[k] = network[k]; });
    out.nodes = (network.nodes || []).map(function(n) {
      var ch = index.byId[n.id], node = {};
      Object.keys(n).forEach(function(k) { node[k] = n[k]; });
      if (ch) {
        node.label = ch.name;
        if (ch.short_label) node.short_label = ch.short_label;
        if (ch.intro_chapter) node.intro_chapter = ch.intro_chapter;
      }
      return node;
    });
    return out;
  }

  global.AtlasData = {
    manifestFile: manifestFile, loadCharacterIndex: loadCharacterIndex, loadCharacterDetails: loadCharacterDetails,
    loadEmoCharactersDoc: loadEmoCharactersDoc, joinNetwork: joinNetwork,
    fetchJson: fetchJson, resolveRelative: resolveRelative, localized: localized, loadNovelContext: loadNovelContext,
    normalizeChapterId: normalizeChapterId, resolveChapter: resolveChapter
  };
})(window);
