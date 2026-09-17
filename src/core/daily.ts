// Flow 4, Steps 6 and 8: what posts without being asked.
//   Completion  checked continuously — "Q4 Drop is done — 37 of 37 · $6.41" posts once, when true
//   Daily       at 9am in the approver's Slack timezone: each open drop's report, then one nudge
//               listing everything past its threshold. Silence when there is nothing to say: a
//               drop that hasn't changed in days goes quiet, and no nudge is better than "all clear".
import type { WebClient } from "@slack/web-api";
import type { Logger } from "pino";
import type { Db } from "../lib/db.js";
import { usd } from "./ideaCards.js";
import { dropBlocks, stuckListBlocks, type LinkResolver } from "./statusBlocks.js";
import { dropComplete, dropProducts, dropProgress, loadStatus, stuckItems } from "./status.js";
import { activeApprovers, recordEvent } from "./team.js";

const DAILY_HOUR = 9;
const DEFAULT_TZ = "America/Los_Angeles";

export function permalinkResolver(web: WebClient): LinkResolver {
  const cache = new Map<string, string | null>();
  return async (link) => {
    if (!link) return null;
    const key = `${link.channel}:${link.ts}`;
    if (!cache.has(key)) {
      const res = await web.chat.getPermalink({ channel: link.channel, message_ts: link.ts }).catch(() => null);
      cache.set(key, res?.permalink ?? null);
    }
    return cache.get(key)!;
  };
}

export async function teamTimezone(db: Db, web: WebClient, teamId: string) {
  const [approver] = await activeApprovers(db, teamId);
  if (!approver) return DEFAULT_TZ;
  const { user } = await web.users.info({ user: approver.userId }).catch(() => ({ user: undefined }));
  return user?.tz ?? DEFAULT_TZ;
}

export function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/** Due when it is past 9am locally and the daily run hasn't happened on this local date yet. */
export function dailyDue(lastRun: Date | null, now: Date, timeZone: string) {
  const today = localParts(now, timeZone);
  if (today.hour < DAILY_HOUR) return false;
  return !lastRun || localParts(lastRun, timeZone).day !== today.day;
}

export async function postCompletions(db: Db, web: WebClient, log: Logger, teamId: string) {
  const install = await db.install.findUnique({ where: { teamId } });
  if (!install?.channelId) return;
  const status = await loadStatus(db, teamId);
  for (const drop of status.drops.filter((d) => d.state === "OPEN" && dropComplete(status, d.id))) {
    const claimed = await db.drop.updateMany({ where: { id: drop.id, state: "OPEN" }, data: { state: "COMPLETE", completedAt: new Date() } });
    if (claimed.count === 0) continue;
    const products = dropProducts(status, drop.id);
    const done = dropProgress(status, drop.id).filter((p) => p.stage === "done").length;
    const spend = products.reduce((s, p) => s + p.spend.total, 0);
    // The message Maya actually wants at the end of a launch.
    await web.chat.postMessage({
      channel: install.channelId,
      text: `${drop.name} is done — ${done} of ${products.length} · ${usd(spend)}`,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `✅  *${drop.name} is done* — ${done} of ${products.length} products with approved images · ${usd(spend)}${done < products.length ? `\n${products.length - done} skipped.` : ""}` } }],
    });
    await recordEvent(db, { teamId, actor: "system", type: "drop.completed", dropId: drop.id, data: { done, products: products.length, spendUsd: spend } });
    log.info({ drop: drop.id, done }, "drop completed");
  }
}

export async function runDaily(db: Db, web: WebClient, log: Logger, teamId: string, now = new Date()) {
  const install = await db.install.findUniqueOrThrow({ where: { teamId } });
  if (!install.channelId) return { reports: 0, nudged: 0 };
  // Claim today's run first, so a restart or a manual /shots daily can't post it twice.
  await db.install.update({ where: { teamId }, data: { lastNudgeAt: now } });

  const status = await loadStatus(db, teamId);
  const resolve = permalinkResolver(web);
  const quietAfterMs = status.thresholds.stuckAfterMs;
  let reports = 0;

  for (const drop of status.drops.filter((d) => ["OPEN", "DRAFTING", "AWAITING_THEME"].includes(d.state))) {
    const products = dropProducts(status, drop.id);
    const last = await db.event.findFirst({
      where: { teamId, OR: [{ dropId: drop.id }, { productId: { in: products.map((p) => p.id) } }] },
      orderBy: { at: "desc" },
      select: { at: true },
    });
    // Nothing has changed for a while: a daily post repeating the same number is noise, and the
    // nudge below names what is actually stuck.
    if (last && now.getTime() - last.at.getTime() > quietAfterMs) continue;
    const day = Math.floor((now.getTime() - drop.importedAt.getTime()) / 86_400_000) + 1;
    await web.chat.postMessage({
      channel: install.channelId,
      text: `${drop.name} · day ${day}`,
      blocks: dropBlocks(status, drop.id, { title: `${drop.name} · day ${day}`, now }),
    });
    await db.drop.update({ where: { id: drop.id }, data: { lastDailyPostAt: now } });
    reports++;
  }

  // Nudges name products, never people (decision 4.2).
  const stuck = stuckItems(status, status.products, status.drops, now);
  if (stuck.length) {
    const heading = `⏰  *${stuck.length === 1 ? "One thing has" : `${stuck.length} things have`} been waiting a while*`;
    await web.chat.postMessage({
      channel: install.channelId,
      text: heading.replace(/[*⏰]/g, "").trim(),
      blocks: await stuckListBlocks(stuck, resolve, heading, now),
      unfurl_links: false,
    });
  }
  await recordEvent(db, { teamId, actor: "system", type: "daily.posted", data: { reports, stuck: stuck.length } });
  log.info({ teamId, reports, stuck: stuck.length }, "daily run");
  return { reports, nudged: stuck.length };
}
