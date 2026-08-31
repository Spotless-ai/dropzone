"""Optional independent reader check. Requires Pillow and generated QA fixtures.

First run check-metadata-codecs.mjs with its optional fixture output directory,
then pass that directory here. These are original synthetic test images only.
"""
from pathlib import Path
import sys
from PIL import Image, ImageOps

root = Path(sys.argv[1])
for kind in ("jpeg", "png", "webp"):
    for orientation in range(1, 9):
        with Image.open(root / f"{kind}-{orientation}-original.{kind}") as original:
            with Image.open(root / f"{kind}-{orientation}-edited.{kind}") as edited:
                original.load()
                edited.load()
                if kind == "png":
                    assert edited.info.get("Author") == "Zoë 東京", edited.info
                else:
                    assert edited.getexif().get(315) == "Test Writer", dict(edited.getexif())
                assert original.getexif().get(274, 1) == edited.getexif().get(274, 1)
                # The old descriptive tag is unrelated to the edited author.
                assert original.getexif().get(270) == edited.getexif().get(270)
                before = ImageOps.exif_transpose(original).convert("RGBA")
                after = ImageOps.exif_transpose(edited).convert("RGBA")
                assert before.size == after.size
                assert before.tobytes() == after.tobytes()
    print(f"{kind}: Pillow reads the edited author; original description, orientation and pixels preserved in all 8 cases.")
