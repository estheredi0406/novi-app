"""Makes a machine Ewe voice for Novi's key sentences, on your own laptop.

The voice is Meta's MMS text-to-speech model for Ewe (facebook/mms-tts-ewe),
free and run offline once downloaded. Its licence (CC BY-NC 4.0) allows the
capstone and the demo, not commercial use: for a real pilot, replace the
clips with recordings by a speaker, in the voice studio.

What it does: reads the Ewe sentences in src/i18n/ee.json (the ones you
wrote or checked), and writes one .wav per sentence into
assets/voice/ee/machine/. Nothing reaches the app yet: you listen to each
clip in the voice studio (npm run voice:studio) and keep the ones that sound
right, or record your own voice instead.

Sentences with {{name}}, {{amount}} or another {{...}} word are skipped: the
voice cannot know the name or the amount in advance, so the app shows it
on screen.

First time only (about 1 GB to download):
    py -m pip install torch transformers scipy
Then, from apps/mobile:
    py scripts/ewe_voice.py
To try Claude's drafts before they are checked (on your laptop only):
    py scripts/ewe_voice.py --brouillon
"""

import csv
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MOBILE = HERE.parent
EE_JSON = MOBILE / "src" / "i18n" / "ee.json"
SHEET = MOBILE.parent.parent / "docs" / "ewe" / "key-sentences.csv"
OUT = MOBILE / "assets" / "voice" / "ee" / "machine"
MODEL = "facebook/mms-tts-ewe"


def lookup(tree, key):
    node = tree
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node if isinstance(node, str) else None


def sentences(use_drafts):
    """The key sentences of the sheet, with their Ewe text."""
    ee = json.loads(EE_JSON.read_text(encoding="utf-8"))
    rows = list(csv.DictReader(SHEET.open(encoding="utf-8-sig")))
    found = []
    for row in rows:
        key = (row.get("key") or "").strip()
        if not key:
            continue
        text = lookup(ee, key) or (row.get("eʋegbe") or "").strip()
        if not text and use_drafts:
            text = (row.get("brouillon_claude") or "").strip()
        if text:
            found.append((key, text))
    return found


def main():
    use_drafts = "--brouillon" in sys.argv
    todo = sentences(use_drafts)
    if not todo:
        print("No Ewe sentence yet. Fill the eʋegbe column, run node scripts/importEwe.mjs, then try again.")
        print("(Or add --brouillon to hear Claude's drafts.)")
        return 1

    try:
        import numpy as np
        import torch
        from scipy.io import wavfile
        from transformers import AutoTokenizer, VitsModel
    except ImportError:
        print("Install the tools first:  py -m pip install torch transformers scipy")
        return 1

    print(f"Loading the Ewe voice ({MODEL}). The first time, this downloads it.")
    tokenizer = AutoTokenizer.from_pretrained(MODEL)
    model = VitsModel.from_pretrained(MODEL)
    model.eval()
    torch.manual_seed(7)  # the same sentence always sounds the same

    OUT.mkdir(parents=True, exist_ok=True)
    texts_path = OUT / "texts.json"
    texts = json.loads(texts_path.read_text(encoding="utf-8")) if texts_path.exists() else {}
    made = skipped = kept = 0

    for key, text in todo:
        if re.search(r"\{\{\w+\}\}", text):
            skipped += 1
            continue
        target = OUT / f"{key}.wav"
        if target.exists() and texts.get(key) == text:
            kept += 1
            continue
        inputs = tokenizer(text, return_tensors="pt")
        with torch.no_grad():
            wave = model(**inputs).waveform[0].numpy()
        # A little louder, never clipped, and a short silence at each end.
        peak = float(np.max(np.abs(wave))) or 1.0
        wave = np.concatenate([np.zeros(1600), wave / peak * 0.9, np.zeros(1600)])
        wavfile.write(target, model.config.sampling_rate, (wave * 32767).astype(np.int16))
        texts[key] = text
        made += 1
        print(f"  {key}: {text}")

    texts_path.write_text(json.dumps(texts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n{made} new clips, {kept} unchanged, {skipped} skipped (they contain a name or an amount).")
    print("Now listen to them:  npm run voice:studio")
    return 0


if __name__ == "__main__":
    sys.exit(main())
