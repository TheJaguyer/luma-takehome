// Flow 1, decision 1.2: the drop name comes from the filename, falling back to the date.
// "catalog-q4-drop.csv" → "Q4 Drop"; "export(3).csv" → "Import of Sep 16".

const NOISE = new Set(["catalog", "catalogue", "export", "sheet", "products", "product", "copy", "final", "data", "csv"]);

export function dropNameFromFilename(filename: string, importedAt: Date): string {
  const words = filename
    .replace(/\.[^.]+$/, "")
    .replace(/\(\d+\)/g, " ")
    .split(/[\s_\-.]+/)
    .filter((w) => w && !NOISE.has(w.toLowerCase()) && !/^v?\d+$/i.test(w) && /[a-z]/i.test(w));

  if (words.length === 0) {
    const date = importedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return `Import of ${date}`;
  }
  return words
    .map((w) => (/\d/.test(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}
