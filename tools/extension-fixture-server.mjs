import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { execFileSync } from "node:child_process";

// Chrome extension-created tabs can make their first navigation before
// Playwright attaches a request interceptor. A local test-only CONNECT proxy
// serves both exact origins and rejects every other destination. No real
// Coursera/CTI traffic or credentials participate in this regression.
export async function startExtensionFixture(profile, state) {
  const key = path.join(profile, "fixture-key.pem");
  const cert = path.join(profile, "fixture-cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      "/CN=cti-fixture",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  const csp = fs
    .readFileSync("public/_headers", "utf8")
    .split("\n")
    .find((l) => l.includes("Content-Security-Policy:"))
    .split("Content-Security-Policy: ")[1];
  const sockets = new Set();
  const track = (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  };
  const server = https.createServer(
    { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const host = req.headers.host?.split(":")[0];
      const u = new URL(req.url, "https://" + host);
      if (host === "cti-hardening.pages.dev") {
        try {
          const file = path.resolve(
            "dist",
            u.pathname === "/" ? "index.html" : "." + u.pathname,
          );
          if (!file.startsWith(path.resolve("dist") + path.sep))
            throw Error("Path");
          const content = fs.readFileSync(file);
          res.writeHead(200, {
            "Content-Type": file.endsWith(".js")
              ? "text/javascript"
              : file.endsWith(".css")
                ? "text/css"
                : file.endsWith(".zip")
                  ? "application/zip"
                  : "text/html",
            "Content-Security-Policy": csp,
          });
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end("Not found");
        }
        return;
      }
      if (host !== "www.coursera.org") {
        res.writeHead(403);
        res.end();
        return;
      }
      if (u.pathname.startsWith("/api/authoringCourseMaterials.v1/")) {
        res.writeHead(state.mode === "denied" ? 403 : 200, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify(
            state.mode === "denied"
              ? { error: "Forbidden" }
              : {
                  elements: [
                    {
                      id: "reading",
                      name: "Reading",
                      content: { typeName: "supplement" },
                    },
                  ],
                },
          ),
        );
        return;
      }
      if (u.pathname.startsWith("/api/")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end("{}");
        return;
      }
      if (state.mode === "slow")
        await new Promise((resolve) => setTimeout(resolve, 3000));
      if (res.destroyed) return;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<!doctype html><html><head><title>Reading</title></head><body><main><h1>Reading</h1><div contenteditable="true" role="textbox" aria-label="Reading Content" data-testid="course+reading" style="display:block;min-height:200px;padding:20px">Fresh saved reading revision ${state.version}. Measurement is a comparison of a quantity against a defined unit. Review this worked example carefully and use the exact units when calculating a result. This text is captured from the specific Reading Content field, not from course navigation.</div></main></body></html>`,
      );
    },
  );
  server.on("connection", track);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const proxy = http.createServer((req, res) => {
    res.writeHead(403);
    res.end();
  });
  proxy.on("connection", track);
  proxy.on("connect", (req, client, head) => {
    if (
      !["www.coursera.org:443", "cti-hardening.pages.dev:443"].includes(req.url)
    ) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = net.connect(server.address().port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  return {
    proxy: "http://127.0.0.1:" + proxy.address().port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise((r) => server.close(r)),
        new Promise((r) => proxy.close(r)),
      ]);
    },
  };
}
