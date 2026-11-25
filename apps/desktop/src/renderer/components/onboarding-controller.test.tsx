import { act, cleanup, render } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../shared";
import {
  ONBOARDING_VERSION,
  onboardingCompletedVersionAtom,
  onboardingSkippedAtom,
} from "../atoms/onboarding";
import { phaseAtom, runtimeAtom } from "../atoms/workspace";
import { OnboardingController } from "./onboarding-controller";

const state = vi.hoisted(() => ({
  pathname: "/",
  status: "idle",
  ready: true,
  fetching: false,
  refetch: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ location: { pathname: state.pathname }, status: state.status }),
}));
vi.mock("../hooks/use-session-catalog", () => ({
  useProjectCatalogState: () => ({
    ready: state.ready,
    fetching: state.fetching,
    refetch: state.refetch,
  }),
}));
vi.mock("../services/palot", () => ({ palot: { isPreview: () => false } }));

beforeEach(() => {
  state.pathname = "/";
  state.status = "idle";
  state.ready = true;
  state.fetching = false;
  state.refetch.mockClear();
  state.navigate.mockClear();
});
afterEach(cleanup);

function setup(completed = 0, allowAutomatic = true) {
  const store = createStore();
  store.set(onboardingCompletedVersionAtom, completed);
  store.set(phaseAtom, "ready");
  const runtime = {
    connected: true,
    profileID: "local",
    connectionID: "local",
  } as OpenCodeRuntimeStatus;
  store.set(runtimeAtom, runtime);
  const view = () => (
    <Provider store={store}>
      <OnboardingController initialTargetHandled allowAutomatic={allowAutomatic} />
    </Provider>
  );
  const result = render(view());
  return {
    store,
    rerender: () => result.rerender(view()),
    switchProfile: () =>
      act(() =>
        store.set(runtimeAtom, { ...runtime, profileID: "remote", connectionID: "remote" }),
      ),
  };
}

it("automatically opens initial onboarding only once, including after a profile switch", () => {
  const app = setup();
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/welcome", replace: true });
  expect(app.store.get(onboardingSkippedAtom)).toBe(false);
  app.switchProfile();
  expect(state.navigate).toHaveBeenCalledTimes(1);
});

it("does not onboard another profile after app completion", () => {
  const app = setup(ONBOARDING_VERSION);
  app.switchProfile();
  expect(state.navigate).not.toHaveBeenCalled();
  // The launch route may now open a task.
  expect(app.store.get(onboardingSkippedAtom)).toBe(true);
});

it.each(["/settings/connections", "/sessions/remote-task", "/welcome"])(
  "does not interrupt %s or redirect when leaving it",
  (pathname) => {
    state.ready = false;
    const app = setup();
    state.pathname = pathname;
    app.rerender();
    state.ready = true;
    app.switchProfile();
    state.pathname = "/new";
    app.rerender();
    expect(state.navigate).not.toHaveBeenCalled();
  },
);

it("waits for the initial catalog before onboarding", () => {
  state.ready = false;
  const app = setup();
  expect(state.navigate).not.toHaveBeenCalled();
  state.ready = true;
  app.rerender();
  expect(state.navigate).toHaveBeenCalledTimes(1);
});

it("waits for the launch redirect to finish loading before onboarding", () => {
  // Otherwise the pending /new load commits after /welcome and replaces it.
  state.pathname = "/new";
  state.status = "pending";
  const app = setup();
  expect(state.navigate).not.toHaveBeenCalled();
  state.status = "idle";
  app.rerender();
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/welcome", replace: true });
});

it("respects an explicit launch target", () => {
  const app = setup(0, false);
  app.switchProfile();
  expect(state.navigate).not.toHaveBeenCalled();
});

it("refetches a dropped project list instead of waiting for it", () => {
  state.ready = false;
  state.fetching = true;
  const app = setup();
  expect(state.refetch).not.toHaveBeenCalled();
  // The startup fetch was cancelled and nothing else is loading the list.
  state.fetching = false;
  app.rerender();
  expect(state.refetch).toHaveBeenCalledTimes(1);
  expect(state.navigate).not.toHaveBeenCalled();
});
