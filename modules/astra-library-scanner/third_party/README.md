# Native metadata dependencies

## Offline analysis decoders

dr_flac, dr_mp3, and dr_wav are vendored from
https://github.com/mackron/dr_libs at revision
`dfe8377631000664666519fdb83da193fd8037f4` under the MIT-0 license option.
Upstream headers are unmodified. `dr_libs/LICENSE` and `dr_libs/REVISION` are
packaged in `assets/notices/dr_libs`. Builds require no network downloads.

SHA-256:

- dr_flac.h: `111144e778f55738db6851cb226015c419e00d04b916a09506d4856d9cff945c`
- dr_mp3.h: `997b7ee18de6e6b81e2a83f1ea9fc62aef25c62b28d48db95635f49e65de0a2f`
- dr_wav.h: `03e70c1a2d9787cd7ed3e966c075bea7bac6373f759db9cd7ca9ccdfc4ec4493`

## Metadata

TagLib 2.3.2, based on source from https://taglib.org/releases/taglib-2.3.2.tar.gz
(SHA-256: `3ca2d8afaa7f1cf7f6ed10e511ebc368bfacd6dcaa3dbfa690b89e502e8963dc`).

The source includes its pinned utf8cpp dependency. TagLib's upstream license
options are retained in `taglib/COPYING.MPL` and `taglib/COPYING.LGPL`, together
with individual source notices. The license texts and attribution are also
packaged in the APK's `assets/notices/taglib` directory.
utf8cpp's Boost license is in `taglib/3rdparty/utfcpp/LICENSE`.

Upstream examples, tests, documentation and C bindings are omitted. Production
sources include local MP4 audio-property fixes and EC-3 Atmos/JOC detection:
`MP4::Properties::isAtmosJoc()` reads the bounded `dec3` extension flag and is
exposed through the scanner's JNI payload. The scanner only exposes read operations. CMake disables
formats outside the scanner's supported extensions and builds without network access.
