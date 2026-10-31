# Los breakpoints de Webflow, de verdad

## Las dos listas, que no son la misma

Webflow tiene **seis** breakpoints en el Designer:

| Corte | Dirección | Cascada |
|---|---|---|
| `1920` | hacia arriba | no baja |
| `1440` | hacia arriba | no baja |
| `1280` | hacia arriba | no baja |
| **Base (Desktop)** | — | **baja a todo** |
| `991` (Tablet) | hacia abajo | baja a los dos móviles |
| `767` (Mobile landscape) | hacia abajo | baja a mobile portrait |
| `479` (Mobile portrait) | hacia abajo | — |

Pero `data_whtml_builder` **solo escribe tres**: `<=991`, `<=767`, `<=479`. Cualquier otra media
query se rechaza.

Consecuencia práctica y constante: **un corte hacia arriba (1280/1440/1920) es nativo del Designer
pero no se puede mantener por API.** Lo que haya ahí se escribió a mano y se pierde en cuanto
alguien regenere la página por API. Y un corte que no está en la lista de seis (768, 1199, 389…)
no es nativo de nada: vive obligatoriamente en un Embed.

`conmutadores.mjs` distingue los tres casos y por eso no acusa un `1440` legítimo.

## La cascada es la causa del 80% de los bugs

Lo que se pone en **Base** baja a todas. Lo que se pone en **Tablet** baja a los dos móviles.
Lo que se pone en **1920** no baja a nada.

De ahí salen los dos fallos clásicos:

- **Editar en Tablet creyendo que se edita el Desktop.** El cambio baja a los dos móviles y no
  sube. El sitio se ve bien en el canvas y mal en el escritorio del cliente.
- **Arreglar en Mobile portrait lo que se rompió en Mobile landscape.** A 600px sigue roto,
  porque 479 no cubre 480-767.

## Las dos capas de CSS, y cuál gana

1. La **hoja nativa** en el `<head>` — la que el Designer edita y muestra.
2. Los **`<style>` de los Embed**, que se pintan dentro del `<body>` y **ganan por orden**.

Medido en un sitio real: 1.593 clases nativas contra 947 en embeds, 601 solo en embed, y **346
donde el Designer enseña un valor y el sitio pinta otro**.

Por eso todo se verifica con `curl` contra el HTML servido y nunca en la respuesta de la API ni en
`*.design.webflow.com`, que es el shell vacío del Designer. `perfil.mjs` cuenta las dos capas por
separado a propósito: sumarlas mezcla lo que Webflow trae de fábrica con lo que escribió el
proyecto, y hace la medición incomparable.

El puente entre las dos capas son las **Variables**, que Webflow emite a `:root` y ven las dos.
Los tokens con `clamp()`/`calc()` entran como `custom_value`, no como valor tipado.

## Gotchas que cuestan una tarde

- **`overflow-x: clip` en `html` Y en `body`.** Solo en `body` no hace nada: medido, 54px a 1440 y
  674px a 820 idénticos con y sin la regla; con las dos, 0 y 0. Y `clip`, no `hidden`: `hidden`
  crea un contenedor de scroll y rompe el pineo de ScrollTrigger.
- **`visibility: false` en el Designer elimina el elemento del HTML publicado.** Trampa clásica al
  "esconder" la variante de otra banda: no está oculta, no existe.
- **`dvh` miente en el primer pintado en iOS** — 77pt de diferencia medidos, que cortaron un hero.
  Se usa `100svh` en CSS como respaldo y la altura real se mide con `visualViewport.height`.
- **`100vw` incluye la barra de scroll clásica** (~15px en Windows) y `clientWidth` no. Para
  anchos se prefiere `100%` de un contenedor topado.
- **`scale()` pide un número sin unidad y `calc()` no lo saca de un `vw`.** En modo UNIDAD eso se
  resuelve con `tan(atan2(100vw, <frame>px))`, que da longitud entre longitud → número.
- **Mover un corte deja huérfanas las reglas del breakpoint nativo.** La API no puede mover los
  breakpoints de Webflow.
- **El desborde en reposo miente.** Una home dio 0px parada y 54px recorriéndola. Todo gate de
  desborde se mide recorriendo.
- **Tablet no es escritorio encogido.** Si el diseño no tiene banda propia, hay que declarar de
  cuál hereda. El config lo exige (`bandas.<x>.hereda`) y aborta si falta.
