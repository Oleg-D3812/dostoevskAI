// Dataset registry for the data playground. Each dataset turns files the
// pipeline already publishes into a flat table of rows plus a field list;
// the field list doubles as the user-facing data dictionary.
(function(global) {
  "use strict";

  var FETCH_CONCURRENCY = 6;

  var EMOTION_LABELS = {
    joy: "радость", trust: "доверие", fear: "страх", surprise: "удивление", sadness: "грусть",
    disgust: "отвращение", anger: "гнев", anticipation: "ожидание", love: "любовь", submission: "покорность",
    awe: "трепет", disapproval: "неодобрение", remorse: "раскаяние", contempt: "презрение",
    aggressiveness: "агрессивность", optimism: "оптимизм"
  };

  function field(name, type, label, description) { return { name: name, type: type, label: label, description: description }; }

  var CHAPTER_FIELDS = [
    field("chapter_order", "number", "Глава, №", "Порядковый номер главы в романе (1…N) — удобная ось X."),
    field("chapter_id", "category", "ID главы", "Стабильный идентификатор главы, например 1_2_1."),
    field("chapter_label", "category", "Глава", "Подпись: часть · глава · раздел."),
    field("part", "category", "Часть", "Номер части романа.")
  ];
  var CHARACTER_FIELDS = [
    field("character_id", "category", "ID персонажа", "Стабильный идентификатор персонажа."),
    field("character", "category", "Персонаж", "Имя персонажа для подписей и легенды.")
  ];

  // ---- Shared sources: fetched once per novel, missing files become null ----

  var sourceCache = {};

  function loadSources(context) {
    var key = context.manifestUrl;
    if (!sourceCache[key]) sourceCache[key] = buildSources(context);
    return sourceCache[key];
  }

  function buildSources(context) {
    var manifest = context.novelManifest || {};
    var files = manifest.files || {};
    var networkFeature = (manifest.features || []).find(function(f) { return f.id === "character-network"; });
    function url(rel) { return AtlasData.resolveRelative(context.manifestUrl, rel); }
    function optional(rel) { return rel ? AtlasData.fetchJson(url(rel)).catch(function() { return null; }) : Promise.resolve(null); }

    return Promise.all([
      optional(files.chapters || "chapters.json"),
      files.characters ? AtlasData.loadEmoCharactersDoc(context).catch(function() { return null; }) : Promise.resolve(null),
      optional(files.clusters),
      optional(networkFeature && networkFeature.status === "ready" ? networkFeature.entry : null).then(function(net) {
        return net && files.character_index ? AtlasData.loadCharacterIndex(context).then(function(index) { return AtlasData.joinNetwork(net, index); }) : net;
      })
    ]).then(function(docs) {
      var chaptersDoc = docs[0], emoDoc = docs[1], clustersDoc = docs[2], network = docs[3];
      var chapters = (chaptersDoc && chaptersDoc.chapters) || [];
      var chapterById = {};
      chapters.forEach(function(ch, i) { ch._order = i + 1; chapterById[ch.id] = ch; });
      var emoChars = (emoDoc && emoDoc.characters) || [];
      var clusters = (clustersDoc && clustersDoc.clusters) || [];
      var clusterById = {};
      clusters.forEach(function(c) { clusterById[c.id] = c; });
      var profileCache = {}, fragmentCache = {};

      return {
        has: { chapters: chapters.length > 0, emo: emoChars.length > 0, clusters: clusters.length > 0, network: !!(network && network.nodes) },
        chapters: chapters, chapterById: chapterById, emoChars: emoChars, clusters: clusters, clusterById: clusterById, network: network,
        chapter: function(id) { return id ? AtlasData.resolveChapter(chapterById, id) : null; },
        profile: function(character) {
          var rel = character.profile_path || (files.profile_template || "").replace("{character_id}", character.id);
          if (!profileCache[character.id]) profileCache[character.id] = AtlasData.fetchJson(url(rel));
          return profileCache[character.id];
        },
        fragments: function(character, chapterId) {
          var template = character.fragments_path_template || (files.fragment_template || "").replace("{character_id}", character.id);
          var cacheKey = character.id + "::" + chapterId;
          if (!fragmentCache[cacheKey]) fragmentCache[cacheKey] = AtlasData.fetchJson(url(template.replace("{chapter_id}", chapterId)));
          return fragmentCache[cacheKey];
        }
      };
    });
  }

  function chapterCols(ch, fallbackId) {
    if (!ch) return { chapter_order: null, chapter_id: fallbackId || null, chapter_label: fallbackId || null, part: null };
    return { chapter_order: ch._order, chapter_id: ch.id, chapter_label: ch.label || ch.id, part: ch.part != null ? String(ch.part) : null };
  }

  function extend(target, source) { Object.keys(source).forEach(function(k) { target[k] = source[k]; }); return target; }

  // Runs promise-returning tasks with a small concurrency cap.
  function runLimited(tasks, limit, onProgress) {
    var results = new Array(tasks.length), next = 0, done = 0;
    return new Promise(function(resolve, reject) {
      if (!tasks.length) { resolve(results); return; }
      function start() {
        if (next >= tasks.length) return;
        var i = next++;
        tasks[i]().then(function(value) {
          results[i] = value; done++;
          if (onProgress) onProgress(done, tasks.length);
          if (done === tasks.length) resolve(results); else start();
        }, reject);
      }
      for (var k = 0; k < Math.min(limit, tasks.length); k++) start();
    });
  }

  function characterColors(src) {
    var colors = {};
    src.emoChars.forEach(function(c) { if (c.color) colors[c.label || c.name] = c.color; });
    return { character: colors };
  }

  // ---- Datasets ----

  var datasets = [
    {
      id: "chapters",
      label: { ru: "Главы", en: "Chapters" },
      description: "Одна строка — одна глава (раздел) романа: объём и число эмоциональных фрагментов.",
      available: function(src) { return src.has.chapters; },
      load: function(src) {
        var rows = src.chapters.map(function(ch) {
          var counts = ch.character_counts || {};
          var total = Object.keys(counts).reduce(function(s, k) { return s + Number(counts[k] || 0); }, 0);
          return extend(chapterCols(ch), { sentence_count: ch.sentence_count, fragments: total, description: ch.description || "" });
        });
        return {
          fields: CHAPTER_FIELDS.concat([
            field("sentence_count", "number", "Предложений", "Число предложений в главе."),
            field("fragments", "number", "Фрагментов", "Сколько эмоциональных фрагментов всех отслеживаемых героев найдено в главе."),
            field("description", "text", "Краткое содержание", "Пересказ главы.")
          ]),
          rows: rows
        };
      }
    },
    {
      id: "chapter_fragments",
      label: { ru: "Фрагменты по главам", en: "Fragments per chapter" },
      description: "Глава × отслеживаемый герой: сколько эмоциональных фрагментов героя в главе (включая нули).",
      available: function(src) { return src.has.chapters && src.has.emo; },
      load: function(src) {
        var rows = [];
        src.chapters.forEach(function(ch) {
          src.emoChars.forEach(function(c) {
            rows.push(extend(chapterCols(ch), { character_id: c.id, character: c.label || c.name, fragments: Number((ch.character_counts || {})[c.id] || 0) }));
          });
        });
        return {
          fields: CHAPTER_FIELDS.concat(CHARACTER_FIELDS, [field("fragments", "number", "Фрагментов", "Число эмоциональных фрагментов героя в главе.")]),
          rows: rows, colors: characterColors(src)
        };
      }
    },
    {
      id: "emotions_by_chapter",
      label: { ru: "Эмоции по главам", en: "Emotions by chapter" },
      description: "Глава × герой × эмоция Плутчика: средняя и суммарная сила эмоции по фрагментам героя в главе. Модели 8 и 16 компонент пересекаются — фильтруйте по model.",
      available: function(src) { return src.has.chapters && src.has.emo; },
      load: function(src) {
        return Promise.all(src.emoChars.map(function(c) { return src.profile(c).catch(function() { return null; }); })).then(function(profiles) {
          var rows = [];
          profiles.forEach(function(profile, i) {
            if (!profile) return;
            var c = src.emoChars[i];
            Object.keys(profile.chapters || {}).forEach(function(chapterId) {
              var stats = profile.chapters[chapterId];
              var base = extend(chapterCols(src.chapterById[chapterId] || src.chapter(chapterId), chapterId), { character_id: c.id, character: c.label || c.name, fragments: stats.count });
              [["8", profile.components8, stats.mean8, stats.sum8], ["16", profile.components16, stats.mean16, stats.sum16]].forEach(function(m) {
                (m[1] || []).forEach(function(emotion, k) {
                  rows.push(extend(extend({}, base), {
                    model: m[0], emotion: emotion, emotion_label: EMOTION_LABELS[emotion] || emotion,
                    mean: m[2] ? m[2][k] : null, sum: m[3] ? m[3][k] : null
                  }));
                });
              });
            });
          });
          return {
            fields: CHAPTER_FIELDS.concat(CHARACTER_FIELDS, [
              field("model", "category", "Модель", "«8» — базовые эмоции Плутчика, «16» — расширенный круг с диадами."),
              field("emotion", "category", "Эмоция (id)", "Английский идентификатор: joy, anger, fear…"),
              field("emotion_label", "category", "Эмоция", "Название эмоции по-русски."),
              field("mean", "number", "Средняя сила", "Средняя доля эмоции во фрагментах героя в главе (0…1)."),
              field("sum", "number", "Сумма", "Сумма долей эмоции по всем фрагментам героя в главе."),
              field("fragments", "number", "Фрагментов", "Сколько фрагментов героя в главе вошло в расчёт.")
            ]),
            rows: rows, colors: characterColors(src)
          };
        });
      }
    },
    {
      id: "fragments",
      label: { ru: "Фрагменты (VAD)", en: "Fragments (VAD)" },
      description: "Одна строка — одна цитата-фрагмент героя с оценками валентности, возбуждения и доминантности (−1…1) и кластером. Загружаются только главы и герои, прошедшие фильтры.",
      available: function(src) { return src.has.chapters && src.has.emo; },
      // Only fragment files for (character, chapter) pairs that survive the
      // spec's character/chapter filters are fetched, so loaded rows depend on
      // the spec; filter pickers take character values from the index instead.
      dependsOnSpec: true,
      values: function(src, name) {
        if (name === "character_id") return src.emoChars.map(function(c) { return c.id; });
        if (name === "character") return src.emoChars.map(function(c) { return c.label || c.name; });
        return null;
      },
      load: function(src, spec, onProgress) {
        var pairFields = { character_id: 1, character: 1, chapter_order: 1, chapter_id: 1, chapter_label: 1, part: 1 };
        var pairs = [];
        src.emoChars.forEach(function(c) {
          src.chapters.forEach(function(ch) {
            if (Number((ch.character_counts || {})[c.id] || 0) > 0)
              pairs.push(extend(chapterCols(ch), { character_id: c.id, character: c.label || c.name, _char: c }));
          });
        });
        var prefilters = ((spec && spec.filter) || []).filter(function(f) { return pairFields[f.field]; });
        pairs = AtlasPlaygroundEngine.applyFilters(pairs, prefilters);
        var tasks = pairs.map(function(pair) {
          return function() { return src.fragments(pair._char, pair.chapter_id).catch(function() { return null; }); };
        });
        return runLimited(tasks, FETCH_CONCURRENCY, onProgress).then(function(docs) {
          var rows = [];
          docs.forEach(function(doc, i) {
            if (!doc) return;
            var pair = pairs[i];
            (doc.fragments || []).forEach(function(f) {
              var cluster = src.clusterById[f.cluster_id];
              var vad = f.vad || [];
              rows.push({
                chapter_order: pair.chapter_order, chapter_id: pair.chapter_id, chapter_label: pair.chapter_label, part: pair.part,
                character_id: pair.character_id, character: pair.character,
                valence: vad[0], arousal: vad[1], dominance: vad[2],
                cluster_id: f.cluster_id, cluster: cluster ? cluster.name : f.cluster_id,
                distance: f.distance_to_centroid, position: f.character_position, sentence: f.chapter_sentence_start,
                text: f.text
              });
            });
          });
          return {
            fields: CHAPTER_FIELDS.concat(CHARACTER_FIELDS, [
              field("valence", "number", "Валентность (V)", "Приятно (+1) или неприятно (−1)."),
              field("arousal", "number", "Возбуждение (A)", "Возбуждён (+1) или спокоен (−1)."),
              field("dominance", "number", "Доминантность (D)", "Контроль (+1) или бесконтрольность (−1)."),
              field("cluster_id", "category", "ID кластера", "Идентификатор K-Means кластера героя."),
              field("cluster", "category", "Кластер", "Название эмоционального кластера."),
              field("distance", "number", "Расстояние до центра", "Удалённость фрагмента от центроида кластера."),
              field("position", "number", "№ фрагмента у героя", "Порядковый номер фрагмента героя в романе."),
              field("sentence", "number", "Предложение", "Номер предложения внутри главы."),
              field("text", "text", "Цитата", "Текст фрагмента.")
            ]),
            rows: rows, colors: characterColors(src)
          };
        });
      }
    },
    {
      id: "clusters",
      label: { ru: "Кластеры", en: "Clusters" },
      description: "Эмоциональные кластеры героев (K-Means в пространстве VAD): центр, размер и разброс.",
      available: function(src) { return src.has.clusters; },
      load: function(src) {
        var names = {};
        src.emoChars.forEach(function(c) { names[c.id] = c.label || c.name; });
        var rows = src.clusters.map(function(c) {
          var centroid = c.centroid || [];
          return {
            cluster_id: c.id, character_id: c.character_id, character: names[c.character_id] || c.character_id,
            cluster: c.name, display_id: c.display_id,
            valence: centroid[0], arousal: centroid[1], dominance: centroid[2],
            size: c.size, spread: c.within_cluster_spread
          };
        });
        return {
          fields: [field("cluster_id", "category", "ID кластера", "Стабильный идентификатор кластера.")].concat(CHARACTER_FIELDS, [
            field("cluster", "category", "Кластер", "Название кластера."),
            field("display_id", "category", "Код", "Короткий код: герой-номер."),
            field("valence", "number", "Центр: V", "Валентность центроида."),
            field("arousal", "number", "Центр: A", "Возбуждение центроида."),
            field("dominance", "number", "Центр: D", "Доминантность центроида."),
            field("size", "number", "Размер", "Число фрагментов в кластере."),
            field("spread", "number", "Разброс", "Средний разброс фрагментов внутри кластера.")
          ]),
          rows: rows, colors: characterColors(src)
        };
      }
    },
    {
      id: "characters",
      label: { ru: "Персонажи", en: "Characters" },
      description: "Одна строка — один герой графа связей: важность, число связей, сцен и взаимодействий.",
      available: function(src) { return src.has.network; },
      load: function(src) {
        var stats = {};
        (src.network.edges || []).forEach(function(e) {
          [e.a, e.b].forEach(function(id) {
            var s = stats[id] || (stats[id] = { relations: 0, weight: 0, interactions: 0, scenes: new Set() });
            s.relations++; s.weight += Number((e.relation || {}).weight || 0); s.interactions += Number(e.interactions || 0);
            (e.scenes || []).forEach(function(sc) { s.scenes.add(sc); });
          });
        });
        var tracked = {};
        src.emoChars.forEach(function(c) { tracked[c.id] = true; });
        var hasCore = false;
        var rows = (src.network.nodes || []).map(function(n) {
          var imp = n.importance || {}, s = stats[n.id] || { relations: 0, weight: 0, interactions: 0, scenes: new Set() };
          var intro = src.chapter(n.intro_chapter);
          if (n.core != null) hasCore = true;
          return {
            character_id: n.id, character: n.label, short_label: n.short_label || n.label,
            tier: imp.tier || null, core: n.core != null ? n.core : null,
            score: imp.score, F: imp.F, D: imp.D, W: imp.W, B: imp.B,
            degree: n.degree, relations: s.relations, relation_weight: s.weight, interactions: s.interactions, scenes: s.scenes.size,
            intro_chapter_order: intro ? intro._order : null, intro_chapter: intro ? intro.label : null,
            emotion_tracked: tracked[n.id] ? "да" : "нет"
          };
        });
        var fields = CHARACTER_FIELDS.concat([
          field("short_label", "category", "Короткое имя", "Сокращённое имя, если задано."),
          field("tier", "category", "Уровень", "main — главные, secondary — второстепенные, minor — эпизодические.")
        ]);
        if (hasCore) fields.push(field("core", "number", "Ядро", "Уровень ядра сюжета (0…4), есть не во всех романах."));
        fields = fields.concat([
          field("score", "number", "Важность", "Итоговый балл важности 0…1: 0.25·F + 0.20·D + 0.20·W + 0.15·B (нормированные)."),
          field("F", "number", "F — сцены", "В скольких сценах участвует герой (сырое значение)."),
          field("D", "number", "D — связи", "Со сколькими героями напрямую связан."),
          field("W", "number", "W — взаимодействия", "Сколько всего взаимодействий."),
          field("B", "number", "B — «мост»", "Посредничество: насколько герой связывает иначе далёкие группы."),
          field("degree", "number", "Степень", "Число соседей в графе."),
          field("relations", "number", "Связей", "Число рёбер графа с участием героя."),
          field("relation_weight", "number", "Сумма весов связей", "Сумма весов отношений (1…5 каждое)."),
          field("interactions", "number", "Взаимодействий", "Сумма взаимодействий по всем связям героя."),
          field("scenes", "number", "Сцен со связями", "Число разных сцен, где герой взаимодействует с кем-то."),
          field("intro_chapter_order", "number", "Первое появление, №", "Номер главы, где герой впервые появляется."),
          field("intro_chapter", "category", "Первое появление", "Подпись главы первого появления."),
          field("emotion_tracked", "category", "Эмоции размечены", "«да», если для героя есть эмоциональный анализ.")
        ]);
        return { fields: fields, rows: rows };
      }
    },
    {
      id: "relations",
      label: { ru: "Отношения", en: "Relations" },
      description: "Связи между героями. Каждая связь дана дважды — по строке на каждого участника, чтобы легко считать «у кого больше связей». Для уникальных пар фильтруйте side = A.",
      available: function(src) { return src.has.network; },
      load: function(src) {
        var labels = {};
        (src.network.nodes || []).forEach(function(n) { labels[n.id] = n.label; });
        var types = src.network.interaction_types || [];
        var categoryColors = {};
        (src.network.categories || []).forEach(function(c) { categoryColors[c.id] = c.color; });
        var rows = [];
        (src.network.edges || []).forEach(function(e) {
          var rel = e.relation || {}, roles = rel.roles || [];
          var first = null;
          (rel.chapters || []).forEach(function(id) { var ch = src.chapter(id); if (ch && (first === null || ch._order < first)) first = ch._order; });
          [[e.a, e.b, roles[0], roles[1], "A"], [e.b, e.a, roles[1], roles[0], "B"]].forEach(function(side) {
            var row = {
              character_id: side[0], character: labels[side[0]] || side[0], partner_id: side[1], partner: labels[side[1]] || side[1],
              side: side[4], category: rel.category || null, role: side[2] || null, partner_role: side[3] || null,
              weight: rel.weight, evolves: rel.evolves ? "да" : "нет", note: rel.note || "",
              interactions: e.interactions, scenes: (e.scenes || []).length, first_chapter_order: first
            };
            types.forEach(function(t) { row["w_" + t.id] = e.types && e.types[t.id] ? e.types[t.id].weight : null; });
            rows.push(row);
          });
        });
        return {
          fields: CHARACTER_FIELDS.concat([
            field("partner_id", "category", "ID партнёра", "Идентификатор второго участника связи."),
            field("partner", "category", "Партнёр", "Имя второго участника."),
            field("side", "category", "Сторона", "A или B: каждая пара встречается дважды; side = A оставляет по одной строке на пару."),
            field("category", "category", "Тип отношения", "любовь, брак, родство, дружба, вражда…"),
            field("role", "category", "Роль героя", "Роль героя в этой связи."),
            field("partner_role", "category", "Роль партнёра", "Роль второго участника."),
            field("weight", "number", "Сила связи", "Вес отношения 1…5."),
            field("evolves", "category", "Меняется", "«да», если отношение развивается по ходу романа."),
            field("note", "text", "Комментарий", "Короткое описание отношения."),
            field("interactions", "number", "Взаимодействий", "Число взаимодействий пары."),
            field("scenes", "number", "Сцен", "Число общих сцен пары."),
            field("first_chapter_order", "number", "Первая глава, №", "Номер первой главы, где проявляется отношение.")
          ], types.map(function(t) {
            return field("w_" + t.id, "number", "Вес: " + (t.label || t.id).toLowerCase(), "Нормированный вес (1…5) взаимодействий типа «" + (t.label || t.id) + "».");
          })),
          rows: rows, colors: { category: categoryColors }
        };
      }
    }
  ];

  var byId = {};
  datasets.forEach(function(d) { byId[d.id] = d; });

  // ---- Presets: built from the loaded novel so ids always exist ----

  function presets(src) {
    var byFragments = src.emoChars.slice().sort(function(a, b) { return (b.fragment_count || 0) - (a.fragment_count || 0); });
    var top = byFragments.map(function(c) { return c.id; });
    var list = [];
    if (src.has.emo && src.has.chapters) {
      list.push({ id: "anger", label: "Гнев по главам", spec: {
        version: 1, dataset: "emotions_by_chapter", title: "Гнев по главам",
        filter: [{ field: "model", op: "=", value: "8" }, { field: "emotion", op: "=", value: "anger" }, { field: "character_id", op: "in", value: top.slice(0, 2) }],
        chart: { type: "line", x: "chapter_order", y: "mean", color: "character" } } });
      list.push({ id: "profile", label: "Эмоциональный профиль", spec: {
        version: 1, dataset: "emotions_by_chapter", title: "Средний эмоциональный профиль героя",
        filter: [{ field: "model", op: "=", value: "8" }, { field: "character_id", op: "=", value: top[0] }],
        aggregate: { groupBy: ["emotion_label"], measures: [{ field: "mean", fn: "avg", as: "value" }] },
        sort: [{ field: "value", dir: "desc" }],
        chart: { type: "bar", x: "emotion_label", y: "value" } } });
      list.push({ id: "fragments", label: "Фрагменты по главам", spec: {
        version: 1, dataset: "chapter_fragments", title: "Эмоциональные фрагменты героев по главам",
        chart: { type: "bar", x: "chapter_order", y: "fragments", color: "character" } } });
      list.push({ id: "vad", label: "Фрагменты в VAD", spec: {
        version: 1, dataset: "fragments", title: "Фрагменты героя в пространстве VAD",
        filter: [{ field: "character_id", op: "=", value: top[0] }],
        chart: { type: "scatter3d", x: "valence", y: "arousal", z: "dominance", color: "cluster", text: "text" } } });
    }
    if (src.has.network) {
      list.push({ id: "top", label: "Топ по связям", spec: {
        version: 1, dataset: "characters", title: "Герои с наибольшим числом связей",
        sort: [{ field: "degree", dir: "desc" }], limit: 15,
        chart: { type: "table", columns: ["character", "tier", "degree", "interactions", "scenes", "score"] } } });
      list.push({ id: "love", label: "Любовные связи", spec: {
        version: 1, dataset: "relations", title: "У кого больше всего любовных связей",
        filter: [{ field: "category", op: "=", value: "любовь" }],
        aggregate: { groupBy: ["character"], measures: [{ fn: "count", as: "count" }] },
        sort: [{ field: "count", dir: "desc" }], limit: 15,
        chart: { type: "bar", x: "character", y: "count" } } });
    }
    return list;
  }

  global.AtlasPlaygroundDatasets = {
    list: datasets, get: function(id) { return byId[id] || null; }, ids: datasets.map(function(d) { return d.id; }),
    loadSources: loadSources, presets: presets
  };
})(window);
