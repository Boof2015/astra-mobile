#!/usr/bin/env python3
"""Verify persistent R8 settings and the reports accompanying an Android candidate."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile

REPORT_FILES = ('mapping.txt', 'configuration.txt', 'seeds.txt', 'usage.txt', 'resources.txt')
R8_METADATA = 'BUNDLE-METADATA/com.android.tools/r8.json'
MAPPING_METADATA = 'BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map'
DISABLING_RULE = re.compile(r'^\s*-(dontoptimize|dontobfuscate|dontshrink)\b', re.MULTILINE)
DEX_THRESHOLD_BYTES = 10_000_000


def verify_r8_metadata(metadata, dex_bytes):
    if not isinstance(metadata, dict) or not metadata:
        raise ValueError('R8 metadata must be a nonempty JSON object.')
    options = metadata.get('options', {})
    for key in ('isObfuscationEnabled', 'isOptimizationsEnabled', 'isShrinkingEnabled'):
        if options.get(key) is not True:
            raise ValueError(f'R8 metadata does not enable {key}.')
    if metadata.get('resourceOptimization', {}).get('isOptimizedShrinkingEnabled') is not True:
        raise ValueError('R8 metadata does not enable optimized resource shrinking.')
    percentages = {}
    for name, key in (('obfuscation', 'noObfuscationPercentage'),
                      ('optimization', 'noOptimizationPercentage'),
                      ('shrinking', 'noShrinkingPercentage')):
        excluded = metadata.get('stats', {}).get(key)
        if type(excluded) not in (int, float) or not 0 <= excluded <= 100:
            raise ValueError(f'R8 metadata lacks a valid {key}; review the toolchain report format.')
        percentages[name] = round(100 - excluded, 2)
        if dex_bytes >= DEX_THRESHOLD_BYTES and excluded > 75:
            raise ValueError(f'R8 {name} coverage {percentages[name]}% is below the required 25%.')
    return percentages


def verify_generated(android_root):
    root = Path(android_root)
    properties = (root / 'gradle.properties').read_text()
    for key in ('android.enableMinifyInReleaseBuilds',
                'android.enableShrinkResourcesInReleaseBuilds',
                'android.r8.optimizedResourceShrinking'):
        values = re.findall(r'^\s*' + re.escape(key) + r'\s*=\s*(\S+)\s*$', properties, re.MULTILINE)
        if values != ['true']:
            raise ValueError(f'{key} must be enabled exactly once after prebuild.')
    gradle = (root / 'app/build.gradle').read_text()
    if (len(re.findall(r'getDefaultProguardFile\([\'"]proguard-android-optimize\.txt[\'"]\)', gradle)) != 1
            or 'proguard-android.txt' in gradle
            or 'minifyEnabled enableMinifyInReleaseBuilds' not in gradle
            or 'shrinkResources enableShrinkResources.toBoolean()' not in gradle
            or 'initWith release' not in gradle):
        raise ValueError('Release and preview must use the optimizing R8 configuration after prebuild.')
    keep = ET.parse(root / 'app/src/main/res/raw/astra_notification_keep.xml').getroot()
    retained = set(keep.get('{http://schemas.android.com/tools}keep', '').split(','))
    if not {'@drawable/astra_notification_icon', '@drawable/exo_notification_small_icon'} <= retained:
        raise ValueError('Notification resources looked up by name must be explicitly retained.')
    rules = (root / 'app/proguard-rules.pro').read_text()
    if rules.count('-keep class expo.modules.kotlin.records.** { *; }') != 1:
        raise ValueError('Expo record-conversion compatibility rule must survive prebuild exactly once.')


def verify_artifact(artifact, mapping_dir, r8_metadata=None):
    artifact, mapping_dir = Path(artifact), Path(mapping_dir)
    for name in REPORT_FILES:
        if not (mapping_dir / name).is_file():
            raise ValueError(f'Missing R8 report: {name}')
    config = (mapping_dir / 'configuration.txt').read_text()
    disabled = DISABLING_RULE.search(config)
    if disabled:
        raise ValueError(f'R8 is globally disabled by {disabled.group(0).strip()}.')
    mapping = (mapping_dir / 'mapping.txt').read_bytes()
    classes = re.findall(r'^(\S+) -> (\S+):$', mapping.decode(), re.MULTILINE)
    if not any(before != after for before, after in classes):
        raise ValueError('R8 mapping contains no obfuscated classes.')
    with ZipFile(artifact) as archive:
        dex = [entry for entry in archive.infolist() if entry.filename.endswith('.dex')]
        if not dex:
            raise ValueError('Android artifact contains no DEX code.')
        dex_bytes = sum(entry.file_size for entry in dex)
        if artifact.suffix == '.aab':
            for name in (R8_METADATA, MAPPING_METADATA):
                if name not in archive.namelist():
                    raise ValueError(f'AAB is missing {name}.')
            if archive.read(MAPPING_METADATA) != mapping:
                raise ValueError('AAB mapping differs from the retained mapping.txt; reports may be stale.')
            metadata = json.loads(archive.read(R8_METADATA))
        else:
            if r8_metadata is None:
                raise ValueError('APK verification requires --r8-metadata from the same build.')
            metadata = json.loads(Path(r8_metadata).read_bytes())
            map_id = re.search(rb'^# pg_map_id: (\S+)$', mapping, re.MULTILINE)
            if map_id is None:
                raise ValueError('APK mapping is missing its R8 map ID.')
            for entry in dex:
                markers = re.findall(rb'~~R8(\{[^\x00]*\})', archive.read(entry))
                if not any(json.loads(marker).get('pg-map-id') == map_id[1].decode() for marker in markers):
                    raise ValueError('APK DEX map ID differs from mapping.txt; reports may be stale.')
        percentages = verify_r8_metadata(metadata, dex_bytes)
        reported_dex = list(metadata.get('dexFiles', []))
        for split in metadata.get('featureSplits', {}).get('featureSplits', []):
            reported_dex.extend(split.get('dexFiles', []))
        checksums = sorted(hashlib.sha256(archive.read(entry)).hexdigest() for entry in dex)
        if sorted(entry.get('checksum', '') for entry in reported_dex) != checksums:
            raise ValueError('R8 metadata DEX checksums differ from the artifact; reports may be stale.')
        return {
            'artifact': artifact.name,
            'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest(),
            'dexFiles': len(dex),
            'dexBytesUncompressed': dex_bytes,
            'mappingSha256': hashlib.sha256(mapping).hexdigest(),
            'r8CoveragePercent': percentages,
            'r8': metadata,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    generated = commands.add_parser('generated')
    generated.add_argument('android_root', nargs='?', type=Path, default=Path('android'))
    artifact = commands.add_parser('artifact')
    artifact.add_argument('path', type=Path)
    artifact.add_argument('--mapping-dir', required=True, type=Path)
    artifact.add_argument('--r8-metadata', type=Path, help='APK only: matching intermediates/r8_metadata/<variant>/minify<Variant>WithR8/r8-metadata.dat')
    args = parser.parse_args()
    if args.command == 'generated':
        verify_generated(args.android_root)
        print('Verified release/preview R8 settings and notification resource keeps.')
    else:
        print(json.dumps(verify_artifact(args.path, args.mapping_dir, args.r8_metadata), indent=2))


if __name__ == '__main__':
    main()
