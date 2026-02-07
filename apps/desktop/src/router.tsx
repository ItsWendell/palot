import {
	createHashHistory,
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router"
import { NewChat } from "./components/new-chat"
import { RootLayout } from "./components/root-layout"
import { SessionRoute } from "./components/session-route"

// ============================================================
// Route tree
// ============================================================

const rootRoute = createRootRoute({
	component: RootLayout,
})

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: NewChat,
})

const projectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "project/$projectSlug",
})

const projectIndexRoute = createRoute({
	getParentRoute: () => projectRoute,
	path: "/",
	component: NewChat,
})

const sessionRoute = createRoute({
	getParentRoute: () => projectRoute,
	path: "session/$sessionId",
	component: SessionRoute,
})

const routeTree = rootRoute.addChildren([
	indexRoute,
	projectRoute.addChildren([projectIndexRoute, sessionRoute]),
])

// ============================================================
// Router instance
// ============================================================

const hashHistory = createHashHistory()

export const router = createRouter({
	routeTree,
	history: hashHistory,
})

export type AppRouter = typeof router

// ============================================================
// Type-safe module augmentation
// ============================================================

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router
	}
}
