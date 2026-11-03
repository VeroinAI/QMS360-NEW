export const QUALITY_BRIEF_STYLE = `Write a short, business-friendly quality summary, not an analysis.
Use 1–6 short bullet points, each starting with "- ", with no more than 120 words in total.
Use fewer bullets when evidence is limited; never add content to fill a quota.
Prioritize important quality figures, meaningful performance changes and critical issues supported by the supplied evidence.
Use simple, professional language. Keep each bullet to one short sentence, ideally no more than 20 words.
Include units for figures; express differences between percentages in percentage points, not relative percent changes.
Do not include a heading, introduction, conclusion, detailed interpretations, technical explanations, repeated information, rankings or recommendations.
Do not repeat every metric or reproduce tables already contained in the report.
Use only available data. Do not assume missing values, treat missing values as zero, invent causes, infer unsupported trends or make unsupported conclusions.
If no relevant evidence is available, return one short bullet stating that available data is insufficient for a quality summary.
Return suggestions as an empty array; do not add a separate recommendations list.`;

/** Reject an overlong or paragraph-style answer rather than silently truncating facts. */
export function conciseQualityBrief(value: string): string | null {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 6 || lines.some(line => !/^[-•]\s+\S/.test(line))) return null;
  const words = lines.flatMap(line => line.replace(/^[-•]\s+/, "").split(/\s+/));
  if (words.length > 120) return null;
  return lines.map(line => line.replace(/^•\s+/, "- ")).join("\n");
}
