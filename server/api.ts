import { fetchSourceQuestions } from "./source-questions.ts";
import {
  readPanoptoProviderMetadata,
  readPanoptoProviderPodcast,
  panoptoProviderErrorResponse,
} from "./panopto-provider.ts";
import {
  validateRecord,
  validateWorkspaceTransition,
  validateOperationalReferences,
} from "../src/domain/workspace-validation.ts";
import {
  normalizePartnerName,
  packageSemanticKey,
} from "../src/domain/operations.ts";
import {
  authenticateAccess,
  isCtiOwner,
  requireCtiOwner,
  type AccessAuthenticator,
} from "./access.ts";
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

const PACKAGE_IDENTITY_ACTOR = "__cti_package_identity__";
const PACKAGE_IDENTITY_COMMITTED = 2;

async function readStoredWorkspaceRecord(
  db: Database,
  id: string,
): Promise<WorkspaceRecord | undefined> {
  const doc = await db
    .prepare("SELECT * FROM documents WHERE id=?")
    .bind(id)
    .first();
  if (!doc) return undefined;
  const upload = await db
    .prepare(
      "SELECT * FROM uploads WHERE id=? AND document_id=? AND committed=1",
    )
    .bind(doc.revision, id)
    .first();
  if (!upload || upload.bytes > 32 * 1024 * 1024)
    fail(
      "Referenced evidence is unavailable or exceeds its storage bound.",
      409,
    );
  const { results } = await db
    .prepare(
      "SELECT part,bytes,value FROM chunks WHERE upload_id=? ORDER BY part ASC",
    )
    .bind(doc.revision)
    .all();
  const bytes = new Uint8Array(upload.bytes);
  let offset = 0;
  if (results.length !== upload.parts)
    fail("Referenced evidence is incomplete.", 409);
  for (const [index, part] of results.entries()) {
    const value =
      part.value instanceof ArrayBuffer
        ? new Uint8Array(part.value)
        : ArrayBuffer.isView(part.value)
          ? new Uint8Array(
              part.value.buffer,
              part.value.byteOffset,
              part.value.byteLength,
            )
          : new Uint8Array(part.value || []);
    if (
      Number(part.part) !== index ||
      value.length !== Number(part.bytes) ||
      offset + value.length > bytes.length
    )
      fail("Referenced evidence chunks are invalid.", 409);
    bytes.set(value, offset);
    offset += value.length;
  }
  if (offset !== bytes.length || (await sha(bytes)) !== upload.sha256)
    fail("Referenced evidence checksum failed.", 409);
  return {
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    packageId: doc.package_id,
    version: doc.version,
    updatedAt: doc.updated_at,
    updatedBy: doc.updated_by,
    data: JSON.parse(new TextDecoder().decode(bytes)),
  };
}

async function packageIdentityClaimId(partnerKey: string, semanticKey: string) {
  const digest = await sha(
    new TextEncoder().encode(partnerKey + "\u0000" + semanticKey),
  );
  return "package_identity_" + digest;
}

async function readPackageIdentityClaim(
  db: Database,
  claimId: string,
): Promise<{ document_id: string } | null> {
  return db
    .prepare(
      "SELECT document_id FROM uploads WHERE id=? AND actor=? AND committed=?",
    )
    .bind(claimId, PACKAGE_IDENTITY_ACTOR, PACKAGE_IDENTITY_COMMITTED)
    .first<{ document_id: string }>();
}

async function acquirePackageIdentityClaim(
  db: Database,
  documentId: string,
  partnerKey: string,
  semanticKey: string,
): Promise<{ id: string; created: boolean; owner: string }> {
  const claimId = await packageIdentityClaimId(partnerKey, semanticKey);
  const created = await db
    .prepare(
      "INSERT OR IGNORE INTO uploads(id,document_id,expected_version,actor,created_at,committed,bytes,parts,sha256,metadata) VALUES(?,?,?,?,?,2,0,0,?,?)",
    )
    .bind(
      claimId,
      documentId,
      0,
      PACKAGE_IDENTITY_ACTOR,
      new Date().toISOString(),
      "0".repeat(64),
      JSON.stringify({
        kind: "CTI_INTERNAL_PACKAGE_IDENTITY",
        partnerKey,
        semanticKey,
      }),
    )
    .run();
  const claim = await readPackageIdentityClaim(db, claimId);
  if (!claim) fail("Package identity claim could not be verified.", 500);
  return {
    id: claimId,
    created: created.meta.changes === 1,
    owner: String(claim!.document_id || ""),
  };
}

async function releasePackageIdentityClaim(
  db: Database,
  claimId: string,
  documentId: string,
) {
  await db
    .prepare(
      "DELETE FROM uploads WHERE id=? AND document_id=? AND actor=? AND committed=?",
    )
    .bind(
      claimId,
      documentId,
      PACKAGE_IDENTITY_ACTOR,
      PACKAGE_IDENTITY_COMMITTED,
    )
    .run();
}
function requireWriteAccess(request: Request, user: { role: string }) {
  if (request.method === "GET") return;
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    fail("Cross-origin writes are not allowed.", 403);
  if (!["admin", "editor"].includes(user.role))
    fail("Your account has read-only access.", 403);
}
function panoptoProviderAction(
  request: Request,
): "metadata" | "podcast" | null {
  const match = new URL(request.url).pathname.match(
    /^\/api\/provider\/panopto\/(metadata|podcast)$/,
  );
  return match ? (match[1] as "metadata" | "podcast") : null;
}
async function handlePanoptoProvider(
  request: Request,
  user: { role: string },
  action: "metadata" | "podcast",
  providerFetcher: typeof fetch,
): Promise<Response> {
  requireWriteAccess(request, user);
  const serviceOrigin = new URL(request.url).origin;
  if (request.method !== "POST")
    return panoptoProviderErrorResponse(
      "PANOPTO_PROVIDER_METHOD_NOT_ALLOWED",
      405,
      serviceOrigin,
    );
  let input: Record<string, unknown>;
  try {
    const bytes = await boundedBody(request, 16384);
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw Error();
  } catch {
    return panoptoProviderErrorResponse(
      "PANOPTO_PROVIDER_INVALID_REQUEST",
      400,
      serviceOrigin,
    );
  }
  const keys =
    action === "metadata"
      ? ["targetUrl"]
      : ["targetUrl", "streamFileId", "sourceHash"];
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => typeof input[key] !== "string")
  )
    return panoptoProviderErrorResponse(
      "PANOPTO_PROVIDER_INVALID_REQUEST",
      400,
      serviceOrigin,
    );
  const options = {
    fetcher: providerFetcher,
    signal: request.signal,
    serviceOrigin,
  };
  return action === "metadata"
    ? readPanoptoProviderMetadata(input.targetUrl as string, options)
    : readPanoptoProviderPodcast(
        input as {
          targetUrl: string;
          streamFileId: string;
          sourceHash: string;
        },
        options,
      );
}
export function createApiHandler(
  authenticate: AccessAuthenticator = authenticateAccess,
  providerFetcher: typeof fetch = fetch,
) {
  return async (request: Request, env: Environment): Promise<Response> => {
    try {
      const identity = await authenticate(request, env);
      if (
        new URL(request.url).pathname === "/api/access" &&
        request.method === "GET"
      )
        return response({ fullCti: isCtiOwner(identity) });
      requireCtiOwner(identity);
      const role = list(env.CTI_ADMINS).includes(identity.email)
        ? "admin"
        : list(env.CTI_EDITORS).includes(identity.email)
          ? "editor"
          : "viewer";
      const providerAction = panoptoProviderAction(request);
      if (providerAction)
        return await handlePanoptoProvider(
          request,
          { role },
          providerAction,
          providerFetcher,
        );
      if (!env.CTI_DB || !list(env.CTI_ADMINS).length)
        fail(
          "Shared workspace setup is incomplete. Configure D1 and Cloudflare Access first.",
          503,
        );
      return await handleAuthorized(
        request,
        env.CTI_DB!,
        { ...identity, role },
        env.CTI_EXTRACTOR,
        providerFetcher,
      );
    } catch (error) {
      return response(
        {
          error:
            error instanceof Error
              ? error.message
              : "Workspace request failed.",
        },
        Number((error as { status?: number }).status) || 500,
      );
    }
  };
}
export const handleApi = createApiHandler();
// Separate authenticated handler permits DB/concurrency testing. The deployed
// entry point always verifies Access JWTs and the exact owner before reaching it.
export async function handleAuthorized(
  request: Request,
  db: Database,
  user: { email: string; role: string },
  extractor?: ServiceFetcher,
  providerFetcher: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url),
    p = url.pathname
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter(Boolean),
    method = request.method;
  const providerAction = panoptoProviderAction(request);
  if (providerAction)
    return handlePanoptoProvider(
      request,
      user,
      providerAction,
      providerFetcher,
    );
  requireWriteAccess(request, user);
  if (p[0] === "source-questions" && p.length === 1 && method === "POST") {
    const bytes = await boundedBody(request, 12000);
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      fail("Invalid source question request.");
    }
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      !("sourceKey" in input) ||
      !("targetUrl" in input) ||
      typeof input.sourceKey !== "string" ||
      typeof input.targetUrl !== "string"
    )
      return response(
        { error: "An exact source identity and URL are required." },
        400,
      );
    return response(
      await fetchSourceQuestions(
        input.sourceKey,
        input.targetUrl,
        fetch,
        request.signal,
      ),
    );
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
      init.body = (await boundedBody(
        request,
        256 * 1024,
      )) as unknown as BodyInit;
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
      let commitOptions: { allowSemanticDuplicate?: boolean } = {};
      const commitBody = await boundedBody(request, 2048);
      if (commitBody.length) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(commitBody));
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            fail("Invalid commit options.");
          commitOptions = parsed;
        } catch (error) {
          if ((error as { status?: number }).status) throw error;
          fail("Invalid commit options.");
        }
      }
      const allowSemanticDuplicate =
        commitOptions.allowSemanticDuplicate === true;
      if (
        allowSemanticDuplicate &&
        (user.role !== "admin" || Number(u.expected_version) !== 0)
      )
        fail(
          "Only an administrator may preserve historical duplicate package rows during a new-record migration import.",
          403,
        );

      const counts = await db
        .prepare(
          "SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM chunks WHERE upload_id=?",
        )
        .bind(u.id)
        .first();
      if (counts.count !== u.parts || counts.bytes !== u.bytes)
        fail("Upload is incomplete. Nothing has been saved.", 409);

      // The prepare request contains only a bounded summary. Reconstruct and
      // validate the complete payload at the trust boundary before committing
      // it as a workspace record. Client-side validation is not authoritative.
      const { results: storedChunks } = await db
        .prepare(
          "SELECT part,bytes,value FROM chunks WHERE upload_id=? ORDER BY part ASC",
        )
        .bind(u.id)
        .all();
      if (storedChunks.length !== u.parts)
        fail("Upload is incomplete. Nothing has been saved.", 409);
      const payloadBytes = new Uint8Array(u.bytes);
      let payloadOffset = 0;
      for (let index = 0; index < storedChunks.length; index++) {
        const chunk = storedChunks[index] as any;
        if (
          Number(chunk.part) !== index ||
          !Number.isInteger(Number(chunk.bytes)) ||
          Number(chunk.bytes) < 1
        )
          fail("Uploaded evidence chunk ordering is invalid.", 409);
        const value =
          chunk.value instanceof ArrayBuffer
            ? new Uint8Array(chunk.value)
            : ArrayBuffer.isView(chunk.value)
              ? new Uint8Array(
                  chunk.value.buffer,
                  chunk.value.byteOffset,
                  chunk.value.byteLength,
                )
              : new Uint8Array(chunk.value || []);
        if (value.length !== Number(chunk.bytes))
          fail("Uploaded evidence chunk length is invalid.", 409);
        payloadBytes.set(value, payloadOffset);
        payloadOffset += value.length;
      }
      if (payloadOffset !== u.bytes || (await sha(payloadBytes)) !== u.sha256)
        fail("Uploaded evidence checksum failed. Nothing has been saved.", 409);

      let fullData: unknown;
      try {
        fullData = JSON.parse(new TextDecoder().decode(payloadBytes));
      } catch {
        fail(
          "Uploaded evidence is not valid JSON. Nothing has been saved.",
          400,
        );
      }
      const r = JSON.parse(u.metadata) as WorkspaceRecord;
      let operationDependencies: { id: string; version: number | null }[] = [];
      let latestDeliverableAuditId = "";
      let deliverableReviewCount: number | undefined;
      try {
        validateRecord({ ...r, data: fullData as Record<string, unknown> });
        const protectedTypes = [
          "item-lifecycle",
          "evidence-input",
          "assignment-deliverable",
          "advisory-model",
        ];
        const current =
          Number(u.expected_version) > 0
            ? await db
                .prepare("SELECT * FROM documents WHERE id=?")
                .bind(r.id)
                .first()
            : null;
        const currentSummary = current
          ? JSON.parse(current.summary || "{}")
          : {};
        const next = { ...r, data: fullData as Record<string, any> };
        if (
          (r.kind === "operations" &&
            protectedTypes.includes(next.data.type)) ||
          (current?.kind === "operations" &&
            protectedTypes.includes(currentSummary.type))
        ) {
          const cache = new Map<string, WorkspaceRecord | undefined>();
          const lookup = async (id: string) => {
            if (!cache.has(id))
              cache.set(id, await readStoredWorkspaceRecord(db, id));
            return cache.get(id);
          };
          const previous = current ? await lookup(r.id) : undefined;
          validateWorkspaceTransition(previous, next);
          const { results: summaries } =
            next.data.type === "assignment-deliverable"
              ? await db
                  .prepare(
                    "SELECT id,kind,title,package_id,version,updated_at,updated_by,summary FROM documents ORDER BY updated_at DESC",
                  )
                  .all()
              : { results: [] };
          const records = summaries.map((doc) => ({
            id: doc.id,
            kind: doc.kind,
            title: doc.title,
            packageId: doc.package_id,
            version: doc.version,
            updatedAt: doc.updated_at,
            updatedBy: doc.updated_by,
            data: JSON.parse(doc.summary),
          })) as WorkspaceRecord[];
          await validateOperationalReferences(next, lookup, previous, records);
          operationDependencies = [...cache.entries()].map(([id, row]) => ({
            id,
            version: row?.version ?? null,
          }));
          if (next.data.type === "assignment-deliverable") {
            deliverableReviewCount = records.filter(
              (row) =>
                row.kind === "item-review" &&
                row.packageId === next.packageId &&
                row.data.auditId === next.data.auditId,
            ).length;
            operationDependencies.push(
              ...records
                .filter(
                  (row) =>
                    row.kind === "item-review" &&
                    row.packageId === next.packageId &&
                    row.data.auditId === next.data.auditId,
                )
                .map((row) => ({ id: row.id, version: row.version })),
            );
            if (
              ["approved", "external-application-recorded"].includes(
                next.data.event,
              )
            )
              latestDeliverableAuditId = next.data.auditId;
          }
        }
      } catch (error) {
        fail(
          error instanceof Error
            ? error.message
            : "Uploaded evidence does not satisfy the record contract.",
          400,
        );
      }
      let packageIdentity:
        | {
            desiredClaimId?: string;
            desiredClaimCreated?: boolean;
            priorClaimId?: string;
          }
        | undefined;
      if (r.kind === "package" && !allowSemanticDuplicate) {
        const data = fullData as Record<string, any>;
        const currentPackage = await db
          .prepare(
            "SELECT title,summary FROM documents WHERE id=? AND kind='package'",
          )
          .bind(r.id)
          .first<{ title: string; summary: string }>();
        let currentSummary: Record<string, any> = {};
        if (currentPackage) {
          try {
            currentSummary = JSON.parse(currentPackage.summary || "{}");
          } catch {
            // Full payload validation still protects the incoming record. A
            // malformed old listing summary is surfaced through Operations
            // health and must not be mistaken for a duplicate match.
          }
        }
        const priorPartner = normalizePartnerName(currentSummary.partner);
        const priorSemantic = currentPackage
          ? packageSemanticKey(
              currentSummary.scan?.fileName || currentPackage.title,
            )
          : "";
        const partnerKey = normalizePartnerName(data.partner);
        const semanticKey = packageSemanticKey(data.scan?.fileName || r.title);
        const activatesIdentity =
          !currentPackage ||
          currentSummary.archived === true ||
          priorPartner !== partnerKey ||
          priorSemantic !== semanticKey;

        packageIdentity = {};
        if (currentPackage && priorPartner && priorSemantic)
          packageIdentity.priorClaimId = await packageIdentityClaimId(
            priorPartner,
            priorSemantic,
          );

        if (data.archived !== true && partnerKey && semanticKey) {
          if (activatesIdentity) {
            // The human-readable duplicate scan explains conflicts from
            // historical rows. The identity claim below is the atomic race
            // barrier for simultaneous new/restore/rename commits.
            const { results: existingPackages } = await db
              .prepare(
                "SELECT id,title,summary FROM documents WHERE kind='package' AND id<>?",
              )
              .bind(r.id)
              .all<{ id: string; title: string; summary: string }>();
            for (const existing of existingPackages) {
              let summary: Record<string, any> = {};
              try {
                summary = JSON.parse(existing.summary || "{}");
              } catch {
                // A malformed old summary is an operational health issue, not a
                // reason to weaken duplicate protection for valid rows.
              }
              if (summary.archived === true) continue;
              if (
                normalizePartnerName(summary.partner) === partnerKey &&
                packageSemanticKey(summary.scan?.fileName || existing.title) ===
                  semanticKey
              )
                fail(
                  "An active course with the same partner and semantic package identity already exists. Rescan that course or reconcile duplicates in Operations.",
                  409,
                );
            }
          }

          const claim = await acquirePackageIdentityClaim(
            db,
            r.id,
            partnerKey,
            semanticKey,
          );
          packageIdentity.desiredClaimId = claim.id;
          packageIdentity.desiredClaimCreated = claim.created;
          if (claim.owner !== r.id) {
            // Same-identity edits on historical duplicate rows must stay
            // editable for reconciliation. Identity activation, however, is a
            // new collision and is rejected.
            if (activatesIdentity)
              fail(
                "An active course with the same partner and semantic package identity was committed concurrently. Refresh and reconcile duplicates in Operations.",
                409,
              );
            packageIdentity.desiredClaimId = undefined;
            packageIdentity.desiredClaimCreated = false;
          }
        }
      }

      // These references were checked before the write. Repeat their version
      // predicates in the atomic mutation so a concurrent course/review edit
      // cannot commit a decision against an obsolete evidence basis.
      const referencePredicate = operationDependencies.length
        ? " AND NOT EXISTS (SELECT 1 FROM json_each(?) AS reference LEFT JOIN documents AS dependency ON dependency.id=json_extract(reference.value,'$.id') WHERE (json_extract(reference.value,'$.version') IS NULL AND dependency.id IS NOT NULL) OR (json_extract(reference.value,'$.version') IS NOT NULL AND (dependency.id IS NULL OR dependency.version<>json_extract(reference.value,'$.version'))))"
        : "";
      const latestPredicate = latestDeliverableAuditId
        ? " AND (SELECT id FROM documents WHERE kind='audit' AND package_id=? ORDER BY updated_at DESC,id DESC LIMIT 1)=?"
        : "";
      const reviewPredicate =
        deliverableReviewCount !== undefined
          ? " AND (SELECT COUNT(*) FROM documents WHERE kind='item-review' AND package_id=? AND json_extract(summary,'$.auditId')=?)=?"
          : "";
      const dependencyBindings: unknown[] = [
        ...(operationDependencies.length
          ? [JSON.stringify(operationDependencies)]
          : []),
        ...(latestDeliverableAuditId
          ? [r.packageId, latestDeliverableAuditId]
          : []),
        ...(deliverableReviewCount !== undefined
          ? [
              r.packageId,
              (fullData as Record<string, any>).auditId,
              deliverableReviewCount,
            ]
          : []),
      ];
      let q: Statement;
      if (u.expected_version === 0)
        q = db
          .prepare(
            "INSERT INTO documents(id,kind,title,package_id,version,revision,updated_at,updated_by,summary) SELECT ?,?,?,?,1,?,?,?,? WHERE 1" +
              referencePredicate +
              latestPredicate +
              reviewPredicate +
              " ON CONFLICT(id) DO NOTHING",
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
            ...dependencyBindings,
          );
      else
        q = db
          .prepare(
            "UPDATE documents SET title=?,package_id=?,version=version+1,revision=?,updated_at=?,updated_by=?,summary=? WHERE id=? AND version=? AND kind=? AND kind<>'audit'" +
              referencePredicate +
              latestPredicate +
              reviewPredicate,
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
            ...dependencyBindings,
          );
      let results: Array<{ meta: { changes: number } }>;
      try {
        results = await db.batch([
          q,
          db
            .prepare(
              "UPDATE uploads SET committed=1 WHERE id=? AND EXISTS(SELECT 1 FROM documents WHERE id=? AND revision=?)",
            )
            .bind(u.id, r.id, u.id),
        ]);
      } catch (error) {
        if (
          packageIdentity?.desiredClaimCreated &&
          packageIdentity.desiredClaimId
        )
          await releasePackageIdentityClaim(
            db,
            packageIdentity.desiredClaimId,
            r.id,
          );
        throw error;
      }
      if (results[0].meta.changes !== 1) {
        if (
          packageIdentity?.desiredClaimCreated &&
          packageIdentity.desiredClaimId
        )
          await releasePackageIdentityClaim(
            db,
            packageIdentity.desiredClaimId,
            r.id,
          );
        fail(
          "Another edit was committed first. Refresh before retrying; this upload did not replace it.",
          409,
        );
      }

      if (
        packageIdentity?.priorClaimId &&
        packageIdentity.priorClaimId !== packageIdentity.desiredClaimId
      )
        await releasePackageIdentityClaim(
          db,
          packageIdentity.priorClaimId,
          r.id,
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
