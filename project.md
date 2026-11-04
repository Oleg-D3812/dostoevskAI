# Novel Analysis Atlas — project guide

## Purpose and constraints

This repository is a static, framework-free atlas for computational and LLM-assisted novel analysis. The external pipeline publishes browser-ready JSON; the browser discovers and renders it without a backend or build step.

Do not bundle detailed analysis data into HTML or JavaScript. Preserve stable novel, feature, character, and chapter IDs. Display labels may change and must never select application behavior.

## Authoritative discovery chain

The only browser discovery root is `data/catalog.json`:

```text
data/catalog.json
  → catalog novel record
    → data/novels/<novel-id>/manifest.json
      → feature record
        → feature entry and referenced data files
```

`data/manifest.json` has been retired. The catalog contains descriptive novel metadata and a manifest path, but no feature list. All paths in a novel manifest are relative to that manifest. `js/data-client.js` resolves them with the URL API after IDs have been matched against trusted catalog/manifest records.

A catalog record has localized presentation fields and a stable ID:

```json
{
  "id": "demons",
  "title": { "ru": "Бесы", "en": "Demons" },
  "author": { "ru": "Ф.М. Достоевский", "en": "Fyodor Dostoevsky" },
  "year": 1872,
  "manifest": "novels/demons/manifest.json"
}
```

The language helper prefers Russian, then English, then the first available value. Existing Russian copy is retained when no reviewed translation exists.

## Feature contract and registry

Novel manifests use schema version 1 and own their feature lists:

```json
{
  "schemaVersion": 1,
  "novelId": "demons",
  "features": [
    {
      "id": "character-network",
      "renderer": "graph",
      "label": { "ru": "Граф связей", "en": "Character network" },
      "status": "ready",
      "entry": "demons.json"
    }
  ]
}
```

Feature IDs are lowercase ASCII kebab-case and identify analyses. Renderer IDs identify reusable browser behavior. Current feature IDs are `character-network`, `emotion-vad`, `playground`, and `timeline`; current renderer implementations are `graph`, `explorer-index`, and `playground`. Status is `ready`, `planned`, or `unavailable`.

`js/feature-registry.js` is the trusted renderer allowlist. The novel-page router reads URL state, loads the catalog and selected novel manifest, creates tabs/panels from `feature.id`, selects a ready feature, updates history, and delegates rendering through the registry. A renderer receives a context containing the novel, manifest, feature, base/manifest URLs, panel, and abort signal. Unknown renderers and missing entries render readable errors instead of executing data-provided code.

## Adding content

To add a novel with existing renderers:

1. Publish `data/novels/<novel-id>/manifest.json` and its feature data.
2. Add one catalog record pointing to that manifest.
3. Add feature records with stable IDs, registered renderer IDs, explicit statuses, localized labels, and manifest-relative entries.

To add an analysis using an existing renderer, add a feature record only to the novel manifest and publish the entry it references. Do not change central routing.

To add genuinely new UI behavior, implement a loader that owns loading, empty, success, and error states; register its stable renderer ID in `js/feature-registry.js`; then reference that ID from feature records. Never dispatch on `label`.

## Data playground

The `playground` renderer ("Конструктор") lets visitors build their own charts. It reads only files the pipeline already publishes, and discovers them through the manifest's `files` block, `emo-characters.json`, and the `character-network` feature entry.

- `js/playground-datasets.js` is the dataset registry. Each dataset turns those files into flat rows plus a field list (`name`, `type` of `number` / `category` / `text`, `label`, `description`). The field list is also the in-app data dictionary. A dataset whose source files are missing is shown as unavailable.
- `js/playground-engine.js` is pure, with no DOM access. It validates a chart spec and runs filter → aggregate → sort → limit.
- `js/playground-render.js` draws the result. Plotly is loaded lazily from the same CDN URL the explorers use; tables are plain HTML.
- `js/playground.js` holds the dictionary, the form, the presets, and the editable spec. The current spec is mirrored into the URL as `&spec=<base64url JSON>`.

Chart spec, version 1:

```json
{ "version": 1, "dataset": "emotions_by_chapter", "title": "…",
  "filter": [{ "field": "emotion", "op": "=", "value": "anger" }],
  "aggregate": { "groupBy": ["character"], "measures": [{ "field": "mean", "fn": "avg", "as": "value" }] },
  "sort": [{ "field": "value", "dir": "desc" }], "limit": 20,
  "chart": { "type": "bar", "x": "character", "y": "value" } }
```

- **Filter ops:** `= != > >= < <= in between contains`.
- **Measure functions:** `count sum avg min max`.
- **Chart types:** `line bar scatter scatter3d table`.
- **Channels:** `x y z color size text`, plus `columns` for tables.

A spec is data and never code, so any future generator, such as an LLM, must produce this format and pass `validateShape` / `validateFields` before rendering.

## URLs and compatibility

The shared route is:

```text
novel.html?id=<novel-id>&feature=<feature-id>
```

`id` is required. Missing and unknown IDs are errors; they never fall back to another novel. `feature` is optional and defaults deliberately to the first ready feature. Unknown or unavailable feature IDs show an explanation and open the first ready feature. Tab changes update browser history without a reload.

Standalone VAD and clustering explorers remain in `explorers/` during this migration and accept `?novel=<novel-id>`. Links generated by the explorer-index renderer always include it, and explorer back links retain the novel and `emotion-vad` feature IDs. `demons_graph.html` has been retired to `obsolete/`; `novel.html?id=demons&feature=character-network` is the sole entry point for that graph.

## Loading and pipeline rules

Initial catalog loading fetches only the catalog. Opening a novel fetches its manifest. Opening the graph fetches its graph entry; opening the explorer index fetches no detailed chapter or fragment data. Standalone explorers load their indexes after validating the novel through the catalog, and fragment/chapter data remains governed by each explorer's interaction model.

The external pipeline must now:

- update `data/catalog.json` only for novel-level metadata and manifest pointers;
- emit `schemaVersion`, `novelId`, and `features` in every novel manifest;
- emit stable feature/renderer IDs, explicit status, and manifest-relative entry paths;
- stop publishing or depending on `data/manifest.json` as a browser registry;
- preserve the existing generated fields (`files`, model metadata, hashes, counts, assets, and sources) needed by explorers.

Serve and test through HTTP, not `file://`. The site uses Plotly for VAD explorers and vis-network for relationship graphs.

## Character data (schema v2)

Every fact is stored once. See `docs/schema-v2/README.md`, JSON Schemas in `docs/schema-v2/schemas/`, and check any data root with `python docs/schema-v2/validate.py data`.

- `characters_full.json` is the master list: `id`, `name`, `short_label` (null when none), `kind`, `intro_chapter`. Every graph node and emotion character must be listed here.
- `characters_detail.json` (lazy, keyed by id) holds `aliases`, `desc`, `intro_desc`, `note`, plus `ambiguous`.
- `character-network.json` nodes carry graph data only (`id`, `degree`, `core`, `importance`); names, descriptions and first appearance come from the two files above.
- `emo-characters.json` carries emotion data only (`id`, `color`, `fragment_count`, `chapter_count`); its file paths are `manifest.files.*` templates.
- Manifests keep `schemaVersion` and `novelId` only (no snake_case duplicates, no `title`; the title lives in `catalog.json`) and list `character_index`, `character_details` and `scenes` in `files`.
- The browser joins these files through `AtlasData.loadCharacterIndex`, `loadCharacterDetails`, `loadEmoCharactersDoc` and `joinNetwork` in `js/data-client.js`; explorers never read names from `emo-characters.json` directly.
- Every chapter reference (`intro_chapter`, `scenes[].chapter`, `relation.chapters[]`) is a `chapters.json` id (for example `2_16`), never a `chapter_02_16` form or a source section; scene ids stay `chapter_01_01_02_S1`.
- `scripts/migrate_v2.py` was the one-time v1 → v2 conversion (it also renamed the Crime and Punishment emotion id `marmeladova` to `sonya`).
