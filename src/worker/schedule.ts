import type { WebClient } from "@slack/web-api";
import type { Logger } from "pino";
import { dailyDue, postCompletions, runDaily, teamTimezone } from "../core/daily.js";
import type { Db } from "../lib/db.js";

type Deps = { db: Db; web: WebClient; log: Logger };

// The approver's timezone changes rarely; look it up at most hourly per team.
const tzCache = new Map<string, { tz: string; at: number }>();

export async function scheduleTick({ db, web, log }: Deps) {
  const installs = await db.install.findMany({ where: { setupStage: "COMPLETE", channelId: { not: null } } });
  for (const install of installs) {
    await postCompletions(db, web, log, install.teamId);

    let cached = tzCache.get(install.teamId);
    if (!cached || Date.now() - cached.at > 3_600_000) {
      cached = { tz: await teamTimezone(db, web, install.teamId), at: Date.now() };
      tzCache.set(install.teamId, cached);
    }
    if (dailyDue(install.lastNudgeAt, new Date(), cached.tz)) await runDaily(db, web, log, install.teamId);
  }
}
