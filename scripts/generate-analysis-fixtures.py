"""Deterministic audio for decoder correctness and opt-in phone benchmarks.

python3 scripts/generate-analysis-fixtures.py [output-directory] [duration-seconds]
Small checked-in fixtures use 1.3 seconds. Benchmark assets should go under /tmp.
Requires ffmpeg only when generating fixtures, never at application build/runtime.
"""
from pathlib import Path
import math
import struct
import subprocess
import sys
import wave

out = Path(sys.argv[1] if len(sys.argv) > 1 else 'test/fixtures/analysis')
duration = float(sys.argv[2]) if len(sys.argv) > 2 else 1.3
out.mkdir(parents=True, exist_ok=True)
rate = 48000
frames = int(rate * duration)
with wave.open(str(out / 'signal.wav'), 'wb') as target:
    target.setparams((2, 2, rate, 0, 'NONE', 'not compressed'))
    for start in range(0, frames, 4096):
        data = bytearray()
        for i in range(start, min(start + 4096, frames)):
            t = i / rate
            envelope = [0.02, 0.3, 0.7, 0.15][min(3, int(i * 4 / frames))]
            left = envelope * (0.62 * math.sin(t * 2 * math.pi * 431) + 0.2 * math.sin(t * 2 * math.pi * 7823))
            right = envelope * (0.5 * math.sin(t * 2 * math.pi * 173) + 0.3 * math.sin(t * 2 * math.pi * 3029))
            data.extend(struct.pack('<hh', round(left * 32767), round(right * 32767)))
        target.writeframesraw(data)
for extension, codec, extra in [
    ('flac', 'flac', []), ('mp3', 'libmp3lame', ['-q:a', '2']),
    ('m4a', 'aac', ['-b:a', '128k']),
]:
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(out / 'signal.wav'),
                    '-c:a', codec, *extra, str(out / ('signal.' + extension))], check=True)
if duration < 2:
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(out / 'signal.wav'),
                    '-c:a', 'libmp3lame', '-b:a', '192k', '-write_xing', '0', str(out / 'no-xing.mp3')], check=True)
print(f'Generated {duration:g}s analysis fixtures in {out}')
