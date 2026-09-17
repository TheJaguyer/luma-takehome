import { LogLevel, WebClient, type Logger as SlackLogger } from "@slack/web-api";
import type { Logger } from "pino";

export function createSlack(token: string, log: Logger) {
  return new WebClient(token, { logger: toSlackLogger(log.child({ component: "slack" })) });
}

/**
 * Routes the Slack client's own logging into our JSON logs. Its errors are demoted to warn:
 * every failed call also throws, and the caller decides whether that is an error (for example,
 * the expected invalid_blocks while an upload is still processing).
 */
function toSlackLogger(log: Logger): SlackLogger {
  const text = (msg: unknown[]) => msg.map(String).join(" ");
  return {
    debug: (...msg) => log.debug(text(msg)),
    info: (...msg) => log.info(text(msg)),
    warn: (...msg) => log.warn(text(msg)),
    error: (...msg) => log.warn(text(msg)),
    setLevel: () => {},
    getLevel: () => LogLevel.INFO,
    setName: () => {},
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Uploads an image privately to the app and returns its Slack file id, for use in an image
 * block. Images are sent as bytes rather than linked from storage, so nothing in Slack depends on
 * a public URL (REQUIREMENTS, "Deploy targets — Local").
 */
export async function uploadImage(web: WebClient, bytes: Buffer, filename: string, title: string) {
  const res = (await web.filesUploadV2({ file: bytes, filename, title })) as {
    files?: ({ id?: string } & { files?: { id?: string }[] })[];
  };
  const first = res.files?.[0];
  const id = first?.files?.[0]?.id ?? first?.id;
  if (!id) throw new Error(`upload returned no file id: ${JSON.stringify(res).slice(0, 300)}`);
  return id;
}

/**
 * chat.postMessage, retried while Slack is still processing a just-uploaded file — an image
 * block referencing it fails with invalid_blocks for a few seconds.
 */
export async function postWithFreshFile(web: WebClient, args: Parameters<WebClient["chat"]["postMessage"]>[0]) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await web.chat.postMessage(args);
    } catch (err) {
      const code = (err as { data?: { error?: string } }).data?.error;
      if (code !== "invalid_blocks" || attempt >= 8) throw err;
      await sleep(1500);
    }
  }
}

export const usd = (n: number) => `$${n.toFixed(2)}`;
