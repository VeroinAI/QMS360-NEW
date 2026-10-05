import { mappedText, PPTX_UNMAPPED } from "./audit-pptx-mapping";

/** Format the saved wall-clock value, without shifting its date/time by timezone. */
export function programmeDate(value?: string): string {
  const text = mappedText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text);
  if (!match) return text;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(match[2]) - 1];
  if (!month) return text;
  return `${Number(match[3])} ${month} ${match[1]}, ${match[4]}:${match[5]}${text.includes("derived legacy") ? " (derived legacy)" : ""}`;
}

// Conservative em widths leave room for differences between Office fonts.
const width = (text: string) => Array.from(text).reduce((sum, char) =>
  sum + (/\s/.test(char) ? .35 : /[MW@%]|[^\u0000-\u024f]/.test(char) ? 1 : .7), 0);
export function programmeLines(text: string, ems: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && width(`${line} ${word}`) > ems) { lines.push(line); line = ""; }
      for (const char of word) {
        if (width(line + char) > ems) { lines.push(line); line = ""; }
        line += char;
      }
      line += " ";
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function programmeEntries(rows: string[][]): Array<{ times: string; details: string }> {
  return rows.flatMap(row => {
    const times = `Start: ${programmeDate(row[0])}\nEnd: ${programmeDate(row[1])}`;
    const lines = programmeLines([
      `Activity: ${mappedText(row[2])}`, `Remarks: ${mappedText(row[3])}`, `Auditee: ${mappedText(row[4])}`,
    ].join("\n"), 30);
    return Array.from({ length: Math.ceil(lines.length / 3) }, (_, i) => ({
      times, details: lines.slice(i * 3, i * 3 + 3).join("\n") || PPTX_UNMAPPED,
    }));
  });
}
