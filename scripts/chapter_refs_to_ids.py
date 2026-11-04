#!/usr/bin/env python
"""Make every chapter *reference* use a chapters.json id (e.g. "chapter_02_16" -> "2_16").

Fields converted, in every novel under data/novels/:
  characters_full.json    characters[].intro_chapter
  scenes.json             [].chapter
  character-network.json  edges[].relation.chapters[]   (duplicates after conversion are dropped, order kept)

A value that names a source section missing from chapters.json (Crime and Punishment "chapter_2_1_2")
is mapped to its logical chapter ("2_1") - the same fallback the site used at runtime. Anything that
cannot be resolved stops the script; nothing is written in that case.
Scene ids (chapter_01_01_02_S1) are identities, not references, and are left as they are.

    python scripts/chapter_refs_to_ids.py            # convert in place
    python scripts/chapter_refs_to_ids.py --dry-run  # report only
"""
import json, re, sys, pathlib, collections

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"


def load(p): return json.loads(p.read_text(encoding="utf8"))
def dump(p, o): p.write_text(json.dumps(o, ensure_ascii=False, indent=2) + "\n", encoding="utf8")


def norm(c):
    return "_".join((s.lstrip("0") or "0") for s in re.sub(r"^chapter_", "", str(c)).split("_"))


def resolver(ids):
    def resolve(c):
        k = norm(c)
        while k:
            if k in ids: return k
            if "_" not in k: return None
            k = k.rsplit("_", 1)[0]
        return None
    return resolve


def main():
    dry = "--dry-run" in sys.argv
    writes, problems, stats = [], [], collections.Counter()
    for nd in sorted((DATA / "novels").iterdir()):
        if not nd.is_dir(): continue
        ids = {c["id"] for c in load(nd / "chapters.json")["chapters"]}
        resolve = resolver(ids)

        def conv(v, where):
            r = resolve(v)
            if r is None: problems.append(f"{nd.name}: {where}: '{v}' matches no chapter"); return v
            if r != v: stats[nd.name] += 1
            return r

        full = load(nd / "characters_full.json")
        for c in full["characters"]:
            if c.get("intro_chapter"): c["intro_chapter"] = conv(c["intro_chapter"], f"{c['id']}.intro_chapter")
        scenes = load(nd / "scenes.json")
        for s in scenes: s["chapter"] = conv(s["chapter"], f"scene {s['id']}")
        net = load(nd / "character-network.json")
        for e in net["edges"]:
            rel = e.get("relation")
            if rel and "chapters" in rel:
                out = []
                for c in rel["chapters"]:
                    r = conv(c, f"edge {e['a']}|{e['b']}")
                    if r not in out: out.append(r)
                rel["chapters"] = out
        writes += [(nd / "characters_full.json", full), (nd / "scenes.json", scenes), (nd / "character-network.json", net)]
    if problems:
        print(f"{len(problems)} unresolved - nothing written:"); [print(" -", p) for p in problems[:20]]; sys.exit(1)
    print("references changed:", dict(stats))
    if dry: print("dry run - nothing written"); return
    for p, o in writes: dump(p, o)
    print("written", len(writes), "files")


if __name__ == "__main__":
    main()
