# Native metadata dependencies

TagLib 2.3.2, unmodified source from https://taglib.org/releases/taglib-2.3.2.tar.gz
(SHA-256: `3ca2d8afaa7f1cf7f6ed10e511ebc368bfacd6dcaa3dbfa690b89e502e8963dc`).

The source includes its pinned utf8cpp dependency. TagLib's upstream license
options are retained in `taglib/COPYING.MPL` and `taglib/COPYING.LGPL`, together
with individual source notices. The license texts and attribution are also
packaged in the APK's `assets/notices/taglib` directory.
utf8cpp's Boost license is in `taglib/3rdparty/utfcpp/LICENSE`.

Upstream examples, tests, documentation and C bindings are omitted. Production
sources are unmodified. The scanner only exposes read operations. CMake disables
formats outside the scanner's supported extensions and builds without network access.
