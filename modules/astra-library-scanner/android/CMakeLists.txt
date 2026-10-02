cmake_minimum_required(VERSION 3.22)
project(astratags LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(BUILD_BINDINGS OFF CACHE BOOL "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(VISIBILITY_HIDDEN ON CACHE BOOL "" FORCE)
foreach(format DSF MATROSKA MOD SHORTEN TRUEAUDIO)
  set(WITH_${format} OFF CACHE BOOL "" FORCE)
endforeach()
set(utf8cpp_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/taglib/3rdparty/utfcpp/source" CACHE PATH "" FORCE)
add_subdirectory(../third_party/taglib taglib EXCLUDE_FROM_ALL)

add_library(astratags SHARED ../cpp/tag_reader.cpp)
get_target_property(tag_includes tag INCLUDE_DIRECTORIES)
target_include_directories(astratags PRIVATE ${tag_includes} ../third_party/taglib/taglib)
target_link_libraries(astratags PRIVATE tag)
target_compile_options(astratags PRIVATE -Wall -Wextra -fvisibility=hidden)
target_compile_definitions(astratags PRIVATE _FILE_OFFSET_BITS=64)
# Match Android's 16 KB page-size packaging requirements on every ABI.
target_link_options(astratags PRIVATE "-Wl,-z,max-page-size=16384")

include(../cpp/opus_dependencies.cmake)
add_library(astraanalysis SHARED
  ../cpp/audio_analysis.cpp
  ../cpp/audio_decoder.cpp
  ../cpp/audio_analysis_jni.cpp)
target_include_directories(astraanalysis PRIVATE ../third_party/dr_libs)
target_link_libraries(astraanalysis PRIVATE astra_opusfile)
target_compile_options(astraanalysis PRIVATE -Wall -Wextra -fvisibility=hidden -ffp-contract=off)
target_compile_definitions(astraanalysis PRIVATE _FILE_OFFSET_BITS=64)
target_link_options(astraanalysis PRIVATE "-Wl,-z,max-page-size=16384")
