//----------------------------------------------------------------------------
#ifndef SRC_COMMON_H_
#define SRC_COMMON_H_
//----------------------------------------------------------------------------

#define V8Value v8::Local<v8::Value>
#define V8Array v8::Local<v8::Array>

#if defined(_MSC_VER)
#define PLATFORM_WIN32
#include <dwmapi.h>
#elif defined(__linux__)
#define PLATFORM_LINUX
#elif defined(__APPLE__)
#define PLATFORM_OSX
#include <Foundation/Foundation.h>
#include <AppKit/AppKit.h>
#include <objc/objc-runtime.h>
#endif

#include <map>
#include <utility>
//----------------------------------------------------------------------------
#endif // SRC_COMMON_H_