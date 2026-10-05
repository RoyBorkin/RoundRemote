#!/usr/bin/env python3
# © 2026 Roy Borkin. All rights reserved. See LICENSE.
"""Round Remote motion-sensor helper (started by the bridge for GET /api/system/imu).

Finds an I2C IMU on the Pi (bus 1: SDA = GPIO2 / pin 3, SCL = GPIO3 / pin 5, 3.3 V, GND) and prints one JSON
line per sample (~20 Hz) on stdout:  {"roll": deg, "pitch": deg, "heading": deg?, "angle": deg?, "ts": ms}

Supported (auto-detected by address + ID register):
  MPU-6050 / 6500 / 9250 family  0x68 / 0x69   WHO_AM_I 0x75 = 0x68, 0x70, 0x71, 0x73, 0x74, 0x98, 0x12 …
  ICM-20948                      0x68 / 0x69   WHO_AM_I 0x00 = 0xEA (register bank 0)
  LSM6DS3 / LSM6DSL / LSM6DSOX   0x6A / 0x6B   WHO_AM_I 0x0F = 0x69, 0x6A, 0x6C, 0x6B
  BNO055                         0x28 / 0x29   CHIP_ID  0x00 = 0xA0 (fused; also gives a compass heading)

Angles (degrees, -180..180, positive = turned clockwise as seen from the front), from the low-pass-filtered
gravity vector (an accelerometer measures +1 g pointing *up*):
  roll  = atan2(-ax, ay)   sensor lying flat behind the screen (screen plane = sensor x-y)
  pitch = atan2(-az, ay)   sensor standing at a right angle to the screen (screen plane = sensor z-y)
  angle = only with --plane xy|yz|xz: the screen's turn for that mounting, plus --offset / --invert
A sample whose gravity is mostly out of the chosen plane (device lying flat) keeps the previous angle.

  python3 pi/imu.py --detect            → {"chip": "mpu6050", "address": 104, "bus": 1}  (or {"chip": null})
  python3 pi/imu.py [--hz 20] [--alpha 0.25] [--bus 1] [--address 0x68] [--chip auto] [--plane xy] [--offset 0]
Test without hardware: RR_IMU_FAKE=mpu6050@0x68 (or icm20948@0x69, lsm6ds3@0x6a, bno055@0x28) simulates a chip
whose screen turns slowly.
"""
import argparse
import json
import math
import os
import sys
import time

MPU_IDS = {0x68: 'mpu6050', 0x70: 'mpu6500', 0x71: 'mpu9250', 0x73: 'mpu9255', 0x74: 'mpu6515', 0x98: 'icm20689', 0x12: 'icm20602', 0x11: 'icm20600', 0x19: 'mpu6886'}
LSM_IDS = {0x69: 'lsm6ds3', 0x6A: 'lsm6dsl', 0x6C: 'lsm6dsox', 0x6B: 'lsm6dsr'}
CANDIDATES = [0x68, 0x69, 0x6A, 0x6B, 0x28, 0x29]


def open_bus(bus):
    fake = os.environ.get('RR_IMU_FAKE')
    if fake:
        return FakeBus(fake)
    try:
        from smbus2 import SMBus
    except ImportError:
        try:
            from smbus import SMBus  # python3-smbus (i2c-tools)
        except ImportError:
            raise SystemExit(emit_error('python3-smbus2 is not installed (sudo apt install python3-smbus2)', code=3))
    return SMBus(bus)


def emit(obj):
    sys.stdout.write(json.dumps(obj, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def emit_error(msg, code=2):
    emit({'error': msg})
    return code


def s16(hi, lo):
    v = (hi << 8) | lo
    return v - 0x10000 if v & 0x8000 else v


def rd(bus, addr, reg):
    try:
        return bus.read_byte_data(addr, reg)
    except OSError:
        return None


def identify(bus, addr):
    """The chip at addr, or None."""
    if addr in (0x68, 0x69):
        who = rd(bus, addr, 0x75)
        if who is None:
            return None
        if who in MPU_IDS:
            return MPU_IDS[who]
        if rd(bus, addr, 0x00) == 0xEA:   # ICM-20948 (register bank 0, its power-on default)
            return 'icm20948'
        return None   # nothing is written while probing: 0x68 may also be another chip (e.g. PiSugar 3's RTC)
    if addr in (0x6A, 0x6B):
        return LSM_IDS.get(rd(bus, addr, 0x0F))
    if addr in (0x28, 0x29):
        return 'bno055' if rd(bus, addr, 0x00) == 0xA0 else None
    return None


def detect(bus, address=None, chip=None):
    for a in ([address] if address else CANDIDATES):
        c = identify(bus, a)
        if c and (not chip or chip == 'auto' or c == chip or c.startswith(chip)):
            return c, a
    return None, None


class Sensor:
    def __init__(self, bus, addr, chip):
        self.bus, self.addr, self.chip = bus, addr, chip
        w = lambda reg, val: bus.write_byte_data(addr, reg, val)
        if chip == 'icm20948':
            w(0x7F, 0x00)       # REG_BANK_SEL: bank 0
            w(0x06, 0x01)       # PWR_MGMT_1: wake, auto clock
            w(0x07, 0x00)       # PWR_MGMT_2: accel + gyro on (accel ±2 g after reset)
            time.sleep(0.05)
        elif chip.startswith('lsm6'):
            w(0x12, 0x44)       # CTRL3_C: BDU + auto-increment
            w(0x10, 0x40)       # CTRL1_XL: 104 Hz, ±2 g
            time.sleep(0.05)
        elif chip == 'bno055':
            w(0x3D, 0x00)       # OPR_MODE: config
            time.sleep(0.03)
            w(0x07, 0x00)       # PAGE_ID 0
            w(0x3E, 0x00)       # PWR_MODE normal
            w(0x3B, 0x00)       # UNIT_SEL: m/s², degrees
            w(0x3D, 0x0C)       # OPR_MODE: NDOF (fusion)
            time.sleep(0.03)
        else:                   # MPU-6050 family
            w(0x6B, 0x00)       # PWR_MGMT_1: wake
            w(0x1C, 0x00)       # ACCEL_CONFIG: ±2 g
            w(0x1A, 0x03)       # CONFIG: DLPF ~44 Hz
            time.sleep(0.05)

    def read(self):
        """(ax, ay, az) in g, plus a heading in degrees (BNO055) or None."""
        b, a = self.bus, self.addr
        if self.chip == 'bno055':
            d = b.read_i2c_block_data(a, 0x2E, 6)   # gravity vector, 1 m/s² = 100 LSB, little-endian
            g = [s16(d[i + 1], d[i]) / 100.0 / 9.80665 for i in (0, 2, 4)]
            e = b.read_i2c_block_data(a, 0x1A, 2)   # Euler heading, 1° = 16 LSB
            return g[0], g[1], g[2], s16(e[1], e[0]) / 16.0
        if self.chip.startswith('lsm6'):
            d = b.read_i2c_block_data(a, 0x28, 6)   # little-endian, 0.061 mg/LSB at ±2 g
            return tuple(s16(d[i + 1], d[i]) * 0.000061 for i in (0, 2, 4)) + (None,)
        reg = 0x2D if self.chip == 'icm20948' else 0x3B
        d = b.read_i2c_block_data(a, reg, 6)        # big-endian, 16384 LSB/g at ±2 g
        return tuple(s16(d[i], d[i + 1]) / 16384.0 for i in (0, 2, 4)) + (None,)


def norm(deg):
    return ((deg + 180.0) % 360.0) - 180.0


def main():
    ap = argparse.ArgumentParser(description='Round Remote IMU helper')
    ap.add_argument('--bus', type=int, default=1)
    ap.add_argument('--address', type=lambda s: int(s, 0), default=None)
    ap.add_argument('--chip', default='auto')
    ap.add_argument('--hz', type=float, default=20.0)
    ap.add_argument('--alpha', type=float, default=0.25, help='low-pass factor per sample (0-1, smaller = smoother)')
    ap.add_argument('--plane', choices=['xy', 'yz', 'xz'], default=None)
    ap.add_argument('--offset', type=float, default=0.0)
    ap.add_argument('--invert', action='store_true')
    ap.add_argument('--swap-xy', action='store_true')
    ap.add_argument('--detect', action='store_true')
    ap.add_argument('--count', type=int, default=0, help='stop after N samples (tests)')
    o = ap.parse_args()

    try:
        bus = open_bus(o.bus)
    except (OSError, FileNotFoundError) as e:
        if o.detect:
            emit({'chip': None, 'error': str(e)})
            return 1
        return emit_error('I2C bus %d: %s (enable I2C: sudo raspi-config nonint do_i2c 0)' % (o.bus, e))
    chip, addr = detect(bus, o.address, o.chip)
    if o.detect:
        emit({'chip': chip, 'address': addr, 'bus': o.bus})
        return 0 if chip else 1
    if not chip:
        return emit_error('no motion sensor found on I2C bus %d' % o.bus)
    sensor = Sensor(bus, addr, chip)
    emit({'ready': True, 'chip': chip, 'address': addr})

    period = 1.0 / max(1.0, min(100.0, o.hz))
    alpha = max(0.01, min(1.0, o.alpha))
    f = None
    roll = pitch = angle = 0.0
    errors = n = 0
    nxt = time.monotonic()
    while True:
        try:
            ax, ay, az, heading = sensor.read()
            errors = 0
        except OSError as e:
            errors += 1
            if errors >= 20:
                return emit_error('sensor stopped answering: %s' % e)
            time.sleep(0.1)
            continue
        if o.swap_xy:
            ax, ay = ay, ax
        f = [ax, ay, az] if f is None else [f[0] + alpha * (ax - f[0]), f[1] + alpha * (ay - f[1]), f[2] + alpha * (az - f[2])]
        gx, gy, gz = f
        if math.hypot(gx, gy) > 0.35:
            roll = math.degrees(math.atan2(-gx, gy))
        if math.hypot(gz, gy) > 0.35:
            pitch = math.degrees(math.atan2(-gz, gy))
        out = {'roll': round(norm(roll), 2), 'pitch': round(norm(pitch), 2)}
        if o.plane:
            u, v = {'xy': (gx, gy), 'yz': (gz, gy), 'xz': (gx, gz)}[o.plane]
            if math.hypot(u, v) > 0.35:
                angle = math.degrees(math.atan2(-u, v))
            a = -angle if o.invert else angle
            out['angle'] = round(norm(a + o.offset), 2)
        if heading is not None:
            out['heading'] = round(heading % 360.0, 1)
        out['ts'] = int(time.time() * 1000)
        emit(out)
        n += 1
        if o.count and n >= o.count:
            return 0
        nxt += period
        delay = nxt - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        else:
            nxt = time.monotonic()


class FakeBus:
    """A pretend sensor for tests: RR_IMU_FAKE=chip@addr. Gravity turns 30°/s in the x-y plane."""
    def __init__(self, spec):
        chip, _, addr = spec.partition('@')
        self.chip, self.addr = chip, int(addr or '0x68', 0)
        self.t0 = time.monotonic()
        self.bank = 0

    def _g(self):
        th = math.radians((time.monotonic() - self.t0) * 30.0)
        return -math.sin(th), math.cos(th), 0.05   # device turned clockwise by th

    def read_byte_data(self, addr, reg):
        if addr != self.addr:
            raise OSError(121, 'Remote I/O error')
        c = self.chip
        if c == 'icm20948':
            return {0x00: 0xEA, 0x75: 0x00, 0x7F: self.bank << 4}.get(reg, 0)
        if c.startswith('lsm6'):
            return {0x0F: {'lsm6ds3': 0x69, 'lsm6dsl': 0x6A, 'lsm6dsox': 0x6C}.get(c, 0x69)}.get(reg, 0)
        if c == 'bno055':
            return {0x00: 0xA0}.get(reg, 0)
        return {0x75: {'mpu6050': 0x68, 'mpu6500': 0x70, 'mpu9250': 0x71}.get(c, 0x68)}.get(reg, 0)

    def write_byte_data(self, addr, reg, val):
        if addr != self.addr:
            raise OSError(121, 'Remote I/O error')
        if reg == 0x7F:
            self.bank = (val >> 4) & 3

    def read_i2c_block_data(self, addr, reg, n):
        if addr != self.addr:
            raise OSError(121, 'Remote I/O error')
        gx, gy, gz = self._g()
        c = self.chip
        if c == 'bno055':
            if reg == 0x1A:
                h = int(((time.monotonic() - self.t0) * 10 % 360) * 16)
                return [h & 0xFF, (h >> 8) & 0xFF]
            vals = [int(v * 9.80665 * 100) & 0xFFFF for v in (gx, gy, gz)]
            return [b for v in vals for b in (v & 0xFF, v >> 8)]
        if c.startswith('lsm6'):
            vals = [int(v / 0.000061) & 0xFFFF for v in (gx, gy, gz)]
            return [b for v in vals for b in (v & 0xFF, v >> 8)]
        vals = [int(v * 16384) & 0xFFFF for v in (gx, gy, gz)]
        return [b for v in vals for b in (v >> 8, v & 0xFF)]


if __name__ == '__main__':
    try:
        sys.exit(main() or 0)
    except KeyboardInterrupt:
        sys.exit(0)
    except BrokenPipeError:
        sys.exit(0)
