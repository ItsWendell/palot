import { act, cleanup, render } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { ONBOARDING_VERSION, onboardingCompletedVersionAtom } from "../atoms/onboarding";
import { phaseAtom, runtimeAtom } from "../atoms/workspace";
import { OnboardingController } from "./onboarding-controller";

const state = vi.hoisted(() => ({ pathname: "/", ready: true, navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useRouterState: () => state.pathname,
}));
vi.mock("../hooks/use-session-catalog", () => ({
  useProjectCatalogState: () => ({ ready: state.ready }),
}));
vi.mock("../services/palot", () => ({ palot: { isPreview: () => false } }));

beforeEach(() => {
  state.pathname = "/";
  state.ready = true;
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
  app.switchProfile();
  expect(state.navigate).toHaveBeenCalledTimes(1);
});

it("does not onboard another profile after app completion", () => {
  const app = setup(ONBOARDING_VERSION);
  app.switchProfile();
  expect(state.navigate).not.toHaveBeenCalled();
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

it("respects an explicit launch target", () => {
  const app = setup(0, false);
  app.switchProfile();
  expect(state.navigate).not.toHaveBeenCalled();
});
