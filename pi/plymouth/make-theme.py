#!/usr/bin/env python3
# © 2026 Roy Borkin. All rights reserved. See LICENSE.
"""Builds the images of the Round Remote boot splash (pi/plymouth/roundremote/) from logo/logo-white.svg.

Only needed when the logo or the geometry changes — the PNGs are committed. Needs Pillow (pip install pillow or
sudo apt install python3-pil). Run: python3 pi/plymouth/make-theme.py
The same geometry is used by the app's startup animation (index.html #rr-splash, pi/boot.html): a 720×720 frame
centred on the screen, the logo in a 288 px box (0.40 of the short side), a ring of radius 295.2 px (0.41), 4 px wide.
"""
import math
import os
import re
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit('needs Pillow: pip install pillow (or sudo apt install python3-pil)')

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'roundremote')
SVG = os.path.join(HERE, '..', '..', 'logo', 'logo-white.svg')
FRAME = 720          # design size (the round screen)
LOGO = 288           # logo box (the SVG's 774×774 view box scaled into it)
RING_R = 295.2       # ring radius (centre of the stroke)
RING_W = 4.0         # ring width
SEGMENTS = 90        # progress ring pieces (4° each)
SEG_BOX = 32         # each piece is drawn centred in a 32×32 image
TRACK_BOX = 600      # the track image (centred on the screen)
TRACK_ALPHA = 0.16   # the dim full ring under the progress
SS = 8               # supersampling


def polygons(svg_path):
    d = re.search(r' d="([^"]+)"', open(svg_path).read()).group(1)
    polys = []
    for sub in re.findall(r'M([^Z]+)Z', d):
        n = [float(x) for x in sub.split()]
        polys.append(list(zip(n[0::2], n[1::2])))
    return polys


def area(p):
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(p, p[1:] + p[:1])) / 2


def render_logo(size):
    polys = polygons(SVG)
    k = size * SS / 774.0
    # even-odd: a polygon inside another is a hole — draw the big ones first, holes (contained) after
    polys.sort(key=lambda p: -abs(area(p)))
    m = Image.new('L', (size * SS, size * SS), 0)
    dr = ImageDraw.Draw(m)
    drawn = []
    for p in polys:
        pts = [(x * k, y * k) for x, y in p]
        inside = sum(1 for q in drawn if point_in(p[0], q)) % 2 == 1
        dr.polygon(pts, fill=0 if inside else 255)
        drawn.append(p)
    m = m.resize((size, size), Image.LANCZOS)
    img = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    img.putalpha(m)
    return img


def point_in(pt, poly):
    x, y = pt
    c = False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c


def arc_mask(w, h, cx, cy, a0, a1, alpha=1.0):
    """An anti-aliased ring piece from angle a0 to a1 (degrees, 0 = 12 o'clock, clockwise)."""
    m = Image.new('L', (w * SS, h * SS), 0)
    dr = ImageDraw.Draw(m)
    ro, ri = (RING_R + RING_W / 2) * SS, (RING_R - RING_W / 2) * SS
    pts = []
    steps = max(4, int(abs(a1 - a0) * 4))
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        pts.append((cx * SS + ro * math.sin(a), cy * SS - ro * math.cos(a)))
    for i in range(steps, -1, -1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        pts.append((cx * SS + ri * math.sin(a), cy * SS - ri * math.cos(a)))
    dr.polygon(pts, fill=int(255 * alpha))
    m = m.resize((w, h), Image.LANCZOS)
    img = Image.new('RGBA', (w, h), (255, 255, 255, 0))
    img.putalpha(m)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    render_logo(LOGO).save(os.path.join(OUT, 'logo.png'), optimize=True)
    # the dim track: a full ring (drawn as pieces so the big polygon stays exact)
    t = TRACK_BOX
    track = Image.new('RGBA', (t, t), (255, 255, 255, 0))
    for i in range(36):
        track.alpha_composite(arc_mask(t, t, t / 2, t / 2, i * 10 - 0.5, (i + 1) * 10 + 0.5))
    track.putalpha(track.getchannel('A').point(lambda v: int(v * TRACK_ALPHA)))
    track.save(os.path.join(OUT, 'track.png'), optimize=True)
    step = 360.0 / SEGMENTS
    table = []
    for i in range(SEGMENTS):
        mid = math.radians((i + 0.5) * step)
        # whole-pixel offset of the piece's 32×32 image from the screen centre (Plymouth places sprites on whole
        # pixels); the piece is drawn at its exact place inside it. A little overlap hides the seams.
        ox = math.floor(RING_R * math.sin(mid) - SEG_BOX / 2)
        oy = math.floor(-RING_R * math.cos(mid) - SEG_BOX / 2)
        arc_mask(SEG_BOX, SEG_BOX, -ox, -oy, i * step - 0.35, (i + 1) * step + 0.35).save(os.path.join(OUT, 'seg-%02d.png' % i), optimize=True)
        table.append('seg_x[%d] = %d; seg_y[%d] = %d;' % (i, ox, i, oy))
    # the offsets go into the script, between its "generated" markers
    sp = os.path.join(OUT, 'roundremote.script')
    src = open(sp).read()
    a, b = src.index('// >>> generated'), src.index('// <<< generated')
    lines = [' '.join(table[j:j + 3]) for j in range(0, len(table), 3)]
    src = src[:a] + '// >>> generated by make-theme.py (segment image offsets from the centre, at 720 px)\n' + '\n'.join(lines) + '\n' + src[b:]
    open(sp, 'w').write(src)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
