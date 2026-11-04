// "Конструктор" feature: a data dictionary plus a form that edits one JSON
// chart spec. The spec is validated and executed by AtlasPlaygroundEngine
// and drawn by AtlasPlaygroundRender; it is mirrored into the URL (&spec=).
(function(global) {
  "use strict";

  var Engine = global.AtlasPlaygroundEngine;
  var Datasets = global.AtlasPlaygroundDatasets;
  var Render = global.AtlasPlaygroundRender;

  var PREVIEW_ROWS = 50;
  var MAX_DISTINCT = 400;
  var CHART_LABELS = { line: "Линия", bar: "Столбцы", scatter: "Точки", scatter3d: "Точки 3D", table: "Таблица" };
  var CHANNEL_LABELS = { x: "X", y: "Y", z: "Z", color: "Цвет", size: "Размер", text: "Подпись" };
  var OPS_BY_TYPE = {
    number: ["=", "!=", ">", ">=", "<", "<=", "between"],
    category: ["=", "!=", "in"],
    text: ["contains", "="]
  };
  var OP_LABELS = { "=": "=", "!=": "≠", ">": ">", ">=": "≥", "<": "<", "<=": "≤", "in": "одно из", "between": "между", "contains": "содержит" };
  var FN_LABELS = { count: "количество", sum: "сумма", avg: "среднее", min: "минимум", max: "максимум" };

  function escapeHtml(v) { var d = document.createElement("div"); d.textContent = v == null ? "" : String(v); return d.innerHTML; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function el(tag, className, html) { var node = document.createElement(tag); if (className) node.className = className; if (html != null) node.innerHTML = html; return node; }

  function encodeSpec(spec) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(spec)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodeSpec(text) {
    try { return JSON.parse(decodeURIComponent(escape(atob(text.replace(/-/g, "+").replace(/_/g, "/"))))); } catch (e) { return null; }
  }

  function defaultSpec(datasetId) { return { version: 1, dataset: datasetId, limit: 200, chart: { type: "table" } }; }

  function load(context) {
    var panel = context.panel;
    panel.classList.add("playground-panel");
    panel.innerHTML = '<div class="loading-state">Загрузка данных…</div>';
    return Datasets.loadSources(context).then(function(src) {
      if (context.signal.aborted) return;
      new Playground(context, src).start();
    }).catch(function(error) {
      if (error.name !== "AbortError") panel.innerHTML = '<div class="error-state">Не удалось загрузить данные: ' + escapeHtml(error.message) + "</div>";
    });
  }

  function Playground(context, src) {
    this.context = context;
    this.src = src;
    this.spec = null;
    this.data = null;            // { fields, rows, colors } of spec.dataset
    this.dataKey = null;
    this.dataCache = {};
    this.requestId = 0;
    this.presets = Datasets.presets(src);
    this.activePreset = null;
    this.filterDraft = null;     // filter being added in the form, or null
    this.preview = false;
  }

  Playground.prototype.start = function() {
    var self = this, panel = this.context.panel;
    panel.innerHTML = "";
    var root = el("div", "playground");
    root.innerHTML =
      '<div class="playground-presets"><span class="playground-kicker">Примеры</span></div>' +
      '<div class="playground-body">' +
        '<aside class="playground-dict">' +
          '<p class="playground-kicker">Наборы данных</p><div class="playground-datasets"></div>' +
          '<p class="playground-kicker">Поля</p><p class="playground-ds-desc"></p><div class="playground-fields"></div>' +
          '<button type="button" class="playground-btn playground-preview-btn">Первые ' + PREVIEW_ROWS + ' строк</button>' +
        "</aside>" +
        '<div class="playground-main">' +
          '<div class="playground-form"></div>' +
          '<div class="playground-errors" role="alert"></div>' +
          '<section class="playground-card">' +
            '<div class="playground-card-head"><h3 class="playground-title"></h3><span class="playground-status"></span></div>' +
            '<div class="playground-chart"></div>' +
          "</section>" +
          '<details class="playground-spec" open><summary>Спецификация (JSON)</summary>' +
            '<textarea class="playground-spec-text" spellcheck="false" rows="8"></textarea>' +
            '<div class="playground-spec-actions">' +
              '<button type="button" class="playground-btn playground-apply">Применить</button>' +
              '<button type="button" class="playground-btn playground-copy">Скопировать ссылку</button>' +
              '<span class="playground-note">Спецификация хранится в адресе страницы — ссылкой можно поделиться.</span>' +
            "</div>" +
          "</details>" +
        "</div>" +
      "</div>";
    panel.appendChild(root);
    this.root = root;
    this.$ = function(sel) { return root.querySelector(sel); };

    var presetBar = this.$(".playground-presets");
    this.presets.forEach(function(p) {
      var b = el("button", "playground-chip", escapeHtml(p.label));
      b.type = "button"; b.dataset.preset = p.id;
      b.addEventListener("click", function() { self.activePreset = p.id; self.apply(clone(p.spec)); });
      presetBar.appendChild(b);
    });
    this.$(".playground-preview-btn").addEventListener("click", function() { self.showPreview(); });
    this.$(".playground-apply").addEventListener("click", function() { self.applyText(); });
    this.$(".playground-copy").addEventListener("click", function(e) { self.copyLink(e.currentTarget); });

    var initial = null;
    var fromUrl = new URLSearchParams(global.location.search).get("spec");
    if (fromUrl) initial = decodeSpec(fromUrl);
    if (!initial && this.presets.length) { initial = clone(this.presets[0].spec); this.activePreset = this.presets[0].id; }
    if (!initial) {
      var first = Datasets.list.find(function(d) { return d.available(self.src); });
      if (!first) { this.$(".playground-body").innerHTML = '<div class="empty-state">Для этого произведения нет данных для конструктора.</div>'; return; }
      initial = defaultSpec(first.id);
    }
    this.apply(initial);
  };

  // ---- Core: validate, load, run, draw ----

  Playground.prototype.apply = function(spec) {
    var self = this;
    this.preview = false;
    var errors = Engine.validateShape(spec, Datasets.ids);
    var dataset = !errors.length && Datasets.get(spec.dataset);
    if (dataset && !dataset.available(this.src)) errors.push("Набор «" + dataset.label.ru + "» недоступен для этого произведения.");
    if (errors.length) { this.showErrors(errors); return; }

    var req = ++this.requestId;
    this.setStatus("Загрузка…");
    this.ensureData(dataset, spec).then(function(data) {
      if (req !== self.requestId || self.context.signal.aborted) return;
      if (!self.spec || self.spec.dataset !== spec.dataset) self.filterDraft = null;
      self.spec = spec;
      self.data = data;
      self.syncPresets();
      self.renderDictionary();
      self.renderForm();
      self.writeSpecText();
      self.writeUrl();
      self.draw();
    }).catch(function(error) {
      if (req !== self.requestId) return;
      self.setStatus("");
      self.showErrors(["Не удалось загрузить данные: " + error.message]);
    });
  };

  // Datasets whose load depends on the spec (fragments) are keyed by it too.
  Playground.prototype.ensureData = function(dataset, spec) {
    var self = this;
    var key = dataset.id + (dataset.dependsOnSpec ? "|" + JSON.stringify(spec.filter || []) : "");
    if (this.dataCache[key]) return this.dataCache[key];
    var promise = Promise.resolve(dataset.load(this.src, spec, function(done, total) {
      self.setStatus("Загрузка фрагментов: " + done + " / " + total);
    }));
    this.dataCache[key] = promise;
    promise.catch(function() { delete self.dataCache[key]; });
    return promise;
  };

  Playground.prototype.draw = function() {
    var self = this, spec = this.spec, chartEl = this.$(".playground-chart");
    this.$(".playground-title").textContent = spec.title || Datasets.get(spec.dataset).label.ru;
    var errors = Engine.validateFields(spec, this.data.fields);
    this.showErrors(errors);
    if (errors.length) { this.setStatus(""); return; }
    var rows = Engine.run(spec, this.data.rows);
    this.setStatus(rows.length + " " + plural(rows.length, "строка", "строки", "строк"));
    if (!rows.length) {
      if (global.Plotly) global.Plotly.purge(chartEl);
      chartEl.classList.remove("playground-plot");
      chartEl.innerHTML = '<div class="empty-state">Под фильтры не попала ни одна строка.</div>';
      return;
    }
    var req = this.requestId;
    Render.render(chartEl, spec, rows, Engine.outputFields(spec, this.data.fields), this.data.colors).catch(function(error) {
      if (req === self.requestId) self.showErrors([error.message]);
    });
  };

  Playground.prototype.showPreview = function() {
    if (!this.data) return;
    this.preview = true;
    var spec = { version: 1, dataset: this.spec.dataset, limit: PREVIEW_ROWS, chart: { type: "table" } };
    this.$(".playground-title").textContent = "Просмотр: " + Datasets.get(spec.dataset).label.ru;
    this.setStatus("первые " + PREVIEW_ROWS + " из " + this.data.rows.length + " · любое изменение вернёт график");
    this.showErrors([]);
    Render.render(this.$(".playground-chart"), spec, this.data.rows.slice(0, PREVIEW_ROWS), this.data.fields, this.data.colors);
  };

  // Edits from the form: tweak a copy of the spec and re-apply it.
  Playground.prototype.update = function(mutate) {
    var next = clone(this.spec);
    mutate(next);
    this.activePreset = null;
    this.apply(next);
  };

  // ---- Dictionary ----

  Playground.prototype.renderDictionary = function() {
    var self = this, list = this.$(".playground-datasets");
    list.innerHTML = "";
    Datasets.list.forEach(function(d) {
      var available = d.available(self.src);
      var b = el("button", "playground-ds" + (d.id === self.spec.dataset ? " active" : ""), escapeHtml(d.label.ru) + (available ? "" : ' <span class="playground-muted">нет данных</span>'));
      b.type = "button"; b.disabled = !available; b.title = d.description;
      b.addEventListener("click", function() { if (d.id !== self.spec.dataset) { self.activePreset = null; self.apply(defaultSpec(d.id)); } });
      list.appendChild(b);
    });
    var dataset = Datasets.get(this.spec.dataset);
    this.$(".playground-ds-desc").textContent = dataset.description;
    this.$(".playground-fields").innerHTML = this.data.fields.map(function(f) {
      return '<div class="playground-field" title="' + escapeHtml(f.description) + '">' +
        '<div><code>' + escapeHtml(f.name) + '</code><span class="playground-type">' + f.type + "</span></div>" +
        '<div class="playground-field-label">' + escapeHtml(f.label) + " — " + escapeHtml(f.description) + "</div></div>";
    }).join("");
  };

  Playground.prototype.syncPresets = function() {
    var active = this.activePreset;
    this.root.querySelectorAll("[data-preset]").forEach(function(b) { b.classList.toggle("active", b.dataset.preset === active); });
  };

  // ---- Form ----

  Playground.prototype.renderForm = function() {
    var self = this, spec = this.spec, form = this.$(".playground-form");
    var fields = this.data.fields;
    var outFields = Engine.outputFields(spec, fields);
    var type = spec.chart.type;
    form.innerHTML = "";

    // Row 1: chart type and channels.
    var row1 = el("div", "playground-row");
    row1.appendChild(this.selectControl("Тип", Engine.CHART_TYPES.map(function(t) { return [t, CHART_LABELS[t]]; }), type, false, function(value) {
      self.update(function(s) { s.chart.type = value; fillChannels(s, Engine.outputFields(s, fields)); });
    }));
    channelsFor(type).forEach(function(channel) {
      var rules = Engine.CHART_RULES[type];
      var required = rules.required.indexOf(channel) >= 0;
      var candidates = outFields.filter(function(f) {
        if (rules.numeric.indexOf(channel) >= 0) return f.type === "number";
        if (channel === "color") return f.type === "category";
        return true;
      });
      row1.appendChild(self.selectControl(CHANNEL_LABELS[channel], candidates.map(function(f) { return [f.name, f.label]; }), spec.chart[channel] || "", !required, function(value) {
        self.update(function(s) { if (value) s.chart[channel] = value; else delete s.chart[channel]; });
      }));
    });
    form.appendChild(row1);

    // Table columns as toggle chips.
    if (type === "table") {
      var cols = el("div", "playground-row playground-chips");
      cols.appendChild(el("span", "playground-kicker", "Столбцы"));
      var chosen = spec.chart.columns || [];
      outFields.forEach(function(f) {
        var b = el("button", "playground-chip" + (chosen.indexOf(f.name) >= 0 ? " active" : ""), escapeHtml(f.label));
        b.type = "button"; b.title = f.description || "";
        b.addEventListener("click", function() {
          self.update(function(s) {
            var list = (s.chart.columns || []).slice(), i = list.indexOf(f.name);
            if (i >= 0) list.splice(i, 1); else list.push(f.name);
            if (list.length) s.chart.columns = list; else delete s.chart.columns;
          });
        });
        cols.appendChild(b);
      });
      cols.appendChild(el("span", "playground-muted", chosen.length ? "" : "(не выбрано — показываются все)"));
      form.appendChild(cols);
    }

    // Row 2: filters.
    var row2 = el("div", "playground-row playground-chips");
    row2.appendChild(el("span", "playground-kicker", "Фильтры"));
    (spec.filter || []).forEach(function(f, i) {
      var chip = el("span", "playground-chip active playground-filter", escapeHtml(describeFilter(f, fields)) + ' <button type="button" aria-label="Убрать фильтр">&times;</button>');
      chip.querySelector("button").addEventListener("click", function() {
        self.update(function(s) { s.filter.splice(i, 1); if (!s.filter.length) delete s.filter; });
      });
      row2.appendChild(chip);
    });
    var add = el("button", "playground-chip", "+ фильтр");
    add.type = "button";
    add.addEventListener("click", function() { self.filterDraft = { field: fields[0].name }; self.renderForm(); });
    row2.appendChild(add);
    form.appendChild(row2);
    if (this.filterDraft) form.appendChild(this.filterEditor());

    // Row 3: aggregation, sort, limit.
    var row3 = el("div", "playground-row");
    var agg = spec.aggregate || null;
    var groupBy = (agg && agg.groupBy) || [];
    var measure = (agg && agg.measures && agg.measures[0]) || { fn: "count" };
    var groupable = fields.filter(function(f) { return f.type !== "text" || f.name === "chapter_label"; });
    [0, 1].forEach(function(k) {
      if (k === 1 && !groupBy[0]) return;
      row3.appendChild(self.selectControl(k ? "и по" : "Группировать по", groupable.map(function(f) { return [f.name, f.label]; }), groupBy[k] || "", true, function(value) {
        self.update(function(s) {
          var g = ((s.aggregate && s.aggregate.groupBy) || []).slice();
          if (value) g[k] = value; else g.splice(k, k === 0 ? 2 : 1);
          if (!g.length) delete s.aggregate;
          else s.aggregate = { groupBy: g, measures: (s.aggregate && s.aggregate.measures) || initialMeasures(s, fields) };
          fillChannels(s, Engine.outputFields(s, fields));
        });
      }));
    });
    if (agg) {
      row3.appendChild(self.selectControl("Мера", Engine.AGG_FNS.map(function(fn) { return [fn, FN_LABELS[fn]]; }), measure.fn, false, function(value) {
        self.update(function(s) { setMeasure(s, value, value === "count" ? null : (s.aggregate.measures[0].field || firstNumber(fields))); fillChannels(s, Engine.outputFields(s, fields)); });
      }));
      if (measure.fn !== "count") {
        row3.appendChild(self.selectControl("поля", fields.filter(function(f) { return f.type === "number"; }).map(function(f) { return [f.name, f.label]; }), measure.field || "", false, function(value) {
          self.update(function(s) { setMeasure(s, s.aggregate.measures[0].fn, value); fillChannels(s, Engine.outputFields(s, fields)); });
        }));
      }
    }
    var sort = (spec.sort && spec.sort[0]) || null;
    row3.appendChild(self.selectControl("Сортировка", outFields.map(function(f) { return [f.name, f.label]; }), sort ? sort.field : "", true, function(value) {
      self.update(function(s) { if (value) s.sort = [{ field: value, dir: sort ? sort.dir : "desc" }]; else delete s.sort; });
    }));
    if (sort) {
      row3.appendChild(self.selectControl("", [["desc", "по убыванию"], ["asc", "по возрастанию"]], sort.dir || "asc", false, function(value) {
        self.update(function(s) { s.sort[0].dir = value; });
      }));
    }
    var limitWrap = el("label", "playground-control", "<span>Лимит</span>");
    var limit = el("input");
    limit.type = "number"; limit.min = "1"; limit.max = String(Engine.MAX_LIMIT); limit.placeholder = "все"; limit.value = spec.limit || "";
    limit.addEventListener("change", function() {
      var n = parseInt(limit.value, 10);
      self.update(function(s) { if (n > 0) s.limit = Math.min(n, Engine.MAX_LIMIT); else delete s.limit; });
    });
    limitWrap.appendChild(limit);
    row3.appendChild(limitWrap);
    form.appendChild(row3);
  };

  Playground.prototype.filterEditor = function() {
    var self = this, draft = this.filterDraft, fields = this.data.fields;
    var fieldDef = fields.find(function(f) { return f.name === draft.field; }) || fields[0];
    var ops = OPS_BY_TYPE[fieldDef.type];
    if (ops.indexOf(draft.op) < 0) draft.op = ops[0];
    var box = el("div", "playground-row playground-filter-editor");
    box.appendChild(this.selectControl("Поле", fields.map(function(f) { return [f.name, f.label]; }), fieldDef.name, false, function(value) {
      self.filterDraft = { field: value }; self.renderForm();
    }));
    box.appendChild(this.selectControl("Условие", ops.map(function(op) { return [op, OP_LABELS[op]]; }), draft.op, false, function(value) {
      draft.op = value; self.renderForm();
    }));

    var getValue;
    var valueWrap = el("label", "playground-control", "<span>Значение</span>");
    if (fieldDef.type === "category") {
      var values = this.distinctValues(fieldDef.name);
      var select = el("select");
      if (draft.op === "in") { select.multiple = true; select.size = Math.min(6, Math.max(3, values.length)); }
      select.innerHTML = values.map(function(v) { return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + "</option>"; }).join("");
      valueWrap.appendChild(select);
      getValue = function() {
        if (draft.op !== "in") return select.value;
        return Array.from(select.selectedOptions).map(function(o) { return o.value; });
      };
    } else if (draft.op === "between") {
      var lo = el("input"), hi = el("input");
      lo.type = hi.type = "number"; lo.step = hi.step = "any"; lo.placeholder = "от"; hi.placeholder = "до";
      valueWrap.appendChild(lo); valueWrap.appendChild(hi);
      getValue = function() { return lo.value === "" || hi.value === "" ? null : [Number(lo.value), Number(hi.value)]; };
    } else {
      var input = el("input");
      input.type = fieldDef.type === "number" ? "number" : "text"; input.step = "any";
      valueWrap.appendChild(input);
      getValue = function() { return input.value === "" ? null : (fieldDef.type === "number" ? Number(input.value) : input.value); };
    }
    box.appendChild(valueWrap);

    var ok = el("button", "playground-btn", "Добавить"), cancel = el("button", "playground-btn playground-btn-quiet", "Отмена");
    ok.type = cancel.type = "button";
    var hint = el("span", "playground-field-error");
    ok.addEventListener("click", function() {
      var value = getValue();
      if (value == null || (Array.isArray(value) && !value.length)) { hint.textContent = "Укажите значение."; return; }
      self.filterDraft = null;
      self.update(function(s) { (s.filter = s.filter || []).push({ field: fieldDef.name, op: draft.op, value: value }); });
    });
    cancel.addEventListener("click", function() { self.filterDraft = null; self.renderForm(); });
    box.appendChild(ok); box.appendChild(cancel); box.appendChild(hint);
    return box;
  };

  Playground.prototype.distinctValues = function(name) {
    var dataset = Datasets.get(this.spec.dataset);
    if (dataset.values) { var own = dataset.values(this.src, name); if (own) return own; }
    var seen = new Set();
    this.data.rows.forEach(function(r) { if (r[name] != null && seen.size < MAX_DISTINCT) seen.add(String(r[name])); });
    return Array.from(seen).sort(function(a, b) { return Engine.compare(a, b); });
  };

  Playground.prototype.selectControl = function(label, options, value, allowEmpty, onChange) {
    var wrap = el("label", "playground-control", label ? "<span>" + escapeHtml(label) + "</span>" : "<span>&nbsp;</span>");
    var select = el("select");
    var html = allowEmpty ? '<option value="">—</option>' : "";
    var known = options.some(function(o) { return o[0] === value; });
    if (value && !known) html += '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + " (нет)</option>";
    html += options.map(function(o) { return '<option value="' + escapeHtml(o[0]) + '">' + escapeHtml(o[1]) + "</option>"; }).join("");
    select.innerHTML = html;
    select.value = value || "";
    select.addEventListener("change", function() { onChange(select.value); });
    wrap.appendChild(select);
    return wrap;
  };

  // ---- Spec text, URL, messages ----

  Playground.prototype.writeSpecText = function() {
    this.$(".playground-spec-text").value = JSON.stringify(this.spec, null, 2);
  };

  Playground.prototype.applyText = function() {
    var spec;
    try { spec = JSON.parse(this.$(".playground-spec-text").value); }
    catch (e) { this.showErrors(["Ошибка в JSON: " + e.message]); return; }
    this.activePreset = null;
    this.filterDraft = null;
    this.apply(spec);
  };

  Playground.prototype.writeUrl = function() {
    var url = new URL(global.location.href);
    url.searchParams.set("spec", encodeSpec(this.spec));
    history.replaceState(null, "", url);
  };

  Playground.prototype.copyLink = function(button) {
    var done = function() { button.textContent = "Скопировано"; setTimeout(function() { button.textContent = "Скопировать ссылку"; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(global.location.href).then(done, function() { button.textContent = "Не удалось скопировать"; });
  };

  Playground.prototype.showErrors = function(errors) {
    var box = this.$(".playground-errors");
    box.innerHTML = errors.map(function(e) { return "<div>" + escapeHtml(e) + "</div>"; }).join("");
    box.hidden = !errors.length;
  };

  Playground.prototype.setStatus = function(text) { this.$(".playground-status").textContent = text; };

  // ---- Helpers ----

  function channelsFor(type) {
    if (type === "table") return [];
    if (type === "scatter3d") return ["x", "y", "z", "color", "size", "text"];
    if (type === "scatter") return ["x", "y", "color", "size", "text"];
    return ["x", "y", "color", "text"];
  }

  // After a chart-type or aggregation change, drop channels that no longer
  // exist and fill required ones with the first suitable field.
  function fillChannels(spec, outFields) {
    var rules = Engine.CHART_RULES[spec.chart.type];
    var byName = {};
    outFields.forEach(function(f) { byName[f.name] = f; });
    var allowed = channelsFor(spec.chart.type);
    Object.keys(spec.chart).forEach(function(channel) {
      if (channel === "type" || channel === "columns") return;
      var f = byName[spec.chart[channel]];
      var needsNumber = rules.numeric.indexOf(channel) >= 0;
      if (allowed.indexOf(channel) < 0 || !f || (needsNumber && f.type !== "number")) delete spec.chart[channel];
    });
    if (spec.chart.columns) {
      spec.chart.columns = spec.chart.columns.filter(function(name) { return byName[name]; });
      if (!spec.chart.columns.length || spec.chart.type !== "table") delete spec.chart.columns;
    }
    var used = {};
    rules.required.forEach(function(channel) {
      if (spec.chart[channel]) { used[spec.chart[channel]] = true; return; }
      var needsNumber = rules.numeric.indexOf(channel) >= 0;
      var pick = outFields.find(function(f) { return !used[f.name] && (!needsNumber || f.type === "number"); }) ||
        outFields.find(function(f) { return !needsNumber || f.type === "number"; });
      if (pick) { spec.chart[channel] = pick.name; used[pick.name] = true; }
    });
    if (spec.sort) {
      spec.sort = spec.sort.filter(function(s) { return byName[s.field]; });
      if (!spec.sort.length) delete spec.sort;
    }
  }

  function setMeasure(spec, fn, fieldName) {
    var m = { fn: fn, as: fn === "count" ? "count" : "value" };
    if (fieldName && fn !== "count") m.field = fieldName;
    spec.aggregate.measures = [m];
  }

  // Grouping a chart that plots a numeric Y starts from the average of that
  // field; otherwise from a plain row count.
  function initialMeasures(spec, fields) {
    var y = fields.find(function(f) { return f.name === spec.chart.y && f.type === "number"; });
    if (y) { spec.chart.y = "value"; return [{ fn: "avg", field: y.name, as: "value" }]; }
    return [{ fn: "count", as: "count" }];
  }

  function firstNumber(fields) {
    var f = fields.find(function(item) { return item.type === "number" && item.name !== "chapter_order"; }) ||
      fields.find(function(item) { return item.type === "number"; });
    return f ? f.name : null;
  }

  function describeFilter(f, fields) {
    var def = fields.find(function(item) { return item.name === f.field; });
    var value = Array.isArray(f.value) ? (f.op === "between" ? f.value.join(" … ") : f.value.join(", ")) : f.value;
    return (def ? def.label : f.field) + " " + (OP_LABELS[f.op] || f.op) + " " + value;
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  global.AtlasPlayground = { load: load, encodeSpec: encodeSpec, decodeSpec: decodeSpec };
})(window);
