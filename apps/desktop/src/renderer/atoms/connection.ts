import { atom } from "jotai"

// Primitive atoms — independent subscriptions
export const serverUrlAtom = atom<string | null>(null)
export const serverConnectedAtom = atom<boolean>(false)

// Derived convenience atom (for components that need both)
export const connectionAtom = atom((get) => ({
	url: get(serverUrlAtom),
	connected: get(serverConnectedAtom),
}))
