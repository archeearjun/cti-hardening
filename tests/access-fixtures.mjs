import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { createAccessAuthenticator } from "../server/access.ts";

export async function accessFixture() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: "fixture", alg: "RS256" });
  const env = {
    CTI_ACCESS_ISSUER: "https://cti-test.cloudflareaccess.com",
    CTI_ACCESS_AUD: "cti-fixture-audience",
  };
  const authenticate = createAccessAuthenticator(() =>
    createLocalJWKSet({ keys: [jwk] }),
  );
  async function token(email, claims = {}, key = privateKey) {
    return new SignJWT({
      email,
      sub: "person",
      iss: env.CTI_ACCESS_ISSUER,
      aud: env.CTI_ACCESS_AUD,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .sign(key);
  }
  function request(path, jwt, options = {}) {
    return new Request("https://cti.example.test" + path, {
      ...options,
      headers: {
        ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}),
        ...options.headers,
      },
    });
  }
  return { env, authenticate, token, request };
}
