// Who decided something, in words rather than in mentions.
//
// Two rules, both about noise in a channel these messages live in:
//   * **Never `<@U…>` in a message that re-renders.** One product = one message (Flow 3, Step 1),
//     so a product's message is edited at every stage; a mention in it pings the person on every
//     edit. Names are read the same and ping nobody.
//   * **Only name the exception.** The approver approving is the expected case and says nothing
//     (#1). Anyone else deciding — a force-approve, a second approver, someone covering while
//     Ellie is away — is exactly what the record exists for, so that is what gets a name.
import type { WebClient } from "@slack/web-api";
import type { Db } from "../lib/db.js";
import { activeApprovers } from "./team.js";

const names = new Map<string, string>();

/** A Slack display name, cached for the process: these are read far more often than they change. */
export async function displayName(web: WebClient, userId: string): Promise<string> {
  const cached = names.get(userId);
  if (cached) return cached;
  const { user } = await web.users.info({ user: userId }).catch(() => ({ user: undefined }));
  const name = user?.profile?.display_name || user?.real_name || user?.name || "someone";
  names.set(userId, name);
  return name;
}

/**
 * The decider's name, or null when there is nothing worth saying — nobody decided, or the primary
 * approver did, which is what everyone already expects.
 */
export async function deciderLabel(db: Db, web: WebClient, teamId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [primary] = await activeApprovers(db, teamId);
  if (primary?.userId === userId) return null;
  return displayName(web, userId);
}
