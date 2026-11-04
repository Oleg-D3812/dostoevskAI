"""Draw a random-sentence sample per novel for VAD baseline calibration.

The emotion pipeline only scores quotes that express a character's state, so
novel-level VAD means describe expressed emotion, not the novel overall. This
script samples sentences uniformly from the full text, tags each as covered or
not by an existing scored fragment, and writes a JSON file to feed through the
same VAD scorer (same prompt, model and +/-1 sentence context as production).

Compare afterwards: scored baseline mean vs fragment mean per novel, and the
share of baseline sentences already covered (an estimate of extraction recall).

    python scripts/calibration_sample.py --per-novel 150 --seed 42
"""
import argparse
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "data" / "novels"


def covered_sentences(novel_dir):
    """Set of (chapter_id, sentence_number) already inside a scored fragment."""
    covered = set()
    for path in (novel_dir / "fragments").glob("*/*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        for frag in data["fragments"]:
            for n in range(frag["chapter_sentence_start"], frag["chapter_sentence_end"] + 1):
                covered.add((data["chapter_id"], n))
    return covered


def sample_novel(novel_dir, k, rng):
    covered = covered_sentences(novel_dir)
    pool = []
    for path in sorted((novel_dir / "novel").glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        sents = data["sentences"]
        for i, s in enumerate(sents):
            if len(s["text"]) < 20:  # skip bare dashes / interjections
                continue
            pool.append((data["chapter_id"], i, sents))
    picks = rng.sample(pool, min(k, len(pool)))
    out = []
    for chapter_id, i, sents in picks:
        s = sents[i]
        out.append({
            "novel_id": novel_dir.name,
            "chapter_id": chapter_id,
            "sentence": s["number"],
            "text": s["text"],
            "before": sents[i - 1]["text"] if i > 0 else "",
            "after": sents[i + 1]["text"] if i + 1 < len(sents) else "",
            "already_in_fragment": (chapter_id, s["number"]) in covered,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-novel", type=int, default=150)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="calibration_sample.json")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    items = []
    for novel_dir in sorted(p for p in ROOT.iterdir() if (p / "novel").is_dir()):
        items += sample_novel(novel_dir, args.per_novel, rng)
    Path(args.out).write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    for nid in sorted({i["novel_id"] for i in items}):
        rs = [i for i in items if i["novel_id"] == nid]
        cov = sum(i["already_in_fragment"] for i in rs)
        print(f"{nid}: {len(rs)} sentences, {cov} already covered by a fragment")


if __name__ == "__main__":
    main()
