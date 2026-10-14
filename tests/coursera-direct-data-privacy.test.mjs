import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { sanitizeCourseraCourseDataModel as sanitize } from "../src/extractors/coursera/direct-data-privacy.js";

test("large ordinary CML text stays unchanged without quadratic URL-marker searching", () => {
  const sizes = [10000, 20000, 40000, 1400000];
  const timings = [];
  for (const size of sizes) {
    const cml = "<co-content><p>" + "x".repeat(size) + "</p></co-content>";
    const start = performance.now(),
      result = sanitize({ definition: { value: cml } }),
      elapsed = performance.now() - start;
    timings.push({ characters: size, elapsedMs: elapsed });
    assert.equal(result.data.definition.value, cml);
    assert.equal(result.redactedUrls, 0);
    assert.equal(result.limitReached, false);
    // This is a deliberately broad CPU bound: the old40k input already needed
    // seconds, and the1.4M regression could stop Chrome's own timers entirely.
    assert(
      elapsed < 2000,
      "Ordinary CML sanitizer exceeded its broad2s bound: " +
        JSON.stringify(timings),
    );
  }
});

test("URL credentials are removed while surrounding CML markup, literal prefixes and nonsecret references remain", () => {
  const source =
    "<co-content><p>URL:HTTPS://user:password@example.test/a?item=good&amp;access_token=secret-access#secret-token</p>" +
    '<a href="//host.test/path?order=2&X-Amz-Credential=secret-credential&X-Amz-Signature=secret-signature">Link</a>' +
    '<img src="../asset?itemId=keep&amp;session_token=secret-session"/><a href="#ordinary-section">Section</a></co-content>';
  const result = sanitize({ value: source }),
    clean = result.data.value;
  assert.equal(result.redactedUrls, 3);
  for (const secret of [
    "user:password",
    "secret-access",
    "secret-token",
    "secret-credential",
    "secret-signature",
    "secret-session",
  ])
    assert(!clean.includes(secret));
  assert(
    clean.startsWith("<co-content><p>URL:https://example.test/a?item=good</p>"),
  );
  assert(clean.includes('<a href="//host.test/path?order=2">Link</a>'));
  assert(clean.includes('<img src="../asset?itemId=keep"/>'));
  assert(clean.includes('<a href="#ordinary-section">Section</a>'));
  assert(clean.endsWith("</co-content>"));
});

test("nonsecret URLs, query text and ordinary source fragments remain byte-identical", () => {
  const values = [
    "Original question? Keep it exactly.",
    "/path?itemId=keep#section",
    "../folder/file?revision=1",
    "//host.test/path?order=2",
    "https://example.test/path?itemId=keep&revision=1#section",
    "<p>Plain text &amp; punctuation / relative paths and #ordinary labels.</p>",
  ];
  for (const value of values) {
    const result = sanitize({ value });
    assert.equal(result.data.value, value);
    assert.equal(result.redactedUrls, 0);
  }
});

test("Coursera delivery HMAC, policy, signing-key and expiration parameters are not retained", () => {
  const result=sanitize({url:'https://fixture.cloudfront.net/image.png?width=300&format=webp&hmac=hidden-hmac&expiry=100&Expires=101&Policy=hidden-policy&Key-Pair-Id=hidden-key&Signature=hidden-signature',
    metadata:{expires:102,hmac:'hidden-field'}});
  assert.equal(result.data.url,'https://fixture.cloudfront.net/image.png?width=300&format=webp');
  assert(!JSON.stringify(result.data).includes('hidden-'));
  assert.equal(result.data.metadata.expires,102);assert.equal(result.removedFields,1);
});

test("native scoring and configuration policy fields are preserved while delivery URL Policy is redacted", () => {
  const source={configuration:{policy:{attempts:3,scoring:'highest',feedback:'after submission'}},
    policy:'source wording',url:'https://fixture.cloudfront.net/file.pptx?Policy=secret-signed-policy&revision=2'};
  const result=sanitize(source);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.configuration.policy)),source.configuration.policy);
  assert.equal(result.data.policy,'source wording');
  assert.equal(result.data.url,'https://fixture.cloudfront.net/file.pptx?revision=2');
  assert.equal(result.removedFields,0);assert.equal(result.redactedUrls,1);
  assert(!JSON.stringify(result.data).includes('secret-signed-policy'));
});

test("relative paths containing a double slash retain their path semantics when a query credential is removed", () => {
  const result = sanitize({
    href: "../assets//image?access_token=secret&id=keep",
  });
  assert.equal(result.data.href, "../assets//image?id=keep");
  assert.equal(result.redactedUrls, 1);
});

test("an embedded absolute URL does not hide credential parameters in its outer relative URL", () => {
  const result = sanitize({
    href: "/path?token=outer-secret&next=https://host.test/a",
  });
  assert.equal(result.redactedUrls, 1);
  assert(!result.data.href.includes("outer-secret"));
  const cleaned = new URL(result.data.href, "https://base.test");
  assert.equal(cleaned.pathname, "/path");
  assert.equal(cleaned.searchParams.has("token"), false);
  assert.equal(cleaned.searchParams.get("next"), "https://host.test/a");
  const fragment = sanitize({
    href: "/path#token=outer-secret&next=https://host.test/a",
  });
  assert.equal(fragment.data.href, "/path");
});

test("known credential fields and nested serialized URL configuration still receive the shared sanitation", () => {
  const result = sanitize({
    session_token: "secret-session",
    "x-csrf-token": "secret-csrf",
    config: JSON.stringify({
      href: "https://host.test/path?accessToken=secret-url",
      nested: {
        writeAccessToken: "secret-write",
        orderedGroups: ["owner~second", "owner~first"],
      },
    }),
  });
  assert.equal(result.removedFields, 3);
  assert.equal(result.redactedUrls, 1);
  assert(!JSON.stringify(result.data).includes("secret-"));
  const config = JSON.parse(result.data.config);
  assert.equal(config.href, "https://host.test/path");
  assert.deepEqual(config.nested.orderedGroups, [
    "owner~second",
    "owner~first",
  ]);
});

test("the shared sanitizer remains standalone and rejects oversized strings before URL parsing", () => {
  const standalone = vm.runInNewContext("(" + sanitize.toString() + ")", {
    URL,
  });
  const source = {
    value: "<p>" + "x".repeat(40000) + "</p>",
    href: "/path?token=secret&id=keep",
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(standalone(source))),
    JSON.parse(JSON.stringify(sanitize(source))),
  );
  const result = sanitize({ value: "x".repeat(2 * 1024 * 1024 + 1) });
  assert.equal(result.limitReached, true);
  assert.equal(result.data.value, null);
});
