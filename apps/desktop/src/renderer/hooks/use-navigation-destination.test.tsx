import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newTaskDestinationAtom } from "../atoms/workspace";
import { discoveredProfileIDsAtom, includedProfileIDsAtom } from "../atoms/connections";
import { usePalotNavigation } from "./use-navigation";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn().mockResolvedValue(undefined),
  getSnapshot: vi.fn(),
  refreshRegistry: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ preloadRoute: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("../lib/connection-overview", () => ({ connectionOverview: () => mocks }));
vi.mock("../lib/session-navigation-prefetch", () => ({ prefetchSessionNavigation: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("new-task navigation during registry hydration", () => {
  it.each([true, false])(
    "validates the remembered owner after loading (retained: %s)",
    async (retained) => {
      const store = createStore();
      store.set(newTaskDestinationAtom, { profileID: "remote", projectID: "same-project" });
      store.set(discoveredProfileIDsAtom, []);
      store.set(includedProfileIDsAtom, []);
      const registry = Promise.withResolvers<void>();
      mocks.getSnapshot.mockReturnValue([]);
      mocks.refreshRegistry.mockReturnValue(registry.promise);
      const client = new QueryClient();
      const { result } = renderHook(usePalotNavigation, {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>
            <Provider store={store}>{children}</Provider>
          </QueryClientProvider>
        ),
      });
      let navigation!: Promise<void>;
      act(() => {
        navigation = result.current.openNewTask();
      });
      expect(mocks.refreshRegistry).toHaveBeenCalledOnce();
      expect(mocks.navigate).not.toHaveBeenCalled();
      mocks.getSnapshot.mockReturnValue([
        { profile: { id: "local-default", kind: "local" } },
        ...(retained ? [{ profile: { id: "remote", kind: "remote" } }] : []),
      ]);
      await act(async () => {
        registry.resolve();
        await navigation;
      });
      expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
        to: "/new",
        search: retained
          ? { profileID: "remote", projectID: "same-project" }
          : { profileID: "local-default" },
      });
    },
  );
});
