"""Makes clean synthetic cards look like real screenshots: random size, blur, compression, colour
shifts, a slight tilt, a mouse cursor, noise, and varying crops.

    python tools/ocr-train/fuzz.py tools/ocr-train/out/cards tools/ocr-train/out/fuzzed [copies] [seed]

Each card.png becomes <n>-<k>.png (k = 0..copies-1); its card.json is copied alongside as the answer.
"""
import io, json, os, random, shutil, sys
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


def cursor(im):
    """A white arrow cursor with a dark outline somewhere over the card (often over the text)."""
    s = random.randint(14, 26)
    x = random.randint(0, im.width - s)
    y = random.randint(im.height // 3, im.height - s)
    pts = [(0, 0), (0, s), (s * 0.28, s * 0.75), (s * 0.5, s * 1.1), (s * 0.62, s * 1.0), (s * 0.42, s * 0.68), (s * 0.75, s * 0.68)]
    pts = [(x + px, y + py) for px, py in pts]
    d = ImageDraw.Draw(im)
    d.polygon(pts, fill=(250, 250, 250), outline=(20, 20, 20))


def fuzz(im):
    im = im.convert('RGB')
    # Crop: tight on the card, or with more of the scene around it.
    if random.random() < 0.6:
        m = random.randint(0, 12)
        im = im.crop((m, m, im.width - random.randint(0, 12), im.height - random.randint(0, 12)))
    # Tilt / phone photo of a screen.
    if random.random() < 0.15:
        im = im.rotate(random.uniform(-3, 3), resample=Image.BICUBIC, expand=True, fillcolor=(10, 8, 14))
    if random.random() < 0.25:
        cursor(im)
    # Size: real captures range from tiny crops to 4K screens.
    scale = random.choice([random.uniform(0.9, 1.1), random.uniform(1.0, 2.2), random.uniform(1.2, 3.0)])   # real captures: ~300 px to 4K
    im = im.resize((max(40, round(im.width * scale)), max(40, round(im.height * scale))),
                   random.choice([Image.BILINEAR, Image.BICUBIC, Image.LANCZOS, Image.NEAREST]))
    if random.random() < 0.7:
        im = im.filter(ImageFilter.GaussianBlur(random.uniform(0.2, 1.4)))
    im = ImageEnhance.Brightness(im).enhance(random.uniform(0.8, 1.2))
    im = ImageEnhance.Contrast(im).enhance(random.uniform(0.8, 1.25))
    im = ImageEnhance.Color(im).enhance(random.uniform(0.8, 1.3))
    if random.random() < 0.3:
        noise = Image.effect_noise(im.size, random.uniform(5, 25)).convert('RGB')
        im = Image.blend(im, noise, random.uniform(0.03, 0.1))
    # Compression: JPEG (phone, Discord, Steam) or WebP at varying quality.
    if random.random() < 0.6:
        buf = io.BytesIO()
        im.save(buf, random.choice(['JPEG', 'WEBP']), quality=random.randint(45, 92))
        im = Image.open(io.BytesIO(buf.getvalue())).convert('RGB')
    return im


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    copies = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    random.seed(int(sys.argv[4]) if len(sys.argv) > 4 else None)
    os.makedirs(out, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(src)):
        if not f.endswith('.png'):
            continue
        base = f[:-4]
        card = Image.open(os.path.join(src, f))
        for k in range(copies):
            fuzz(card).save(os.path.join(out, f'{base}-{k}.png'))
            shutil.copy(os.path.join(src, base + '.json'), os.path.join(out, f'{base}-{k}.json'))
            n += 1
    print('fuzzed', n)
