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
- **Backup:** data stays on the device. Export a JSON backup regularly; import it on another device. CSV exports for spreadsheets.

Net profit = sale price − fees & shipping out − (price paid + extra costs such as service or shipping in).
