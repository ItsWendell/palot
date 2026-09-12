/// <reference types="vite/client" />

import type { PalotApi } from "../shared";

declare global {
  const __PALOT_BUILD_CHANNEL__: string;
  const __PALOT_RELEASE_BUILD_INFO__: import("../shared/release-build-info").PalotReleaseBuildInfo;
  const __PALOT_REACT_PROFILING__: boolean;
  const __PALOT_REACT_COMPILER_MODE__: "annotation" | "infer" | null;
  const __PALOT_REACT_SCAN_DEFAULT__: boolean;
  const __PALOT_PERFORMANCE_HARNESS__: boolean;

  interface PalotReactProfilerSample {
    id: string;
    phase: "mount" | "update" | "nested-update";
    actualDuration: number;
    baseDuration: number;
    startTime: number;
    commitTime: number;
  }

  interface Window {
    palotBatchProcessing?: import("../shared/performance-contract").BatchProcessingControl;
    palot: PalotApi;
    palotDiagnosticsBoot?: import("./lib/diagnostics-bootstrap").DiagnosticsBootstrapState;
    palotDiagnostics?: {
      snapshot(): import("./lib/diagnostics-runtime").DiagnosticsStatusSnapshot;
    };
    palotReactProfiler?: {
      clear(): void;
      samples(): PalotReactProfilerSample[];
    };
    palotReactScan?: {
      readAndReset(): import("./lib/diagnostics-bootstrap").ReactScanDiagnosticsSample;
    };
    palotStreamingLatency?: () => import("./lib/streaming-latency").StreamingLatencySample[];
    palotStreamingLatencyWindow?: {
      cursor(): number;
      samplesSince(cursor: number): {
        cursor: number;
        samples: import("./lib/streaming-latency").StreamingLatencySample[];
      };
    };
  }
}

export {};
