import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prepare = load_script('prepare-discord-sdk')
verify = load_script('verify-discord-artifact')
sha = lambda data: hashlib.sha256(data).hexdigest()


class DiscordDistributionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.archive = self.root / 'sdk.zip'
        self.aar, self.notices, self.library = b'unmodified AAR', b'upstream copyright and notices\n', b'pinned native library'
        self.lock = {
            'version': 'fixture', 'archiveName': 'fixture.zip',
            'aarPath': 'sdk/android.aar', 'aarSha256': sha(self.aar),
            'noticesPath': 'sdk/notices.txt', 'noticesSha256': sha(self.notices),
            'libraries': {'jni/arm64-v8a/libdiscord_partner_sdk.so': sha(self.library)},
        }
        with ZipFile(self.archive, 'w') as archive:
            archive.writestr(self.lock['aarPath'], self.aar)
            archive.writestr(self.lock['noticesPath'], self.notices)
            archive.writestr('../must-not-extract', b'ignored')
            archive.writestr('sdk/unused-voice.aar', b'ignored')
        self.lock['archiveSha256'] = prepare.sha256_file(self.archive)
        self.destination = self.root / 'staging'
        for name in (*verify.LEGAL_FILES, 'DISCORD-SDK-NOTICE.txt'):
            (self.root / name).write_text(f'Legal text: {name}')

    def package(self, extension='apk', sdk=True, omit=None, replacement=None):
        prefix = 'base/' if extension == 'aab' else ''
        entries = {f'assets/notices/astra/{name}': (self.root / name).read_bytes() for name in verify.LEGAL_FILES}
        if sdk:
            entries.update({
                'assets/notices/astra/DISCORD-SDK-NOTICE.txt': (self.root / 'DISCORD-SDK-NOTICE.txt').read_bytes(),
                'assets/notices/discord/License-Notices.txt': self.notices,
                'lib/arm64-v8a/libdiscord_partner_sdk.so': self.library,
                'lib/arm64-v8a/libastra_discord.so': b'our bridge',
            })
        entries.pop(omit, None)
        entries.update(replacement or {})
        path = self.root / f'app.{extension}'
        with ZipFile(path, 'w') as archive:
            for name, data in entries.items():
                archive.writestr(prefix + name, data)
        return path

    def verify_package(self, path, sdk=True):
        verify.verify(path, self.lock, ['arm64-v8a'], sdk, self.root)

    def test_staging_preserves_notices_and_aar_only(self):
        prepare.stage(self.archive, self.destination, self.lock)
        self.assertEqual((self.destination / 'discord_partner_sdk.aar').read_bytes(), self.aar)
        self.assertEqual((self.destination / 'assets/notices/discord/License-Notices.txt').read_bytes(), self.notices)
        files = {p.relative_to(self.destination).as_posix() for p in self.destination.rglob('*') if p.is_file()}
        self.assertEqual(files, {'discord_partner_sdk.aar', 'assets/notices/discord/License-Notices.txt', 'sdk-origin.json'})
        self.assertFalse((self.root / 'must-not-extract').exists())
        origin = json.loads((self.destination / 'sdk-origin.json').read_text())
        self.assertEqual(origin['version'], 'fixture')
        self.assertNotIn('url', origin)

    def test_changed_archive_rejected_before_staging(self):
        with self.archive.open('ab') as file:
            file.write(b'tampered')
        with self.assertRaisesRegex(ValueError, 'archive checksum'):
            prepare.stage(self.archive, self.destination, self.lock)
        self.assertFalse(self.destination.exists())

    def test_changed_aar_or_notice_pin_rejected(self):
        for key in ('aarSha256', 'noticesSha256'):
            with self.subTest(key=key):
                lock = copy.deepcopy(self.lock)
                lock[key] = '0' * 64
                with self.assertRaisesRegex(ValueError, key):
                    prepare.stage(self.archive, self.destination, lock)
                self.assertFalse(self.destination.exists())

    def test_private_checkout_copies_only_verified_inputs(self):
        prepare.stage(self.archive, self.destination, self.lock)
        (self.destination / '.git').mkdir()
        (self.destination / '.git/config').write_text('private checkout configuration')
        (self.destination / 'unrelated-file').write_text('do not stage')
        output = self.root / 'ci-staging'
        prepare.stage_directory(self.destination, output, self.lock)
        files = {p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}
        self.assertEqual(files, {'discord_partner_sdk.aar', 'assets/notices/discord/License-Notices.txt', 'sdk-origin.json'})
        self.assertEqual((output / 'discord_partner_sdk.aar').read_bytes(), self.aar)
        self.assertEqual((output / 'assets/notices/discord/License-Notices.txt').read_bytes(), self.notices)

    def test_private_checkout_rejects_tampered_inputs(self):
        for name in ('discord_partner_sdk.aar', 'assets/notices/discord/License-Notices.txt'):
            with self.subTest(name=name):
                prepare.stage(self.archive, self.destination, self.lock)
                (self.destination / name).write_bytes(b'tampered')
                output = self.root / 'rejected-staging'
                with self.assertRaises(ValueError):
                    prepare.stage_directory(self.destination, output, self.lock)
                self.assertFalse(output.exists())

    def test_private_checkout_rejects_another_sdk_version(self):
        prepare.stage(self.archive, self.destination, self.lock)
        origin = self.destination / 'sdk-origin.json'
        provenance = json.loads(origin.read_text())
        provenance['version'] = 'wrong-version'
        origin.write_text(json.dumps(provenance))
        output = self.root / 'rejected-staging'
        with self.assertRaisesRegex(ValueError, 'provenance'):
            prepare.stage_directory(self.destination, output, self.lock)
        self.assertFalse(output.exists())

    def test_apk_and_aab_have_pinned_libraries_and_legal_texts(self):
        for extension in ('apk', 'aab'):
            with self.subTest(extension=extension):
                self.verify_package(self.package(extension))

    def test_library_or_notice_changes_rejected(self):
        for name in ('lib/arm64-v8a/libdiscord_partner_sdk.so', 'assets/notices/discord/License-Notices.txt', 'assets/notices/astra/LICENSE-DISCORD-EXCEPTION'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.verify_package(self.package(replacement={name: b'changed'}))

    def test_missing_bridge_or_abi_rejected(self):
        for name in ('lib/arm64-v8a/libastra_discord.so', 'lib/arm64-v8a/libdiscord_partner_sdk.so'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.verify_package(self.package(omit=name))

    def test_missing_upstream_notices_rejected(self):
        with self.assertRaises(KeyError):
            self.verify_package(self.package(omit='assets/notices/discord/License-Notices.txt'))

    def test_unexpected_abi_or_voice_component_rejected(self):
        for name in ('lib/x86/libdiscord_partner_sdk.so', 'lib/arm64-v8a/libkrisp.so', 'assets/discord_partner_sdk.aar'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.verify_package(self.package(replacement={name: b'unwanted'}))

    def test_sdk_free_rejects_accidental_sdk_inclusion(self):
        self.verify_package(self.package(sdk=False), sdk=False)
        with self.assertRaises(ValueError):
            self.verify_package(self.package(), sdk=False)

    def test_source_boundary_rejects_sdk_files(self):
        verify.check_source_files(['modules/astra-discord/cpp/discord_jni.cpp', 'LICENSE-DISCORD-EXCEPTION'])
        for name in ('vendor/discord_partner_sdk.aar', 'include/discordpp.h', 'lib/libdiscord_partner_sdk.so', 'DiscordSocialSdk-1.10.zip', '.local/discord-sdk/sdk-origin.json'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                verify.check_source_files([name])


if __name__ == '__main__':
    unittest.main()
