/**
 * Initialize a vis-network character relationship graph.
 *
 * The node layout is computed once (physics) from `layoutEdges` — the union of
 * every edge that can appear — then frozen. Switching the visible edge set via
 * `applyEdges` after that is a pure filter: edges are swapped and unconnected
 * nodes are dimmed, but no node ever moves and the view is not refitted.
 *
 * Double-clicking a node selects it alone; Ctrl/Cmd-click adds or removes a
 * node from the selection. Whenever the selection is non-empty, only selected
 * nodes and their direct neighbours (in the currently visible edge set) stay
 * shown — everyone else is hidden until `clearFilter()` is called.
 *
 * `setHiddenByFilter(ids)` hides an arbitrary set of nodes (e.g. by importance
 * tier) independently of the click-driven selection above — a node is shown
 * only when neither filter hides it.
 *
 * @param {HTMLElement} container - DOM element to render into
 * @param {Array} nodesData - [{id, label, desc, graphLabel?}] - graphLabel, when present,
 *   is shown on the canvas instead of label (e.g. an abbreviated name); the full label is
 *   still what's passed to onNodeClick/onEdgeClick for side-panel/modal display.
 * @param {Array} edgesData - initial visible edge set [{from, to, label, desc, color?, weight?:{N}}]
 * @param {Function} onNodeClick - callback(nodeData)
 * @param {Function} onEdgeClick - callback(edgeData, fromNode, toNode)
 * @param {Array} [layoutEdges] - superset edge set used only for the one-time layout (defaults to edgesData)
 * @param {Function} [onBlankClick] - callback() when clicking empty canvas (deselect)
 * @param {Function} [onFilterChange] - callback(hasFilter) whenever the node selection changes
 * @returns {{network, applyEdges: function(Array), clearFilter: function(), setHiddenByFilter: function(Array)}}
 */
function initGraph(container, nodesData, edgesData, onNodeClick, onEdgeClick, layoutEdges, onBlankClick, onFilterChange) {
  var MIN_WIDTH = 0.5;
  var MAX_WIDTH = 6;

  var NODE_ACTIVE = { background: "#2c5282", border: "#4a5568",
    highlight: { background: "#e53e3e", border: "#fc8181" }, hover: { background: "#e53e3e", border: "#fc8181" } };
  var NODE_DIM = { background: "#3b4555", border: "#4a5568",
    highlight: { background: "#e53e3e", border: "#fc8181" }, hover: { background: "#e53e3e", border: "#fc8181" } };
  var NODE_SELECTED = { background: "#d69e2e", border: "#f6e05e",
    highlight: { background: "#e53e3e", border: "#fc8181" }, hover: { background: "#e53e3e", border: "#fc8181" } };

  function edgeWidth(w) {
    if (!w || w < 1) return MIN_WIDTH;
    return MIN_WIDTH + (w - 1) / 4 * (MAX_WIDTH - MIN_WIDTH);
  }

  // Mix a "#rrggbb" colour toward white by `amount` (0..1). Used to brighten
  // an edge's own colour on select/hover instead of relying on a fixed
  // highlight colour, which is indistinguishable from the base for edges
  // that already carry a custom (category) colour.
  function lightenColor(hex, amount) {
    var c = String(hex).replace("#", "");
    if (c.length === 3) c = c.split("").map(function(ch) { return ch + ch; }).join("");
    var num = parseInt(c, 16);
    if (isNaN(num) || c.length !== 6) return hex;
    var r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    r = Math.round(r + (255 - r) * amount);
    g = Math.round(g + (255 - g) * amount);
    b = Math.round(b + (255 - b) * amount);
    return "#" + [r, g, b].map(function(v) { return v.toString(16).padStart(2, "0"); }).join("");
  }

  function connectedSet(list) {
    var c = {};
    (list || []).forEach(function(e) { c[e.from] = true; c[e.to] = true; });
    return c;
  }

  var nodes = new vis.DataSet(nodesData.map(function(n) { return { id: n.id, label: n.graphLabel || n.label }; }));
  var edgesVis = new vis.DataSet();

  var nodeById = {};
  nodesData.forEach(function(n) { nodeById[n.id] = n; });

  var currentEdges = [];
  var edgeByVisId = {};
  var userMoved = false;
  var frozen = false;
  var selectedIds = [];
  var externallyHidden = {}; // id -> true, set via setHiddenByFilter (e.g. tier filter)

  function autoFit() {
    if (!userMoved && network) network.fit({ animation: false });
  }

  function renderEdges(list) {
    currentEdges = list || [];
    edgeByVisId = {};
    var mapped = currentEdges.map(function(e, idx) {
      edgeByVisId["e" + idx] = e;
      var w = e.weight ? e.weight["N"] : 3;
      var visEdge = { id: "e" + idx, from: e.from, to: e.to, label: e.label, width: edgeWidth(w) };
      if (e.color) visEdge.color = e.color;
      return visEdge;
    });
    edgesVis.clear();
    edgesVis.add(mapped);
  }

  // Colour/size only — never touches positions, so filtering can't move the graph.
  function markConnectivity(list) {
    var connected = connectedSet(list);
    var selected = {};
    selectedIds.forEach(function(id) { selected[id] = true; });
    nodes.update(nodesData.map(function(n) {
      if (selected[n.id]) return { id: n.id, size: 20, color: NODE_SELECTED };
      return connected[n.id]
        ? { id: n.id, size: 18, color: NODE_ACTIVE }
        : { id: n.id, size: 11, color: NODE_DIM };
    }));
  }

  // Selected nodes plus whoever they're directly linked to in the current
  // edge set stay visible; everyone else is hidden. Null means "no filter".
  // Membership is checked against `selected` (never mutated) rather than the
  // `visible` set being built, so a freshly-added neighbour can't make a
  // *later* edge look like it touches a selected node — that would pull in
  // neighbours-of-neighbours instead of stopping at one hop.
  function filterVisibleSet() {
    if (!selectedIds.length) return null;
    var selected = {};
    selectedIds.forEach(function(id) { selected[id] = true; });
    var visible = {};
    selectedIds.forEach(function(id) { visible[id] = true; });
    currentEdges.forEach(function(e) {
      if (selected[e.from] || selected[e.to]) { visible[e.from] = true; visible[e.to] = true; }
    });
    return visible;
  }

  function applyFilter() {
    var visible = filterVisibleSet();
    nodes.update(nodesData.map(function(n) {
      var hidden = !!externallyHidden[n.id] || !!(visible && !visible[n.id]);
      return { id: n.id, hidden: hidden };
    }));
    if (onFilterChange) onFilterChange(selectedIds.length > 0);
  }

  // Public: hide a set of nodes by id, independent of and composable with the
  // click-driven neighbour filter above (e.g. an importance-tier checklist).
  // Pass an empty array/undefined to clear it.
  function setHiddenByFilter(hiddenIds) {
    externallyHidden = {};
    (hiddenIds || []).forEach(function(id) { externallyHidden[id] = true; });
    if (frozen) applyFilter();
  }

  function selectOnly(id) {
    if (!frozen) return;
    selectedIds = [id];
    markConnectivity(currentEdges);
    applyFilter();
  }

  function toggleSelect(id) {
    if (!frozen) return;
    var idx = selectedIds.indexOf(id);
    if (idx >= 0) selectedIds.splice(idx, 1); else selectedIds.push(id);
    markConnectivity(currentEdges);
    applyFilter();
  }

  // Public: drop the node selection and show the whole graph again.
  function clearFilter() {
    if (!selectedIds.length) return;
    selectedIds = [];
    markConnectivity(currentEdges);
    applyFilter();
  }

  // Public: swap the visible edge set. A pure filter once the layout is frozen;
  // the current node selection (if any) is re-applied against the new edges.
  function applyEdges(list) {
    renderEdges(list);
    if (frozen) { markConnectivity(list); applyFilter(); }
  }

  var options = {
    interaction: { hover: true },
    physics: {
      enabled: false,
      stabilization: { iterations: 300 },
      barnesHut: {
        gravitationalConstant: -9000,
        centralGravity: 1.2,
        springLength: 110,
        springConstant: 0.06,
        avoidOverlap: 0.35
      }
    },
    edges: {
      font: { align: "middle", color: "#a0aec0", strokeWidth: 0, size: 8 },
      smooth: true,
      color: { color: "#4a5568" },
      scaling: { min: MIN_WIDTH, max: MAX_WIDTH },
      // A selected/hovered edge keeps its own colour (category colour, or the
      // default grey) but brightened and thickened — visible regardless of
      // what that base colour is, instead of a single fixed highlight colour.
      chosen: {
        edge: function(values, id, selected, hovering) {
          if (selected) {
            values.color = lightenColor(values.color, 0.55);
            values.width = values.width * 1.8;
          } else if (hovering) {
            values.color = lightenColor(values.color, 0.3);
            values.width = values.width * 1.3;
          }
        }
      }
    },
    nodes: {
      shape: "dot",
      size: 18,
      font: { size: 16, color: "#e2e8f0", face: "Inter, -apple-system, sans-serif", bold: { mod: "" } },
      labelHighlightBold: false,
      scaling: {
        label: { enabled: true, min: 16, max: 24, maxVisible: 40, drawThreshold: 0 }
      },
      borderWidth: 2,
      color: NODE_ACTIVE
    }
  };

  // --- one-time physics layout from the full (superset) edge set ---
  var layout = layoutEdges && layoutEdges.length ? layoutEdges : edgesData;
  (function seedLayout() {
    var connected = connectedSet(layout);
    var isolatedTotal = nodesData.reduce(function(a, n) { return a + (connected[n.id] ? 0 : 1); }, 0);
    var perSide = Math.max(1, Math.ceil(isolatedTotal / 2));
    var gap = Math.max(34, Math.min(52, 620 / perSide));
    var y0 = -(perSide - 1) * gap / 2;
    var side = [0, 0];
    nodes.update(nodesData.map(function(n) {
      if (connected[n.id]) return { id: n.id, physics: true, fixed: false };
      var s = side[1] < side[0] ? 1 : 0, row = side[s];
      side[s] += 1;
      return { id: n.id, physics: false, fixed: true, x: s === 0 ? -360 : 360, y: y0 + row * gap };
    }));
    edgesVis.add(layout.map(function(e, i) {
      var w = e.weight ? e.weight["N"] : 3;
      return { id: "L" + i, from: e.from, to: e.to, width: edgeWidth(w) };
    }));
  })();

  var network = new vis.Network(container, { nodes: nodes, edges: edgesVis }, options);

  function freeze() {
    if (frozen) return;
    var pos = network.getPositions();
    nodes.update(nodesData.map(function(n) {
      var p = pos[n.id] || {};
      return { id: n.id, x: p.x, y: p.y, physics: false, fixed: false };
    }));
    network.setOptions({ physics: { enabled: false } });
    frozen = true;
    applyEdges(currentEdges.length ? currentEdges : edgesData);
    autoFit();
  }

  network.on("stabilizationIterationsDone", freeze);
  setTimeout(freeze, 4000); // fallback if the event never arrives (0 nodes, etc.)
  network.on("resize", autoFit);
  network.on("dragStart", function() { userMoved = true; });
  network.on("zoom", function() { userMoved = true; });

  network.on("click", function(params) {
    if (params.nodes && params.nodes.length > 0) {
      var id = params.nodes[0];
      var srcEvent = params.event && params.event.srcEvent;
      if (srcEvent && (srcEvent.ctrlKey || srcEvent.metaKey)) { toggleSelect(id); return; }
      var n = nodeById[id];
      if (n && onNodeClick) onNodeClick(n);
      return;
    }
    if (params.edges && params.edges.length > 0) {
      var e = edgeByVisId[params.edges[0]];
      if (e && onEdgeClick) onEdgeClick(e, nodeById[e.from], nodeById[e.to]);
      return;
    }
    if (onBlankClick) onBlankClick();
  });

  network.on("doubleClick", function(params) {
    if (params.nodes && params.nodes.length > 0) selectOnly(params.nodes[0]);
  });

  network.setOptions({ physics: { enabled: true } });
  network.stabilize(300);

  return { network: network, applyEdges: applyEdges, clearFilter: clearFilter, setHiddenByFilter: setHiddenByFilter };
}
