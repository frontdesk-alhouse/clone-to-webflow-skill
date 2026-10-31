# Gotchas de Webflow

Destilado de las limitaciones adjudicadas con evidencia en el harness original. Aqui solo esta lo
que aplica a **cualquier** cliente; lo especifico de un proyecto vive en su `KNOWN_LIMITATIONS.md`.

---

## `data_whtml_builder` — el nucleo del port nativo

### Rechaza la insercion ENTERA si el CSS trae un selector anidado
No la degrada: **la aborta**. Mensaje literal:
> `Nested selectors are not allowed. Found: .lab__btn span. Use single class selectors only.`

**Cura: partir la hoja en dos capas ANTES de portar.** Selectores de clase plana al parametro `css`,
todo lo anidado a un Embed. Medido en una pagina real: **178 clases nativas vs 42 de Embed**, y el
Embed bajo de 22.000 caracteres en 3 bloques a **747 en uno**.

### Sin el parametro `css`, BORRA las clases que ese CSS no declara
Y con ellas el elemento, si es un `<span>` suelto — **texto incluido**. Fue la causa raiz de un port
roto: 9 de 10 secciones quedaron como `div` desnudos, y **nadie lo vio porque la pagina nunca se
publico**.

**Regla: toda etiqueta de texto necesita una clase declarada en el CSS que se pasa.** Las clases de
tipografia que solo existen como descendientes (`.A etiqueta`) se promueven a `.A-etiqueta`
emparejando con `querySelectorAll` **en un navegador real, no con regex**
(`scripts/promueve-clases.mjs`).

### Al portar, los selectores descendientes se vuelven CLASES
Un `<i>` sin clase no hereda nada. Al copiar marcado del build local a un Embed, comprobar antes si
el CSS publicado usa clases aplanadas: buscar `.bloque-elemento` (con guion) ademas de
`.bloque elemento`.

### Breakpoints validos
Solo `<=991`, `<=767`, `<=479`. Cualquier media query propia se rechaza.

---

## `update_style`

### `missing_font` es RUIDO: la propiedad SI se escribe
Creer lo contrario costo el port entero de una pagina. Tambien avisa con `font: inherit`, que se
expande correctamente a las siete longhands.

### Rechaza propiedades con prefijo de proveedor
`-webkit-font-smoothing`, `-moz-osx-font-smoothing` → *"An internal error occurred"* y **tumba la
llamada entera**, incluidas las propiedades validas del mismo lote. Esas reglas viven en el Embed.

### No distingue dos estilos con el mismo nombre
Resuelve siempre al primero, **incluso pasando `parent_style_name`**.

---

## El reset no se copia, se TRADUCE

`.pfx * { margin:0; padding:0 }` pesa lo mismo que una clase (0,1,0) y, viviendo en un Embed del
`<body>`, **gana por orden** contra la hoja de Webflow del `<head>`. Se comio el `padding:24px` de
unas tarjetas y hundio la seccion a 2.68/10.

La forma buena:
```css
:where(.pfx) p { margin: 0; }
```
Pesa 0,0,1: gana al normalize (`p{margin-bottom:10px}`) y pierde contra cualquier clase.

**`box-sizing` no hace falta**: Webflow ya hereda `border-box` desde `html`.

---

## Las DOS capas de CSS, y cual gana

Un sitio portado desde Figma tiene la hoja **nativa** de Webflow (en el `<head>`) y bloques `<style>`
de **Embed** (en el `<body>`). **La segunda gana por orden.** Medido en un sitio real: 1.593 clases
nativas vs 947 en embeds, **601 solo en embed**, y **346 donde el Designer ensena un valor y el sitio
pinta otro**.

Consecuencia: **una style guide page solo gobierna la capa nativa**. El puente entre las dos son las
**Variables**, que Webflow emite a `:root` aunque ninguna clase las use.

Inventario: `scripts/inventario-estilos.mjs`.

---

## Variables

- **El `cssName` no se adivina.** Patron `--_<coleccion>---<variable>`, pero una coleccion vieja dio
  `--a`, `--b`, `--c`. Se lee de la respuesta de creacion y se registra antes de escribir un `var()`.
- **Un `border-radius` vinculado no sobrevive** si la clase conserva los cuatro longhands: el
  compilador los aplana encima y el binding queda **inerte sin aviso**. `remove_properties` de los
  cuatro largos **en la misma llamada**.
- **Comprobar el binding en el CSS publicado**, no en la respuesta de la API.
- Los tokens de tamano con `clamp()`/`calc()` entran como `custom_value`, no como valor tipado.

---

## `visibility:false` — la regla dura

**Webflow OMITE POR COMPLETO del HTML publicado los elementos con `visibility:false`** (el toggle
del ojo en el Designer). No los oculta: los elimina del output. Rompio dos veces 70 paginas de un
`[slug]`. Ver `reglas-de-sistema.md` §4 para la clase de sustitucion.

---

## Elementos y componentes

- **`data_element_builder` pierde el tipo y el texto de los hijos de profundidad >= 2**: salen como
  `Block` con el texto de relleno. El texto vive en un nodo `String` hijo cuyo id es el del padre
  con el ultimo caracter hex incrementado (con acarreo). **Crear arboles de dos niveles como mucho.**
- Maximo **3 niveles por llamada** de `element_builder`.
- `placeholder` es un atributo reservado por la API.

---

## Embeds

- Webflow **envuelve cada Embed en un `w-embed`** que sigue midiendo el tamano original, y
  **`transform` no encoge la caja**: hace falta `.sel .w-embed { width: 100% }`.
- Un `min-height:100%` no resuelve porque el `w-embed` intermedio tiene alto automatico → `100dvh`.
- Tope de **10.000 caracteres** por Embed → CSS minificado.
- **Un runtime de mas de 10.000 caracteres se sirve como ASSET**, no se trocea: `data_assets_tool
  create_asset` devuelve la URL de subida, se hace el POST multipart a S3 y el Embed queda en un
  `<script src="…">`. `data_element_settings_tool set_settings key:"code"` SI escribe el codigo de un
  HtmlEmbed por API (probado hasta 36 KB de lectura); lo que no se escribe es el Custom Code de pagina.
- **Un Embed dentro de un contenedor flex con `gap` ocupa hueco** aunque solo lleve `<script>` o un
  `input hidden`: clase con `display:none` en el Embed.

---

## Codigo libre y movimiento

- **El MCP no expone IX2**: cero verbos de animacion. Todo el movimiento va en codigo libre.
- **`set_site_freeform_code` devuelve 404 en plan gratuito** → la capa de motion exige **Site Plan de
  pago**.
- **`register_inline_script` topa en 2.000 caracteres**, no 10.000.
- **El Custom Code de pagina no se lee ni se escribe por API**: es exclusivo del Designer.
- No hay borrado selectivo de scripts: `delete_all_site_scripts` borra todo.

### Escenas fijadas y `zoom` — Cliente A, KL-62 y KL-211

- **Con `zoom` en `body`, nunca `pin:true` de GSAP.** El pin lee el rect en px VISUALES y lo escribe
  como `width/top/left` en px de LAYOUT: a 1310 el pin mide 1192, el `pin-spacer` queda 9 % corto y
  la seccion siguiente le pasa por encima. A 1440 `zoom = 1` y el defecto se cancela, por eso ningun
  gate lo veia. **Receta**: `position:sticky` dentro de una pista propia (`.x-track`) con
  `height = pin.offsetHeight + recorridoVisual / zoom`, zoom leido con
  `parseFloat(getComputedStyle(document.body).zoom) || 1`, recalculo en `refreshInit`. ScrollTrigger
  se queda solo con el progreso (`start`/`end` en px de scroll, que son coherentes con `scrollY`).
- **Sin zoom de body se escala POR SECCION**: `zoom: tan(atan2(100vw, 1440px))` en los hijos del pin,
  solo en `@media (min-width:1200px) and (max-width:1439px)`. Nunca por encima de 1:1. Un carrusel
  no necesita JS para esto: basta escalar el ancho de tarjeta y el contenedor de controles.
- **Lo mide `gate-pines.mjs`** (skill `responsive-webflow`), con las escenas declaradas en `pines`
  del config. Su caso roto reproduce exactamente los 1192 px.

### Una forma que cruza secciones es UNA forma

Un panel sin borde ni radio inferior **continua** en la seccion siguiente. En Figma es un solo nodo;
en el DOM son dos cajas que proyectan la misma imagen de degradado (`background-size` y
`background-position` casados). La caja de arriba DEBE derramar por debajo de su seccion para cubrir
la banda intermedia. Recortar ese «derrame» (`height:auto; bottom:0`) deja una franja del color de
pagina. **Antes de recortar algo que se sale, se mide el generador y el nodo de Figma**, no solo el
navegador. Se vigila con un gate de continuidad de color por columnas laterales (lejos del texto
centrado, que ensucia la muestra).

---

## Paginas, dominios y publicacion

- **No existe `create_folder`.** `create_page` acepta `parentFolderId`, pero la carpeta se crea a
  mano en el Designer.
- **No existe `delete_page`** → **solo se crean paginas con slug cerrado**.
- **No hay publicacion parcial** fuera de Enterprise.
- **`*.design.webflow.com` NO sirve el sitio publicado**: es el shell vacio del Designer. Verificar
  siempre contra `https://{shortName}.webflow.io`.
- **Verificar en el HTML servido, no en la respuesta de la API.** La API puede aceptar la escritura
  y el sitio servir otra cosa.
- **Webflow no emite `<link rel="canonical">` sin dominio primario**, y la API no lo revela.
- **`/sitemap.xml` no se puede borrar una vez creado.** Orden que no se puede invertir:
  **conectar dominio → fijarlo como primario → publicar → generar sitemap.**
- El locale primario vive siempre en la raiz: un prefijo tipo `/en/` es imposible.
- **El nombre de la hoja nativa lleva un hash que cambia en cada publicacion.** Cualquier huella que
  lo incluya marcaria deriva en cada publish; `detecta-deriva.mjs` lo normaliza.

---

## CSS fuente vs publicado

Cuando una hoja vive **aplicada en el bloque de pie de una pagina** y ademas hay archivo fuente en
el repo, **el archivo fuente NO es la verdad**. Regenerar desde el repo habria deshecho dos
correcciones ya aprobadas.

Antes de escribir una hoja regenerada: bajar el HTML publicado con `curl`, extraer el `<style>` y
comparar **declaracion a declaracion** — no selector a selector: los selectores coinciden, la
diferencia esta en los valores.

Y el generador **aborta** si queda un marcador de asset sin sustituir: un `url(--REC--)` literal
hundio una seccion de 10 a 3.58 sin ningun aviso.

---

## Assets

- **Subir de uno en uno, verificando cada hash antes del siguiente.** El orden de respuesta no esta
  garantizado y eso ya provoco un intercambio de fotos en un proyecto de cliente.
- **Nunca sustituir** una imagen por otra parecida. Un hueco visible es mejor que una imagen
  equivocada dada por buena.
- Los archivos en iCloud pueden estar **desalojados**: un `cat` se cuelga o devuelve 0 bytes y pasa
  cualquier comprobacion de «existe». `brctl download` los materializa.

---

## Formularios por builder

- **El `<select>` sale con `name="Field"`** diga lo que diga el HTML: `set_settings key:name` despues,
  y otra vez si se reconstruye. Sin eso el dato llega al equipo con una etiqueta que no dice nada.
- **El `for` de una etiqueta puede ser rechazado** por el Designer (`[Conflict] … component map`):
  se fija `htmlFor` desde el script del Embed.
- **Un boton hecho con `div` no es un enlace**: ni teclado, ni clic central, ni `href` que un gate
  pueda leer. Los CTA se convierten a `a` y el gate comprueba el `href` servido.
- Lo que el equipo tiene que recibir y el visitante no debe ver (intervalo de cobro, plan de origen)
  va en `input type=hidden` dentro del `<form>`, rellenado desde la query; se verifica en el envio.

---

## El gate humano de aplicacion

**Aprobar un plan que menciona «aplicar en el Designer» NO es autorizacion para tocar el sitio en
vivo.** Son dos gates distintos. El copy se redacta aparte y solo se empuja al Designer cuando el
usuario dice explicitamente «aplicalo».

---

## Puntos ciegos del shim de calidad

Verificados en el piloto. `audita-calidad.mjs` los suprime; **no son defectos**:

| Regla | Por que no es fiable en el shim |
|---|---|
| `cramped-padding` | Secciones full-bleed con hijo de alto completo y texto centrado leen como «pegado al borde». En CSS real es `height:100%` + centrado. |
| `low-contrast` | El shim no pinta imagenes: un panel `rgba()` sobre la foto de un hero se compone contra el fondo de pagina. 32 de los hallazgos de un archivo eran esto. |
| `tiny-text` / `undersized-ui-text` | Depende de si la maqueta de producto se dibujo con texto real o como vector. Asimetrico entre archivos. |
| `marketing-buzzword`, `em-dash-overuse` | Lista de terminos **en ingles hardcodeada**. Ruido puro sobre copy en espanol. |

**Asimetria de instrumento que invalida una comparacion:** si el frame raiz **no tiene fill**, el
detector **omite la familia de contraste entera** y el informe sale absuelto de algo que nadie ha
mirado. Para comparar dos archivos, **los dos frames raiz necesitan fill**.

Y el detector avisa por stderr cuando corre **DEGRADED** (sin `htmlparser2` / `css-select` /
`css-tree` / `domutils`): en ese modo no evalua contraste ni selectores y sus hallazgos son un
subconteo. `audita-calidad.mjs` **aborta** en ese caso en vez de reportar un falso limpio.

## `transition` escrita por API — el atajo que desaparece entero

**Webflow cruza `transition-property`, `transition-duration` y `transition-timing-function` POR
INDICE** para componer el atajo que publica. Si las dos ultimas traen un solo valor y la primera
trae cuatro propiedades —CSS perfectamente legal, una duracion unica se aplica a toda la lista— lo
que sale publicado es esto:

```css
transition: background-color .16s cubic-bezier(.2,0,0,1),
            color undefined undefined,
            transform undefined undefined,
            box-shadow undefined undefined;
```

Y `transition` es una propiedad de **lista**: si un item no parsea, el navegador descarta **la
declaracion completa**. Resultado medido: `transition-duration: 0s`. La transicion no existe.

El sintoma es casi invisible. El `:hover` **si** cambia el color, porque su regla esta bien; cambia
de golpe. Un salto de 0 ms se lee como «no pasa nada», no como un defecto. Y un `grep` de la hoja da
falso verde, porque la palabra `transition` esta ahi. Medido en un cliente real: **21 de 21** clases
afectadas, durante semanas, con todos los demas gates en verde.

**Regla: tantos valores de duracion y de curva como propiedades haya**, aunque se repitan.

```
transition-property:        background-color, color, transform, box-shadow
transition-duration:        160ms, 160ms, 160ms, 160ms
transition-timing-function: cubic-bezier(.2,0,0,1), cubic-bezier(.2,0,0,1), cubic-bezier(.2,0,0,1), cubic-bezier(.2,0,0,1)
```

**El unico instrumento que lo caza es el navegador** (`getComputedStyle`), que ya aplico el parser.
Lo cubre `gate-estados.mjs`.

### Y antes de poner `transition` en una clase: ¿se la escribe un script?

Una clase **no debe** traer `transition` sobre propiedades que un script le escriba en linea. Si el
motor de scroll hace `set(el, { opacity: 0, y: 24 })` sobre un elemento cuya clase transiciona
`opacity`, **ese estado inicial se anima**: el elemento se ve, se desvanece y vuelve. Parpadeo en la
carga.

La cura es declarar esa transicion **desde el script, en el `onComplete` del revelado**, cuando ya
hay un estado pintado del que transicionar. La clase se queda solo con lo que el script no toca.
Bonus correcto: bajo `prefers-reduced-motion` el script no corre, asi que no hay transicion.

**Y el gate que mide estados tiene que RECORRER la pagina antes de medir.** Una foto a los 600 ms
acusa de muertas justo a las clases curadas asi, porque su transicion aun no se ha declarado.
