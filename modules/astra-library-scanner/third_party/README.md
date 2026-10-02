# Native scanner dependencies

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

### Ogg Opus

Pinned official release archives, verified against Xiph's published SHA-256 checksums:

| Directory | Release | Archive SHA-256 |
| --- | --- | --- |
| `opus` | [Opus 1.6.1](https://downloads.xiph.org/releases/opus/opus-1.6.1.tar.gz) | `6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1` |
| `opusfile` | [opusfile 0.12](https://downloads.xiph.org/releases/opus/opusfile-0.12.tar.gz) | `118d8601c12dd6a44f52423e68ca9083cc9f2bfe72da7a8c1acb22a80ae3550b` |
| `ogg` | [libogg 1.3.6](https://downloads.xiph.org/releases/ogg/libogg-1.3.6.tar.gz) | `83e6704730683d004d20e21b8f7f55dcb3383cdf84c0daedf30bde175f774638` |

These use BSD-style licenses retained in each directory's `COPYING`. License,
author, and revision notices are packaged under `assets/notices/<directory>`.
Sources are unmodified; `REVISION` files and `cpp/opus_dependencies.cmake` are local.

The vendored subset keeps Opus's `include`, `src`, `celt`, `silk`, and `cmake`
directories (excluding tests), root CMake/source manifests, version/configuration
files, DNN headers, and the two DNN CPU-dispatch maps referenced by upstream CMake.
Ogg keeps its library sources, headers, CMake files, and configuration templates.
Opusfile keeps its public header and `info.c`, `internal.c`, `internal.h`,
`opusfile.c`, and `stream.c`. Upstream documentation, examples, tests, neural model
weights, and HTTP/TLS code are omitted. DRED, neural concealment, and OSCE are
disabled; damaged input is rejected rather than concealed. No network access or
system Opus installation is needed at build time.

The shared CMake configuration retains SIMD support for all Android ABIs and host
tests. ARM64 presumes NEON and supplies the corresponding declaration macros that
Opus 1.6.1 requires, without modifying upstream sources.

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
