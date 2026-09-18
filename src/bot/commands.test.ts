import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { HELP } from "./commands.js";

const root = new URL("../../", import.meta.url);
const source = readFileSync(new URL("src/bot/commands.ts", root), "utf8");
const manifest = readFileSync(new URL("slack/manifest.yaml", root), "utf8");

/** Every verb the router actually handles. */
const routed = [...source.matchAll(/^ {6}case "([a-z]+)":/gm)].map((m) => m[1]!);
/** Every verb offered in Slack's typeahead, minus the `/shots HG-002` product form. */
const hinted = /usage_hint: "([^"]+)"/
  .exec(manifest)![1]!
  .split("|")
  .map((s) => s.trim().split(" ")[0]!)
  .filter((s) => !/^[A-Z]/.test(s));

test("the manifest suggests exactly the commands that exist", () => {
  assert.deepEqual([...hinted].sort(), [...routed].sort());
});

test("`/shots help` lists every command, in the order the typeahead suggests them", () => {
  // Deduped: the status line names two of its own forms, which is not two commands.
  const listed = [...new Set([...HELP.matchAll(/`\/shots ([a-z]+)/g)].map((m) => m[1]!))];
  // help does not need to advertise itself; everything else must be findable from inside Slack.
  assert.deepEqual(listed, hinted.filter((v) => v !== "help"));
});
