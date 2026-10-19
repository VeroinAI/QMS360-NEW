import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Element } from "@xmldom/xmldom";
import type { QaqcReportExport } from "./qaqc-reporting-export";
import { attr, buildMonthlyReportDocument, child, children, descendants, monthlyAsset } from "./qaqc-monthly-report-template";

type Token = { text: string; font: PDFFont; size: number; color: string };
type Line = { tokens: Token[]; height: number; before: number; after: number; align: string };
const color = (hex = "3A3A3B") => {
  const h = /^[0-9a-f]{6}$/i.test(hex) ? hex : "3A3A3B";
  return rgb(parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255);
};
const points = (e: Element | undefined, name: string, fallback = 0) => Number(attr(e,name) || fallback * 20) / 20;
const height = (lines: Line[]) => lines.reduce((s,l) => s+l.before+l.height+l.after,0);

/** Render the supplied Word tables and run styles directly, with flowing rows.
 * Calibri's open, metrically compatible Carlito font is embedded for portability;
 * DejaVu is used only for symbols absent from Carlito. No office/browser runtime.
 */
export async function exportMonthlyMetricsPdf(report: QaqcReportExport): Promise<Buffer> {
  const { body, project, month } = await buildMonthlyReportDocument(report);
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  pdf.setTitle(`QA/QC Metrics – Monthly Report — ${project} — ${month}`);
  pdf.setAuthor("QMS360"); pdf.setSubject("QA/QC monthly metrics");
  const fontNames = ["Carlito-Regular.ttf","Carlito-Bold.ttf","DejaVuSans.ttf","Carlito-Italic.ttf","Carlito-BoldItalic.ttf"];
  // Carlito's composite glyphs do not survive fontkit subsetting reliably.
  // Embed complete fonts so the PDF renders correctly in Acrobat and browsers.
  const [regular,bold,symbol,italic,boldItalic] = await Promise.all(fontNames.map(async name => pdf.embedFont(await monthlyAsset(name), {
    subset:false, features:{liga:false,clig:false,kern:false},
  })));
  const chars = new Map([regular,bold,symbol,italic,boldItalic].map(f => [f,new Set(f.getCharacterSet())]));
  const sect = child(body,"sectPr"), pgSize = child(sect,"pgSz"), margin = child(sect,"pgMar");
  const width = points(pgSize,"w",595.3), pageHeight = points(pgSize,"h",841.9);
  const left = points(margin,"left",56.7), right = points(margin,"right",56.7);
  const top = points(margin,"top",50), bottom = points(margin,"bottom",50);
  const contentWidth = width-left-right;
  let page: PDFPage; let y = top;
  const newPage = () => { page = pdf.addPage([width,pageHeight]); y = top; };
  newPage();
  function layout(p: Element, available: number): Line[] {
    const props = child(p,"pPr"), space = child(props,"spacing");
    const align = attr(child(props,"jc"),"val") || "left";
    const before = points(space,"before"), after = points(space,"after");
    let tokens: Token[] = [], lineWidth = 0;
    const lines: Line[] = [];
    const push = () => {
      lines.push({tokens,height:Math.max(10,...tokens.map(t => t.size * 1.18)),before:0,after:0,align});
      tokens=[];lineWidth=0;
    };
    for (const run of descendants(p,"r")) {
      const pr = child(run,"rPr");
      const base = child(pr,"i") ? child(pr,"b") ? boldItalic! : italic! : child(pr,"b") ? bold! : regular!;
      const size = Number(attr(child(pr,"sz"),"val") || 20) / 2;
      const ink = attr(child(pr,"color"),"val") || "3A3A3B";
      const value = children(run).map(e => e.localName === "t" ? e.textContent ?? "" : e.localName === "br" ? "\n" : e.localName === "tab" ? "  " : "").join("");
      for (const part of value.split(/(\n|[^\S\n]+)/)) {
        if (!part) continue;
        if (part === "\n") { push(); continue; }
        let group = "", font = base;
        const emit = (s: string, f: PDFFont) => {
          if (!s) return;
          const w = f.widthOfTextAtSize(s,size);
          if (lineWidth + w > available && tokens.length && s.trim()) push();
          if (w > available) {
            for (const ch of s) {
              const cw=f.widthOfTextAtSize(ch,size);
              if (lineWidth+cw>available && tokens.length) push();
              tokens.push({text:ch,font:f,size,color:ink});lineWidth+=cw;
            }
          } else if (lineWidth || s.trim()) { tokens.push({text:s,font:f,size,color:ink});lineWidth+=w; }
        };
        for (const ch of part) {
          const cp=ch.codePointAt(0)!;
          const next=chars.get(base)!.has(cp) ? base : symbol!;
          const supported=chars.get(next)!.has(cp) ? ch : "□";
          if(next!==font) { emit(group,font);group="";font=next; }
          group+=supported;
        }
        emit(group,font);
      }
    }
    if(tokens.length || !lines.length) push();
    lines[0]!.before=before;lines.at(-1)!.after=after;
    return lines;
  }
  const drawLines = (lines: Line[], x: number, at: number, available: number) => {
    let pos=at;
    for(const line of lines) {
      pos+=line.before;
      const w=line.tokens.reduce((s,t) => s+t.font.widthOfTextAtSize(t.text,t.size),0);
      let xx=x+(line.align==="right" ? available-w : line.align==="center" ? (available-w)/2 : 0);
      for(const t of line.tokens) {
        page.drawText(t.text,{x:xx,y:pageHeight-pos-t.size,size:t.size,font:t.font,color:color(t.color)});
        xx+=t.font.widthOfTextAtSize(t.text,t.size);
      }
      pos+=line.height+line.after;
    }
  };
  function paragraph(p: Element) {
    const props=child(p,"pPr");
    if(child(props,"pageBreakBefore") && y>top) newPage();
    const lines=layout(p,contentWidth);
    // Keep section headings with the beginning of their next table.
    if(child(props,"keepNext") && y+height(lines)+45>pageHeight-bottom) newPage();
    for(const line of lines) {
      if(y+height([line])>pageHeight-bottom) newPage();
      drawLines([line],left,y,contentWidth);y+=height([line]);
    }
    const border=child(child(props,"pBdr"),"bottom");
    if(border) page.drawLine({start:{x:left,y:pageHeight-y+2},end:{x:width-right,y:pageHeight-y+2},thickness:Number(attr(border,"sz")||8)/8,color:color(attr(border,"color"))});
  }
  function table(table: Element) {
    const tableRows=children(table,"tr");
    const header=tableRows.find(r => child(child(r,"trPr"),"tblHeader"));
    const renderRow=(row: Element, repeat=false) => {
      const cells=children(row,"tc");
      const rawWidths=cells.map(c => points(child(child(c,"tcPr"),"tcW"),"w",100));
      const sum=rawWidths.reduce((s,w)=>s+w,0);
      const widths=rawWidths.map(w => w/sum*contentWidth);
      const prepared=cells.map((c,i) => {
        const pr=child(c,"tcPr"), mar=child(pr,"tcMar");
        const padding={left:points(child(mar,"left"),"w",5.5),right:points(child(mar,"right"),"w",5.5),top:points(child(mar,"top"),"w",3.5),bottom:points(child(mar,"bottom"),"w",3.5)};
        return {pr,padding,lines:children(c,"p").flatMap(p => layout(p,Math.max(10,widths[i]!-padding.left-padding.right)))};
      });
      const rowHeight=() => Math.max(...prepared.map(c => height(c.lines)+c.padding.top+c.padding.bottom),12);
      // Whole normal rows move together. Oversized cells flow across pages.
      if(y+rowHeight()>pageHeight-bottom && y>top && !repeat) {
        newPage();
        if(header && header!==row && height(prepared[0]!.lines)<pageHeight-top-bottom-70) renderRow(header,true);
      }
      while(prepared.some(c => c.lines.length)) {
        const available=pageHeight-bottom-y;
        if(available<35) {newPage();if(header&&header!==row)renderRow(header,true);continue;}
        const slices=prepared.map(c => {
          let used=c.padding.top+c.padding.bottom, count=0;
          while(count<c.lines.length && used+height([c.lines[count]!])<=available) {used+=height([c.lines[count]!]);count++;}
          return c.lines.splice(0,count);
        });
        const h=Math.max(...slices.map((ls,i)=>height(ls)+prepared[i]!.padding.top+prepared[i]!.padding.bottom),12);
        let x=left;
        cells.forEach((_,i) => {
          const cell=prepared[i]!, w=widths[i]!, bg=attr(child(cell.pr,"shd"),"fill");
          if(bg&&bg!=="auto")page.drawRectangle({x,y:pageHeight-y-h,width:w,height:h,color:color(bg)});
          const used=height(slices[i]!)+cell.padding.top+cell.padding.bottom;
          const center=attr(child(cell.pr,"vAlign"),"val")==="center" ? Math.max(0,(h-used)/2) : 0;
          drawLines(slices[i]!,x+cell.padding.left,y+cell.padding.top+center,w-cell.padding.left-cell.padding.right);
          for(const side of ["top","bottom","left","right"]) {
            const b=child(child(cell.pr,"tcBorders"),side);
            if(!b || ["none","nil",""].includes(attr(b,"val")))continue;
            const x1=side==="right"?x+w:x, x2=side==="left"?x:x+w;
            const yy=side==="bottom"?y+h:y;
            page.drawLine({start:{x:x1,y:pageHeight-yy},end:{x:x2,y:pageHeight-(side==="left"||side==="right"?y+h:yy)},thickness:Number(attr(b,"sz")||4)/8,color:color(attr(b,"color"))});
          }
          x+=w;
        });
        y+=h;
        if(prepared.some(c=>c.lines.length)) {newPage();if(header&&header!==row)renderRow(header,true);}
      }
    };
    for(const row of tableRows)renderRow(row);
  }
  for(const block of children(body)) {
    if(block.localName==="p")paragraph(block);
    if(block.localName==="tbl")table(block);
  }
  const pages=pdf.getPages();
  pages.forEach((p,i) => {
    p.drawLine({start:{x:left,y:bottom-12},end:{x:width-right,y:bottom-12},thickness:0.5,color:color("D9CCE8")});
    const foot=`Algihaz · QA/QC Monthly Metrics Report · ${month}`;
    p.drawText(foot,{x:left,y:bottom-24,size:8,font:regular,color:color("66666A")});
    const count=`Page ${i+1} of ${pages.length}`;
    p.drawText(count,{x:width-right-regular!.widthOfTextAtSize(count,8),y:bottom-24,size:8,font:regular,color:color("66666A")});
  });
  return Buffer.from(await pdf.save());
}
