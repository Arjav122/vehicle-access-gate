// Sign-in, tokens and passwords (brief §10.7).
// - Passwords: argon2id. Unknown emails are still checked against a dummy hash, so the
//   response time does not reveal which emails exist; every failure gives the same error.
// - Access token: JWT, 15 min, HS256 pinned, required claims sub/type/jti/exp.
// - Refresh token: JWT, 7 days, its jti stored in refresh_tokens. Single use: each refresh
//   revokes the old one and issues a new pair. Presenting a revoked token again means it was
//   stolen or replayed, so every session of that user is revoked.
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { errors as joseErrors, jwtVerify, SignJWT } from "jose";
import { config } from "../config.js";
import { prisma, withTx } from "../db.js";

const ISSUER = "vehicle-access";
const AUDIENCE = "vehicle-access-api";
const key = new TextEncoder().encode(config.JWT_SECRET);

export class AuthError extends Error {}

export const INVALID_LOGIN = "Incorrect email or password";

// ---------- Passwords ----------

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

let dummyHash: Promise<string> | undefined;

/** Returns the user id, or throws AuthError with the same message for every kind of failure. */
export async function checkCredentials(email: string, password: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, passwordHash: true, isActive: true },
  });
  dummyHash ??= hashPassword(randomUUID());
  const hash = user?.passwordHash ?? (await dummyHash);
  const ok = await argon2.verify(hash, password).catch(() => false);
  if (!user || !ok || !user.isActive) throw new AuthError(INVALID_LOGIN);
  return user.id;
}

// ---------- Tokens ----------

type TokenType = "access" | "refresh";

async function sign(
  userId: string,
  type: TokenType,
  jti: string,
  expiresAt: Date,
): Promise<string> {
  return new SignJWT({ type })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(jti)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key);
}

async function verify(
  token: string,
  type: TokenType,
): Promise<{ sub: string; jti: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ["sub", "jti", "exp", "type"],
    });
    if (payload.type !== type || !payload.sub || !payload.jti) return null;
    return { sub: payload.sub, jti: payload.jti };
  } catch (err) {
    if (err instanceof joseErrors.JOSEError) return null;
    throw err;
  }
}

/** The user id inside a valid access token, or null. */
export async function verifyAccessToken(token: string): Promise<string | null> {
  return (await verify(token, "access"))?.sub ?? null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

/** Issue a new access + refresh pair and remember the refresh token's jti. */
export async function issueTokens(userId: string, now = new Date()): Promise<TokenPair> {
  const accessExpires = new Date(now.getTime() + config.ACCESS_TOKEN_MINUTES * 60_000);
  const refreshExpires = new Date(now.getTime() + config.REFRESH_TOKEN_DAYS * 86_400_000);
  const refreshJti = randomUUID();

  await prisma.refreshToken.create({
    data: { jti: refreshJti, userId, expiresAt: refreshExpires },
  });

  return {
    accessToken: await sign(userId, "access", randomUUID(), accessExpires),
    refreshToken: await sign(userId, "refresh", refreshJti, refreshExpires),
    tokenType: "Bearer",
    expiresIn: config.ACCESS_TOKEN_MINUTES * 60,
  };
}

/** Swap a refresh token for a new pair (single use, with reuse detection). */
export async function rotateRefreshToken(refreshToken: string): Promise<TokenPair> {
  const claims = await verify(refreshToken, "refresh");
  if (!claims) throw new AuthError("Session expired. Sign in again.");

  const userId = await withTx(async (tx) => {
    // Lock the row so two refreshes of the same token cannot both succeed.
    const rows = await tx.$queryRaw<{ user_id: string; revoked_at: Date | null }[]>`
      SELECT user_id, revoked_at FROM refresh_tokens WHERE jti = ${claims.jti} FOR UPDATE`;
    const row = rows[0];
    if (!row) return null;

    if (row.revoked_at) {
      // A used token came back: assume theft and sign this user out everywhere.
      await tx.refreshToken.updateMany({
        where: { userId: row.user_id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { reused: true as const, userId: row.user_id };
    }

    await tx.refreshToken.update({ where: { jti: claims.jti }, data: { revokedAt: new Date() } });
    const user = await tx.user.findUnique({
      where: { id: row.user_id },
      select: { isActive: true },
    });
    return user?.isActive ? { reused: false as const, userId: row.user_id } : null;
  });

  if (!userId) throw new AuthError("Session expired. Sign in again.");
  if (userId.reused)
    throw new AuthError("This session was already used. All sessions were signed out for safety.");
  return issueTokens(userId.userId);
}

/** Revoke one refresh token (logout). Unknown or invalid tokens are ignored. */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const claims = await verify(refreshToken, "refresh");
  if (!claims) return;
  await prisma.refreshToken.updateMany({
    where: { jti: claims.jti, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Sign a user out everywhere (used when an admin deactivates someone). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
