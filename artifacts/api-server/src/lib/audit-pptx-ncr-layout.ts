import type { Element } from "@xmldom/xmldom";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const NCR_HEADERS = ["Ref", "Date", "Finding", "Objective evidence", "Audit Area", "Grade"];
const WIDTHS = [2350000, 1450000, 2250000, 2100000, 1672472, 1269200];
const nodes = (node: Element, tag: string) => Array.from(node.getElementsByTagNameNS(A, tag));

/** Extend the original five-column artwork, preserving the shaded Grade cell. */
export function prepareNcrTable(table: Element, setText: (node: Element, value: string) => void) {
  const grid = nodes(table, "tblGrid")[0]!;
  const columns = nodes(grid, "gridCol");
  grid.insertBefore(columns[0]!.cloneNode(true), columns[1]!);
  nodes(grid, "gridCol").forEach((column, index) => column.setAttribute("w", String(WIDTHS[index])));
  nodes(table, "tr").forEach((row, index) => {
    const cells = nodes(row, "tc");
    row.insertBefore(cells[1]!.cloneNode(true), cells[1]!);
    if (index === 0) nodes(row, "tc").forEach((cell, col) => setText(cell, NCR_HEADERS[col]!));
    if (index === 1) {
      // The category band is uniform; only actual finding grades are shaded.
      const last = cells.at(-1)!, props = nodes(last, "tcPr")[0]!;
      last.replaceChild(nodes(cells.at(-2)!, "tcPr")[0]!.cloneNode(true), props);
    }
  });
}
