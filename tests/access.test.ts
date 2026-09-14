import { beforeAll, expect, it } from "vitest";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import { authorized } from "../src/access";
import type { Config } from "../src/repository";
const env: Config = {
  REPOSITORY_MODE: "github",
  GITHUB_OWNER: "o",
  GITHUB_REPO: "r",
  GITHUB_BRANCH: "main",
  ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
  ACCESS_AUD: "app-aud",
};
let privateKey: CryptoKey, keys: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test" }],
  });
});
async function token(aud = "app-aud", expiry: number | string = "1h") {
  return new SignJWT({ email: "editor@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer("https://example.cloudflareaccess.com")
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(privateKey);
}
it("verifies Access assertion and WebSocket cookie with the same signature and audience checks", async () => {
  const jwt = await token();
  expect(
    await authorized(
      new Request("https://cms.test", {
        headers: { "Cf-Access-Jwt-Assertion": jwt },
      }),
      env,
      keys,
    ),
  ).toBe(true);
  expect(
    await authorized(
      new Request("https://cms.test", {
        headers: { Cookie: `other=x; CF_Authorization=${jwt}` },
      }),
      env,
      keys,
    ),
  ).toBe(true);
});
it("fails closed for missing configuration, forged, expired or wrong-audience tokens", async () => {
  for (const jwt of ["forged", await token("other"), await token("app-aud", 1)])
    expect(
      await authorized(
        new Request("https://cms.test", {
          headers: { "Cf-Access-Jwt-Assertion": jwt },
        }),
        env,
        keys,
      ),
    ).toBe(false);
  expect(await authorized(new Request("https://cms.test"), env, keys)).toBe(
    false,
  );
  expect(
    await authorized(
      new Request("https://cms.test"),
      { ...env, ACCESS_AUD: undefined },
      keys,
    ),
  ).toBe(false);
});
it("only fixture mode bypasses authentication", async () => {
  expect(
    await authorized(new Request("https://cms.test"), {
      ...env,
      REPOSITORY_MODE: "fixture",
    }),
  ).toBe(true);
  expect(
    await authorized(new Request("https://cms.test"), {
      ...env,
      REPOSITORY_MODE: "invalid",
    }),
  ).toBe(false);
});
