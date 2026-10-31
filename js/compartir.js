// Armar el PDF con los precios nuevos y compartirlo (WhatsApp, Estado, mail, etc.)
// usando el menú de compartir del celular.
import * as db from './db.js';
import { buildPdf, BUILD_VERSION } from './build.js';
import { openPdf, renderPage, canvasToBlob, scaleForWidth } from './pdfjs.js';
import { I, openSheet, snack } from './ui.js';
import { esc, nextFrame, fmtSize, download } from './util.js';

export async function getOutputBlob(pdf) {
  const fresh = await db.get('pdfs', pdf.id);
  const file = await db.get('files', pdf.id);
  if (!fresh.changedCount) return file.blob;
  const cached = await db.get('outputs', pdf.id);
  if (cached && cached.rev === fresh.rev && cached.build === BUILD_VERSION) return cached.blob;
  const products = await db.productsOf(pdf.id);
  const bytes = await buildPdf(await file.blob.arrayBuffer(), products);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  await db.put('outputs', { id: pdf.id, rev: fresh.rev, build: BUILD_VERSION, blob });
  return blob;
}

const baseName = (pdf) => pdf.fileName.replace(/\.pdf$/i, '');

export function openShareSheet(pdfs) {
  if (!pdfs.length) return;
  const one = pdfs.length === 1;
  const pages = pdfs.reduce((s, p) => s + p.pageCount, 0);
  const sheet = openSheet(`
    <h2>Compartir ${one ? 'catálogo' : `${pdfs.length} catálogos`}</h2>
    <p class="sheet-sub">${esc(pdfs.map((p) => p.name).join(' · '))}</p>
    <button class="option" data-mode="pdf">
      <span class="option-icon">${I.file}</span>
      <span><b>Como PDF</b><small>Para mandarlo a clientes por WhatsApp, mail o donde quieras.</small></span>
    </button>
    <button class="option" data-mode="img">
      <span class="option-icon">${I.image}</span>
      <span><b>Como imágenes</b><small>Una foto por página (${pages} en total). Sirve para el <b>Estado de WhatsApp</b>, que no acepta PDF.</small></span>
    </button>
    ${one && pdfs[0].pageCount > 1 ? `
    <div class="range" id="range">
      <span>Páginas para las imágenes:</span>
      <input type="number" id="from" min="1" max="${pdfs[0].pageCount}" value="1" inputmode="numeric"> a
      <input type="number" id="to" min="1" max="${pdfs[0].pageCount}" value="${pdfs[0].pageCount}" inputmode="numeric">
    </div>` : ''}
    <div class="sheet-actions"><button class="btn-secondary" data-close>Cancelar</button></div>`);

  sheet.el.addEventListener('click', async (e) => {
    const b = e.target.closest('.option[data-mode]');
    if (!b) return;
    let range = null;
    if (b.dataset.mode === 'img' && one && pdfs[0].pageCount > 1) {
      const max = pdfs[0].pageCount;
      const from = Math.min(max, Math.max(1, Number(sheet.el.querySelector('#from').value) || 1));
      const to = Math.min(max, Math.max(from, Number(sheet.el.querySelector('#to').value) || max));
      range = [from, to];
    }
    await prepareShare(sheet, pdfs, b.dataset.mode, range);
  });
}

// Prepara los archivos dentro de una ventana ya abierta y deja el botón "Compartir ahora"
// (compartir tiene que salir de un toque, y armar los archivos puede tardar).
export async function prepareShare(sheet, pdfs, mode, range, hint) {
  sheet.locked = true;
  sheet.set(`
    <h2>Preparando…</h2>
    <p class="sheet-sub" id="sh-step"></p>
    <div class="progress"><div id="sh-bar"></div></div>`);
  const step = (text, frac) => {
    if (sheet.closed) return;
    sheet.el.querySelector('#sh-step').textContent = text;
    sheet.el.querySelector('#sh-bar').style.width = `${Math.round(frac * 100)}%`;
  };
  const files = [];
  try {
    for (const [i, pdf] of pdfs.entries()) {
      step(`Armando ${pdf.name} con los precios nuevos…`, i / pdfs.length);
      await nextFrame();
      const blob = await getOutputBlob(pdf);
      if (mode === 'pdf') {
        files.push(new File([blob], pdf.fileName, { type: 'application/pdf' }));
        continue;
      }
      const doc = await openPdf(await blob.arrayBuffer());
      const [from, to] = range || [1, doc.numPages];
      for (let n = from; n <= to; n++) {
        if (sheet.closed) { doc.destroy(); return; }
        step(`${pdf.name}: página ${n} de ${to}`, (i + (n - from + 1) / (to - from + 1)) / pdfs.length);
        const page = await doc.getPage(n);
        const { canvas } = await renderPage(page, scaleForWidth(page, 1240));
        const img = await canvasToBlob(canvas, 'image/jpeg', 0.86);
        files.push(new File([img], `${baseName(pdf)}_pag${String(n).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
        page.cleanup();
      }
      doc.destroy();
    }
  } catch (err) {
    console.error(err);
    sheet.locked = false;
    sheet.set(`<h2>No se pudo preparar</h2><p class="sheet-sub">${esc(err.message || String(err))}</p>
      <div class="sheet-actions"><button class="btn-primary" data-close>Cerrar</button></div>`);
    return;
  }
  if (sheet.closed) return;
  sheet.locked = false;

  const total = files.reduce((s, f) => s + f.size, 0);
  const canShare = !!navigator.canShare && navigator.canShare({ files });
  const what = mode === 'pdf' ? (files.length === 1 ? '1 PDF' : `${files.length} PDFs`) : `${files.length} ${files.length === 1 ? 'imagen' : 'imágenes'}`;
  sheet.set(`
    <div class="ready">${I.check}<div><b>Listo: ${what}</b><span>${fmtSize(total)}</span></div></div>
    ${canShare ? `
      <button class="btn-share" id="go-share">${I.share}Compartir ahora</button>
      <p class="hint">${hint || `Se abre el menú de compartir: elegí <b>WhatsApp</b> y después los contactos o grupos que quieras${mode === 'img' ? ', o <b>Mi estado</b>' : ''}.`}</p>` : `
      <button class="btn-share" id="go-download">${I.download}Descargar</button>
      <p class="hint">Este navegador no deja compartir directo. Se descargan y los mandás desde WhatsApp eligiéndolos de Descargas.</p>`}
    <div class="sheet-actions"><button class="btn-secondary" data-close>Cerrar</button></div>`);
  sheet.el.querySelector('#go-share')?.addEventListener('click', async () => {
    try {
      await navigator.share({ files });
    } catch (err) {
      if (err.name !== 'AbortError') snack(`No se pudo compartir: ${err.message}`);
    }
  });
  sheet.el.querySelector('#go-download')?.addEventListener('click', () => {
    files.forEach((f, i) => setTimeout(() => download(f, f.name), i * 400));
  });
}
