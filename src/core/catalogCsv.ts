// Flow 1, Step 2: tolerant reading of a catalogue export (#12).
// Headers match loosely, SKU and Photo are required, unknown columns are ignored, and only a row
// with broken identity — a missing or duplicated SKU — is rejected. Everything here is pure, so
// the rules are tested without Slack, a database or the network.
import { parse } from "csv-parse/sync";

export type CatalogRow = {
  /** 1-based line number in the file, as someone looking at the sheet would count it. */
  line: number;
  sku: string;
  name: string | null;
  category: string | null;
  color: string | null;
  material: string | null;
  price: string | null;
  photoUrl: string | null;
  shotIdea: string | null;
  notes: string | null;
};

export type RejectedRow = { line: number; sku: string | null; reason: string };

export type ParsedCatalog =
  | { ok: true; rows: CatalogRow[]; rejected: RejectedRow[]; rowCount: number }
  | { ok: false; reason: string };

type Field = Exclude<keyof CatalogRow, "line">;

// Normalised header → field. Normalising strips case, spacing and punctuation, so
// "Color / Finish", "colour_finish" and "COLOR" all land on the same field.
const HEADERS: Record<string, Field> = {
  sku: "sku",
  productname: "name",
  name: "name",
  product: "name",
  category: "category",
  colorfinish: "color",
  color: "color",
  colour: "color",
  colourfinish: "color",
  finish: "color",
  material: "material",
  price: "price",
  photo: "photoUrl",
  photourl: "photoUrl",
  image: "photoUrl",
  imageurl: "photoUrl",
  shotidea: "shotIdea",
  idea: "shotIdea",
  notes: "notes",
  note: "notes",
};

const normaliseHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (v: string | undefined) => {
  const t = v?.replace(/\s+/g, " ").trim();
  return t ? t : null;
};

export function parseCatalogCsv(text: string): ParsedCatalog {
  let records: string[][];
  try {
    records = parse(text, { bom: true, relax_column_count: true, skip_empty_lines: true, trim: false });
  } catch (err) {
    return { ok: false, reason: `It isn't a readable CSV (${(err as Error).message}).` };
  }
  const [header, ...body] = records;
  if (!header || body.length === 0) return { ok: false, reason: "The file is empty." };

  const columns = new Map<Field, number>();
  header.forEach((raw, index) => {
    const field = HEADERS[normaliseHeader(raw)];
    if (field && !columns.has(field)) columns.set(field, index);
  });
  const missing = (["sku", "photoUrl"] as const).filter((f) => !columns.has(f));
  if (missing.length > 0) {
    const found = header.map((h) => `"${h.trim()}"`).join(", ");
    const names = missing.map((f) => (f === "sku" ? "SKU" : "Photo")).join(" and ");
    return { ok: false, reason: `I couldn't find a ${names} column. The headers I found were: ${found}.` };
  }

  const read = (record: string[], field: Field) => {
    const index = columns.get(field);
    return index === undefined ? null : clean(record[index]);
  };

  const candidates: CatalogRow[] = body
    .map((record, i) => ({ record, line: i + 2 }))
    .filter(({ record }) => record.some((cell) => cell.trim() !== ""))
    .map(({ record, line }) => ({
      line,
      sku: (read(record, "sku") ?? "").toUpperCase(),
      name: read(record, "name"),
      category: read(record, "category"),
      color: read(record, "color"),
      material: read(record, "material"),
      price: read(record, "price"),
      photoUrl: read(record, "photoUrl"),
      shotIdea: read(record, "shotIdea"),
      notes: read(record, "notes"),
    }));

  const counts = new Map<string, number>();
  for (const row of candidates) if (row.sku) counts.set(row.sku, (counts.get(row.sku) ?? 0) + 1);

  const rows: CatalogRow[] = [];
  const rejected: RejectedRow[] = [];
  for (const row of candidates) {
    if (!row.sku) {
      rejected.push({ line: row.line, sku: null, reason: "missing SKU" });
    } else if ((counts.get(row.sku) ?? 0) > 1) {
      // Every copy is rejected: nothing says which of them is the right one.
      rejected.push({ line: row.line, sku: row.sku, reason: `SKU appears ${counts.get(row.sku)} times in the file` });
    } else {
      rows.push(row);
    }
  }
  return { ok: true, rows, rejected, rowCount: candidates.length };
}

/** The product fields an export can change; compared to decide "unchanged" vs "changed". */
export const DETAIL_FIELDS = ["name", "category", "color", "material", "price", "notes"] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];

export const FIELD_LABELS: Record<DetailField | "photoUrl", string> = {
  name: "name",
  category: "category",
  color: "colour",
  material: "material",
  price: "price",
  notes: "notes",
  photoUrl: "photo",
};

/**
 * Which fields an incoming row would change. Blank cells never erase (#12), so a blank incoming
 * value is never a difference.
 */
export function changedFields(
  current: Record<DetailField | "photoUrl", string | null>,
  incoming: CatalogRow,
): (DetailField | "photoUrl")[] {
  const fields = [...DETAIL_FIELDS, "photoUrl"] as const;
  return fields.filter((f) => incoming[f] !== null && incoming[f] !== current[f]);
}
