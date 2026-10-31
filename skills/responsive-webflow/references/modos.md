# Los dos modos, y cuándo cada uno

Un sitio responde a los anchos de una de dos maneras. No son estilos: son contratos distintos, con
fuente de verdad distinta y con manera distinta de verificarse.

## Modo UNIDAD

**La composición se conserva; lo que cambia es la escala.** Cada banda tiene un frame ancla, cada
medida se toma en ese frame y se emite como una fracción del ancho del display.

```css
--u  = clamp(umin, tan(atan2(100vw, <frame>px)), umax)   /* layout: proporcional puro */
--t  = min(u, 1 + (u - 1) * .33)                          /* display: crece amortiguado */
--tb = min(u, 1)                                          /* lectura y UI: no crece */
```

Todo lo demás es `calc(<px del frame> * var(--u))`.

**Por qué tres factores y no uno.** Con una sola unidad, a 1920 el cuerpo pasa de 16 a 21 y la nav
de 14 a 19. Medido contra un sitio que lo hace bien (Apollo, 2026-09-06): hacia abajo del ancla la
tipografía encoge en la misma razón que el ancho (72→64 de 1440 a 1280); hacia arriba el display
crece amortiguado (72→80 de 1440 a 1920: +11% por +33% de ancho) y **el texto de lectura y de UI
no crece** — cuerpo, nav y botón en 18 desde 1280 hasta 3840. El layout sí sigue proporcional.

**Cuándo.** Landings y páginas de marketing con composición dibujada: superposiciones, maquetas de
producto, piezas colocadas contra un frame. Es donde la fidelidad al diseño importa y el contenido
no cambia de forma.

**Cuándo NO.** Páginas CMS, catálogos, cualquier cosa donde el contenido decide el alto. Una ficha
con tres párrafos y otra con doce no caben en el mismo frame.

**Qué NO escala:** el hairline de 1px, y por encima del frame el texto de lectura y de UI.

**Dónde vive el CSS:** Site Settings → Custom Code → Head. **No** por `whtml_builder`, que rechaza
los cortes 767/1199. Las medidas van en un JSON y el CSS se **genera**; editarlo a mano lo desacopla
del JSON y la siguiente generación lo pisa.

**Cómo se verifica:** en el ancho ancla cada elemento coincide con el frame a ±1px; entre anclas
coincide con `medida × factor`; desborde cero. Once anchos, `verifica-unidad.mjs`.

## Modo NATIVO

**La composición reflúye.** Flex y grid, tokens fluidos con `clamp()` topados, overrides en los
breakpoints del Designer.

**Cuándo.** CMS, sitios heredados, cualquier página cuyo alto lo decide el contenido, y cualquier
sitio que otra persona vaya a mantener desde el Designer.

**Régimen por sección.** La fluidez es una propiedad de **la composición**, no una técnica de CSS
que se aplica después. Dentro de un sitio nativo cada sección es una de dos:

- **RÍGIDA** si cumple cualquiera de estas tres: hijos en posición absoluta con coordenadas en px
  calibradas contra un ancho; `transform`/`scale` sobre algo que anima; un motor de movimiento que
  mide en vivo con `getBoundingClientRect`. Se resuelve congelando el contenido y creciendo los
  márgenes: `padding-inline: max(<margen>, calc(50% - <mitad del ancho calibrado>px))`.
- **FLUIDA** si no cumple ninguna. Tokens `clamp()` topados y contenedor
  `width: min(100% - 2*<margen>, <anchoTope>px); margin-inline: auto`.

**Una sección sin régimen declarado no pasa el gate.** El default silencioso es exactamente lo que
se cuela hasta llegar al iPad de un cliente.

**Cómo se verifica:** `regimen-multiancho.mjs` clasifica en todas las bandas y funde; una sección
que mide fluida a un ancho y rígida a otro no tiene un régimen, tiene dos diseños.

## Modo MIXTO, que es donde está la mayoría

Un sitio puede ser nativo con dos secciones en modo unidad. Lo que no puede es tener la unidad **a
medias**: declarar `--u` y no `--t`/`--tb` deja la mitad del sitio escalando y la otra mitad no, y
eso se ve peor que no haber aplicado nada. `perfil.mjs` lo detecta y lo dice con ese nombre.

## Cómo se elige

`perfil.mjs` **propone** leyendo el HTML servido: si las tres variables están, es unidad; si hay
`clamp()` de verdad en la capa propia, es nativo fluido; si no hay ninguno de los dos y el sitio se
sostiene con porcentajes y overrides, es nativo rígido.

**Se propone, no se impone.** Si el veredicto choca con lo declarado en el config, se para y se
decide antes de medir nada más.
