"""Damage numbers from a Warframe clip, for checking the model against the game.

  python tools/read-clip.py clip.mp4 [--fps 6] [--json out.json]

Reads a recorded clip, never the game. Damage text is picked out by colour (white hits, yellow and
orange crits), cut into digit-shaped pieces (which drops commas and damage type icons), and each run
of pieces is read by Tesseract, kept only if it reads as that many digits. A number that stays put
through much of the clip is the HUD, not a hit, and a number that's a piece of a commoner one is a
misread of it: both are left out.

"Sightings" count frames, and a number stays up for about a second. So they're no count of hits, but
their shares are a fair estimate of how often each number comes up: Boar Prime's beam at Multishot 6.3
showed its x7 ticks in 256 of 834 sightings (30.7%, against the 30% expected). Checked on three clips
against numbers read by eye: every one found (50 of 50), with a few fragments seen once or twice.

Needs opencv-python, numpy and Tesseract (on the PATH, in its default folder, or in TESSERACT).
"""
import argparse
import json
import os
import shutil
import subprocess
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

TESSERACT = (os.environ.get('TESSERACT') or shutil.which('tesseract')
             or r'C:\Program Files\Tesseract-OCR\tesseract.exe')
COLOURS = ('white', 'yellow', 'orange')
# A number in the same spot (to the nearest CELL pixels) in more than this share of the frames isn't a hit.
PERSISTENT = 0.3
CELL = 24


def masks(frame):
    """Each colour of damage text, with the fixed panels blanked."""
    b, g, r = [frame[:, :, i].astype(np.int16) for i in range(3)]
    found = {
        'white': (r > 190) & (g > 190) & (b > 190) & (abs(r - g) < 26) & (abs(g - b) < 26),
        'yellow': (r > 170) & (g > 170) & (b < 110),
        'orange': (r > 190) & (g > 70) & (g < 150) & (b < 80),
    }
    h, w = frame.shape[:2]
    for m in found.values():
        m[: int(h * 0.11), int(w * 0.75):] = False     # the frame's health and abilities
        m[int(h * 0.76):, int(w * 0.78):] = False      # ammo
        m[int(h * 0.975):, :] = False                  # a frame rate line
        m[: int(h * 0.24), : int(w * 0.14)] = False    # the minimap
    return found


def runs(mask):
    """Runs of digit-shaped pieces along a line, as lists of (x, y, w, h, label)."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    parts = []
    for i in range(1, n):
        x, y, w, h, area = (int(v) for v in stats[i])
        if 9 <= h <= 48 and 2 <= w <= h and area >= 0.18 * w * h:
            parts.append((x, y, w, h, i))
    parts.sort()
    used, found = set(), []
    for k, (x, y, w, h, i) in enumerate(parts):
        if i in used:
            continue
        run = [parts[k]]
        for q in parts[k + 1:]:
            lx, _, lw, _, _ = run[-1]
            if q[4] in used or abs(q[3] - h) > 0.22 * h or abs(q[1] - y) > 0.25 * h:
                continue
            if q[0] - (lx + lw) > 0.95 * h:
                break
            run.append(q)
        if 2 <= len(run) <= 6 and run[-1][2] > 0.8 * h:
            run.pop()                                  # a wide last piece: the damage type's icon, whole
        if 2 <= len(run) <= 6:
            used.update(q[4] for q in run)
            found.append(run)
    return labels, found


def read_digits(image, count):
    """The number in an image of `count` digits, or None if Tesseract sees anything else."""
    fd, path = tempfile.mkstemp(suffix='.png')
    os.close(fd)
    try:
        cv2.imwrite(path, image)
        out = subprocess.run([TESSERACT, path, 'stdout', '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789'],
                             capture_output=True, text=True).stdout
    finally:
        os.remove(path)
    text = ''.join(ch for ch in out if ch.isdigit())
    return int(text) if len(text) == count else None


def read_mask(mask):
    """The numbers in one colour of one frame, as (value, x, y)."""
    labels, found = runs(mask)
    numbers = []
    for run in found:
        x0, y0 = min(q[0] for q in run), min(q[1] for q in run)
        x1, y1 = max(q[0] + q[2] for q in run), max(q[1] + q[3] for q in run)
        piece = np.isin(labels[y0:y1, x0:x1], [q[4] for q in run])
        image = np.where(piece, 0, 255).astype(np.uint8)
        scale = 40 / max(1, y1 - y0)
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        image = cv2.copyMakeBorder(image, 14, 14, 14, 14, cv2.BORDER_CONSTANT, value=255)
        value = read_digits(image, len(run))
        if value is not None:
            numbers.append((value, x0, y0))
    return numbers


def read_clip(path, fps):
    """Every number seen, as dicts of value, colour, time, x and y, and the frames read."""
    clip = cv2.VideoCapture(path)
    if not clip.isOpened():
        raise SystemExit(f"Can't open {path}")
    native = clip.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, round(native / fps))
    jobs, i = [], 0
    while True:
        ok, frame = clip.read()
        if not ok:
            break
        if i % step == 0:
            jobs += [(i / native, colour, m) for colour, m in masks(frame).items()]
        i += 1
    with ThreadPoolExecutor(os.cpu_count() or 4) as pool:
        results = list(pool.map(lambda job: read_mask(job[2]), jobs))
    sightings = [{'value': v, 'colour': c, 'time': round(t, 3), 'x': x, 'y': y}
                 for (t, c, _), numbers in zip(jobs, results) for v, x, y in numbers]
    return sightings, len(jobs) // len(COLOURS)


def only_hits(sightings, frames):
    """Without the HUD and misread pieces, and the HUD's numbers."""
    spots = {}
    for s in sightings:
        key = (s['value'], s['colour'], s['x'] // CELL, s['y'] // CELL)
        spots.setdefault(key, set()).add(s['time'])
    hud = {k[:2] for k, times in spots.items() if len(times) > PERSISTENT * frames}
    hits = [s for s in sightings if (s['value'], s['colour']) not in hud]
    seen = Counter((s['value'], s['colour']) for s in hits)
    pieces = {(v, c) for v, c in seen
              if any(c == c2 and v != v2 and str(v) in str(v2) and n2 >= seen[(v, c)] for (v2, c2), n2 in seen.items())}
    return [s for s in hits if (s['value'], s['colour']) not in pieces], hud


def main():
    parser = argparse.ArgumentParser(description='Damage numbers from a Warframe clip.')
    parser.add_argument('clip')
    parser.add_argument('--fps', type=float, default=6, help='frames read a second (default 6)')
    parser.add_argument('--json', help='also write every sighting to this file')
    args = parser.parse_args()
    sightings, frames = read_clip(args.clip, args.fps)
    hits, hud = only_hits(sightings, frames)
    print(f'{frames} frames, {len(hits)} sightings'
          + (f" (left out as HUD: {', '.join(str(v) for v, _ in sorted(hud))})" if hud else ''))
    for colour in COLOURS:
        seen = Counter(s['value'] for s in hits if s['colour'] == colour)
        kept = [(v, n) for v, n in seen.most_common() if n >= 2]
        total = sum(n for _, n in kept)
        if kept:
            print(f'\n{colour}:')
            for v, n in kept[:24]:
                print(f'  {v:>8,}  {n:>4}  {100 * n / total:4.0f}%')
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as out:
            json.dump(hits, out)


if __name__ == '__main__':
    main()
