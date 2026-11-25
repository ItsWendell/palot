// Typing into a long draft: a sentence typed, paced, at the end of a 20,000-character Markdown draft in an idle task.
// The draft is put in untimed through the field's `value`, which the textarea and the rich editor both take.
//   strobe bench apps/desktop/perf/typing-long.bench.ts --base main --head .
import { bench } from "@hona/strobe";
import { composer, openTasks, palotTarget, replyFixture } from "./palot.ts";

const LINE = "Lorem ipsum dolor sit amet, **bold** and `code`, consectetur adipiscing elit.\n";
const LONG = LINE.repeat(Math.ceil(20_000 / LINE.length)).slice(0, 20_000);
const TYPED = "Typing at the end of a long draft stays responsive.";

export default bench({
  fixture: replyFixture("steady"),
  targets: { palot: palotTarget },
  async setup({ page }) {
    await openTasks(page, ["alpha"]);
  },
  cases: {
    "type at the end of a long draft": {
      primary: "main.work",
      metrics: ["main.script", "main.layout", "main.style", "run.duration"],
      timeout: 60_000,
      async run({ page, untimed }) {
        await untimed(async () => {
          await page.eval(
            (selector: string, text: string) => {
              const element = document.querySelector<HTMLTextAreaElement>(selector)!;
              const own = Object.getOwnPropertyDescriptor(element, "value");
              const native = Object.getOwnPropertyDescriptor(
                Object.getPrototypeOf(element),
                "value",
              );
              (own?.set ?? native!.set!).call(element, text);
              element.dispatchEvent(new Event("input", { bubbles: true }));
              element.focus();
            },
            composer,
            LONG,
          );
          await page.idle();
        });
        await page.type("", TYPED);
        await page.idle();
      },
      async reset({ page }) {
        const value = await page.eval(
          (selector: string) => document.querySelector<HTMLTextAreaElement>(selector)?.value,
          composer,
        );
        if (value !== LONG + TYPED)
          throw new Error(`The composer holds ${value?.length} characters`);
        await page.press("ControlOrMeta+a", { selector: composer });
        await page.press("Backspace");
      },
    },
  },
});
