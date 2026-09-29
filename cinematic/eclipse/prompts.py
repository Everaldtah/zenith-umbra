"""Keyframe + motion prompts for the Seedance web tools -> work/prompts.json (id, refs, prompt, motion)."""
import json, os
from script import S, CHAR, REF, STYLE, MOTION_STYLE

# the editor takes two reference images: the two characters that carry the shot (the first-named lead)
PRIORITY = ["tenkai", "haruto", "mirei", "mirei_child", "nocturne", "nocturne_before", "kaien", "kagemaru", "kagemaru_young",
            "raijin", "enra", "yuzu", "brother", "hex", "vorn", "gorgoth", "qelvaris", "hammer"]
out = []
for sid, secs, kind, chars, key, cam, lines, cue in S:
    if kind == "card": continue
    lead = chars[:2] if len(chars) <= 2 else sorted(chars, key=lambda c: (c not in chars[:1], PRIORITY.index(c)))[:2]
    refs = []
    for c in lead:
        r = REF[c]
        if r not in refs: refs.append(r)
    who = "; ".join(CHAR[c] for c in chars)
    if refs:
        p = (f"Use the character designs from the reference image{'s' if len(refs) > 1 else ''} exactly (same faces, hair, costumes, "
             f"colors). Characters: {who}. Scene: {key}. Style: {STYLE}.")
    else:
        refs = ["style"]
        p = f"Use only the art style and color treatment of the reference image, not its content. Scene: {key}. Style: {STYLE}."
    out.append({"id": sid, "kind": kind, "refs": refs, "prompt": p,
                "motion": (f"{cam}. {MOTION_STYLE}." if kind == "motion" else "")})
os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "work"), exist_ok=True)
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "work", "prompts.json"), "w"), indent=1)
print(len(out), "keyframes;", sum(1 for o in out if o["kind"] == "motion"), "motion; refs used:", sorted({r for o in out for r in o["refs"]}))
