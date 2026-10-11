#!/usr/bin/env python3
"""Reject Android candidates with incompatible native ELF or ZIP page alignment.

Uses only Python's standard library for ELF/APK inspection. AABs also require
Google's bundletool (--bundletool or ASTRA_BUNDLETOOL_JAR) to read BundleConfig.
Runtime testing on a 16 KB device is still required; alignment is not a test of
native code that makes its own assumptions about memory page size.
"""
import argparse
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
from zipfile import BadZipFile, ZipFile, ZIP_STORED

PAGE = 16384
MACHINES = {'arm64-v8a': 183, 'x86_64': 62}


def check_elf(data, abi):
    """Check ELF64 LOADs and actual writable overlap with rounded RELRO pages."""
    if len(data) < 64 or data[:6] != b'\x7fELF\x02\x01':
        raise ValueError('expected a little-endian ELF64 library')
    if struct.unpack_from('<H', data, 18)[0] != MACHINES[abi]:
        raise ValueError(f'ELF machine does not match {abi}')
    offset = struct.unpack_from('<Q', data, 32)[0]
    size, count = struct.unpack_from('<HH', data, 54)
    if size < 56 or not count or offset + size * count > len(data):
        raise ValueError('invalid ELF program-header table')
    headers = [struct.unpack_from('<IIQQQQQQ', data, offset + i * size) for i in range(count)]
    loads = [h for h in headers if h[0] == 1]
    if not loads:
        raise ValueError('ELF has no LOAD segments')
    for h in loads:
        _, _, file_offset, address, _, file_size, memory_size, alignment = h
        if alignment < PAGE or alignment & (alignment - 1):
            raise ValueError(f'LOAD alignment {alignment} is not a power of two >= {PAGE}')
        if file_offset % PAGE != address % PAGE:
            raise ValueError('LOAD file offset and virtual address disagree at 16 KB')
        if file_size > memory_size or file_offset + file_size > len(data):
            raise ValueError('invalid LOAD segment size')

    # Android rounds RELRO protection outward. An unaligned end is safe when
    # the remaining bytes are padding before the next writable LOAD (as in
    # current Hermes/RN prebuilts). Reject writable data, not harmless padding.
    # See bionic/linker/linker_phdr.cpp: _phdr_table_set_gnu_relro_prot.
    for h in headers:
        if h[0] != 0x6474e552 or not h[6]:
            continue
        start, end = h[3], h[3] + h[6]
        rounded_start = start // PAGE * PAGE
        rounded_end = (end + PAGE - 1) // PAGE * PAGE
        for load in loads:
            if not load[1] & 2:
                continue
            a, b = load[3], load[3] + load[6]
            if max(a, rounded_start) < min(b, start) or max(a, end) < min(b, rounded_end):
                raise ValueError('16 KB RELRO protection overlaps writable data')


def check_bundle_config(config):
    native = config.get('optimizations', {}).get('uncompressNativeLibraries', {})
    if native.get('enabled') is not True or native.get('alignment') != 'PAGE_ALIGNMENT_16K':
        raise ValueError('AAB must request uncompressed native libraries with PAGE_ALIGNMENT_16K')


def verify(artifact, expected_abis=('armeabi-v7a', 'arm64-v8a'), bundletool=None):
    artifact = Path(artifact)
    if artifact.suffix not in ('.apk', '.aab'):
        raise ValueError('expected an .apk or .aab')
    bundle = artifact.suffix == '.aab'
    errors = []
    seen = set()
    checked = 0
    with ZipFile(artifact) as archive, artifact.open('rb') as raw:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('archive contains duplicate entries')
        for entry in archive.infolist():
            parts = entry.filename.split('/')
            # Include native libraries from every AAB module, not only base.
            library = (len(parts) == (4 if bundle else 3)
                       and parts[-3] == 'lib' and parts[-1].endswith('.so'))
            if not library:
                continue
            abi = parts[-2]
            seen.add(abi)
            try:
                if abi in MACHINES:
                    check_elf(archive.read(entry), abi)
                    checked += 1
                if not bundle and entry.compress_type == ZIP_STORED:
                    raw.seek(entry.header_offset)
                    header = raw.read(30)
                    if len(header) != 30 or header[:4] != b'PK\x03\x04':
                        raise ValueError('invalid ZIP local header')
                    name_size, extra_size = struct.unpack_from('<HH', header, 26)
                    data_offset = entry.header_offset + 30 + name_size + extra_size
                    if data_offset % PAGE:
                        raise ValueError(f'uncompressed library ZIP offset {data_offset} is not 16 KB aligned')
            except ValueError as error:
                errors.append(f'{entry.filename}: {error}')
    missing = set(expected_abis) - seen
    if missing:
        errors.append(f'Missing native ABIs: {", ".join(sorted(missing))}')
    if not checked and not errors:
        errors.append('No 64-bit native libraries were checked')
    if errors:
        raise ValueError('\n'.join(errors))
    if bundle:
        if not bundletool:
            raise ValueError('AAB verification requires --bundletool or ASTRA_BUNDLETOOL_JAR')
        result = subprocess.check_output([
            'java', '-jar', str(bundletool), 'dump', 'config', f'--bundle={artifact}',
        ], text=True)
        check_bundle_config(json.loads(result))
    return checked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact', type=Path)
    parser.add_argument('--abis', default='armeabi-v7a,arm64-v8a')
    parser.add_argument('--bundletool', type=Path, default=os.environ.get('ASTRA_BUNDLETOOL_JAR'))
    args = parser.parse_args()
    try:
        checked = verify(args.artifact, args.abis.split(','), args.bundletool)
    except (ValueError, OSError, BadZipFile, subprocess.CalledProcessError) as error:
        print(f'Android 16 KB verification failed:\n{error}', file=sys.stderr)
        return 1
    print(f'Verified 16 KB ELF and packaging alignment: {checked} 64-bit libraries in {args.artifact.name}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
