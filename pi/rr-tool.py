#!/usr/bin/env python3
# © 2026 Roy Borkin. All rights reserved. See LICENSE.
"""Small helpers for the Round Remote Pi setup (no extra packages needed).

  rr-tool.py edid [--out FILE] [--timings "720 0 40 40 200 720 0 24 4 12 0 0 0 78 0 59400000 0"] [--name RoundRemote]
      Writes a 128-byte EDID with one exact mode, for panels that don't report a usable one. Used with
      drm.edid_firmware=HDMI-A-1:edid/<file> in cmdline.txt (pi/install.sh --display-mode=edid). The default
      timings are Waveshare's for the 4inch 720x720 HDMI round LCD (its legacy hdmi_timings line).
  rr-tool.py decode-edid FILE          prints the mode stored in an EDID (to check one)
  rr-tool.py cursor-theme DIR          writes an invisible Xcursor theme (the kiosk hides the pointer with it)
  rr-tool.py cursor-path DIR           a cursor search path for the kiosk: DIR/roundremote-hidden + DIR/default (the
      same invisible theme under the name "default", which cage 0.1.x and Chromium load when no theme is named)
  rr-tool.py has-mouse [--devices /proc/bus/input/devices]
      exit 0 (and print its name) when a real mouse / trackpad is plugged in — not the extra "mouse" interface many
      USB touch panels have — so the kiosk can leave the pointer visible for it
  rr-tool.py wait-input [--root /]     waits for any touch/key/mouse event on /dev/input/event*, prints the
      device and exits 0 (the bridge uses it to wake the screen while the HDMI output is off)
"""
import argparse
import glob
import os
import select
import struct
import sys

WAVESHARE_4_HDMI = '720 0 40 40 200 720 0 24 4 12 0 0 0 78 0 59400000 0'


def make_edid(timings, name='RoundRemote', size_mm=(100, 100)):
    t = [int(x) for x in timings.split()]
    if len(t) < 16:
        raise SystemExit('hdmi_timings needs 17 numbers')
    ha, hpol, hfp, hsync, hbp, va, vpol, vfp, vsync, vbp = t[:10]
    pclk = t[15]
    hbl, vbl = hfp + hsync + hbp, vfp + vsync + vbp
    refresh = pclk / float((ha + hbl) * (va + vbl))
    e = bytearray(128)
    e[0:8] = b'\x00\xff\xff\xff\xff\xff\xff\x00'
    mid = ((ord('R') - 64) << 10) | ((ord('R') - 64) << 5) | (ord('D') - 64)   # "RRD"
    e[8:10] = struct.pack('>H', mid)
    e[10:12] = struct.pack('<H', 0x0720)
    e[16], e[17] = 1, 35          # week 1, 2025
    e[18], e[19] = 1, 3           # EDID 1.3
    e[20] = 0x80                  # digital input
    e[21], e[22] = size_mm[0] // 10, size_mm[1] // 10
    e[23] = 120                   # gamma 2.2
    e[24] = 0x0A                  # RGB colour, preferred timing in the first descriptor
    e[25:35] = bytes([0xEE, 0x91, 0xA3, 0x54, 0x4C, 0x99, 0x26, 0x0F, 0x50, 0x54])   # sRGB-ish chromaticity
    for i in range(38, 54, 2):
        e[i], e[i + 1] = 0x01, 0x01                       # no standard timings
    d = bytearray(18)
    d[0:2] = struct.pack('<H', pclk // 10000)
    d[2], d[3], d[4] = ha & 0xFF, hbl & 0xFF, ((ha >> 8) << 4) | (hbl >> 8)
    d[5], d[6], d[7] = va & 0xFF, vbl & 0xFF, ((va >> 8) << 4) | (vbl >> 8)
    d[8], d[9] = hfp & 0xFF, hsync & 0xFF
    d[10] = ((vfp & 0xF) << 4) | (vsync & 0xF)
    d[11] = (((hfp >> 8) & 3) << 6) | (((hsync >> 8) & 3) << 4) | (((vfp >> 4) & 3) << 2) | ((vsync >> 4) & 3)
    d[12], d[13], d[14] = size_mm[0] & 0xFF, size_mm[1] & 0xFF, ((size_mm[0] >> 8) << 4) | (size_mm[1] >> 8)
    d[17] = 0x18 | (0x04 if vpol else 0) | (0x02 if hpol else 0)   # digital separate sync
    e[54:72] = d
    nm = (name.encode('ascii', 'replace')[:13] + b'\n').ljust(13, b' ')[:13]
    e[72:90] = b'\x00\x00\x00\xfc\x00' + nm
    vmin, vmax = max(1, int(refresh) - 10), int(refresh) + 10
    hk = int(pclk / (ha + hbl) / 1000)
    e[90:108] = b'\x00\x00\x00\xfd\x00' + bytes([vmin, vmax, max(1, hk - 10), hk + 10, max(1, pclk // 10000000 + 1), 0x00, 0x0A]) + b'\x20' * 6
    e[108:126] = b'\x00\x00\x00\x10\x00' + b'\x00' * 13
    e[126] = 0
    e[127] = (256 - sum(e[:127]) % 256) % 256
    return bytes(e)


def decode_edid(data):
    if len(data) < 128 or data[:8] != b'\x00\xff\xff\xff\xff\xff\xff\x00':
        raise SystemExit('not an EDID')
    if sum(data[:128]) % 256:
        raise SystemExit('bad checksum')
    d = data[54:72]
    pclk = struct.unpack('<H', d[0:2])[0] * 10000
    ha = d[2] | ((d[4] >> 4) << 8)
    hbl = d[3] | ((d[4] & 0xF) << 8)
    va = d[5] | ((d[7] >> 4) << 8)
    vbl = d[6] | ((d[7] & 0xF) << 8)
    hfp = d[8] | (((d[11] >> 6) & 3) << 8)
    hsync = d[9] | (((d[11] >> 4) & 3) << 8)
    vfp = (d[10] >> 4) | (((d[11] >> 2) & 3) << 4)
    vsync = (d[10] & 0xF) | ((d[11] & 3) << 4)
    hz = pclk / float((ha + hbl) * (va + vbl))
    return {'width': ha, 'height': va, 'pixelClock': pclk, 'hfront': hfp, 'hsync': hsync, 'hback': hbl - hfp - hsync,
            'vfront': vfp, 'vsync': vsync, 'vback': vbl - vfp - vsync, 'refresh': round(hz, 2)}


def xcursor_blank():
    """A 1x1 fully transparent Xcursor image."""
    header = struct.pack('<4sIII', b'Xcur', 16, 0x10000, 1)
    toc = struct.pack('<III', 0xFFFD0002, 1, 16 + 12)
    image = struct.pack('<IIIIIIIII', 36, 0xFFFD0002, 1, 1, 1, 1, 0, 0, 0) + struct.pack('<I', 0)
    return header + toc + image


CURSOR_NAMES = ['default', 'left_ptr', 'arrow', 'top_left_arrow', 'pointer', 'hand1', 'hand2', 'pointing_hand', 'text', 'xterm',
                'ibeam', 'crosshair', 'cross', 'grab', 'grabbing', 'move', 'fleur', 'wait', 'watch', 'progress', 'left_ptr_watch',
                'not-allowed', 'crossed_circle', 'help', 'question_arrow', 'col-resize', 'row-resize', 'n-resize', 's-resize',
                'e-resize', 'w-resize', 'ne-resize', 'nw-resize', 'se-resize', 'sw-resize', 'ew-resize', 'ns-resize',
                'nesw-resize', 'nwse-resize', 'sb_h_double_arrow', 'sb_v_double_arrow', 'context-menu', 'cell', 'copy', 'alias',
                'all-scroll', 'zoom-in', 'zoom-out', 'vertical-text', 'no-drop', 'dnd-none', 'dnd-move', 'dnd-copy', 'dnd-link']


def cursor_theme(d):
    cur = os.path.join(d, 'cursors')
    os.makedirs(cur, exist_ok=True)
    with open(os.path.join(cur, 'default'), 'wb') as f:
        f.write(xcursor_blank())
    for n in CURSOR_NAMES[1:]:
        p = os.path.join(cur, n)
        if os.path.lexists(p):
            os.remove(p)
        os.symlink('default', p)
    with open(os.path.join(d, 'index.theme'), 'w') as f:
        f.write('[Icon Theme]\nName=RoundRemote hidden cursor\nComment=Invisible pointer for the touch kiosk\n')


def cursor_path(d):
    cursor_theme(os.path.join(d, 'roundremote-hidden'))
    dflt = os.path.join(d, 'default')
    os.makedirs(dflt, exist_ok=True)
    link = os.path.join(dflt, 'cursors')
    if os.path.lexists(link) and not os.path.islink(link):
        import shutil
        shutil.rmtree(link)
    if not os.path.lexists(link):
        os.symlink('../roundremote-hidden/cursors', link)
    with open(os.path.join(dflt, 'index.theme'), 'w') as f:
        f.write('[Icon Theme]\nName=default\nComment=Round Remote kiosk: invisible pointer\nInherits=roundremote-hidden\n')


WORD_BITS = 64 if os.uname().machine in ('aarch64', 'arm64', 'x86_64', 'amd64', 'riscv64', 'ppc64le') else 32   # the kernel's long


def _bits(v):
    # a kernel bitmap as /proc/bus/input/devices prints it: longs in hex, most significant first, not zero-padded
    words = v.split()
    size = WORD_BITS
    n = 0
    for w in words:
        n = (n << size) | int(w, 16)
    return n


def input_devices(text):
    devs, cur = [], {}
    for line in text.splitlines() + ['']:
        line = line.strip()
        if not line:
            if cur:
                devs.append(cur)
            cur = {}
            continue
        if line.startswith('I:'):
            f = dict(x.split('=', 1) for x in line[2:].split() if '=' in x)
            cur['id'] = (f.get('Vendor', ''), f.get('Product', ''))
        elif line.startswith('N:'):
            cur['name'] = line[2:].strip().removeprefix('Name=').strip('"')
        elif line.startswith('B:'):
            k, _, v = line[2:].strip().partition('=')
            cur[k] = _bits(v)
    return devs


def real_mice(text):
    devs = input_devices(text)
    def touchy(d):
        return bool(d.get('PROP', 0) & 0x2) or bool(d.get('ABS', 0) & ((1 << 53) | (1 << 54))) or 'touch' in d.get('name', '').lower()
    touch_ids = {d.get('id') for d in devs if touchy(d)}
    out = []
    for d in devs:
        rel, ev, key = d.get('REL', 0), d.get('EV', 0), d.get('KEY', 0)
        if (rel & 3) == 3 and ev & 0x4 and key & (1 << 0x110) and not touchy(d) and d.get('id') not in touch_ids:
            out.append(d.get('name', '?'))
    return out


def wait_input(root):
    fds = {}
    for p in sorted(glob.glob(os.path.join(root, 'dev/input/event*'))):
        try:
            fds[os.open(p, os.O_RDONLY | os.O_NONBLOCK)] = p
        except OSError:
            pass
    if not fds:
        print('no readable input devices (add the user to the "input" group)', file=sys.stderr)
        return 2
    try:
        r, _, _ = select.select(list(fds), [], [])
        print(os.path.basename(fds[r[0]]))
        return 0
    finally:
        for fd in fds:
            os.close(fd)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    e = sub.add_parser('edid')
    e.add_argument('--out', default='-')
    e.add_argument('--timings', default=WAVESHARE_4_HDMI)
    e.add_argument('--name', default='RoundRemote')
    dd = sub.add_parser('decode-edid')
    dd.add_argument('file')
    c = sub.add_parser('cursor-theme')
    c.add_argument('dir')
    cp = sub.add_parser('cursor-path')
    cp.add_argument('dir')
    hm = sub.add_parser('has-mouse')
    hm.add_argument('--devices', default='/proc/bus/input/devices')
    w = sub.add_parser('wait-input')
    w.add_argument('--root', default='/')
    o = ap.parse_args()
    if o.cmd == 'edid':
        data = make_edid(o.timings, o.name)
        if o.out == '-':
            sys.stdout.buffer.write(data)
        else:
            with open(o.out, 'wb') as f:
                f.write(data)
        return 0
    if o.cmd == 'decode-edid':
        with open(o.file, 'rb') as f:
            print(decode_edid(f.read()))
        return 0
    if o.cmd == 'cursor-theme':
        cursor_theme(o.dir)
        return 0
    if o.cmd == 'cursor-path':
        cursor_path(o.dir)
        return 0
    if o.cmd == 'has-mouse':
        try:
            with open(o.devices) as f:
                mice = real_mice(f.read())
        except OSError:
            return 1
        for m in mice:
            print(m)
        return 0 if mice else 1
    if o.cmd == 'wait-input':
        return wait_input(o.root)
    return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
