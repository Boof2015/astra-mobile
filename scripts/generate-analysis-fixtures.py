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
    ('m4a', 'aac', ['-b:a', '128k']), ('opus', 'libopus', ['-b:a', '128k']),
]:
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(out / 'signal.wav'),
                    '-c:a', codec, *extra, str(out / ('signal.' + extension))], check=True)
if duration < 2:
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(out / 'signal.wav'),
                    '-c:a', 'libmp3lame', '-b:a', '192k', '-write_xing', '0', str(out / 'no-xing.mp3')], check=True)
    for name, options in [
        ('mono', ['-ac', '1', '-ar', '16000', '-application', 'voip', '-b:a', '16k', '-frame_duration', '60']),
        ('surround', ['-af', 'pan=5.1|FL=c0|FR=c1|FC=0.5*c0+0.5*c1|LFE=0*c0|BL=c0|BR=c1']),
        ('long-packet', ['-frame_duration', '120']),
        ('short', ['-t', '0.003']),
        ('silent', ['-af', 'volume=0']),
    ]:
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(out / 'signal.wav'),
                        '-c:a', 'libopus', '-b:a', '128k', *options, str(out / (name + '.opus'))], check=True)
    # Keep normalization tags distinct from the mandatory Opus header output gain.
    tagged = out / 'gain.opus'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(out / 'signal.opus'),
                    '-c:a', 'copy', '-metadata', 'R128_TRACK_GAIN=-1536',
                    '-metadata', 'R128_ALBUM_GAIN=-3072', str(tagged)], check=True)
    data = bytearray(tagged.read_bytes())
    header_size = 27 + data[26]
    page_size = header_size + sum(data[27:header_size])
    assert data[header_size:header_size + 8] == b'OpusHead'
    struct.pack_into('<h', data, header_size + 16, -6 * 256)
    data[22:26] = bytes(4)
    crc = 0
    for byte in data[:page_size]:
        crc ^= byte << 24
        for _ in range(8):
            crc = ((crc << 1) ^ (0x04c11db7 if crc & 0x80000000 else 0)) & 0xffffffff
    struct.pack_into('<I', data, 22, crc)
    tagged.write_bytes(data)
print(f'Generated {duration:g}s analysis fixtures in {out}')
