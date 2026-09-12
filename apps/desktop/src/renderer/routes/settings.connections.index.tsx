import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/connections/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/settings/connections/profiles", search });
  },
});
