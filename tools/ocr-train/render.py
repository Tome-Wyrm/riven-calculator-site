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
LOCKED = (214, 211, 220)             # a locked stat's line is light grey (its icon keeps its colour)
MATCHED = (120, 225, 95)             # drain and polarity when the polarity matches the slot
ICONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets', 'icons')
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


# Damage-type icons: rough stand-ins in each type's colour and shape (enough for OCR to see a
# coloured glyph between the value and the name, as on real cards).
ICON_COLOURS = {
    'heat': (240, 130, 40), 'cold': (120, 190, 240), 'toxin': (90, 200, 60), 'electricity': (190, 150, 255),
    'corrosive': (170, 200, 50), 'viral': (60, 200, 170), 'radiation': (230, 210, 60), 'magnetic': (80, 120, 230),
    'gas': (120, 200, 120), 'blast': (240, 160, 60), 'impact': (90, 200, 210), 'puncture': (230, 200, 90), 'slash': (220, 70, 60),
}


def paste_icon(im, name, x, y, s, colour=None):
    """Pastes one of the wiki's icons (assets/icons), recoloured if asked. False if it's missing."""
    path = os.path.join(ICONS, name + '.png')
    if not os.path.exists(path):
        return False
    icon = Image.open(path).convert('RGBA').resize((s, s), Image.LANCZOS)
    if colour:
        icon = Image.merge('RGBA', (*(Image.new('L', icon.size, c) for c in colour), icon.getchannel('A')))
    im.alpha_composite(icon, (round(x), round(y)))
    return True


def damage_icon(d, kind, x, y, s, im=None):
    if im is not None and paste_icon(im, kind, x, y - 1, s + 2):
        return
    c = ICON_COLOURS[kind]
    if kind in ('heat', 'blast'):
        d.polygon([(x + s / 2, y), (x + s, y + s * 0.7), (x + s / 2, y + s), (x, y + s * 0.7)], fill=c)
    elif kind == 'cold':
        for a, b in [((x, y + s / 2), (x + s, y + s / 2)), ((x + s * 0.2, y + s * 0.15), (x + s * 0.8, y + s * 0.85)), ((x + s * 0.8, y + s * 0.15), (x + s * 0.2, y + s * 0.85))]:
            d.line((a, b), fill=c, width=2)
    elif kind == 'electricity':
        d.polygon([(x + s * 0.6, y), (x + s * 0.2, y + s * 0.55), (x + s * 0.5, y + s * 0.55), (x + s * 0.35, y + s), (x + s * 0.8, y + s * 0.4), (x + s * 0.5, y + s * 0.4)], fill=c)
    elif kind in ('impact', 'puncture', 'slash'):
        d.line((x, y + s, x + s, y), fill=c, width=3)
        d.polygon([(x + s * 0.55, y), (x + s, y), (x + s, y + s * 0.45)], fill=c)
    else:
        d.ellipse((x, y, x + s, y + s), fill=c)
        d.ellipse((x + s * 0.25, y + s * 0.3, x + s * 0.45, y + s * 0.5), fill=PANEL)
        d.ellipse((x + s * 0.55, y + s * 0.3, x + s * 0.75, y + s * 0.5), fill=PANEL)


def padlock(d, x, y, s, colour):
    """A small padlock, drawn before a locked stat."""
    d.rounded_rectangle((x, y + s * 0.42, x + s * 0.8, y + s), radius=2, fill=colour)
    d.arc((x + s * 0.14, y + s * 0.02, x + s * 0.66, y + s * 0.72), 180, 360, fill=colour, width=max(2, int(s * 0.16)))
    # keyhole
    d.ellipse((x + s * 0.32, y + s * 0.58, x + s * 0.48, y + s * 0.74), fill=PANEL)
    d.rectangle((x + s * 0.37, y + s * 0.7, x + s * 0.43, y + s * 0.86), fill=PANEL)


def card(spec, weight='Medium'):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    im.paste(art((W - 24, 250)), (12, 22))
    title_ft, stat_ft = font(weight, 25), font(weight, 20)

    # Text, laid out bottom-up from just above the tab, as the game does.
    lines = []                                            # (text, font, locked)
    for t in wrap(spec['title'], title_ft, W - 72):
        lines.append((t, title_ft, (False, None)))
    for s in spec['stats']:
        for i, t in enumerate(wrap(s['text'], stat_ft, W - 72)):
            lines.append((t, stat_ft, (s['locked'] and i == 0, s.get('icon') if i == 0 else None)))
    pitch = lambda ft: 28 if ft is title_ft else 23
    top = BOTTOM - sum(pitch(ft) for _, ft, _ in lines) + 6
    panel_top = min(top - 10, 262)
    im.paste(hex_panel((W - 24, H - panel_top - 40)), (12, panel_top))

    text = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(text)
    y = top
    icons_later = []                                     # drawn on the image after the text layer
    for t, ft, (locked, icon) in lines:
        y += pitch(ft)
        colour = LOCKED if locked else TEXT
        # The icon sits between the value and the name: "+101% [flame] Heat".
        value, _, rest = t.partition(' ') if icon else (t, '', '')
        tw = ft.getlength(t) + (17 if locked else 0) + (21 if icon else 0)
        x = (W - tw) / 2
        if locked:
            padlock(d, x, y - 16, 15, colour)
            x += 17
        if icon:
            d.text((x, y), value + ' ', font=ft, fill=colour, anchor='ls')
            x += ft.getlength(value + ' ')
            icons_later.append((icon, x, y - 17))
            x += 21
            d.text((x, y), rest, font=ft, fill=colour, anchor='ls')
        else:
            d.text((x, y), t, font=ft, fill=colour, anchor='ls')
    glow = text.filter(ImageFilter.GaussianBlur(2))
    im.alpha_composite(glow)
    im.alpha_composite(text)
    td = ImageDraw.Draw(im)
    for icon, x, y in icons_later:
        damage_icon(td, icon, x, y, 18, im)

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
    bx, by = W - backer.width - 16, 22
    im.alpha_composite(backer, (bx, by))
    matched = spec.get('matched')
    drain = round((spec['drain'] + 0.01) / 2) if matched else spec['drain']   # halved, rounding up
    c = MATCHED if matched else (225, 215, 245)
    # Digits then the polarity symbol, about as tall as the digits, right after them.
    dft = font('Bold', 20)
    tw = dft.getlength(f"{drain}")
    x0 = bx + backer.width / 2 - (tw + 24) / 2 + 4
    d.text((x0, by + backer.height / 2), f"{drain}", font=dft, fill=c, anchor='lm')
    if not paste_icon(im, 'pol-' + spec.get('polarity', 'madurai'), x0 + tw + 2, by + backer.height / 2 - 11, 22, c):
        polarity(d, x0 + tw + 4, by + 8, 14, c)
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
            scene(card(spec, random.choice(['Regular', 'Regular', 'Regular', 'Medium']))).save(os.path.join(out, f'{n}.png'))
            with open(os.path.join(out, f'{n}.json'), 'w') as j:
                json.dump(spec, j)
    print('rendered', n + 1)
