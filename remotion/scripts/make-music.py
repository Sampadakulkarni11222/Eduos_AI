"""
Background music for the dynamic cut (EduOSPromoDynamic), synthesised from
scratch so there is nothing to license: an upbeat 122 BPM electronic bed,
Am-F-C-G, 126 s long, written to assets/audio/music.mp3.

The arrangement follows the cut's section starts (seconds on the 126 s
timeline): intro build 0-9.8, drop on the platform cut at 9.8, full groove
through the montage, a drumless breakdown over the Hindi beat, back in for
Ask Agent, and an impact on the finale at 121.24 that rings out to the end.
Ducking under the voice is done in src/dynamic/DynamicPromo.tsx, not here.

    python scripts/make-music.py      (needs numpy + scipy)
"""
import os
import subprocess
import wave

import numpy as np
from scipy.signal import butter, sosfilt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'audio', 'music.mp3')
FFMPEG = os.path.join(ROOT, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe')

SR = 44100
TOTAL = 126.0
BAR = 1.96  # 5 bars land the drop exactly on the 9.8 s platform cut
BEAT = BAR / 4
DROP = 9.8
BREAK = (47 * BAR, 49 * BAR)  # 92.1-96.0: under the Hindi beat
FINALE = 121.24
N = int(TOTAL * SR)

rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def lp(x, hz, order=2):
    return sosfilt(butter(order, hz, 'low', fs=SR, output='sos'), x)


def hp(x, hz, order=2):
    return sosfilt(butter(order, hz, 'high', fs=SR, output='sos'), x)


def bp(x, lo, hi):
    return sosfilt(butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)


def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    L[i : i + len(sig)] += sig * gain * (1 - max(pan, 0))
    R[i : i + len(sig)] += sig * gain * (1 + min(pan, 0))


def saw(freq, n, phase=0.0):
    return 2 * ((np.arange(n) * freq / SR + phase) % 1.0) - 1


# Am - F - C - G, one bar each: (bass root, chord tones)
PROG = [(45, [57, 60, 64, 69]), (41, [53, 57, 60, 65]), (48, [55, 60, 64, 67]), (43, [55, 59, 62, 67])]

bars = int(np.ceil(TOTAL / BAR))


def drums_on(t):
    return DROP <= t < FINALE and not (BREAK[0] <= t < BREAK[1])


# --- one-shots ---------------------------------------------------------------
def kick():
    n = int(0.45 * SR)
    tt = np.arange(n) / SR
    f = 48 + 110 * np.exp(-tt / 0.035)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.16)
    click = hp(rng.standard_normal(n), 3000) * np.exp(-tt / 0.004) * 0.3
    return np.tanh(1.6 * (body + click))


def clap():
    n = int(0.3 * SR)
    tt = np.arange(n) / SR
    noise = bp(rng.standard_normal(n), 900, 5000)
    env = np.exp(-tt / 0.07)
    for d in (0.0, 0.011, 0.022):  # the three-hand smear of a real clap
        env += (tt >= d) * np.exp(-np.clip(tt - d, 0, None) / 0.008) * 0.8
    return noise * env * 0.5


def hat(open_=False):
    n = int((0.22 if open_ else 0.06) * SR)
    tt = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7500, 4) * np.exp(-tt / (0.07 if open_ else 0.015))


def crash():
    n = int(2.2 * SR)
    tt = np.arange(n) / SR
    return hp(rng.standard_normal(n), 4000) * np.exp(-tt / 0.6) * 0.35


def impact():
    n = int(4.5 * SR)
    tt = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(38 + 70 * np.exp(-tt / 0.08)) / SR) * np.exp(-tt / 0.9)
    return np.tanh(2 * boom) * 0.9


def riser(length):
    n = int(length * SR)
    tt = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    chunk = n // 24
    for k in range(24):  # sweep the band up in steps
        seg = slice(k * chunk, n if k == 23 else (k + 1) * chunk)
        out[seg] = bp(noise, 300 + 250 * k, 800 + 450 * k)[seg]
    return out * (tt / length) ** 2 * 0.35


K, CL, HC, HO, CR = kick(), clap(), hat(), hat(True), crash()

# --- drums -------------------------------------------------------------------
kick_times = []
for b in range(bars):
    t0 = b * BAR
    for q in range(4):
        t = t0 + q * BEAT
        if drums_on(t):
            add(K, t, 0.95)
            kick_times.append(t)
            if q in (1, 3):
                add(CL, t, 0.55, pan=0.05)
            add(HO, t + BEAT / 2, 0.16, pan=0.25)
            add(HC, t + BEAT / 4, 0.08, pan=-0.3)
            add(HC, t + 3 * BEAT / 4, 0.1, pan=-0.3)
    # every 8th bar: a clap roll into the next phrase
    if drums_on(t0) and b % 8 == 7:
        for s in range(8):
            add(CL, t0 + 2 * BEAT + s * BEAT / 4, 0.18 + 0.05 * s)
    if drums_on(t0) and b % 8 == 0:
        add(CR, t0, 0.8)

# intro: hats creep in from bar 2 so the opening isn't static
for b in range(2, 5):
    for s in range(8):
        add(HC, b * BAR + s * BEAT / 2, 0.05 + 0.02 * b, pan=-0.2)

# --- sidechain pump (bass/pad/arp duck on every kick) --------------------------
pump = np.ones(N)
tt = np.arange(int(BEAT * SR)) / SR
shape = 1 - 0.65 * np.exp(-tt / 0.1)
for t in kick_times:
    i = int(t * SR)
    seg = min(len(shape), N - i)
    pump[i : i + seg] = np.minimum(pump[i : i + seg], shape[:seg])

# --- tonal parts ---------------------------------------------------------------
bass = np.zeros(N)
pad_l, pad_r = np.zeros(N), np.zeros(N)
arp_l, arp_r = np.zeros(N), np.zeros(N)

for b in range(bars):
    t0 = b * BAR
    root, chord = PROG[b % 4]
    i0, i1 = int(t0 * SR), min(int((t0 + BAR) * SR), N)
    n = i1 - i0
    if n <= 0:
        break
    # supersaw pad, detuned voices spread across the stereo field
    for m in chord:
        for d, side in ((-0.12, 0), (-0.05, 1), (0.0, 0), (0.05, 1), (0.12, 0)):
            v = saw(midi(m + d), n, rng.random()) * 0.045
            (pad_l if side == 0 else pad_r)[i0:i1] += v
            (pad_r if side == 0 else pad_l)[i0:i1] += v * 0.4
    # bass: offbeat-driving 8ths once the drop hits
    if t0 >= DROP - 1e-6 and t0 < FINALE:
        for e in range(8):
            ts = t0 + e * BEAT / 2
            ln = int(BEAT / 2 * 0.85 * SR)
            x = np.arange(ln) / SR
            note = root + (12 if e in (3, 7) else 0)
            s = (saw(midi(note), ln) * 0.6 + np.sin(2 * np.pi * midi(note - 12) * x) * 0.6) * np.exp(-x / 0.25)
            j = int(ts * SR)
            bass[j : j + len(s)][: N - j] += s[: N - j]
    # arp: 16th notes through the chord, up then down
    pattern = chord + chord[::-1][1:3] + [chord[0] + 12]
    for s16 in range(16):
        ts = t0 + s16 * BEAT / 4
        ln = int(0.18 * SR)
        x = np.arange(ln) / SR
        m = pattern[s16 % len(pattern)] + 12
        note = (np.sign(np.sin(2 * np.pi * midi(m) * x)) * 0.3 + saw(midi(m), ln) * 0.5) * np.exp(-x / 0.06)
        j = int(ts * SR)
        if j >= N:
            break
        e = min(ln, N - j)
        arp_l[j : j + e] += note[:e] * (0.6 if s16 % 2 else 1.0)
        arp_r[j : j + e] += note[:e] * (1.0 if s16 % 2 else 0.6)

bass = lp(bass, 420, 4) * 0.55
pad_l, pad_r = lp(pad_l, 2600), lp(pad_r, 2600)
arp_l, arp_r = lp(arp_l, 5200), lp(arp_r, 5200)
# ping-pong delay on the arp, dotted eighth
dly = int(BEAT * 0.75 * SR)
arp_l[dly:] += arp_r[:-dly] * 0.35
arp_r[dly:] += arp_l[:-dly] * 0.35

# intro opens up: pad dark → bright, arp fades in
t_axis = np.arange(N) / SR
dark_l, dark_r = lp(pad_l, 600), lp(pad_r, 600)
openness = np.clip(t_axis / DROP, 0, 1) ** 1.5
pad_l = dark_l * (1 - openness) + pad_l * openness
pad_r = dark_r * (1 - openness) + pad_r * openness
arp_gain = np.where(t_axis < DROP, 0.25 + 0.5 * t_axis / DROP, 1.0)
# breakdown: drums drop out, the arp carries it
arp_gain = np.where((t_axis >= BREAK[0]) & (t_axis < BREAK[1]), 1.1, arp_gain)

L += bass * pump + pad_l * pump * 0.9 + arp_l * arp_gain * pump * 0.28
R += bass * pump + pad_r * pump * 0.9 + arp_r * arp_gain * pump * 0.28

# risers and hits on the section changes
add(riser(DROP - 2 * BAR), 2 * BAR, 1.0)
add(riser(BREAK[1] - BREAK[0]), BREAK[0], 1.0)
add(CR, DROP, 1.0)
add(impact(), DROP, 0.6)
add(CR, BREAK[1], 1.0)
add(riser(2 * BAR), FINALE - 2 * BAR, 0.8)

# finale: impact + the tonic chord held under the logo, fading to silence
add(impact(), FINALE, 0.9)
add(CR, FINALE, 1.0)
tail = TOTAL - FINALE
n = int(tail * SR)
x = np.arange(n) / SR
chord = sum(saw(midi(m + d), n, rng.random()) for m in (45, 57, 60, 64, 69) for d in (-0.08, 0.0, 0.08))
chord = lp(chord, 1800) * 0.05 * np.exp(-x / 1.6)
add(chord, FINALE, 1.0, pan=0.0)

# gentle fade in and out, then master: soft clip and normalise
fade = np.clip(t_axis / 0.5, 0, 1) * np.clip((TOTAL - t_axis) / 1.0, 0, 1)
L *= fade
R *= fade
mix = np.stack([L, R], axis=1)
mix = np.tanh(mix / np.max(np.abs(mix)) * 1.6)
mix = mix / np.max(np.abs(mix)) * 0.89

wav = OUT.replace('.mp3', '.wav')
with wave.open(wav, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '192k', OUT], check=True)
os.remove(wav)
print(f'wrote {OUT} ({TOTAL:.1f} s)')
