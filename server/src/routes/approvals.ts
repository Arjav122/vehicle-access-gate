// Approvals: residents approve or deny visitors for their flat (staff can read them).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ApprovalStatus } from "../../generated/prisma/enums.js";
import { currentUser, HttpError } from "../middleware.js";
import { defineRoute, IdParams, pageOf, PageQuery, roles } from "../openapi.js";
import { publish } from "../realtime.js";
import { ApprovalError, residentDecides } from "../services/approvals.js";
import { flatIdsOf } from "../services/visits.js";
import { loadVisit, toVisit, Visit, visitInclude } from "./visits.js";

export const approvalsRouter = Router();

defineRoute(
  approvalsRouter,
  {
    method: "get",
    path: "/approvals",
    tag: "Approvals",
    summary: "Visits waiting for (or given) an answer; residents see their own flats",
    access: roles("admin", "guard", "resident"),
    query: PageQuery.extend({ status: z.enum(ApprovalStatus).optional() }),
    responses: { 200: { description: "Visits with their approval", schema: pageOf(Visit) } },
  },
  async ({ query, res }) => {
    const user = currentUser(res);
    const where: Prisma.VisitWhereInput = {
      approval: query.status ? { status: query.status } : { isNot: null },
      ...(user.role === "resident" ? { flatId: { in: await flatIdsOf(prisma, user.id) } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.visit.findMany({
        where,
        include: visitInclude,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.visit.count({ where }),
    ]);
    res.json({
      items: rows.map((v) => toVisit(v, { maskPhones: true })),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  },
);

defineRoute(
  approvalsRouter,
  {
    method: "post",
    path: "/approvals/:id/decision",
    tag: "Approvals",
    summary: "Resident approves or denies a visitor",
    description:
      "The same answer twice is fine (200); a different answer after the first is 409. After the timeout: 409, the guard decides.",
    access: roles("resident"),
    params: IdParams,
    body: z.strictObject({ decision: z.enum(["approve", "deny"]) }),
    responses: {
      200: { description: "Decided", schema: Visit },
      404: { description: "Not found (or not your flat)" },
      409: { description: "Already answered differently, or too late" },
    },
  },
  async ({ params, body, res }) => {
    let result;
    try {
      result = await residentDecides(params.id, currentUser(res).id, body.decision);
    } catch (err) {
      if (err instanceof ApprovalError) throw new HttpError(err.status, err.message);
      throw err;
    }
    const out = await loadVisit(result.visit.id);
    if (result.timedOut) {
      if (result.changed)
        await publish("approval.timed_out", out, { staff: true, flatId: out.flatId });
      throw new HttpError(409, "Too late: the time to answer is over, the guard decides now");
    }
    if (result.changed) {
      await publish("approval.decided", out, { staff: true, flatId: out.flatId });
      await publish("visit.updated", out, { staff: true, flatId: out.flatId });
    }
    res.json(out);
  },
);
