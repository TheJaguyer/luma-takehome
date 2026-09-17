import type { Db } from "../lib/db.js";
import type { Prisma } from "../generated/prisma/client.js";

type Tx = Db | Prisma.TransactionClient;

/** The approver role (#1): an "or", never an "and" — any active approver decides. */
export async function isApprover(db: Tx, teamId: string, userId: string) {
  const row = await db.approver.findFirst({ where: { teamId, userId, removedAt: null } });
  return row !== null;
}

export async function activeApprovers(db: Tx, teamId: string) {
  return db.approver.findMany({ where: { teamId, removedAt: null }, orderBy: { addedAt: "asc" } });
}

/** The event log (Flow 4, #1, #16), written beside the state change it describes. */
export function recordEvent(
  db: Tx,
  event: { teamId: string; actor: string; type: string; productId?: string; dropId?: string; data?: Prisma.InputJsonValue },
) {
  return db.event.create({ data: event });
}
