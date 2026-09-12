import { Service, type Endpoint } from "@opencode/client/service";
import { createServer, request, type ClientRequest } from "node:http";

/** Test-only, fixed-destination HTTP transport. Credentials never enter Palot's
 * renderer/vault; the unauthenticated listener is bound only to loopback. */
export async function startLoopbackServiceProxy(endpoint: Endpoint) {
  const target = new URL(endpoint.url);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1") {
    throw new Error("Fixture proxy requires an owned HTTP IPv4 loopback endpoint");
  }
  const pending = new Set<ClientRequest>();
  const server = createServer((incoming, outgoing) => {
    // Do not resolve URLs from the request: absolute-form and authority-form
    // requests must not turn the fixture into an arbitrary forward proxy.
    const path = incoming.url ?? "";
    if (!path.startsWith("/") || path.startsWith("//")) {
      outgoing.writeHead(400).end();
      return;
    }
    const headers = { ...incoming.headers, ...Service.headers(endpoint) };
    delete headers.host;
    delete headers.connection;
    delete headers["proxy-authorization"];
    const upstream = request(
      {
        hostname: target.hostname,
        port: target.port,
        method: incoming.method,
        path,
        headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        // No buffering: event-stream headers and every chunk reach the renderer.
        outgoing.flushHeaders();
        response.on("error", () => outgoing.destroy());
        response.pipe(outgoing);
      },
    );
    pending.add(upstream);
    upstream.on("close", () => pending.delete(upstream));
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.on("error", () => upstream.destroy());
    outgoing.on("close", () => upstream.destroy());
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture has no TCP address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      // Close SSE as well as idle keep-alive sockets; server.close alone waits
      // indefinitely for an event stream to finish.
      for (const upstream of pending) upstream.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
