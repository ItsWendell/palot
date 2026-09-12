import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/settings/general", search });
  },
});
