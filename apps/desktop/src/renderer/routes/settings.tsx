import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { Settings } from "../components/settings";
import { validateProjectSearch } from "../lib/route-search";
import { SETTINGS_CATEGORIES } from "../lib/settings-navigation";

export const Route = createFileRoute("/settings")({
  validateSearch: validateProjectSearch,
  component: SettingsLayout,
});

function SettingsLayout() {
  const search = Route.useSearch();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const segment = pathname.split("/").filter(Boolean)[1];
  const category = SETTINGS_CATEGORIES.find((candidate) => candidate === segment);
  const connectionTab = pathname.endsWith("/web-access")
    ? "web-access"
    : pathname.endsWith("/local-service")
      ? "local-service"
      : "profiles";
  return (
    <>
      {category ? (
        <Settings category={category} projectID={search.projectID} connectionTab={connectionTab} />
      ) : null}
      <Outlet />
    </>
  );
}
