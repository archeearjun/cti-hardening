// Exercise the visible disclosure control before navigating to a secondary
// workspace tool. Do not set `open` programmatically: the owner uses the summary.
export async function clickDisclosedControl(control) {
  await control.waitFor({ state: "attached" });
  for (let depth = 0; depth < 10 && !(await control.isVisible()); depth++) {
    const closed = control.locator(
      "xpath=ancestor::details[not(@open)][last()]",
    );
    if (!(await closed.count())) break;
    await closed.locator(":scope > summary").click();
  }
  await control.click();
}

export async function workspaceNav(page, name) {
  await clickDisclosedControl(
    page
      .getByRole("navigation", { name: "CTI workflows" })
      .locator("button")
      .filter({ hasText: exactControlText(name) }),
  );
}

// Native closed <details> excludes descendants from accessible-name lookup,
// even when hidden roles are requested. Locate the literal button text first,
// then exercise the visible summary before clicking it. Nav glyphs precede it.
function exactControlText(name) {
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$");
}

export async function ownerTool(page, name) {
  await clickDisclosedControl(
    page.locator("button").filter({ hasText: exactControlText(name) }),
  );
}
