import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider, useAtom } from "jotai";
import { afterEach, expect, it } from "vitest";
import { persistedStorageKey } from "./persisted";
import { composerDraftAtomFamily, flushComposerDrafts } from "./ui";

afterEach(() => {
  cleanup();
  flushComposerDrafts();
  window.localStorage.clear();
});

it("renders a remote draft on remount without a second storage event or atom update", () => {
  const scope = "session:react-draft-remount";
  const key = persistedStorageKey(`composer.draft:${encodeURIComponent(scope)}`);
  const saveRemote = (text: string) =>
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 1, value: { text, mentions: [], command: null } }),
    );
  saveRemote("Before leaving");
  const draftAtom = composerDraftAtomFamily(scope);
  const store = createStore();
  function DraftReader() {
    const [draft] = useAtom(draftAtom);
    return <textarea aria-label="Composer draft" value={draft.text} readOnly />;
  }
  const mount = () =>
    render(
      <Provider store={store}>
        <DraftReader />
      </Provider>,
    );

  const first = mount();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Composer draft" }).value).toBe(
    "Before leaving",
  );
  first.unmount();
  saveRemote("Changed in another window");
  mount();

  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Composer draft" }).value).toBe(
    "Changed in another window",
  );
});
