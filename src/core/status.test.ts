import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyDue, localParts } from "./daily.js";
import { age, isStuck } from "./status.js";

const LA = "America/Los_Angeles";

test("the daily run is due once per local day, from 9am in the approver's timezone", () => {
  const at = (iso: string) => new Date(iso);
  // 08:30 in LA (15:30 UTC, PDT) — not yet.
  assert.equal(dailyDue(null, at("2026-09-16T15:30:00Z"), LA), false);
  // 09:05 in LA — due, never run.
  assert.equal(dailyDue(null, at("2026-09-16T16:05:00Z"), LA), true);
  // Already ran at 09:01 LA today — not again this afternoon.
  assert.equal(dailyDue(at("2026-09-16T16:01:00Z"), at("2026-09-16T23:00:00Z"), LA), false);
  // Ran yesterday at 09:00 LA; it's 01:00 UTC today but still yesterday evening in LA — not due.
  assert.equal(dailyDue(at("2026-09-16T16:00:00Z"), at("2026-09-17T01:00:00Z"), LA), false);
  // Next local morning — due.
  assert.equal(dailyDue(at("2026-09-16T16:00:00Z"), at("2026-09-17T16:10:00Z"), LA), true);
  assert.deepEqual(localParts(at("2026-09-17T01:00:00Z"), LA), { day: "2026-09-16", hour: 18 });
});

test("stuck means past the team's threshold; the system gets 30 minutes, people get days", () => {
  const t = { stuckAfterMs: 3 * 86_400_000, systemStuckAfterMs: 30 * 60_000 };
  const now = new Date("2026-09-20T12:00:00Z");
  const waiting = (on: "approver" | "system" | "nobody", hoursAgo: number) => ({ on, what: "x", since: new Date(now.getTime() - hoursAgo * 3_600_000), link: null });
  assert.equal(isStuck(null, t, now), false);
  assert.equal(isStuck(waiting("approver", 48), t, now), false);
  assert.equal(isStuck(waiting("nobody", 73), t, now), true);
  assert.equal(isStuck(waiting("system", 1), t, now), true);
  assert.equal(age(new Date(now.getTime() - 5 * 86_400_000), now), "5 days");
  assert.equal(age(new Date(now.getTime() - 90 * 60_000), now), "1 hour");
});
