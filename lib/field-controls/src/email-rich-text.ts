/** Deliberately small document format: no user-supplied HTML, URLs or CSS. */
export type EmailRichMark =
  | { type: "bold" | "italic" | "underline" }
  | { type: "textStyle"; attrs: { color: string } };
export type EmailRichTextNode = { type: "text"; text: string; marks?: EmailRichMark[] } | { type: "hardBreak" };
export type EmailRichParagraph = { type: "paragraph"; content?: EmailRichTextNode[] };
export type EmailRichDocument = { type: "doc"; content: EmailRichParagraph[] };

const colorPattern = /^#[0-9a-fA-F]{6}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every(key => keys.includes(key));
}

export function validateEmailRichText(value: unknown): asserts value is EmailRichDocument {
  const invalid = () => { throw new Error("Invalid email body formatting. Only paragraphs, bold, italic, underline and hex text colors are supported."); };
  if (!object(value) || value.type !== "doc" || !onlyKeys(value, ["type", "content"]) || !Array.isArray(value.content)) return invalid();
  if (JSON.stringify(value).length > 120000) throw new Error("Formatted email body exceeds the 120,000 character storage limit.");
  let count = 0;
  let textLength = Math.max(0, value.content.length - 1);
  for (const paragraph of value.content) {
    if (++count > 10000) throw new Error("Email body contains too many formatting nodes.");
    if (!object(paragraph) || paragraph.type !== "paragraph" || !onlyKeys(paragraph, ["type", "content"]) ||
      (paragraph.content !== undefined && !Array.isArray(paragraph.content))) return invalid();
    for (const node of (paragraph.content ?? []) as unknown[]) {
      if (++count > 10000) throw new Error("Email body contains too many formatting nodes.");
      if (!object(node)) return invalid();
      if (node.type === "hardBreak" && onlyKeys(node, ["type"])) { textLength++; continue; }
      if (node.type !== "text" || typeof node.text !== "string" || !onlyKeys(node, ["type", "text", "marks"]) ||
        (node.marks !== undefined && !Array.isArray(node.marks))) return invalid();
      textLength += node.text.length;
      const marks = (node.marks ?? []) as unknown[];
      if (marks.length > 4) return invalid();
      const types = new Set();
      for (const mark of marks) {
        if (!object(mark) || types.has(mark.type)) return invalid();
        types.add(mark.type);
        if (["bold", "italic", "underline"].includes(String(mark.type)) && onlyKeys(mark, ["type"])) continue;
        if (mark.type === "textStyle" && onlyKeys(mark, ["type", "attrs"]) && object(mark.attrs) &&
          onlyKeys(mark.attrs, ["color"]) && typeof mark.attrs.color === "string" && colorPattern.test(mark.attrs.color)) continue;
        return invalid();
      }
    }
  }
  if (textLength > 20000) throw new Error("Email body cannot exceed 20,000 characters.");
}

export function emailRichTextToPlain(value: unknown): string {
  validateEmailRichText(value);
  return value.content.map(p => (p.content ?? []).map(n => n.type === "text" ? n.text : "\n").join("")).join("\n");
}

export function plainTextToEmailRichText(text: string): EmailRichDocument {
  return { type: "doc", content: text.split("\n").map(line => ({
    type: "paragraph", ...(line ? { content: [{ type: "text", text: line }] as EmailRichTextNode[] } : {}),
  })) };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));
function markedHtml(text: string, marks: EmailRichMark[]) {
  let html = escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>");
  for (const mark of marks) {
    if (mark.type === "bold") html = `<strong>${html}</strong>`;
    else if (mark.type === "italic") html = `<em>${html}</em>`;
    else if (mark.type === "underline") html = `<u style="text-decoration:underline">${html}</u>`;
    else if (mark.type === "textStyle") html = `<span style="color:${mark.attrs.color}">${html}</span>`;
  }
  return html;
}

/** Resolve tokens across text nodes; the replacement inherits the token's starting marks. */
export function renderEmailRichText(value: unknown, resolve: (token: string) => string) {
  validateEmailRichText(value);
  const texts: string[] = [];
  const paragraphs = value.content.map(paragraph => {
    let position = 0;
    const segments = (paragraph.content ?? []).map(node => {
      const text = node.type === "text" ? node.text : "\n";
      const segment = { text, start: position, end: position + text.length, marks: node.type === "text" ? node.marks ?? [] : [] };
      position += text.length;
      return segment;
    });
    const text = segments.map(s => s.text).join("");
    let html = "", plain = "", cursor = 0;
    const append = (start: number, end: number) => {
      plain += text.slice(start, end);
      for (const segment of segments) {
        const from = Math.max(start, segment.start), to = Math.min(end, segment.end);
        if (to > from) html += markedHtml(text.slice(from, to), segment.marks);
      }
    };
    for (const match of text.matchAll(/\{\{?\s*([^{}]+?)\s*\}?\}/g)) {
      const start = match.index!;
      append(cursor, start);
      const replacement = resolve(match[1]);
      plain += replacement;
      html += markedHtml(replacement, segments.find(s => s.start <= start && s.end > start)?.marks ?? []);
      cursor = start + match[0].length;
    }
    append(cursor, text.length);
    texts.push(plain);
    return `<p style="margin:0 0 12px;white-space:pre-wrap">${html || "<br>"}</p>`;
  });
  return { text: texts.join("\n"), html: `<div>${paragraphs.join("")}</div>` };
}
