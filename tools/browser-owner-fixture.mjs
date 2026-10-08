// Existing owner-workflow suites exercise UI/data behavior with an explicit owner
// fixture. Cryptographic authentication and colleague denial are tested separately
// in site-access.test.mjs and browser-site-access-check.mjs.
export async function ownerAccessFixture(context) {
  await context.route("**/api/access", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ fullCti: true }),
      headers: { "Cache-Control": "no-store" },
    }),
  );
}
