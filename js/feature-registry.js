(function(global) {
  "use strict";

  var renderers = {
    graph: { load: function(context) { return global.AtlasFeatureRenderers.loadGraph(context); } },
    "explorer-index": { load: function(context) { return global.AtlasFeatureRenderers.renderExplorerIndex(context); } },
    playground: { load: function(context) { return global.AtlasPlayground.load(context); } }
  };

  global.AtlasFeatureRegistry = {
    getFeatureRenderer: function(rendererId) { return renderers[rendererId] || null; }
  };
})(window);
