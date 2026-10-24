"""Draws riven cards from specs.mjs output, laid out like the in-game card.

    python tools/ocr-train/render.py tools/ocr-train/out/specs.jsonl tools/ocr-train/out/cards

Each card is <n>.png plus <n>.json (its spec, the answer). Frame parts are the wiki's riven mod
assets (tools/ocr-train/assets, git-ignored); text is Roboto. Art behind the title is a random crop
of the real screenshots in test/fixtures/local (or noise if there are none). This draws clean
cards; fuzz.py adds the blur, scaling and compression real screenshots have.
"""
import json, random, sys, glob, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
FONTS = os.path.join(HERE, 'fonts', 'roboto')
ROOT = os.path.dirname(os.path.dirname(HERE))

W, H = 300, 424                      # the card itself, in the proportions of a real one
TEXT = (190, 168, 236)               # lavender riven text
PANEL = (24, 22, 30)
BOTTOM = 350                         # baseline of the last text line


def asset(name, scale=1.0):
    im = Image.open(os.path.join(ASSETS, name + '.png')).convert('RGBA')
    return im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS) if scale != 1 else im


def font(weight, size):
    return ImageFont.truetype(os.path.join(FONTS, f'Roboto-{weight}.ttf'), size)


ART = glob.glob(os.path.join(ROOT, 'test', 'fixtures', 'local', 'x*.*'))


def art(size):
    """Something busy and colourful for the picture area."""
    w, h = size
    if ART and random.random() < 0.5:
        src = Image.open(random.choice(ART)).convert('RGB')
        # Only the middle of a card's picture, so no UI text (drain, title) comes along.
        cw, ch = max(20, src.width // 4), max(20, src.height // 7)
        x = random.randint(src.width * 3 // 10, src.width * 7 // 10 - cw)
        y = random.randint(src.height * 2 // 10, max(src.height * 2 // 10, src.height * 4 // 10 - ch))
        return src.crop((x, y, x + cw, y + ch)).resize(size, Image.BILINEAR)
    # Generated: soft colour blobs over noise, like out-of-focus game art.
    im = Image.effect_noise(size, 50).convert('RGB')
    d = ImageDraw.Draw(im)
    for _ in range(random.randint(4, 12)):
        x, y, r = random.randint(0, w), random.randint(0, h), random.randint(10, 90)
        d.ellipse((x - r, y - r, x + r, y + r), fill=tuple(random.randint(20, 230) for _ in range(3)))
    return im.filter(ImageFilter.GaussianBlur(random.uniform(2, 8)))


def hex_panel(size):
    """The dark text panel with its faint hexagon pattern."""
    w, h = size
    im = Image.new('RGB', size, PANEL)
    d = ImageDraw.Draw(im)
    r = 5
    for row, y in enumerate(range(0, h + 2 * r, int(r * 1.6))):
        for x in range(-r + (row % 2) * r, w + 2 * r, 2 * r):
            d.regular_polygon((x, y, r), 6, outline=(32, 30, 40))
    return im


def wrap(text, ft, width):
    """Wraps like the card: on spaces, or after a hyphen in the riven's name."""
    words, lines, cur = text.replace('-', '- ').split(' '), [], ''
    for w in words:
        trial = (cur + ('' if cur.endswith('-') or not cur else ' ') + w).strip()
        if ft.getlength(trial) <= width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return [l.replace('- ', '-') for l in lines]


def cycle_icon(d, x, y, s, colour):
    """The circular arrow before the cycle count."""
    d.arc((x, y, x + s, y + s), 40, 320, fill=colour, width=2)
    d.polygon([(x + s * 0.85, y - 1), (x + s * 1.05, y + s * 0.35), (x + s * 0.6, y + s * 0.3)], fill=colour)


def polarity(d, x, y, s, colour):
    """A stand-in polarity mark (the real ones vary; this is just something there)."""
    kind = random.randint(0, 2)
    if kind == 0:
        d.line((x, y + s, x + s, y + s // 3), fill=colour, width=2); d.line((x, y + s // 2, x + s, y + s // 2), fill=colour, width=2)
    elif kind == 1:
        d.polygon([(x, y), (x + s, y), (x + s / 2, y + s)], outline=colour, width=2)
    else:
        d.line((x, y + s // 2, x + s, y + s // 2), fill=colour, width=2); d.line((x + s - 4, y + s // 2 - 4, x + s, y + s // 2), fill=colour, width=2)


def padlock(d, x, y, s, colour):
    """A small padlock, drawn before a locked stat."""
    d.rounded_rectangle((x, y + s * 0.45, x + s * 0.8, y + s), radius=1, fill=colour)
    d.arc((x + s * 0.15, y + s * 0.05, x + s * 0.65, y + s * 0.7), 180, 360, fill=colour, width=max(1, int(s * 0.12)))


def card(spec, weight='Medium'):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    im.paste(art((W - 24, 250)), (12, 22))
    title_ft, stat_ft = font(weight, 25), font(weight, 20)

    # Text, laid out bottom-up from just above the tab, as the game does.
    lines = []                                            # (text, font, locked)
    for t in wrap(spec['title'], title_ft, W - 72):
        lines.append((t, title_ft, False))
    for s in spec['stats']:
        for i, t in enumerate(wrap(s['text'], stat_ft, W - 72)):
            lines.append((t, stat_ft, s['locked'] and i == 0))
    pitch = lambda ft: 28 if ft is title_ft else 23
    top = BOTTOM - sum(pitch(ft) for _, ft, _ in lines) + 6
    panel_top = min(top - 10, 262)
    im.paste(hex_panel((W - 24, H - panel_top - 40)), (12, panel_top))

    text = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(text)
    y = top
    for t, ft, locked in lines:
        y += pitch(ft)
        tw = ft.getlength(t) + (16 if locked else 0)
        x = (W - tw) / 2
        if locked:
            padlock(d, x, y - 15, 13, TEXT)
            x += 16
        d.text((x, y), t, font=ft, fill=TEXT, anchor='ls')
    glow = text.filter(ImageFilter.GaussianBlur(2))
    im.alpha_composite(glow)
    im.alpha_composite(text)

    # Frame parts: top (with the riven symbol), bottom, side lights, the drain backer, the tab.
    top_f = asset('RivenFrameTop', W / 281)
    im.alpha_composite(top_f, (0, 0))
    bot = asset('RivenFrameBottom', W / 292)
    im.alpha_composite(bot, (0, H - bot.height))
    side = asset('RivenSideLight', 1.0).resize((10, 200))
    im.alpha_composite(side, (2, 140))
    im.alpha_composite(side.transpose(Image.FLIP_LEFT_RIGHT), (W - 12, 140))
    tab = asset('RivenLowerTab', 1.25)
    tx, ty = (W - tab.width) // 2, H - 50
    im.alpha_composite(tab, (tx, ty))
    d = ImageDraw.Draw(im)
    mr_ft = font('Bold', 18)
    if spec['cycles']:
        d.text((tx + 22, ty + 17), f"MR {spec['mr']}", font=mr_ft, fill=(220, 210, 245), anchor='lm')
        cx = tx + tab.width - 22
        d.text((cx, ty + 17), f"{spec['cycles']}", font=mr_ft, fill=(220, 210, 245), anchor='rm')
        w = mr_ft.getlength(f"{spec['cycles']}")
        cycle_icon(d, cx - w - 20, ty + 9, 15, (220, 210, 245))
    else:
        d.text((W / 2, ty + 17), f"MR {spec['mr']}", font=mr_ft, fill=(220, 210, 245), anchor='mm')
    backer = asset('RivenTopRightBacker', 1.35)
    bx, by = W - backer.width - 14, 30
    im.alpha_composite(backer, (bx, by))
    d.text((bx + 10, by + backer.height / 2), f"{spec['drain']}", font=font('Bold', 20), fill=(225, 215, 245), anchor='lm')
    polarity(d, bx + backer.width - 18, by + 8, 11, (225, 215, 245))
    return im


def scene(cardim):
    """The card on a purple background with some margin, like an in-game capture."""
    pad = 14
    bg = Image.new('RGBA', (cardim.width + 2 * pad, cardim.height + 2 * pad), (120, 70, 190, 255))
    shade = Image.effect_noise(bg.size, 40).convert('L').filter(ImageFilter.GaussianBlur(12))
    bg = Image.composite(bg, Image.new('RGBA', bg.size, (60, 30, 110, 255)), shade)
    bg.alpha_composite(cardim, (pad, pad))
    return bg.convert('RGB')


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    with open(src) as f:
        for n, raw in enumerate(f):
            spec = json.loads(raw)
            scene(card(spec, random.choice(['Regular', 'Medium', 'Medium', 'Bold']))).save(os.path.join(out, f'{n}.png'))
            with open(os.path.join(out, f'{n}.json'), 'w') as j:
                json.dump(spec, j)
    print('rendered', n + 1)
