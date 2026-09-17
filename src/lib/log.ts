import pino from "pino";

// Structured JSON to stdout on both stacks: `docker compose logs` today, CloudWatch later.
export function createLogger(service: string) {
  return pino({ level: process.env.LOG_LEVEL ?? "info", base: { service } });
}
