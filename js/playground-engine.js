// Pure chart-spec engine for the data playground: validation plus
// filter -> aggregate -> sort -> limit over flat row arrays. No DOM access,
// so the same checks can later vet LLM-generated specs.
(function(global) {
  "use strict";

  var FILTER_OPS = ["=", "!=", ">", ">=", "<", "<=", "in", "between", "contains"];
  var AGG_FNS = ["count", "sum", "avg", "min", "max"];
  var CHART_TYPES = ["line", "bar", "scatter", "scatter3d", "table"];
  var CHANNELS = ["x", "y", "z", "color", "size", "text"];
  var MAX_LIMIT = 5000;
  var FN_LABELS = { count: "Количество", sum: "Сумма", avg: "Среднее", min: "Минимум", max: "Максимум" };

  // Channels each chart type needs, and which of them must be numeric.
  var CHART_RULES = {
    line: { required: ["x", "y"], numeric: ["y"] },
    bar: { required: ["x", "y"], numeric: ["y"] },
    scatter: { required: ["x", "y"], numeric: ["x", "y", "size"] },
    scatter3d: { required: ["x", "y", "z"], numeric: ["x", "y", "z", "size"] },
    table: { required: [], numeric: [] }
  };

  function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

  function fieldMap(fields) {
    var map = {};
    (fields || []).forEach(function(field) { map[field.name] = field; });
    return map;
  }

  function measureName(measure) {
    return measure.as || (measure.fn === "count" && !measure.field ? "count" : measure.fn + "_" + measure.field);
  }

  // Fields visible after aggregation: the group keys plus one per measure.
  function outputFields(spec, fields) {
    if (!spec.aggregate) return fields;
    var byName = fieldMap(fields);
    var out = (spec.aggregate.groupBy || []).map(function(name) { return byName[name]; }).filter(Boolean);
    (spec.aggregate.measures || []).forEach(function(measure) {
      var source = byName[measure.field];
      var label = FN_LABELS[measure.fn] + (source ? ": " + source.label.toLowerCase() : measure.field ? ": " + measure.field : "");
      out.push({ name: measureName(measure), type: "number", label: label, description: "" });
    });
    return out;
  }

  // Shape checks that need only the dataset registry, not loaded data.
  function validateShape(spec, datasetIds) {
    var errors = [];
    if (!isObject(spec)) return ["Спецификация должна быть JSON-объектом."];
    if (spec.version !== 1) errors.push("Поддерживается только version: 1.");
    if (datasetIds.indexOf(spec.dataset) < 0) errors.push("Неизвестный набор данных: " + spec.dataset);
    if (spec.filter != null && !Array.isArray(spec.filter)) errors.push("filter должен быть массивом.");
    (spec.filter || []).forEach(function(f, i) {
      if (!isObject(f) || !f.field) errors.push("Фильтр #" + (i + 1) + ": не указано поле.");
      else if (FILTER_OPS.indexOf(f.op) < 0) errors.push("Фильтр #" + (i + 1) + ": неизвестная операция " + f.op);
      else if ((f.op === "in" && !Array.isArray(f.value)) || (f.op === "between" && !(Array.isArray(f.value) && f.value.length === 2)))
        errors.push("Фильтр #" + (i + 1) + ": для " + f.op + " нужен массив значений.");
    });
    if (spec.aggregate != null) {
      if (!isObject(spec.aggregate) || !Array.isArray(spec.aggregate.measures) || !spec.aggregate.measures.length)
        errors.push("aggregate.measures должен содержать хотя бы одну меру.");
      else spec.aggregate.measures.forEach(function(m, i) {
        if (AGG_FNS.indexOf(m.fn) < 0) errors.push("Мера #" + (i + 1) + ": неизвестная функция " + m.fn);
        if (m.fn !== "count" && !m.field) errors.push("Мера #" + (i + 1) + ": не указано поле.");
      });
    }
    if (spec.limit != null && !(Number.isInteger(spec.limit) && spec.limit > 0 && spec.limit <= MAX_LIMIT))
      errors.push("limit должен быть целым числом от 1 до " + MAX_LIMIT + ".");
    if (!isObject(spec.chart) || CHART_TYPES.indexOf(spec.chart.type) < 0) errors.push("Неизвестный тип графика.");
    return errors;
  }

  // Field checks against the dataset's actual fields.
  function validateFields(spec, fields) {
    var errors = [];
    var byName = fieldMap(fields);
    function need(name, where) { if (!byName[name]) errors.push(where + ": нет поля «" + name + "»."); }
    (spec.filter || []).forEach(function(f, i) {
      need(f.field, "Фильтр #" + (i + 1));
      var field = byName[f.field];
      if (field && field.type !== "number" && [">", ">=", "<", "<=", "between"].indexOf(f.op) >= 0)
        errors.push("Фильтр #" + (i + 1) + ": операция " + f.op + " применима только к числам.");
    });
    if (spec.aggregate) {
      (spec.aggregate.groupBy || []).forEach(function(name) { need(name, "Группировка"); });
      (spec.aggregate.measures || []).forEach(function(m, i) {
        if (m.field) need(m.field, "Мера #" + (i + 1));
        var field = byName[m.field];
        if (field && m.fn !== "count" && field.type !== "number") errors.push("Мера #" + (i + 1) + ": " + m.fn + " применима только к числам.");
      });
    }
    if (errors.length) return errors;

    var out = fieldMap(outputFields(spec, fields));
    (spec.sort || []).forEach(function(s) { if (!out[s.field]) errors.push("Сортировка: нет поля «" + s.field + "»."); });
    var chart = spec.chart, rules = CHART_RULES[chart.type];
    rules.required.forEach(function(channel) { if (!chart[channel]) errors.push("Для этого типа графика нужно поле " + channel.toUpperCase() + "."); });
    CHANNELS.forEach(function(channel) {
      if (!chart[channel]) return;
      var field = out[chart[channel]];
      if (!field) { errors.push(channel.toUpperCase() + ": нет поля «" + chart[channel] + "»" + (spec.aggregate ? " после группировки." : ".")); return; }
      if (rules.numeric.indexOf(channel) >= 0 && field.type !== "number") errors.push(channel.toUpperCase() + ": нужно числовое поле.");
    });
    (chart.columns || []).forEach(function(name) { if (!out[name]) errors.push("Столбцы таблицы: нет поля «" + name + "»."); });
    return errors;
  }

  function matches(row, f) {
    var v = row[f.field];
    // Loose equality on purpose: "1" typed into a text box should match 1.
    switch (f.op) {
      case "=": return v == f.value;
      case "!=": return v != f.value;
      case ">": return v != null && v > Number(f.value);
      case ">=": return v != null && v >= Number(f.value);
      case "<": return v != null && v < Number(f.value);
      case "<=": return v != null && v <= Number(f.value);
      case "in": return f.value.some(function(item) { return item == v; });
      case "between": return v != null && v >= Number(f.value[0]) && v <= Number(f.value[1]);
      case "contains": return v != null && String(v).toLowerCase().indexOf(String(f.value).toLowerCase()) >= 0;
    }
    return false;
  }

  function applyFilters(rows, filters) {
    if (!filters || !filters.length) return rows;
    return rows.filter(function(row) { return filters.every(function(f) { return matches(row, f); }); });
  }

  function aggregate(rows, agg) {
    var groupBy = agg.groupBy || [];
    var groups = new Map();
    rows.forEach(function(row) {
      var key = JSON.stringify(groupBy.map(function(name) { return row[name]; }));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    var out = [];
    groups.forEach(function(members) {
      var result = {};
      groupBy.forEach(function(name) { result[name] = members[0][name]; });
      agg.measures.forEach(function(m) {
        var values = m.field ? members.map(function(r) { return r[m.field]; }).filter(function(v) { return v != null && v !== ""; }) : members;
        var nums = values.map(Number).filter(function(v) { return !isNaN(v); });
        var value = null;
        if (m.fn === "count") value = values.length;
        else if (nums.length) {
          if (m.fn === "sum" || m.fn === "avg") value = nums.reduce(function(a, b) { return a + b; }, 0) / (m.fn === "avg" ? nums.length : 1);
          else value = Math[m.fn].apply(null, nums);
        }
        result[measureName(m)] = value;
      });
      out.push(result);
    });
    return out;
  }

  // Empty values sort last in both directions.
  function compare(a, b, dir) {
    if (a == null) return b == null ? 0 : 1;
    if (b == null) return -1;
    var c = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "ru", { numeric: true });
    return dir === "desc" ? -c : c;
  }

  function sortRows(rows, sort) {
    if (!sort || !sort.length) return rows;
    return rows.slice().sort(function(a, b) {
      for (var i = 0; i < sort.length; i++) {
        var c = compare(a[sort[i].field], b[sort[i].field], sort[i].dir);
        if (c) return c;
      }
      return 0;
    });
  }

  function run(spec, rows) {
    var out = applyFilters(rows, spec.filter);
    if (spec.aggregate) out = aggregate(out, spec.aggregate);
    out = sortRows(out, spec.sort);
    if (spec.limit) out = out.slice(0, spec.limit);
    return out;
  }

  global.AtlasPlaygroundEngine = {
    FILTER_OPS: FILTER_OPS, AGG_FNS: AGG_FNS, CHART_TYPES: CHART_TYPES, CHART_RULES: CHART_RULES, MAX_LIMIT: MAX_LIMIT,
    validateShape: validateShape, validateFields: validateFields, outputFields: outputFields,
    applyFilters: applyFilters, run: run, compare: compare
  };
})(window);
