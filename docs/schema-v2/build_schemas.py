#!/usr/bin/env python
"""Generates schemas/*.schema.json (kept as a script so descriptions stay in one readable place).

v2 = v1 formats exactly as the pipeline writes them, minus facts that were stored in more than one file.
"""
import json, pathlib

OUT = pathlib.Path(__file__).parent / "schemas"
OUT.mkdir(exist_ok=True)

S = {"type": "string"}
I = {"type": "integer"}
N = {"type": "number"}
B = {"type": "boolean"}
NS = {"type": ["string", "null"]}
I18N = {"type": "object", "properties": {"ru": S, "en": S}, "required": ["ru"], "additionalProperties": False}
VAD = {"type": "array", "items": N, "minItems": 3, "maxItems": 3}
CH = {"type": "string", "description": "A chapters.json id (e.g. 2_16) - never a source section or the chapter_02_16 form."}
HEX = {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"}


def obj(props, req=(), extra=False, desc=None):
    d = {"type": "object", "properties": props, "required": list(req), "additionalProperties": extra}
    if desc: d["description"] = desc
    return d


def arr(items, desc=None):
    d = {"type": "array", "items": items}
    if desc: d["description"] = desc
    return d


def write(name, title, schema, desc=None):
    doc = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": name + ".schema.json", "title": title}
    if desc: doc["description"] = desc
    doc.update(schema)
    (OUT / (name + ".schema.json")).write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf8")


# ---------------------------------------------------------------- unchanged from v1
write("catalog", "data/catalog.json (unchanged from v1) - the one place for a novel's title/author/year",
      obj({"schemaVersion": I,
           "novels": arr(obj({"id": S, "title": I18N, "author": I18N, "year": {"type": ["integer", "string"]}, "description": I18N, "manifest": S},
                             ["id", "title", "author", "year", "manifest"]))}, ["schemaVersion", "novels"]))

write("chapters", "chapters.json (unchanged from v1)",
      obj({"schema_version": I, "novel_id": S, "chapter_count": I, "sentence_count": I,
           "chapters": arr(obj({"id": S, "part": I, "chapter": I, "section": I, "label": S, "description": S,
                                "sentence_count": I, "timeline_start_index": I, "source_sections": arr(S), "novel_path": S,
                                "character_counts": {"type": "object", "additionalProperties": I}},
                               ["id", "label", "sentence_count", "timeline_start_index", "novel_path"]))},
          ["schema_version", "novel_id", "chapters"]))

write("scenes", "scenes.json (unchanged from v1) - a bare array",
      arr(obj({"id": S, "chapter": CH, "scene_id": S, "title": S, "summary": S}, ["id", "chapter", "scene_id", "title", "summary"])))

write("novel-chapter", "novel/<chapter_id>.json (unchanged from v1)",
      obj({"schema_version": I, "novel_id": S, "chapter_id": S, "part": I, "chapter": I, "sentence_count": I, "timeline_start_index": I,
           "source_sections": arr(obj({"id": S, "source_file": S, "sentence_start": I, "sentence_count": I}, ["id"], True)),
           "sentences": arr(obj({"number": I, "timeline_index": I, "source_section": S, "source_sentence": I, "text": S},
                                ["number", "timeline_index", "text"], True))},
          ["schema_version", "chapter_id", "sentences"], True))

write("clusters", "clusters.json (unchanged from v1)",
      obj({"schema_version": I, "novel_id": S, "vad_dimensions": arr(S),
           "clusters": arr(obj({"id": S, "character_id": S, "local_index": I, "display_id": S, "name": S, "centroid": VAD, "size": I,
                                "within_cluster_spread": N, "sphere_radius": N, "color": HEX},
                               ["id", "character_id", "name", "centroid", "size", "color"], True,
                               desc="display_id embeds the character's short name (e.g. 'В.П. Ставрогина-1'); left as the pipeline writes it."))},
          ["schema_version", "clusters"]))

write("fragments", "fragments/<character_id>/<chapter_id>.json (unchanged from v1)",
      obj({"schema_version": I, "novel_id": S, "character_id": S, "chapter_id": S, "count": I,
           "fragments": arr(obj({"id": S, "source_section": S, "source_sentence": I, "character_position": I, "text": S, "vad": VAD,
                                 "cluster_id": S, "distance_to_centroid": N, "warning": NS, "chapter_sentence_start": I,
                                 "chapter_sentence_end": I, "timeline_start_index": I, "timeline_end_index": I,
                                 "highlights": arr(obj({"chapter_sentence": I, "start": I, "end": I}, ["chapter_sentence", "start", "end"]))},
                                ["id", "text", "vad", "cluster_id"], True))},
          ["schema_version", "character_id", "chapter_id", "fragments"]))

write("profile", "profiles/<character_id>.json (unchanged from v1)",
      obj({"schema_version": I, "character_id": S, "components8": arr(S), "components16": arr(S),
           "chapters": {"type": "object", "additionalProperties": obj(
               {"count": I, "sum8": arr(N), "mean8": arr(N), "sum16": arr(N), "mean16": arr(N)}, ["count", "mean8", "mean16"], True)}},
          ["schema_version", "character_id", "chapters"]))

# ---------------------------------------------------------------- changed
feature = obj({"id": S, "renderer": S, "label": I18N, "status": {"enum": ["ready", "planned"]}, "entry": S, "help": S,
               "explorers": arr(obj({"name": S, "description": S, "entry": S}, ["name", "entry"]))},
              ["id", "renderer", "status"], True)
write("manifest", "manifest.json - v1 minus: duplicated schema_version/novel_id, title, and nothing else",
      obj({"schemaVersion": I, "novelId": S, "features": arr(feature), "language": S, "vad_dimensions": arr(S),
           "sentence_numbering": S, "timeline_indexing": S,
           "files": obj({"characters": S, "chapters": S, "clusters": S, "novel_chapter_template": S, "fragment_template": S,
                         "profile_template": S, "character_index": S, "character_details": S, "scenes": S},
                        ["characters", "chapters", "clusters", "novel_chapter_template", "fragment_template", "profile_template",
                         "character_index", "scenes"],
                        desc="characters = emo-characters.json (v1 meaning kept). NEW keys: character_index (characters_full.json), character_details (characters_detail.json, optional), scenes - previously hard-coded in JS."),
           "emotion_model": obj({"id": S, "path": S, "sha256": S}, ["id", "path"]),
           "counts": {"type": "object", "additionalProperties": I},
           "data_version": S, "generated_at": S,
           "assets": arr({"type": "object"}), "provenance": arr({"type": "object"})},
          ["schemaVersion", "novelId", "features", "files"]))

write("characters-full", "characters_full.json - SLIM master list of every character (v1 file, trimmed)",
      obj({"note": S,
           "characters": arr(obj({"id": S, "name": S, "short_label": NS, "kind": S, "intro_chapter": CH},
                                 ["id", "name", "short_label", "kind"],
                                 desc="short_label: THE one short name (v1: short_label in network/glossary, label in emo-characters). Always present, null when unknown. intro_chapter: a chapters.json id."))},
          ["characters"]),
      desc="Removed vs v1: top-level 'novel' (title copy); aliases, desc, intro_desc, note, ambiguous -> characters_detail.json.")

write("characters-detail", "characters_detail.json - NEW, lazy: long text for a character (side panel, text highlighting)",
      obj({"characters": {"type": "object", "additionalProperties": obj(
          {"aliases": arr(S), "desc": S, "intro_desc": S, "note": S}, [], False)},
           "ambiguous": {"type": "object", "additionalProperties": obj({"default_id": NS, "note": S}, ["default_id"], True)}},
          ["characters"]),
      desc="Keys of 'characters' are ids from characters_full.json. Values moved unchanged from v1 characters_full.json (aliases, desc, intro_desc, note) and character-network.json (desc was identical).")

node = obj({"id": S, "degree": I, "core": {"type": ["integer", "null"]},
            "importance": obj({"F": N, "D": N, "W": N, "B": N, "score": N, "tier": S}, [], True)}, ["id"])
rel = obj({"category": S, "weight": N, "roles": arr(S), "evolves": B, "note": S, "chapters": arr(CH)}, [], True)
edge = obj({"a": S, "b": S, "interactions": I, "scenes": arr(S), "relation": rel,
            "types": {"type": "object", "additionalProperties": obj({"count": I, "raw_weight": N, "weight": N}, [], True)}}, ["a", "b"])
write("character-network", "character-network.json - v1 minus identity fields (label, short_label, desc, intro_chapter) and title",
      obj({"schema_version": I, "generated_at": S,
           "categories": arr(obj({"id": S, "color": HEX}, ["id", "color"])),
           "interaction_types": arr(obj({"id": S, "label": {"anyOf": [S, I18N]}}, ["id"], True)),
           "nodes": arr(node), "edges": arr(edge)},
          ["schema_version", "nodes", "edges"]))

write("emo-characters", "emo-characters.json - v1 minus name, label (-> characters_full.json) and the 3 paths (-> manifest.files)",
      obj({"schema_version": I, "novel_id": S,
           "characters": arr(obj({"id": S, "color": HEX, "fragment_count": I, "chapter_count": I}, ["id", "color"]))},
          ["schema_version", "characters"]))
print("schemas:", sorted(p.name for p in OUT.glob("*.json")))
