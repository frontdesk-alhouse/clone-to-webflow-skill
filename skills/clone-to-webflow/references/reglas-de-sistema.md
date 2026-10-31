# Reglas de sistema

Lo que cualquier build de este harness cumple, con el porque medido detras. Nada de esto es
preferencia: cada regla existe porque su ausencia costo algo concreto.

---

## 1. Radios — tres reglas que conviven, no una

Se confunden constantemente porque las tres hablan de esquinas. Hacen cosas distintas y se
encadenan: **(a)** elige el radio de una superficie por su tamano, **(b)** dice cuando ese numero
cambia entre anchos y cuando no, y **(c)** deriva el radio del contenedor a partir de la pieza que
lleva dentro.

### (a) Escala por LADO MENOR — para superficies
```
lado menor >= 500  ->  64      ventanas flotantes  12
lado menor 300-499 ->  32      chips                5
lado menor  < 300  ->  16
```
Configurable en `radios.escala`. Auditor: `scripts/radios.mjs <ancho>`.

**Por que el lado menor y no el mayor:** una foto vertical de 424x520 caeria en 64 con el criterio
del lado mayor y rompe la lectura de tarjeta. El lado menor es el que gobierna como se percibe la
curvatura.

Los cuatro corners se bindean a la variable, **nunca valor crudo**.

### (b) Superficies cambian por breakpoint; piezas no
- **Superficies** (panel, foto, tarjeta, fila) → el token por lado menor, **y cambia con el ancho**.
  Que movil use 32 donde escritorio usa 64 **no es un desajuste: es el mismo sistema**.
  64/519 = 12.3 % ≈ 32/220 = 14.5 %. Copiar el 64 literal a movil da 29.1 %, y el 16 da 7.3 %.
- **Piezas** (toggle, boton, tarjeta flotante, dock) → **el mismo numero en todos los anchos**.
  Ahi si hay desajuste cuando Figma escalo el componente de escritorio y arrastro el radio, e es
  invisible en el CSS porque los valores quedan fraccionarios: `12.876`, `21.412`.
- **No se tocan** el marco del telefono ni las pantallas de los heroes: son **objetos fisicos
  dibujados**, no superficies del sitio. Van en `radios.exentos`.
- Una caja es superficie **solo si ningun ancestro lleva radio**. Lo que vive dentro de otra caja
  redondeada es cromo de una maqueta y tiene su propia escala en miniatura. Sin esta separacion la
  auditoria marca 23 falsos positivos.

### (c) Radios anidados — la regla concentrica
> Cuando un elemento contiene a otro y hay separacion entre sus esquinas:
> **`radio_exterior = radio_interior + separacion`**

Un boton de radio 12 con 8 px de aire dentro de una caja pide **radio 20** en la caja. Concentrico,
no paralelo: con el mismo radio en las dos, la distancia entre curvas se estrecha justo en la
diagonal, que es donde el ojo la mide.

Se aplica a **piezas dentro de superficies**, asi que encaja con (a) en vez de competir: (a) fija el
radio de la pieza, (c) deriva el de la caja que la contiene **cuando va esquinada**.

**Cuando NO aplica** — y estas exclusiones son la mitad del valor de la regla:
- la pieza no va esquinada: sus dos separaciones a los lados de esa esquina no son iguales, o son
  mayores que `radios.esquinaMax` (64 px por defecto). Una pieza centrada en una caja grande no
  tiene nada que ver con el radio del contenedor.
- la pieza se sale del contenedor: no es anidamiento.
- la pieza no tiene radio: no hay nada que concentrar.
- hay un ancestro redondeado por encima del contenedor: es cromo de maqueta.

Auditor: `scripts/audita-radios-anidados.mjs` (modo DOM y modo Figma, una sola implementacion de la
regla). Test de regresion: `tests/radios-anidados.test.mjs` — **si tocas un umbral, el test cambia
en la misma edicion**.

### Verificacion obligatoria en el CSS publicado
Un `border-radius` vinculado a token **no sobrevive** si la clase conserva los cuatro longhands: el
compilador de Webflow los aplana por encima del shorthand y **el binding queda inerte sin ningun
aviso**. Cura: `remove_properties` de los cuatro largos **en la misma llamada**. Y comprobarlo en el
CSS servido, no en la respuesta de la API.

---

## 2. `line-height` en px, nunca como multiplicador

**Figma redondea la caja de linea a entero y CSS no.**

| fontSize x ratio | CSS | Figma |
|---|---|---|
| 48 x 1.08 | 51.84 | **52** |
| 15 x 1.5  | 22.5  | **23** |
| 11 x 1.4  | 15.4  | **15** |

Regla: `line-height: round(fontSize x ratio)px`. Es la primera causa de deriva de texto y no se ve a
ojo: aparece como un corrimiento de una o dos decimas que la sonda de tinta si mide.

---

## 3. Escalado responsivo — dos regimenes, uno por seccion

### La regla de fondo
> La fluidez es una propiedad de **la composicion**, no una tecnica de CSS que se aplica despues.

Todos los fallos de escalado medidos en este harness tienen la misma causa, y **no es `clamp()`**:

> **Si la composicion lleva superposiciones en pixeles, el contenido se congela y lo que crece son
> los margenes.**

Evidencia: una banda de tablet que se dejo crecer de 688 a 780 rompio cuatro cosas a la vez —la
ventana del feature-stack paso de 67 % a 59 % de la foto y el `cover` del hero **se comio la cara**—
*porque todos los elementos superpuestos estaban fijos en pixeles y calibrados contra 688*. Un
escalado global con `zoom` fallo en las paginas con pineado porque GSAP crea `pin-spacer` con
anchos en linea y el build tenia coordenadas horneadas a mano: `ScrollTrigger.refresh()` no basta,
el desfase aparece **durante** el barrido. Y un motor que mide en vivo con `getBoundingClientRect()`
devuelve pixeles **visuales** mientras GSAP aplica `x`/`y` en espacio **local**: cualquier escala le
rompe el vector.

Ninguno de esos es un argumento contra el fluido. Son argumentos contra **escalar por encima** una
maqueta de coordenadas absolutas.

### El discriminante, medible
Una seccion es **RIGIDA** si cumple cualquiera de estas tres; si no cumple ninguna, es **FLUIDA**:
1. hijos en posicion absoluta con coordenadas en pixeles calibradas contra un ancho,
2. `transform`/`scale` sobre algo que anima,
3. un motor de movimiento que mide en vivo con `getBoundingClientRect`.

Auditor: `scripts/audita-regimen.mjs`, que escribe `spec/regimen.json`. **Una seccion sin regimen
declarado no pasa el gate** — el default silencioso es exactamente lo que se colo hasta llegar al
iPad de un cliente. Y una seccion que a un ancho no se pinta se marca `sin-medir`, no se clasifica:
decir «fluida» de algo que no se ha medido es peor que no decir nada.

### Regimen FLUIDO — el default para todo lo nuevo
- **Tipografia y espaciado con `clamp()`**, como **Variables de Webflow con `custom_value`**: la API
  lo soporta explicitamente para `clamp()`, `calc()`, `min()` y `max()`. Ese es el desbloqueo — los
  tokens fluidos son **nativos y bindeables**, y como Webflow emite todas las variables a `:root`,
  **la misma escala gobierna la capa nativa y la de embeds a la vez**. Sin hacks.
- **Formula con tope**, generada por `scripts/genera-escala-fluida.mjs`:
  ```
  pendiente = (max - min) / (anchoTope - anchoMin)
  corte     = min - pendiente * anchoMin
  token     = clamp(<min>px, calc(<corte/16>rem + <pendiente*100>vw), <max>px)
  ```
  En `anchoMin` da `min` exacto, en `anchoTope` da `max` exacto, y por encima **el `max` de clamp()
  manda: la tipografia deja de crecer sin necesitar media query**. Esa es la regla de 1440.
  El corte va en `rem` para que el token respete el tamano de fuente del navegador del usuario.
- **Contenedor**: `width: min(100% - 2*<margen>, <anchoTope>px); margin-inline: auto`. Por debajo
  encoge, por encima se centra.
- **`100vw` incluye la barra de scroll clasica** (~15 px en Windows) y `clientWidth` no. Para ANCHOS
  se prefiere `100%` de un contenedor topado; `vw` esta bien para texto y espaciado, donde 15 px de
  viewport son decimas de pixel de resultado.
- **`scale()` pide un numero sin unidad y `calc()` no sabe sacarlo de un `vw`**: cualquier factor de
  escala viene de JS, nunca de CSS.

### Regimen RIGIDO — maquetas, heroes con motor, superposiciones
- **El contenido se congela y crecen los margenes:**
  `padding-inline: max(<margen>, calc(50% - <mitad del ancho calibrado>px))`.
- La invariante que se compra es comprobable: la misma seccion capturada a 768 y a 1024 dio
  **0, 0, 1 y 39 pixeles distintos** de entre 500.000 y 1.900.000. Dentro de la banda el render **no
  depende del ancho**, asi que lo que pasa el gate a un ancho pasa en todo el rango.
- Nada de `zoom` ni `transform` global. **Antes de escalar algo que anima, comprobar si su motor
  mide en vivo**: si mide, o no se escala, o hay que dividir el vector por el factor.

### Alturas (los dos regimenes)
- **`dvh` miente en el primer pintado en iOS.** Safari lo resuelve al viewport grande cuando la
  barra todavia esta desplegada: 77 pt de diferencia medidos, que cortaron un hero. Se usa **`100svh`
  en CSS como respaldo** y la altura real se **mide** con `visualViewport.height`, re-midiendo en
  `visualViewport.resize` — Safari mueve su barra al hacer scroll **sin disparar `resize`**.
- Un porcentaje contra un alto automatico se ignora: Webflow mete un `w-embed` de alto automatico en
  medio. Usar `100dvh`/`100svh`, que no dependen de la cadena de ancestros.

### Comunes
- **`overflow-x: clip` en `html` Y en `body`.** Solo en `body` **no hace nada** — medido: 54 px a
  1440 y 674 px a 820, identicos con y sin la regla; con las dos, 0 y 0. Y **`clip`, no `hidden`**:
  `hidden` crea un contenedor de scroll y rompe el pineo de ScrollTrigger. Con `clip` se verifico
  que no se rompe nada: mismos pines y mismo numero de elementos animados antes y despues.
- **Un gate de paridad a un solo ancho no prueba responsive.** A 1440 exacto `100%` y `1440px` son
  el mismo numero. `scripts/mide-escalado.mjs` barre 15 anchos de 360 a 3440.
- **Mover un corte deja huerfanas las reglas del breakpoint nativo.** La API no puede mover los
  breakpoints de Webflow: antes de cambiar un conmutador hay que listar lo que vive en los nativos y
  replicarlo desde un Embed posterior. Y los tres conmutadores —secciones, barra movil y regimen—
  tienen que compartir el mismo numero, o salen dos barras a la vez.
- Breakpoints validos en `whtml_builder`: solo `<=991`, `<=767`, `<=479`. Cualquier media query
  propia se rechaza.
- **Tablet no es escritorio encogido.** Si el diseno no tiene banda propia, las secciones moviles no
  son una eleccion: son las unicas que hay.

---

## 4. Ocultar sin borrar

**Nunca el toggle del ojo.** Webflow **omite del HTML publicado** los elementos con
`visibility:false` — no los oculta con CSS, los elimina del output. Rompio dos veces 70 paginas de
un `[slug]`: primero el `data-*` que un script necesitaba leer, y despues el bloque de paginacion
que la libreria de listas necesitaba para saber que habia mas paginas.

Para ocultar manteniendo el DOM:
```css
.oculto-visualmente { opacity: 0; position: absolute; width: 1px; height: 1px; overflow: hidden; }
```

---

## 5. Procedencia

Cuando el frame de Figma y el sitio en vivo discrepan **por una decision ya aprobada**, gana el
sitio y **se repinta el frame**. No se le quitan al sitio elementos aprobados para que se parezca a
un frame viejo. Los frames derivan en los dos sentidos.

Y el orden: **reconciliar antes de auditar, nunca durante**. Auditar contra un frame caduco produce
un informe que pide deshacer lo que el cliente aprobo.

**Truco de triangulacion** cuando algo no cuadra y no se sabe quien miente: comparar la banda
sospechosa contra las otras bandas del mismo frame. **Dos de tres coincidiendo senalan a la impar.**
Asi se cazo un peso de fuente equivocado que costaba 3.5 puntos de paridad y llevaba meses
atribuido a una diferencia de metrica de fuente.
