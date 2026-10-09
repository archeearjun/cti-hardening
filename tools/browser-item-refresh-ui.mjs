import assert from "node:assert/strict";
import path from "node:path";

// Built-app UI contract with a controlled extension transport. The separate
// browser-extension-check executes the real MV3 extension and extractor.
export async function checkItemRefreshUi(page, capture, shots) {
  await page.evaluate((base) => {
    window.ctiRefreshTest = { mode: "complete", cancelled: 0, saved: 0 };
    let spec, result;
    window.addEventListener("message", (event) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.channel !== "CTI_EXTENSION_REQUEST"
      )
        return;
      const { requestId, body } = event.data,
        test = window.ctiRefreshTest;
      let response = { ok: true };
      if (body.type === "PING")
        response = { ok: true, version: "1.0.1", protocol: 1 };
      if (body.type === "START") {
        spec = body.spec;
        result = {
          ...structuredClone(base),
          ...spec,
          expectations: spec.checks,
          openedUrl: spec.url,
          extractorVersion: "v6.15.12",
          extractorBuild: "v6.15.12-editor-identity-20261009",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          crawl: {
            targetDiagnostics: [{ id: spec.itemId, stabilityTimedOut: false }],
          },
        };
        result.payload.structuredAssessment.questions.push({
          id: "q3",
          prompt: "Newly added question",
        });
        result.payload.structuredAssessment.declaredQuestionCount = 3;
        result.payload.structuredAssessment.captureCompleteness = {
          declared: 3,
          questionCoverageComplete: true,
        };
        if (test.mode === "partial") {
          result.payload.structuredAssessment.questions = [
            {
              id: "q1",
              prompt: "Partial capture must not replace the saved questions",
            },
          ];
          result.payload.structuredAssessment.captureCompleteness.questionCoverageComplete = false;
        }
        if (test.mode === "wrong") result.itemId = "another-item";
        response.state = "RUNNING";
      }
      if (body.type === "STATUS")
        response =
          test.mode === "running"
            ? { ok: true, state: "RUNNING", phase: "Waiting for editor" }
            : { ok: true, state: "READY" };
      if (body.type === "RESULT")
        response = { ok: true, result: JSON.stringify(result) };
      if (body.type === "ACK") test.saved++;
      if (body.type === "CANCEL") test.cancelled++;
      window.postMessage(
        { channel: "CTI_EXTENSION_RESPONSE", requestId, response },
        location.origin,
      );
    });
  }, capture);
  // Remount detection after installing the controlled transport.
  const card = page.locator(".action-card").first();
  if ((await card.getAttribute("open")) !== null)
    await card.locator(":scope > summary").click();
  await card.locator(":scope > summary").click();
  const refresh = card.getByRole("region", {
    name: "Refresh Coursera item",
    exact: true,
  });
  await refresh
    .getByText("CTI extension connected.", { exact: true })
    .waitFor()
    .catch(async (e) => {
      console.error(await refresh.innerText());
      throw e;
    });
  const button = refresh.getByRole("button", {
    name: "Refresh this Coursera item",
    exact: true,
  });
  await button.click();
  await refresh
    .getByRole("status")
    .filter({ hasText: /3 question records \(previously 2\)/ })
    .waitFor()
    .catch(async (e) => {
      console.error(await refresh.innerText());
      throw e;
    });
  await card
    .getByRole("region", { name: "Coursera captured content", exact: true })
    .getByText("Newly added question", { exact: true })
    .waitFor();
  assert.equal(
    await card.getByLabel("Item outcome").inputValue(),
    "in_progress",
  );
  for (const mode of ["partial", "wrong", "running"]) {
    await page.evaluate((mode) => (window.ctiRefreshTest.mode = mode), mode);
    await button.click();
    if (mode === "running") {
      await refresh
        .getByRole("status")
        .filter({ hasText: "Waiting for editor" })
        .waitFor();
      await refresh
        .getByRole("button", { name: "Cancel item refresh", exact: true })
        .click();
    }
    await refresh.getByRole("alert").waitFor();
    await page.waitForFunction(() => window.ctiRefreshTest.cancelled > 0);
    await card
      .getByRole("region", { name: "Coursera captured content", exact: true })
      .getByText("Newly added question", { exact: true })
      .waitFor();
    assert.equal(
      await card
        .getByText("Partial capture must not replace the saved questions", {
          exact: true,
        })
        .count(),
      0,
    );
  }
  assert.equal(await page.evaluate(() => window.ctiRefreshTest.saved), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await refresh.scrollIntoViewIfNeeded();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: path.join(shots, "item-refresh-mobile.png") });
}
