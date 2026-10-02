"""Compose and render four candidate battle-music pieces with the MuseScore_General soundfont (MIT)."""
import os, sys, subprocess
import numpy as np, scipy.signal as sg
from scipy.io import wavfile
import tinysoundfont as tsf

SR = 44100
SF = os.environ.get('BB_SOUNDFONT', os.path.join(os.path.dirname(__file__), '.cache', 'MuseScore_General.sf2'))
OUT = os.environ.get('BB_DEMO_OUT', 'out')
RNG = np.random.default_rng(7)

NOTE = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}


def n(name):
    """'D4' -> 62"""
    p, o = (name[:2], name[2:]) if len(name) > 2 and name[1] in '#b' else (name[:1], name[1:])
    return 12 * (int(o) + 1) + NOTE[p]


def chord(root, quality, octave=3):
    r = n(f'{root}{octave}')
    iv = {'m': [0, 3, 7], 'M': [0, 4, 7], 'sus4': [0, 5, 7], '5': [0, 7, 12], 'm7': [0, 3, 7, 10]}[quality]
    return [r + i for i in iv]


class Song:
    def __init__(self, bpm):
        self.bpm = bpm
        self.ev = []  # (sec, order, kind, ch, a, b)
        self.progs = {}

    def sec(self, beat):
        return beat * 60.0 / self.bpm

    def program(self, ch, preset, bank=0, drums=False, vol=100, pan=64):
        self.progs[ch] = (bank, preset, drums)
        self.ev.append((0.0, 0, 'cc', ch, 7, vol))
        self.ev.append((0.0, 0, 'cc', ch, 10, pan))

    def note(self, ch, key, beat, dur, vel, human=True):
        t = self.sec(beat) + (RNG.normal(0, 0.006) if human else 0)
        v = int(np.clip(vel + (RNG.integers(-5, 6) if human else 0), 1, 127))
        t = max(0.0, t)
        self.ev.append((t, 2, 'on', ch, key, v))
        self.ev.append((t + max(0.03, self.sec(dur) * 0.97), 1, 'off', ch, key, 0))

    def notes(self, ch, keys, beat, dur, vel, human=True):
        for k in keys:
            self.note(ch, k, beat, dur, vel, human)

    def cc(self, ch, beat, ctrl, val):
        self.ev.append((self.sec(beat), 0, 'cc', ch, ctrl, int(val)))

    def ramp(self, ch, beat0, beat1, v0, v1, ctrl=11, steps=24):
        for i in range(steps + 1):
            b = beat0 + (beat1 - beat0) * i / steps
            self.cc(ch, b, ctrl, v0 + (v1 - v0) * i / steps)


def render(song, tail=4.0):
    s = tsf.Synth(samplerate=SR)
    sf = s.sfload(SF)
    for ch, (bank, preset, drums) in song.progs.items():
        s.program_select(ch, sf, bank, preset, drums)
    ev = sorted(song.ev, key=lambda e: (e[0], e[1]))
    end = ev[-1][0] + tail
    out = np.zeros((int(end * SR) + SR, 2), dtype=np.float32)
    pos = 0
    for t, _, kind, ch, a, b in ev:
        target = int(t * SR)
        if target > pos:
            buf = np.frombuffer(s.generate(target - pos), dtype=np.float32).reshape(-1, 2)
            out[pos:target] = buf
            pos = target
        if kind == 'on':
            s.noteon(ch, a, b)
        elif kind == 'off':
            s.noteoff(ch, a)
        else:
            s.control_change(ch, a, b)
    rest = len(out) - pos
    out[pos:] = np.frombuffer(s.generate(rest), dtype=np.float32).reshape(-1, 2)
    return out[: int(end * SR)]


def reverb(x, seconds=2.6, wet=0.28, predelay=0.025, bright=7000):
    m = int(SR * seconds)
    t = np.arange(m) / SR
    ir = RNG.standard_normal((m, 2)) * np.exp(-6.9 * t / seconds)[:, None]
    b, a = sg.butter(2, bright / (SR / 2))
    ir = sg.lfilter(b, a, ir, axis=0)
    ir = np.vstack([np.zeros((int(predelay * SR), 2)), ir])
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    w = np.stack([sg.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], 1)
    return x + w * wet


def shelf(x, f0=4500, gain_db=3.0):
    """RBJ high-shelf to keep the mix bright (the old score was too dark)."""
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / SR
    alpha = np.sin(w0) / 2 * np.sqrt(2)
    cw = np.cos(w0)
    b = [A * ((A + 1) + (A - 1) * cw + 2 * np.sqrt(A) * alpha), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - 2 * np.sqrt(A) * alpha)]
    a = [(A + 1) - (A - 1) * cw + 2 * np.sqrt(A) * alpha, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - 2 * np.sqrt(A) * alpha]
    return sg.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=0)


def master(x, rms_db=-15.0, ceiling_db=-1.0):
    hp_b, hp_a = sg.butter(2, 32 / (SR / 2), 'high')
    x = sg.lfilter(hp_b, hp_a, x, axis=0)
    rms = np.sqrt(np.mean(x ** 2)) + 1e-12
    x = x * (10 ** (rms_db / 20) / rms)
    c = 10 ** (ceiling_db / 20)
    return (np.tanh(x / c) * c).astype(np.float32)


def save(name, x):
    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(OUT, name + '.wav')
    wavfile.write(wav, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))
    m4a = os.path.join(OUT, name + '.m4a')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'aac', '-b:a', '192k', m4a], check=True)
    os.remove(wav)
    peak = float(np.max(np.abs(x)))
    rms = 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
    print(f'{name}: {len(x) / SR:.1f}s  peak {peak:.3f}  rms {rms:.1f} dBFS  -> {m4a}')


# ---------------------------------------------------------------- M1 Iron March
def iron_march():
    s = Song(100)
    S_FAST, S_SLOW, HORN, TPT, BRASS, TIMP, CHOIR, LOWSTR, FLUTE, TREM, ORCH, SNARE = range(12)
    s.program(S_FAST, 48, vol=96, pan=50)
    s.program(S_SLOW, 49, vol=88, pan=78)
    s.program(HORN, 60, vol=112, pan=58)
    s.program(TPT, 56, vol=104, pan=70)
    s.program(BRASS, 61, vol=100, pan=64)
    s.program(TIMP, 47, vol=118, pan=64)
    s.program(CHOIR, 52, vol=92, pan=64)
    s.program(LOWSTR, 43, vol=104, pan=60)
    s.program(FLUTE, 73, vol=96, pan=74)
    s.program(TREM, 44, vol=92, pan=64)
    s.program(ORCH, 48, bank=128, drums=True, vol=120, pan=64)
    s.program(SNARE, 56, bank=128, drums=True, vol=127, pan=58)
    prog = [('D', 'm')] * 2 + [('Bb', 'M')] * 2 + [('G', 'm')] * 2 + [('A', 'M')] * 2
    progB = [('Bb', 'M'), ('F', 'M'), ('C', 'M'), ('D', 'm'), ('Bb', 'M'), ('F', 'M'), ('A', 'M'), ('A', 'M')]
    theme = [  # (beat offset within 8 bars, note, beats)
        (0, 'D4', 1.5), (1.5, 'D4', .5), (2, 'F4', 1), (3, 'A4', 1),
        (4, 'D5', 3), (7, 'C5', 1),
        (8, 'Bb4', 1.5), (9.5, 'A4', .5), (10, 'G4', 1), (11, 'F4', 1),
        (12, 'F4', 3), (15, 'D4', 1),
        (16, 'G4', 1.5), (17.5, 'A4', .5), (18, 'Bb4', 1), (19, 'D5', 1),
        (20, 'C5', 2), (22, 'Bb4', 1), (23, 'A4', 1),
        (24, 'C#5', 1.5), (25.5, 'D5', .5), (26, 'E5', 1), (27, 'C#5', 1),
        (28, 'A4', 4)]
    themeB = [
        (0, 'F5', 2), (2, 'D5', 1), (3, 'F5', 1), (4, 'C5', 2), (6, 'A4', 2),
        (8, 'E5', 1.5), (9.5, 'F5', .5), (10, 'G5', 2), (12, 'F5', 1), (13, 'E5', 1), (14, 'D5', 2),
        (16, 'D5', 1), (17, 'F5', 1), (18, 'Bb5', 2), (20, 'A5', 1.5), (21.5, 'G5', .5), (22, 'F5', 2),
        (24, 'E5', 1), (25, 'F5', 1), (26, 'G5', 1), (27, 'E5', 1), (28, 'A5', 4)]

    def ostinato(bar0, bars, progs, vel):
        for i in range(bars):
            root, q = progs[i % len(progs)]
            r = n(f'{root}2')
            for k, st in enumerate([0, 0, 12, 0, 7, 0, 12, 10 if q == 'm' else 11]):
                s.note(S_FAST, r + 12 + st, (bar0 + i) * 4 + k * .5, .45, vel + (10 if k % 2 == 0 else 0))
            s.note(LOWSTR, r, (bar0 + i) * 4, 4, vel - 5)

    def pads(bar0, bars, progs, vel, ch=S_SLOW, octave=3):
        for i in range(bars):
            root, q = progs[i % len(progs)]
            s.notes(ch, chord(root, q, octave), (bar0 + i) * 4, 4, vel)

    def timp(bar0, bars, progs, vel, roll_last=False):
        for i in range(bars):
            root, _ = progs[i % len(progs)]
            r = n(f'{root}2')
            r = r if r >= n('F2') else r + 12
            s.note(TIMP, r, (bar0 + i) * 4, 1, vel)
            s.note(TIMP, r - 5 if r - 5 >= n('D2') else r + 7, (bar0 + i) * 4 + 2, 1, vel - 15)
        if roll_last:
            b = (bar0 + bars - 1) * 4
            for k in range(16):
                s.note(TIMP, n('A2'), b + k * .25, .25, 60 + k * 4)

    def march(bar0, bars, vel):
        pat = [(0, 1.0), (1, .5), (1.5, .5), (2, 1.0), (2.75, .25), (3, .5), (3.5, .5)]
        for i in range(bars):
            for b, d in pat:
                s.note(SNARE, 55, (bar0 + i) * 4 + b, d, vel + (15 if b in (0, 2) else 0))

    def snare_roll(bar0, beats, v0, v1):
        steps = int(beats * 4)
        for k in range(steps):
            s.note(SNARE, 50, bar0 * 4 + k * .25, .25, int(v0 + (v1 - v0) * k / steps))

    def melody(ch, bar0, mel, vel, transpose=0):
        for off, nm, d in mel:
            s.note(ch, n(nm) + transpose, bar0 * 4 + off, d, vel)

    def crash(bar, vel=110):
        s.note(ORCH, 57, bar * 4, 4, vel)
        s.note(ORCH, 36, bar * 4, 2, vel)

    # Intro 0-3
    ostinato(0, 4, [('D', 'm'), ('D', 'm'), ('Bb', 'M'), ('A', 'M')], 62)
    s.ramp(S_FAST, 0, 16, 60, 110)
    timp(0, 3, [('D', 'm'), ('D', 'm'), ('Bb', 'M')], 80, False)
    snare_roll(3, 4, 40, 120)
    for k in range(8):
        s.note(TIMP, n('A2'), 12 + k * .5, .5, 70 + k * 6)
    # A 4-11
    crash(4)
    ostinato(4, 8, prog, 72)
    pads(4, 8, prog, 64)
    timp(4, 8, prog, 96)
    march(4, 8, 70)
    melody(HORN, 4, theme, 100)
    # B 12-19
    crash(12, 118)
    ostinato(12, 8, progB, 80)
    pads(12, 8, progB, 70, ch=CHOIR, octave=4)
    pads(12, 8, progB, 74, ch=BRASS, octave=3)
    timp(12, 8, progB, 104)
    march(12, 8, 80)
    melody(TPT, 12, themeB, 104)
    melody(HORN, 12, themeB, 88, transpose=-12)
    # Bridge 20-23
    bridge = [('G', 'm'), ('D', 'm'), ('Bb', 'M'), ('A', 'M')]
    pads(20, 4, bridge, 58, ch=TREM, octave=3)
    for i, (root, q) in enumerate(bridge):
        s.note(LOWSTR, n(f'{root}2'), (20 + i) * 4, 4, 70)
    melody(FLUTE, 20, theme[:8], 86, transpose=12)
    snare_roll(23, 4, 30, 125)
    for k in range(16):
        s.note(TIMP, n('A2'), 92 + k * .25, .25, 50 + k * 5)
    # Climax 24-31
    crash(24, 124)
    crash(28, 116)
    ostinato(24, 8, prog, 88)
    pads(24, 8, prog, 82, ch=CHOIR, octave=4)
    pads(24, 8, prog, 86, ch=BRASS, octave=3)
    pads(24, 8, prog, 74, ch=S_SLOW, octave=4)
    timp(24, 8, prog, 112)
    march(24, 8, 88)
    melody(HORN, 24, theme, 112)
    melody(TPT, 24, theme, 108, transpose=12)
    for i in range(8):
        s.note(ORCH, 36, (24 + i) * 4, 1, 100)
        s.note(ORCH, 36, (24 + i) * 4 + 2, 1, 88)
    # Final hit
    s.notes(BRASS, chord('D', 'm', 3), 128, 4, 120)
    s.notes(CHOIR, chord('D', 'm', 4), 128, 4, 100)
    s.note(TIMP, n('D3'), 128, 2, 127)
    crash(32, 127)
    return s


# ---------------------------------------------------------------- M2 Undertow
def undertow():
    s = Song(120)
    OST, TAIKO, BASS, TBN, TUBA, BRASS, CHOIR, TREM, BELLS, KIT, TPT, CELLO = range(12)
    s.program(OST, 48, vol=100, pan=52)
    s.program(TAIKO, 116, vol=124, pan=64)
    s.program(BASS, 39, vol=92, pan=64)
    s.program(TBN, 57, vol=112, pan=60)
    s.program(TUBA, 58, vol=110, pan=66)
    s.program(BRASS, 61, vol=110, pan=64)
    s.program(CHOIR, 53, vol=96, pan=64)
    s.program(TREM, 44, vol=96, pan=72)
    s.program(BELLS, 14, vol=84, pan=40)
    s.program(KIT, 16, bank=128, drums=True, vol=112, pan=64)
    s.program(TPT, 56, vol=104, pan=76)
    s.program(CELLO, 42, vol=100, pan=48)
    prog = [('C', 'm'), ('C', 'm'), ('Ab', 'M'), ('Ab', 'M'), ('F', 'm'), ('F', 'm'), ('G', 'M'), ('G', 'M')]

    def root_of(i):
        return prog[i % 8]

    for bar in range(32):
        root, q = root_of(bar)
        r = n(f'{root}3') if NOTE[root] <= NOTE['G'] else n(f'{root}2')
        third = 3 if q == 'm' else 4
        pat = [0, 0, third, 0, 7, 0, third, 0, 12, 0, 7, 0, third, 0, 7, 10 if q == 'm' else 11]
        vel = 58 + min(40, bar * 2)
        for k, st in enumerate(pat):
            s.note(OST, r + st, bar * 4 + k * .25, .22, vel + (14 if k % 4 == 0 else 0))
        if bar < 16 and bar % 2 == 0:
            s.note(BELLS, n('C5') if q == 'm' else r + 24, bar * 4, 4, 70)
        if bar >= 4:
            s.note(CELLO, r - 12, bar * 4, 4, 70 + min(30, bar))
        if bar >= 4:
            tp = [(0, 120), (1.5, 80), (2, 105), (3, 70), (3.5, 90)] if bar >= 16 else [(0, 110), (2, 90)]
            for b, v in tp:
                s.note(TAIKO, n('C3') if b == 0 else n('G2'), bar * 4 + b, .5, v)
        if bar >= 8:
            for k in range(8):
                s.note(BASS, r - 12, bar * 4 + k * .5, .4, 92 if k % 2 == 0 else 70)
            if bar % 2 == 0:
                s.notes(TBN, [r - 12, r - 5], bar * 4, 1.5, 112)
                s.note(TUBA, r - 24, bar * 4, 1.5, 112)
        if bar >= 12:
            s.notes(CHOIR, chord(root, q, 4), bar * 4, 4, 70 + min(30, (bar - 12) * 2))
        if bar >= 16:
            s.note(KIT, 38, bar * 4 + 1, .5, 96)
            s.note(KIT, 38, bar * 4 + 3, .5, 104)
            s.note(KIT, 36, bar * 4, .5, 110)
            s.note(KIT, 36, bar * 4 + 2.5, .5, 90)
            if bar % 4 == 3:
                for k, tom in enumerate([50, 48, 47, 45, 43, 41, 43, 41]):
                    s.note(KIT, tom, bar * 4 + 2 + k * .25, .25, 90 + k * 4)
        if bar in (16, 24):
            s.notes(BRASS, [r - 12, r - 5, r, r + 3], bar * 4, 3, 127)
            s.note(KIT, 49, bar * 4, 3, 120)
    for b in range(20, 24):
        root, q = root_of(b)
        s.notes(TREM, chord(root, q, 4), b * 4, 4, 60 + (b - 20) * 15)
    s.ramp(TREM, 80, 96, 50, 120)
    motif = [(0, 'G5', 1), (1, 'Ab5', 1), (2, 'G5', 1), (3, 'F5', 1), (4, 'Eb5', 2), (6, 'D5', 1), (7, 'C5', 1),
             (8, 'Eb5', 1), (9, 'F5', 1), (10, 'G5', 2), (12, 'C6', 2), (14, 'B5', 2)]
    for rep in range(2):
        for off, nm, d in motif:
            s.note(TPT, n(nm), 96 + rep * 16 + off, d, 104)
            s.note(BRASS, n(nm) - 12, 96 + rep * 16 + off, d, 90)
    s.notes(BRASS, [n('C2'), n('G2'), n('C3'), n('Eb3')], 128, 4, 127)
    s.note(TAIKO, n('C3'), 128, 2, 127)
    s.note(KIT, 49, 128, 4, 127)
    return s


# ---------------------------------------------------------------- M3 Dawn Charge
def dawn_charge():
    s = Song(132)
    ARP, TPT, HORN, BRASS, STR, TIMP, ORCH, SNARE, CHOIR, LOW, KIT = range(11)
    s.program(ARP, 48, vol=92, pan=48)
    s.program(TPT, 56, vol=112, pan=72)
    s.program(HORN, 60, vol=108, pan=56)
    s.program(BRASS, 61, vol=96, pan=64)
    s.program(STR, 49, vol=90, pan=80)
    s.program(TIMP, 47, vol=118, pan=64)
    s.program(ORCH, 48, bank=128, drums=True, vol=122, pan=64)
    s.program(SNARE, 56, bank=128, drums=True, vol=127, pan=60)
    s.program(CHOIR, 52, vol=92, pan=64)
    s.program(LOW, 43, vol=104, pan=60)
    s.program(KIT, 16, bank=128, drums=True, vol=96, pan=64)
    prog = [('D', 'M'), ('A', 'M'), ('B', 'm'), ('G', 'M'), ('D', 'M'), ('A', 'M'), ('G', 'M'), ('A', 'M')]
    theme = [(0, 'D5', 1.5), (1.5, 'A4', .5), (2, 'D5', 1), (3, 'F#5', 1),
             (4, 'E5', 3), (7, 'C#5', 1),
             (8, 'D5', 1.5), (9.5, 'B4', .5), (10, 'F#5', 1), (11, 'B5', 1),
             (12, 'A5', 2), (14, 'G5', 1), (15, 'F#5', 1),
             (16, 'F#5', 1.5), (17.5, 'E5', .5), (18, 'D5', 1), (19, 'A4', 1),
             (20, 'C#5', 3), (23, 'E5', 1),
             (24, 'D5', 1.5), (25.5, 'E5', .5), (26, 'F#5', 1), (27, 'G5', 1),
             (28, 'A5', 4)]

    def arps(bar0, bars, vel):
        for i in range(bars):
            root, q = prog[(bar0 + i) % 8]
            c = chord(root, q, 4)
            seq = [c[0], c[1], c[2], c[1] + 12 if False else c[0] + 12, c[2], c[1], c[0], c[1]] * 2
            for k, key in enumerate(seq):
                s.note(ARP, key, (bar0 + i) * 4 + k * .25, .24, vel + (12 if k % 4 == 0 else 0))
            s.note(LOW, n(f'{root}2'), (bar0 + i) * 4, 4, vel)

    def drums(bar0, bars, vel, full=False):
        for i in range(bars):
            b = (bar0 + i) * 4
            root, _ = prog[(bar0 + i) % 8]
            r = n(f'{root}2')
            r = r if r >= n('F2') else r + 12
            s.note(TIMP, r, b, 1, vel + 10)
            s.note(TIMP, r, b + 2, 1, vel)
            for off, d in [(0, .5), (.5, .25), (.75, .25), (1, .5), (2, .5), (2.5, .25), (2.75, .25), (3, .5), (3.5, .5)]:
                s.note(SNARE, 55, b + off, d, vel + (12 if off in (1, 3) else 0))
            if full:
                for off in (0, 1, 2, 3):
                    s.note(KIT, 36, b + off, .5, vel + 10)
                s.note(KIT, 38, b + 1, .5, vel + 15)
                s.note(KIT, 38, b + 3, .5, vel + 15)

    def melody(ch, bar0, vel, tr=0):
        for off, nm, d in theme:
            s.note(ch, n(nm) + tr, bar0 * 4 + off, d, vel)

    def pads(ch, bar0, bars, vel, octave=3):
        for i in range(bars):
            root, q = prog[(bar0 + i) % 8]
            s.notes(ch, chord(root, q, octave), (bar0 + i) * 4, 4, vel)

    arps(0, 4, 62)
    s.ramp(ARP, 0, 16, 64, 112)
    for k in range(16):
        s.note(SNARE, 50, 12 + k * .25, .25, 40 + k * 5)
    s.note(ORCH, 57, 16, 4, 116)
    arps(4, 8, 72)
    drums(4, 8, 84)
    melody(TPT, 4, 106)
    melody(HORN, 4, 92, tr=-12)
    pads(STR, 4, 8, 62, 4)
    s.note(ORCH, 57, 48, 4, 120)
    arps(12, 8, 80)
    drums(12, 8, 92, full=True)
    melody(TPT, 12, 112, tr=0)
    melody(HORN, 12, 100, tr=-12)
    pads(CHOIR, 12, 8, 78, 4)
    pads(BRASS, 12, 8, 70, 3)
    # breakdown 20-23
    pads(STR, 20, 4, 70, 4)
    for i in range(4):
        root, q = prog[(20 + i) % 8]
        s.notes(HORN, chord(root, q, 3), (20 + i) * 4, 4, 72)
    for k in range(16):
        s.note(SNARE, 50, 92 + k * .25, .25, 40 + k * 5)
    s.note(ORCH, 57, 96, 4, 124)
    arps(24, 8, 88)
    drums(24, 8, 100, full=True)
    melody(TPT, 24, 118, tr=0)
    melody(HORN, 24, 108, tr=-12)
    melody(CHOIR, 24, 90, tr=-12)
    pads(BRASS, 24, 8, 84, 3)
    pads(STR, 24, 8, 76, 5)
    s.notes(BRASS, chord('D', 'M', 3), 128, 4, 124)
    s.notes(TPT, [n('D5'), n('F#5'), n('A5')], 128, 4, 120)
    s.note(TIMP, n('D3'), 128, 2, 127)
    s.note(ORCH, 57, 128, 4, 127)
    return s


# ---------------------------------------------------------------- M4 Trading Front
def trading_front():
    s = Song(126)
    BASS, ARP, PAD, LEAD, STR, BRASS, TAIKO, KIT, CHOIR = range(9)
    s.program(BASS, 38, vol=104, pan=64)
    s.program(ARP, 81, vol=70, pan=44)
    s.program(PAD, 89, vol=86, pan=64)
    s.program(LEAD, 81, vol=96, pan=72)
    s.program(STR, 49, vol=92, pan=80)
    s.program(BRASS, 61, vol=104, pan=64)
    s.program(TAIKO, 116, vol=120, pan=64)
    s.program(KIT, 24, bank=128, drums=True, vol=110, pan=64)
    s.program(CHOIR, 91, vol=84, pan=64)
    prog = [('E', 'm'), ('C', 'M'), ('G', 'M'), ('D', 'M')]
    lead = [(0, 'B4', 1), (1, 'E5', 1), (2, 'G5', 1.5), (3.5, 'F#5', .5),
            (4, 'E5', 1), (5, 'G5', 1), (6, 'C6', 1.5), (7.5, 'B5', .5),
            (8, 'B5', 1), (9, 'G5', 1), (10, 'D5', 1.5), (11.5, 'E5', .5),
            (12, 'F#5', 2), (14, 'A5', 1), (15, 'F#5', 1)]
    for bar in range(32):
        root, q = prog[bar % 4]
        c = chord(root, q, 4)
        r2 = n(f'{root}2')
        b = bar * 4
        s.notes(PAD, chord(root, q, 3), b, 4, 60)
        if bar >= 0:
            arp = [c[0], c[1], c[2], c[0] + 12] * 4
            for k, key in enumerate(arp):
                s.note(ARP, key, b + k * .25, .2, 70 + (20 if k % 4 == 0 else 0))
        if bar >= 4:
            for k in range(16):
                s.note(BASS, r2 + (12 if k % 4 == 2 else 0), b + k * .25, .22, 110 if k % 4 == 0 else (60 if k % 4 == 1 else 84))
        if bar >= 8 and bar != 23:
            for k in range(4):
                s.note(KIT, 36, b + k, .5, 118)
            s.note(KIT, 39, b + 1, .5, 104)
            s.note(KIT, 39, b + 3, .5, 108)
            for k in range(16):
                s.note(KIT, 42, b + k * .25, .2, 70 if k % 2 else 92)
            for k in range(4):
                s.note(KIT, 46, b + k + .5, .3, 72)
        if bar >= 16:
            s.notes(STR, chord(root, q, 4), b, 4, 72)
            off = (bar % 4) * 4
            for o, nm, d in lead:
                if off <= o < off + 4:
                    s.note(LEAD, n(nm), b + o - off, d, 104)
        if bar >= 24:
            s.notes(BRASS, chord(root, q, 3), b, 1, 112)
            s.notes(BRASS, chord(root, q, 3), b + 2.5, .5, 100)
            s.notes(CHOIR, chord(root, q, 4), b, 4, 76)
        if bar % 4 == 0 and bar >= 8:
            s.note(TAIKO, n('E3'), b, 1, 124)
            s.note(KIT, 49, b, 2, 110)
        if bar == 23:
            for k in range(16):
                s.note(KIT, 38, b + k * .25, .25, 50 + k * 4)
    s.notes(BRASS, chord('E', 'm', 3), 128, 4, 120)
    s.note(TAIKO, n('E3'), 128, 2, 127)
    s.note(KIT, 49, 128, 4, 120)
    return s


def demo_main():
    pieces = [
        ('M1-铁血进行曲-iron-march', iron_march, dict(seconds=2.8, wet=0.30)),
        ('M2-暗涌-undertow', undertow, dict(seconds=2.4, wet=0.26)),
        ('M3-破晓冲锋-dawn-charge', dawn_charge, dict(seconds=2.6, wet=0.28)),
        ('M4-交易战线-trading-front', trading_front, dict(seconds=1.8, wet=0.18)),
    ]
    only = os.environ.get('ONLY')
    for name, fn, rv in pieces:
        if only and only not in name:
            continue
        x = render(fn())
        x = reverb(x, **rv)
        x = shelf(x, 4500, 2.5)
        save(name, master(x))


if __name__ == '__main__':
    OUT = sys.argv[1] if len(sys.argv) > 1 else OUT
    demo_main()
