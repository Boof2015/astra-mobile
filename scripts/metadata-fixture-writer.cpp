// Fixture-only writer; never linked into the Android metadata reader.
#include <fileref.h>
#include <tpropertymap.h>
#include <tvariant.h>
#include <fstream>
#include <iterator>
#include <iostream>

static TagLib::ByteVector read(const char *path) {
  std::ifstream input(path, std::ios::binary);
  const std::string bytes{std::istreambuf_iterator<char>(input), {}};
  return TagLib::ByteVector(bytes.data(), bytes.size());
}
int main(int argc, char **argv) {
  if(argc != 4 && argc != 5) return 2;
  const std::string mode = argc == 5 ? argv[4] : "";
  TagLib::FileRef file(argv[1]);
  if(file.isNull()) return 3;
  TagLib::PropertyMap tags;
  auto add = [&](const char *key, const char *value) { tags[key].append(TagLib::String(value, TagLib::String::UTF8)); };
  add("TITLE", "Fixture 日本語 🛰️");
  add("ARTIST", "Earth, Wind & Fire feat. The Emotions");
  add("ARTISTS", "Earth, Wind & Fire"); add("ARTISTS", "The Emotions");
  add("ALBUM", "Metadata Laboratory");
  add("ALBUMARTIST", "Curator One & Curator Two");
  add("ALBUMARTISTS", "Curator One"); add("ALBUMARTISTS", "Curator Two");
  add("GENRE", "Ambient"); add("DATE", "2024-11-09");
  add("TRACKNUMBER", "2/12"); add("DISCNUMBER", "1/2");
  if(mode == "aliases") {
    tags.erase("ARTISTS"); tags.erase("ARTIST");
    add("ARTIST", "Earth, Wind & Fire"); add("ARTIST", "The Emotions");
    tags.erase("ALBUMARTIST"); add("ALBUM ARTIST", "Curator One & Curator Two");
    tags.erase("TRACKNUMBER"); add("TRACK", "2"); add("TOTALTRACKS", "12");
    tags.erase("DISCNUMBER"); add("DISC", "1/2");
  }
  const auto unsupported = file.setProperties(tags);
  if(!unsupported.isEmpty()) std::cerr << "Unmapped fixture properties in " << argv[1] << '\n';
  TagLib::List<TagLib::VariantMap> pictures;
  // Back cover first deliberately exercises front-cover selection.
  for(int i : {3, 2}) {
    TagLib::VariantMap picture;
    picture["data"] = mode == "malformed" && i == 2 ? TagLib::ByteVector("broken image") : read(argv[i]);
    picture["mimeType"] = TagLib::String("image/png");
    picture["pictureType"] = TagLib::String(i == 2 ? "Front Cover" : "Back Cover");
    pictures.append(picture);
  }
  file.setComplexProperties("PICTURE", pictures);
  return file.save() ? 0 : 4;
}
