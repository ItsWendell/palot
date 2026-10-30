import { MermaidDiagram } from "../markdown-rich";

export function MermaidFilePreview({ text }: { text: string }) {
  // Mermaid lays out DOM before sanitizing SVG. Reject resource/config syntax before that pass.
  if (
    /%%\s*\{|^\s*---|<\/?[A-Za-z]|<[!?]|@\s*\{|\b(?:img|image)\s*:|url\s*\(|@import|(?:https?|data|blob|file|javascript):/im.test(
      text,
    )
  ) {
    return (
      <p role="status" className="p-5 text-sm text-muted-foreground">
        This diagram contains markup, resource URLs, or custom configuration. Use Source to inspect
        it safely.
      </p>
    );
  }
  return (
    <div className="markdown palot-native-scrollbar min-h-0 flex-1 overflow-auto p-5">
      <MermaidDiagram code={text} />
    </div>
  );
}
