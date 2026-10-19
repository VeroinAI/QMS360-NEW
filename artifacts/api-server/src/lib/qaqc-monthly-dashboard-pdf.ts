import { DOMParser, type Element } from "@xmldom/xmldom";
import { posix } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFName, PDFString, type PDFFont, type PDFPage, rgb, degrees } from "pdf-lib";
import type { QaqcReportExport } from "./qaqc-reporting-export";
import { monthlyAsset, UNMAPPED } from "./qaqc-monthly-report-template";
import { monthlyDashboardData, type DashboardChart } from "./qaqc-monthly-dashboard-data";

// Render the supplied presentation's named shapes and native chart frames directly.
// All coordinates, card fills, typography sizes and chart orientations come from its OOXML.
const els = (e?: Element, name?: string): Element[] => e ? Array.from(e.childNodes).filter((n): n is Element => n.nodeType === 1 && (!name || n.localName === name)) : [];
const one = (e: Element | undefined, name: string) => els(e, name)[0];
const all = (e: Element, name: string) => Array.from(e.getElementsByTagName("*")).filter(n => n.localName === name);
const a = (e: Element | undefined, name: string, fallback = "") => e?.getAttribute(name) || fallback;
const emu = (s: string) => Number(s || 0) / 12700;
const ink = (hex: string) => rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
type Box = { x: number; y: number; w: number; h: number };
const box = (xf?: Element): Box => ({ x: emu(a(one(xf, "off"), "x")), y: emu(a(one(xf, "off"), "y")), w: emu(a(one(xf, "ext"), "cx")), h: emu(a(one(xf, "ext"), "cy")) });
const palette = ["06AEBB", "EB9823", "D58BCB", "A43C96", "582C83", "BBA9D2"];

export async function exportMonthlyDashboardPdf(report: QaqcReportExport): Promise<Buffer> {
  return exportPresentationDashboardPdf({
    mapped: monthlyDashboardData(report), template: "qaqc-monthly-dashboard-template.pptx", pages: 5,
    title: `QA/QC Monthly Dashboard — ${report.projectName ?? UNMAPPED} — ${report.period}`,
    footer: "Algihaz · QA/QC Monthly Dashboard", kind: "monthly",
  });
}

export type PresentationDashboard = {
  values: Record<string, string>; tones: Record<string, string>; charts: Record<number, DashboardChart>;
  tables?: Record<string, { rows: string[][]; tones?: Record<string, string> }>;
  links?: Record<string, string>;
  statusMismatch?: boolean;
};

/** Shared OOXML renderer; monthly and daily mappings stay independent. */
export async function exportPresentationDashboardPdf(options: {
  mapped: PresentationDashboard; template: string; pages: number; title: string; footer: string; kind: "monthly" | "daily";
}): Promise<Buffer> {
  const { mapped } = options;
  const daily = options.kind === "daily";
  const files = unzipSync(await monthlyAsset(options.template));
  const parse = (name: string) => {
    if (!files[name]) throw new Error(`Monthly dashboard template part missing: ${name}`);
    return new DOMParser().parseFromString(strFromU8(files[name]!), "application/xml").documentElement!;
  };
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(options.title);
  pdf.setAuthor("QMS360"); pdf.setSubject("Monthly QA/QC dashboard");
  const [normal, bold, symbols] = await Promise.all(["Carlito-Regular.ttf", "Carlito-Bold.ttf", "DejaVuSans.ttf"].map(async name =>
    pdf.embedFont(await monthlyAsset(name), { subset: false, features: { liga: false, clig: false, kern: false } })));
  const theme: Record<string, string> = {};
  for (const e of els(all(parse("ppt/theme/theme1.xml"), "clrScheme")[0])) theme[e.localName!] = a(els(e)[0], "val", a(els(e)[0], "lastClr", "3A3A3B"));
  Object.assign(theme, { bg1: theme.lt1, bg2: theme.lt2, tx1: theme.dk1, tx2: theme.dk2 });
  const fill = (e?: Element) => {
    const solid = one(e, "solidFill"), color = els(solid)[0];
    if (!color) return undefined;
    return { hex: color.localName === "srgbClr" ? a(color, "val") : theme[a(color, "val")] || "3A3A3B", opacity: Number(a(one(color, "alpha"), "val", "100000")) / 100000 };
  };
  const sizes = one(parse("ppt/presentation.xml"), "sldSz");
  const width = emu(a(sizes, "cx")), height = emu(a(sizes, "cy"));
  const charsets = new Map([normal!, bold!, symbols!].map(f => [f, new Set(f.getCharacterSet())]));
  function segments(value: string, font: PDFFont) {
    const result: { text: string; font: PDFFont }[] = [];
    for (const ch of value) {
      const selected = charsets.get(font)!.has(ch.codePointAt(0)!) ? font : symbols!;
      const safe = charsets.get(selected)!.has(ch.codePointAt(0)!) ? ch : "□";
      const last = result.at(-1);
      if (last?.font === selected) last.text += safe; else result.push({ text: safe, font: selected });
    }
    return result;
  }
  const measure = (s: string, size: number, font: PDFFont) => segments(s, font).reduce((n, r) => n + r.font.widthOfTextAtSize(r.text, size), 0);
  function text(page: PDFPage, value: string, b: Box, size = 12, color = "3A3A3B", isBold = false, align = "l", anchor = "t") {
    if (!value || b.w <= 0 || b.h <= 0) return;
    const font = isBold ? bold! : normal!;
    function wrap(atSize: number) {
      const lines: string[] = [];
      for (const para of value.replace(/\r/g, "").split("\n")) {
        let line = "";
        for (const word of para.split(/\s+/).filter(Boolean)) {
          const next = line ? `${line} ${word}` : word;
          if (measure(next, atSize, font) > b.w && line) { lines.push(line); line = word; } else line = next;
          while (measure(line, atSize, font) > b.w && line.length > 1) {
            let end = line.length - 1;
            while (end > 1 && measure(line.slice(0, end), atSize, font) > b.w) end--;
            lines.push(line.slice(0, end)); line = line.slice(end);
          }
        }
        lines.push(line);
      }
      return lines;
    }
    let lines = wrap(size);
    const min = Math.min(size, value === UNMAPPED ? 9 : 7);
    while (size > min && lines.length * size * 1.12 > b.h) { size = Math.max(min, size - .5); lines = wrap(size); }
    const maxLines = Math.max(1, Math.floor(b.h / (size * 1.12)));
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      let last = lines.at(-1)!;
      while (last.length && measure(`${last}…`, size, font) > b.w) last = last.slice(0, -1);
      lines[lines.length - 1] = `${last}…`;
    }
    let y = b.y + (anchor === "ctr" ? Math.max(0, (b.h - lines.length * size * 1.12) / 2) : 0);
    for (const line of lines) {
      let x = b.x + (align === "ctr" ? (b.w - measure(line, size, font)) / 2 : align === "r" ? b.w - measure(line, size, font) : 0);
      for (const run of segments(line, font)) {
        page.drawText(run.text, { x, y: height - y - size * .83, size, font: run.font, color: ink(color) });
        x += run.font.widthOfTextAtSize(run.text, size);
      }
      y += size * 1.12;
    }
  }
  const rect = (page: PDFPage, b: Box, hex: string, opacity = 1) => page.drawRectangle({ x: b.x, y: height - b.y - b.h, width: b.w, height: b.h, color: ink(hex), opacity });

  function chart(page: PDFPage, b: Box, model: DashboardChart, template: Element, index: number) {
    if (model.hide) { text(page, model.hide, b, 14, "66666A", false, "ctr", "ctr"); return; }
    if (!model.categories.length || !model.series.length || model.series.every(s => s.values.every(v => v === null))) {
      text(page, !daily && index === 10 ? "No manpower rows added" : UNMAPPED, b, model.compact ? 9 : 14, "66666A", false, "ctr", "ctr"); return;
    }
    if (all(template, "doughnutChart").length) {
      const values = model.series[0]!.values;
      if (values.some(v => v === null || v < 0)) {
        text(page, values.some(v => v !== null && v < 0) ? "Negative change — see signed figures" : UNMAPPED, b, 9, "66666A", false, "ctr", "ctr");
        return;
      }
      const total = values.reduce<number>((s, v) => s + Math.max(0, v ?? 0), 0);
      const radius = Math.min(b.w, b.h) * .44, cx = b.x + b.w / 2, cy = height - b.y - b.h / 2;
      if (!total) page.drawCircle({ x: cx, y: cy, size: radius, borderColor: ink("E7DFEF"), borderWidth: radius * .28 });
      let angle = -Math.PI / 2;
      values.forEach((value, i) => {
        const arc = (Math.max(0, value ?? 0) / (total || 1)) * Math.PI * 2;
        const steps = Math.max(1, Math.ceil(arc * 36));
        const points = Array.from({ length: steps + 1 }, (_, j) => {
          const t = angle + arc * j / steps; return `${Math.cos(t) * radius},${Math.sin(t) * radius}`;
        });
        if (arc) page.drawSvgPath(`M0,0 L${points.join(" L")} Z`, { x: cx, y: cy, color: ink(model.pointColors?.[i] ?? (!daily && index === 2 ? i === 0 ? "582C83" : "E7DFEF" : palette[i % palette.length]!)) });
        angle += arc;
      });
      page.drawCircle({ x: cx, y: cy, size: radius * .72, color: ink("FFFFFF") });
      return;
    }
    const horizontal = a(all(template, "barDir")[0], "val") === "bar";
    const stacked = a(all(template, "grouping")[0], "val") === "stacked";
    const compact = !!model.compact;
    const legendH = model.series.length > 1 ? 28 : compact ? 0 : 12;
    const labelW = horizontal ? Math.min(!daily && index === 10 ? 130 : daily && [9, 14].includes(index) ? 130 : 80, b.w * .48) : compact ? 0 : 28;
    const plot = { x: b.x + labelW, y: b.y + (compact ? 0 : 9), w: b.w - labelW - (compact ? 4 : 22), h: Math.max(12, b.h - legendH - (compact ? 13 : 32)) };
    const values = model.categories.map((_, i) => stacked ? model.series.reduce((s, r) => s + (r.values[i] ?? 0), 0) : Math.max(...model.series.map(s => s.values[i] ?? 0)));
    const rawStep = Math.max(1, ...values) * 1.08 / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const nice = [1, 2, 2.5, 5, 10].find(v => v * magnitude >= rawStep) ?? 10;
    const max = !daily && index === 1 ? Math.max(100, ...values) : (!daily && index === 9 || model.percent ? nice * magnitude : Math.max(1, Math.ceil(nice * magnitude))) * 4;
    const min = model.signed ? Math.min(0, ...model.series.flatMap(s => s.values.map(v => v ?? 0))) : 0;
    const scale = (v: number) => (v - min) / (max - min);
    const zero = scale(0);
    for (let j = 0; j <= 4; j++) {
      const v = min + (max - min) * j / 4;
      if (compact) continue;
      if (horizontal) {
        const x = plot.x + plot.w * j / 4;
        page.drawLine({ start: { x, y: height - plot.y }, end: { x, y: height - plot.y - plot.h }, color: ink("E6E0EB"), thickness: .5 });
        text(page, `${Number(v.toFixed(1))}${model.percent ? "%" : ""}`, { x: x - 14, y: plot.y + plot.h + 3, w: 28, h: 10 }, 8, "66666A", false, "ctr");
      } else {
        const y = plot.y + plot.h - plot.h * j / 4;
        page.drawLine({ start: { x: plot.x, y: height - y }, end: { x: plot.x + plot.w, y: height - y }, color: ink("E6E0EB"), thickness: .5 });
        text(page, `${Number(v.toFixed(1))}${model.percent ? "%" : ""}`, { x: b.x, y: y - 4, w: labelW - 4, h: 10 }, 8, "66666A", false, "r");
      }
    }
    const step = (horizontal ? plot.h : plot.w) / model.categories.length;
    model.categories.forEach((label, i) => {
      if (horizontal) text(page, label, { x: b.x, y: plot.y + step * i, w: labelW - 6, h: step }, compact ? 7 : 10, "66666A", false, "r", "ctr");
      else text(page, label, { x: plot.x + step * i, y: plot.y + plot.h + (compact ? 1 : 5), w: step, h: compact ? 12 : 15 }, compact ? 5 : 9, "66666A", false, "ctr");
      let offset = 0;
      const thickness = step * .65 / (stacked ? 1 : model.series.length);
      model.series.forEach((s, j) => {
        const value = s.values[i];
        const length = Math.abs((value ?? 0) / (max - min)) * (horizontal ? plot.w : plot.h);
        const gap = step * .175;
        const r = horizontal
          ? { x: plot.x + plot.w * zero + offset - ((value ?? 0) < 0 ? length : 0), y: plot.y + step * i + gap + (stacked ? 0 : j * thickness), w: length, h: Math.max(.5, thickness - (stacked ? 0 : 1)) }
          : { x: plot.x + step * i + gap + (stacked ? 0 : j * thickness), y: plot.y + plot.h * (1 - zero) - ((value ?? 0) >= 0 ? length : 0) - offset, w: Math.max(.5, thickness - 1), h: length };
        if (value !== null && length > 0) rect(page, r, model.pointColors?.[i] ?? s.color);
        const labelValue = value === null ? "—" : `${model.signed && value > 0 ? "+" : ""}${model.percent ? value.toFixed(1) : Number(value.toFixed(1))}${model.percent ? "%" : ""}`;
        if (!model.hideLabels && !(model.hideZeroLabels && value === 0) && (!stacked || length > (daily ? 10 : 24))) text(page, labelValue, horizontal
          ? { x: r.x + (stacked ? 2 : r.w + 3), y: r.y, w: stacked ? r.w - 2 : 28, h: r.h }
          : { x: r.x - 4, y: stacked ? r.y + (r.h - 11) / 2 : (value ?? 0) < 0 ? r.y + r.h : r.y - (compact ? 8 : 12), w: r.w + 8, h: compact ? 8 : 11 }, compact ? 5 : 8, stacked ? "FFFFFF" : "3A3A3B", true, horizontal ? "l" : "ctr", "ctr");
        if (stacked) offset += length;
      });
    });
    if (model.series.length > 1) {
      const itemWidth = b.w / model.series.length;
      model.series.forEach((s, j) => {
        const x = b.x + itemWidth * j;
        rect(page, { x, y: b.y + b.h - 10, w: 7, h: 7 }, s.color);
        text(page, s.name, { x: x + 10, y: b.y + b.h - 12, w: itemWidth - 12, h: 18 }, 9, "66666A");
      });
    }
  }
  for (let index = 1; index <= options.pages; index++) {
    const page = pdf.addPage([width, height]);
    rect(page, { x: 0, y: 0, w: width, h: height }, "F3EFF7");
    const slide = parse(`ppt/slides/slide${index}.xml`);
    const relationships: Record<string, string> = {};
    for (const r of els(parse(`ppt/slides/_rels/slide${index}.xml.rels`))) relationships[a(r, "Id")] = a(r, "Target");
    for (const shape of els(one(one(slide, "cSld"), "spTree"))) {
      if (shape.localName === "sp") {
        const name = a(all(shape, "cNvPr")[0], "name");
        const props = one(shape, "spPr"), b = box(one(props, "xfrm")), solid = fill(props);
        if (solid) {
          const round = a(one(props, "prstGeom"), "prst") === "roundRect";
          if (round) {
            const r = Math.min(7, b.h / 2, b.w / 2);
            page.drawSvgPath(`M${r},0 H${b.w-r} Q${b.w},0 ${b.w},${r} V${b.h-r} Q${b.w},${b.h} ${b.w-r},${b.h} H${r} Q0,${b.h} 0,${b.h-r} V${r} Q0,0 ${r},0 Z`, { x: b.x, y: height - b.y, color: ink(solid.hex), opacity: solid.opacity });
          } else if (a(one(props, "prstGeom"), "prst") === "ellipse") page.drawEllipse({ x: b.x + b.w/2, y: height - b.y - b.h/2, xScale: b.w/2, yScale: b.h/2, color: ink(solid.hex), opacity: solid.opacity });
          else rect(page, b, solid.hex, solid.opacity);
        }
        const tx = one(shape, "txBody");
        if (!tx) continue;
        const runs = all(tx, "r"), runProps = one(runs[0], "rPr"), paras = els(tx, "p");
        const original = paras.map(p => all(p, "t").map(t => t.textContent ?? "").join("")).join("\n");
        const value = Object.prototype.hasOwnProperty.call(mapped.values, name) ? mapped.values[name]! : original;
        const style = fill(runProps);
        const body = one(tx, "bodyPr");
        const textBox = { x: b.x + emu(a(body, "lIns")), y: b.y + emu(a(body, "tIns")), w: b.w - emu(a(body, "lIns")) - emu(a(body, "rIns")), h: b.h - emu(a(body, "tIns")) - emu(a(body, "bIns")) };
        const hex = mapped.tones[name] || style?.hex || "3A3A3B";
        if (daily && name === "Report date") {
          const lines = value.split("\n");
          const styles = paras.map(p => one(all(p, "r")[0], "rPr"));
          const sizes = styles.map(p => Number(a(p, "sz", "1200")) / 100);
          let y = textBox.y + Math.max(0, (textBox.h - sizes.reduce((n, s) => n + s * 1.2, 0)) / 2);
          lines.forEach((line, i) => {
            const size = sizes[i] ?? 12, p = styles[i];
            text(page, line, { x: textBox.x, y, w: textBox.w, h: size * 1.2 }, size, fill(p)?.hex ?? hex, a(p, "b") === "1", "ctr");
            y += size * 1.2;
          });
        } else if (a(body, "vert") === "vert270") {
          const font = a(runProps, "b") === "1" ? bold! : normal!;
          let size = Number(a(runProps, "sz", "1200")) / 100;
          while (size > 6 && measure(value, size, font) > b.h - 4) size -= .5;
          page.drawText(value, { x: b.x + b.w / 2 + size * .35, y: height - b.y - b.h / 2 - measure(value, size, font) / 2, font, size, color: ink(hex), rotate: degrees(90) });
        } else text(page, value, textBox, Number(a(runProps, "sz", "1200"))/100, hex, a(runProps, "b") === "1", a(one(paras[0], "pPr"), "algn", "l"), a(body, "anchor", "t"));
        const href = mapped.links?.[name];
        if (href && /^https?:\/\//.test(href)) {
          page.node.addAnnot(pdf.context.register(pdf.context.obj({
            Type: "Annot", Subtype: "Link", Rect: [b.x, height - b.y - b.h, b.x + b.w, height - b.y],
            Border: [0, 0, 0], A: { S: PDFName.of("URI"), URI: PDFString.of(href) },
          })));
        }
      } else if (shape.localName === "graphicFrame") {
        const table = all(shape, "tbl")[0];
        if (table) {
          const name = a(all(shape, "cNvPr")[0], "name"), model = mapped.tables?.[name];
          if (!model) throw new Error(`Unmapped dashboard table: ${name}`);
          const b = box(one(shape, "xfrm")), columns = els(one(table, "tblGrid"), "gridCol").map(c => emu(a(c, "w")));
          let y = b.y;
          els(table, "tr").forEach((row, r) => {
            const h = emu(a(row, "h"));
            let x = b.x;
            els(row, "tc").forEach((cell, col) => {
              const cp = one(cell, "tcPr"), tx = one(cell, "txBody"), rp = all(tx!, "rPr")[0], p = one(tx, "p");
              const w = columns[col]!, background = fill(cp), color = model.tones?.[`${r}:${col}`] ?? fill(rp)?.hex ?? "3A3A3B";
              if (background) rect(page, { x, y, w, h }, background.hex);
              text(page, model.rows[r]?.[col] ?? UNMAPPED, { x: x + 4, y: y + 3, w: Math.max(1, w - 8), h: Math.max(1, h - 6) }, Number(a(rp, "sz", "1000"))/100, color, a(rp, "b") === "1", a(one(p, "pPr"), "algn", "l"), "ctr");
              x += w;
            });
            y += h;
          });
          continue;
        }
        const chartRef = all(shape, "chart")[0];
        if (!chartRef) continue;
        const rel = chartRef.getAttribute("r:id") || "";
        const target = relationships[rel];
        if (!target) throw new Error(`Monthly dashboard chart relationship missing: ${rel}`);
        const path = posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join("ppt/slides", target));
        const id = Number(/chart(\d+)\.xml/.exec(path)?.[1]);
        if (!mapped.charts[id]) throw new Error(`Unmapped monthly dashboard chart ${id}`);
        chart(page, box(one(shape, "xfrm")), mapped.charts[id]!, parse(path), id);
      } else if (shape.localName === "pic") {
        const blip = all(shape, "blip")[0];
        const target = relationships[blip?.getAttribute("r:embed") || ""];
        if (!target) throw new Error("Monthly dashboard image relationship missing");
        const path = posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join("ppt/slides", target));
        if (!files[path]) throw new Error(`Monthly dashboard image missing: ${path}`);
        const image = await pdf.embedPng(files[path]!);
        const b = box(one(one(shape, "spPr"), "xfrm"));
        page.drawImage(image, { x: b.x, y: height - b.y - b.h, width: b.w, height: b.h });
      }
    }
    text(page, options.footer, { x: 36, y: height - 23, w: width - 100, h: 14 }, 9, "66666A");
    if (index === 3 && mapped.statusMismatch) text(page, "Status tags total differs from total items", { x: 36, y: height - 42, w: width - 72, h: 14 }, 10, "C0392B", true);
  }
  return Buffer.from(await pdf.save());
}
