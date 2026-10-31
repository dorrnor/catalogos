// Lee un PDF de catálogo y encuentra cada precio visible, con el producto al que pertenece
// (nombre, código y una foto recortada de la página).
//
// Funciona con cualquier diseño mientras los precios sean texto con "$" (no una imagen):
// se ubica cada "$ 1.234" en la página, se mira en la imagen de la página si realmente se ve
// (algunos catálogos tienen el precio viejo tapado y el nuevo encima), y se toma su color de
// letra y de fondo para poder reemplazarlo después sin que se note.

import { openPdf, renderPage } from './pdfjs.js';
import { parsePriceText, median } from './util.js';

const PRICE_RE = /\$\s?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\$\s?\d+(?:,\d{1,2})?/g;
const CODE_RE = /(?:c[oó]d(?:igo)?|sku|ean|art(?:[ií]culo)?)\.?\s*:\s*([A-Za-z0-9][\w\-/.]{2,})/i;
const LABEL_RE = /^\s*(precio|c[oó]d(?:igo)?\b|sku\b|ean\b|categor|p[aá]gina|bulto)/i;
const MAX_PIXELS = 6_000_000; // tamaño máximo de la página dibujada para analizar
const ANALYSIS_SCALE = 2;

// Alto de los números y el "$" respecto del tamaño de letra (sirve para cualquier fuente).
const PRICE_TOP = 0.82;
const PRICE_BOTTOM = -0.18;

const measureCtx = document.createElement('canvas').getContext('2d');
function measure(str, bold) {
  measureCtx.font = `${bold ? 'bold ' : ''}100px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(str).width;
}

export async function analyzePdf(bytes, onProgress = () => {}) {
  const doc = await openPdf(bytes);
  const pageCount = doc.numPages;
  const memo = { columns: [], rowGaps: [] };
  const products = [];
  // De portada se usa la primera página con productos (las tapas suelen ser todas iguales).
  let cover = null;
  let firstPage = null;
  try {
    for (let n = 1; n <= pageCount; n++) {
      onProgress(n, pageCount);
      const page = await doc.getPage(n);
      const res = await analyzePage(page, n - 1, memo, !cover);
      if (n === 1) firstPage = res.cover;
      if (!cover && res.products.length) cover = res.cover;
      products.push(...res.products);
      page.cleanup();
    }
  } finally {
    doc.destroy();
  }
  return { pageCount, cover: cover || firstPage, products };
}

async function analyzePage(page, pageIndex, memo, wantCover) {
  const [vx0, , vx1] = page.view;
  const pageW = vx1 - vx0;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(ANALYSIS_SCALE, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
  const { canvas, ctx, viewport } = await renderPage(page, scale);
  const W = canvas.width;
  const H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H).data;
  const toPx = (x0, y0, x1, y1) => {
    const [a, b, c, d] = viewport.convertToViewportRectangle([x0, y0, x1, y1]);
    return { x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) };
  };

  const cover = wantCover ? thumbOf(canvas, { x0: 0, y0: 0, x1: W, y1: H }, 260, 0.7) : null;

  const tc = await page.getTextContent();
  const boldMemo = new Map();
  const isBold = (fontName) => {
    if (!boldMemo.has(fontName)) {
      let bold = false;
      try {
        const f = page.commonObjs.get(fontName);
        bold = /bold|black|heavy|demi/i.test(f?.name || '') || !!f?.bold;
      } catch { /* fuente no disponible: se asume normal */ }
      boldMemo.set(fontName, bold);
    }
    return boldMemo.get(fontName);
  };

  // Solo texto horizontal. Los pedazos que son solo espacios se ignoran: algunos PDFs traen
  // "espacios" muy anchos que unirían columnas distintas en un mismo renglón.
  const items = [];
  tc.items.forEach((it, idx) => {
    if (!it.str || !it.str.trim() || !it.transform) return;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0 || d <= 0) return;
    const st = tc.styles[it.fontName] || {};
    const asc = st.ascent > 0.5 && st.ascent < 1.1 ? st.ascent : 0.8;
    const desc = st.descent < -0.05 && st.descent > -0.4 ? st.descent : -0.22;
    items.push({ str: it.str, idx, x0: e, x1: e + it.width, y: f, size: d, asc, desc, bold: isBold(it.fontName) });
  });

  const lines = buildLines(items);

  // 1) Precios
  let cands = [];
  for (const line of lines) {
    for (const m of line.text.matchAll(PRICE_RE)) {
      const chars = line.chars.slice(m.index, m.index + m[0].length).filter(Boolean);
      if (!chars.length) continue;
      const first = chars[0];
      const last = chars[chars.length - 1];
      const main = (chars.find((ch) => /\d/.test(ch.it.str[ch.off])) || first).it;
      const size = Math.max(...chars.map((ch) => ch.it.size));
      const x0 = charX(first.it, first.off);
      const x1 = charX(last.it, last.off + 1);
      if (x1 - x0 < size * 0.8) continue;
      const parsed = parsePriceText(m[0]);
      if (!(parsed.value > 0)) continue;
      cands.push({
        text: m[0], ...parsed, line, x0, x1, size, y: main.y, bold: main.bold, order: main.idx,
        top: main.y + PRICE_TOP * size, bot: main.y + PRICE_BOTTOM * size,
      });
    }
  }
  for (const c of cands) c.stats = sampleColors(img, W, H, toPx(c.x0, c.bot, c.x1, c.top));

  // Precios encimados (el viejo tapado y el nuevo arriba, a veces un poco corrido): si un
  // precio cae debajo del renglón de otro escrito después, es el mismo producto y queda el
  // último que se ve.
  cands.sort((a, b) => a.order - b.order);
  const lineRect = (c) => ({ x0: c.line.x0, x1: c.line.x1, top: c.top, bot: c.bot });
  const groups = [];
  for (const c of cands) {
    const g = groups.find((gr) => gr.some((o) => (o.line === c.line
      ? overlapRatio(o, c) > 0.3 // dos precios en el mismo renglón son distintos (ej. unidad y bulto)
      : overlapRatio(o, lineRect(c)) > 0.3 || overlapRatio(c, lineRect(o)) > 0.3)));
    if (g) g.push(c);
    else groups.push([c]);
  }
  const prices = groups
    .map((g) => g.filter((c) => c.stats.visible).pop())
    .filter(Boolean);
  if (!prices.length) return { cover, products: [] };
  for (const p of prices) refineEdges(img, W, H, viewport, p);

  // 2) Códigos, y a qué precio corresponde cada uno (el más cercano, en la misma columna).
  const codes = [];
  for (const line of lines) {
    const m = line.text.match(CODE_RE);
    if (m) codes.push({ code: m[1].replace(/\.$/, ''), line });
  }
  const pairs = [];
  for (const p of prices) {
    for (const c of codes) {
      const L = c.line;
      const dx = Math.min(Math.abs(cx(L) - cx(p)), Math.abs(L.x0 - p.line.x0));
      const above = L.bot >= p.top - p.size * 0.5;
      const dy = above ? Math.max(0, L.bot - p.top) : Math.max(0, p.bot - L.top);
      if (dy > 6 * p.size || dx > pageW * 0.25) continue;
      pairs.push({ p, c, score: dx + dy * (above ? 2 : 3) });
    }
  }
  pairs.sort((a, b) => a.score - b.score);
  for (const { p, c, score } of pairs) {
    if (p.code || c.used) continue;
    p.code = c;
    p.codeScore = score;
    c.used = true;
  }

  // 3) Columnas de la página (para saber qué texto e imagen van con cada precio).
  for (const p of prices) {
    const ref = p.code ? p.code.line : p.line;
    p.anchor = {
      x0: Math.min(ref.x0, p.line.x0), x1: Math.max(ref.x1, p.line.x1),
      top: Math.max(ref.top, p.top), bot: Math.min(ref.bot, p.bot),
    };
    p.cx = (ref.x0 + ref.x1) / 2;
  }
  const pageCols = clusterColumns(prices.map((p) => (p.cx - vx0) / pageW));
  if (pageCols.length >= 2 && pageCols.length >= memo.columns.length) memo.columns = pageCols;
  const cols = pageCols.length >= 2 || !memo.columns.length ? pageCols : memo.columns;

  for (const p of prices) {
    const rel = (p.cx - vx0) / pageW;
    let k = 0;
    cols.forEach((c, i) => { if (Math.abs(c - rel) < Math.abs(cols[k] - rel)) k = i; });
    p.colL = vx0 + pageW * (k === 0 ? 0 : (cols[k - 1] + cols[k]) / 2);
    p.colR = vx0 + pageW * (k === cols.length - 1 ? 1 : (cols[k] + cols[k + 1]) / 2);
    p.col = k;
  }

  // Distancia entre filas de productos (para saber hasta dónde llega la foto).
  for (let k = 0; k < cols.length; k++) {
    const tops = prices.filter((p) => p.col === k).map((p) => p.anchor.top).sort((a, b) => b - a);
    for (let i = 1; i < tops.length; i++) {
      const gap = tops[i - 1] - tops[i];
      if (gap > 40) memo.rowGaps.push(gap);
    }
  }
  const rowGap = median(memo.rowGaps) || (page.view[3] - page.view[1]) * 0.3;

  // 4) Nombre y foto de cada producto.
  const used = new Set();
  for (const p of prices) {
    used.add(p.line);
    if (p.code) used.add(p.code.line);
  }
  const products = [];
  for (const p of prices) {
    const inCol = (L) => { const c = cx(L); return c >= p.colL && c <= p.colR; };
    const own = new Set([p.line, p.code && p.code.line]);
    const above = lines
      .filter((L) => !own.has(L) && inCol(L) && L.bot >= p.anchor.top - L.size * 0.5)
      .sort((a, b) => a.bot - b.bot);
    const nameLines = [];
    let cur = p.anchor.top;
    let maxGap = Math.max(4 * p.size, 30);
    let stopLine = null;
    for (const L of above) {
      if (L.bot < cur - L.size * 0.5) continue;
      // Más lejos de lo normal, o texto de otro producto: ahí termina este.
      if (L.bot - cur > maxGap || nameLines.length >= 8 || used.has(L)) { stopLine = L; break; }
      if (LABEL_RE.test(L.text) || L.text.includes('$')) { cur = Math.max(cur, L.top); continue; }
      nameLines.push(L);
      cur = L.top;
      maxGap = 1.3 * L.size;
    }
    const name = nameLines.reverse().map((L) => L.text.trim()).join(' ').replace(/\s+/g, ' ');
    const blockTop = Math.max(cur, p.anchor.top);

    let thumb = null;
    const byLine = stopLine && stopLine.bot - 1 < blockTop + rowGap * 0.95;
    const thumbTop = Math.min(blockTop + rowGap * 0.95, stopLine ? stopLine.bot - 1 : Infinity, page.view[3]);
    if (thumbTop - blockTop > 25) {
      thumb = productThumb(canvas, img, W, H, toPx(p.colL + 2, blockTop + 1, p.colR - 2, thumbTop), byLine);
    }

    // Alineación: centrado si el precio está solo en su línea y el código/nombre comparten
    // su centro (y no su borde izquierdo).
    const priceAlone = p.x0 - p.line.x0 < p.size * 0.5 && p.line.x1 - p.x1 < p.size * 0.5;
    let votesCenter = 0;
    let votesLeft = 0;
    for (const r of [p.code && p.code.line, ...nameLines].filter(Boolean)) {
      const dc = Math.abs(cx(r) - (p.x0 + p.x1) / 2);
      const dl = Math.abs(r.x0 - p.x0);
      if (dc < Math.max(2, p.size * 0.3) && dl > 3) votesCenter++;
      else if (dl < 2 && dc > 3) votesLeft++;
    }
    const align = priceAlone && votesCenter > votesLeft ? 'center' : 'left';
    const width = p.x1 - p.x0;
    const padX = p.size * 0.12;
    const padY = p.size * 0.04;

    products.push({
      page: pageIndex,
      sortTop: p.anchor.top,
      sortX: p.anchor.x0,
      name: name || (p.code ? `Producto ${p.code.code}` : `Producto de la página ${pageIndex + 1}`),
      code: p.code ? p.code.code : '',
      origText: p.text,
      origPrice: p.value,
      price: p.value,
      fmt: p.fmt,
      updatedAt: null,
      thumb,
      cover: { x: p.x0 - padX, y: p.bot - padY, w: width + 2 * padX, h: p.top - p.bot + 2 * padY },
      draw: {
        x0: p.x0, cx: (p.x0 + p.x1) / 2, y: p.y, size: p.size, bold: p.bold, align,
        maxW: align === 'center' ? width * 1.4 : Math.max(width, Math.min(p.colR - p.x0 - 2, width * 2.5)),
        color: p.stats.color.map((v) => +(v / 255).toFixed(3)),
        bg: p.stats.bg.map((v) => +(v / 255).toFixed(3)),
      },
    });
  }

  // Orden de lectura: filas de arriba hacia abajo, y en cada fila de izquierda a derecha.
  products.sort((a, b) => b.sortTop - a.sortTop);
  const rows = [];
  for (const pr of products) {
    const row = rows[rows.length - 1];
    if (row && row[0].sortTop - pr.sortTop < rowGap * 0.4) row.push(pr);
    else rows.push([pr]);
  }
  const ordered = rows.flatMap((row) => row.sort((a, b) => a.sortX - b.sortX));
  for (const pr of ordered) { delete pr.sortTop; delete pr.sortX; }
  return { cover, products: ordered };
}

const cx = (r) => (r.x0 + r.x1) / 2;

function charX(it, off) {
  if (off <= 0) return it.x0;
  if (off >= it.str.length) return it.x1;
  const full = measure(it.str, it.bold);
  return full > 0 ? it.x0 + (it.x1 - it.x0) * (measure(it.str.slice(0, off), it.bold) / full) : it.x0;
}

// Arma renglones: pedazos de texto en la misma altura y pegados entre sí.
function buildLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const rows = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - it.y) < 0.35 * Math.min(row.size, it.size)) row.items.push(it);
    else rows.push({ y: it.y, size: it.size, items: [it] });
  }
  const lines = [];
  for (const row of rows) {
    const segs = [];
    for (const it of row.items.sort((a, b) => a.x0 - b.x0)) {
      const tol = Math.max(it.size, 4);
      let seg = null;
      for (const s of segs) {
        const gap = it.x0 - s.x1;
        if (gap > -0.3 * tol && gap < 1.2 * tol && (!seg || s.x1 > seg.x1)) seg = s;
      }
      if (!seg) { seg = { items: [], x1: -Infinity }; segs.push(seg); }
      seg.items.push(it);
      seg.x1 = Math.max(seg.x1, it.x1);
    }
    for (const s of segs) {
      let text = '';
      const chars = [];
      let prev = null;
      for (const it of s.items) {
        if (prev && it.x0 - prev.x1 > 0.2 * it.size && !/\s$/.test(text) && !/^\s/.test(it.str)) {
          text += ' ';
          chars.push(null);
        }
        for (let i = 0; i < it.str.length; i++) chars.push({ it, off: i });
        text += it.str;
        prev = it;
      }
      const its = s.items;
      lines.push({
        text, chars,
        x0: Math.min(...its.map((i) => i.x0)), x1: Math.max(...its.map((i) => i.x1)),
        top: Math.max(...its.map((i) => i.y + i.asc * i.size)),
        bot: Math.min(...its.map((i) => i.y + i.desc * i.size)),
        size: Math.max(...its.map((i) => i.size)),
      });
    }
  }
  return lines;
}

function overlapRatio(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.top, b.top) - Math.max(a.bot, b.bot);
  if (w <= 0 || h <= 0) return 0;
  const area = (r) => (r.x1 - r.x0) * (r.top - r.bot);
  return (w * h) / Math.min(area(a), area(b));
}

function clusterColumns(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const groups = [];
  for (const v of sorted) {
    const g = groups[groups.length - 1];
    if (g && v - g[g.length - 1] < 0.08) g.push(v);
    else groups.push([v]);
  }
  return groups.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
}

// Color de fondo (el más común alrededor del precio), color de letra y si el precio se ve.
function sampleColors(img, W, H, r) {
  const X0 = Math.max(0, Math.floor(r.x0));
  const X1 = Math.min(W, Math.ceil(r.x1));
  const Y0 = Math.max(0, Math.floor(r.y0));
  const Y1 = Math.min(H, Math.ceil(r.y1));
  const R = 3;
  const counts = new Map();
  for (let y = Math.max(0, Y0 - R); y < Math.min(H, Y1 + R); y++) {
    for (let x = Math.max(0, X0 - R); x < Math.min(W, X1 + R); x++) {
      if (x >= X0 && x < X1 && y >= Y0 && y < Y1) continue;
      const i = (y * W + x) * 4;
      const key = ((img[i] >> 4) << 8) | ((img[i + 1] >> 4) << 4) | (img[i + 2] >> 4);
      const e = counts.get(key);
      if (e) { e.n++; e.r += img[i]; e.g += img[i + 1]; e.b += img[i + 2]; } else counts.set(key, { n: 1, r: img[i], g: img[i + 1], b: img[i + 2] });
    }
  }
  let best = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  const bg = best ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];

  let ink = 0;
  let total = 0;
  let maxD = 0;
  const dist = (i) => Math.abs(img[i] - bg[0]) + Math.abs(img[i + 1] - bg[1]) + Math.abs(img[i + 2] - bg[2]);
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      const d = dist((y * W + x) * 4);
      total++;
      if (d > 90) ink++;
      if (d > maxD) maxD = d;
    }
  }
  // Color de letra: el más repetido entre los píxeles bien marcados (si otro texto se mete
  // en el recuadro, como una línea de abajo pisada, queda en minoría).
  const bins = new Map();
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      const i = (y * W + x) * 4;
      if (dist(i) < maxD * 0.55) continue;
      const key = ((img[i] >> 5) << 6) | ((img[i + 1] >> 5) << 3) | (img[i + 2] >> 5);
      const e = bins.get(key);
      if (e) { e.n++; e.r += img[i]; e.g += img[i + 1]; e.b += img[i + 2]; } else bins.set(key, { n: 1, r: img[i], g: img[i + 1], b: img[i + 2] });
    }
  }
  let top = null;
  for (const e of bins.values()) if (!top || e.n > top.n) top = e;
  const color = top ? [top.r / top.n, top.g / top.n, top.b / top.n].map(Math.round) : [0, 0, 0];
  return { bg: bg.map(Math.round), color, visible: total > 0 && maxD > 120 && ink / total > 0.04 };
}

// La posición de cada letra se estima midiendo con otra fuente, así que puede quedar corrida.
// Acá se ajustan los bordes izquierdo y derecho del precio a lo que realmente se ve: el
// precio termina donde hay un espacio vacío (por ejemplo entre "Precio:" y "$").
function refineEdges(img, W, H, viewport, p) {
  const [ax, ay] = viewport.convertToViewportPoint(p.x0, p.y + 0.6 * p.size);
  const [bx, by] = viewport.convertToViewportPoint(p.x1, p.y + 0.08 * p.size);
  const pxPerPt = Math.abs(bx - ax) / Math.max(1, p.x1 - p.x0);
  const s = p.size * pxPerPt; // tamaño de letra en píxeles
  const y0 = Math.max(0, Math.round(Math.min(ay, by)));
  const y1 = Math.min(H, Math.round(Math.max(ay, by)));
  if (y1 - y0 < 2 || s < 4) return;
  const bg = p.stats.bg;
  const inked = (x) => {
    if (x < 0 || x >= W) return false;
    for (let y = y0; y < y1; y++) {
      const i = (y * W + x) * 4;
      if (Math.abs(img[i] - bg[0]) + Math.abs(img[i + 1] - bg[1]) + Math.abs(img[i + 2] - bg[2]) > 90) return true;
    }
    return false;
  };
  const minGap = Math.max(2, Math.round(0.18 * s));
  const left = Math.min(ax, bx);
  const right = Math.max(ax, bx);

  // Borde izquierdo: desde adentro del "$" hacia la izquierda, hasta el hueco anterior.
  let start = Math.round(left + 0.15 * s);
  for (let k = 0; k < 0.4 * s && !inked(start); k++) start++;
  let newLeft = left;
  for (let x = start, run = 0; x >= left - 0.7 * s; x--) {
    if (!inked(x)) { run++; if (run >= minGap) { newLeft = x + run; break; } } else run = 0;
  }
  // Borde derecho: desde adentro del último número hacia la derecha, hasta el hueco siguiente.
  start = Math.round(right - 0.15 * s);
  for (let k = 0; k < 0.4 * s && !inked(start); k++) start--;
  let newRight = right;
  for (let x = start, run = 0; x <= right + 0.7 * s; x++) {
    if (!inked(x)) { run++; if (run >= minGap) { newRight = x - run + 1; break; } } else run = 0;
  }
  // Si el resultado es raro (otro texto pegado, una imagen), se deja la estimación.
  const ratio = (newRight - newLeft) / (right - left);
  if (ratio < 0.6 || ratio > 1.5) return;
  const toPdfX = (x) => viewport.convertToPdfPoint(x, y0)[0];
  p.x0 = toPdfX(newLeft);
  p.x1 = toPdfX(newRight);
}

// Recorte de la foto del producto: corta en el borde de la tarjeta (una línea que cruza todo
// el ancho), saltea lo que haya quedado del producto de arriba y saca el blanco sobrante.
// El gris claro (bordes de tarjetas) cuenta como fondo.
function productThumb(canvas, img, W, H, r, belowOtherProduct) {
  let x0 = Math.max(0, Math.round(r.x0));
  let x1 = Math.min(W, Math.round(r.x1));
  let y0 = Math.max(0, Math.round(r.y0));
  let y1 = Math.min(H, Math.round(r.y1));
  if (x1 - x0 < 20 || y1 - y0 < 20) return null;
  const isBg = (i) => {
    const mn = Math.min(img[i], img[i + 1], img[i + 2]);
    return mn > 222 || (mn > 200 && Math.max(img[i], img[i + 1], img[i + 2]) - mn < 14);
  };
  const filled = (y) => {
    let n = 0;
    for (let x = x0; x < x1; x++) if (!isBg((y * W + x) * 4)) n++;
    return n / (x1 - x0);
  };
  for (let y = y1 - 6; y > y0; y--) {
    if (filled(y) > 0.9) { if (y1 - y > 40) y0 = y + 1; break; }
  }
  const rowHas = (y) => { for (let x = x0; x < x1; x++) if (!isBg((y * W + x) * 4)) return true; return false; };
  const colHas = (x) => { for (let y = y0; y < y1; y++) if (!isBg((y * W + x) * 4)) return true; return false; };
  if (belowOtherProduct) {
    let y = y0;
    while (y < y1 && rowHas(y)) y++;
    if (y > y0 && y1 - y > 30) y0 = y;
  }
  const trim = () => {
    while (y0 < y1 && !rowHas(y0)) y0++;
    while (y1 > y0 && !rowHas(y1 - 1)) y1--;
    while (x0 < x1 && !colHas(x0)) x0++;
    while (x1 > x0 && !colHas(x1 - 1)) x1--;
  };
  // Una línea finita en el borde (el contorno de una tarjeta) seguida de blanco se saltea.
  const thinLine = (has, from, dir, limit) => {
    let w = 0;
    while (w <= 4 && (from + dir * w - limit) * dir < 0 && has(from + dir * w)) w++;
    let g = 0;
    while (g < 6 && (from + dir * (w + g) - limit) * dir < 0 && !has(from + dir * (w + g))) g++;
    return w <= 4 && g >= 6 ? w + g : 0;
  };
  trim();
  for (let k = 0; k < 3; k++) {
    const l = thinLine(colHas, x0, 1, x1);
    const rr = thinLine(colHas, x1 - 1, -1, x0);
    const t = thinLine(rowHas, y0, 1, y1);
    const b = thinLine(rowHas, y1 - 1, -1, y0);
    if (!(l || rr || t || b)) break;
    x0 += l; x1 -= rr; y0 += t; y1 -= b;
    trim();
  }
  if (x1 - x0 < 12 || y1 - y0 < 12) return null;
  const m = 4;
  return thumbOf(canvas, { x0: Math.max(0, x0 - m), y0: Math.max(0, y0 - m), x1: Math.min(W, x1 + m), y1: Math.min(H, y1 + m) }, 200, 0.72);
}

function thumbOf(canvas, r, maxSide, quality) {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(w * s));
  t.height = Math.max(1, Math.round(h * s));
  const c = t.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, t.width, t.height);
  c.drawImage(canvas, r.x0, r.y0, w, h, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', quality);
}
