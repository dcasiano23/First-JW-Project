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
