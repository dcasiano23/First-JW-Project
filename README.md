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

# CIG Timepieces app (`watches/`)

A separate app for running a watch business. Once GitHub Pages is on, it lives at `…/watches/` and can be added to a phone's home screen.

- **Numbers:** month-end net profit, watches sold, revenue, fees, cost of sold, average days to sell, a 12-month profit chart and a year-by-month table. Copy a month-end summary or export the month as CSV.
- **Inventory:** current and past watches in one searchable list (brand, model, reference, serial, seller…). Searching a reference shows what you paid before, what you sold it for, and the market median.
- **Add watch:** typing a reference you've seen before shows your past buy prices and how much room there is to the market median before you buy.
- **Market:** log real **sold** prices (eBay sold listings, auctions, forum sales). Asking prices can be logged too, but they are kept apart and never count toward the market median. Comp links go only to sold listings (eBay sold, plus 130point for the real price of eBay Best Offer sales) — never to for-sale listings. Max buy price = median sold − fees − shipping − target profit.
- **Your photos & videos:** add photos and videos of the actual watch (camera, library, drag & drop or paste). Stored on the device; download any file to keep the original.
- **Pre-ship check:** checklist (identity, function, condition, packing), timegrapher numbers, carrier and tracking, with videos attached. "Sign off & lock" time-stamps it and locks the record and its videos so they can't be changed or removed — proof of how the watch left your hands.
- **Branding:** CIG Timepieces name, logo (silver on dark screens, graphite on paper) and home-screen icon are built in; a logo or name entered under Business overrides them.
- **Business & documents:** add your logo, business details, sale terms and thank-you message under Business. Each watch has one-tap Purchase agreement, Bill of sale (numbered invoices), Thank-you letter and Condition report — editable on screen, then Print / Save as PDF. Templates only; have an attorney review the wording.
- **Reference lookup:** type a reference and brand, model and case fill in — from a built-in list of ~150 popular references (Rolex, Omega, Tudor, Cartier, Grand Seiko, AP, Patek, Panerai), then from your own past entries; for other references the brand is recognised from the reference format.
- **Configurations & accuracy:** `watches/catalog.js` lists references and the dials and bracelets/straps each one comes in (e.g. Speedmaster `.001` = bracelet, `.002` = strap; Black Bay 58 `-0001/-0002/-0003`). A watch logged in a configuration its reference doesn't come in is flagged "Check" with the reference that matches. Market → Reference guide lists every configuration.
- **Backup:** data stays on the device. Export a JSON backup regularly (photos included; videos optional); import it on another device. CSV exports for spreadsheets.

Net profit = sale price − fees & shipping out − (price paid + extra costs such as service or shipping in).
