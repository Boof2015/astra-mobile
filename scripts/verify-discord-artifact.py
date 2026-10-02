#!/usr/bin/env python3
"""Check that candidates contain the pinned SDK and all required legal texts."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
LEGAL_FILES = ('LICENSE', 'LICENSE-DISCORD-EXCEPTION')


def check_source_files(files):
    for name in files:
        path = Path(name)
        if (path.name in {'discord_partner_sdk.aar', 'discordpp.h', 'discord.h'}
                or path.name.startswith(('libdiscord_partner_sdk.', 'discord_partner_sdk.'))
                or (path.name.startswith('DiscordSocialSdk') and path.suffix == '.zip')
                or '.local' in path.parts):
            raise ValueError(f'Proprietary SDK material must not be tracked: {name}')


def verify(artifact, lock, expected_abis, sdk_enabled=True, root=ROOT):
    with ZipFile(artifact) as archive:
        names = set(archive.namelist())
        prefix = 'base/' if str(artifact).endswith('.aab') else ''
        def require_bytes(name, expected):
            if archive.read(prefix + name) != expected:
                raise ValueError(f'Packaged legal document differs from source: {name}')
        for name in LEGAL_FILES:
            require_bytes('assets/notices/astra/' + name, (root / name).read_bytes())
        sdk_libraries = {name for name in names if name.endswith('/libdiscord_partner_sdk.so')}
        if not sdk_enabled:
            if sdk_libraries or any('/notices/discord/' in name or name.endswith(('/DISCORD-SDK-NOTICE.txt', '/libastra_discord.so')) for name in names):
                raise ValueError('SDK-free app contains Discord SDK material.')
            return
        expected_names = {prefix + f'lib/{abi}/libdiscord_partner_sdk.so' for abi in expected_abis}
        if sdk_libraries != expected_names:
            raise ValueError('Discord SDK is missing or contains unexpected ABIs.')
        for abi in expected_abis:
            data = archive.read(prefix + f'lib/{abi}/libdiscord_partner_sdk.so')
            if hashlib.sha256(data).hexdigest() != lock['libraries'][f'jni/{abi}/libdiscord_partner_sdk.so']:
                raise ValueError(f'Discord SDK library differs from the pinned binary: {abi}')
            if prefix + f'lib/{abi}/libastra_discord.so' not in names:
                raise ValueError(f'Astra Discord JNI bridge is missing: {abi}')
        require_bytes('assets/notices/astra/DISCORD-SDK-NOTICE.txt', (root / 'DISCORD-SDK-NOTICE.txt').read_bytes())
        notices = archive.read(prefix + 'assets/notices/discord/License-Notices.txt')
        if hashlib.sha256(notices).hexdigest() != lock['noticesSha256']:
            raise ValueError('Discord third-party notices differ from the pinned SDK.')
        if any('krisp' in name.lower() or name.endswith(('.aar', '/discordpp.h', '/discord.h')) for name in names):
            raise ValueError('App contains an unexpected SDK component or development archive.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact', nargs='?', type=Path)
    parser.add_argument('--abis', default='armeabi-v7a,arm64-v8a')
    parser.add_argument('--sdk-free', action='store_true')
    args = parser.parse_args()
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    check_source_files(filter(None, tracked))
    if args.artifact:
        verify(args.artifact, json.loads((ROOT / 'discord-sdk.lock.json').read_text()), args.abis.split(','), not args.sdk_free)
    print('Verified Discord source/package boundaries and required notices.')


if __name__ == '__main__':
    main()
