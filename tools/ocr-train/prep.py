"""Decodes images to raw RGBA for the tuning harness, which then preprocesses them with the site's
own code (src/ocr-prep.js). Pillow only decodes, applying an embedded colour profile (as the
browser does) so both see the same pixels.

    python tools/ocr-train/prep.py out_dir file1 file2 ...

Writes <out_dir>/<n>.rgba (width and height as two little-endian uint32s, then the pixels).
"""
import io, os, struct, sys
from PIL import Image, ImageCms

if __name__ == '__main__':
    out, files = sys.argv[1], sys.argv[2:]
    # --start N: number the outputs from N (for callers that send files in batches).
    start = 0
    if '--start' in files:
        i = files.index('--start')
        start = int(files[i + 1])
        files = files[:i] + files[i + 2:]
    os.makedirs(out, exist_ok=True)
    for n, f in enumerate(files, start):
        try:
            im = Image.open(f)
        except Exception:
            continue          # unreadable: the caller sees no output for it
        icc = im.info.get('icc_profile')
        if icc:
            try:
                src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
                im = ImageCms.profileToProfile(im.convert('RGB'), src, ImageCms.createProfile('sRGB'), outputMode='RGB')
            except Exception:
                pass
        im = im.convert('RGBA')
        with open(os.path.join(out, f'{n}.rgba'), 'wb') as fh:
            fh.write(struct.pack('<II', im.width, im.height))
            fh.write(im.tobytes())
