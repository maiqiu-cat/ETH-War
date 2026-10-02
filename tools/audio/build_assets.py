"""Render the game's audio assets into src/audio/assets/ (+ manifest.json).

    BB_SOUNDFONT=/path/to/MuseScore_General.sf2 python build_assets.py

Music (MuseScore_General, MIT):
  calm    = M2 "Undertow"     — whole piece as a seamless loop (final hit removed)
  battle  = M1 "Iron March"   — intro once, then bars 4–32 loop seamlessly
  victory = M3 "Dawn Charge"  — bars 12–20 (full tutti) + 2.5 s fade, played once on a win
Loops: the reverb tail past the loop end is folded onto the loop start and 1 s of the loop start is
appended, so any loopStart in [start, start+1 s) with loopEnd = loopStart + length is seamless even if a
decoder adds AAC priming silence. The manifest stores loopStart = start + 0.5 s.
Effects: several random variants per sound from sfx.py (layered transients, saturation, echoes).
"""
import json, os, subprocess, sys, tempfile
import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compose as C  # noqa: E402
import sfx as X  # noqa: E402

ASSETS = os.path.join(HERE, '..', '..', 'src', 'audio', 'assets')
MSR = C.SR  # music sample rate (44.1 kHz)
FSR = X.SR  # effects sample rate (48 kHz)


def encode(name, x, sr, kbps):
    os.makedirs(ASSETS, exist_ok=True)
    x = np.clip(x, -1, 1)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        wavfile.write(tmp.name, sr, (x * 32767).astype(np.int16))
    out = os.path.join(ASSETS, name + '.m4a')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp.name, '-c:a', 'aac', '-b:a', f'{kbps}k', out], check=True)
    os.remove(tmp.name)
    mono = x if x.ndim == 1 else x.mean(axis=1)
    return {
        'file': name + '.m4a',
        'seconds': round(len(x) / sr, 3),
        'peak': round(float(np.max(np.abs(x))), 3),
        'rmsDb': round(float(20 * np.log10(np.sqrt(np.mean(mono ** 2)) + 1e-12)), 1),
        'bytes': os.path.getsize(out),
    }


def loop_track(song, loop_from_beat, loop_to_beat, rv):
    t_end = song.sec(loop_to_beat)
    song.ev = [e for e in song.ev if not (e[2] == 'on' and e[0] >= t_end - 0.05)]  # drop the final hit
    x = C.render(song, tail=4.0)
    x = C.reverb(x, **rv)
    x = C.shelf(x, 4500, 2.5)
    a, b = int(song.sec(loop_from_beat) * MSR), int(t_end * MSR)
    y = x[:b].copy()
    tail = x[b:]
    n = min(len(tail), b - a)
    y[a : a + n] += tail[:n]
    y = C.master(y)
    ext = np.concatenate([y, y[a : a + MSR]])
    return ext, a / MSR, (b - a) / MSR


def victory_cue():
    s = C.dawn_charge()
    x = C.render(s, tail=4.0)
    x = C.reverb(x, seconds=2.6, wet=0.28)
    x = C.shelf(x, 4500, 2.5)
    x = C.master(x)
    a, b = int(s.sec(48) * MSR) - int(0.01 * MSR), int(s.sec(80) * MSR)
    fade = int(2.5 * MSR)
    cue = x[a : b + fade].copy()
    cue[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    return cue


def main():
    man = {'music': {}, 'sfx': {}}
    # ---- music
    rv_m2, rv_m1 = dict(seconds=2.4, wet=0.26), dict(seconds=2.8, wet=0.30)
    x, start, length = loop_track(C.undertow(), 0, 128, rv_m2)
    man['music']['calm'] = {**encode('music-calm-undertow', x, MSR, 128), 'loopStart': round(start + 0.5, 4), 'loopLength': round(length, 4), 'title': 'M2 Undertow'}
    x, start, length = loop_track(C.iron_march(), 16, 128, rv_m1)
    man['music']['battle'] = {**encode('music-battle-iron-march', x, MSR, 128), 'loopStart': round(start + 0.5, 4), 'loopLength': round(length, 4), 'title': 'M1 Iron March'}
    man['music']['victory'] = {**encode('music-victory-dawn-charge', victory_cue(), MSR, 128), 'title': 'M3 Dawn Charge (bars 12–20)'}
    # ---- effects (mono unless noted)
    X.rng = np.random.default_rng(2026)
    def variants(key, fn, count, kbps=96):
        man['sfx'][key] = [encode(f'sfx-{key}-{i}', fn(), FSR, kbps) for i in range(count)]
    variants('rifle_bull', lambda: X.rifle('bull'), 6)
    variants('rifle_bear', lambda: X.rifle('bear'), 6)
    variants('mg_bull', lambda: X.mg_burst(int(X.rng.integers(5, 9)), 700, 'bull'), 2)
    variants('mg_bear', lambda: X.mg_burst(int(X.rng.integers(6, 11)), 760, 'bear'), 2)
    variants('cannon', lambda: X.cannon(float(X.rng.uniform(0.75, 1.0))), 3)
    for key, size in [('expl_s', 0.15), ('expl_m', 0.4), ('expl_l', 0.7), ('expl_xl', 1.0)]:
        variants(key, lambda size=size: X.explosion(size), 2)
    man['sfx']['whistle'] = [{**encode('sfx-whistle-0', X.whistle(1.8), FSR, 96), 'impactAt': 1.8}]
    variants('flare', X.flare, 2)
    man['sfx']['horn'] = [encode('sfx-horn', X.sf_cue(X.horn_call), FSR, 128)]
    man['sfx']['fanfare_bulls'] = [encode('sfx-fanfare-bulls', X.sf_cue(X.fanfare(True)), FSR, 128)]
    man['sfx']['fanfare_bears'] = [encode('sfx-fanfare-bears', X.sf_cue(X.fanfare(False)), FSR, 128)]
    with open(os.path.join(ASSETS, 'manifest.json'), 'w') as f:
        json.dump(man, f, indent=1, ensure_ascii=False)
    total = sum(v['bytes'] for v in man['music'].values()) + sum(e['bytes'] for vs in man['sfx'].values() for e in vs)
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != 'file'} for k, v in man['music'].items()}, indent=1, ensure_ascii=False))
    print('effects:', {k: len(v) for k, v in man['sfx'].items()})
    print(f'total {total / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
