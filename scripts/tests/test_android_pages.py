import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

spec = importlib.util.spec_from_file_location('android_pages', Path(__file__).parents[1] / 'verify-android-pages.py')
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)


def load(address=0, size=0x1000, alignment=16384, flags=5, offset=None):
    return (1, flags, address if offset is None else offset, address, address, size, size, alignment)


def elf(headers=None, machine=183):
    headers = [load()] if headers is None else headers
    data = bytearray(0x10000)
    data[:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<H', data, 18, machine)
    struct.pack_into('<Q', data, 32, 64)
    struct.pack_into('<HH', data, 54, 56, len(headers))
    for i, header in enumerate(headers):
        struct.pack_into('<IIQQQQQQ', data, 64 + i * 56, *header)
    return data


CONFIG = {'optimizations': {'uncompressNativeLibraries': {'enabled': True, 'alignment': 'PAGE_ALIGNMENT_16K'}}}


class ElfTests(unittest.TestCase):
    def test_16_and_64_kb_alignment(self):
        for alignment in [16384, 65536]:
            pages.check_elf(elf([load(alignment=alignment)]), 'arm64-v8a')
        pages.check_elf(elf(machine=62), 'x86_64')

    def test_rejects_4_kb_or_invalid_alignment(self):
        for alignment in [4096, 8192, 24576]:
            with self.assertRaisesRegex(ValueError, 'LOAD alignment'):
                pages.check_elf(elf([load(alignment=alignment)]), 'arm64-v8a')

    def test_rejects_incongruent_offset_and_address(self):
        with self.assertRaisesRegex(ValueError, 'offset and virtual address'):
            pages.check_elf(elf([load(address=0x4000, offset=0x1000)]), 'arm64-v8a')

    def test_rejects_malformed_or_wrong_architecture(self):
        for data in [b'not ELF', elf()[:100], elf([]), elf(machine=62), elf([load(size=0x20000)])]:
            with self.assertRaises(ValueError):
                pages.check_elf(data, 'arm64-v8a')

    def test_relro_padding_is_safe(self):
        # Models NDK-built prebuilts whose RELRO ends on 4 KB, followed by a
        # gap before writable data begins on a separate 16 KB page.
        relro = (0x6474e552, 4, 0x4100, 0x4100, 0x4100, 0xf00, 0xf00, 1)
        pages.check_elf(elf([load(), load(0x4100, 0xf00, flags=6), load(0x8000, flags=6), relro]), 'arm64-v8a')

    def test_relro_must_not_write_protect_adjacent_data(self):
        relro = (0x6474e552, 4, 0x4100, 0x4100, 0x4100, 0xf00, 0xf00, 1)
        for address, size in [(0x4100, 0x2000), (0x4000, 0x1000)]:
            with self.assertRaisesRegex(ValueError, 'overlaps writable data'):
                pages.check_elf(elf([load(), load(address, size, flags=6), relro]), 'arm64-v8a')


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def artifact(self, suffix='.apk', aligned=True, compressed=False, data=None, module='base'):
        path = Path(self.tmp.name) / ('candidate' + suffix)
        name = ('%s/' % module if suffix == '.aab' else '') + 'lib/arm64-v8a/libtest.so'
        info = ZipInfo(name)
        if compressed:
            info.compress_type = ZIP_DEFLATED
        if aligned:
            padding = 16384 - 30 - len(name.encode())
            info.extra = struct.pack('<HH', 0xa11e, padding - 4) + bytes(padding - 4)
        with ZipFile(path, 'w') as archive:
            archive.writestr(info, elf() if data is None else data)
        return path

    def test_apk_checks_real_data_offset(self):
        self.assertEqual(pages.verify(self.artifact(), ('arm64-v8a',)), 1)
        with self.assertRaisesRegex(ValueError, 'ZIP offset'):
            pages.verify(self.artifact(aligned=False), ('arm64-v8a',))

    def test_compressed_apk_still_requires_elf_alignment(self):
        self.assertEqual(pages.verify(self.artifact(aligned=False, compressed=True), ('arm64-v8a',)), 1)
        with self.assertRaisesRegex(ValueError, 'LOAD alignment'):
            pages.verify(self.artifact(compressed=True, data=elf([load(alignment=4096)])), ('arm64-v8a',))

    def test_required_abis_cannot_silently_disappear(self):
        with self.assertRaisesRegex(ValueError, 'Missing native ABIs: armeabi-v7a'):
            pages.verify(self.artifact())

    def test_bundle_requires_config_check_including_feature_modules(self):
        artifact = self.artifact('.aab', aligned=False, module='feature')
        with self.assertRaisesRegex(ValueError, 'requires --bundletool'):
            pages.verify(artifact, ('arm64-v8a',))
        with patch.object(pages.subprocess, 'check_output', return_value=json.dumps(CONFIG)):
            self.assertEqual(pages.verify(artifact, ('arm64-v8a',), 'bundletool.jar'), 1)

    def test_bundle_rejects_4_kb_or_missing_configuration(self):
        for config in [{}, {'optimizations': {'uncompressNativeLibraries': {'enabled': True, 'alignment': 'PAGE_ALIGNMENT_4K'}}}]:
            with self.assertRaisesRegex(ValueError, 'PAGE_ALIGNMENT_16K'):
                pages.check_bundle_config(config)


if __name__ == '__main__':
    unittest.main()
