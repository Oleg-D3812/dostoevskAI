/**
 * Initialize a vis-network character relationship graph.
 *
 * The node layout is computed once (physics) from `layoutEdges` — the union of
 * every edge that can appear — then frozen. Switching the visible edge set via
 * `applyEdges` after that is a pure filter: edges are swapped and unconnected
 * nodes are dimmed, but no node ever moves and the view is not refitted.
 *
 * @param {HTMLElement} container - DOM element to render into
 * @param {Array} nodesData - [{id, label, desc}]
 * @param {Array} edgesData - initial visible edge set [{from, to, label, desc, color?, weight?:{N}}]
 * @param {Function} onNodeClick - callback(nodeData)
 * @param {Function} onEdgeClick - callback(edgeData, fromNode, toNode)
 * @param {Array} [layoutEdges] - superset edge set used only for the one-time layout (defaults to edgesData)
 * @returns {{network, applyEdges: function(Array)}}
 */
function initGraph(container, nodesData, edgesData, onNodeClick, onEdgeClick, layoutEdges) {
  var MIN_WIDTH = 0.5;
  var MAX_WIDTH = 6;

  var NODE_ACTIVE = { background: "#2c5282", border: "#4a5568",
    highlight: { background: "#e53e3e", border: "#fc8181" }, hover: { background: "#e53e3e", border: "#fc8181" } };
  var NODE_DIM = { background: "#3b4555", border: "#4a5568",
    highlight: { background: "#e53e3e", border: "#fc8181" }, hover: { background: "#e53e3e", border: "#fc8181" } };

  function edgeWidth(w) {
    if (!w || w < 1) return MIN_WIDTH;
    return MIN_WIDTH + (w - 1) / 4 * (MAX_WIDTH - MIN_WIDTH);
  }

  function connectedSet(list) {
    var c = {};
    (list || []).forEach(function(e) { c[e.from] = true; c[e.to] = true; });
    return c;
  }

  var nodes = new vis.DataSet(nodesData.map(function(n) { return { id: n.id, label: n.label }; }));
  var edgesVis = new vis.DataSet();

  var nodeById = {};
  nodesData.forEach(function(n) { nodeById[n.id] = n; });

  var currentEdges = [];
  var edgeByVisId = {};
  var userMoved = false;
  var frozen = false;

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
      if (e.color) visEdge.color = { color: e.color, highlight: e.color, hover: e.color };
      return visEdge;
    });
    edgesVis.clear();
    edgesVis.add(mapped);
  }

  // Colour/size only — never touches positions, so filtering can't move the graph.
  function markConnectivity(list) {
    var connected = connectedSet(list);
    nodes.update(nodesData.map(function(n) {
      return connected[n.id]
        ? { id: n.id, size: 18, color: NODE_ACTIVE }
        : { id: n.id, size: 11, color: NODE_DIM };
    }));
  }

  // Public: swap the visible edge set. A pure filter once the layout is frozen.
  function applyEdges(list) {
    renderEdges(list);
    if (frozen) markConnectivity(list);
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
      color: { color: "#4a5568", highlight: "#e53e3e", hover: "#fc8181" },
      scaling: { min: MIN_WIDTH, max: MAX_WIDTH }
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
      var n = nodeById[params.nodes[0]];
      if (n && onNodeClick) onNodeClick(n);
      return;
    }
    if (params.edges && params.edges.length > 0) {
      var e = edgeByVisId[params.edges[0]];
      if (e && onEdgeClick) onEdgeClick(e, nodeById[e.from], nodeById[e.to]);
    }
  });

  network.setOptions({ physics: { enabled: true } });
  network.stabilize(300);

  return { network: network, applyEdges: applyEdges };
}
