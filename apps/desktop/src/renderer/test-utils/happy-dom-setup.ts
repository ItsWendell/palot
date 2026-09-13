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
}
