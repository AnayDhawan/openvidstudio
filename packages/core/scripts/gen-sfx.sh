#!/bin/bash
# Generate synthesized UI SFX into public/sfx/ (no licensing, fully reproducible).
# Swap any file for a real recorded pack later, sfx.tsx API stays identical.
set -e
cd "$(dirname "$0")/.."
mkdir -p public/sfx

# Mechanical key thocks: filtered brown-noise bursts, 3 pitch variations
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.06:c=brown:a=0.9" \
  -af "highpass=f=180,lowpass=f=2400,afade=t=in:d=0.004,afade=t=out:st=0.025:d=0.035,volume=3.2" \
  public/sfx/key_a.wav
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.055:c=brown:a=0.9:seed=7" \
  -af "highpass=f=200,lowpass=f=1900,afade=t=in:d=0.004,afade=t=out:st=0.022:d=0.033,volume=3.4" \
  public/sfx/key_b.wav
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.065:c=brown:a=0.9:seed=23" \
  -af "highpass=f=160,lowpass=f=2900,afade=t=in:d=0.004,afade=t=out:st=0.028:d=0.037,volume=3.0" \
  public/sfx/key_c.wav

# Click: sharp short tick
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.03:c=white:a=0.8" \
  -af "highpass=f=1400,lowpass=f=6500,afade=t=in:d=0.002,afade=t=out:st=0.01:d=0.02,volume=2.2" \
  public/sfx/click.wav

# Whoosh: bandpassed pink noise swell
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.55:c=pink:a=0.8" \
  -af "bandpass=f=650:w=500,afade=t=in:d=0.18,afade=t=out:st=0.25:d=0.3,volume=2.6" \
  public/sfx/whoosh.wav

# Blip: soft sine tick for UI reveals
ffmpeg -v error -y -f lavfi -i "sine=frequency=740:duration=0.07" \
  -af "afade=t=in:d=0.008,afade=t=out:st=0.03:d=0.04,volume=0.9" \
  public/sfx/blip.wav

# Success: rising two-tone
ffmpeg -v error -y \
  -f lavfi -i "sine=frequency=660:duration=0.09" \
  -f lavfi -i "sine=frequency=990:duration=0.14" \
  -filter_complex "[0]afade=t=out:st=0.05:d=0.04[a];[1]afade=t=in:d=0.01,afade=t=out:st=0.08:d=0.06[b];[a][b]concat=n=2:v=0:a=1,volume=0.9" \
  public/sfx/success.wav

echo "SFX generated:"
ls public/sfx/

# Bell: struck metallic tone, harmonic stack with a long decay
ffmpeg -v error -y \
  -f lavfi -i "sine=frequency=1568:duration=1.6" \
  -f lavfi -i "sine=frequency=2350:duration=1.6" \
  -f lavfi -i "sine=frequency=3136:duration=1.6" \
  -filter_complex "[0]volume=1.0[a];[1]volume=0.45[b];[2]volume=0.22[c];[a][b][c]amix=inputs=3:normalize=0,afade=t=in:d=0.004,afade=t=out:st=0.12:d=1.45,volume=1.2" \
  public/sfx/bell.wav

# Enter key: deeper, heavier thock than a letter key
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.085:c=brown:a=0.95:seed=41" \
  -af "highpass=f=110,lowpass=f=1500,afade=t=in:d=0.004,afade=t=out:st=0.03:d=0.05,volume=3.6" \
  public/sfx/key_enter.wav

# Music bed: slow ambient pad, two detuned sines under a filtered noise wash.
# Synthesized rather than licensed, so a generated video carries no third-party
# audio rights. 60s, loop it for longer videos.
ffmpeg -v error -y \
  -f lavfi -i "sine=frequency=110:duration=60" \
  -f lavfi -i "sine=frequency=164.81:duration=60" \
  -f lavfi -i "sine=frequency=220.5:duration=60" \
  -f lavfi -i "anoisesrc=d=60:c=pink:a=0.06" \
  -filter_complex "\
    [0]volume=0.34,tremolo=f=0.11:d=0.30[p1];\
    [1]volume=0.20,tremolo=f=0.13:d=0.26[p2];\
    [2]volume=0.13,tremolo=f=0.17:d=0.35[p3];\
    [3]lowpass=f=900,volume=0.5[air];\
    [p1][p2][p3][air]amix=inputs=4:normalize=0,\
    lowpass=f=2600,afade=t=in:d=3,afade=t=out:st=56:d=4,volume=0.5" \
  public/sfx/music-bed.wav

echo "generated: $(ls public/sfx | wc -l) files in public/sfx/"
