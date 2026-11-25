import { act, render } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { describe, expect, it } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { addUnreadMark, unreadMarkKey } from "../lib/task-unread";
import {
  unreadMarksAtom,
  useClearUnreadMarkOnOpen,
  useSetUnreadMark,
  useTaskMarkedUnread,
} from "./use-task-unread";

const runtime = { connectionID: "connection-1", profileID: "profile-1" } as OpenCodeRuntimeStatus;
const key = unreadMarkKey("profile-1", "session-1");

function setup() {
  const store = createStore();
  store.set(runtimeAtom, runtime);
  store.set(unreadMarksAtom, {});
  let setMark: ReturnType<typeof useSetUnreadMark> = () => undefined;
  function Marker() {
    setMark = useSetUnreadMark();
    return null;
  }
  function OpenTask({ sessionID }: { sessionID: string | null }) {
    useClearUnreadMarkOnOpen(sessionID);
    const marked = useTaskMarkedUnread("session-1");
    return <output>{marked ? "unread" : "read"}</output>;
  }
  function App({ sessionID }: { sessionID: string | null }) {
    return (
      <Provider store={store}>
        <Marker />
        <OpenTask sessionID={sessionID} />
      </Provider>
    );
  }
  return {
    store,
    App,
    mark: (marked: boolean) => act(() => setMark("profile-1", "session-1", marked)),
  };
}

describe("unread marks", () => {
  it("keeps the open task unread when it is marked, and clears it on the next visit", () => {
    const { store, App, mark } = setup();
    const view = render(<App sessionID="session-1" />);
    mark(true);
    expect(view.container.textContent).toBe("unread");
    // Other updates while the task stays open do not clear the mark.
    view.rerender(<App sessionID="session-1" />);
    expect(view.container.textContent).toBe("unread");

    // Leave the task, then come back.
    view.rerender(<App sessionID={null} />);
    expect(Object.keys(store.get(unreadMarksAtom))).toEqual([key]);
    view.rerender(<App sessionID="session-1" />);
    expect(view.container.textContent).toBe("read");
    expect(store.get(unreadMarksAtom)).toEqual({});
  });

  it("clears the mark when navigation moves straight to the marked task", () => {
    const { store, App } = setup();
    const view = render(<App sessionID="session-2" />);
    act(() => store.set(unreadMarksAtom, addUnreadMark({}, key, 1)));
    expect(view.container.textContent).toBe("unread");
    view.rerender(<App sessionID="session-1" />);
    expect(view.container.textContent).toBe("read");
  });

  it("keeps marks per connection profile", () => {
    const { store, App } = setup();
    act(() =>
      store.set(unreadMarksAtom, addUnreadMark({}, unreadMarkKey("profile-2", "session-1"), 1)),
    );
    const view = render(<App sessionID="session-2" />);
    expect(view.container.textContent).toBe("read");
  });
});
