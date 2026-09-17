#!/usr/bin/env python3
"""Wire an already-delivered novel's data into manifest.json + catalog.json.

Assumption: everything under data/novels/<novel-id>/ except manifest.json
is delivered complete and correct by the external pipeline -- chapters.json,
scenes.json, novel/*.json, characters_full.json, character-network.json,
emo-characters.json, clusters.json, profiles/, fragments/. This script never
recomputes or rewrites any of that; it only *reads* it to total up numbers.
It writes exactly two things:

  - manifest.json      (created if missing; otherwise only its `counts`
                         block is patched in place, leaving every other
                         hand-formatted part of the file untouched)
  - data/catalog.json  (one entry added/updated for this novel id -- only
                         if a catalog-meta.json is present, see below)

Usage:
    python scripts/wire_novel.py demons
    python scripts/wire_novel.py demons --dry-run

Delivering catalog data
------------------------
No delivered file reliably carries a novel's title/author/year/description
(characters_full.json's "novel" field, where present, is an unreviewed
draft label, not a citation). To let this script add or refresh the
data/catalog.json entry, drop this alongside the novel's other files:

    data/novels/<novel-id>/catalog-meta.json

    {
      "title": {"ru": "...", "en": "..."},
      "author": {"ru": "...", "en": "..."},
      "year": 1880,
      "description": {"ru": "...", "en": "..."},
      "language": "ru"
    }

"en" fields and "language" are optional: "en" defaults to a copy of the
"ru" text (matching the existing convention of carrying an untranslated
placeholder until reviewed) and "language" defaults to "ru". Without this
file present, catalog.json is left untouched (existing entries are not
removed) and a warning is printed; manifest.json is still wired normally,
so the novel is reachable directly via novel.html?id=<id> even before it
gets a catalog entry.
"""
import argparse
import json
from pathlib import Path

MODEL_REF = {
    "id": "plutchik-vad-gaussian-v1",
    "path": "../../models/plutchik-vad-gaussian-v1.json",
    "sha256": "64af2d12a8d822817b7bfdbae105919d08a9ee86d16aef54e55ad6d2bc5f6eb4",
}

EXPLORERS = [
    {"name": "VAD → Plutchik pipeline", "description": "Interactive diagram of the methodology: from quote extraction and VAD scoring to the 8- and 16-component Plutchik profiles.", "entry": "../../../explorers/vad_to_plutchik_pipeline_diagram.html"},
    {"name": "Multi-character cluster space", "description": "Explore fragments in 3D and linked projections for the tracked characters.", "entry": "../../../explorers/separate_kmeans_interactive.html"},
    {"name": "Chapter VAD and Plutchik profiles", "description": "Select a character and chapter to compare the 3D VAD cloud with 8- and 16-component Plutchik profiles.", "entry": "../../../explorers/chapter_vad_clouds_with_radar.html"},
    {"name": "Chapter VAD clouds", "description": "Select characters and chapters to explore fragment-level VAD points in 3D.", "entry": "../../../explorers/chapter_vad_clouds.html"},
    {"name": "K-Means centroids and spheres", "description": "Inspect cluster centroids, VAD fragments, spheres and Plutchik anchors.", "entry": "../../../explorers/separate_kmeans_centroid_spheres.html"},
    {"name": "Sentence-window VAD animation", "description": "Move a configurable sentence window through the novel and watch active character states appear in VAD space alongside the highlighted text.", "entry": "../../../explorers/vad_sentence_window_animation.html"},
    {"name": "Plutchik profiles by chapter", "description": "Scroll a table of every chapter's 8- and 16-component Plutchik profile for one character at a time; click any chart to zoom in.", "entry": "../../../explorers/chapter_plutchik_table.html"},
]

# Resolve everything relative to the repo root (this file's grandparent
# directory), not the process's current directory, so the script works no
# matter where it's invoked from.
REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = REPO_ROOT / "data" / "catalog.json"


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def patch_counts_block(manifest_text, counts):
    """Rewrite only manifest.json's "counts": {...} object in place.

    manifest.json hand-formats some blocks (the features array) on single
    lines; round-tripping the whole file through json.dump would reflow
    those and bury the real diff. The counts object itself is always flat
    scalars, so a brace-balanced text replace is safe and touches nothing
    else in the file.
    """
    start = manifest_text.index('"counts"')
    brace_start = manifest_text.index("{", start)
    depth = 0
    end = brace_start
    for i, ch in enumerate(manifest_text[brace_start:], start=brace_start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    indent = manifest_text[manifest_text.rindex("\n", 0, start) + 1:start]
    lines = ['"counts": {']
    items = list(counts.items())
    for i, (key, value) in enumerate(items):
        comma = "," if i < len(items) - 1 else ""
        lines.append(f'{indent}  "{key}": {json.dumps(value)}{comma}')
    lines.append(f"{indent}}}")
    new_block = "\n".join(lines)
    return manifest_text[:start] + new_block + manifest_text[end:]


def compute_counts(root, warnings):
    """Total up numbers already present in delivered files. Nothing here
    is derived/recomputed from raw fragments -- it only sums fields that
    the delivered emo-characters.json/clusters.json/chapters.json already
    carry."""
    chapters_counts = {}
    chapters_path = root / "chapters.json"
    if chapters_path.exists():
        chapters_doc = load_json(chapters_path)
        chapters = chapters_doc["chapters"]
        chapters_counts["logical_chapters"] = len(chapters)
        chapters_counts["source_sections"] = sum(len(c["source_sections"]) for c in chapters)
        chapters_counts["sentences"] = chapters_doc["sentence_count"] if "sentence_count" in chapters_doc \
            else sum(c["sentence_count"] for c in chapters)
    else:
        warnings.append("chapters.json not found - logical_chapters/source_sections/sentences omitted from counts")

    character_counts = {}
    characters_path = root / "emo-characters.json"
    has_emo = characters_path.exists() and (root / "profiles").is_dir() and (root / "fragments").is_dir()
    if characters_path.exists():
        chars = load_json(characters_path).get("characters", [])
        character_counts["characters"] = len(chars)
        character_counts["fragments"] = sum(c.get("fragment_count", 0) for c in chars)
        character_counts["fragment_files"] = sum(c.get("chapter_count", 0) for c in chars)
        for c in chars:
            profile_path = root / c.get("profile_path", "")
            if not profile_path.exists():
                warnings.append(f"{c['id']}: profile_path {c.get('profile_path')} listed in emo-characters.json but not found")
    else:
        has_emo = False

    clusters_count = {}
    clusters_path = root / "clusters.json"
    if clusters_path.exists():
        clusters_count["clusters"] = len(load_json(clusters_path).get("clusters", []))
    elif has_emo:
        warnings.append("emo-characters.json present but clusters.json not found - clusters omitted from counts")

    # key order matches the existing manifest.json convention (characters,
    # logical_chapters, source_sections, sentences, fragments, clusters,
    # fragment_files) so an unchanged novel produces a true no-op diff.
    counts = {}
    if "characters" in character_counts:
        counts["characters"] = character_counts["characters"]
    counts.update(chapters_counts)
    if "fragments" in character_counts:
        counts["fragments"] = character_counts["fragments"]
    if "clusters" in clusters_count:
        counts["clusters"] = clusters_count["clusters"]
    if "fragment_files" in character_counts:
        counts["fragment_files"] = character_counts["fragment_files"]

    return counts, has_emo


def build_features(root, warnings):
    has_network = (root / "character-network.json").exists()
    has_emo = (root / "emo-characters.json").exists() and (root / "profiles").is_dir() and (root / "fragments").is_dir()

    features = []
    if has_network:
        features.append({
            "id": "character-network", "renderer": "graph",
            "label": {"ru": "Граф связей", "en": "Character network"},
            "status": "ready", "entry": "character-network.json",
            "help": "../../../explorers/character_network_explained.html",
        })
    else:
        warnings.append("no character-network.json found - character-network feature omitted")

    if has_emo:
        features.append({
            "id": "emotion-vad", "renderer": "explorer-index",
            "label": {"ru": "Эмоциональный анализ", "en": "Emotion analysis"},
            "status": "ready", "entry": "manifest.json",
            "help": "../../../explorers/vad_to_plutchik_explained.html",
            "explorers": EXPLORERS,
        })
    else:
        warnings.append("no emo-characters.json + profiles/ + fragments/ found - emotion-vad feature omitted")

    features.append({"id": "timeline", "renderer": "timeline", "label": {"ru": "Хронология", "en": "Timeline"}, "status": "planned"})
    return features


def wire_manifest(root, novel_id, catalog_meta, warnings):
    manifest_path = root / "manifest.json"
    counts, _ = compute_counts(root, warnings)

    if manifest_path.exists():
        manifest_text = manifest_path.read_text(encoding="utf-8")
        return manifest_path, patch_counts_block(manifest_text, counts), True

    title_ru = (catalog_meta or {}).get("title", {}).get("ru")
    if not title_ru:
        warnings.append("no catalog-meta.json title.ru found - manifest.json 'title' defaulted to the novel id; fix by hand or add catalog-meta.json and rerun")
        title_ru = novel_id
    language = (catalog_meta or {}).get("language", "ru")

    manifest = {
        "schemaVersion": 1,
        "novelId": novel_id,
        "features": build_features(root, warnings),
        "schema_version": 1,
        "novel_id": novel_id,
        "title": title_ru,
        "language": language,
        "vad_dimensions": ["V", "A", "D"],
        "sentence_numbering": "one-based within logical chapter",
        "timeline_indexing": "zero-based across the complete novel",
        "files": {
            "characters": "emo-characters.json",
            "chapters": "chapters.json",
            "clusters": "clusters.json",
            "novel_chapter_template": "novel/{chapter_id}.json",
            "fragment_template": "fragments/{character_id}/{chapter_id}.json",
            "profile_template": "profiles/{character_id}.json",
        },
        "emotion_model": MODEL_REF,
        "counts": counts,
    }
    return manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", False


def wire_catalog(novel_id, root, catalog_meta, warnings):
    if catalog_meta is None:
        catalog = load_json(CATALOG_PATH) if CATALOG_PATH.exists() else None
        already_listed = catalog and any(n["id"] == novel_id for n in catalog.get("novels", []))
        if not already_listed:
            warnings.append(f"no {root / 'catalog-meta.json'} found - catalog.json not touched; novel won't appear in the catalog until it's added")
        return None

    title = catalog_meta.get("title", {})
    author = catalog_meta.get("author", {})
    description = catalog_meta.get("description", {})
    if "en" not in title:
        warnings.append("catalog-meta.json: title.en missing - defaulted to title.ru, review/translate")
    if "en" not in author:
        warnings.append("catalog-meta.json: author.en missing - defaulted to author.ru, review/translate")
    if "en" not in description and description.get("ru"):
        warnings.append("catalog-meta.json: description.en missing - defaulted to description.ru, review/translate")

    entry = {
        "id": novel_id,
        "title": {"ru": title.get("ru", novel_id), "en": title.get("en", title.get("ru", novel_id))},
        "author": {"ru": author.get("ru", ""), "en": author.get("en", author.get("ru", ""))},
        "year": catalog_meta.get("year"),
        "description": {"ru": description.get("ru", ""), "en": description.get("en", description.get("ru", ""))},
        "manifest": f"novels/{novel_id}/manifest.json",
    }

    catalog = load_json(CATALOG_PATH) if CATALOG_PATH.exists() else {"schemaVersion": 1, "novels": []}
    novels = catalog.setdefault("novels", [])
    existing_index = next((i for i, n in enumerate(novels) if n["id"] == novel_id), None)
    if existing_index is not None:
        novels[existing_index] = entry
    else:
        novels.append(entry)
    return catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("novel", help="novel id under data-root, e.g. demons")
    parser.add_argument("--data-root", default=None, help="base novels directory (default: <repo>/data/novels)")
    parser.add_argument("--dry-run", action="store_true", help="report what would change without writing files")
    args = parser.parse_args()

    data_root = Path(args.data_root) if args.data_root else REPO_ROOT / "data" / "novels"
    root = data_root / args.novel
    if not root.is_dir():
        raise SystemExit(f"novel directory not found: {root}")

    warnings = []
    meta_path = root / "catalog-meta.json"
    catalog_meta = load_json(meta_path) if meta_path.exists() else None

    manifest_path, manifest_text, manifest_existed = wire_manifest(root, args.novel, catalog_meta, warnings)
    catalog = wire_catalog(args.novel, root, catalog_meta, warnings)

    print(f"novel: {args.novel}")
    print(f"manifest.json: {'patching counts on existing file' if manifest_existed else 'creating new'}")
    print(f"catalog.json: {'adding/updating entry' if catalog is not None else 'left untouched'}")
    if warnings:
        print("\nwarnings:")
        for w in warnings:
            print(" -", w)

    if args.dry_run:
        print("\ndry run - no files written")
        return

    manifest_path.write_text(manifest_text, encoding="utf-8")
    written = [str(manifest_path)]
    if catalog is not None:
        save_json(CATALOG_PATH, catalog)
        written.append(str(CATALOG_PATH))
    print(f"\nwrote {', '.join(written)}")


if __name__ == "__main__":
    main()
