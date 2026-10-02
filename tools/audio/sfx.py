"""Layered battle sound effects (offline, numpy/scipy) + in-context battle mixes for listening."""
import os, sys, subprocess
import numpy as np, scipy.signal as sg
from scipy.io import wavfile

sys.path.insert(0, os.path.dirname(__file__))
import compose as C  # soundfont renderer for horn/fanfare

SR = 48000
OUT = sys.argv[1] if __name__ == '__main__' and len(sys.argv) > 1 else 'out'
MUSIC_DIR = sys.argv[2] if __name__ == '__main__' and len(sys.argv) > 2 else None
rng = np.random.default_rng(11)


def T(sec):
    return np.arange(int(sec * SR)) / SR


def noise(sec):
    return rng.standard_normal(int(sec * SR))


def env(sec, tau, attack=0.0006):
    t = T(sec)
    return (1 - np.exp(-t / attack)) * np.exp(-t / tau)


def filt(x, kind, f, order=2):
    if kind == 'bp':
        sos = sg.butter(order, [f[0] / (SR / 2), f[1] / (SR / 2)], 'bandpass', output='sos')
    else:
        sos = sg.butter(order, f / (SR / 2), 'low' if kind == 'lp' else 'high', output='sos')
    return sg.sosfilt(sos, x)


def sat(x, drive):
    return np.tanh(x * drive) / np.tanh(drive)


def sweep_lp(x, f0, f1):
    """Time-varying one-pole lowpass (2 passes), cutoff sliding exponentially f0 -> f1."""
    n = len(x)
    fc = f0 * (f1 / f0) ** (np.arange(n) / max(1, n - 1))
    a = np.exp(-2 * np.pi * fc / SR)
    for _ in range(2):
        y = np.empty(n)
        s = 0.0
        for i in range(n):
            s = (1 - a[i]) * x[i] + a[i] * s
            y[i] = s
        x = y
    return x


def sine_sweep(f0, f1, sec):
    t = T(sec)
    f = f0 * (f1 / f0) ** (t / sec)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def pad_to(x, n):
    return np.pad(x, (0, max(0, n - len(x))))[:n] if len(x) < n else x[:n]


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[: len(p)] += p
    return out


def reflections(x, taps):
    out = np.copy(x)
    for d, g, lp in taps:
        k = int(d * SR)
        y = filt(x, 'lp', lp) * g
        out = mix(out, np.concatenate([np.zeros(k), y]))
    return out


def norm(x, peak=0.9):
    return x / (np.max(np.abs(x)) + 1e-12) * peak


def distance(x, d):
    """d: 0 near … 1 far: duller, quieter."""
    if d <= 0:
        return x
    return filt(x, 'lp', 14000 * (1 - d) + 1400 * d) * (1 - 0.72 * d)


# ------------------------------------------------------------------ weapons
def rifle(kind='bull'):
    v = rng.uniform(0.9, 1.1)
    lo, hi = (650 * v, 1900 * v) if kind == 'bull' else (420 * v, 1300 * v)
    crack = filt(noise(0.004), 'hp', 2600) * env(0.004, 0.0009) * 1.0
    body = sat(filt(noise(0.14), 'bp', (lo, hi)) * env(0.14, 0.018), 4.0) * 0.9
    thump = sine_sweep(170 * v if kind == 'bull' else 125 * v, 50, 0.09) * env(0.09, 0.022) * 0.75
    tail = filt(noise(0.6), 'lp', 3200) * env(0.6, 0.11, 0.004) * 0.16
    x = mix(crack, body, thump, tail)
    x = reflections(x, [(0.038, 0.32, 4200), (0.085, 0.22, 2600), (0.15, 0.15, 1700), (0.26, 0.09, 1100)])
    return norm(x, 0.9)


def mg_burst(shots=9, rpm=720, kind='bear'):
    gap = 60 / rpm
    out = np.zeros(int((shots * gap + 0.9) * SR))
    for i in range(shots):
        s = rifle(kind) * rng.uniform(0.75, 1.0)
        k = max(0, int((i * gap + rng.normal(0, 0.004)) * SR))
        seg = s[: len(out) - k]
        out[k : k + len(seg)] += seg
    return norm(out, 0.9)


def sniper():
    crack = filt(noise(0.006), 'hp', 3000) * env(0.006, 0.0012) * 1.0
    body = sat(filt(noise(0.2), 'bp', (500, 2400)) * env(0.2, 0.03), 5.0)
    thump = sine_sweep(140, 42, 0.14) * env(0.14, 0.04) * 0.9
    x = mix(crack, body, thump)
    x = reflections(x, [(0.06, 0.35, 3000), (0.21, 0.25, 1800), (0.45, 0.2, 1100), (0.8, 0.12, 700)])
    return norm(x, 0.92)


def cannon(size=1.0):
    blast = sat(noise(0.035) * env(0.035, 0.008), 6.0) * 0.9
    boom = sat(sine_sweep(72, 30, 1.2) * env(1.2, 0.38, 0.003), 2.0) * 1.0
    body = sweep_lp(noise(1.4), 3200, 160) * env(1.4, 0.32, 0.002) * 1.1
    bark = sat(filt(noise(0.35), 'bp', (170, 480)) * env(0.35, 0.09), 3.0) * 0.7
    deb = np.zeros(int(1.3 * SR))
    for _ in range(24):
        k = int(rng.uniform(0.22, 1.1) * SR)
        c = filt(noise(0.012), 'hp', 1600) * env(0.012, 0.003) * rng.uniform(0.03, 0.12)
        deb[k : k + len(c)] += c
    x = mix(blast, boom, body, bark, deb)
    x = reflections(x, [(0.21, 0.34, 1600), (0.43, 0.22, 950), (0.77, 0.13, 600)])
    return norm(x, 0.95) * (0.75 + 0.25 * size)


def explosion(size=0.5):
    dur = 1.4 + 3.6 * size
    trans = sat(noise(0.05) * env(0.05, 0.012), 6.0) * 0.9
    body = sweep_lp(noise(dur), 2200 + 6000 * size, 140) * env(dur, dur * 0.22, 0.003) * 1.2
    sub = sat(sine_sweep(64, 22, dur * 0.7) * env(dur * 0.7, dur * 0.2, 0.004), 1.6) * (0.7 + 0.4 * size)
    deb = np.zeros(int(dur * SR))
    for _ in range(int(12 + 70 * size)):
        k = int(rng.uniform(0.06, dur * 0.7) * SR)
        c = filt(noise(0.02), 'hp', rng.uniform(1200, 4500)) * env(0.02, rng.uniform(0.002, 0.008)) * rng.uniform(0.03, 0.16)
        deb[k : k + len(c)] += c[: len(deb) - k]
    parts = [trans, body, sub, deb]
    if size > 0.45:
        rumble = filt(noise(dur + 1.5), 'lp', 140) * env(dur + 1.5, (dur + 1.5) * 0.35, 0.3) * 0.9 * size
        parts.append(rumble)
    x = mix(*parts)
    x = reflections(x, [(0.25, 0.25, 900), (0.55, 0.15, 600)])
    return norm(x, 0.97) * (0.7 + 0.3 * size)


def whistle(sec=1.8):
    t = T(sec)
    f = 2100 * (520 / 2100) ** (t / sec) * (1 + 0.012 * np.sin(2 * np.pi * 7 * t))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR)
    air = filt(noise(sec), 'bp', (700, 3500)) * 0.35
    shape = np.minimum(1, t / (sec * 0.25)) ** 2 * np.minimum(1, (sec - t) / 0.05)
    return norm((tone * 0.8 + air) * shape * (0.3 + 0.7 * t / sec), 0.6)


def liquidation_strike():
    w = whistle(1.8)
    big = explosion(1.0)
    sec1 = explosion(0.35) * 0.55
    sec2 = explosion(0.25) * 0.45
    n = len(w) + len(big) + SR
    out = np.zeros(n)
    out[: len(w)] += w
    k = len(w) - int(0.02 * SR)
    out[k : k + len(big)] += big
    for d, e in [(0.9, sec1), (1.6, sec2)]:
        j = k + int(d * SR)
        out[j : j + len(e)] += e[: n - j]
    return norm(out, 0.97)


def flare():
    sec = 1.4
    t = T(sec)
    whoosh = filt(noise(sec), 'bp', (500, 4000)) * np.minimum(1, t / 0.5) * np.exp(-np.maximum(0, t - 0.5) / 0.15)
    pop = sat(noise(0.05) * env(0.05, 0.01), 3) * 0.7
    sparkle = np.zeros(len(t))
    for _ in range(30):
        k = int(rng.uniform(0.62, 1.35) * SR)
        c = filt(noise(0.01), 'hp', 5000) * env(0.01, 0.002) * rng.uniform(0.05, 0.2)
        sparkle[k : k + len(c)] += c[: len(sparkle) - k]
    out = mix(whoosh * 0.6, np.concatenate([np.zeros(int(0.6 * SR)), pop]), sparkle)
    return norm(out, 0.8)


# ------------------------------------------------------- soundfont cues (44.1k → resampled)
def sf_cue(build):
    s = C.Song(100)
    build(s)
    x = C.render(s, tail=2.5)
    x = C.reverb(x, seconds=2.6, wet=0.3)
    x = sg.resample_poly(x, 160, 147, axis=0)  # 44.1k -> 48k
    return x / (np.max(np.abs(x)) + 1e-9) * 0.9


def horn_call(s):
    s.program(0, 60, vol=120)
    s.program(1, 56, vol=110)
    s.program(2, 47, vol=120)
    s.program(3, 48, bank=128, drums=True, vol=120)
    for ch in (0, 1):
        s.note(ch, C.n('D4') + (12 if ch else 0), 0, 0.7, 112, False)
        s.note(ch, C.n('A4') + (12 if ch else 0), 0.75, 0.7, 112, False)
        s.note(ch, C.n('D5') + (12 if ch else 0), 1.5, 2.5, 118, False)
    s.note(2, C.n('D3'), 1.5, 1, 120, False)
    s.note(3, 57, 1.5, 3, 110, False)


def fanfare(major):
    def build(s):
        s.program(0, 56, vol=118)
        s.program(1, 60, vol=118)
        s.program(2, 61, vol=110)
        s.program(3, 47, vol=124)
        s.program(4, 48, bank=128, drums=True, vol=124)
        s.program(5, 52, vol=96)
        third = 'F#' if major else 'F'
        seq = [('D5', 0, .5), (third + '5', .5, .5), ('A5', 1, .5), ('D6', 1.5, 1.5)]
        for nm, b, d in seq:
            s.note(0, C.n(nm), b, d, 120, False)
            s.note(1, C.n(nm) - 12, b, d, 112, False)
        root = [C.n('D3'), C.n(third + '3'), C.n('A3'), C.n('D4')]
        s.notes(2, root, 3, 3, 118, False)
        s.notes(0, [C.n('D5'), C.n(third + '5'), C.n('A5')], 3, 3, 116, False)
        s.notes(5, [C.n('D4'), C.n(third + '4'), C.n('A4')], 3, 3, 100, False)
        for k in range(8):
            s.note(3, C.n('A2'), 1.5 + k * .1875, .1875, 70 + k * 7, False)
        s.note(3, C.n('D3'), 3, 2, 127, False)
        s.note(4, 57, 3, 4, 124, False)
        s.note(4, 36, 3, 2, 120, False)
    return build


# ------------------------------------------------------------------ output
def save(name, x, stereo=None):
    os.makedirs(OUT, exist_ok=True)
    if stereo is None:
        st = np.stack([x, x], 1) if x.ndim == 1 else x
    else:
        st = stereo
    st = np.clip(st, -1, 1)
    wav = os.path.join(OUT, name + '.wav')
    wavfile.write(wav, SR, (st * 32767).astype(np.int16))
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'aac', '-b:a', '192k', os.path.join(OUT, name + '.m4a')], check=True)
    os.remove(wav)
    print(f'{name}: {len(st) / SR:.1f}s peak {np.max(np.abs(st)):.2f}')


def sequence(items, total, gap_fill=0.0):
    """items: list of (time_sec, mono_signal, gain, pan)."""
    out = np.zeros((int(total * SR), 2))
    for t, x, g, pan in items:
        k = int(t * SR)
        l = np.cos((pan + 1) * np.pi / 4)
        r = np.sin((pan + 1) * np.pi / 4)
        seg = x[: max(0, len(out) - k)] * g
        out[k : k + len(seg), 0] += seg * l
        out[k : k + len(seg), 1] += seg * r
    return out


def stereo_of(x):
    return x if x.ndim == 2 else np.stack([x, x], 1)


if __name__ == '__main__' and not os.environ.get('MIX_ONLY'):
    # S1 rifles: 3 bull, 3 bear singles, then a burst each
    items, t = [], 0.3
    for kind in ('bull', 'bear'):
        for _ in range(3):
            items.append((t, rifle(kind), 0.9, -0.3 if kind == 'bull' else 0.3))
            t += 0.55
        t += 0.4
    items.append((t, mg_burst(7, 650, 'bull'), 0.85, -0.3)); t += 1.4
    items.append((t, mg_burst(10, 780, 'bear'), 0.85, 0.3)); t += 1.8
    items.append((t, sniper(), 0.95, 0)); t += 1.6
    save('S1-步枪-机枪-狙击', None, sequence(items, t + 0.4))

    # S2 cannons
    items, t = [], 0.3
    for size in (0.6, 0.85, 1.0):
        items.append((t, cannon(size), 1.0, rng.uniform(-0.4, 0.4)))
        t += 2.2
    save('S2-坦克炮x3', None, sequence(items, t + 0.6))

    # S3 explosions ladder
    items, t = [], 0.3
    for size in (0.15, 0.4, 0.7, 1.0):
        items.append((t, explosion(size), 1.0, 0))
        t += 1.6 + 3.6 * size
    save('S3-爆炸-小到大', None, sequence(items, t + 0.5))

    # S4 liquidation strike + flare
    items = [(0.3, liquidation_strike(), 1.0, 0.1), (8.2, flare(), 0.9, -0.4)]
    save('S4-爆仓重炮-信号弹', None, sequence(items, 10.2))

    # S5 horn + fanfares (soundfont)
    h = sf_cue(horn_call)
    fb = sf_cue(fanfare(True))
    fr = sf_cue(fanfare(False))
    n = len(h) + len(fb) + len(fr) + SR
    out = np.zeros((n, 2))
    out[: len(h)] += h
    out[len(h) : len(h) + len(fb)] += fb
    out[len(h) + len(fb) : len(h) + len(fb) + len(fr)] += fr
    save('S5-开战号角-牛方胜利-熊方胜利', None, out)

if __name__ == '__main__':
    # S6/S7 in-context battle mixes over candidate music
    if MUSIC_DIR:
        for tag, music_name, start in [('S6-实战混音-配M1', 'M1', 9.5), ('S7-实战混音-配M4', 'M4', 7.5)]:
            path = [f for f in os.listdir(MUSIC_DIR) if f.startswith(music_name)][0]
            raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-ss', str(start), '-t', '40', '-i', os.path.join(MUSIC_DIR, path), '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True).stdout
            mus = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
            total = len(mus) / SR
            fx = []
            # rifle stream: density rising, mostly mid/far, some near
            tt = 0.5
            while tt < total - 1:
                d = rng.choice([0.15, 0.4, 0.7], p=[0.25, 0.45, 0.30])
                fx.append((tt, distance(rifle(rng.choice(['bull', 'bear'])), d), 0.55, rng.uniform(-0.8, 0.8)))
                tt += rng.exponential(0.35 if tt > 12 else 0.6)
            for t0 in (4.0, 13.0, 27.0):
                fx.append((t0, distance(mg_burst(int(rng.integers(6, 12)), 700, 'bear'), 0.35), 0.6, rng.uniform(-0.6, 0.6)))
            big_hits = []
            for t0, s in [(6.0, 0.8), (11.5, 0.9), (19.0, 0.7), (24.5, 1.0), (31.0, 0.85)]:
                fx.append((t0, cannon(s), 0.85, rng.uniform(-0.5, 0.5)))
                fx.append((t0 + 0.9, explosion(0.35 + 0.3 * s), 0.85, rng.uniform(-0.6, 0.6)))
                big_hits.append(t0)
            fx.append((15.0, liquidation_strike(), 1.0, 0.15))
            big_hits.append(16.8)
            fx.append((22.0, flare(), 0.7, -0.5))
            sfx = sequence(fx, total)
            fan = sf_cue(fanfare(True))
            k = int(34.0 * SR)
            sfx[k : k + len(fan)] += fan[: len(sfx) - k] * 0.9
            big_hits.append(34.0)
            # music bed fixed at ~-21 dBFS RMS, ducked to 40% under big hits; effects at impact level
            duck = np.ones(len(mus))
            for h0 in big_hits:
                a0, b0 = int(h0 * SR), int((h0 + 2.0) * SR)
                ramp = np.concatenate([np.full(int(0.25 * SR), 0.35), np.linspace(0.35, 1.0, max(1, b0 - a0 - int(0.25 * SR)))])[: b0 - a0]
                duck[a0:b0] = np.minimum(duck[a0:b0], ramp[: len(duck[a0:b0])])
            bed = mus / (np.sqrt(np.mean(mus ** 2)) + 1e-9) * 10 ** (-24 / 20) * duck[:, None]
            outm = bed + sfx * 1.5
            outm = np.tanh(outm / 0.97) * 0.97
            save(tag, None, outm)
