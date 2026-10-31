# Rúbrica responsiva — los seis criterios

Los gates dicen «no se rompe». No dicen «se ve bien entre anchos». Esto es lo segundo.

Cada criterio tiene **un número detrás** para que no sea opinión. Pero **ningún número sentencia
solo**: los lee el council junto a las capturas y decide. Un valor fuera de rango puede estar bien;
lo que no puede es no saberse.

Cuatro los mide `mide-estetica.mjs`. Dos son de juicio y los verifica el council.

---

## 1 · Coherencia de sistema entre bandas · *medido*

La misma sección conserva sus **razones**, no sus números.

| Razón | Cómo se mide | Umbral |
|---|---|---|
| jerarquía | tamaño del título mayor ÷ tamaño del cuerpo dominante | deriva < 15% entre bandas |
| contenido | ancho del contenedor ÷ ancho de ventana | deriva < 15% entre bandas |
| radio | radio ÷ lado menor de la superficie | ídem |

Que móvil use 34 donde escritorio usa 64 **no es un desajuste: es el mismo sistema**. Que la razón
H1/cuerpo pase de 2.3 en móvil a 4.3 en escritorio sí lo es: en una banda el título manda y en la
otra no, y eso son dos diseños, no uno responsivo.

Lo mismo con los radios: 64/519 = 12.3% ≈ 32/220 = 14.5% es el mismo sistema. Copiar el 64 literal
a móvil da 29.1%. **Superficies** (panel, foto, tarjeta) cambian su radio con el ancho; **piezas**
(botón, toggle, chip) llevan el mismo número en todas las bandas.

## 2 · Medida — caracteres por línea · *medido*

Rango cómodo **45–75**. Por encima de **100** el ojo pierde el renglón al saltar de línea.

Es el síntoma número uno de «el texto creció con el contenedor en vez de topar». Un párrafo a 92
caracteres por línea no dispara ningún gate de desborde y aun así nadie lo lee.

## 3 · Techo tipográfico · *medido*

**El texto de lectura y de UI no crece por encima del frame ancla de su banda.**

Es la regla `--tb`, y no es preferencia: medido en Apollo el 2026-09-06, el cuerpo se queda en 18px
desde 1280 hasta 3840. El display sí crece, amortiguado (80 en 1920 desde 72 en 1440). El layout
crece proporcional.

Una fuente ancha y negra crece peor que una serif fina: el mismo factor que en una es aceptable, en
otra se ve gordo. Si el factor tiene que bajar, baja el factor — no se abandona el techo.

## 4 · Ritmo vertical · *medido*

El aire entre secciones, medido como **% del ancho de viewport**, no en píxeles.

Un valor literalmente constante entre bandas —96px en las tres— es un hueco a 390 (24.6% del ancho)
y una apretura a 1920 (5%). Es el mismo número leído de dos maneras opuestas.

## 5 · Escalera de anclas · *medido, solo en modo UNIDAD*

En el ancho ancla de su banda, cada elemento coincide con el frame a **±1px** (±0.6 en tamaño de
fuente). Entre anclas coincide con **medida × factor**. Desborde cero en todos los anchos.

Es el contrato que verifica `verifica-unidad.mjs`. Si falla, no hay nada que juzgar: el sitio no
está pintando lo que el diseño dice.

## 6 · Tablet declarado · *de juicio*

Si la banda de tablet no tiene frame propio, se declara **de cuál hereda**. Sin declaración no
pasa: el config aborta.

Tablet no es escritorio encogido. Si el diseño no tiene banda propia, las secciones móviles no son
una elección — son las únicas que hay, y hay que decirlo en vez de descubrirlo en el iPad del
cliente.

---

## Lo que el council juzga y ningún número puede

1. **¿La versión móvil es el mismo sistema o un diseño distinto?** Los números de §1 dan la
   evidencia; la respuesta es de ojo.
2. **¿El tramo mixto es deliberado?** `gate-banda.mjs` reporta los tramos donde dos roles están en
   bandas distintas. En un sitio puede ser el diseño; en otro es el bug. El gate no puede saberlo.
3. **¿Lo que se pierde al bajar de banda, se pierde a propósito?** Una pieza que desaparece en
   móvil puede ser una decisión o un descuido.
4. **¿El número de líneas del titular sigue funcionando?** Al crecer el ancho el H1 cabe en menos
   líneas (Apollo pasa de tres a dos de 1440 a 1920). Los anclajes no cambian; el ritmo del titular
   sí. Eso se mira, no se mide.
