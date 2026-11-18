cmake_minimum_required(VERSION 3.18.1)
project(buildplay-runtime C)
set(RUNTIME "${CMAKE_CURRENT_SOURCE_DIR}/../../../../cpp")
add_library(buildplay-runtime SHARED runtime_jni.c "${RUNTIME}/buildplay_runtime.c"
  "${RUNTIME}/quickjs/quickjs.c" "${RUNTIME}/quickjs/cutils.c"
  "${RUNTIME}/quickjs/libregexp.c" "${RUNTIME}/quickjs/libunicode.c" "${RUNTIME}/quickjs/dtoa.c")
target_compile_definitions(buildplay-runtime PRIVATE _GNU_SOURCE CONFIG_VERSION="2025-09-13")
target_compile_options(buildplay-runtime PRIVATE -std=gnu11)
target_include_directories(buildplay-runtime PRIVATE "${RUNTIME}")
target_link_options(buildplay-runtime PRIVATE "-Wl,-z,max-page-size=16384")
target_link_libraries(buildplay-runtime m)
