import { mappedText, PPTX_EMPTY } from "./audit-pptx-mapping";

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
  return rows.map(row => {
    const times = `Start: ${programmeDate(row[0])}\nEnd: ${programmeDate(row[1])}`;
    // PPTX milestones show main activities only. Keep remarks in the shared
    // report rows for other exports, but exclude them before wrapping/pagination.
    const lines = programmeLines(`Activity: ${mappedText(row[2])}`, 30);
    return { times, details: lines.join("\n") || PPTX_EMPTY };
  });
}

export const PROGRAMME_TOP = 1892808;
export const PROGRAMME_HEIGHT = 4343400;
const TIMES_HEIGHT = 330200;
const LINE_HEIGHT = 146050; // 11.5 points, matching the rendered paragraph spacing.
const DETAILS_PADDING = 41850;
const GAP = 28480;
export type ProgrammeActivityBlock = {
  times: string; details: string; continued: boolean;
  top: number; timesTop: number; detailsHeight: number; height: number;
};

/** One milestone per main activity; only visible content can require continuations. */
export function programmePages(rows: string[][]): ProgrammeActivityBlock[][] {
  const pages: ProgrammeActivityBlock[][] = [[]];
  let page = pages[0]!, used = 0;
  const newPage = () => { page = []; pages.push(page); used = 0; };
  const heightFor = (lines: number) => TIMES_HEIGHT + Math.max(3, lines) * LINE_HEIGHT + DETAILS_PADDING + GAP;
  const maxLines = Math.floor((PROGRAMME_HEIGHT - TIMES_HEIGHT - DETAILS_PADDING - GAP) / LINE_HEIGHT);
  for (const entry of programmeEntries(rows)) {
    let lines = entry.details.split("\n"), continued = false;
    // Keep an activity intact when it fits on a fresh slide.
    if (page.length && (page.length === 5 || heightFor(lines.length) > PROGRAMME_HEIGHT - used)) newPage();
    while (lines.length) {
      const part = lines.slice(0, maxLines), height = heightFor(part.length);
      const top = PROGRAMME_TOP + used;
      page.push({
        times: continued ? "" : entry.times,
        details: part.join("\n"), continued, top, timesTop: top + height - TIMES_HEIGHT - GAP,
        detailsHeight: height - TIMES_HEIGHT - GAP - DETAILS_PADDING, height,
      });
      used += height;
      lines = lines.slice(part.length);
      if (lines.length) { newPage(); continued = true; }
    }
  }
  return pages;
}
