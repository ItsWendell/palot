#!/usr/bin/env bash
# screenshot-palot.sh — Capture a screenshot of the Palot desktop app window.
#
# By default, captures the screen region where the window sits, which includes
# the composited liquid glass / vibrancy transparency blended with the desktop.
#
# Usage:
#   ./scripts/screenshot-palot.sh                    # composited (shows transparency)
#   ./scripts/screenshot-palot.sh my-screenshot.png  # custom output path
#   ./scripts/screenshot-palot.sh --no-shadow        # without window shadow
#   ./scripts/screenshot-palot.sh --layer             # window layer only (no background)
#
# Requires: macOS, Xcode Command Line Tools (for cc)

set -euo pipefail

OUTPUT="/tmp/palot-screenshot.png"
NO_SHADOW=""
LAYER_MODE=""

# Parse flags and positional args
for arg in "$@"; do
  case "$arg" in
    --no-shadow) NO_SHADOW="-o" ;;
    --layer) LAYER_MODE="1" ;;
    -*) ;;
    *) OUTPUT="$arg" ;;
  esac
done

# Compile the window finder (cached). Returns: windowID x y width height
FINDER="/tmp/palot-window-finder"
FINDER_SRC="/tmp/palot-window-finder.m"

cat > "$FINDER_SRC" << 'OBJC'
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>

int main(int argc, char *argv[]) {
    NSString *target = @"Palot";
    if (argc > 1) {
        target = [NSString stringWithUTF8String:argv[1]];
    }

    CFArrayRef windowList = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID
    );
    if (!windowList) {
        fprintf(stderr, "Failed to get window list\n");
        return 1;
    }

    CFIndex count = CFArrayGetCount(windowList);
    int bestWindowID = -1;
    CGFloat bestArea = 0;
    CGFloat bestX = 0, bestY = 0, bestW = 0, bestH = 0;

    for (CFIndex i = 0; i < count; i++) {
        CFDictionaryRef window = CFArrayGetValueAtIndex(windowList, i);
        NSString *owner = (__bridge NSString *)CFDictionaryGetValue(window, kCGWindowOwnerName);

        if (![owner containsString:target]) continue;

        NSDictionary *bounds = (__bridge NSDictionary *)CFDictionaryGetValue(window, kCGWindowBounds);
        CGFloat w = [bounds[@"Width"] doubleValue];
        CGFloat h = [bounds[@"Height"] doubleValue];
        CGFloat area = w * h;

        if (area > bestArea) {
            bestArea = area;
            bestX = [bounds[@"X"] doubleValue];
            bestY = [bounds[@"Y"] doubleValue];
            bestW = w;
            bestH = h;
            CFNumberRef windowID = CFDictionaryGetValue(window, kCGWindowNumber);
            CFNumberGetValue(windowID, kCFNumberIntType, &bestWindowID);
        }
    }

    CFRelease(windowList);

    if (bestWindowID < 0) {
        fprintf(stderr, "No window found for process: %s\n", [target UTF8String]);
        return 1;
    }

    // Output: windowID x y width height
    printf("%d %.0f %.0f %.0f %.0f\n", bestWindowID, bestX, bestY, bestW, bestH);
    return 0;
}
OBJC

# Recompile only if source changed
if [ ! -f "$FINDER" ] || [ "$FINDER_SRC" -nt "$FINDER" ]; then
  cc -framework CoreGraphics -framework Foundation "$FINDER_SRC" -o "$FINDER" 2>/dev/null
fi

# Try "Palot" first, fall back to "Palot Dev", then "Electron"
RESULT=""
for name in "Palot" "Palot Dev" "Electron"; do
  RESULT=$("$FINDER" "$name" 2>/dev/null) && break || true
done

if [ -z "$RESULT" ]; then
  echo "Error: Could not find Palot window. Is the app running?" >&2
  exit 1
fi

read -r WINDOW_ID WIN_X WIN_Y WIN_W WIN_H <<< "$RESULT"
echo "Found window: ID=$WINDOW_ID at ${WIN_X},${WIN_Y} size ${WIN_W}x${WIN_H}"

if [ -n "$LAYER_MODE" ]; then
  # Layer mode: captures just the window layer (no background bleed-through)
  echo "Mode: window layer (no transparency compositing)"
  screencapture -l "$WINDOW_ID" $NO_SHADOW -x "$OUTPUT"
else
  # Region mode: captures the composited screen region (shows liquid glass transparency)
  echo "Mode: composited region (shows transparency effects)"
  screencapture -R "${WIN_X},${WIN_Y},${WIN_W},${WIN_H}" -x "$OUTPUT"
fi

if [ -f "$OUTPUT" ]; then
  echo "Screenshot saved to: $OUTPUT"
  sips -g pixelWidth -g pixelHeight "$OUTPUT" 2>/dev/null | tail -2
else
  echo "Error: Screenshot failed" >&2
  exit 1
fi
