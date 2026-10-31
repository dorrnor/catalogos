// Arma el PDF con los precios nuevos: parte siempre del PDF original, tapa cada precio
// cambiado con su mismo color de fondo y escribe el nuevo con el mismo color y tamaño.
import { PDFDocument, StandardFonts, rgb } from '../vendor/pdf-lib.esm.min.js';
import { formatPrice } from './util.js';

// Subir si cambia la forma de armar el PDF, para no reusar PDFs armados con la versión anterior.
export const BUILD_VERSION = 2;

export async function buildPdf(originalBytes, products) {
  const changed = products.filter((p) => p.price !== p.origPrice && p.draw);
  const doc = await PDFDocument.load(originalBytes, { ignoreEncryption: true, updateMetadata: false });
  const fonts = {
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    regular: await doc.embedFont(StandardFonts.Helvetica),
  };
  const pages = doc.getPages();
  for (const p of changed) {
    const page = pages[p.page];
    if (!page) continue;
    const d = p.draw;
    const c = p.cover;
    page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, color: rgb(...d.bg) });
    const font = d.bold ? fonts.bold : fonts.regular;
    const text = formatPrice(p.price, p.fmt);
    let size = d.size;
    let width = font.widthOfTextAtSize(text, size);
    if (width > d.maxW) {
      size *= d.maxW / width;
      width = d.maxW;
    }
    const x = d.align === 'center' ? d.cx - width / 2 : d.x0;
    page.drawText(text, { x, y: d.y, size, font, color: rgb(...d.color) });
  }

  // Los PDFs que ya fueron editados con otro programa tienen objetos con "generación"
  // distinta de 0, y pdf-lib los guarda con el índice interno mal armado. En ese caso se
  // copian las páginas a un PDF nuevo (queda igual, con los objetos renumerados).
  let out = doc;
  if (doc.context.enumerateIndirectObjects().some(([ref]) => ref.generationNumber !== 0)) {
    await doc.flush();
    out = await PDFDocument.create({ updateMetadata: false });
    const copied = await out.copyPages(doc, doc.getPageIndices());
    for (const p of copied) out.addPage(p);
  }
  // Sin "object streams": con esos mismos PDFs generan archivos que muchos lectores no abren.
  return out.save({ useObjectStreams: false });
}
