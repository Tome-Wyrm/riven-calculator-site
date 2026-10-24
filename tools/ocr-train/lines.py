"""Labelled text-line images for fine-tuning Tesseract (tesstrain's ground-truth format).

    node tools/ocr-train/specs.mjs 3000 7 > tools/ocr-train/out/train-specs.jsonl
    python tools/ocr-train/lines.py tools/ocr-train/out/train-specs.jsonl tools/ocr-train/out/gt [seed]

For each card: draw it (render.py), make it look like a screenshot (size, blur, colour, noise,
compression, sometimes a cursor), then cut out every text line and preprocess it the way the site
does before recognition (greyscale, scale up to a 2400 px wide card at most 4x, invert). Writes
<n>.png and <n>.gt.txt per line. Labels: the padlock is "#", the cycle arrow "@", damage-type
icons are left out.
"""
import io, json, os, random, sys
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
import render
from fuzz import cursor


def screenshot(im):
    """Card → screenshot-like image at a random size; returns (image, scale)."""
    s = random.choice([random.uniform(0.95, 1.3), random.uniform(1.3, 2.2), random.uniform(2.2, 3.2)])
    im = im.convert('RGB')
    if random.random() < 0.2:
        cursor(im)
    im = im.resize((round(im.width * s), round(im.height * s)), random.choice([Image.BILINEAR, Image.BICUBIC, Image.LANCZOS]))
    if random.random() < 0.7:
        im = im.filter(ImageFilter.GaussianBlur(random.uniform(0.2, 1.2) * s ** 0.5))
    im = ImageEnhance.Brightness(im).enhance(random.uniform(0.8, 1.2))
    im = ImageEnhance.Contrast(im).enhance(random.uniform(0.8, 1.25))
    im = ImageEnhance.Color(im).enhance(random.uniform(0.8, 1.3))
    if random.random() < 0.3:
        im = Image.blend(im, Image.effect_noise(im.size, random.uniform(5, 25)).convert('RGB'), random.uniform(0.03, 0.1))
    if random.random() < 0.6:
        buf = io.BytesIO()
        im.save(buf, random.choice(['JPEG', 'WEBP']), quality=random.randint(45, 92))
        im = Image.open(io.BytesIO(buf.getvalue())).convert('RGB')
    return im, s


def site_prep(line, card_width):
    """The site's preprocessing on a cut-out line: scale as the whole card would be, grey, invert."""
    f = max(1.0, min(4.0, 2400 / card_width))
    line = line.resize((max(1, round(line.width * f)), max(1, round(line.height * f))), Image.BICUBIC)
    return ImageOps.invert(line.convert('L'))


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    random.seed(int(sys.argv[3]) if len(sys.argv) > 3 else None)
    os.makedirs(out, exist_ok=True)
    n = 0
    with open(src) as fh:
        for raw in fh:
            spec = json.loads(raw)
            card = render.card(spec, random.choice(['Regular', 'Regular', 'Regular', 'Medium']))
            shot, s = screenshot(card)
            for label, (x0, y0, x1, y1) in card.info['lines']:
                j = lambda: random.uniform(-2, 3) * s       # loose, uneven crops, like Tesseract's own
                box = (max(0, round(x0 * s + j())), max(0, round(y0 * s + j())),
                       min(shot.width, round(x1 * s - j())), min(shot.height, round(y1 * s - j())))
                if box[2] - box[0] < 8 or box[3] - box[1] < 6:
                    continue
                site_prep(shot.crop(box), shot.width).save(os.path.join(out, f'{n}.png'))
                with open(os.path.join(out, f'{n}.gt.txt'), 'w', encoding='utf-8') as g:
                    g.write(label + '\n')
                n += 1
    print('lines', n)
