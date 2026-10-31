# Catálogos Los Patricios

App para el celular (y la compu) que permite:

- **Cambiar precios de los catálogos PDF**: de a uno, eligiendo varios, o todos juntos.
  Se puede subir o bajar un %, sumar o restar un monto, o poner un precio fijo, con redondeo opcional.
- **Agregar PDFs nuevos** y editarlos igual.
- **Ver cuándo se actualizó cada catálogo**: "Nunca actualizado" (precios originales del PDF)
  o "Actualizado hace X días", con fecha y cuántos precios cambiaron.
- **Compartir** uno o varios catálogos por WhatsApp (o mail, etc.) con el menú de compartir del
  celular: como PDF para mandar a clientes, o como imágenes para el Estado de WhatsApp
  (el Estado no acepta PDF).

Funciona **sin internet** y todo queda guardado **en el dispositivo**: los PDFs y precios no se
suben a ningún lado.

## Cómo se usa

1. **Agregar PDF** → elegir uno o varios catálogos del celular. La app busca los precios
   (tarda unos segundos por catálogo).
2. Tocar un catálogo → aparece la lista de productos con foto, código y precio.
   - Tocar un producto → cambiar su precio.
   - **Mantener apretado** (o tocar la foto) → elegir varios → **Cambiar precio**.
   - **Cambiar todos** → aplica el cambio a todo el catálogo.
   - Después de cada cambio aparece **Deshacer** por unos segundos.
3. En la pantalla principal también se pueden elegir varios catálogos y cambiarles los precios
   a todos juntos, compartirlos o borrarlos.
4. **Compartir** → "Como PDF" o "Como imágenes" → **Compartir ahora** → WhatsApp → contactos,
   grupos o "Mi estado".

## Cómo funciona por dentro

- `js/analyze.js` lee el PDF con pdf.js, encuentra cada precio escrito como texto ("$ 1.234"),
  mira en la imagen de la página si se ve (algunos catálogos tienen precios viejos tapados) y
  toma su posición, color de letra y color de fondo. También asocia código, nombre y foto.
- `js/build.js` arma el PDF nuevo con pdf-lib: parte siempre del PDF original, tapa cada precio
  cambiado con su color de fondo y escribe el nuevo con el mismo color y tamaño.
- `js/app.js` son las pantallas; `js/db.js` el guardado local (IndexedDB); `sw.js` hace que
  abra sin internet.
- Sin herramientas de compilación: son archivos estáticos. pdf.js 4.10.38 y pdf-lib 1.17.1
  están copiados en `vendor/`.

## Limitaciones

- Solo encuentra precios escritos como texto con "$". Si un PDF es una foto o un escaneo,
  se puede ver y compartir pero no editar.
- El precio viejo queda **tapado**, no borrado: si alguien copia el texto del PDF podría verlo.
- El precio nuevo usa la letra Helvetica (parecida, no idéntica a la del catálogo).
- Los datos viven en el navegador de ese dispositivo: el celular y la compu no se sincronizan,
  y si se borran los datos de Chrome se pierden los cambios (los PDF originales no se tocan).

## Instalarla en el celular

La app tiene que abrirse **una vez** desde una dirección `https://` (es un requisito de Chrome
para instalar apps y para el botón de compartir). Después queda instalada y funciona sin internet.

1. Publicar la carpeta `app-catalogos/` en un hosting estático (por ejemplo GitHub Pages).
2. En el celular, abrir esa dirección con Chrome → menú ⋮ → **Instalar app** (o
   "Agregar a pantalla principal").
3. Abrir la app desde el ícono y cargar los PDFs con **Agregar PDF**.

Cuando se publica una versión nueva, el celular la baja solo la próxima vez que abre la app con
internet. Si se agregan o sacan archivos, actualizar la lista `FILES` y subir `VERSION` en `sw.js`.

## Probarla en la compu

Desde la carpeta `Patricio/`:

```
python -m http.server 8765
```

y abrir <http://localhost:8765/app-catalogos/>. En `localhost` el modo sin internet está
desactivado a propósito, para ver siempre la última versión del código.
