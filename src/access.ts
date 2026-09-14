import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Config } from "./repository";
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function authorized(
  request: Request,
  env: Config,
  testKeys?: JWTVerifyGetKey,
) {
  if (env.REPOSITORY_MODE === "fixture") return true;
  const domain = env.ACCESS_TEAM_DOMAIN;
  if (
    !domain ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) ||
    !env.ACCESS_AUD
  )
    return false;
  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    request.headers
      .get("Cookie")
      ?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  if (!token) return false;
  const keys =
    keySets.get(domain) ??
    createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`));
  keySets.set(domain, keys);
  try {
    await jwtVerify(token, testKeys ?? keys, {
      issuer: `https://${domain}`,
      audience: env.ACCESS_AUD,
    });
    return true;
  } catch {
    return false;
  }
}
