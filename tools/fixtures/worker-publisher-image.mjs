import { createApiHandler } from "../../server/api.ts";
import { CTI_OWNER_EMAIL } from "../../server/access.ts";
import { readPublisherImageProvider } from "../../server/publisher-image-provider.ts";
import { stateUrl } from "./worker-panopto-source.mjs";

export const publisherImageOrigin = "https://pressbooks.bccampus.ca";
export const publisherImagePath = "/cti-workerd-fixture/wp-content/uploads/";
export const publisherImageBytes = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 11, 22, 33, 44, 55, 66, 77,
]);
export const publisherImageUrl = (name) =>
  publisherImageOrigin + publisherImagePath + name + ".png";
const sourceSha256 = "a".repeat(64),
  targetUrl = "https://opentextbc.ca/cti-workerd-fixture/?p=125";
const assert = (value, message) => {
  if (!value) throw Error(message);
};
const equal = (a, b, message) =>
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    message + ": " + JSON.stringify({ actual: a, expected: b }),
  );
async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

/** Actual private service/DO/native fetch; outbound URLs only reach the existing
 * in-memory mock. This does not probe either live publisher. */
export async function publisherImageRuntimeChecks(env) {
  const origin = "https://cti-hardening.pages.dev";
  let pagesFetches = 0;
  const api = createApiHandler(
    async () => ({ email: CTI_OWNER_EMAIL }),
    () => {
      pagesFetches++;
      throw Error("Pages must not fetch images");
    },
  );
  const environment = {
    CTI_EDITORS: CTI_OWNER_EMAIL,
    CTI_EXTRACTOR: env.PRIVATE_RUNTIME,
    CTI_DB: {
      prepare() {
        throw Error("Images must not use D1");
      },
    },
  };
  const read = (name, extra = {}, signal) =>
    api(
      new Request(origin + "/api/provider/publisher-image", {
        method: "POST",
        signal,
        headers: {
          Origin: origin,
          Cookie: "synthetic=forbidden",
          Authorization: "Bearer synthetic-forbidden",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetUrl,
          imageUrl: publisherImageUrl(name),
          sourceSha256,
          ...extra,
        }),
      }),
      environment,
    );
  for (const name of ["success", "chunked"]) {
    const response = await read(name);
    equal(response.status, 200, "The actual private image route succeeds");
    equal(
      response.headers.get("X-CTI-Provider-Transport"),
      "CTI_SERVICE_PUBLIC_IMAGE",
      "Service provenance differs from browser CORS",
    );
    equal(
      response.headers.get("X-CTI-Provider-Origin"),
      origin,
      "Service origin remains Pages",
    );
    equal(
      response.headers.get("X-CTI-Upstream-Status"),
      "200",
      "Native status",
    );
    equal(
      response.headers.get("X-CTI-Upstream-Requests"),
      "1",
      "Only one public GET",
    );
    equal(
      response.headers.get("X-CTI-Upstream-Bytes"),
      String(publisherImageBytes.length),
      "Observed bytes",
    );
    equal(
      response.headers.get("X-CTI-Upstream-Content-Length"),
      String(publisherImageBytes.length),
      "Actual EOF length survives private binary framing",
    );
    equal(
      response.headers.get("X-CTI-Upstream-Sha256"),
      await digest(publisherImageBytes),
      "Actual image SHA survives private transport",
    );
    equal(
      response.headers.get("X-CTI-Publisher-Source-Hash"),
      sourceSha256,
      "Declared source context is echoed separately",
    );
    equal(
      response.headers.get("X-CTI-Validation-Source-Hash"),
      null,
      "No source revalidation is attested",
    );
    equal(
      [...new Uint8Array(await response.arrayBuffer())],
      [...publisherImageBytes],
      "Exact binary bytes",
    );
  }
  for (const [name, code, upstream] of [
    ["redirect", "REDIRECT", 307],
    ["denied", "HTTP_401", 401],
    ["challenge", "CHALLENGE", 403],
    ["html", "MIME", 200],
    ["signature", "SIGNATURE", 200],
    ["encoded", "ENCODING", 200],
    ["range", "HTTP_200", 200],
    ["short-framed", "REQUEST_FAILED", 200],
  ]) {
    const response = await read(name);
    equal(
      response.status,
      502,
      "A failed public image never becomes media: " + name,
    );
    equal(
      response.headers.get("X-CTI-Upstream-Status"),
      String(upstream),
      "Actual failed status",
    );
    const result = await response.json();
    assert(
      /^PUBLISHER_IMAGE_PROVIDER_/.test(result.error),
      "Only structured image error codes",
    );
    if (name !== "short-framed")
      equal(
        result.error,
        "PUBLISHER_IMAGE_PROVIDER_" + code,
        "Exact rejection",
      );
    equal(
      response.headers.get("X-CTI-Upstream-Sha256"),
      null,
      "Failure has no successful image hash",
    );
  }
  // Separately prove the maintained provider's application-level cancellation
  // contract using native workerd fetch, without an already-aborted API hop.
  const nativeAbort = new AbortController();
  const nativePending = readPublisherImageProvider(
    { targetUrl, imageUrl: publisherImageUrl("held-direct"), sourceSha256 },
    { signal: nativeAbort.signal },
  );
  let nativeStarted = false;
  for (let index = 0; index < 100; index++) {
    const snapshot = await (await fetch(stateUrl)).json();
    if (snapshot.pulls.includes("publisher-image-held-direct")) {
      nativeStarted = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert(
    nativeStarted,
    "The direct maintained provider starts its native public read",
  );
  nativeAbort.abort();
  const nativeStopped = await nativePending;
  equal(
    nativeStopped.status,
    499,
    "Direct maintained provider cancellation returns application499",
  );
  equal(
    await nativeStopped.json(),
    { error: "PUBLISHER_IMAGE_PROVIDER_ABORTED" },
    "Direct provider retains its explicit abort code",
  );
  let nativeState;
  for (let index = 0; index < 100; index++) {
    nativeState = await (await fetch(stateUrl)).json();
    if (nativeState.cancelled.includes("publisher-image-held-direct")) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert(
    nativeState.cancelled.includes("publisher-image-held-direct"),
    "Direct provider cancellation closes its native source before API testing",
  );
  console.log(
    "CTI_WORKERD_PUBLISHER_IMAGE_DIRECT_ABORT_PROVED " +
      JSON.stringify({
        status: nativeStopped.status,
        nativeBodyCancelled: true,
        applicationError: "PUBLISHER_IMAGE_PROVIDER_ABORTED",
      }),
  );
  // Hold an upstream body before EOF so platform prefetch of tiny responses
  // cannot hide the permit. The operation is cancelled, never retried upstream.
  const controller = new AbortController();
  const held = read("held", {}, controller.signal).catch(() => null);
  const cleanupDeadline = Date.now() + 22000;
  try {
    let started = false;
    for (let index = 0; index < 100; index++) {
      const snapshot = await (await fetch(stateUrl)).json();
      if (snapshot.pulls.includes("publisher-image-held")) {
        started = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert(started, "The first actual upstream read has started");
    const busy = await read("success");
    equal(busy.status, 503, "Second concurrent image is bounded independently");
    equal(
      await busy.json(),
      { error: "PUBLISHER_IMAGE_PROVIDER_BUSY" },
      "Distinct image busy code",
    );
    equal(
      busy.headers.get("X-CTI-Upstream-Requests"),
      "0",
      "Busy request makes no public GET",
    );
    controller.abort();
    const stopped = await held;
    let abortObservation = { status: 0, contentType: "", body: "" };
    if (stopped) {
      const body = await stopped.text();
      assert(
        body.length <= 512,
        "The synthetic abort diagnostic remains bounded",
      );
      abortObservation = {
        status: stopped.status,
        contentType: stopped.headers.get("content-type") || "",
        body,
      };
      console.log(
        "CTI_WORKERD_PUBLISHER_IMAGE_API_ABORT_OBSERVATION " +
          JSON.stringify(abortObservation),
      );
      assert(
        !stopped.ok,
        "An aborted private API operation never returns successful image bytes",
      );
      equal(
        stopped.headers.get("X-CTI-Upstream-Sha256"),
        null,
        "Aborted API result has no successful image hash",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    const recovered = await read("success");
    equal(recovered.status, 200, "Cancel releases image permit");
    await recovered.arrayBuffer();
    const invalid = await read("success", {
      imageUrl: publisherImageUrl("success") + "?",
    });
    equal(
      invalid.status,
      400,
      "Even empty queries are not literal image requests",
    );
    await invalid.arrayBuffer();
    equal(
      pagesFetches,
      0,
      "Source validation and reads execute only in the private DO",
    );
    const observed = await (await fetch(stateUrl)).json(),
      calls = observed.calls.filter((call) =>
        call.url.startsWith(publisherImageOrigin + publisherImagePath),
      );
    assert(calls.length >= 12, "The fixture observed real native image reads");
    assert(
      observed.cancelled.includes("publisher-image-held"),
      "Cancellation reaches the actual native image body",
    );
    assert(
      observed.cancelled.includes("publisher-image-held-direct"),
      "Direct provider cancellation reaches the native image body",
    );
    assert(
      calls.every(
        (call) =>
          call.method === "GET" &&
          !call.body &&
          call.headers.every(
            ([name]) =>
              ![
                "cookie",
                "authorization",
                "referer",
                "x-cti-user",
                "x-cti-role",
              ].includes(name.toLowerCase()),
          ),
      ),
      "No credentials or delegated identity reach the public image source",
    );
    console.log(
      "CTI_WORKERD_PUBLISHER_IMAGE_ABORT_CLEANUP_PROVED " +
        JSON.stringify({
          nativeBodyCancelled: true,
          imagePermitReleased: true,
          noSuccessfulAbortedBody: true,
          directProviderStatus: nativeStopped.status,
          apiAbort: abortObservation,
        }),
    );
    // Native private fetch aborts can surface this exact structured platform
    // failure instead of the provider's application499. Classify it only after
    // actual upstream cancellation and immediate permit reuse were proved.
    if (stopped) {
      assert(
        controller.signal.aborted,
        "The caller actually cancelled this operation",
      );
      equal(
        abortObservation.contentType,
        "application/json",
        "Abort result remains structured JSON",
      );
      if (stopped.status === 499)
        equal(
          abortObservation.body,
          JSON.stringify({ error: "PUBLISHER_IMAGE_PROVIDER_ABORTED" }),
          "Application abort has the exact safe provider code",
        );
      else {
        equal(
          stopped.status,
          500,
          "Only the observed native abort failure is classified",
        );
        equal(
          abortObservation.body,
          JSON.stringify({ error: "The operation was aborted" }),
          "An arbitrary HTTP500 cannot satisfy native cancellation",
        );
      }
    }
    console.log(
      "CTI_WORKERD_PUBLISHER_IMAGE_PROVIDER_PASS " +
        JSON.stringify({
          actualWorkersRuntime: true,
          actualPrivateDurableObject: true,
          pagesReadsSource: false,
          onePublicGet: true,
          rawBinaryAndSha256: true,
          exactDecodedLength: true,
          sourceHashIsDeclaredContextOnly: true,
          mimeAndSignatureChecked: true,
          redirectsRejected: true,
          encodedAndPartialRejected: true,
          shortFramingRejected: true,
          singleImagePermit: true,
          permitReleasedOnCancel: true,
          directProviderAbortStatus: nativeStopped.status,
          nativeApiAbortStatus: abortObservation.status,
          incomingRequestSignalEnabled: true,
          credentialsForwarded: false,
          livePublicAccessVerified: false,
          sockets: 0,
          externalNetwork: false,
        }),
    );
  } finally {
    // A failed assertion must not terminate the test's I/O context while its
    // deliberately stalled native body is still live. Keep the failed gate;
    // this cleanup only lets the existing bounded upstream deadline finish.
    controller.abort();
    let cleaned = false;
    while (Date.now() < cleanupDeadline) {
      const snapshot = await (await fetch(stateUrl)).json();
      if (snapshot.cancelled.includes("publisher-image-held")) {
        cleaned = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    console.log(
      "CTI_WORKERD_PUBLISHER_IMAGE_API_ABORT_FINALLY " +
        JSON.stringify({ nativeBodyCancelled: cleaned }),
    );
    assert(
      cleaned,
      "The native held body must end even after a failed cancellation assertion",
    );
  }
}
