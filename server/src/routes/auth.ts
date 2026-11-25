// Sign in, refresh, sign out, and "who am I".
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { Role } from "../../generated/prisma/enums.js";
import { currentUser, HttpError } from "../middleware.js";
import { defineRoute, PUBLIC, roles } from "../openapi.js";
import {
  AuthError,
  checkCredentials,
  issueTokens,
  revokeRefreshToken,
  rotateRefreshToken,
} from "../services/auth.js";
import { flatLabel } from "./flats.js";

export const authRouter = Router();

const TokenPair = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    tokenType: z.literal("Bearer"),
    expiresIn: z.number().int().describe("Access token lifetime in seconds"),
  })
  .meta({ id: "TokenPair" });

const Me = z
  .object({
    id: z.uuid(),
    email: z.string(),
    fullName: z.string(),
    phone: z.string().nullable(),
    role: z.enum(Role),
    flats: z
      .array(
        z.object({
          id: z.uuid(),
          label: z.string(),
          residentType: z.string(),
          isPrimaryContact: z.boolean(),
        }),
      )
      .describe("Residents only: the flats this person belongs to"),
  })
  .meta({ id: "Me" });

const RefreshBody = z.strictObject({ refreshToken: z.string().min(1) });

function asHttp(err: unknown): never {
  if (err instanceof AuthError) throw new HttpError(401, err.message);
  throw err;
}

defineRoute(
  authRouter,
  {
    method: "post",
    path: "/auth/login",
    tag: "Auth",
    summary: "Sign in with email and password",
    description: "Rate limited per IP and per account (429 with Retry-After).",
    access: PUBLIC,
    body: z.strictObject({ email: z.email().max(254), password: z.string().min(1).max(200) }),
    responses: {
      200: { description: "Signed in", schema: TokenPair },
      401: { description: "Incorrect email or password" },
      429: { description: "Too many attempts" },
    },
  },
  async ({ body, res }) => {
    const userId = await checkCredentials(body.email, body.password).catch(asHttp);
    res.json(await issueTokens(userId));
  },
);

defineRoute(
  authRouter,
  {
    method: "post",
    path: "/auth/refresh",
    tag: "Auth",
    summary: "Swap a refresh token for a new token pair",
    description: "Each refresh token works once. Reusing one signs the user out everywhere.",
    access: PUBLIC,
    body: RefreshBody,
    responses: {
      200: { description: "New tokens", schema: TokenPair },
      401: { description: "Invalid, expired or reused token" },
    },
  },
  async ({ body, res }) => {
    res.json(await rotateRefreshToken(body.refreshToken).catch(asHttp));
  },
);

defineRoute(
  authRouter,
  {
    method: "post",
    path: "/auth/logout",
    tag: "Auth",
    summary: "Sign out (revoke this refresh token)",
    access: PUBLIC,
    body: RefreshBody,
    responses: { 204: { description: "Signed out" } },
  },
  async ({ body, res }) => {
    await revokeRefreshToken(body.refreshToken);
    res.status(204).end();
  },
);

defineRoute(
  authRouter,
  {
    method: "get",
    path: "/me",
    tag: "Auth",
    summary: "The signed-in user (residents also get their flats)",
    access: roles("admin", "guard", "resident"),
    responses: { 200: { description: "Current user", schema: Me } },
  },
  async ({ res }) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: currentUser(res).id },
      include: { residents: { include: { flat: true }, orderBy: { createdAt: "asc" } } },
    });
    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      flats: user.residents.map((r) => ({
        id: r.flat.id,
        label: flatLabel(r.flat),
        residentType: r.residentType,
        isPrimaryContact: r.isPrimaryContact,
      })),
    });
  },
);
