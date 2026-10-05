import type { ReportSectionData } from "./audit-consolidated-report";

export const PPTX_UNMAPPED = "To be mapped";
export const mappedText = (value: unknown): string => {
  if (value == null || String(value).trim() === "") return PPTX_UNMAPPED;
  return String(value).replace(/\bNot recorded\b|\bTo Be Mapped\b/gi, PPTX_UNMAPPED);
};
export type PptxSlideValues = { shapes: Record<number, string>; tables: string[][][] };

/** Only factual values from the existing consolidated report; no template sample data. */
export function auditPptxMappings(sections: ReportSectionData[]): Map<number, PptxSlideValues> {
  const section = (key: string) => sections.find(s => s.key === key);
  const field = (key: string, label: string) => mappedText(section(key)?.fields.find(f => f.label === label)?.value);
  const rows = (key: string, index = 0) => section(key)?.tables[index]?.rows.map(row => row.map(mappedText)) ?? [];
  const f = (key: string, labels: string[]) => labels.map(label => field(key, label));
  const result = new Map<number, PptxSlideValues>();
  const put = (slide: number, shapes: Record<number, string>, tables: string[][][] = []) => result.set(slide, { shapes, tables });
  const keyed = (key: string, ids: number[], labels: string[]) => Object.fromEntries(ids.map((id, i) => [id, field(key, labels[i]!)]));
  put(1, keyed("cover", [7, 8, 10, 12, 14, 16], ["Project / process / site", "Scope", "Audit reference", "Audit dates", "Contract / project number", "Report revision"]));
  put(2, keyed("document-control", [9, 11, 13, 15, 17, 19], ["Form title", "Form number", "Form revision", "Effective date", "Process owner", "Applies to"]),
    [rows("document-control", 0), rows("document-control", 1)]);
  put(3, keyed("audit-overview", [7, 9, 11, 13, 15, 17, 19, 21, 25, 27, 29, 31, 33, 35, 37, 41],
    ["Audit title", "Audit reference", "Audit type", "Audit dates", "Location / department", "Lead auditor", "Audit team", "Auditee representatives",
      "Client", "Contractor", "Contract / project number", "Contract signed", "Contract period", "TCC", "PAC", "FAC"]));
  put(4, {
    6: field("scope", "Objective"),
    11: ["In scope", "Not in scope / not audited, and why", "Period and sample covered", "Project phases covered"].map(l => `${l}: ${field("scope", l)}`).join("\n"),
    16: field("scope", "Audit criteria"),
    21: `Method: ${field("scope", "Method")}\nSampling basis: ${field("scope", "Sampling basis")}`,
  });
  put(5, {
    5: `${field("cover", "Audit reference")} | ${field("cover", "Project / process / site")}`,
    7: `Daily programme (${field("cover", "Audit dates")})`,
    28: field("programme", "Audit team"), 33: field("programme", "Auditees present"), 38: field("programme", "Not represented"),
  });
  put(6, {
    ...keyed("executive-summary", [5, 8, 11, 14, 17, 32, 35], ["Non-conformities", "Opportunities for improvement", "Major", "Moderate", "Minor", "Overall conclusion", "Key messages"]),
    20: `OVERALL RATING: ${field("executive-summary", "Overall rating")}`,
    21: field("executive-summary", "Overall rating") === "Effective" ? "☑" : "☐",
    24: field("executive-summary", "Overall rating") === "Effective with improvements required" ? "☑" : "☐",
    27: field("executive-summary", "Overall rating") === "Not effective" ? "☑" : "☐",
  });
  const themes = rows("findings-summary", 1);
  put(7, Object.fromEntries([0, 1, 2].flatMap(i => [[10 + i * 4, themes[i]?.[0] ?? PPTX_UNMAPPED],
    [11 + i * 4, themes[i]?.slice(1).join(" · ") || PPTX_UNMAPPED]])),
    [rows("findings-summary").map(r => [r[0]!, r[1]!, r[2]!, r[3]!, r[4]!, r[6]!])]);
  put(8, {
    5: "", 7: `Data as at: ${field("project-progress", "Data as at")}    Source: ${field("project-progress", "Source")}`,
    13: field("project-progress", "Auditor comment"),
  }, [rows("project-progress")]);
  put(9, { 5: "", 12: `Comment: ${field("design-procurement", "Design comment")}`, 16: `Comment: ${field("design-procurement", "Procurement comment")}` },
    [rows("design-procurement"), rows("design-procurement", 1)]);
  put(10, { 9: rows("conforming", 1).map(r => r.join(" · ")).join("\n") || PPTX_UNMAPPED }, [rows("conforming")]);
  for (const [slide, key] of [[11, "non-conformities"], [12, "ofi"]] as const) {
    put(slide, {}, [rows(key).map(r => [r[0]!, `${r[1]}\n${r[2]}`, r[3]!, r[4]!, r[5]!])]);
  }
  put(15, {}, [rows("corrective-actions")]);
  put(16, Object.fromEntries([7, 11, 15].map((id, i) => [id, rows("priority-actions", i).map(r => r.join(" · ")).join("\n") || PPTX_UNMAPPED])));
  const signOff = rows("conclusion");
  const signer = (role: string) => signOff.find(r => r[0]?.toLowerCase() === role.toLowerCase());
  put(17, {
    5: field("conclusion", "Headline conclusion"),
    6: `${f("conclusion", ["Objectives achieved", "System effectiveness and priority findings"]).join("\n")}\nFollow-up audit: ${f("conclusion", ["Follow-up audit date", "Follow-up scope"]).join(" · ")}`,
    7: `Report issue date: ${field("conclusion", "Report issue date")}`, 8: `Distribution: ${field("conclusion", "Distribution")}`,
    11: `Lead auditor: ${mappedText(signer("Prepared by")?.[1] ?? field("audit-overview", "Lead auditor"))}`,
    17: mappedText(signer("Reviewed by")?.[1]), 23: mappedText(signer("Approved by")?.[1]), 29: mappedText(signer("Acknowledged by")?.[1]),
    ...Object.fromEntries(["Prepared by", "Reviewed by", "Approved by", "Acknowledged by"].flatMap((role, i) => [
      [12 + i * 6, mappedText(signer(role)?.[2])], [13 + i * 6, mappedText(signer(role)?.[3])],
    ])),
  });
  // These are attachment confirmations, not assumed merely because records exist.
  put(18, Object.fromEntries([6, 8, 10, 12, 14, 16].map(id => [id, PPTX_UNMAPPED])));
  return result;
}
