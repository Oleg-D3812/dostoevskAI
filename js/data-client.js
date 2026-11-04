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

  global.AtlasData = {
    fetchJson: fetchJson, resolveRelative: resolveRelative, localized: localized, loadNovelContext: loadNovelContext,
    normalizeChapterId: normalizeChapterId, resolveChapter: resolveChapter
  };
})(window);
