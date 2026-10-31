import * as db from './db.js';
import { analyzePdf } from './analyze.js';
import { buildPdf, BUILD_VERSION } from './build.js';
import { openPdf, renderPage, canvasToBlob, scaleForWidth } from './pdfjs.js';
import {
  esc, uid, nextFrame, plural, formatPrice, money, parseUserNumber, adjustPrice, ADJUST_MODES,
  timeAgo, daysSince, fmtDate, fmtDateTime, fmtSize, prettyName, normalize, download,
} from './util.js';

const ico = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const I = {
  back: ico('M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z'),
  close: ico('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'),
  check: ico('M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'),
  add: ico('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'),
  share: ico('M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z'),
  trash: ico('M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'),
  search: ico('M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'),
  eye: ico('M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z'),
  tag: ico('M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z'),
  undo: ico('M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z'),
  file: ico('M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z'),
  image: ico('M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z'),
  download: ico('M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z'),
  selectAll: ico('M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z'),
  clock: ico('M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z'),
  warn: ico('M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z'),
  edit: ico('M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'),
};

const app = document.getElementById('app');
const state = {
  view: 'home',
  pdfs: [],
  pdf: null,
  products: [],
  search: '',
  filter: 'all',
  selecting: false,
  selected: new Set(),
};

// ---------------------------------------------------------------------------
// Navegación. El botón "atrás" del celular cierra primero lo que esté abierto
// (ventanas, modo elegir) y después vuelve a la pantalla anterior.

const layers = [];
let pendingPops = 0;

function pushLayer(close) {
  layers.push(close);
  history.pushState({ layer: layers.length }, '');
}

function popLayers(n = 1) {
  n = Math.min(n, layers.length);
  if (!n) return;
  pendingPops += n;
  history.go(-n);
}

window.addEventListener('popstate', () => {
  if (layers.length) {
    let n = Math.max(1, pendingPops);
    pendingPops = 0;
    while (n-- > 0 && layers.length) layers.pop()();
    return;
  }
  pendingPops = 0;
  route();
});

function go(hash) {
  history.pushState({ fromHome: true }, '', hash);
  route();
}

function goBack() {
  if (state.selecting) exitSelection();
  else if (history.state?.fromHome) history.back();
  else {
    history.replaceState(null, '', '#/');
    route();
  }
}

async function route() {
  state.selecting = false;
  state.selected.clear();
  const m = location.hash.match(/^#\/pdf\/(.+)$/);
  if (m) {
    const pdf = await db.get('pdfs', decodeURIComponent(m[1]));
    if (pdf) {
      if (state.pdf?.id !== pdf.id) { state.search = ''; state.filter = 'all'; }
      state.pdf = pdf;
      state.products = await db.productsOf(pdf.id);
      state.view = 'pdf';
      renderPdf();
      return;
    }
    history.replaceState(null, '', '#/');
  }
  state.view = 'home';
  state.pdf = null;
  await renderHome();
}

// ---------------------------------------------------------------------------
// Estado de precios ("hace cuánto no se actualiza")

function pdfStatus(pdf) {
  if (!pdf.productCount) {
    return { cls: 'none', title: 'Sin precios para editar', sub: 'No encontré precios escritos en este PDF. Se puede compartir igual.' };
  }
  if (!pdf.lastPriceUpdate) {
    return {
      cls: 'orig', title: 'Nunca actualizado',
      sub: `Tiene los precios originales del PDF${pdf.fileDate ? ` (archivo del ${fmtDate(pdf.fileDate)})` : ''}`,
    };
  }
  if (!pdf.changedCount) {
    return { cls: 'orig', title: 'Precios originales', sub: `Se volvió a los precios del PDF ${timeAgo(pdf.lastPriceUpdate)} (${fmtDate(pdf.lastPriceUpdate)})` };
  }
  const days = daysSince(pdf.lastPriceUpdate);
  const cls = days <= 15 ? 'fresh' : days <= 45 ? 'aging' : 'old';
  return {
    cls,
    title: `Actualizado ${timeAgo(pdf.lastPriceUpdate)}`,
    sub: `Última vez: ${fmtDateTime(pdf.lastPriceUpdate)} · ${pdf.changedCount} de ${pdf.productCount} precios cambiados`,
  };
}

const statusBadge = (st) => `<div class="status ${st.cls}"><span class="dot"></span><b>${esc(st.title)}</b></div>`;

// ---------------------------------------------------------------------------
// Pantalla principal: lista de catálogos

async function renderHome() {
  state.pdfs = (await db.getAll('pdfs')).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const n = state.pdfs.length;
  app.innerHTML = `
    <header class="appbar">
      <div class="appbar-main">
        <div class="brand">
          <div class="brand-title">Catálogos</div>
          <div class="brand-sub">Los Patricios · ${n} ${n === 1 ? 'PDF' : 'PDFs'}</div>
        </div>
        ${n ? `<button class="btn-ghost" data-act="select">${I.check}<span>Elegir</span></button>` : ''}
      </div>
    </header>
    <main class="content">
      ${n ? `<p class="hint">Tocá un catálogo para ver y cambiar sus precios. Para elegir varios, <b>mantené apretado</b> o tocá la portada.</p>` : ''}
      <div class="pdf-grid" id="list">${state.pdfs.map(pdfCard).join('')}</div>
      ${n ? '' : `
        <div class="empty">
          <div class="empty-icon">${I.file}</div>
          <h2>Todavía no hay catálogos</h2>
          <p>Tocá <b>Agregar PDF</b> y elegí los catálogos que tengas en el celular (podés elegir varios a la vez).</p>
        </div>`}
      <p class="storage" id="storage"></p>
    </main>
    <button class="fab" data-act="add">${I.add}<span>Agregar PDF</span></button>
    <input type="file" id="file-input" accept="application/pdf,.pdf" multiple hidden>
    <div class="selbar" id="selbar" hidden></div>
  `;
  bindList();
  showStorage();
}

function pdfCard(pdf) {
  const st = pdfStatus(pdf);
  return `
    <article class="pdf-card" data-id="${esc(pdf.id)}" tabindex="0">
      <div class="pdf-cover" data-pick>
        ${pdf.cover ? `<img src="${pdf.cover}" alt="">` : `<div class="cover-ph">${I.file}</div>`}
        <span class="check">${I.check}</span>
      </div>
      <div class="pdf-info">
        <h3>${esc(pdf.name)}</h3>
        <div class="meta">${plural(pdf.productCount, 'producto', 'productos')} · ${plural(pdf.pageCount, 'pág', 'págs')} · ${fmtSize(pdf.size)}</div>
        ${statusBadge(st)}
        <div class="status-sub">${esc(st.sub)}</div>
      </div>
    </article>`;
}

async function showStorage() {
  const el = document.getElementById('storage');
  if (!el || !navigator.storage?.estimate) return;
  const { usage } = await navigator.storage.estimate();
  if (usage) el.textContent = `Guardado en este dispositivo · ${fmtSize(usage)} usados`;
}

// ---------------------------------------------------------------------------
// Pantalla de un catálogo: sus productos

function renderPdf() {
  const pdf = state.pdf;
  const st = pdfStatus(pdf);
  app.innerHTML = `
    <header class="appbar">
      <div class="appbar-main">
        <button class="icon-btn" data-act="back" aria-label="Volver">${I.back}</button>
        <div class="brand">
          <div class="brand-title ellipsis">${esc(pdf.name)}</div>
          <div class="brand-sub">${plural(pdf.productCount, 'producto', 'productos')} · ${plural(pdf.pageCount, 'pág', 'págs')}</div>
        </div>
        <button class="icon-btn" data-act="rename" aria-label="Renombrar" title="Renombrar">${I.edit}</button>
        <button class="icon-btn" data-act="view" aria-label="Ver PDF" title="Ver PDF">${I.eye}</button>
        <button class="icon-btn" data-act="share-this" aria-label="Compartir" title="Compartir">${I.share}</button>
      </div>
    </header>
    <main class="content">
      <section class="status-card ${st.cls}" id="status-card">${statusCard(st)}</section>
      ${pdf.productCount ? `
      <div class="toolbar">
        <label class="search">${I.search}<input id="search" type="search" placeholder="Buscar por nombre o código" value="${esc(state.search)}" autocomplete="off"></label>
        <button class="btn" data-act="adjust-all">${I.tag}<span>Cambiar todos</span></button>
      </div>
      <div class="filters" id="filters">
        <button class="chip" data-filter="all">Todos</button>
        <button class="chip" data-filter="changed">Cambiados</button>
        <button class="chip" data-filter="orig">Sin cambiar</button>
        <button class="chip chip-select" data-act="select">${I.check}Elegir varios</button>
      </div>
      <div class="prod-list" id="list"></div>` : `
      <div class="empty">
        <div class="empty-icon">${I.warn}</div>
        <h2>No hay precios para editar</h2>
        <p>Este PDF no tiene precios escritos como texto (puede ser una foto o un escaneo). Igual lo podés ver y compartir.</p>
      </div>`}
    </main>
    <div class="selbar" id="selbar" hidden></div>
  `;
  renderProducts();
  bindList();
  const search = document.getElementById('search');
  search?.addEventListener('input', () => { state.search = search.value; renderProducts(); });
  document.getElementById('filters')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    renderProducts();
  });
}

function statusCard(st) {
  return `
    <div class="status-icon">${I.clock}</div>
    <div>
      <div class="status-title">${esc(st.title)}</div>
      <div class="status-sub">${esc(st.sub)}</div>
    </div>`;
}

function visibleProducts() {
  const q = normalize(state.search).trim();
  return state.products.filter((p) => {
    if (state.filter === 'changed' && p.price === p.origPrice) return false;
    if (state.filter === 'orig' && p.price !== p.origPrice) return false;
    return !q || normalize(p.name).includes(q) || normalize(p.code).includes(q);
  });
}

function renderProducts() {
  const list = document.getElementById('list');
  if (!list) return;
  document.querySelectorAll('#filters [data-filter]').forEach((b) => b.classList.toggle('on', b.dataset.filter === state.filter));
  const items = visibleProducts();
  list.innerHTML = items.length ? items.map(productRow).join('') : `<p class="no-results">No hay productos que coincidan.</p>`;
  syncSelectionUI();
}

function productRow(p) {
  const changed = p.price !== p.origPrice;
  const dec = p.fmt?.dec || 0;
  return `
    <article class="prod ${changed ? 'changed' : ''}" data-id="${esc(p.id)}" tabindex="0">
      <div class="prod-thumb" data-pick>
        ${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy">` : `<div class="thumb-ph">${I.tag}</div>`}
        <span class="check">${I.check}</span>
      </div>
      <div class="prod-info">
        <div class="prod-name">${esc(p.name)}</div>
        <div class="prod-meta">${p.code ? `Cód. ${esc(p.code)} · ` : ''}pág. ${p.page + 1}</div>
      </div>
      <div class="prod-price">
        <div class="price">${money(p.price, dec)}</div>
        ${changed
          ? `<div class="old">${money(p.origPrice, dec)}</div><div class="when">${timeAgo(p.updatedAt)}</div>`
          : `<div class="tag-orig">original</div>`}
      </div>
    </article>`;
}

// ---------------------------------------------------------------------------
// Tocar / mantener apretado / elegir varios

function bindList() {
  const list = document.getElementById('list');
  const itemSel = state.view === 'home' ? '.pdf-card' : '.prod';
  let timer = null;
  let startX = 0;
  let startY = 0;
  let longFired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };

  if (list) {
    list.addEventListener('pointerdown', (e) => {
      const el = e.target.closest(itemSel);
      if (!el || e.button > 0) return;
      longFired = false;
      startX = e.clientX;
      startY = e.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        longFired = true;
        navigator.vibrate?.(25);
        if (!state.selecting) enterSelection();
        toggleSelected(el.dataset.id);
      }, 450);
    });
    list.addEventListener('pointermove', (e) => {
      if (timer && (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10)) cancel();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => list.addEventListener(ev, cancel));
    list.addEventListener('contextmenu', (e) => { if (e.target.closest(itemSel)) e.preventDefault(); });
    list.addEventListener('click', (e) => {
      const el = e.target.closest(itemSel);
      if (!el) return;
      if (longFired) { longFired = false; return; }
      const id = el.dataset.id;
      if (state.selecting) { toggleSelected(id); return; }
      if (e.target.closest('[data-pick]')) { enterSelection(); toggleSelected(id); return; }
      openItem(id);
    });
    list.addEventListener('keydown', (e) => {
      const el = e.target.closest(itemSel);
      if (el && e.key === 'Enter') el.click();
    });
  }

  app.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (b) handleAction(b.dataset.act, b);
  };
  const input = document.getElementById('file-input');
  input?.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) importFiles(files);
  });
}

function openItem(id) {
  if (state.view === 'home') go(`#/pdf/${encodeURIComponent(id)}`);
  else {
    const p = state.products.find((x) => x.id === id);
    if (p) openEditSheet(p);
  }
}

function enterSelection() {
  if (state.selecting) return;
  state.selecting = true;
  state.selected.clear();
  pushLayer(() => {
    state.selecting = false;
    state.selected.clear();
    syncSelectionUI();
  });
  syncSelectionUI();
}

function exitSelection() {
  if (state.selecting) popLayers(1);
}

function toggleSelected(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  if (!state.selected.size) { exitSelection(); return; }
  syncSelectionUI();
}

function selectableIds() {
  return state.view === 'home' ? state.pdfs.map((p) => p.id) : visibleProducts().map((p) => p.id);
}

function syncSelectionUI() {
  document.body.classList.toggle('selecting', state.selecting);
  document.querySelectorAll('#list [data-id]').forEach((el) => {
    el.classList.toggle('selected', state.selected.has(el.dataset.id));
  });
  const bar = document.getElementById('selbar');
  if (!bar) return;
  bar.hidden = !state.selecting;
  if (!state.selecting) return;
  const n = state.selected.size;
  const all = selectableIds();
  const allOn = all.length > 0 && all.every((id) => state.selected.has(id));
  const actions = state.view === 'home'
    ? `
      <button class="sel-act primary" data-act="share-sel" ${n ? '' : 'disabled'}>${I.share}<span>Compartir</span></button>
      <button class="sel-act" data-act="adjust-sel" ${n ? '' : 'disabled'}>${I.tag}<span>Cambiar precios</span></button>
      <button class="sel-act danger" data-act="delete-sel" ${n ? '' : 'disabled'}>${I.trash}<span>Borrar</span></button>`
    : `
      <button class="sel-act primary" data-act="adjust-sel" ${n ? '' : 'disabled'}>${I.tag}<span>Cambiar precio</span></button>
      <button class="sel-act" data-act="restore-sel" ${n ? '' : 'disabled'}>${I.undo}<span>Volver al original</span></button>`;
  bar.innerHTML = `
    <div class="sel-top">
      <button class="icon-btn" data-act="sel-close" aria-label="Terminar de elegir">${I.close}</button>
      <div class="sel-count"><b>${n}</b> ${n === 1 ? 'elegido' : 'elegidos'}</div>
      <button class="btn-ghost small" data-act="sel-all">${I.selectAll}<span>${allOn ? 'Ninguno' : 'Todos'}</span></button>
    </div>
    <div class="sel-actions">${actions}</div>`;
}

async function handleAction(act) {
  switch (act) {
    case 'add': document.getElementById('file-input')?.click(); break;
    case 'back': goBack(); break;
    case 'select': enterSelection(); break;
    case 'sel-close': exitSelection(); break;
    case 'sel-all': {
      const all = selectableIds();
      const allOn = all.every((id) => state.selected.has(id));
      state.selected = new Set(allOn ? [] : all);
      syncSelectionUI();
      break;
    }
    case 'view': openViewer(state.pdf); break;
    case 'rename': openRenameSheet(state.pdf); break;
    case 'share-this': openShareSheet([state.pdf]); break;
    case 'adjust-all': openAdjustSheet(visibleProducts(), adjustScopeText(visibleProducts())); break;
    case 'share-sel': openShareSheet(state.pdfs.filter((p) => state.selected.has(p.id))); break;
    case 'delete-sel': openDeleteSheet(state.pdfs.filter((p) => state.selected.has(p.id))); break;
    case 'adjust-sel': {
      if (state.view === 'home') {
        const pdfs = state.pdfs.filter((p) => state.selected.has(p.id));
        const products = (await Promise.all(pdfs.map((p) => db.productsOf(p.id)))).flat();
        if (!products.length) { snack('Los catálogos elegidos no tienen precios para editar.'); return; }
        openAdjustSheet(products, `${plural(products.length, 'producto', 'productos')} de ${plural(pdfs.length, 'catálogo', 'catálogos')}`);
      } else {
        const products = state.products.filter((p) => state.selected.has(p.id));
        openAdjustSheet(products, adjustScopeText(products));
      }
      break;
    }
    case 'restore-sel': {
      const products = state.products.filter((p) => state.selected.has(p.id) && p.price !== p.origPrice);
      if (!products.length) { snack('Los elegidos ya tienen el precio original.'); return; }
      await applyPrices(products.map((p) => ({ product: p, price: p.origPrice })), `${products.length} ${products.length === 1 ? 'precio volvió' : 'precios volvieron'} al original`);
      exitSelection();
      break;
    }
    default: break;
  }
}

function adjustScopeText(products) {
  const all = state.view === 'pdf' && products.length === state.products.length;
  return all ? `Todos los productos de este catálogo (${products.length})` : `${products.length} ${products.length === 1 ? 'producto elegido' : 'productos elegidos'}`;
}

// ---------------------------------------------------------------------------
// Ventanas (abajo en el celular, al centro en la compu)

function openSheet(html, { onClose, cls = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="backdrop"></div><div class="sheet ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  void wrap.offsetHeight; // fuerza el estado inicial para que se vea la animación
  wrap.classList.add('open');
  const sheet = {
    el: wrap.querySelector('.sheet'),
    closed: false,
    locked: false,
    close: () => { if (!sheet.closed) popLayers(1); },
    set: (h) => { sheet.el.innerHTML = h; },
  };
  pushLayer(() => {
    sheet.closed = true;
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
    onClose?.();
  });
  wrap.querySelector('.backdrop').addEventListener('click', () => { if (!sheet.locked) sheet.close(); });
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) sheet.close(); });
  return sheet;
}

let snackTimer = null;
function snack(msg, action) {
  document.querySelector('.snack')?.remove();
  clearTimeout(snackTimer);
  const el = document.createElement('div');
  el.className = 'snack';
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  document.body.appendChild(el);
  void el.offsetHeight;
  el.classList.add('show');
  el.querySelector('button')?.addEventListener('click', () => { el.remove(); action.run(); });
  snackTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, action ? 9000 : 4000);
}

// ---------------------------------------------------------------------------
// Agregar PDFs

async function importFiles(files) {
  const sheet = openSheet(`
    <h2>Agregando catálogos</h2>
    <p class="sheet-sub" id="imp-file"></p>
    <div class="progress"><div id="imp-bar"></div></div>
    <p class="muted" id="imp-step">Preparando…</p>`);
  sheet.locked = true;
  navigator.storage?.persist?.();
  const $ = (id) => sheet.el.querySelector(`#${id}`);
  const results = [];
  const existing = new Set((await db.getAll('pdfs')).map((p) => p.name));

  for (const [i, file] of files.entries()) {
    $('imp-file') && ($('imp-file').textContent = `${file.name} (${i + 1} de ${files.length})`);
    try {
      const bytes = await file.arrayBuffer();
      const head = new TextDecoder().decode(new Uint8Array(bytes.slice(0, 1024)));
      if (!head.includes('%PDF')) throw new Error('No es un PDF');
      const res = await analyzePdf(bytes, (page, total) => {
        if (!$('imp-bar')) return;
        $('imp-bar').style.width = `${Math.round(((i + page / total) / files.length) * 100)}%`;
        $('imp-step').textContent = `Buscando precios… página ${page} de ${total}`;
      });
      const id = uid();
      let name = prettyName(file.name);
      for (let k = 2; existing.has(name); k++) name = `${prettyName(file.name)} (${k})`;
      existing.add(name);
      const products = res.products.map((p, idx) => ({ ...p, id: `${id}:${idx}`, pdfId: id, idx }));
      await db.addCatalog({
        id, name, fileName: file.name, size: file.size, fileDate: file.lastModified || null,
        importedAt: Date.now(), pageCount: res.pageCount, cover: res.cover,
        productCount: products.length, changedCount: 0, lastPriceUpdate: null, rev: 0,
      }, new Blob([bytes], { type: 'application/pdf' }), products);
      results.push({ name, count: products.length });
    } catch (err) {
      console.error(err);
      results.push({ name: file.name, error: err.message || String(err) });
    }
  }

  if (state.view === 'home') await renderHome();
  if (sheet.closed) {
    const ok = results.filter((r) => !r.error).length;
    snack(`${ok} ${ok === 1 ? 'catálogo agregado' : 'catálogos agregados'}`);
    return;
  }
  sheet.locked = false;
  sheet.set(`
    <h2>Listo</h2>
    <ul class="result-list">
      ${results.map((r) => r.error
        ? `<li class="err">${I.warn}<div><b>${esc(r.name)}</b><span>No se pudo leer: ${esc(r.error)}</span></div></li>`
        : r.count
          ? `<li class="ok">${I.check}<div><b>${esc(r.name)}</b><span>${plural(r.count, 'precio encontrado', 'precios encontrados')}</span></div></li>`
          : `<li class="warn">${I.warn}<div><b>${esc(r.name)}</b><span>No encontré precios escritos (puede ser una imagen). Se puede compartir igual.</span></div></li>`).join('')}
    </ul>
    <div class="sheet-actions"><button class="btn-primary" data-close>Aceptar</button></div>`);
}

// ---------------------------------------------------------------------------
// Cambiar precios

async function applyPrices(updates, message) {
  const now = Date.now();
  const changes = updates.filter((u) => u.product.price !== u.price);
  if (!changes.length) { snack('No cambió ningún precio.'); return; }
  const before = changes.map((u) => ({ product: u.product, price: u.product.price, updatedAt: u.product.updatedAt }));
  const pdfIds = [...new Set(changes.map((u) => u.product.pdfId))];
  const pdfsBefore = await Promise.all(pdfIds.map((id) => db.get('pdfs', id)));

  for (const u of changes) { u.product.price = u.price; u.product.updatedAt = now; }
  await db.putMany('products', changes.map((u) => u.product));
  await refreshPdfs(pdfIds, now);
  await afterPriceChange();

  snack(message, {
    label: 'Deshacer',
    run: async () => {
      for (const b of before) { b.product.price = b.price; b.product.updatedAt = b.updatedAt; }
      await db.putMany('products', before.map((b) => b.product));
      for (const prev of pdfsBefore.filter(Boolean)) {
        const cur = await db.get('pdfs', prev.id);
        if (cur) await db.put('pdfs', { ...cur, lastPriceUpdate: prev.lastPriceUpdate, changedCount: prev.changedCount, rev: cur.rev + 1 });
      }
      await afterPriceChange();
      snack('Cambio deshecho');
    },
  });
}

async function refreshPdfs(pdfIds, now) {
  for (const id of pdfIds) {
    const pdf = await db.get('pdfs', id);
    if (!pdf) continue;
    const products = await db.productsOf(id);
    pdf.changedCount = products.filter((p) => p.price !== p.origPrice).length;
    pdf.lastPriceUpdate = now;
    pdf.rev = (pdf.rev || 0) + 1;
    await db.put('pdfs', pdf);
  }
}

async function afterPriceChange() {
  if (state.view === 'pdf' && state.pdf) {
    state.pdf = await db.get('pdfs', state.pdf.id);
    state.products = await db.productsOf(state.pdf.id);
    const card = document.getElementById('status-card');
    if (card) {
      const st = pdfStatus(state.pdf);
      card.className = `status-card ${st.cls}`;
      card.innerHTML = statusCard(st);
    }
    renderProducts();
  } else if (state.view === 'home') {
    const sel = new Set(state.selected);
    await renderHome();
    state.selected = sel;
    syncSelectionUI();
  }
}

function openEditSheet(p) {
  const dec = p.fmt?.dec || 0;
  const changed = p.price !== p.origPrice;
  const sheet = openSheet(`
    <div class="edit-head">
      ${p.thumb ? `<img src="${p.thumb}" alt="">` : `<div class="thumb-ph">${I.tag}</div>`}
      <div>
        <h2>${esc(p.name)}</h2>
        <div class="muted">${p.code ? `Cód. ${esc(p.code)} · ` : ''}página ${p.page + 1}</div>
      </div>
    </div>
    <div class="kv"><span>Precio original del PDF</span><b>${money(p.origPrice, dec)}</b></div>
    <div class="kv"><span>Último cambio</span><b>${p.updatedAt ? `${fmtDateTime(p.updatedAt)} (${timeAgo(p.updatedAt)})` : 'Nunca, es el original'}</b></div>
    <label class="field">
      <span>Precio nuevo</span>
      <div class="input-wrap big"><span class="prefix">$</span><input id="price" inputmode="decimal" autocomplete="off" value="${String(p.price).replace('.', ',')}"></div>
    </label>
    <div class="quick">
      ${[-10, -5, 5, 10, 15, 20].map((v) => `<button class="chip" data-pct="${v}">${v > 0 ? '+' : ''}${v}%</button>`).join('')}
    </div>
    <p class="preview-line" id="pv"></p>
    <div class="sheet-actions">
      <button class="btn-secondary" id="restore" ${changed ? '' : 'disabled'}>${I.undo}Volver al original</button>
      <button class="btn-primary" id="save">Guardar</button>
    </div>`);
  const input = sheet.el.querySelector('#price');
  const pv = sheet.el.querySelector('#pv');
  const update = () => {
    const v = parseUserNumber(input.value);
    const ok = Number.isFinite(v) && v > 0;
    pv.textContent = ok ? `En el PDF va a decir: ${formatPrice(v, p.fmt)}` : 'Escribí un precio válido';
    pv.classList.toggle('bad', !ok);
    sheet.el.querySelector('#save').disabled = !ok;
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sheet.el.querySelector('#save').click(); });
  update();
  sheet.el.querySelector('.quick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pct]');
    if (!b) return;
    const base = parseUserNumber(input.value) || p.price;
    const pct = Number(b.dataset.pct);
    input.value = String(adjustPrice(base, { mode: pct > 0 ? 'up' : 'down', value: Math.abs(pct), round: 0 }, dec)).replace('.', ',');
    update();
  });
  sheet.el.querySelector('#save').addEventListener('click', async () => {
    const v = parseUserNumber(input.value);
    if (!(v > 0)) return;
    sheet.close();
    await applyPrices([{ product: p, price: Math.round(v * 10 ** dec) / 10 ** dec }], `Precio guardado: ${money(v, dec)}`);
  });
  sheet.el.querySelector('#restore').addEventListener('click', async () => {
    sheet.close();
    await applyPrices([{ product: p, price: p.origPrice }], 'Volvió al precio original');
  });
  if (matchMedia('(pointer: fine)').matches) setTimeout(() => input.select(), 250);
}

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('ajuste') || '{}'); } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem('ajuste', JSON.stringify(p)); } catch { /* sin espacio: no importa */ }
}

function openAdjustSheet(products, scopeText) {
  if (!products.length) { snack('No hay productos para cambiar.'); return; }
  const prefs = loadPrefs();
  const cfg = { mode: prefs.mode || 'up', value: NaN, round: prefs.round ?? 0 };
  const sheet = openSheet(`
    <h2>Cambiar precios</h2>
    <p class="sheet-sub">${esc(scopeText)}</p>
    <div class="field"><span>¿Qué querés hacer?</span>
      <div class="seg" id="modes">
        ${Object.entries(ADJUST_MODES).map(([k, m]) => `<button data-mode="${k}">${m.label}</button>`).join('')}
      </div>
    </div>
    <label class="field">
      <span id="val-label"></span>
      <div class="input-wrap big"><span class="prefix" id="val-unit"></span><input id="val" inputmode="decimal" autocomplete="off" placeholder="0"></div>
    </label>
    <div class="quick" id="quick"></div>
    <div class="field" id="round-field"><span>Redondear el resultado</span>
      <div class="seg small" id="rounds">
        ${[0, 10, 50, 100].map((r) => `<button data-round="${r}">${r ? `a $${r}` : 'No'}</button>`).join('')}
      </div>
    </div>
    <div class="preview" id="preview"></div>
    <div class="sheet-actions">
      <button class="btn-secondary" data-close>Cancelar</button>
      <button class="btn-primary" id="apply" disabled>Aplicar</button>
    </div>`, { cls: 'tall' });
  const $ = (s) => sheet.el.querySelector(s);
  const input = $('#val');

  const render = () => {
    const unit = ADJUST_MODES[cfg.mode].unit;
    sheet.el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === cfg.mode));
    sheet.el.querySelectorAll('[data-round]').forEach((b) => b.classList.toggle('on', Number(b.dataset.round) === cfg.round));
    $('#val-unit').textContent = unit;
    $('#val-label').textContent = unit === '%' ? 'Porcentaje' : cfg.mode === 'set' ? 'Precio para todos los elegidos' : 'Monto en pesos';
    $('#round-field').hidden = cfg.mode === 'set';
    $('#quick').innerHTML = unit === '%' ? [5, 10, 15, 20, 25, 30].map((v) => `<button class="chip" data-v="${v}">${v}%</button>`).join('') : '';
    cfg.value = parseUserNumber(input.value);
    const ok = Number.isFinite(cfg.value) && cfg.value > 0 && !(cfg.mode === 'down' && cfg.value >= 100);
    $('#apply').disabled = !ok;
    $('#apply').textContent = ok ? `Aplicar a ${products.length} ${products.length === 1 ? 'producto' : 'productos'}` : 'Aplicar';
    const sample = products.slice(0, 4);
    $('#preview').innerHTML = ok ? `
      <div class="preview-title">Así quedarían${products.length > 4 ? ' (algunos ejemplos)' : ''}:</div>
      ${sample.map((p) => {
        const dec = p.fmt?.dec || 0;
        return `<div class="pv-row"><span class="pv-name">${esc(p.name)}</span><span class="pv-old">${money(p.price, dec)}</span><span class="pv-arrow">→</span><b>${money(adjustPrice(p.price, cfg, dec), dec)}</b></div>`;
      }).join('')}` : `<div class="preview-title muted">Escribí ${unit === '%' ? 'el porcentaje' : 'el monto'} para ver cómo quedan.</div>`;
  };

  $('#modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) { cfg.mode = b.dataset.mode; render(); input.focus(); }
  });
  $('#rounds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-round]');
    if (b) { cfg.round = Number(b.dataset.round); render(); }
  });
  $('#quick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (b) { input.value = b.dataset.v; render(); }
  });
  input.addEventListener('input', render);
  $('#apply').addEventListener('click', async () => {
    savePrefs({ mode: cfg.mode, round: cfg.round });
    const updates = products.map((p) => ({ product: p, price: adjustPrice(p.price, cfg, p.fmt?.dec || 0) }));
    const wasSelecting = state.selecting;
    popLayers(wasSelecting ? 2 : 1);
    await applyPrices(updates, `${updates.length} ${updates.length === 1 ? 'precio cambiado' : 'precios cambiados'}`);
  });
  render();
}

// ---------------------------------------------------------------------------
// Armar el PDF con los precios nuevos

async function getOutputBlob(pdf) {
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

// ---------------------------------------------------------------------------
// Compartir (WhatsApp, Estado, mail, etc.) usando el menú de compartir del celular

function openShareSheet(pdfs) {
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

async function prepareShare(sheet, pdfs, mode, range) {
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
      <p class="hint">Se abre el menú de compartir: elegí <b>WhatsApp</b> y después los contactos o grupos que quieras${mode === 'img' ? ', o <b>Mi estado</b>' : ''}.</p>` : `
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

// ---------------------------------------------------------------------------
// Renombrar (solo el nombre que se ve en la app; al compartir se usa el nombre del archivo)

function openRenameSheet(pdf) {
  const sheet = openSheet(`
    <h2>Renombrar catálogo</h2>
    <p class="sheet-sub">Archivo: ${esc(pdf.fileName)}</p>
    <label class="field"><span>Nombre</span>
      <div class="input-wrap"><input id="name" value="${esc(pdf.name)}" autocomplete="off" maxlength="80" style="font-size:20px;font-weight:700"></div>
    </label>
    <div class="sheet-actions">
      <button class="btn-secondary" data-close>Cancelar</button>
      <button class="btn-primary" id="ok">Guardar</button>
    </div>`);
  const input = sheet.el.querySelector('#name');
  const save = async () => {
    const name = input.value.trim();
    if (!name) return;
    const fresh = await db.get('pdfs', pdf.id);
    await db.put('pdfs', { ...fresh, name });
    sheet.close();
    state.pdf = { ...fresh, name };
    renderPdf();
  };
  sheet.el.querySelector('#ok').addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

// ---------------------------------------------------------------------------
// Borrar

function openDeleteSheet(pdfs) {
  const sheet = openSheet(`
    <h2>¿Borrar ${pdfs.length === 1 ? 'este catálogo' : `${pdfs.length} catálogos`}?</h2>
    <p class="sheet-sub">${esc(pdfs.map((p) => p.name).join(' · '))}</p>
    <p>Se borran de la app junto con los precios que cambiaste. Los PDF que tengas guardados en el celular no se tocan.</p>
    <div class="sheet-actions">
      <button class="btn-secondary" data-close>Cancelar</button>
      <button class="btn-danger" id="del">${I.trash}Borrar</button>
    </div>`);
  sheet.el.querySelector('#del').addEventListener('click', async () => {
    for (const p of pdfs) await db.deleteCatalog(p.id);
    popLayers(state.selecting ? 2 : 1);
    await renderHome();
    snack(pdfs.length === 1 ? 'Catálogo borrado' : `${pdfs.length} catálogos borrados`);
  });
}

// ---------------------------------------------------------------------------
// Ver el PDF como va a quedar

async function openViewer(pdf) {
  const el = document.createElement('div');
  el.className = 'viewer';
  el.innerHTML = `
    <header class="appbar">
      <div class="appbar-main">
        <button class="icon-btn" data-v="close" aria-label="Cerrar">${I.close}</button>
        <div class="brand"><div class="brand-title ellipsis">${esc(pdf.name)}</div><div class="brand-sub" id="v-sub">Armando el PDF…</div></div>
        <button class="icon-btn" data-v="download" aria-label="Descargar" title="Descargar">${I.download}</button>
      </div>
    </header>
    <div class="viewer-pages" id="v-pages"><div class="spinner"></div></div>`;
  document.body.appendChild(el);
  document.body.classList.add('no-scroll');
  let doc = null;
  let observer = null;
  let blob = null;
  let closed = false;
  pushLayer(() => {
    closed = true;
    observer?.disconnect();
    doc?.destroy();
    el.remove();
    document.body.classList.remove('no-scroll');
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    if (b.dataset.v === 'close') popLayers(1);
    if (b.dataset.v === 'download' && blob) download(blob, pdf.fileName);
  });

  try {
    await nextFrame();
    blob = await getOutputBlob(pdf);
    if (closed) return;
    doc = await openPdf(await blob.arrayBuffer());
    if (closed) return;
    const fresh = await db.get('pdfs', pdf.id);
    el.querySelector('#v-sub').textContent = `${plural(doc.numPages, 'página', 'páginas')} · ${pdfStatus(fresh).title}`;
    const box = el.querySelector('#v-pages');
    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    box.innerHTML = Array.from({ length: doc.numPages }, (_, i) => `<div class="vpage" data-n="${i + 1}" style="aspect-ratio:${vp.width}/${vp.height}"></div>`).join('');
    observer = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting || en.target.dataset.done) continue;
        en.target.dataset.done = '1';
        drawViewerPage(doc, en.target);
      }
    }, { root: box, rootMargin: '800px 0px' });
    box.querySelectorAll('.vpage').forEach((d) => observer.observe(d));
  } catch (err) {
    console.error(err);
    el.querySelector('#v-sub').textContent = 'No se pudo abrir';
    el.querySelector('#v-pages').innerHTML = `<p class="no-results">No se pudo abrir el PDF: ${esc(err.message)}</p>`;
  }
}

async function drawViewerPage(doc, holder) {
  try {
    const page = await doc.getPage(Number(holder.dataset.n));
    const width = Math.min(1600, holder.clientWidth * Math.min(2, window.devicePixelRatio || 1));
    const { canvas } = await renderPage(page, scaleForWidth(page, width), 'display');
    holder.appendChild(canvas);
    page.cleanup();
  } catch { /* el visor se cerró mientras dibujaba */ }
}

// ---------------------------------------------------------------------------

// En "localhost" (cuando se está programando) no se guarda la app, para ver siempre lo último.
if ('serviceWorker' in navigator && location.protocol !== 'file:' && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Sin modo offline:', err));
}

route();
