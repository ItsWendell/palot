import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ESM-compatible way to get __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// node-gyp-build smartly resolves prebuilds as well as local builds.
const nodeGypBuild = require("node-gyp-build");
export default nodeGypBuild(join(__dirname, ".."));
