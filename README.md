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

- **Buscar clientes**: comercios cerca de tu ubicación (o de la localidad o el punto del mapa que
  elijas), por rubro y distancia, con los que tienen celular primero. Desde cada uno se puede
  mandar WhatsApp con un mensaje guardado (y después los catálogos), llamar o ir con Google Maps.
  Los que ya recibieron mensaje quedan **tachados**, y se puede marcar si respondió o es cliente.

Funciona **sin internet** y todo queda guardado **en el dispositivo**: los PDFs, precios y el
seguimiento de clientes no se suben a ningún lado.

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

## Buscar clientes: de dónde salen los comercios

Los comercios salen de [Overture Maps](https://overturemaps.org), un mapa abierto que arman Meta,
Microsoft, Foursquare y otros. Es gratis, no pide cuenta ni tarjeta y sus licencias (CDLA
Permissive 2.0, Apache 2.0, CC0) permiten usarlo y guardarlo, citando la fuente.

- `datos/actualizar_comercios.py` baja la última versión, se queda con los rubros que le sirven a
  la distribuidora (jugueterías, librerías, bazar, cotillón, regalerías, artística, limpieza,
  kioscos, autoservicios), descarta palabras que no sirven y deja `datos/comercios-amba.json`
  más `datos/indice.json`. Rubros, palabras a excluir y zonas se cambian arriba en ese archivo.
- `.github/workflows/comercios.yml` lo corre solo el día 27 de cada mes y publica los datos
  nuevos; también se puede correr a mano desde la pestaña **Actions** de GitHub.
- La app baja el archivo una vez, lo guarda en el celular y busca ahí (sin internet). Cuando hay
  versión nueva muestra "Hay datos nuevos de comercios". El mapa sí necesita internet
  (usa OpenStreetMap).

Para correrlo en la compu: `pip install duckdb` y `python datos/actualizar_comercios.py`.

## Cómo funciona por dentro

- `js/analyze.js` lee el PDF con pdf.js, encuentra cada precio escrito como texto ("$ 1.234"),
  mira en la imagen de la página si se ve (algunos catálogos tienen precios viejos tapados) y
  toma su posición, color de letra y color de fondo. También asocia código, nombre y foto.
- `js/build.js` arma el PDF nuevo con pdf-lib: parte siempre del PDF original, tapa cada precio
  cambiado con su color de fondo y escribe el nuevo con el mismo color y tamaño.
- `js/app.js` son las pantallas de catálogos; `js/clientes.js` la de buscar clientes;
  `js/compartir.js` arma y comparte los PDF; `js/ui.js` ventanas e íconos; `js/db.js` el
  guardado local (IndexedDB); `sw.js` hace que abra sin internet.
- Sin herramientas de compilación: son archivos estáticos. pdf.js 4.10.38, pdf-lib 1.17.1 y
  Leaflet 1.9.4 están copiados en `vendor/`.

## Limitaciones

- Solo encuentra precios escritos como texto con "$". Si un PDF es una foto o un escaneo,
  se puede ver y compartir pero no editar.
- El precio viejo queda **tapado**, no borrado: si alguien copia el texto del PDF podría verlo.
- El precio nuevo usa la letra Helvetica (parecida, no idéntica a la del catálogo).
- Los datos viven en el navegador de ese dispositivo: el celular y la compu no se sincronizan,
  y si se borran los datos de Chrome se pierden los cambios (los PDF originales no se tocan).
- En Buscar clientes, si un teléfono es celular o fijo se deduce del número (celular si trae 9
  o 15, fijo si empieza con 4): puede fallar. Overture tiene algo de ruido (locales cerrados o
  mal clasificados); los dudosos se marcan "Puede estar cerrado".
- WhatsApp no permite mandar mensajes en masa: la app abre el chat con el mensaje escrito y vos
  lo enviás. Conviene no escribir a demasiados comercios por día para que no lo marquen como spam.

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
