import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessEnvironment {
  CTI_ACCESS_ISSUER?: string;
  CTI_ACCESS_AUD?: string;
}
export interface AccessIdentity {
  email: string;
}
export const CTI_OWNER_EMAIL = "aarjun@coursera.org";
export const isCtiOwner = (identity: AccessIdentity) =>
  identity.email.toLowerCase().trim() === CTI_OWNER_EMAIL;
export const accessError = (message: string, status: number) =>
  Object.assign(new Error(message), { status });

const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function remoteKeys(issuer: string) {
  let jwks = keys.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs"));
    keys.set(issuer, jwks);
  }
  return jwks;
}
// The injectable key resolver is for cryptographic tests, never request input.
export function createAccessAuthenticator(resolveKeys = remoteKeys) {
  return async (
    request: Request,
    env: AccessEnvironment,
  ): Promise<AccessIdentity> => {
    const issuer = env.CTI_ACCESS_ISSUER?.replace(/\/$/, "");
    if (
      !issuer ||
      !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
      !env.CTI_ACCESS_AUD?.trim()
    )
      throw accessError(
        "Workspace sign-in is not configured. Contact the CTI owner.",
        503,
      );
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token)
      throw accessError("Sign in through the configured team site.", 401);
    try {
      const { payload } = await jwtVerify(token, resolveKeys(issuer), {
        issuer,
        audience: env.CTI_ACCESS_AUD,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "email", "exp", "iat"],
      });
      if (
        typeof payload.email !== "string" ||
        !payload.email.trim() ||
        typeof payload.sub !== "string" ||
        !payload.sub.trim()
      )
        throw Error("No user identity");
      return { email: payload.email.toLowerCase().trim() };
    } catch {
      throw accessError("Your sign-in token is invalid or expired.", 401);
    }
  };
}
export const authenticateAccess = createAccessAuthenticator();
export type AccessAuthenticator = typeof authenticateAccess;

export function requireCtiOwner(identity: AccessIdentity) {
  if (!isCtiOwner(identity))
    throw accessError(
      "This CTI workspace is restricted to its owner. Role Play & Dialogue remains available from the gateway.",
      403,
    );
}
