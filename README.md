# Libro de Pastoreo

Aplicación web con los apuntes de la escuela para ancianos y precursores, organizados en 14 temas. Cada cita bíblica abre la Traducción del Nuevo Mundo (edición de estudio) en wol.jw.org.

- Buscador en todo el libro (con o sin acentos)
- Favoritos, tamaño de letra y tema oscuro
- Funciona sin conexión una vez abierta (cuando se publica en HTTPS)

## Editar el contenido

Todo el texto está en `js/content.js`, en un formato sencillo que se explica al principio del archivo. Después de cambiarlo, aumente `VERSION` en `sw.js` para que los teléfonos reciban la nueva versión.

## Publicar

Es un sitio estático, sin pasos de compilación. Para publicarlo con GitHub Pages: Settings → Pages → Deploy from a branch → `main` / root.

Para probarlo localmente: `python3 -m http.server` y abra http://localhost:8000.

_Material personal de estudio, basado en apuntes de clase. No es una publicación oficial._

---

# Watch Ledger (`watches/`)

A separate app for running a watch business. Once GitHub Pages is on, it lives at `…/watches/` and can be added to a phone's home screen.

- **Numbers:** month-end net profit, watches sold, revenue, fees, cost of sold, average days to sell, a 12-month profit chart and a year-by-month table. Copy a month-end summary or export the month as CSV.
- **Inventory:** current and past watches in one searchable list (brand, model, reference, serial, seller…). Searching a reference shows what you paid before, what you sold it for, and the market median.
- **Add watch:** typing a reference you've seen before shows your past buy prices and how much room there is to the market median before you buy.
- **Market:** log real **sold** prices (eBay sold listings, auctions, forum sales). Asking prices can be logged too, but they are kept apart and never count toward the market median. Quick links open eBay's sold-listings search.
- **Pictures:** every watch gets an illustration drawn from its configuration — case, bezel, dial colour and bracelet or strap — so the picture changes when the configuration does. Add your own photos of each watch (stored on the device, included in backups).
- **Real photos:** each watch and reference has links that open real photos of that exact reference (Google Images, the brand's own site, dealer listings). Save or copy one you like and add it as the *reference photo* (upload, "Paste copied image", or Ctrl/Cmd+V). It's stored per reference + configuration and shown on every matching watch, labelled "Reference photo — not this exact watch". Your own photos of a watch always take priority.
- **Configurations & accuracy:** `watches/catalog.js` lists references and the dials and bracelets/straps each one comes in (e.g. Speedmaster `.001` = bracelet, `.002` = strap; Black Bay 58 `-0001/-0002/-0003`). A watch logged in a configuration its reference doesn't come in is flagged "Check" with the reference that matches. Market → Reference guide shows every configuration. References not in the catalog can be styled by hand; the look is remembered per reference.
- **Backup:** data stays on the device. Export a JSON backup regularly; import it on another device. CSV exports for spreadsheets.

Net profit = sale price − fees & shipping out − (price paid + extra costs such as service or shipping in).
