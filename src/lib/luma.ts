// Luma Agents API — just the two calls the product makes: submit an image edit, and poll it.
// https://docs.agents.lumalabs.ai (image editing, rate limits, error handling, pricing).

const BASE_URL = "https://agents.lumalabs.ai/v1";

/** Pay-as-you-go price per image_edit with no image_ref (pricing guide, 2026-09). */
export const EDIT_PRICE_USD: Record<string, number> = {
  "uni-1": 0.0434,
  "uni-1-max": 0.103,
};

export type Source = { url: string } | { data: string; media_type: string };

export type Generation = {
  id: string;
  state: "queued" | "processing" | "completed" | "failed";
  model: string;
  output: { type: string; url: string }[];
  failure_reason: string | null;
  failure_code: string | null;
};

export class LumaError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    /** Seconds to wait before trying again, when Luma says so (429). */
    readonly retryAfter: number | null,
  ) {
    super(`Luma ${status}: ${detail}`);
  }

  /** Worth trying the same request again later: rate limits and Luma-side errors. */
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

/** Async failures worth one automatic retry, per the error-handling guide. Moderation is not. */
export const RETRYABLE_FAILURES = new Set(["generation_failed", "output_not_found", "rate_limited"]);

export function createLuma(apiKey: string) {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text();
      let detail = text;
      try {
        detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
      } catch {}
      const retryAfter = Number(res.headers.get("retry-after")) || null;
      throw new LumaError(res.status, detail, retryAfter);
    }
    return (await res.json()) as T;
  }

  return {
    editImage: (input: { prompt: string; source: Source; model: string }) =>
      call<Generation>("POST", "/generations", {
        type: "image_edit",
        model: input.model,
        prompt: input.prompt,
        source: input.source,
      }),
    getGeneration: (id: string) => call<Generation>("GET", `/generations/${encodeURIComponent(id)}`),
  };
}

export type Luma = ReturnType<typeof createLuma>;
