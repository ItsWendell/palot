import { initializeOptionalReactScan } from "./lib/diagnostics-bootstrap";

window.palotDiagnosticsBoot = await initializeOptionalReactScan();
await import("./main");
