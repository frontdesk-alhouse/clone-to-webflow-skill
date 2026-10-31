# La pagina base — `/styleguide`

Se construye **una vez por cliente**, **antes** de portar ninguna seccion, y vive como una pagina
real del propio sitio de Webflow. No es documentacion: es la fuente de la que salen las clases que
las secciones usan, y la referencia contra la que se auditan todas las paginas.

## El orden de construccion, y por que no se puede alterar

### 0. La escala fluida, antes que nada
```bash
node …/scripts/genera-escala-fluida.mjs
```
Produce los tokens `clamp()` topados y sus payloads para `data_variable_tool > create_size_variable`
con `custom_value`. Todo lo demas se apoya en ellos, asi que van primero.

### 1. Variables
Colecciones de Webflow desde los tokens de Figma.

- **Se vinculan solo donde el valor actual es identico al token.** Asi la tokenizacion no mueve un
  pixel, y se demuestra con `foto-sitio.mjs comparar antes despues`. Donde no coincida, el hueco se
  anota; no se «arregla» de paso, porque entonces la tokenizacion y el cambio de diseno viajan
  juntos y no se sabe cual movio que.
- **El `cssName` no se adivina.** El patron es `--_<coleccion>---<variable>` (con tres guiones de
  separador), pero una coleccion vieja genero `--a`, `--b`, `--c`. **Se lee de la respuesta de
  creacion** y se registra en `spec/tokens.json` **antes de escribir un solo `var()`**.
- Webflow **emite todas las variables a `:root` aunque ninguna clase las use**. Ese es el puente
  entre las dos capas del sitio: el CSS de un Embed las lee con `var()` y una clase nativa se
  vincula desde el Designer. Un cambio gobierna las dos.
- **Una coleccion aparte para cada clon de referencia.** El clon es material de referencia y no debe
  contaminar el sistema del cliente.

### 2. Clases nativas base
Tipografia, superficie, layout. Con prefijo de proyecto y BEM: `<pfx>-<bloque>__<elemento>--<mod>`.

### 3. Elementos reutilizables — clases + combo, NO componentes
Botones, chips, cards, badges. Ver `botones.md`.

### 4. Componentes reales — solo navbar y footer

---

## Por que los botones no son componentes

Un componente de Webflow con prop `textContent` **si** puede cambiar el texto. La razon no es esa.

1. **Un boton dentro de un Embed no puede ser instancia de componente.** En un sitio portado desde
   Figma buena parte del UI vive en embeds —porque el CSS anidado no entra por `whtml_builder`— asi
   que un boton-componente solo funcionaria en la mitad nativa del sitio. Dos formas de hacer el
   mismo boton segun donde caiga es peor que ninguna.
2. **Cada variante de copy obliga a pasar por el panel de props** y a mantener el prop sincronizado.
   Con clase + combo el texto es texto plano editable en cualquier contexto.
3. **El estilo sigue centralizado igual**: `<pfx>-btn` lleva la forma y `<pfx>-btn--primary` el tono.
   Cambiar el radio de todos los botones sigue siendo una edicion.

**El criterio, dicho en una linea:** es componente lo que **no cambia de contenido entre paginas**.
Navbar y footer lo cumplen; un boton no.

## El coste de la alternativa, medido

Un componente de boton construido **sin auto-layout** y con constraints `SCALE` obliga, en cada
instancia redimensionada, a recalcular a mano `fontSize`, `lineHeight` y `letterSpacing`:

```
sw = inst.width / base.width      sh = inst.height / base.height
textAutoResize = 'WIDTH_AND_HEIGHT'
fontSize      = base.fontSize   * sw
lineHeight    = { PIXELS, base.lineHeight * sh }
letterSpacing = { PIXELS, base.letterSpacing * sw }
```

Y con dos gotchas encadenados: **las posiciones de los hijos no se pueden sobrescribir dentro de una
instancia** (`set_x` lanza `cannot be overridden: relative-transform`), y **una instancia recien
creada no expone sus hijos dentro del mismo script**, asi que el ajuste tipografico va siempre en
una llamada posterior.

**Poner auto-layout con padding real elimina todo ese paso.** Regla de la pagina base: **todo
componente lleva auto-layout con padding real**. Sin excepciones «por limpieza».

## Que tiene que haber en `/styleguide`

- Cada token de color, tamano y radio, **renderizado** — no listado. Un token que no se ve no se
  audita.
- Cada variante y cada estado de boton (ver `botones.md`), incluido el **presionado**.
- Las superficies con su radio segun la escala, en los tres anchos.
- Un ejemplo de la **regla concentrica**: una pieza esquinada dentro de una caja, con los dos
  numeros visibles.
- Navbar y footer, como instancias de sus componentes.

`audita-calidad.mjs`, `radios.mjs` y `audita-radios-anidados.mjs` se corren tambien contra esta
pagina: si el sistema no pasa su propio gate, no hay por que esperar que lo pasen las paginas.
