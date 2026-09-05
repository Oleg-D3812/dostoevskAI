/**
 * Initialize a vis-network character relationship graph.
 *
 * @param {HTMLElement} container - DOM element to render into
 * @param {Array} nodesData - [{id, label, desc}]
 * @param {Array} edgesData - [{from, to, label, desc, weight?:{N,I,E}}]
 * @param {Function} onNodeClick - callback(nodeData)
 * @param {Function} onEdgeClick - callback(edgeData, fromNode, toNode)
 * @returns {{network, setWeight: function(string)}}
 */
function initGraph(container, nodesData, edgesData, onNodeClick, onEdgeClick) {
  var MIN_WIDTH = 0.5;
  var MAX_WIDTH = 6;

  function edgeWidth(w) {
    if (!w || w < 1) return MIN_WIDTH;
    return MIN_WIDTH + (w - 1) / 4 * (MAX_WIDTH - MIN_WIDTH);
  }

  var connectedNodeIds = {};
  edgesData.forEach(function(e) {
    connectedNodeIds[e.from] = true;
    connectedNodeIds[e.to] = true;
  });
  var isolatedIndex = 0;
  var nodes = new vis.DataSet(nodesData.map(function(n) {
    var node = { id: n.id, label: n.label };
    if (!connectedNodeIds[n.id]) {
      node.x = isolatedIndex % 2 === 0 ? -340 : 340;
      node.y = 230 + Math.floor(isolatedIndex / 2) * 90;
      node.physics = false;
      isolatedIndex += 1;
    }
    return node;
  }));

  var edgesVis = new vis.DataSet(edgesData.map(function(e, idx) {
    var w = e.weight ? e.weight["N"] : 3;
    return {
      id: "e" + idx, from: e.from, to: e.to,
      label: e.label,
      width: edgeWidth(w)
    };
  }));

  var options = {
    interaction: { hover: true },
    physics: {
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
      font: { size: 16, color: "#e2e8f0" },
      scaling: {
        label: { enabled: true, min: 16, max: 24, maxVisible: 40, drawThreshold: 0 }
      },
      borderWidth: 2,
      color: {
        background: "#2c5282",
        border: "#4a5568",
        highlight: { background: "#e53e3e", border: "#fc8181" },
        hover: { background: "#e53e3e", border: "#fc8181" }
      }
    }
  };

  var network = new vis.Network(container, { nodes: nodes, edges: edgesVis }, options);

  var nodeById = {};
  nodesData.forEach(function(n) { nodeById[n.id] = n; });
  var edgeByVisId = {};
  edgesData.forEach(function(e, i) { edgeByVisId["e" + i] = e; });

  network.on("click", function(params) {
    if (params.nodes && params.nodes.length > 0) {
      var n = nodeById[params.nodes[0]];
      if (n && onNodeClick) onNodeClick(n);
      return;
    }
    if (params.edges && params.edges.length > 0) {
      var e = edgeByVisId[params.edges[0]];
      if (e && onEdgeClick) {
        var fromNode = nodeById[e.from];
        var toNode = nodeById[e.to];
        onEdgeClick(e, fromNode, toNode);
      }
    }
  });

  function setWeight(key) {
    var updates = edgesData.map(function(e, idx) {
      var w = e.weight ? (e.weight[key] || 3) : 3;
      return { id: "e" + idx, width: edgeWidth(w) };
    });
    edgesVis.update(updates);
  }

  return { network: network, setWeight: setWeight };
}

