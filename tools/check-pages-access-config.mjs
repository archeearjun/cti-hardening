// Read only deployment preflight. Never prints tokens, environment values or
// the full Pages configuration. This does not alter Access policies or bindings.
const token = process.env.CLOUDFLARE_API_TOKEN,
  account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account)
  throw Error(
    "Cloudflare deployment credentials are required to verify the owner-access configuration.",
  );
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/pages/projects/cti-hardening`,
  {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  },
);
if (!response.ok)
  throw Error(
    `Cannot verify Pages access configuration (HTTP ${response.status}).`,
  );
const body = await response.json();
if (!body.success) throw Error("Cloudflare rejected the configuration check.");
const configured = (config) => {
  const vars = config?.env_vars || {};
  const issuer = vars.CTI_ACCESS_ISSUER;
  const audience = vars.CTI_ACCESS_AUD;
  return (
    !!issuer &&
    !!audience &&
    (issuer.type === "secret_text" ||
      /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\/?$/.test(
        issuer.value || "",
      )) &&
    (audience.type === "secret_text" || !!audience.value?.trim())
  );
};
if (!configured(body.result?.deployment_configs?.production))
  throw Error(
    "Production CTI_ACCESS_ISSUER / CTI_ACCESS_AUD is missing or invalid. Configure the existing production Access application's issuer and audience before release.",
  );
console.log(
  "Production Access verifier configuration is present. No settings changed.",
);
console.log(
  configured(body.result?.deployment_configs?.preview)
    ? "Preview Access verifier configuration is present."
    : "Preview Access verifier configuration is absent; preview requests will fail closed until their own Access issuer/audience is configured.",
);
