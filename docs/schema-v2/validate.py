#!/usr/bin/env python
"""Validate a schema-v2 data root: JSON Schema per file + references between files.

    python docs/schema-v2/validate.py docs/schema-v2/example

Needs `pip install jsonschema`. Read-only. It checks references and shapes only; it never
recomputes or "fixes" pipeline-written values.
"""
import json, sys, pathlib
from jsonschema import Draft202012Validator

HERE = pathlib.Path(__file__).parent
SCHEMAS = {p.name.replace(".schema.json", ""): json.loads(p.read_text(encoding="utf8")) for p in (HERE / "schemas").glob("*.schema.json")}
errors = []


def load(p): return json.loads(pathlib.Path(p).read_text(encoding="utf8"))
def err(m): errors.append(m)


def check(kind, doc, where):
    for e in sorted(Draft202012Validator(SCHEMAS[kind]).iter_errors(doc), key=lambda e: list(map(str, e.path))):
        err(f"{where}: /{'/'.join(map(str, e.path))}: {e.message[:160]}")


def novel(root, nid, manifest_rel):
    base = (root / manifest_rel).parent
    man = load(root / manifest_rel); check("manifest", man, f"{nid}/manifest.json")
    if man.get("novelId") != nid: err(f"{nid}: manifest.novelId is {man.get('novelId')}")
    F = man["files"]

    def get(key, kind):
        if key not in F: return None
        p = base / F[key]
        if not p.exists(): err(f"{nid}: manifest.files.{key} -> missing {F[key]}"); return None
        d = load(p); check(kind, d, f"{nid}/{F[key]}"); return d

    full = get("character_index", "characters-full")
    ids = [c["id"] for c in full["characters"]] if full else []
    if len(ids) != len(set(ids)): err(f"{nid}: duplicate ids in characters_full.json")
    ids = set(ids)
    det = get("character_details", "characters-detail")
    if det:
        for cid in det["characters"]:
            if cid not in ids: err(f"{nid}: characters_detail has unknown character {cid}")
        for k, v in det.get("ambiguous", {}).items():
            if v["default_id"] and v["default_id"] not in ids: err(f"{nid}: ambiguous '{k}' -> unknown {v['default_id']}")

    chap = get("chapters", "chapters"); chap_ids = {c["id"] for c in chap["chapters"]}
    scenes = get("scenes", "scenes")
    # chapter references must be chapters.json ids (not source sections, not the long chapter_01_02 form)
    for c in full["characters"]:
        if c.get("intro_chapter") and c["intro_chapter"] not in chap_ids: err(f"{nid}: {c['id']}.intro_chapter '{c['intro_chapter']}' is not a chapters.json id")
    for s in (scenes or []):
        if s["chapter"] not in chap_ids: err(f"{nid}: scene {s['id']}.chapter '{s['chapter']}' is not a chapters.json id")
    for c in chap["chapters"]:
        p = base / F["novel_chapter_template"].format(chapter_id=c["id"])
        if not p.exists(): err(f"{nid}: missing novel file for chapter {c['id']}")
        else: check("novel-chapter", load(p), str(p.relative_to(root)))

    emo = get("characters", "emo-characters")
    clusters = get("clusters", "clusters")
    cluster_ids = {c["id"] for c in clusters["clusters"]} if clusters else set()
    for ec in (emo["characters"] if emo else []):
        cid = ec["id"]
        if cid not in ids: err(f"{nid}: emo-characters '{cid}' is not in characters_full.json")
        if not any(c["character_id"] == cid for c in clusters["clusters"]): err(f"{nid}: '{cid}' has no clusters")
        p = base / F["profile_template"].format(character_id=cid)
        if not p.exists(): err(f"{nid}: missing profile for {cid}")
        else: check("profile", load(p), str(p.relative_to(root)))
        for ch in chap["chapters"]:
            if ch.get("character_counts", {}).get(cid, 0) > 0:
                p = base / F["fragment_template"].format(character_id=cid, chapter_id=ch["id"])
                if not p.exists(): err(f"{nid}: missing fragments {cid}/{ch['id']}"); continue
                fd = load(p); check("fragments", fd, str(p.relative_to(root)))
                for fr in fd["fragments"]:
                    if fr["cluster_id"] not in cluster_ids: err(f"{nid}: {cid}/{ch['id']}: unknown cluster_id {fr['cluster_id']}")
    for c in (clusters["clusters"] if clusters else []):
        if c["character_id"] not in {e["id"] for e in emo["characters"]}: err(f"{nid}: cluster {c['id']} -> character not in emo-characters")

    # graph: the feature whose renderer is "graph" names the network file in 'entry'
    for ft in man["features"]:
        if ft.get("renderer") == "graph" and ft.get("status") == "ready":
            net = load(base / ft["entry"]); check("character-network", net, f"{nid}/{ft['entry']}")
            nodes = {n["id"] for n in net["nodes"]}
            for n in nodes - ids: err(f"{nid}: network node '{n}' is not in characters_full.json")
            cats = {c["id"] for c in net.get("categories", [])}
            sc = {s["id"] for s in scenes} if scenes else set()
            for e in net["edges"]:
                for end in (e["a"], e["b"]):
                    if end not in nodes: err(f"{nid}: edge endpoint '{end}' is not a node")
                cat = e.get("relation", {}).get("category")
                if cat and cats and cat not in cats: err(f"{nid}: edge category '{cat}' unknown")
                for ch in e.get("relation", {}).get("chapters", []):
                    if ch not in chap_ids: err(f"{nid}: edge {e['a']}|{e['b']}: relation.chapters '{ch}' is not a chapters.json id")
                for s in e.get("scenes", []):
                    if s not in sc: err(f"{nid}: edge {e['a']}|{e['b']}: unknown scene {s}")


def main(root):
    root = pathlib.Path(root)
    cat = load(root / "catalog.json"); check("catalog", cat, "catalog.json")
    for n in cat["novels"]: novel(root, n["id"], n["manifest"])
    if errors:
        print(f"{len(errors)} problem(s):"); [print(" -", e) for e in errors]; sys.exit(1)
    print("OK:", ", ".join(n["id"] for n in cat["novels"]))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else HERE / "example")
