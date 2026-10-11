cmake_minimum_required(VERSION 3.13)
project(astrascope)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Pure portable DSP + a plain-JNI bridge. No prefab / ReactAndroid / fbjni:
# <jni.h> comes from the NDK sysroot and we only link liblog.
add_library(astrascope SHARED
  ../cpp/dsp_utils.cpp
  ../cpp/spectrum.cpp
  ../cpp/oscilloscope.cpp
  ../cpp/vectorscope.cpp
  ../cpp/scope_jni.cpp)

target_include_directories(astrascope PRIVATE ../cpp)

find_library(log-lib log)
target_link_libraries(astrascope ${log-lib})

# Support both 4 KB and 16 KB Android devices with the current NDK.
target_link_options(astrascope PRIVATE
  "-Wl,-z,max-page-size=16384"
  "-Wl,-z,common-page-size=16384")
