# Shared by the Android library and portable analysis tests. All sources are vendored.
set(ASTRA_ANALYSIS_VENDOR "${CMAKE_CURRENT_LIST_DIR}/../third_party")
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(INSTALL_DOCS OFF CACHE BOOL "" FORCE)
set(INSTALL_PKG_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
set(INSTALL_CMAKE_PACKAGE_MODULE OFF CACHE BOOL "" FORCE)
set(OPUS_BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(OPUS_BUILD_PROGRAMS OFF CACHE BOOL "" FORCE)
set(OPUS_INSTALL_PKG_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
set(OPUS_INSTALL_CMAKE_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
# Offline analysis rejects damaged streams instead of synthesizing lost packets.
set(OPUS_DEEP_PLC OFF CACHE BOOL "" FORCE)
set(OPUS_DRED OFF CACHE BOOL "" FORCE)
set(OPUS_OSCE OFF CACHE BOOL "" FORCE)
# ARM64 guarantees NEON; avoid unnecessary runtime probing on host and Android.
if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64|arm64)$")
  set(OPUS_PRESUME_NEON ON CACHE BOOL "" FORCE)
  set(OPUS_MAY_HAVE_NEON OFF CACHE BOOL "" FORCE)
endif()
add_subdirectory("${ASTRA_ANALYSIS_VENDOR}/ogg" ogg EXCLUDE_FROM_ALL)
add_subdirectory("${ASTRA_ANALYSIS_VENDOR}/opus" opus EXCLUDE_FROM_ALL)
if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64|arm64)$")
  # Opus 1.6.1 guards NEON declarations with MAY_HAVE even when PRESUME is set.
  target_compile_definitions(opus PRIVATE OPUS_ARM_MAY_HAVE_NEON OPUS_ARM_MAY_HAVE_NEON_INTR)
endif()
add_library(astra_opusfile STATIC
  "${ASTRA_ANALYSIS_VENDOR}/opusfile/src/info.c"
  "${ASTRA_ANALYSIS_VENDOR}/opusfile/src/internal.c"
  "${ASTRA_ANALYSIS_VENDOR}/opusfile/src/opusfile.c"
  "${ASTRA_ANALYSIS_VENDOR}/opusfile/src/stream.c")
target_include_directories(astra_opusfile PUBLIC "${ASTRA_ANALYSIS_VENDOR}/opusfile/include")
target_link_libraries(astra_opusfile PUBLIC ogg opus)
target_compile_definitions(astra_opusfile PRIVATE _FILE_OFFSET_BITS=64)
set_target_properties(ogg opus astra_opusfile PROPERTIES
  POSITION_INDEPENDENT_CODE ON C_VISIBILITY_PRESET hidden)
