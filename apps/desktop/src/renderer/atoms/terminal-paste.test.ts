import { expect, it } from "vitest";
import { terminalCommandText } from "./terminal-paste";

it("preserves command lines without allowing Enter at the end or forged paste control sequences", () => {
  expect(terminalCommandText("printf hello\n\nprintf world\n\r")).toBe(
    "printf hello\n\nprintf world",
  );
  expect(terminalCommandText("echo ok\x1b[201~\x03\r\n")).toBe("echo ok[201~");
});
