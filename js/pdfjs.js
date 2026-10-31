// Lectura y dibujo de PDFs con pdf.js (incluido en la app, funciona sin internet).
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
const STANDARD_FONTS = new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href;

// pdf.js se queda con el buffer que recibe, por eso le pasamos una copia.
export function openPdf(bytes) {
  return pdfjsLib.getDocument({
    data: new Uint8Array(bytes.slice(0)),
    standardFontDataUrl: STANDARD_FONTS,
    isEvalSupported: false,
  }).promise;
}

// intent 'print' dibuja aunque la app esté en segundo plano (con 'display' pdf.js espera a
// que la pantalla esté visible). 'display' solo para el visor.
export async function renderPage(page, scale, intent = 'print') {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, intent }).promise;
  return { canvas, ctx, viewport };
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.85) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Escala para que la página quede de cierto ancho en píxeles.
export function scaleForWidth(page, width) {
  return width / page.getViewport({ scale: 1 }).width;
}
