"""Option B masks for sprite cutouts. One process, one loaded model."""

import os
import sys
from pathlib import Path

from PIL import Image
from rembg import new_session, remove

model = os.environ.get("REMBG_MODEL", "isnet-general-use").strip() or "isnet-general-use"
session = new_session(model)
args = sys.argv[1:]
if len(args) < 2 or len(args) % 2:
    raise SystemExit("usage: rembgMask.py input.png mask.png ...")
for index in range(0, len(args), 2):
    source = Image.open(args[index])
    source.load()
    mask = remove(source.convert("RGB"), session=session, only_mask=True)
    Path(args[index + 1]).parent.mkdir(parents=True, exist_ok=True)
    mask.save(args[index + 1])
