import sharp from "sharp";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import { strFromU8, strToU8 } from "fflate";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";

/** Add only internal PNG relationships; retain all original package parts and artwork. */
export function carSignatureWriter(files: Record<string, Uint8Array>, root: Element) {
  const parser = new DOMParser();
  const relationships = parser.parseFromString(strFromU8(files["word/_rels/document.xml.rels"]!), "application/xml");
  const types = parser.parseFromString(strFromU8(files["[Content_Types].xml"]!), "application/xml");
  // Header/footer artwork belongs to the same package; do not reuse its drawing IDs.
  const drawingIds = Object.entries(files).filter(([name]) => name.startsWith("word/") && name.endsWith(".xml"))
    .flatMap(([, bytes]) => Array.from(parser.parseFromString(strFromU8(bytes), "application/xml").getElementsByTagNameNS(WP, "docPr"))
      .map(n => Number(n.getAttribute("id")) || 0));
  let nextDrawing = Math.max(0, ...drawingIds);
  let changed = false;
  return {
    async insert(target: Element, input?: Uint8Array) {
      if (!input) return false;
      // Decode before touching the package so unavailable/corrupt images leave a factual placeholder.
      let bytes: Buffer, width: number, height: number;
      try {
        const image = await sharp(Buffer.from(input), { limitInputPixels: 16_000_000 })
          .rotate().resize({ width: 900, height: 240, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
        bytes = image.data; width = image.info.width; height = image.info.height;
      } catch { return false; }
      let index = 1;
      while (files[`word/media/car-signature-${index}.png`]
        || Array.from(relationships.documentElement!.childNodes).some(n => n.nodeType === 1 && (n as Element).getAttribute("Id") === `carSignature${index}`)) index++;
      const id = `carSignature${index}`, name = `car-signature-${index}.png`;
      files[`word/media/${name}`] = bytes;
      const relationship = relationships.createElementNS(REL, "Relationship");
      for (const [key, value] of Object.entries({ Id: id, Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", Target: `media/${name}` })) relationship.setAttribute(key, value);
      relationships.documentElement!.appendChild(relationship);
      if (!Array.from(types.getElementsByTagName("Default")).some(n => n.getAttribute("Extension") === "png")) {
        const type = types.createElementNS("http://schemas.openxmlformats.org/package/2006/content-types", "Default");
        type.setAttribute("Extension", "png"); type.setAttribute("ContentType", "image/png");
        types.documentElement!.appendChild(type);
      }
      const scale = Math.min(1_400_000 / width, 220_000 / height);
      const cx = Math.round(width * scale), cy = Math.round(height * scale), drawingId = ++nextDrawing;
      const fragment = parser.parseFromString(`<w:r xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${drawingId}" name="CAR signature ${drawingId}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, "application/xml");
      // Reuse the cell's empty paragraph, avoiding extra height and floating drawings.
      const paragraph = target.getElementsByTagNameNS(W, "p")[0]!;
      paragraph.appendChild(root.ownerDocument!.importNode(fragment.documentElement!, true));
      changed = true;
      return true;
    },
    finish() {
      if (!changed) return;
      const serialize = new XMLSerializer();
      files["word/_rels/document.xml.rels"] = strToU8(serialize.serializeToString(relationships));
      files["[Content_Types].xml"] = strToU8(serialize.serializeToString(types));
    },
  };
}
