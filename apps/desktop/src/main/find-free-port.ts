/**
 * Finds an available TCP port on localhost.
 *
 * Uses the OS-assigned ephemeral port trick: bind to port 0, read the
 * assigned port, then close the server before returning.
 */

import { createServer } from "node:net"

export function findFreePort(hostname = "127.0.0.1"): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer()
		server.unref()
		server.on("error", reject)
		server.listen(0, hostname, () => {
			const addr = server.address()
			if (!addr || typeof addr === "string") {
				server.close()
				reject(new Error("Could not determine assigned port"))
				return
			}
			const port = addr.port
			server.close(() => resolve(port))
		})
	})
}
