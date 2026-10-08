# Site access

Only the verified Cloudflare Access user `aarjun@coursera.org` can open the full
CTI workspace. Other users already permitted by the site's Access policy can
open Role Play & Dialogue. This release does not broaden that policy.

## Enforcement

- `functions/_middleware.ts` and `public/_routes.json` cover every route,
  including static files. A colleague's root request serves a separate static
  activity gateway; it does not load the owner application bundle.
- Shared activity paths use an explicit file allowlist. Other pages, owner
  assets, package runners and extractor downloads return 403 to colleagues.
- `/api/access` returns only the verified user's full-workspace permission.
  Every other API route requires the owner before touching D1 or the extractor
  service. Existing write-role checks still apply after that boundary.
- Identity comes from the signed Cloudflare JWT with verified issuer, audience,
  RS256 signature, expiry, subject and email. An email header, URL parameter,
  client setting or existing administrator-list membership cannot grant access.
- Identity-dependent responses are private/no-store. The React fallback also
  checks permission before loading the owner workspace and rechecks on returning
  to a tab and every minute. Missing or invalid identity/configuration fails closed.

## Deployment and development

Production must set `CTI_ACCESS_ISSUER` and `CTI_ACCESS_AUD` to its existing
Cloudflare Access application's team issuer and audience. Preview deployments
need their own matching verifier configuration and Access protection. The CI
preflight reads Pages configuration using existing deployment credentials and
blocks production forwarding if verifier configuration is absent. It never logs
configuration values or modifies Access policies. D1, existing administrator and
editor lists, and the extractor binding continue to govern shared services.

The browser-only Vite server cannot independently verify Cloudflare identity, so
it shows the activity fallback. UI-focused owner browser suites explicitly supply
an owner `/api/access` fixture; this is test-server configuration and is never
included in the deployed application. Use the deployed authenticated site for
real owner work. No data migration or reimport is required.

## Verification

`node --test tests/site-access.test.mjs` exercises actual RS256 signatures and
wrong/missing/expired identities; API denial before storage or worker access;
direct private paths; shared asset allowlisting; and missing configuration.
`node tools/browser-site-access-check.mjs` serves the built site through the real
middleware/API handlers with synthetic signed identities. It verifies colleague
and owner navigation, mobile layout, no private colleague bundle requests,
direct-link/API denial, and removing the owner UI after an identity change.
These checks do not replace a signed-in production account walkthrough.

## Scope and limits

This restricts the current deployed website and its APIs. It does not change
GitHub repository visibility, revoke copies already downloaded, erase browser
data, or retrofit historical Pages deployment URLs. Repository and hosting
administrators retain their infrastructure permissions. Old deployment URLs
must remain protected by Cloudflare Access; removing an obsolete deployment is
a separate hosting action. Restricting the interface does not turn browser-local
storage into account-encrypted storage, so separate people should use separate
browser profiles on a shared computer.
