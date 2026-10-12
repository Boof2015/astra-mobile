cmake_minimum_required(VERSION 3.22)
project(astra_discord)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(discord_partner_sdk REQUIRED CONFIG)
add_library(astra_discord SHARED ../cpp/discord_jni.cpp)
target_link_libraries(astra_discord discord_partner_sdk::discord_partner_sdk log)

# Support both 4 KB and 16 KB Android devices with the current NDK.
target_link_options(astra_discord PRIVATE
  "-Wl,-z,max-page-size=16384"
  "-Wl,-z,common-page-size=16384")
