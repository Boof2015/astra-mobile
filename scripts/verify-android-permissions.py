#!/usr/bin/env python3
"""Check packaged APK permissions, including Android TV's bounded audio access."""
import argparse
from pathlib import Path
import re
import subprocess
import sys


FORBIDDEN = {
    'android.permission.RECORD_AUDIO',
    'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    'android.permission.BLUETOOTH',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.MODIFY_AUDIO_SETTINGS',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.WRITE_EXTERNAL_STORAGE',
}


def verify_permissions(dump):
    permissions = {}
    for name, attributes in re.findall(
        r"^uses-permission(?:-sdk-\d+)?: name='([^']+)'([^\r\n]*)", dump, re.MULTILINE
    ):
        permissions.setdefault(name, []).append(attributes.strip())

    forbidden = FORBIDDEN.intersection(permissions)
    if forbidden:
        raise ValueError(f'APK contains forbidden permissions: {", ".join(sorted(forbidden))}')

    # TV uses MediaStore instead of SAF. The legacy read permission is needed
    # through Android 12L only; Android 13+ uses READ_MEDIA_AUDIO. Check every
    # declaration so a duplicate unrestricted permission cannot slip through.
    if permissions.get('android.permission.READ_EXTERNAL_STORAGE') != ["maxSdkVersion='32'"]:
        raise ValueError('READ_EXTERNAL_STORAGE must be declared exactly once with maxSdkVersion=32')
    if permissions.get('android.permission.READ_MEDIA_AUDIO') != ['']:
        raise ValueError('READ_MEDIA_AUDIO must be declared exactly once without a maximum SDK')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--aapt', required=True, type=Path)
    args = parser.parse_args()
    try:
        dump = subprocess.check_output([str(args.aapt), 'dump', 'permissions', str(args.apk)], text=True)
        verify_permissions(dump)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'Android permission verification failed: {error}', file=sys.stderr)
        return 1
    print('Verified APK permissions, including TV audio access and the API 32 legacy storage limit.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
