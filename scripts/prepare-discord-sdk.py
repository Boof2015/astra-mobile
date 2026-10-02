#!/usr/bin/env python3
"""Verify and privately stage the pinned Discord Social SDK's Android AAR.

Local: python3 scripts/prepare-discord-sdk.py /path/to/DiscordSocialSdk-1.10.19337.zip
CI:    python3 scripts/prepare-discord-sdk.py --from-directory /private/sdk-checkout
Set ASTRA_DISCORD_ENABLED=false to build without Discord's proprietary SDK.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from zipfile import ZipFile, BadZipFile

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / 'discord-sdk.lock.json'
PROVENANCE_KEYS = ('version', 'archiveName', 'archiveSha256', 'aarSha256', 'noticesSha256')


def sha256_file(path):
    with Path(path).open('rb') as source:
        checksum = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            checksum.update(chunk)
        return checksum.hexdigest()


def stage(archive_path, destination, lock):
    if sha256_file(archive_path) != lock['archiveSha256']:
        raise ValueError('SDK archive checksum differs from discord-sdk.lock.json.')
    with ZipFile(archive_path) as archive:
        # Read only these two members; never extract untrusted ZIP paths.
        aar = archive.read(lock['aarPath'])
        notices = archive.read(lock['noticesPath'])
    write_staged(aar, notices, destination, lock)


def write_staged(aar, notices, destination, lock):
    for data, key in ((aar, 'aarSha256'), (notices, 'noticesSha256')):
        if hashlib.sha256(data).hexdigest() != lock[key]:
            raise ValueError(f'SDK {key} does not match the pinned release.')
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    (destination / 'discord_partner_sdk.aar').write_bytes(aar)
    notice_dir = destination / 'assets' / 'notices' / 'discord'
    notice_dir.mkdir(parents=True, exist_ok=True)
    (notice_dir / 'License-Notices.txt').write_bytes(notices)
    provenance = {key: lock[key] for key in PROVENANCE_KEYS}
    (destination / 'sdk-origin.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(f"Verified and staged Discord Social SDK {lock['version']} (Android release AAR and notices).")


def stage_directory(source, destination, lock):
    source = Path(source)
    provenance = json.loads((source / 'sdk-origin.json').read_text())
    if any(provenance.get(key) != lock[key] for key in PROVENANCE_KEYS):
        raise ValueError('Private SDK provenance differs from discord-sdk.lock.json.')
    # Copy only verified build inputs, never the private checkout or its .git data.
    write_staged(
        (source / 'discord_partner_sdk.aar').read_bytes(),
        (source / 'assets/notices/discord/License-Notices.txt').read_bytes(),
        destination, lock,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, nargs='?')
    parser.add_argument('--from-directory', type=Path, help='Private checkout containing the previously verified AAR, notices, and provenance.')
    parser.add_argument('--output-dir', type=Path, default=Path(os.environ.get('ASTRA_DISCORD_SDK_DIR', ROOT / '.local' / 'discord-sdk')))
    args = parser.parse_args()
    if bool(args.archive) == bool(args.from_directory):
        parser.error('Provide an archive path OR --from-directory, not both.')
    lock = json.loads(LOCK.read_text())
    try:
        if args.archive:
            stage(args.archive, args.output_dir, lock)
        else:
            stage_directory(args.from_directory, args.output_dir, lock)
    except (OSError, ValueError, KeyError, BadZipFile):
        parser.exit(1, 'Could not stage the pinned SDK: check the archive or private checkout against discord-sdk.lock.json.\n')


if __name__ == '__main__':
    main()
