// Funciones chicas que usa toda la app: precios, fechas, textos.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const nextFrame = () => new Promise((r) => setTimeout(r, 30));

// plural(1, 'producto', 'productos') -> "1 producto"
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "$ 1.958" -> { value: 1958, fmt: { space: true, dec: 0 } }
export function parsePriceText(text) {
  const space = /\$\s/.test(text);
  const s = text.replace(/[\s$]/g, '');
  if (s.includes(',')) {
    const [int, dec] = s.split(',');
    return { value: parseFloat(int.replace(/\./g, '') + '.' + dec), fmt: { space, dec: dec.length } };
  }
  return { value: parseInt(s.replace(/\./g, ''), 10), fmt: { space, dec: 0 } };
}

// Lo que escribe la persona: "10.500", "10500", "10500,50", "$ 10.500"
export function parseUserNumber(text) {
  let s = String(text).replace(/[\s$%]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s);
}

export function formatPrice(value, fmt = {}) {
  const dec = fmt.dec || 0;
  const [int, frac] = Math.abs(value).toFixed(dec).split('.');
  const body = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (frac ? ',' + frac : '');
  return '$' + (fmt.space ? ' ' : '') + body;
}

export const money = (value, dec = 0) => formatPrice(value, { dec });

export const ADJUST_MODES = {
  up: { label: 'Subir %', unit: '%' },
  down: { label: 'Bajar %', unit: '%' },
  add: { label: 'Sumar $', unit: '$' },
  sub: { label: 'Restar $', unit: '$' },
  set: { label: 'Precio fijo', unit: '$' },
};

export function adjustPrice(price, { mode, value, round }, dec = 0) {
  let v = price;
  if (mode === 'up') v = price * (1 + value / 100);
  else if (mode === 'down') v = price * (1 - value / 100);
  else if (mode === 'add') v = price + value;
  else if (mode === 'sub') v = price - value;
  else if (mode === 'set') v = value;
  if (round > 0 && mode !== 'set') v = Math.round(v / round) * round;
  const f = 10 ** dec;
  return Math.max(0, Math.round(v * f) / f);
}

const DAY = 86400000;

export function daysSince(ts) {
  const start = (t) => new Date(t).setHours(0, 0, 0, 0);
  return Math.round((start(Date.now()) - start(ts)) / DAY);
}

export function timeAgo(ts) {
  const d = daysSince(ts);
  if (d <= 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d < 14) return `hace ${d} días`;
  if (d < 60) return `hace ${Math.round(d / 7)} semanas`;
  if (d < 365) return `hace ${Math.round(d / 30)} meses`;
  return 'hace más de un año';
}

export const fmtDate = (ts) => new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtDateTime = (ts) => `${fmtDate(ts)} ${new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;

export function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// "Los_Patricios_Catalogo_Tiny.pdf" -> "Tiny" (todos son catálogos de Los Patricios).
// Se puede cambiar después con "Renombrar".
export function prettyName(fileName) {
  const clean = (s) => s.replace(/\s+/g, ' ').trim();
  const base = clean(fileName.replace(/\.pdf$/i, '').replace(/_+/g, ' '));
  const short = clean(base
    .replace(/\blos patricios\b/gi, ' ')
    .replace(/\bcat[aá]logo\b/gi, ' ')
    .replace(/\b(con portada|portada correcta|precios rojos|final)\b/gi, ' '));
  const name = short || base;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function median(list) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function download(blob, fileName) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
