// Guardado local (IndexedDB): todo queda en el celular, nada se sube a internet.
//   pdfs     -> datos de cada catálogo (nombre, estado de precios, portada)
//   files    -> el PDF original tal cual se cargó
//   products -> cada producto encontrado en el PDF, con su precio original y el actual
//   outputs  -> último PDF generado con los precios nuevos (para no rearmarlo cada vez)

const DB_NAME = 'catalogos';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('pdfs', { keyPath: 'id' });
        db.createObjectStore('files', { keyPath: 'id' });
        db.createObjectStore('products', { keyPath: 'id' }).createIndex('pdfId', 'pdfId');
        db.createObjectStore('outputs', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const result = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Transacción cancelada'));
});

export async function getAll(store) {
  const db = await open();
  return result(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await open();
  return result(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function putMany(store, values) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  return done(tx);
}

export async function productsOf(pdfId) {
  const db = await open();
  const list = await result(db.transaction('products').objectStore('products').index('pdfId').getAll(pdfId));
  return list.sort((a, b) => a.idx - b.idx);
}

// Guarda un catálogo nuevo completo en una sola transacción.
export async function addCatalog(pdf, blob, products) {
  const db = await open();
  const tx = db.transaction(['pdfs', 'files', 'products'], 'readwrite');
  tx.objectStore('files').put({ id: pdf.id, blob });
  const os = tx.objectStore('products');
  for (const p of products) os.put(p);
  tx.objectStore('pdfs').put(pdf);
  return done(tx);
}

export async function deleteCatalog(id) {
  const db = await open();
  const tx = db.transaction(['pdfs', 'files', 'products', 'outputs'], 'readwrite');
  tx.objectStore('pdfs').delete(id);
  tx.objectStore('files').delete(id);
  tx.objectStore('outputs').delete(id);
  const req = tx.objectStore('products').index('pdfId').openKeyCursor(IDBKeyRange.only(id));
  req.onsuccess = () => {
    const cur = req.result;
    if (cur) {
      tx.objectStore('products').delete(cur.primaryKey);
      cur.continue();
    }
  };
  return done(tx);
}
