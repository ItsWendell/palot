// OfficeParser's browser bundle installs a window-based setImmediate shim at import time.
// Supply the same timer in the worker before importing it, without inventing a DOM/window.
if (!Reflect.has(globalThis, "setImmediate")) {
  Object.defineProperty(globalThis, "setImmediate", {
    configurable: true,
    writable: true,
    value: (callback: () => void) => setTimeout(callback, 0),
  });
}

// This worker only consumes supplied bytes. Never fetch document relationships or other resources.
globalThis.fetch = async () => {
  throw new Error("Network access is disabled in Office previews.");
};
