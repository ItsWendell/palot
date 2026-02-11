import {
	createHashHistory,
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router"
import { ErrorPage } from "./components/error-page"
import { NewChat } from "./components/new-chat"
import { NotFoundPage } from "./components/not-found-page"
import { RootLayout } from "./components/root-layout"
import { SessionRoute } from "./components/session-route"
import { SettingsPage } from "./components/settings/settings-page"

// ============================================================
// Route tree
// ============================================================

const rootRoute = createRootRoute({
	component: RootLayout,
	errorComponent: ErrorPage,
	notFoundComponent: NotFoundPage,
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

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "settings",
	component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
	indexRoute,
	settingsRoute,
	projectRoute.addChildren([projectIndexRoute, sessionRoute]),
])

// ============================================================
// Router instance
// ============================================================

const hashHistory = createHashHistory()

export const router = createRouter({
	routeTree,
	history: hashHistory,
	defaultErrorComponent: ErrorPage,
	defaultNotFoundComponent: NotFoundPage,
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
