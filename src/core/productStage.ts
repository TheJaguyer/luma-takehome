// Flow 4's stages, rolled up to product state (#5a): every count in status adds up to the number of
// products, and the export's Status column uses the same words. One definition, two readers.

export type Stage =
  | "done"
  | "awaiting_decision"
  | "generating"
  | "waiting_on_person"
  | "needs_source_photo"
  | "ideas_awaiting_review"
  | "drafting"
  | "skipped"
  | "not_started";

export const STAGE_LABEL: Record<Stage, string> = {
  done: "Done",
  awaiting_decision: "Awaiting a decision",
  generating: "Generating",
  waiting_on_person: "Short — waiting on a person",
  needs_source_photo: "Needs a source photo",
  ideas_awaiting_review: "Idea awaiting review",
  drafting: "Drafting ideas",
  skipped: "Skipped",
  not_started: "Not started",
};

export type StageInput = {
  live: number;
  hasSourcePhoto: boolean;
  ideas: { state: string; createdAt: Date }[];
  latestRound: { state: string; succeeded: number } | null;
};

export function productStage(p: StageInput, doneAt = 2): Stage {
  if (p.live >= doneAt) return "done";
  const idea = [...p.ideas].filter((i) => i.state !== "SUPERSEDED").sort((a, b) => +b.createdAt - +a.createdAt)[0];
  if (idea?.state === "APPROVED") {
    if (!p.hasSourcePhoto && !p.latestRound) return "needs_source_photo";
    if (p.latestRound?.state === "GENERATING") return "generating";
    if (p.latestRound?.state === "AWAITING_DECISION" && p.latestRound.succeeded > 0) return "awaiting_decision";
    return "waiting_on_person"; // short round closed, or every candidate failed
  }
  if (idea?.state === "AWAITING_REVIEW") return "ideas_awaiting_review";
  if (idea?.state === "DRAFTING" || idea?.state === "DRAFT_FAILED") return "drafting";
  if (idea?.state === "SKIPPED") return "skipped";
  if (!p.hasSourcePhoto) return "needs_source_photo";
  return "not_started";
}
