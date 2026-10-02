export type CapabilityState =
  | "AVAILABLE"
  | "OPTIONAL_CONFIGURATION"
  | "RETIRED"
  | "REFERENCE_ONLY";

export interface ProductCapability {
  id: string;
  label: string;
  state: CapabilityState;
  detail: string;
}

export const CURRENT_PRODUCT_CAPABILITIES: readonly ProductCapability[] =
  Object.freeze([
    {
      id: "coursera.local",
      label: "Coursera extraction · local Chrome",
      state: "AVAILABLE",
      detail:
        "Primary zero-cost path. Runs the maintained extractor in the operator's signed-in Coursera tab and validates the returned capture in CTI.",
    },
    {
      id: "coursera.remote",
      label: "Coursera extraction · Cloudflare Browser Run",
      state: "OPTIONAL_CONFIGURATION",
      detail:
        "Optional remote path only. Cloudflare Browser Run Free cannot support the extractor's long-run workload; CTI does not require it for normal extraction.",
    },
    {
      id: "source.scan",
      label: "IMSCC / ZIP / XML source scanning",
      state: "AVAILABLE",
      detail:
        "Browser-local bounded source scan with manifest, QTI, PDF and runtime diagnostics.",
    },
    {
      id: "qa.compare",
      label: "Source → Coursera evidence comparison",
      state: "AVAILABLE",
      detail:
        "Uses the Coursera XLSX as structural authority and capture JSON as observed-content evidence.",
    },
    {
      id: "workspace.shared",
      label: "Shared team workspace",
      state: "OPTIONAL_CONFIGURATION",
      detail:
        "Requires the configured Cloudflare Access + D1 service. Local browser workspace remains available without it.",
    },
    {
      id: "operations.portable",
      label: "Planner / catalog / runtime operations",
      state: "AVAILABLE",
      detail:
        "Portable XLSX inputs replace hard-coded legacy Google Sheet IDs; state, duplicate and lineage workflows are versioned in the workspace.",
    },
    {
      id: "legacy.apps-script",
      label: "Apps Script runtime",
      state: "REFERENCE_ONLY",
      detail:
        "Frozen migration evidence only. Active product workflows run from TypeScript/Cloudflare/browser modules.",
    },
    {
      id: "legacy.visit-telemetry",
      label: "Legacy visit counter",
      state: "RETIRED",
      detail:
        "Retired because it collected usage telemetry without contributing to evidence integrity or business rules.",
    },
    {
      id: "legacy.gemini-triage",
      label: "Legacy Gemini advisory triage",
      state: "RETIRED",
      detail:
        "Not required for evidence decisions and conflicts with the zero-cost deployment constraint. Deterministic architecture diagnostics remain available.",
    },
  ]);

export function capabilitySummary() {
  return {
    generatedAt: new Date().toISOString(),
    capabilities: CURRENT_PRODUCT_CAPABILITIES,
    note:
      "Capability state describes current product availability. It is separate from the historical engine feature manifest retained for migration parity.",
  };
}
