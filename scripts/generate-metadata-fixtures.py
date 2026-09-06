"""Generate silent container fixtures using ffmpeg and the fixture-only TagLib writer.

Usage: python3 scripts/generate-metadata-fixtures.py /path/to/metadata-fixture-writer
The APE header fixture is retained from TagLib's upstream tests (see fixture README).
"""
from pathlib import Path
import struct
import shutil
import subprocess
import sys
import zlib

root = Path(__file__).resolve().parent.parent / 'test/fixtures/metadata'
root.mkdir(parents=True, exist_ok=True)

def png(seed):
    # Incompressible deterministic pixels make the Opus picture span Ogg pages.
    state = seed
    rows = bytearray()
    for _ in range(192):
        rows.append(0)
        for _ in range(192 * 3):
            state = (state * 1664525 + 1013904223) & 0xffffffff
            rows.append(state >> 24)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 192, 192, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')

for name, seed in [('front.png', 17), ('back.png', 29)]:
    (root/name).write_bytes(png(seed))

formats = [('opus', 'libopus'), ('ogg', 'vorbis'), ('flac', 'flac'), ('mp3', 'libmp3lame'),
           ('m4a', 'aac'), ('alac.m4a', 'alac'), ('wav', 'pcm_s16le'), ('aiff', 'pcm_s16be'),
           ('aac', 'aac'), ('wv', 'wavpack'), ('wma', 'wmav2')]
for extension, codec in formats:
    target = root / ('tags.' + extension)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
                    '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0.15', '-c:a', codec, '-strict', '-2', str(target)], check=True)
    if extension == 'opus':
        shutil.copyfile(target, root/'untagged.opus')
    subprocess.run([sys.argv[1], str(target), str(root/'front.png'), str(root/'back.png')], check=True)
ape = root/'tags.ape'
if ape.exists():
    subprocess.run([sys.argv[1], str(ape), str(root/'front.png'), str(root/'back.png')], check=True)
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(root/'tags.mp3'),
                '-map', '0:a', '-c', 'copy', '-id3v2_version', '3', str(root/'tags-id3v23.mp3')], check=True)
for mode in ['aliases', 'malformed']:
    target = root/(mode + '.opus')
    shutil.copyfile(root/'untagged.opus', target)
    subprocess.run([sys.argv[1], str(target), str(root/'front.png'), str(root/'back.png'), mode], check=True)
