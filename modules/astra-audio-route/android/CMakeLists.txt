cmake_minimum_required(VERSION 3.13)
project(astraaudioroute C)

# One plain-C JNI file. libaaudio is dlopen'd at runtime, so only libdl is linked.
add_library(astraaudioroute SHARED ../cpp/hardware_probe_jni.c)

target_link_libraries(astraaudioroute dl)

# Support both 4 KB and 16 KB Android devices with the current NDK.
target_link_options(astraaudioroute PRIVATE
  "-Wl,-z,max-page-size=16384"
  "-Wl,-z,common-page-size=16384")
