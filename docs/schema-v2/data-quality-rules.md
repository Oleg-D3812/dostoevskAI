# Data quality rules (schema v2)

Rules for verifying a novel's data before publishing. Rules 1–26 are **errors** (the site breaks or shows wrong content). Rules 27–35 are **warnings**. Rule 36 is a site-level smoke test.

"In validate.py" means `docs/schema-v2/validate.py` already checks it (partly, where noted). Everything else is not implemented yet.

## Critical (errors)

### Files and structure

1. Every file named in `manifest.files`, in a feature's `entry`, and in the catalog's `manifest` exists and parses as UTF-8 JSON. *In validate.py, except feature `help` and explorer `entry` paths.*
2. Every file passes its JSON Schema, with required fields present and correct types. *In validate.py.*
3. `catalog.novels[].id` equals the folder name and the manifest's `novelId`, and ids are unique. *In validate.py (`novelId` only).*
4. Every chapter in `chapters.json` has its `novel/<id>.json`, and every fragment or profile file is referenced, with no orphan files.

### Character references

5. Every character id is in `characters_full.json`: network nodes, `emo-characters`, `clusters.character_id`, `characters_detail` keys, `ambiguous.default_id`, and the keys of `chapters.character_counts`. *In validate.py, except `character_counts` keys and non-emotion `clusters`.*
6. Character ids are unique, and `name` is non-empty. *In validate.py (uniqueness only).*
7. Every graph node has a non-empty `name`, and `desc` in `characters_detail.json`. Otherwise the side panel is empty.
8. Every emotion character has a `color`, at least one cluster, a profile file, and fragments for each chapter listed in `character_counts`. *In validate.py, except `color`.*

### Graph

9. Edge endpoints are nodes, `a < b`, there are no self-edges, and no pair appears twice. *In validate.py, except self-edges.*
10. Edge `category` exists in `categories`, and `types` keys exist in `interaction_types`. *In validate.py, except the `types` keys.*
11. Every `scenes[]` id on an edge exists in `scenes.json`. *In validate.py.*
12. Every scene's `chapter` is a `chapters.json` id (an exact match, no `chapter_` prefix, no source section). *In validate.py.*
13. Every `intro_chapter` and every edge `relation.chapters[]` entry is a `chapters.json` id (exact match). *In validate.py.*
14. `degree` equals the number of edges touching the node, `interactions` equals the sum of the `types` counts, and weights are between 1 and 5.

### Text and timeline

15. `sentence_count` equals the number of sentences in the file, and `number` runs 1..n with no gaps.
16. `timeline_index` is contiguous across the whole novel, and each chapter's `timeline_start_index` is the sum of the sentence counts before it.
17. The totals match: `chapter_count`, `sentence_count`, and `manifest.counts` (characters, chapters, sentences, fragments, clusters, fragment_files).
18. No empty or whitespace-only sentences, control characters or mojibake. Check that Cyrillic text decodes correctly.

### Fragments and clusters

19. The fragment file's `count` equals its number of fragments, and the number agrees in `chapters.character_counts[char][chapter]`, the profile `count`, and the sums in `emo.fragment_count` and `chapter_count`.
20. `cluster_id` exists and belongs to the same character, and cluster ids follow `<character>-<n>`. *In validate.py, except the same-character rule and the id format.*
21. Sentence references are inside the chapter, and the fragment `text` equals the sentence text at the `highlights` offsets (`start:end`). The highlight must also fit within the sentence length.
22. The fragment's timeline indexes equal the chapter start plus the sentence number minus 1.
23. Every `vad` has 3 finite numbers in [-1, 1], and `distance_to_centroid` is a finite number ≥ 0.
24. A cluster's `size` equals the number of fragments assigned to it. Its `centroid` should match the mean of their `vad` within a tolerance.

### Profiles

25. `components8` and `components16` match the model's `emotion_order` and `component_order_16`, and `mean8` and `mean16` have 8 and 16 finite values.
26. The chapters in a profile are exactly the chapters where the character has fragments, and `sum` equals `mean × count` within a tolerance.

## Important (warnings)

27. **Aliases:** no alias is shared by two characters unless it is listed in `ambiguous`. Warn when one alias is a substring of another character's alias. Highlighting matches the longest alias first.
28. **Appearance in text:** each graph character's name or an alias occurs at least once in the text, and in the intro chapter.
29. **Short names:** `short_label` is null or a non-empty string, and not identical to another character's.
30. **Characters:** `kind` is in the allowed set, and `intro_chapter` is present for graph characters.
31. **Graph shape:** warn on isolated nodes, `importance.tier` outside the allowed values, and `score` outside 0..1.
32. **Colors:** every color is a valid hex value, and character colors within a novel are distinct enough to tell apart.
33. **Manifest features:** feature ids are unique, `renderer` is one the site knows, `status: ready` features have their entry file, and the templates contain `{chapter_id}` and `{character_id}`.
34. **Emotion model:** `emotion_model.path` exists and its `sha256` matches the file.
35. **Id formats:** within a novel, all chapter ids follow one pattern, and so do scene ids (`<chapter source>_S<n>`). Chapter references are covered by rules 12–13.

## Site smoke test

36. For each novel, open every tab and explorer and check for console errors, HTTP 4xx and "Не удалось…" text. `docs/schema-v2/snapshot.html` already does this, and it can diff the result against a previous recording.

## Suggested use

Run rules 1–26 as errors that block publishing a novel, and 27–35 as warnings.
