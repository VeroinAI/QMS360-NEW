import { PDFDocument, type PDFFont, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { QaqcReportExport } from "./qaqc-reporting-export";
import { monthlyAsset, monthlyDate, UNMAPPED } from "./qaqc-monthly-report-template";

const PURPLE = rgb(0.345,0.173,0.514);
const BLACK = rgb(0.12,0.12,0.12);
const WHITE = rgb(1,1,1);
const RATING_KEYS = ["quality","timeline","communication","professionalism","valueForMoney","issueHandling"] as const;
const value = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : UNMAPPED;
export function csatReportValues(report: QaqcReportExport) {
  const d = report.data as Record<string, any>;
  const additional = report.projectAdditionalData ?? {};
  const contact = [value(additional.email), value(additional.phone)]
    .filter(part => part !== UNMAPPED).join(" / ") || UNMAPPED;
  return {
    project: value(report.projectName), location: value(report.projectLocation),
    // Use this report's Project Master Additional Data, never the QMS submitter.
    name: value(additional.name), contact,
    followUp: ["Yes", "No"].includes(d.followUp) ? d.followUp as string : UNMAPPED,
    contactMethod: d.followUp === "Yes" ? value(d.preferredContactMethod) : UNMAPPED,
    satisfactory: value(d.satisfactoryAspects), improvements: value(d.improvementSuggestions),
    comments: value(d.comments),
    ratings: RATING_KEYS.map(k => Number.isInteger(d.ratings?.[k]) && d.ratings[k] >= 1 && d.ratings[k] <= 5 ? d.ratings[k] as number : null),
    expectations: ["Yes","No","Partially"].includes(d.expectations) ? d.expectations as string : null,
    recommend: ["Yes","No","Partially","Maybe"].includes(d.recommend) ? d.recommend as string : null,
    date: monthlyDate(report.period),
  };
}

/** The blank background is rendered from the customer's original Word form.
 * Keep its logo, tables, borders, colours and control/revision footer intact.
 * Coordinates below use top-left PDF points and match this versioned asset.
 */
export async function exportCsatReportPdf(report: QaqcReportExport): Promise<Buffer> {
  const pdf = await PDFDocument.load(await monthlyAsset("qaqc-csat-template.pdf"));
  pdf.registerFontkit(fontkit);
  const normal = await pdf.embedFont(await monthlyAsset("DejaVuSans.ttf"), { subset:true,features:{liga:false,kern:false} });
  const bold = await pdf.embedFont(await monthlyAsset("DejaVuSans-Bold.ttf"), { subset:true,features:{liga:false,kern:false} });
  const v = csatReportValues(report);
  pdf.setTitle(`Customer Satisfaction (CSAT) — ${v.project} — ${v.date}`);
  pdf.setAuthor("QMS360");
  pdf.setSubject(`CSAT report ${report.referenceNumber ?? report.id}`);
  const page = pdf.getPages()[0]!, h = page.getHeight();
  const overflow: Array<{label:string; text:string}> = [];
  function wrap(s: string, width: number, font: PDFFont, size: number) {
    const lines: string[] = [];
    for(const para of s.replace(/\r\n?/g,"\n").split("\n")) {
      let line = "";
      for(const word of para.split(/\s+/)) {
        if(!word)continue;
        const next = line ? `${line} ${word}` : word;
        if(font.widthOfTextAtSize(next,size)<=width) {line=next;continue;}
        if(line){lines.push(line);line="";}
        if(font.widthOfTextAtSize(word,size)<=width){line=word;continue;}
        for(const ch of word) {
          if(font.widthOfTextAtSize(line+ch,size)>width && line){lines.push(line);line="";}
          line+=ch;
        }
      }
      lines.push(line);
    }
    return lines;
  }
  function box(label: string, s: string, x: number, y: number, width: number, height: number, size=9) {
    const lines=wrap(s,width-8,normal,size), max=Math.max(1,Math.floor((height-6)/(size*1.2)));
    let shown=lines;
    if(lines.length>max) {
      overflow.push({label,text:s});
      shown=wrap("See continuation: "+label,width-8,normal,size).slice(0,max);
    }
    shown.forEach((line,i)=>page.drawText(line,{x:x+4,y:h-y-4-size-i*size*1.2,font:normal,size,color:BLACK}));
  }
  // General information. The project name is context, not a fabricated address.
  box("Name",v.name,179,105.5,372,27.5);
  const location=v.project===UNMAPPED&&v.location===UNMAPPED ? UNMAPPED
    : v.location===UNMAPPED ? `${v.project} — Location: ${UNMAPPED}` : `${v.project} — ${v.location}`;
  box("Project Address / Location",location,179,134,372,27.5);
  box("Email / Phone",v.contact,179,162.5,372,27);
  const check=(x: number,y: number) => {
    // A vector tick inside the original unchecked square avoids font-dependent symbols.
    page.drawLine({start:{x:x+3,y:h-y-10},end:{x:x+6,y:h-y-13},thickness:1.6,color:PURPLE});
    page.drawLine({start:{x:x+6,y:h-y-13},end:{x:x+12,y:h-y-5},thickness:1.6,color:PURPLE});
  };
  const columns=[303.8,352.15,403.9,456.8,513.75], ratingY=[287.55,311.75,335.95,358.65,382.85,408.55];
  const ratingEdges=[286.65,309.35,335.05,357.75,380.45,406.15,431.85];
  v.ratings.forEach((r,i)=>{
    if(r)check(columns[r-1]!,ratingY[i]!);
    else {
      const top=ratingEdges[i]!+0.25, bottom=ratingEdges[i+1]!-0.25;
      page.drawRectangle({x:289.3,y:h-bottom,width:262.1,height:bottom-top,color:WHITE});
      page.drawText(UNMAPPED,{x:297,y:h-ratingY[i]!-12,size:8,font:normal,color:BLACK});
    }
  });
  box("Most satisfactory aspects",v.satisfactory,289.3,455.4,262,30);
  box("Improvement suggestions",v.improvements,289.3,486.6,262,33.5);
  const outcome=(answer: string|null,y: number) => {
    const col=answer==="Yes"?0:answer==="No"?1:answer==="Partially"||answer==="Maybe"?2:-1;
    if(col>=0)check([302.3,387.4,472.1][col]!,y);
    else {
      const top=y===527.65?521.05:556.05, height=y===527.65?34:24.5;
      page.drawRectangle({x:289.3,y:h-top-height,width:262,height,color:WHITE});
      page.drawText(UNMAPPED,{x:296,y:h-y-13,size:9,font:normal,color:BLACK});
    }
  };
  outcome(v.expectations,527.65);outcome(v.recommend,558);
  if(v.expectations) {
    // Keep the template's third label on one line with embedded fallback fonts.
    page.drawRectangle({x:502.5,y:h-555,width:48,height:34,color:WHITE});
    page.drawText("Partially",{x:503.5,y:h-542.5,size:8.5,font:normal,color:BLACK});
  }
  if(v.recommend==="Partially") {
    // Do not silently reinterpret the recorded "Partially" as the template's "Maybe".
    page.drawRectangle({x:502.5,y:h-578,width:48,height:19,color:WHITE});
    page.drawText("Partially",{x:503.5,y:h-573,size:8.5,font:normal,color:BLACK});
  }
  box("Additional comments / recommendations",v.comments,29.5,630,522,57);
  for(const [label,s,y] of [["Follow-up requested",v.followUp,713.25],["Preferred contact method",v.contactMethod,738.95]] as const) {
    page.drawRectangle({x:289.3,y:h-y-22,width:262,height:21.5,color:WHITE});
    box(label,s,289.5,y,261,21,8.5);
  }
  // Identify the selected record without changing the form's controlled revision footer.
  const identity=`Survey date: ${v.date} · Report: ${report.referenceNumber ?? report.id}`;
  const identityLines=wrap(identity,521,normal,7);
  page.drawText(identityLines[0]!,{x:29.5,y:h-794,size:7,font:normal,color:BLACK});
  if(overflow.length || identityLines.length>1) {
    let continuation=pdf.addPage([page.getWidth(),h]), y=80;
    const startPage=()=>{
      continuation.drawRectangle({x:29,y:h-65,width:522,height:30,color:PURPLE});
      continuation.drawText("CUSTOMER SATISFACTION — CONTINUATION",{x:39,y:h-55,size:12,font:bold,color:WHITE});
    };
    startPage();
    const write=(s: string,font=normal,size=10)=>{
      for(const line of wrap(s,502,font,size)) {
        if(y+size*1.3>h-50){continuation=pdf.addPage([page.getWidth(),h]);y=80;startPage();}
        continuation.drawText(line,{x:39,y:h-y-size,font,size,color:BLACK});y+=size*1.3;
      }
    };
    write(`Project: ${v.project}`);write(identity);y+=10;
    for(const item of overflow){write(item.label,bold);write(item.text);y+=14;}
  }
  // Background footer reads "1 of 1"; update the page-count cell for overflow only.
  if(pdf.getPageCount()>1) {
    page.drawRectangle({x:514,y:h-815.3,width:49,height:6.5,color:WHITE});
    page.drawText(`1 of ${pdf.getPageCount()}`,{x:532,y:h-813.8,size:5,font:normal,color:BLACK});
    pdf.getPages().slice(1).forEach((p,i)=>p.drawText(`Page ${i+2} of ${pdf.getPageCount()}`,{x:475,y:30,size:8,font:normal,color:BLACK}));
  }
  return Buffer.from(await pdf.save());
}
