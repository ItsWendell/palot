import { configure } from "@testing-library/react";

// Happy DOM 20.14.5 rejects Animation.finished on cancel without marking it
// handled. WAAPI requires both; Chromium marks this promise handled internally.
// Keep the original rejected promise observable to callers, not a resolved replacement.
// Remove when Happy DOM implements step 1.3:
// https://www.w3.org/TR/web-animations-1/#canceling-an-animation-section
if (typeof window !== "undefined" && window.navigator.userAgent.includes("HappyDOM")) {
  const cancelAnimation = Animation.prototype.cancel;
  Animation.prototype.cancel = function () {
    void this.finished.catch(() => {});
    return cancelAnimation.call(this);
  };

  // Motion 14.7+ runs transform animations on WAAPI animations it starts by assigning
  // startTime, which Happy DOM 21 never advances, so exits that move x/y never finish
  // and AnimatePresence keeps the element. Without linear() easing Motion keeps
  // transforms on its JS frame loop, as before 14.7. Motion reads this flag for tests.
  const { supportsFlags } = await import("motion");
  supportsFlags.linearEasing = false;
}

// The full desktop suite runs hundreds of files in parallel; under that load an async UI update
// can take longer than Testing Library's 1 s default. A longer ceiling only slows failing tests.
configure({ asyncUtilTimeout: 4000 });
