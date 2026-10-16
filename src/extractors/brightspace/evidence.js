import { sameOrigin } from "./text-and-dom.js";

export function topicEvidencePolicy(activityType, url) {
  const n = Number(activityType);
  // Tool pages can render class/attempt/submission UI even when the definition itself is safe.
  // Never render learner/tool pages. Only the explicitly implemented native
  // definition readers may establish definition evidence.
  if (
    [
      3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 20, 21, 22, 23, 24, 25, 26, 27, 29,
    ].includes(n)
  ) {
    return {
      fetch: false,
      status: [3, 4, 5, 6].includes(n)
        ? "DEFINITION_API_ONLY"
        : "UNSUPPORTED_ACTIVITY_DEFINITION",
      reason: [3, 4, 5, 6].includes(n)
        ? "Only separately recorded assignment, quiz or discussion API responses can establish definition evidence. The rendered tool page is not fetched."
        : "This activity has no supported native definition reader. Its source reference is retained; the rendered learner/tool page is not fetched.",
    };
  }
  if (n === 2 || n === 7 || n === 14) {
    if (!url || !sameOrigin(url))
      return {
        fetch: false,
        status: "EXTERNAL_NOT_FETCHED",
        reason: "External link/tool destination is recorded but never fetched.",
      };
  }
  return { fetch: !!url, status: url ? "ELIGIBLE" : "NO_URL", reason: "" };
}

export function brightspaceNativeIdV110(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  for (const field of fields) {
    const id = value[field];
    if (
      (typeof id === "string" && /^\d{1,30}$/.test(id)) ||
      (typeof id === "number" && Number.isSafeInteger(id) && id >= 0)
    )
      return String(id);
  }
  return "";
}

/** Follow only response-declared Next links on this exact native endpoint.
 * Native duplicate rows remain retained; pagination and identity are separate
 * observations. Unsupported paging shapes fail closed without guessed routes. */
export async function fetchBrightspaceInventoryV110(options) {
  const base = new URL(options.initialUrl),
    rows = [],
    seenPages = new Set(),
    ids = new Set();
  const limit = options.limit,
    maxPages = options.maxPages || 300;
  const evidence = {
    pages: 0,
    returnedDefinitions: 0,
    capturedDefinitions: 0,
    duplicates: 0,
    missingIdentities: 0,
    invalidRows: 0,
    pageTraversalComplete: false,
    complete: false,
    stopReason: "",
    responseKeys: [],
    anomalies: [],
    limit,
    maxPages,
  };
  let next = base.href;
  while (next && evidence.pages < maxPages) {
    options.check?.();
    let url;
    try {
      url = new URL(next, base.href);
    } catch (_) {
      evidence.stopReason = "INVALID_NEXT_URL";
      break;
    }
    if (
      url.origin !== base.origin ||
      url.pathname.replace(/\/$/, "") !== base.pathname.replace(/\/$/, "") ||
      url.username ||
      url.password ||
      url.hash
    ) {
      evidence.stopReason = "OUT_OF_SCOPE_NEXT_URL";
      break;
    }
    if (seenPages.has(url.href)) {
      evidence.stopReason = "REPEATED_PAGE";
      break;
    }
    seenPages.add(url.href);
    let payload;
    try {
      payload = await options.fetchJson(
        url.href,
        options.label + " page " + (evidence.pages + 1),
      );
    } catch (error) {
      if (!evidence.pages) throw error;
      evidence.stopReason =
        error.code === "REQUEST_CAP" ? "REQUEST_CAP" : "PAGE_UNAVAILABLE";
      evidence.error = String(error.message || error);
      break;
    }
    evidence.pages++;
    let list = Array.isArray(payload) ? payload : null;
    if (!list && payload && typeof payload === "object")
      for (const key of [
        "Objects",
        "objects",
        "Items",
        "items",
        "Results",
        "results",
        "Modules",
        "modules",
        "Topics",
        "topics",
      ]) {
        if (Array.isArray(payload[key])) {
          list = payload[key];
          break;
        }
      }
    if (!list) {
      evidence.stopReason = "UNRECOGNIZED_PAGE_SHAPE";
      break;
    }
    evidence.responseKeys = Array.isArray(payload)
      ? ["ARRAY"]
      : Object.keys(payload).slice(0, 30);
    evidence.returnedDefinitions += list.length;
    let omitted = false;
    for (let ordinal = 0; ordinal < list.length; ordinal++) {
      const row = list[ordinal];
      if (rows.length + evidence.invalidRows >= limit) {
        omitted = true;
        continue;
      }
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        evidence.invalidRows++;
        evidence.anomalies.push({
          kind: "INVALID_NATIVE_ROW",
          page: evidence.pages,
          ordinal: ordinal + 1,
          raw: row,
        });
        continue;
      }
      const id = brightspaceNativeIdV110(row, options.idFields);
      if (!id) {
        evidence.missingIdentities++;
        evidence.anomalies.push({
          kind: "MISSING_NATIVE_ID",
          page: evidence.pages,
          ordinal: ordinal + 1,
        });
      } else if (ids.has(id)) {
        evidence.duplicates++;
        evidence.anomalies.push({
          kind: "DUPLICATE_NATIVE_ID",
          id,
          page: evidence.pages,
          ordinal: ordinal + 1,
        });
      }
      if (id) ids.add(id);
      rows.push(row);
    }
    if (omitted) {
      evidence.stopReason = "DEFINITION_LIMIT";
      break;
    }
    if (Array.isArray(payload)) {
      evidence.pageTraversalComplete = true;
      break;
    }
    if (!Object.hasOwn(payload, "Next")) {
      if (payload.PagingInfo?.HasMoreItems === false) {
        evidence.pageTraversalComplete = true;
        break;
      }
      evidence.stopReason = payload.PagingInfo
        ? "UNSUPPORTED_PAGING_CONTRACT"
        : "MISSING_NEXT_MARKER";
      break;
    }
    next = payload.Next;
    if (next == null || next === "") {
      evidence.pageTraversalComplete = true;
      break;
    }
    if (typeof next !== "string") {
      evidence.stopReason = "INVALID_NEXT_URL";
      break;
    }
    if (rows.length >= limit) {
      evidence.stopReason = "DEFINITION_LIMIT";
      break;
    }
    if (options.sleep) await options.sleep(options.delayMs || 0);
  }
  evidence.capturedDefinitions = rows.length;
  if (!evidence.stopReason)
    evidence.stopReason = evidence.pageTraversalComplete
      ? "END_OF_API_PAGES"
      : "PAGE_LIMIT";
  evidence.complete =
    evidence.pageTraversalComplete &&
    !evidence.duplicates &&
    !evidence.missingIdentities &&
    !evidence.invalidRows;
  return { objects: rows, evidence };
}

/** Preserve an ordered native structure or the separate native module/topic
 * arrays. Separate arrays do not establish their combined interleaving. */
export function brightspaceModuleChildrenV110(value) {
  const object =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const ordered = Array.isArray(value)
    ? value
    : ["Structure", "structure", "Items", "items", "Children", "children"]
        .map((key) => object[key])
        .find(Array.isArray);
  const classify = (row) => {
    if (!row || typeof row !== "object") return "UNKNOWN";
    const type = row.Type == null ? row.ContentType : row.Type;
    if (Number(type) === 0 && type != null) return "MODULE";
    if (Number(type) === 1 && type != null) return "TOPIC";
    if (
      row.ModuleId != null ||
      row.moduleId != null ||
      ["Structure", "Modules", "Topics", "children"].some((key) =>
        Array.isArray(row[key]),
      )
    )
      return "MODULE";
    if (
      row.TopicId != null ||
      row.topicId != null ||
      row.Url != null ||
      row.URL != null ||
      row.ActivityType != null
    )
      return "TOPIC";
    return "UNKNOWN";
  };
  if (ordered)
    return {
      recognized: true,
      ordering: "NATIVE_ORDERED_LIST",
      children: ordered.map((raw, ordinal) => ({
        raw,
        ordinal: ordinal + 1,
        kind: classify(raw),
      })),
    };
  const modules = object.Modules ?? object.modules,
    topics = object.Topics ?? object.topics;
  if (Array.isArray(modules) || Array.isArray(topics))
    return {
      recognized: true,
      ordering: "SEPARATE_NATIVE_ARRAYS_INTERLEAVING_UNVERIFIED",
      children: [
        ...(Array.isArray(modules)
          ? modules.map((raw, ordinal) => ({
              raw,
              ordinal: ordinal + 1,
              kind: "MODULE",
            }))
          : []),
        ...(Array.isArray(topics)
          ? topics.map((raw, ordinal) => ({
              raw,
              ordinal: ordinal + 1,
              kind: "TOPIC",
            }))
          : []),
      ],
    };
  return { recognized: false, ordering: "UNRECOGNIZED", children: [] };
}
