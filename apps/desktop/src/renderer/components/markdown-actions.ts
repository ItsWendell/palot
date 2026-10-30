import { createContext } from "react";

export const MarkdownActionsContext = createContext<{
  runCode?(code: string): Promise<void>;
  previewHTML?(html: string): void;
}>({});
