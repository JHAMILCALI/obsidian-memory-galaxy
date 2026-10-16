import jost from "../fonts/jost-latin.woff2";
import cormorant from "../fonts/cormorant-garamond-latin.woff2";
import cormorantItalic from "../fonts/cormorant-garamond-italic-latin.woff2";

const FACES: Array<[family: string, source: string, descriptors: FontFaceDescriptors]> = [
  ["Astra Jost", jost, { weight: "300 600", style: "normal" }],
  ["Astra Cormorant", cormorant, { weight: "500 700", style: "normal" }],
  ["Astra Cormorant", cormorantItalic, { weight: "500 700", style: "italic" }]
];

/** Registers the bundled faces on a document (Obsidian popouts have their own) and returns a cleanup. */
export function registerFonts(doc: Document = document): () => void {
  const faces = FACES.map(([family, source, descriptors]) => new FontFace(family, `url(${source}) format("woff2")`, descriptors));
  for (const face of faces) {
    doc.fonts.add(face);
    face.load().catch((error) => console.warn("Astra Galaxy: no se pudo cargar la fuente", face.family, error));
  }
  return () => {
    for (const face of faces) doc.fonts.delete(face);
  };
}
