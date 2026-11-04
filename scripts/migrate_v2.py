#!/usr/bin/env python
"""One-time conversion of data/ (schema v1) to data-v2/ (schema v2), plus a lossless check.

    python scripts/migrate_v2.py            # convert + verify
    python scripts/migrate_v2.py --check    # verify an existing data-v2/ only

v2 = v1 minus facts stored in more than one place (see docs/schema-v2/README.md).
Unchanged files are copied byte-for-byte. Reads data/, writes only data-v2/.
The verify step rebuilds every removed value from v2 and compares it with v1, so any
information loss or conflicting duplicate is reported instead of silently dropped.
"""
import json, re, shutil, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "data", ROOT / "data-v2"
UNCHANGED_FILES = ["chapters.json", "scenes.json", "clusters.json"]
UNCHANGED_DIRS = ["novel", "fragments", "profiles"]
NET_NODE_DROP = ("label", "short_label", "desc", "intro_chapter")
EMO_DROP = ("name", "label", "clusters_path", "fragments_path_template", "profile_path")
MAN_DROP = ("schema_version", "novel_id", "title")
NEW_FILES = {"character_index": "characters_full.json", "character_details": "characters_detail.json", "scenes": "scenes.json"}
problems = []
# Known v1 data error: the emotion character 'marmeladova' (Crime and Punishment) is 'sonya' in characters_full.json.
# The id is renamed everywhere it is used (ids, keys, file names, paths) so lookups by id keep working.
ID_FIX = {"crime-and-punishment": {"marmeladova": "sonya"}}


def fixer(nid):
    m = ID_FIX.get(nid, {})
    rx = re.compile(r"(?<![A-Za-z_])(" + "|".join(map(re.escape, m)) + r")(?![A-Za-z_])") if m else None
    def fs(x): return rx.sub(lambda g: m[g.group(1)], x) if rx else x
    def walk(o):
        if isinstance(o, dict): return {fs(k): walk(v) for k, v in o.items()}
        if isinstance(o, list): return [walk(v) for v in o]
        if isinstance(o, str): return fs(o)
        return o
    return fs, walk


def load(p): return json.loads(pathlib.Path(p).read_text(encoding="utf8"))
def dump(p, o):
    p = pathlib.Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(o, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
def bad(nid, msg): problems.append(f"{nid}: {msg}")


def merged(nid, what, values):
    """Same fact held by several v1 files: values must agree. Returns the single value (or None)."""
    vals = {json.dumps(v, ensure_ascii=False) for v in values if v not in (None, "")}
    if len(vals) > 1: bad(nid, f"conflicting duplicates for {what}: {sorted(vals)}")
    return next((v for v in values if v not in (None, "")), None)


def convert(nid):
    s, o = SRC / "novels" / nid, OUT / "novels" / nid
    o.mkdir(parents=True, exist_ok=True)
    fs, walk = fixer(nid)

    def put(src, rel):
        dst = o / fs(rel.as_posix())
        dst.parent.mkdir(parents=True, exist_ok=True)
        if fs(rel.as_posix()) != rel.as_posix() or fs(src.read_text(encoding="utf8")) != src.read_text(encoding="utf8"):
            dump(dst, walk(load(src)))
        else: shutil.copy2(src, dst)
    for f in UNCHANGED_FILES + (["catalog-meta.json"] if (s / "catalog-meta.json").exists() else []): put(s / f, pathlib.Path(f))
    for d in UNCHANGED_DIRS:
        for p in sorted((s / d).rglob("*.json")) if (s / d).is_dir() else []: put(p, p.relative_to(s))
    man, net, full, emo = (walk(load(s / f)) for f in ("manifest.json", "character-network.json", "characters_full.json", "emo-characters.json"))
    net_nodes = {n["id"]: n for n in net["nodes"]}
    emo_by = {c["id"]: c for c in emo["characters"]}

    slim, detail = [], {}
    for c in full["characters"]:
        i, n, e = c["id"], net_nodes.get(c["id"], {}), emo_by.get(c["id"], {})
        row = {"id": i,
               "name": merged(nid, f"{i}.name", [c.get("name"), n.get("label"), e.get("name")]),
               "short_label": merged(nid, f"{i}.short_label", [c.get("short_label"), n.get("short_label"), e.get("label")]),
               "kind": c.get("kind")}
        ic = merged(nid, f"{i}.intro_chapter", [c.get("intro_chapter"), n.get("intro_chapter")])
        if ic: row["intro_chapter"] = ic
        slim.append(row)
        d = {k: c[k] for k in ("aliases", "desc", "intro_desc", "note") if k in c}
        desc = merged(nid, f"{i}.desc", [c.get("desc"), n.get("desc")])
        if desc is not None: d["desc"] = desc
        if d: detail[i] = d
    for i in list(net_nodes) + list(emo_by):
        if i not in {c["id"] for c in full["characters"]}:
            bad(nid, f"'{i}' exists in network/emo-characters but not in characters_full.json (kept out of v2 master list)")
    dump(o / "characters_full.json", {"note": full.get("note", ""), "characters": slim})
    dump(o / "characters_detail.json", {"characters": detail, "ambiguous": full.get("ambiguous", {})})

    net2 = {k: v for k, v in net.items() if k != "title"}
    net2["nodes"] = [{k: v for k, v in n.items() if k not in NET_NODE_DROP} for n in net["nodes"]]
    dump(o / "character-network.json", net2)

    emo2 = dict(emo); emo2["characters"] = [{k: v for k, v in c.items() if k not in EMO_DROP} for c in emo["characters"]]
    dump(o / "emo-characters.json", emo2)

    man2 = {}
    for k, v in man.items():
        if k in MAN_DROP: continue
        man2[k] = v
        if k == "files": man2[k] = {**v, **NEW_FILES}
    dump(o / "manifest.json", man2)


def verify(nid):
    """Rebuild v1 values from v2 and compare with v1 data/."""
    s, o = SRC / "novels" / nid, OUT / "novels" / nid
    fs, walk = fixer(nid)
    for f in UNCHANGED_FILES:
        if walk(load(s / f)) != load(o / f): bad(nid, f"{f} differs")
    for d in UNCHANGED_DIRS:
        if not (s / d).is_dir(): continue
        a = sorted(p.relative_to(s).as_posix() for p in (s / d).rglob("*") if p.is_file()); b = sorted(p.relative_to(o).as_posix() for p in (o / d).rglob("*") if p.is_file())
        if sorted(map(fs, a)) != b: bad(nid, f"{d}/ file list differs")
        elif any(walk(load(s / p)) != load(o / fs(p)) for p in a): bad(nid, f"{d}/ content differs")
    man1, man2 = walk(load(s / "manifest.json")), load(o / "manifest.json")
    m2 = dict(man2); f2 = dict(m2.pop("files")); [f2.pop(k) for k in NEW_FILES]
    m1 = {k: v for k, v in man1.items() if k not in MAN_DROP}
    if {**m1, "files": man1["files"]} != {**m2, "files": f2}: bad(nid, "manifest differs beyond the intended changes")
    if man1.get("schemaVersion") != man1.get("schema_version") or man1.get("novelId") != man1.get("novel_id"): bad(nid, "camelCase and snake_case manifest keys disagreed")

    full1, net1, emo1 = (walk(load(s / f)) for f in ("characters_full.json", "character-network.json", "emo-characters.json"))
    slim, det = load(o / "characters_full.json"), load(o / "characters_detail.json")
    net2, emo2 = load(o / "character-network.json"), load(o / "emo-characters.json")
    S = {c["id"]: c for c in slim["characters"]}; D = det["characters"]
    if len(S) != len(full1["characters"]): bad(nid, "character count differs")
    for c in full1["characters"]:
        i, r, d = c["id"], S.get(c["id"], {}), D.get(c["id"], {})
        for k, v in (("name", c.get("name")), ("kind", c.get("kind"))):
            if r.get(k) != v: bad(nid, f"{i}.{k}: {r.get(k)!r} != {v!r}")
        for k in ("short_label", "intro_chapter"):
            if c.get(k) and r.get(k) != c[k]: bad(nid, f"{i}.{k} lost")
        for k in ("aliases", "desc", "intro_desc", "note"):
            if k in c and d.get(k) != c[k]: bad(nid, f"{i}.{k} lost")
    for n in net1["nodes"]:
        r, d = S.get(n["id"]), D.get(n["id"], {})
        if r is None: bad(nid, f"network node {n['id']} not in master list"); continue
        if r["name"] != n.get("label"): bad(nid, f"{n['id']} network label != name")
        if n.get("short_label") and r["short_label"] != n["short_label"]: bad(nid, f"{n['id']} network short_label lost")
        if n.get("intro_chapter") and r.get("intro_chapter") != n["intro_chapter"]: bad(nid, f"{n['id']} network intro_chapter lost")
        if n.get("desc") is not None and d.get("desc") != n["desc"]: bad(nid, f"{n['id']} network desc lost")
    n1 = {k: v for k, v in net1.items() if k != "title"}; n1["nodes"] = [{k: v for k, v in n.items() if k not in NET_NODE_DROP} for n in net1["nodes"]]
    if n1 != net2: bad(nid, "character-network differs beyond intended removals")
    files = man1["files"]
    for c in emo1["characters"]:
        i, r = c["id"], S.get(c["id"])
        if r is None: bad(nid, f"emo character {i} not in master list"); continue
        if r["name"] != c["name"]: bad(nid, f"{i} emo name != master name")
        if c.get("label") and r["short_label"] != c["label"]: bad(nid, f"{i} emo label lost")
        if c["clusters_path"] != files["clusters"]: bad(nid, f"{i} clusters_path != manifest")
        if c["fragments_path_template"] != files["fragment_template"].replace("{character_id}", i): bad(nid, f"{i} fragments path != manifest template")
        if c["profile_path"] != files["profile_template"].replace("{character_id}", i): bad(nid, f"{i} profile_path != manifest template")
    e1 = dict(emo1); e1["characters"] = [{k: v for k, v in c.items() if k not in EMO_DROP} for c in emo1["characters"]]
    if e1 != emo2: bad(nid, "emo-characters differs beyond intended removals")


def main():
    if (SRC / "novels" / "demons" / "characters_detail.json").exists() and not OUT.exists():
        sys.exit("data/ is already schema v2 (characters_detail.json exists); nothing to migrate. This script was a one-time v1 -> v2 conversion.")
    check_only = "--check" in sys.argv
    cat = load(SRC / "catalog.json")
    if not check_only:
        if OUT.exists(): shutil.rmtree(OUT)
        OUT.mkdir()
        shutil.copy2(SRC / "catalog.json", OUT / "catalog.json"); shutil.copytree(SRC / "models", OUT / "models")
    for n in cat["novels"]:
        if not check_only: convert(n["id"])
        verify(n["id"])
        print("done", n["id"])
    if problems:
        print(f"\n{len(problems)} finding(s):"); [print(" -", p) for p in problems]
    else: print("\nlossless check passed")
    sys.exit(1 if any("conflicting" in p or "lost" in p or "differs" in p for p in problems) else 0)


if __name__ == "__main__":
    main()
