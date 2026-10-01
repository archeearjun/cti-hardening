import { validateRecord } from "../src/domain/workspace-validation.ts";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { WorkspaceRecord } from "../src/domain/workspace-types.ts";
interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = any>(): Promise<T | null>;
  all<T = any>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<Array<{ meta: { changes: number } }>>;
}
export interface ServiceFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
export interface Environment {
  CTI_DB?: Database;
  CTI_ACCESS_ISSUER?: string;
  CTI_ACCESS_AUD?: string;
  CTI_ADMINS?: string;
  CTI_EDITORS?: string;
  CTI_EXTRACTOR?: ServiceFetcher;
}
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const list = (value = "") =>
  value
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const fail = (message: string, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
async function authenticate(request: Request, env: Environment) {
  const issuer = env.CTI_ACCESS_ISSUER?.replace(/\/$/, "");
  if (
    !env.CTI_DB ||
    !issuer ||
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
    !env.CTI_ACCESS_AUD ||
    !list(env.CTI_ADMINS).length
  )
    fail(
      "Shared workspace setup is incomplete. Configure D1 and Cloudflare Access first.",
      503,
    );
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) fail("Sign in through the configured team site.", 401);
  let payload;
  try {
    let jwks = keys.get(issuer!);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs"));
      keys.set(issuer!, jwks);
    }
    payload = (
      await jwtVerify(token!, jwks, {
        issuer,
        audience: env.CTI_ACCESS_AUD,
        algorithms: ["RS256"],
      })
    ).payload;
  } catch {
    fail("Your sign-in token is invalid or expired.", 401);
  }
  const email = String(payload!.email || "").toLowerCase();
  if (!email || !payload!.sub)
    fail("A verified user identity is required.", 401);
  const role = list(env.CTI_ADMINS).includes(email)
    ? "admin"
    : list(env.CTI_EDITORS).includes(email)
      ? "editor"
      : "viewer";
  return { email, role };
}
async function boundedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      fail("Request exceeds the upload limit.", 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let p = 0;
  for (const part of parts) {
    bytes.set(part, p);
    p += part.length;
  }
  return bytes;
}
const sha = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
export async function handleApi(
  request: Request,
  env: Environment,
): Promise<Response> {
  try {
    const user = await authenticate(request, env);
    return await handleAuthorized(
      request,
      env.CTI_DB!,
      user,
      env.CTI_EXTRACTOR,
    );
  } catch (error) {
    return response(
      {
        error:
          error instanceof Error ? error.message : "Workspace request failed.",
      },
      Number((error as { status?: number }).status) || 500,
    );
  }
}
// Separate authenticated handler permits DB/concurrency testing. The deployed
// entry point always verifies Access JWTs before reaching it.
export async function handleAuthorized(
  request: Request,
  db: Database,
  user: { email: string; role: string },
  extractor?: ServiceFetcher,
): Promise<Response> {
  const url = new URL(request.url),
    p = url.pathname
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter(Boolean),
    method = request.method;
  if (method !== "GET") {
    if (request.headers.get("Origin") !== url.origin)
      fail("Cross-origin writes are not allowed.", 403);
    if (!["admin", "editor"].includes(user.role))
      fail("Your account has read-only access.", 403);
  }
  if (p[0] === "extraction") {
    if (!extractor)
      return response(
        {
          error:
            "Background Coursera extraction is not configured for this CTI deployment.",
        },
        503,
      );
    const target = new URL(
      "https://cti-coursera-extractor.internal/" +
        p
          .slice(1)
          .map((part) => encodeURIComponent(part))
          .join("/"),
    );
    target.search = url.search;
    const headers = new Headers();
    const contentType = request.headers.get("Content-Type");
    if (contentType) headers.set("Content-Type", contentType);
    headers.set("X-CTI-User", user.email);
    headers.set("X-CTI-Role", user.role);
    const init: RequestInit = {
      method,
      headers,
      redirect: "manual",
    };
    if (method !== "GET" && method !== "HEAD")
      init.body = await boundedBody(request, 256 * 1024);
    return extractor.fetch(new Request(target, init));
  }
  if (p[0] === "session" && method === "GET") return response(user);
  if (p[0] === "records" && p.length === 1 && method === "GET") {
    const { results } = await db
      .prepare(
        "SELECT id,kind,title,package_id,version,updated_at,updated_by,summary FROM documents ORDER BY updated_at DESC",
      )
      .all();
    return response({
      records: results.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        packageId: row.package_id,
        version: row.version,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
        data: JSON.parse(row.summary),
      })),
    });
  }
  if (p[0] === "records" && p[1] && method === "GET") {
    const doc = await db
      .prepare("SELECT * FROM documents WHERE id=?")
      .bind(p[1])
      .first();
    if (!doc) fail("Record not found.", 404);
    if (p[2] === "versions") {
      const { results } = await db
        .prepare(
          "SELECT id,expected_version,created_at,actor FROM uploads WHERE document_id=? AND committed=1 ORDER BY expected_version DESC",
        )
        .bind(p[1])
        .all();
      return response({
        versions: results.map((r) => ({
          revision: r.id,
          version: r.expected_version + 1,
          updatedAt: r.created_at,
          updatedBy: r.actor,
        })),
      });
    }
    const revision = url.searchParams.get("revision") || doc.revision;
    const upload = await db
      .prepare(
        "SELECT * FROM uploads WHERE id=? AND document_id=? AND committed=1",
      )
      .bind(revision, p[1])
      .first();
    if (!upload) fail("Saved revision not found.", 404);
    if (p[2] === "chunks") {
      const n = Number(p[3]);
      if (!Number.isInteger(n) || n < 0 || n >= upload.parts)
        fail("Invalid evidence chunk.");
      const chunk = await db
        .prepare("SELECT value FROM chunks WHERE upload_id=? AND part=?")
        .bind(revision, n)
        .first();
      if (!chunk) fail("Saved evidence chunk is missing.", 500);
      return new Response(new Uint8Array(chunk.value), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
        },
      });
    }
    return response({
      record: {
        ...JSON.parse(upload.metadata),
        version: upload.expected_version + 1,
        updatedAt: upload.created_at,
        updatedBy: upload.actor,
      },
      parts: upload.parts,
      sha256: upload.sha256,
      revision,
    });
  }
  if (p[0] === "uploads" && p.length === 1 && method === "POST") {
    const input = JSON.parse(
      new TextDecoder().decode(await boundedBody(request, 128 * 1024)),
    );
    const r = input.record as WorkspaceRecord;
    try {
      validateRecord(r, false);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Invalid record.");
    }
    if (r.kind === "legacy-backup" && user.role !== "admin")
      fail("Only an administrator may import legacy workspace backups.", 403);
    if (
      !Number.isInteger(input.bytes) ||
      input.bytes < 1 ||
      input.bytes > 32 * 1024 * 1024 ||
      input.parts !== Math.ceil(input.bytes / 131072) ||
      !/^[a-f0-9]{64}$/.test(input.sha256)
    )
      fail("Invalid evidence manifest.");
    const old = await db
      .prepare("SELECT * FROM documents WHERE id=?")
      .bind(r.id)
      .first();
    if ((old?.version || 0) !== r.version)
      fail("Another change was saved. Refresh before retrying.", 409);
    if (old && (old.kind === "audit" || old.kind !== r.kind))
      fail(
        "Saved audit snapshots and record types cannot be overwritten.",
        409,
      );
    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO uploads(id,document_id,expected_version,actor,created_at,bytes,parts,sha256,metadata) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        r.id,
        r.version,
        user.email,
        new Date().toISOString(),
        input.bytes,
        input.parts,
        input.sha256,
        JSON.stringify(r),
      )
      .run();
    return response({ id });
  }
  if (p[0] === "uploads" && p[1]) {
    const u = await db
      .prepare("SELECT * FROM uploads WHERE id=?")
      .bind(p[1])
      .first();
    if (!u || u.actor !== user.email) fail("Upload not found.", 404);
    if (u.committed) fail("This upload was already committed.", 409);
    if (p[2] === "chunks" && method === "PUT") {
      const n = Number(p[3]);
      if (!Number.isInteger(n) || n < 0 || n >= u.parts)
        fail("Invalid chunk index.");
      const bytes = await boundedBody(request, 131072);
      if (bytes.length !== Math.min(131072, u.bytes - n * 131072))
        fail("Evidence chunk size differs from its manifest.");
      const digest = await sha(bytes);
      const old = await db
        .prepare("SELECT digest FROM chunks WHERE upload_id=? AND part=?")
        .bind(u.id, n)
        .first();
      if (old) {
        if (old.digest !== digest)
          fail("A different chunk was already uploaded at this position.", 409);
        return response({ success: true });
      }
      await db
        .prepare(
          "INSERT INTO chunks(upload_id,part,bytes,digest,value) VALUES(?,?,?,?,?)",
        )
        .bind(u.id, n, bytes.length, digest, bytes.buffer)
        .run();
      return response({ success: true });
    }
    if (p[2] === "commit" && method === "POST") {
      const counts = await db
        .prepare(
          "SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM chunks WHERE upload_id=?",
        )
        .bind(u.id)
        .first();
      if (counts.count !== u.parts || counts.bytes !== u.bytes)
        fail("Upload is incomplete. Nothing has been saved.", 409);
      const r = JSON.parse(u.metadata);
      let q: Statement;
      if (u.expected_version === 0)
        q = db
          .prepare(
            "INSERT INTO documents(id,kind,title,package_id,version,revision,updated_at,updated_by,summary) VALUES(?,?,?,?,1,?,?,?,?) ON CONFLICT(id) DO NOTHING",
          )
          .bind(
            r.id,
            r.kind,
            r.title,
            r.packageId,
            u.id,
            u.created_at,
            u.actor,
            JSON.stringify(r.data),
          );
      else
        q = db
          .prepare(
            "UPDATE documents SET title=?,package_id=?,version=version+1,revision=?,updated_at=?,updated_by=?,summary=? WHERE id=? AND version=? AND kind=? AND kind<>'audit'",
          )
          .bind(
            r.title,
            r.packageId,
            u.id,
            u.created_at,
            u.actor,
            JSON.stringify(r.data),
            r.id,
            u.expected_version,
            r.kind,
          );
      const results = await db.batch([
        q,
        db
          .prepare(
            "UPDATE uploads SET committed=1 WHERE id=? AND EXISTS(SELECT 1 FROM documents WHERE id=? AND revision=?)",
          )
          .bind(u.id, r.id, u.id),
      ]);
      if (results[0].meta.changes !== 1)
        fail(
          "Another edit was committed first. Refresh before retrying; this upload did not replace it.",
          409,
        );
      return response({
        record: {
          ...r,
          version: u.expected_version + 1,
          updatedAt: u.created_at,
          updatedBy: u.actor,
        },
      });
    }
  }
  return response({ error: "Unknown workspace route." }, 404);
}
