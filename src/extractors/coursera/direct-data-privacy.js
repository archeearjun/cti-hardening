// Shared credential sanitizer for diagnostic and direct authoring capture.
export function sanitizeCourseraCourseDataModel(value) {
  const denied = new Set(
    [
      "token",
      "writeaccesstoken",
      "conflictdetectiontoken",
      "consumerkey",
      "write_access_token",
      "accesstoken",
      "access_token",
      "refreshtoken",
      "refresh_token",
      "idtoken",
      "id_token",
      "authtoken",
      "auth_token",
      "bearertoken",
      "bearer_token",
      "bearer",
      "jwt",
      "jwttoken",
      "jwt_token",
      "csrftoken",
      "csrf_token",
      "xsrftoken",
      "xsrf_token",
      "x-csrf-token",
      "x-xsrf-token",
      "x-auth-token",
      "x-access-token",
      "x-authorization",
      "csrf",
      "xsrf",
      "authorization",
      "auth",
      "authentication",
      "cookie",
      "cookies",
      "set-cookie",
      "sessionid",
      "session_id",
      "sessiontoken",
      "session_token",
      "password",
      "passwd",
      "secret",
      "clientsecret",
      "client_secret",
      "credential",
      "credentials",
      "apikey",
      "api_key",
      "privatekey",
      "private_key",
      "accesskeyid",
      "awsaccesskeyid",
      "signature",
      "x-amz-credential",
      "x-amz-security-token",
      "x-amz-signature",
      "x-goog-credential",
      "x-goog-signature",
      "x-api-key",
      "hmac",
      "key-pair-id",
    ].map((key) => key.replace(/[^a-z0-9]/g, "")),
  );
  const credentialKey = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
  let nodes = 0,
    removedFields = 0,
    redactedUrls = 0,
    limitReached = false;
  function cleanUrl(text) {
    // Visit each non-markup token once. An unanchored greedy prefix looking
    // for a missing '?' or '#' retries the entire remaining suffix at every
    // character and can freeze Chrome on a large, ordinary CML text node.
    return text.replace(/[^\s"'<>]+/g, (fragment) => {
      let protocol =
        /https?:\/\//i.exec(fragment) ||
        (fragment.startsWith("//") ? { index: 0 } : null);
      const queryAt = fragment.indexOf("?"),
        hashAt = fragment.indexOf("#");
      const firstMarker =
        queryAt < 0 ? hashAt : hashAt < 0 ? queryAt : Math.min(queryAt, hashAt);
      // An absolute URL can itself be the value of a relative outer URL's
      // query. Keep that outer URL intact so its credential parameters are
      // removed instead of being mistaken for a harmless literal prefix.
      if (protocol && firstMarker >= 0 && firstMarker < protocol.index)
        protocol = null;
      if (!protocol && !fragment.includes("?") && !fragment.includes("#"))
        return fragment;
      const prefix = protocol ? fragment.slice(0, protocol.index) : "";
      const original = protocol ? fragment.slice(protocol.index) : fragment;
      try {
        const absolute = /^https?:\/\//i.test(original),
          protocolRelative = original.startsWith("//");
        const address = new URL(original, "https://cti-redaction.invalid/");
        let changed = Boolean(address.username || address.password);
        address.username = "";
        address.password = "";
        for (const key of [...address.searchParams.keys()])
          if (denied.has(credentialKey(key.replace(/^(?:amp;)+/g, ""))) ||
              /^(?:policy|expiry|expires|x-amz-expires|x-goog-expires)$/i.test(key.replace(/^(?:amp;)+/g, ""))) {
            address.searchParams.delete(key);
            changed = true;
          }
        if (
          address.hash &&
          /(?:token|credential|authorization|password|secret)/i.test(
            address.hash,
          )
        ) {
          address.hash = "";
          changed = true;
        }
        if (changed) {
          redactedUrls++;
          return (
            prefix +
            (absolute
              ? address.href
              : protocolRelative
                ? address.href.replace(/^https:/, "")
                : original.split(/[?#]/)[0] + address.search + address.hash)
          );
        }
      } catch {
        /* A non-URL content fragment is retained as observed. */
      }
      return fragment;
    });
  }
  function walk(entry, depth) {
    if (++nodes > 100000 || depth > 48) {
      limitReached = true;
      return null;
    }
    if (typeof entry === "string") {
      if (entry.length > 2 * 1024 * 1024) {
        limitReached = true;
        return null;
      }
      // Some plugin/atom models contain a serialized JSON configuration string.
      // Strip known credentials there as well, while retaining the string type.
      if (/^\s*[\[{]/.test(entry)) {
        try {
          return JSON.stringify(walk(JSON.parse(entry), depth + 1));
        } catch {
          /* Ordinary text. */
        }
      }
      return cleanUrl(entry);
    }
    if (entry === null || typeof entry !== "object") return entry;
    if (Array.isArray(entry))
      return entry.map((child) => walk(child, depth + 1));
    const out = Object.create(null);
    for (const [key, child] of Object.entries(entry)) {
      if (denied.has(credentialKey(key))) {
        removedFields++;
        continue;
      }
      out[key] = walk(child, depth + 1);
    }
    return out;
  }
  const data = walk(value, 0);
  return { data, removedFields, redactedUrls, limitReached };
}
