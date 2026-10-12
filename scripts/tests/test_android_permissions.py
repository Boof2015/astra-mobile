import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location('permissions', Path(__file__).parents[1] / 'verify-android-permissions.py')
permissions = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(permissions)

# Format emitted by build-tools 36.0.0 aapt dump permissions on Astra's APK.
TV_PERMISSIONS = """package: io.github.boof2015.astra
uses-permission: name='android.permission.CAMERA'
uses-permission: name='android.permission.INTERNET'
uses-permission: name='android.permission.READ_EXTERNAL_STORAGE' maxSdkVersion='32'
uses-permission: name='android.permission.READ_MEDIA_AUDIO'
uses-permission: name='android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'
permission: io.github.boof2015.astra.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
uses-permission: name='io.github.boof2015.astra.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
"""


class PermissionTests(unittest.TestCase):
    def test_accepts_tv_audio_access_with_legacy_storage_capped_at_api_32(self):
        permissions.verify_permissions(TV_PERMISSIONS)

    def test_rejects_unbounded_or_incorrectly_bounded_legacy_storage(self):
        for attributes in ('', " maxSdkVersion='33'", " maxSdkVersion='31'"):
            with self.subTest(attributes=attributes):
                with self.assertRaisesRegex(ValueError, 'maxSdkVersion=32'):
                    permissions.verify_permissions(TV_PERMISSIONS.replace(" maxSdkVersion='32'", attributes))

    def test_rejects_duplicate_unrestricted_legacy_declaration(self):
        for tag in ('uses-permission', 'uses-permission-sdk-23'):
            with self.subTest(tag=tag):
                with self.assertRaisesRegex(ValueError, 'exactly once'):
                    permissions.verify_permissions(TV_PERMISSIONS + f"{tag}: name='android.permission.READ_EXTERNAL_STORAGE'\n")

    def test_requires_both_tv_permissions(self):
        for name in ('READ_MEDIA_AUDIO', 'READ_EXTERNAL_STORAGE'):
            with self.subTest(name=name):
                dump = '\n'.join(line for line in TV_PERMISSIONS.splitlines() if name not in line)
                with self.assertRaisesRegex(ValueError, name):
                    permissions.verify_permissions(dump)

    def test_rejects_expiring_modern_audio_permission(self):
        with self.assertRaisesRegex(ValueError, 'READ_MEDIA_AUDIO'):
            permissions.verify_permissions(TV_PERMISSIONS.replace(
                "name='android.permission.READ_MEDIA_AUDIO'", "name='android.permission.READ_MEDIA_AUDIO' maxSdkVersion='33'"))

    def test_preserves_all_existing_permission_restrictions(self):
        for name in (
            'android.permission.RECORD_AUDIO',
            'android.permission.FOREGROUND_SERVICE_MICROPHONE',
            'android.permission.BLUETOOTH',
            'android.permission.BLUETOOTH_CONNECT',
            'android.permission.MODIFY_AUDIO_SETTINGS',
            'android.permission.SYSTEM_ALERT_WINDOW',
            'android.permission.WRITE_EXTERNAL_STORAGE',
        ):
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, 'forbidden permissions'):
                    permissions.verify_permissions(TV_PERMISSIONS + f"uses-permission: name='{name}'\n")


if __name__ == '__main__':
    unittest.main()
