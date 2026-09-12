#include "../include/Common.h"
#include <napi.h>
#import <objc/runtime.h>
#import <objc/message.h>
#include <string>
#include <cctype>

#ifdef PLATFORM_OSX
#import <AppKit/AppKit.h>

// Simple registry so JS can still address a view by numeric id.
static std::map<int, NSView *> g_glassViews;
static int g_nextViewId = 0;

// Keys for objc-associated views on a container
static const void *kGlassEffectKey = &kGlassEffectKey;
static const void *kBackgroundViewKey = &kBackgroundViewKey;
static const void *kTintViewKey = &kTintViewKey;

// Utility: convert #RRGGBB or #RRGGBBAA to NSColor* (sRGB)
static NSColor* ColorFromHexNSString(NSString* hex)
{
  NSString* cleaned = [[hex stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] uppercaseString];
  if ([cleaned hasPrefix:@"#"]) cleaned = [cleaned substringFromIndex:1];
  if (cleaned.length != 6 && cleaned.length != 8) return nil;

  unsigned int rgba = 0;
  NSScanner* scanner = [NSScanner scannerWithString:cleaned];
  if (![scanner scanHexInt:&rgba]) return nil;

  CGFloat r,g,b,a;
  if (cleaned.length == 6) {
    r = ((rgba & 0xFF0000) >> 16) / 255.0;
    g = ((rgba & 0x00FF00) >> 8)  / 255.0;
    b =  (rgba & 0x0000FF)        / 255.0;
    a = 1.0;
  } else {
    r = ((rgba & 0xFF000000) >> 24) / 255.0;
    g = ((rgba & 0x00FF0000) >> 16) / 255.0;
    b = ((rgba & 0x0000FF00) >> 8)  / 255.0;
    a =  (rgba & 0x000000FF)        / 255.0;
  }
  return [NSColor colorWithRed:r green:g blue:b alpha:a];
}

static NSAppearance* AppearanceFromName(const char* appearance)
{
  if (!appearance || strcmp(appearance, "system") == 0) return nil;
  if (strcmp(appearance, "light") == 0) {
    return [NSAppearance appearanceNamed:NSAppearanceNameAqua];
  }
  if (strcmp(appearance, "dark") == 0) {
    return [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  }
  return nil;
}

static void ApplyAppearance(NSView* glass, const char* appearance)
{
  NSAppearance* resolvedAppearance = AppearanceFromName(appearance);
  glass.appearance = resolvedAppearance;
  NSView* container = glass.superview;
  container.appearance = resolvedAppearance;
  container.window.appearance = resolvedAppearance;
  NSView* backgroundView = objc_getAssociatedObject(container, kBackgroundViewKey);
  if (backgroundView) backgroundView.appearance = resolvedAppearance;
  [glass setNeedsDisplay:YES];
}

static void ApplyTintColor(NSView* glass, const char* tintHex)
{
  NSString* hex = tintHex ? [NSString stringWithUTF8String:tintHex] : @"#00000000";
  NSColor* color = ColorFromHexNSString(hex);
  if (color && [glass respondsToSelector:@selector(setTintColor:)]) {
    [(id)glass setTintColor:color];
  } else if (color) {
    glass.layer.backgroundColor = color.CGColor;
  }
  NSBox* tintView = objc_getAssociatedObject(glass.superview, kTintViewKey);
  if (tintView && color) tintView.fillColor = color;
  [glass setNeedsDisplay:YES];
}

#define RUN_ON_MAIN(block)                                  \
  if ([NSThread isMainThread]) {                            \
    block();                                                \
  } else {                                                  \
    dispatch_sync(dispatch_get_main_queue(), block);        \
  }

/*!
 * AddGlassEffectView
 * -----------------
 * Creates an `NSGlassEffectView` (private) and inserts it behind the contentView
 * of the supplied Electron window. The handle received from JavaScript is the
 * pointer to the Cocoa `NSView` that backs the BrowserWindow. The view is
 * retained in a small registry so that we can manipulate or remove it later if
 * required. The function returns an integer identifier that can be used from
 * JavaScript.
 *
 * Returns –1 on error.
 */
extern "C" int AddGlassEffectView(unsigned char *buffer, bool opaque) {
  if (!buffer) {
    return -1;
  }

  __block int resultId = -1;

  RUN_ON_MAIN(^{
    NSView *rootView = *reinterpret_cast<NSView **>(buffer);
    if (!rootView) return;

    // Find the proper container - avoid NSThemeFrame
    NSView *container = rootView;

    // Remove previous glass and background views (if any)
    NSView *oldGlass = objc_getAssociatedObject(container, kGlassEffectKey);
    if (oldGlass) {
      for (auto it = g_glassViews.begin(); it != g_glassViews.end();) {
        if (it->second == oldGlass) {
          it = g_glassViews.erase(it);
        } else {
          ++it;
        }
      }
      [oldGlass removeFromSuperview];
    }
    
    NSView *oldBackground = objc_getAssociatedObject(container, kBackgroundViewKey);
    if (oldBackground) [oldBackground removeFromSuperview];

    NSView *oldTint = objc_getAssociatedObject(container, kTintViewKey);
    if (oldTint) [oldTint removeFromSuperview];

    NSRect bounds = container.bounds;

    NSBox *backgroundView = nil;
    NSBox *tintView = [[NSBox alloc] initWithFrame:bounds];
    tintView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    tintView.boxType = NSBoxCustom;
    tintView.borderType = NSNoBorder;
    tintView.fillColor = [NSColor clearColor];
    tintView.wantsLayer = YES;
    

    NSView *glass = nil;
    Class glassCls = NSClassFromString(@"NSGlassEffectView");
    if (glassCls) {
      /**
      * GLASS VIEW
      */
      glass = [[glassCls alloc] initWithFrame:bounds];

      if (opaque) {
        // Create a background view behind the glass view using NSBox for proper background color
        backgroundView = [[NSBox alloc] initWithFrame:bounds];
        backgroundView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        backgroundView.boxType = NSBoxCustom;
        backgroundView.borderType = NSNoBorder;
        backgroundView.fillColor = [NSColor windowBackgroundColor];
        backgroundView.wantsLayer = YES;
        
        
        // Add the background view first (bottom layer)
        [container addSubview:backgroundView positioned:NSWindowBelow relativeTo:nil];
      }
    } else {
      /**
      * FALLBACK VISUAL EFFECT VIEW
      */
      NSVisualEffectView *visual = [[NSVisualEffectView alloc] initWithFrame:bounds];
      visual.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      visual.blendingMode = NSVisualEffectBlendingModeBehindWindow;
      visual.material = NSVisualEffectMaterialUnderWindowBackground;
      visual.state = NSVisualEffectStateActive;
      glass = visual;
    }

    // Ensure autoresize if we created a private glass view too
    glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

    // Add the glass view (positioned relative to background view if opaque, or below everything if not)
    if (opaque && backgroundView) {
      [container addSubview:glass positioned:NSWindowAbove relativeTo:backgroundView];
    } else {
      [container addSubview:glass positioned:NSWindowBelow relativeTo:nil];
    }
    [container addSubview:tintView positioned:NSWindowAbove relativeTo:glass];
    
    // Associate views with the container for cleanup
    objc_setAssociatedObject(container, kGlassEffectKey, glass, OBJC_ASSOCIATION_RETAIN);
    if (backgroundView) {
      objc_setAssociatedObject(container, kBackgroundViewKey, backgroundView, OBJC_ASSOCIATION_RETAIN);
    } else {
      objc_setAssociatedObject(container, kBackgroundViewKey, nil, OBJC_ASSOCIATION_ASSIGN);
    }
    objc_setAssociatedObject(container, kTintViewKey, tintView, OBJC_ASSOCIATION_RETAIN);

 

    int id = g_nextViewId++;
    g_glassViews[id] = glass;
    resultId = id;
  });

  return resultId;
}

extern "C" void RemoveGlassEffectView(int viewId) {
  RUN_ON_MAIN(^{
    auto it = g_glassViews.find(viewId);
    if (it == g_glassViews.end()) return;

    NSView* glass = it->second;
    NSView* container = glass.superview;
    NSView* backgroundView = objc_getAssociatedObject(container, kBackgroundViewKey);
    NSView* tintView = objc_getAssociatedObject(container, kTintViewKey);
    [tintView removeFromSuperview];
    [glass removeFromSuperview];
    [backgroundView removeFromSuperview];
    objc_setAssociatedObject(container, kGlassEffectKey, nil, OBJC_ASSOCIATION_ASSIGN);
    objc_setAssociatedObject(container, kBackgroundViewKey, nil, OBJC_ASSOCIATION_ASSIGN);
    objc_setAssociatedObject(container, kTintViewKey, nil, OBJC_ASSOCIATION_ASSIGN);
    g_glassViews.erase(it);
  });
}

// Configure glass view by id
extern "C" void ConfigureGlassView(int viewId, double cornerRadius, const char* tintHex, const char* appearance) {
  RUN_ON_MAIN(^{
    auto it = g_glassViews.find(viewId);
    if (it == g_glassViews.end()) return;
    NSView* glass = it->second;

    ApplyAppearance(glass, appearance);

    // Corner radius via CALayer
    glass.wantsLayer = YES;
    glass.layer.cornerRadius = cornerRadius;
    glass.layer.masksToBounds = YES;

    // corner radius for the background view
    NSView* container = glass.superview;
    NSView* backgroundView = objc_getAssociatedObject(container, kBackgroundViewKey);
    if (backgroundView) {
      backgroundView.wantsLayer = YES;
      backgroundView.layer.cornerRadius = cornerRadius;
      backgroundView.layer.masksToBounds = YES;
    }

    NSView* tintView = objc_getAssociatedObject(container, kTintViewKey);
    tintView.layer.cornerRadius = cornerRadius;
    tintView.layer.masksToBounds = YES;

    ApplyTintColor(glass, tintHex);
  });
}

extern "C" void SetGlassViewAppearance(int viewId, const char* appearance) {
  RUN_ON_MAIN(^{
    auto it = g_glassViews.find(viewId);
    if (it == g_glassViews.end()) return;
    ApplyAppearance(it->second, appearance);
  });
}

extern "C" void SetGlassViewTintColor(int viewId, const char* tintHex) {
  RUN_ON_MAIN(^{
    auto it = g_glassViews.find(viewId);
    if (it == g_glassViews.end()) return;
    ApplyTintColor(it->second, tintHex);
  });
}

// -----------------------------------------------------------------------------
// Dynamically set private properties on a previously created glass view
// -----------------------------------------------------------------------------

// Helper that converts a C-string key (e.g. "variant") into the Objective-C
// selector for its private setter (e.g. set_variant:). It automatically adds
// the leading underscore when missing.
static SEL SetterFromKey(const std::string &key, bool privateVariant) {
  std::string name;
  if (privateVariant) {
    // ensure leading underscore
    if (!key.empty() && key.front() != '_')
      name = "_" + key;
    else
      name = key;
    name = "set" + name;
  } else {
    // camel-case public variant: set + CapitalizedFirst + rest
    if (key.empty()) return nil;
    name = "set";
    name += toupper(key[0]);
    name += key.substr(1);
  }
  name += ":";
  return sel_registerName(name.c_str());
}

static SEL ResolveSetter(id obj, const char* cKey) {
  if (!cKey) return nil;
  std::string key(cKey);
  if (key.empty()) return nil;
  // Try private style first (set_<key>:)
  SEL sel = SetterFromKey(key, true);
  if ([obj respondsToSelector:sel]) return sel;
  // Then try public style (setKey:)
  sel = SetterFromKey(key, false);
  if ([obj respondsToSelector:sel]) return sel;
  return nil;
}

extern "C" void SetGlassViewIntProperty(int viewId, const char* key, long long value) {
#ifdef PLATFORM_OSX
  RUN_ON_MAIN(^{
    auto it = g_glassViews.find(viewId);
    if (it == g_glassViews.end()) return;
    NSView* glass = it->second;

    SEL sel = ResolveSetter(glass, key);
    if (!sel) return;
    if ([glass respondsToSelector:sel]) {
      ((void (*)(id, SEL, long long))objc_msgSend)(glass, sel, value);
    }
  });
#endif
}

extern "C" void SetGlassViewStringProperty(int viewId, const char* key, const char* value) {
#ifdef PLATFORM_OSX
  RUN_ON_MAIN(^{
    auto it = g_glassViews.find(viewId);
    if (it == g_glassViews.end()) return;
    NSView* glass = it->second;

    SEL sel = ResolveSetter(glass, key);
    if (!sel) return;
    if ([glass respondsToSelector:sel]) {
      NSString* val = value ? [NSString stringWithUTF8String:value] : @"";
      ((void (*)(id, SEL, id))objc_msgSend)(glass, sel, val);
    }
  });
#endif
}
#endif // PLATFORM_OSX 
