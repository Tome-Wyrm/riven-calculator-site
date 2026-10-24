"""Preprocessing for the tuning harness, the same steps the site does in the browser (src/ocr-read.js
prepare): scale up, then greyscale and invert. Options let the harness try other settings.

    python tools/ocr-train/prep.py out_dir width=2400 maxscale=4 invert=1 contrast=1.0 crop=0 file1 file2 ...

Writes <out_dir>/<n>.png for the n-th input file.
"""
import os, sys
from PIL import Image, ImageEnhance, ImageOps


def prep(path, width=2400, maxscale=4.0, invert=1, contrast=1.0, crop=0.0):
    im = Image.open(path).convert('RGB')
    if crop:
        # Keep the lower part of the card, where the text is.
        im = im.crop((0, round(im.height * crop), im.width, im.height))
    scale = max(1.0, min(maxscale, width / im.width))
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    g = im.convert('L')
    if contrast != 1.0:
        g = ImageEnhance.Contrast(g).enhance(contrast)
    return ImageOps.invert(g) if invert else g


if __name__ == '__main__':
    out = sys.argv[1]
    opts, files = {}, []
    for a in sys.argv[2:]:
        if '=' in a and not os.path.exists(a):
            k, v = a.split('=', 1)
            opts[k] = float(v)
        else:
            files.append(a)
    os.makedirs(out, exist_ok=True)
    for n, f in enumerate(files):
        prep(f, **opts).save(os.path.join(out, f'{n}.png'))
