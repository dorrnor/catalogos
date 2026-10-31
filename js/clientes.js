// Buscar clientes: comercios cerca de un punto (datos abiertos de Overture Maps guardados en
// el celular), con mensajes de WhatsApp armados y seguimiento de a quién ya se le escribió.
// Todo lo que se marca (mensaje enviado, respondió, cliente, notas) queda solo en este celular.
import * as db from './db.js';
import { I, tabs, openSheet, snack } from './ui.js';
import { prepareShare } from './compartir.js';
import { esc, uid, normalize, fmtDate, fmtDateTime, fmtNum, plural, telefonoAR, distanciaKm, fmtKm } from './util.js';

const ESTADOS = {
  nuevo: { nombre: 'Sin contactar', corto: 'Nuevo', color: '#d60d14' },
  contactado: { nombre: 'Mensaje enviado', corto: 'Escrito', color: '#8a8f98' },
  respondio: { nombre: 'Respondió', corto: 'Respondió', color: '#1d6fd6' },
  cliente: { nombre: 'Es cliente', corto: 'Cliente', color: '#137a3a' },
  no: { nombre: 'No le interesa', corto: 'No le interesa', color: '#4b4f55' },
};
const VISTAS = { para: 'Para contactar', seguimiento: 'Seguimiento', clientes: 'Clientes', todos: 'Todos' };
const RADIOS = [1, 3, 5, 10, 20];
const GRUPOS = ['Con celular', 'Con teléfono fijo', 'Sin teléfono'];
const PAGINA = 50;
const ZONA = 'amba';
const MAX_EN_MAPA = 3000;

const MENSAJES_INICIALES = [
  {
    id: 'tranquilo', nombre: 'Tranquilo', catalogos: false,
    texto: 'Hola, ¿cómo andan? 👋 Somos de Distribuidora Los Patricios, mayoristas de juguetería, librería y bazar. Si en algún momento necesitan mercadería, escríbannos y les pasamos precios. ¡Buena semana!',
  },
  {
    id: 'presentacion', nombre: 'Presentación', catalogos: false,
    texto: 'Hola, buenas, ¿cómo están? Somos de Distribuidora Los Patricios, mayoristas de juguetería, librería, bazar y artículos de temporada. Trabajamos con comercios de la zona y nos encantaría sumarlos como clientes. Cualquier consulta, estamos atentos. ¡Saludos!',
  },
  {
    id: 'catalogos', nombre: 'Presentación con catálogos', catalogos: true, pdfIds: [],
    texto: 'Hola, buenas, ¿cómo estás? Somos de Distribuidora Los Patricios, mayoristas de juguetería, librería y bazar. Te dejamos nuestros catálogos por si te interesa. Estamos atentos a cualquier consulta. ¡Saludos!',
  },
];

const st = {
  cargado: false,
  zona: null, // lo guardado de la zona: version, nombre, rubros...
  items: [],
  porId: new Map(),
  localidades: [],
  rubros: new Map(),
  contactos: new Map(),
  prefs: { centro: null, radio: 5, rubros: [], vista: 'para', soloCel: false, modo: 'lista' },
  mensajes: { lista: MENSAJES_INICIALES, vendedor: '' },
  limite: PAGINA,
  mapa: null,
  capa: null,
  eligiendoEnMapa: false,
  revisado: false,
};
let app = null;

// ---------------------------------------------------------------------------
// Datos

async function cargar() {
  if (st.cargado) return;
  const [zona, contactos, prefs, mensajes] = await Promise.all([
    db.get('comercios', ZONA), db.getAll('contactos'), db.get('ajustes', 'clientes'), db.get('ajustes', 'mensajes'),
  ]);
  if (zona) usarDatos(zona);
  for (const c of contactos) st.contactos.set(c.id, c);
  if (prefs) st.prefs = { ...st.prefs, ...prefs };
  if (mensajes) st.mensajes = mensajes;
  st.cargado = true;
}

function usarDatos(zona) {
  const campos = zona.campos;
  st.zona = { version: zona.version, nombre: zona.nombre, bajado: zona.bajado, cantidad: zona.items.length };
  st.items = zona.items.map((fila) => {
    const it = {};
    campos.forEach((k, i) => { it[k] = fila[i]; });
    return it;
  });
  st.porId = new Map(st.items.map((it) => [it.id, it]));
  st.rubros = new Map((zona.rubros || []).map((r) => [r.id, r.nombre]));
  st.rubros.set('otro', 'Otro');
  const acc = new Map();
  for (const it of st.items) {
    if (!it.localidad) continue;
    const k = normalize(it.localidad);
    const e = acc.get(k) || { nombre: it.localidad, lat: 0, lon: 0, n: 0 };
    e.lat += it.lat;
    e.lon += it.lon;
    e.n++;
    acc.set(k, e);
  }
  st.localidades = [...acc.values()].filter((e) => e.n >= 3)
    .map((e) => ({ nombre: e.nombre, lat: e.lat / e.n, lon: e.lon / e.n, n: e.n }))
    .sort((a, b) => b.n - a.n);
}

async function bajarDatos() {
  const sheet = openSheet(`
    <h2>Bajando comercios…</h2>
    <p class="sheet-sub">Quedan guardados en este celular. Se hace una sola vez y se actualiza una vez por mes.</p>
    <div class="spinner"></div>`);
  sheet.locked = true;
  try {
    const indice = await (await fetch('datos/indice.json', { cache: 'no-cache' })).json();
    const z = indice.zonas.find((x) => x.id === ZONA) || indice.zonas[0];
    const datos = await (await fetch(`datos/${z.archivo}`, { cache: 'no-cache' })).json();
    const registro = { ...datos, zona: ZONA, rubros: indice.rubros, bajado: Date.now() };
    await db.put('comercios', registro);
    usarDatos(registro);
    sheet.locked = false;
    sheet.close();
    snack(`${plural(datos.items.length, 'comercio guardado', 'comercios guardados')} en el celular`);
    renderClientes(app);
  } catch (err) {
    console.error(err);
    sheet.locked = false;
    sheet.set(`
      <h2>No se pudieron bajar</h2>
      <p class="sheet-sub">Revisá que haya internet y probá de nuevo. (${esc(err.message)})</p>
      <div class="sheet-actions"><button class="btn-primary" data-close>Cerrar</button></div>`);
  }
}

async function revisarActualizacion() {
  if (!st.zona || st.revisado || !navigator.onLine) return;
  st.revisado = true;
  try {
    const indice = await (await fetch('datos/indice.json', { cache: 'no-cache' })).json();
    const box = document.getElementById('cl-update');
    if (box && indice.version !== st.zona.version) {
      box.innerHTML = `
        <div class="update-banner">${I.cloud}<span>Hay datos nuevos de comercios (${esc(indice.actualizado || indice.version)}).</span>
          <button class="btn-ghost small" data-act="bajar">Actualizar</button></div>`;
    }
  } catch { /* sin internet: se usa lo guardado */ }
}

const guardarPrefs = () => db.put('ajustes', { id: 'clientes', ...st.prefs });
const guardarMensajes = () => db.put('ajustes', { id: 'mensajes', ...st.mensajes });
const rubroNombre = (id) => st.rubros.get(id) || 'Comercio';
const estadoDe = (id) => st.contactos.get(id)?.estado || 'nuevo';
const tieneCelular = (it) => it.tipo === 'c' || it.tipo === 'p';
const grupo = (it) => (tieneCelular(it) ? 0 : it.tipo === 'f' ? 1 : 2);
const usaRadio = () => st.prefs.vista === 'para' || st.prefs.vista === 'todos';
const seguro = (url) => (/^https?:\/\//i.test(url || '') ? url : '');

// Comercios de los datos + los agregados a mano + los que ya no figuran en los datos nuevos
// pero tienen seguimiento (se muestran con lo que se guardó de ellos).
function todos() {
  const extra = [];
  for (const ct of st.contactos.values()) {
    if (!st.porId.has(ct.id) && ct.snap) extra.push({ ...ct.snap, id: ct.id, manual: !!ct.manual });
  }
  return extra.length ? st.items.concat(extra) : st.items;
}

function resultados() {
  const { centro, radio, vista, soloCel } = st.prefs;
  const rubros = new Set(st.prefs.rubros);
  const conRadio = usaRadio();
  const out = [];
  for (const it of todos()) {
    if (rubros.size && !rubros.has(it.rubro) && !it.manual) continue;
    const estado = estadoDe(it.id);
    if (vista === 'para' && estado !== 'nuevo') continue;
    if (vista === 'seguimiento' && estado !== 'contactado' && estado !== 'respondio') continue;
    if (vista === 'clientes' && estado !== 'cliente') continue;
    if (soloCel && !tieneCelular(it)) continue;
    const d = centro ? distanciaKm(centro, it) : null;
    if (conRadio && (d === null || d > radio)) continue;
    out.push({ it, d, estado });
  }
  if (conRadio) out.sort((a, b) => grupo(a.it) - grupo(b.it) || a.d - b.d);
  else out.sort((a, b) => (st.contactos.get(b.it.id)?.actualizado || 0) - (st.contactos.get(a.it.id)?.actualizado || 0));
  return out;
}

function snapshot(it) {
  const { nombre, rubro, lat, lon, wa, tel, tipo, direccion, localidad, red, web } = it;
  return { nombre, rubro, lat, lon, wa, tel, tipo, direccion, localidad, red, web };
}

async function registrar(it, cambios, evento) {
  const prev = st.contactos.get(it.id);
  const ct = {
    id: it.id, estado: 'nuevo', notas: '', historial: [],
    ...prev, ...cambios, snap: snapshot(it), actualizado: Date.now(),
  };
  if (evento) ct.historial = [...(prev?.historial || []), { fecha: Date.now(), ...evento }];
  st.contactos.set(it.id, ct);
  await db.put('contactos', ct);
  return prev;
}

async function deshacer(it, prev) {
  if (prev) {
    st.contactos.set(it.id, prev);
    await db.put('contactos', prev);
  } else {
    st.contactos.delete(it.id);
    await db.del('contactos', it.id);
  }
  renderResultados();
}

function completar(texto, it) {
  return texto
    .replaceAll('{comercio}', it.nombre)
    .replaceAll('{vendedor}', st.mensajes.vendedor || '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const irUrl = (it) => `https://www.google.com/maps/dir/?api=1&destination=${it.lat},${it.lon}`;
const verUrl = (it) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([it.nombre, it.direccion, it.localidad].filter(Boolean).join(', '))}`;

// ---------------------------------------------------------------------------
// Pantalla

export async function renderClientes(root) {
  app = root;
  await cargar();
  app.onclick = onClick;
  app.onchange = onChange;
  app.innerHTML = `
    <header class="appbar">
      <div class="appbar-main">
        <div class="brand">
          <div class="brand-title">Buscar clientes</div>
          <div class="brand-sub">${st.zona ? `${fmtNum(st.zona.cantidad)} comercios · ${esc(st.zona.nombre)}` : 'Comercios para ofrecerles mercadería'}</div>
        </div>
        ${st.zona ? `<button class="btn-ghost" data-act="mensajes">${I.chat}<span>Mensajes</span></button>` : ''}
      </div>
      ${tabs('clientes')}
    </header>
    <main class="content" id="cl-main"></main>`;
  const main = document.getElementById('cl-main');
  if (!st.zona) {
    main.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${I.store}</div>
        <h2>Encontrá comercios para ofrecerles mercadería</h2>
        <p>Jugueterías, librerías, bazares, cotillones y más, con teléfono, dirección y mapa.
           Se bajan una sola vez (unos 1,3 MB) y quedan guardados en el celular: después funciona sin internet.</p>
        <button class="btn-primary big-btn" data-act="bajar">${I.cloud}Bajar comercios de AMBA y La Plata</button>
        <p class="attribution">Datos abiertos y gratuitos de Overture Maps (Meta, Microsoft, Foursquare y otros).</p>
      </div>`;
    return;
  }
  main.innerHTML = `
    <div id="cl-update"></div>
    <button class="zone-btn" data-act="zona">
      <span class="zone-ico">${I.pin}</span>
      <span class="zone-txt"><small>Buscando cerca de</small><b id="cl-centro"></b></span>
      <span class="zone-change">Cambiar</span>
    </button>
    <div class="chip-row scroll" id="cl-radios"></div>
    <div class="chip-row scroll" id="cl-rubros"></div>
    <div class="vistas" id="cl-vistas"></div>
    <div class="tools-row">
      <label class="switch"><input type="checkbox" id="cl-cel"><span>Solo con celular</span></label>
      <div class="view-toggle" id="cl-modo">
        <button data-modo="lista">${I.list}<span>Lista</span></button>
        <button data-modo="mapa">${I.map}<span>Mapa</span></button>
      </div>
    </div>
    <p class="summary" id="cl-summary"></p>
    <div id="cl-results"></div>
    <div class="cl-extra">
      <button class="btn-secondary" data-act="agregar">${I.add}Agregar un comercio a mano</button>
      <a class="btn-secondary" id="cl-google" target="_blank" rel="noopener">${I.link}Buscar más en Google Maps</a>
    </div>
    <p class="attribution">Comercios: Overture Maps Foundation (datos de Meta, Microsoft, Foursquare y otros), versión ${esc(st.zona.version)}.
      Mapa © colaboradores de OpenStreetMap. Lo que marcás queda solo en este celular.</p>`;
  renderControles();
  renderResultados();
  revisarActualizacion();
}

function renderControles() {
  const p = st.prefs;
  document.getElementById('cl-centro').textContent = p.centro ? p.centro.nombre : 'Elegí dónde buscar';
  const radios = document.getElementById('cl-radios');
  radios.hidden = !usaRadio();
  radios.innerHTML = `<span class="chip-label">Hasta</span>${RADIOS.map((r) => `<button class="chip ${r === p.radio ? 'on' : ''}" data-radio="${r}">${r} km</button>`).join('')}`;
  const elegidos = new Set(p.rubros);
  document.getElementById('cl-rubros').innerHTML = `
    <button class="chip ${elegidos.size ? '' : 'on'}" data-rubro="">Todos los rubros</button>
    ${[...st.rubros].filter(([id]) => id !== 'otro').map(([id, nombre]) => `<button class="chip ${elegidos.has(id) ? 'on' : ''}" data-rubro="${id}">${esc(nombre)}</button>`).join('')}`;
  let seguimiento = 0;
  let clientes = 0;
  for (const c of st.contactos.values()) {
    if (c.estado === 'contactado' || c.estado === 'respondio') seguimiento++;
    if (c.estado === 'cliente') clientes++;
  }
  const cuentas = { seguimiento, clientes };
  document.getElementById('cl-vistas').innerHTML = Object.entries(VISTAS).map(([k, nombre]) =>
    `<button class="${k === p.vista ? 'on' : ''}" data-vista="${k}">${nombre}${cuentas[k] ? ` <span class="count">${cuentas[k]}</span>` : ''}</button>`).join('');
  document.getElementById('cl-cel').checked = p.soloCel;
  document.querySelectorAll('#cl-modo [data-modo]').forEach((b) => b.classList.toggle('on', b.dataset.modo === p.modo));
  const centro = p.centro || { lat: -34.6037, lon: -58.3816 };
  const que = elegidos.size === 1 ? rubroNombre([...elegidos][0]).toLowerCase() : 'jugueterías';
  document.getElementById('cl-google').href = `https://www.google.com/maps/search/${encodeURIComponent(que)}/@${centro.lat},${centro.lon},14z`;
}

function renderResultados() {
  const box = document.getElementById('cl-results');
  if (!box) return;
  renderControles();
  const p = st.prefs;
  const summary = document.getElementById('cl-summary');
  if (usaRadio() && !p.centro) {
    summary.textContent = '';
    box.innerHTML = `
      <div class="empty small">
        <h2>¿Dónde querés buscar?</h2>
        <p>Usá tu ubicación, elegí una localidad o tocá un punto en el mapa.</p>
        <button class="btn-primary big-btn" data-act="zona">${I.pin}Elegir zona</button>
      </div>`;
    return;
  }
  const res = resultados();
  const cel = res.filter((r) => tieneCelular(r.it)).length;
  summary.innerHTML = {
    para: `<b>${fmtNum(res.length)}</b> para contactar a menos de ${p.radio} km · <b>${cel}</b> con celular`,
    todos: `<b>${fmtNum(res.length)}</b> comercios a menos de ${p.radio} km · <b>${cel}</b> con celular`,
    seguimiento: `<b>${res.length}</b> ${res.length === 1 ? 'comercio al que le escribiste' : 'comercios a los que les escribiste'}`,
    clientes: `<b>${res.length}</b> ${res.length === 1 ? 'cliente' : 'clientes'}`,
  }[p.vista];
  if (p.modo === 'mapa') renderMapa(box, res);
  else renderLista(box, res);
}

function renderLista(box, res) {
  if (st.mapa) { st.mapa.remove(); st.mapa = null; }
  if (!res.length) {
    const vacio = {
      para: 'No hay comercios sin contactar en esta zona. Probá con más kilómetros o con otros rubros.',
      todos: 'No hay comercios en esta zona. Probá con más kilómetros o con otros rubros.',
      seguimiento: 'Todavía no le escribiste a ningún comercio. Cuando lo hagas desde acá, aparecen en esta lista.',
      clientes: 'Cuando marques a un comercio como cliente, aparece acá.',
    }[st.prefs.vista];
    box.innerHTML = `<p class="no-results">${vacio}</p>`;
    return;
  }
  const porGrupo = [0, 0, 0];
  for (const r of res) porGrupo[grupo(r.it)]++;
  let html = '';
  let actual = -1;
  for (const r of res.slice(0, st.limite)) {
    if (usaRadio() && grupo(r.it) !== actual) {
      actual = grupo(r.it);
      html += `<h3 class="grp">${GRUPOS[actual]} <span>${porGrupo[actual]}</span></h3>`;
    }
    html += tarjeta(r);
  }
  if (res.length > st.limite) html += `<button class="btn-secondary more" data-act="mas">Mostrar más (${fmtNum((res.length - st.limite))})</button>`;
  box.innerHTML = `<div class="lead-list">${html}</div>`;
}

function tarjeta({ it, d, estado }) {
  const ct = st.contactos.get(it.id);
  const escrito = ct?.fechaContacto ? ` ${fmtDate(ct.fechaContacto)}` : '';
  return `
    <article class="lead est-${estado}" data-id="${esc(it.id)}" tabindex="0">
      <span class="lead-dot" style="background:${ESTADOS[estado].color}"></span>
      <div class="lead-main">
        <div class="lead-name">${esc(it.nombre)}</div>
        <div class="lead-meta">${esc(rubroNombre(it.rubro))}${it.localidad ? ` · ${esc(it.localidad)}` : ''}${d !== null && d !== undefined ? ` · <b>${fmtKm(d)}</b>` : ''}</div>
        <div class="lead-tags">
          ${it.tel ? `<span class="tag ${tieneCelular(it) ? 'cel' : ''}">${esc(it.tel)}${tieneCelular(it) ? ' · cel' : ' · fijo'}</span>` : '<span class="tag off">Sin teléfono</span>'}
          ${estado !== 'nuevo' ? `<span class="tag est">${estado === 'contactado' ? I.check : ''}${ESTADOS[estado].nombre}${estado === 'contactado' ? escrito : ''}</span>` : ''}
          ${it.manual ? '<span class="tag">Agregado a mano</span>' : ''}
          ${typeof it.conf === 'number' && it.conf < 0.35 ? '<span class="tag warn">Puede estar cerrado</span>' : ''}
        </div>
      </div>
      ${it.wa ? `
      <div class="lead-actions">
        <button class="round wa" data-wa aria-label="Mandar WhatsApp">${I.chat}</button>
        <a class="round" href="tel:+${it.wa}" data-call aria-label="Llamar">${I.phone}</a>
      </div>` : ''}
    </article>`;
}

// ---------------------------------------------------------------------------
// Mapa (Leaflet + OpenStreetMap; necesita internet para dibujar las calles)

let leafletPromise = null;
function cargarLeaflet() {
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/leaflet/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = 'vendor/leaflet/leaflet.js';
      s.onload = () => resolve(window.L);
      s.onerror = () => { leafletPromise = null; reject(new Error('No se pudo cargar el mapa')); };
      document.head.appendChild(s);
    });
  }
  return leafletPromise;
}

const zoomPara = (km) => ({ 1: 15, 3: 14, 5: 13, 10: 12, 20: 11 }[km] || 13);

async function renderMapa(box, res) {
  if (!st.mapa || !box.contains(st.mapa.getContainer())) {
    if (st.mapa) { st.mapa.remove(); st.mapa = null; }
    box.innerHTML = `
      <div class="mapa-wrap">
        <div id="mapa" class="mapa"></div>
        <div class="mapa-aviso" id="mapa-aviso" hidden></div>
      </div>`;
    let L;
    try {
      L = await cargarLeaflet();
    } catch (err) {
      box.innerHTML = `<p class="no-results">${esc(err.message)}. Usá la vista de lista.</p>`;
      return;
    }
    if (!document.getElementById('mapa')) return;
    const c = st.prefs.centro || { lat: -34.6037, lon: -58.3816 };
    st.mapa = L.map('mapa', { preferCanvas: true }).setView([c.lat, c.lon], zoomPara(st.prefs.radio));
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(st.mapa);
    st.capa = L.layerGroup().addTo(st.mapa);
    st.mapa.on('click', (e) => {
      if (!st.eligiendoEnMapa) return;
      st.eligiendoEnMapa = false;
      ponerCentro({ lat: e.latlng.lat, lon: e.latlng.lng, nombre: 'Punto elegido en el mapa' });
    });
  }
  const L = window.L;
  st.capa.clearLayers();
  const p = st.prefs;
  if (p.centro) {
    if (usaRadio()) {
      L.circle([p.centro.lat, p.centro.lon], { radius: p.radio * 1000, color: '#d60d14', weight: 1.5, fillOpacity: 0.04 }).addTo(st.capa);
    }
    L.circleMarker([p.centro.lat, p.centro.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#1d6fd6', fillOpacity: 1 })
      .bindTooltip(esc(p.centro.nombre)).addTo(st.capa);
  }
  for (const r of res.slice(0, MAX_EN_MAPA)) {
    L.circleMarker([r.it.lat, r.it.lon], {
      radius: tieneCelular(r.it) ? 7 : 5, color: '#fff', weight: 1.5,
      fillColor: ESTADOS[r.estado].color, fillOpacity: r.estado === 'contactado' || r.estado === 'no' ? 0.55 : 0.95,
    }).bindTooltip(esc(r.it.nombre)).on('click', () => openDetalle(r.it)).addTo(st.capa);
  }
  const aviso = document.getElementById('mapa-aviso');
  if (aviso) {
    aviso.hidden = !st.eligiendoEnMapa && res.length <= MAX_EN_MAPA;
    aviso.textContent = st.eligiendoEnMapa ? 'Tocá el mapa en el lugar donde querés buscar'
      : `Se muestran los ${MAX_EN_MAPA} más cercanos. Achicá la distancia o elegí rubros para ver el resto.`;
  }
  setTimeout(() => st.mapa?.invalidateSize(), 50);
}

function ponerCentro(centro) {
  st.prefs.centro = centro;
  st.limite = PAGINA;
  guardarPrefs();
  if (st.mapa) st.mapa.setView([centro.lat, centro.lon], zoomPara(st.prefs.radio));
  renderResultados();
}

// ---------------------------------------------------------------------------
// Toques

function onClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'bajar') { bajarDatos(); return; }
  if (act === 'zona') { openZona(); return; }
  if (act === 'mensajes') { openMensajes(); return; }
  if (act === 'agregar') { openAgregar(); return; }
  if (act === 'mas') { st.limite += PAGINA * 2; renderResultados(); return; }

  const b = e.target.closest('[data-radio],[data-rubro],[data-vista],[data-modo]');
  if (b) {
    const p = st.prefs;
    if (b.dataset.radio) {
      p.radio = Number(b.dataset.radio);
      if (st.mapa && p.centro) st.mapa.setView([p.centro.lat, p.centro.lon], zoomPara(p.radio));
    } else if (b.dataset.rubro !== undefined) {
      const id = b.dataset.rubro;
      const set = new Set(p.rubros);
      if (!id) set.clear();
      else if (set.has(id)) set.delete(id);
      else set.add(id);
      p.rubros = [...set];
    } else if (b.dataset.vista) {
      p.vista = b.dataset.vista;
    } else if (b.dataset.modo) {
      p.modo = b.dataset.modo;
    }
    st.limite = PAGINA;
    guardarPrefs();
    renderResultados();
    return;
  }

  const card = e.target.closest('.lead[data-id]');
  if (!card) return;
  const it = todos().find((x) => x.id === card.dataset.id);
  if (!it) return;
  if (e.target.closest('[data-wa]')) { openWhatsApp(it); return; }
  if (e.target.closest('[data-call]')) { registrar(it, {}, { accion: 'llamada' }); return; }
  openDetalle(it);
}

function onChange(e) {
  if (e.target.id === 'cl-cel') {
    st.prefs.soloCel = e.target.checked;
    st.limite = PAGINA;
    guardarPrefs();
    renderResultados();
  }
}

// ---------------------------------------------------------------------------
// Elegir zona

function openZona() {
  const sheet = openSheet(`
    <h2>¿Dónde querés buscar?</h2>
    <button class="option" data-z="gps">
      <span class="option-icon">${I.myLocation}</span>
      <span><b>Usar mi ubicación</b><small>Busca cerca de donde estás ahora.</small></span>
    </button>
    <button class="option" data-z="mapa">
      <span class="option-icon">${I.map}</span>
      <span><b>Elegir en el mapa</b><small>Tocás el mapa en el lugar donde querés buscar.</small></span>
    </button>
    <label class="field"><span>O escribí una localidad</span>
      <div class="input-wrap"><input id="loc" placeholder="Ej: Banfield, Quilmes, Lanús" autocomplete="off"></div>
    </label>
    <div class="loc-list" id="loc-list"></div>`);
  const input = sheet.el.querySelector('#loc');
  const lista = sheet.el.querySelector('#loc-list');
  const pintar = () => {
    const q = normalize(input.value).trim();
    const encontradas = (q ? st.localidades.filter((l) => normalize(l.nombre).includes(q)) : st.localidades).slice(0, 12);
    lista.innerHTML = encontradas.length
      ? encontradas.map((l, i) => `<button class="loc" data-i="${st.localidades.indexOf(l)}">${I.pin}<span>${esc(l.nombre)}</span><small>${l.n} comercios</small></button>`).join('')
      : '<p class="muted">No encontré esa localidad. Probá eligiendo en el mapa.</p>';
  };
  input.addEventListener('input', pintar);
  pintar();
  sheet.el.addEventListener('click', (e) => {
    const loc = e.target.closest('.loc[data-i]');
    if (loc) {
      const l = st.localidades[Number(loc.dataset.i)];
      sheet.close();
      ponerCentro({ lat: l.lat, lon: l.lon, nombre: l.nombre });
      return;
    }
    const z = e.target.closest('[data-z]')?.dataset.z;
    if (z === 'mapa') {
      sheet.close();
      st.prefs.modo = 'mapa';
      st.eligiendoEnMapa = true;
      guardarPrefs();
      renderResultados();
      snack('Tocá el mapa en el lugar donde querés buscar');
    }
    if (z === 'gps') {
      if (!navigator.geolocation) { snack('Este navegador no da la ubicación.'); return; }
      sheet.set(`<h2>Buscando tu ubicación…</h2><p class="sheet-sub">Si el celular pregunta, tocá <b>Permitir</b>.</p><div class="spinner"></div>`);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (sheet.closed) return;
          sheet.close();
          ponerCentro({ lat: pos.coords.latitude, lon: pos.coords.longitude, nombre: 'Tu ubicación' });
        },
        () => {
          if (sheet.closed) return;
          sheet.set(`
            <h2>No pude obtener tu ubicación</h2>
            <p class="sheet-sub">Revisá que la ubicación del celular esté prendida y que la app tenga permiso. También podés elegir una localidad.</p>
            <div class="sheet-actions"><button class="btn-primary" data-close>Entendido</button></div>`);
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Ficha de un comercio

function openDetalle(it) {
  const ct = st.contactos.get(it.id);
  const estado = ct?.estado || 'nuevo';
  const d = st.prefs.centro ? distanciaKm(st.prefs.centro, it) : null;
  const red = seguro(it.red);
  const web = seguro(it.web);
  const sheet = openSheet(`
    <div class="lead-head">
      <h2>${esc(it.nombre)}</h2>
      <div class="muted">${esc(rubroNombre(it.rubro))}${it.localidad ? ` · ${esc(it.localidad)}` : ''}${d !== null ? ` · ${fmtKm(d)}` : ''}</div>
    </div>
    ${typeof it.conf === 'number' && it.conf < 0.35 ? `<p class="aviso">${I.warn}<span>Puede que este local ya no esté abierto. Confirmalo en Google Maps antes de ir.</span></p>` : ''}
    ${it.direccion ? `<div class="kv"><span>Dirección</span><b>${esc(it.direccion)}</b></div>` : ''}
    <div class="kv"><span>Teléfono</span><b>${it.tel ? `${esc(it.tel)} · ${it.tipo === 'f' ? 'fijo' : it.tipo === 'c' ? 'celular' : 'probable celular'}` : 'No tiene'}</b></div>
    <div class="contact-btns">
      ${it.wa ? `
        <button class="cbtn wa" data-d="wa">${I.chat}<span>WhatsApp</span></button>
        <a class="cbtn" href="tel:+${it.wa}" data-d="call">${I.phone}<span>Llamar</span></a>` : ''}
      <a class="cbtn" href="${irUrl(it)}" target="_blank" rel="noopener">${I.directions}<span>Cómo llegar</span></a>
    </div>
    <div class="link-row">
      <a href="${verUrl(it)}" target="_blank" rel="noopener">${I.link}Ver en Google Maps</a>
      ${red ? `<a href="${esc(red)}" target="_blank" rel="noopener">${I.link}${red.includes('instagram') ? 'Instagram' : 'Facebook'}</a>` : ''}
      ${web ? `<a href="${esc(web)}" target="_blank" rel="noopener">${I.link}Web</a>` : ''}
    </div>
    <div class="field"><span>Estado</span>
      <div class="seg small estados">${Object.entries(ESTADOS).map(([k, e]) => `<button data-estado="${k}" class="${k === estado ? 'on' : ''}">${e.corto}</button>`).join('')}</div>
    </div>
    <label class="field"><span>Notas</span>
      <textarea id="notas" rows="3" placeholder="Ej: pidió lista de bazar, volver a escribir en diciembre">${esc(ct?.notas || '')}</textarea>
    </label>
    ${historial(ct)}
    ${it.manual ? `<button class="btn-secondary danger-text" data-d="borrar">${I.trash}Borrar este comercio</button>` : ''}
  `, {
    onClose: () => {
      const notas = sheet.el.querySelector('#notas')?.value.trim() ?? '';
      if (notas !== (st.contactos.get(it.id)?.notas || '')) {
        registrar(it, { notas }).then(renderResultados);
      }
    },
  });
  sheet.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-estado],[data-d]');
    if (!b) return;
    if (b.dataset.estado) {
      const k = b.dataset.estado;
      const cambios = { estado: k };
      if (k === 'contactado' && !st.contactos.get(it.id)?.fechaContacto) cambios.fechaContacto = Date.now();
      await registrar(it, cambios, { accion: 'estado', detalle: ESTADOS[k].nombre });
      sheet.el.querySelectorAll('[data-estado]').forEach((x) => x.classList.toggle('on', x.dataset.estado === k));
      renderResultados();
      return;
    }
    if (b.dataset.d === 'wa') { sheet.close(); setTimeout(() => openWhatsApp(it), 250); return; }
    if (b.dataset.d === 'call') { registrar(it, {}, { accion: 'llamada' }); return; }
    if (b.dataset.d === 'borrar') {
      st.contactos.delete(it.id);
      await db.del('contactos', it.id);
      sheet.close();
      renderResultados();
      snack('Comercio borrado');
    }
  });
}

function historial(ct) {
  const eventos = (ct?.historial || []).filter((h) => h.accion !== 'alta').slice(-6).reverse();
  if (!eventos.length) return '';
  const texto = (h) => ({
    whatsapp: `WhatsApp: ${h.detalle || 'mensaje'}`,
    llamada: 'Llamada',
    estado: `Marcado: ${h.detalle}`,
  }[h.accion] || h.accion);
  return `
    <div class="hist">
      <div class="hist-title">Historial</div>
      ${eventos.map((h) => `<div class="hist-row"><span>${esc(texto(h))}</span><small>${fmtDateTime(h.fecha)}</small></div>`).join('')}
    </div>`;
}

// ---------------------------------------------------------------------------
// WhatsApp con mensaje armado (y catálogos, si el mensaje los ofrece)

function openWhatsApp(it) {
  const lista = st.mensajes.lista;
  let elegido = lista[0];
  const pdfsP = db.getAll('pdfs');
  const sheet = openSheet(`
    <h2>Mensaje por WhatsApp</h2>
    <p class="sheet-sub">Para ${esc(it.nombre)} · ${esc(it.tel)}</p>
    <div class="tpl-list" id="tpls">
      ${lista.map((m, i) => `<button class="tpl ${i === 0 ? 'on' : ''}" data-i="${i}"><b>${esc(m.nombre)}</b>${m.catalogos && !/cat[aá]log/i.test(m.nombre) ? '<small>+ catálogos</small>' : ''}</button>`).join('')}
    </div>
    <label class="field"><span>Mensaje (lo podés cambiar antes de mandar)</span>
      <textarea id="txt" rows="7"></textarea>
    </label>
    <div id="cats"></div>
    <button class="btn-share" id="send">${I.chat}Abrir WhatsApp</button>
    <p class="hint">Se abre WhatsApp con el mensaje escrito: lo revisás y tocás enviar. El comercio queda marcado como <b>mensaje enviado</b>.</p>`, { cls: 'tall' });
  const txt = sheet.el.querySelector('#txt');
  const cats = sheet.el.querySelector('#cats');
  const pintar = async () => {
    txt.value = completar(elegido.texto, it);
    cats.innerHTML = '';
    if (!elegido.catalogos) return;
    const pdfs = (await pdfsP).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    cats.innerHTML = pdfs.length ? `
      <div class="field"><span>Catálogos para mandar después del mensaje</span>
        <div class="check-list">${pdfs.map((p) => `<label><input type="checkbox" value="${esc(p.id)}" ${elegido.pdfIds?.includes(p.id) ? 'checked' : ''}><span>${esc(p.name)}</span></label>`).join('')}</div>
      </div>` : '<p class="hint">Todavía no cargaste catálogos en la pestaña Catálogos.</p>';
  };
  pintar();
  sheet.el.querySelector('#tpls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    elegido = lista[Number(b.dataset.i)];
    sheet.el.querySelectorAll('.tpl').forEach((x) => x.classList.toggle('on', x === b));
    pintar();
  });
  sheet.el.querySelector('#send').addEventListener('click', async () => {
    const texto = txt.value.trim();
    // Tiene que abrirse en el mismo toque, antes de cualquier espera.
    window.open(`https://wa.me/${it.wa}?text=${encodeURIComponent(texto)}`, '_blank');
    const elegidos = [...cats.querySelectorAll('input:checked')].map((c) => c.value);
    const estado = estadoDe(it.id);
    const prev = await registrar(it, {
      estado: estado === 'nuevo' ? 'contactado' : estado,
      fechaContacto: st.contactos.get(it.id)?.fechaContacto || Date.now(),
    }, { accion: 'whatsapp', detalle: elegido.nombre });
    renderResultados();
    if (!elegidos.length) {
      sheet.close();
      snack('Marcado como mensaje enviado', { label: 'Deshacer', run: () => deshacer(it, prev) });
      return;
    }
    const pdfs = (await pdfsP).filter((p) => elegidos.includes(p.id));
    sheet.set(`
      <h2>Ahora mandale los catálogos</h2>
      <p class="sheet-sub">Cuando vuelvas de WhatsApp, tocá el botón. En la lista de WhatsApp, el chat con <b>${esc(it.nombre)}</b> va a aparecer primero.</p>
      <button class="btn-share" id="prep">${I.file}Preparar ${plural(pdfs.length, 'catálogo', 'catálogos')}</button>
      <div class="sheet-actions"><button class="btn-secondary" data-close>Ahora no</button></div>`);
    sheet.el.querySelector('#prep').addEventListener('click', () => {
      prepareShare(sheet, pdfs, 'pdf', null, `Elegí <b>WhatsApp</b> y después el chat con <b>${esc(it.nombre)}</b> (aparece primero).`);
    });
  });
}

// ---------------------------------------------------------------------------
// Mensajes guardados

function openMensajes() {
  const sheet = openSheet('', { cls: 'tall' });
  const lista = () => st.mensajes.lista;

  const verLista = () => {
    sheet.set(`
      <h2>Mensajes guardados</h2>
      <p class="sheet-sub">Son los que aparecen al tocar WhatsApp. Si escribís <b>{comercio}</b>, se reemplaza por el nombre del local.</p>
      <div class="tpl-rows">
        ${lista().map((m, i) => `
          <button class="tpl-row" data-edit="${i}">
            <span><b>${esc(m.nombre)}</b><small>${esc(m.texto.slice(0, 90))}${m.texto.length > 90 ? '…' : ''}</small></span>
            ${I.edit}
          </button>`).join('')}
      </div>
      <button class="btn-secondary wide" data-nuevo>${I.add}Agregar otro mensaje</button>
      <label class="field"><span>Tu nombre (opcional, se usa si escribís {vendedor})</span>
        <div class="input-wrap"><input id="vend" value="${esc(st.mensajes.vendedor || '')}" autocomplete="off" placeholder="Ej: Alejo"></div>
      </label>
      <div class="sheet-actions"><button class="btn-primary" data-close>Listo</button></div>`);
  };

  const editar = async (i) => {
    const nuevo = i === -1;
    const m = nuevo ? { id: uid(), nombre: '', texto: '', catalogos: false, pdfIds: [] } : { ...lista()[i] };
    const pdfs = (await db.getAll('pdfs')).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    sheet.set(`
      <h2>${nuevo ? 'Mensaje nuevo' : 'Editar mensaje'}</h2>
      <label class="field"><span>Nombre del mensaje</span>
        <div class="input-wrap"><input id="m-nombre" value="${esc(m.nombre)}" placeholder="Ej: Presentación temporada" autocomplete="off"></div>
      </label>
      <label class="field"><span>Texto</span><textarea id="m-texto" rows="8">${esc(m.texto)}</textarea></label>
      <label class="switch"><input type="checkbox" id="m-cats" ${m.catalogos ? 'checked' : ''}><span>Ofrecer mandar catálogos después del mensaje</span></label>
      <div class="check-list" id="m-pdfs" ${m.catalogos ? '' : 'hidden'}>
        ${pdfs.length ? pdfs.map((p) => `<label><input type="checkbox" value="${esc(p.id)}" ${m.pdfIds?.includes(p.id) ? 'checked' : ''}><span>${esc(p.name)}</span></label>`).join('') : '<p class="hint">Todavía no cargaste catálogos.</p>'}
      </div>
      <div class="sheet-actions">
        ${nuevo || lista().length <= 1 ? '<button class="btn-secondary" data-volver>Cancelar</button>' : `<button class="btn-secondary danger-text" data-borrar>${I.trash}Borrar</button>`}
        <button class="btn-primary" data-guardar>Guardar</button>
      </div>`);
    sheet.el.querySelector('#m-cats').addEventListener('change', (e) => { sheet.el.querySelector('#m-pdfs').hidden = !e.target.checked; });
    sheet.el.querySelector('[data-guardar]').addEventListener('click', async () => {
      m.nombre = sheet.el.querySelector('#m-nombre').value.trim() || 'Mensaje';
      m.texto = sheet.el.querySelector('#m-texto').value.trim();
      if (!m.texto) { snack('Escribí el texto del mensaje.'); return; }
      m.catalogos = sheet.el.querySelector('#m-cats').checked;
      m.pdfIds = [...sheet.el.querySelectorAll('#m-pdfs input:checked')].map((c) => c.value);
      st.mensajes.lista = nuevo ? [...lista(), m] : lista().map((x, k) => (k === i ? m : x));
      await guardarMensajes();
      verLista();
    });
    sheet.el.querySelector('[data-volver]')?.addEventListener('click', verLista);
    sheet.el.querySelector('[data-borrar]')?.addEventListener('click', async () => {
      st.mensajes.lista = lista().filter((_, k) => k !== i);
      await guardarMensajes();
      verLista();
    });
  };

  sheet.el.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) editar(Number(ed.dataset.edit));
    if (e.target.closest('[data-nuevo]')) editar(-1);
  });
  sheet.el.addEventListener('change', async (e) => {
    if (e.target.id === 'vend') {
      st.mensajes.vendedor = e.target.value.trim();
      await guardarMensajes();
    }
  });
  verLista();
}

// ---------------------------------------------------------------------------
// Agregar un comercio a mano (por ejemplo, uno encontrado en Google Maps)

function openAgregar() {
  const centro = st.prefs.centro;
  const sheet = openSheet(`
    <h2>Agregar un comercio</h2>
    <p class="sheet-sub">Para sumar uno que encontraste en Google Maps o en la calle. Queda guardado solo en este celular.</p>
    <label class="field"><span>Nombre del comercio</span><div class="input-wrap"><input id="a-nombre" autocomplete="off"></div></label>
    <label class="field"><span>Teléfono o celular</span><div class="input-wrap"><input id="a-tel" inputmode="tel" autocomplete="off" placeholder="Ej: 11 2345-6789"></div></label>
    <label class="field"><span>Rubro</span>
      <div class="input-wrap"><select id="a-rubro">${[...st.rubros].map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select></div>
    </label>
    <label class="field"><span>Dirección (opcional)</span><div class="input-wrap"><input id="a-dir" autocomplete="off"></div></label>
    <p class="hint">${centro ? `Se ubica en el mapa en: <b>${esc(centro.nombre)}</b>.` : 'Primero elegí una zona de búsqueda para ubicarlo en el mapa.'}</p>
    <div class="sheet-actions">
      <button class="btn-secondary" data-close>Cancelar</button>
      <button class="btn-primary" id="a-ok" ${centro ? '' : 'disabled'}>Guardar</button>
    </div>`);
  sheet.el.querySelector('#a-ok').addEventListener('click', async () => {
    const nombre = sheet.el.querySelector('#a-nombre').value.trim();
    if (!nombre) { snack('Escribí el nombre del comercio.'); return; }
    const crudo = sheet.el.querySelector('#a-tel').value.trim();
    const tel = telefonoAR(crudo);
    if (crudo && !tel) { snack('Ese teléfono no parece válido. Revisalo (con código de área).'); return; }
    const it = {
      id: `m-${uid()}`, manual: true, nombre, rubro: sheet.el.querySelector('#a-rubro').value,
      lat: centro.lat, lon: centro.lon, wa: tel?.wa || '', tel: tel?.tel || '', tipo: tel?.tipo || '',
      direccion: sheet.el.querySelector('#a-dir').value.trim(), localidad: '', red: '', web: '',
    };
    await registrar(it, { manual: true }, { accion: 'alta' });
    sheet.close();
    st.prefs.vista = 'para';
    renderResultados();
    snack('Comercio agregado');
  });
}
