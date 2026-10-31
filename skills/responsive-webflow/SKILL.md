---
name: responsive-webflow
description: "Auditar y planear responsividad en sitios Webflow. Perfila el sitio leyendo el HTML servido, corre los gates que la paridad a un solo ancho no ve (corte de banda, conmutadores, regimen por banda), mide la rubrica estetica entre anchos, y emite la receta en modo UNIDAD (escala por frame) o NATIVO (clamp + breakpoints del Designer). Cierra el bucle volviendo a medir. Incluye el EVALUADOR FUNCIONAL con loop iterativo (evalua-responsivo: integridad a ciegas en las ventanas reales del usuario, escenas fijadas, continuidad, paginas hermanas y registro de escapes) para responder sin una persona delante si un sitio de verdad es responsive y funciona. Es la etapa final del playbook por bandas de clone-to-webflow."
argument-hint: "[url] — o nada, y lo lee de responsive.config.json"
metadata:
  author: alto-house
  version: "1.0.0"
  status: "motor de modo UNIDAD validado por regresion contra Cliente A 2026-09-06; gates propios probados contra sitio vivo y contra caso roto"
---

# Responsive Webflow

Un sitio no se rompe a 1440. Se rompe a 812, a 1024 y a 1849 — los anchos que nadie prueba. Y
antes de romperse se pone feo: el párrafo llega a 92 caracteres por línea, el H1 deja de mandar
sobre el cuerpo, el aire entre secciones que era generoso a 390 aprieta a 1920. Nada de eso
dispara un gate de desborde.

Este skill mide las dos cosas y receta una de dos maneras.

> **Un gate de paridad a un solo ancho no prueba responsive.** A 1440 exacto, `100%` y `1440px` son
> el mismo número.

## Los dos modos

| | UNIDAD | NATIVO |
|---|---|---|
| fuente de verdad | el frame de Figma de cada banda | el sitio vivo |
| caja | `calc(px * var(--u))` | flex/grid + `clamp()` topado |
| tipografía | `--t` display, `--tb` lectura/UI | tokens `clamp()` |
| dónde vive | Site Settings → Head | Designer + Variables |
| apto para | landings, composición dibujada | CMS, heredados, lo que otro mantendrá |

Ver `references/modos.md`. **`perfil.mjs` propone el modo; no lo impone.**

## Cuándo corre

Este skill es la **etapa E** del playbook por bandas de `clone-to-webflow`
(`references/playbook-por-bandas.md`): figma → escritorio → móvil → tablet → **responsividad**.
Corre entero cuando escritorio, móvil y tablet de la página están **aprobados** por el usuario. Medir
continuidad entre bandas que todavía se mueven es medir ruido, y arreglar una banda mientras otra
sigue abierta es lo que en Cliente A costó tres sesiones.

```bash
node ~/.claude/skills/clone-to-webflow/scripts/playbook.mjs puede responsividad --pagina <p>   # exit 1 → se para
```

Dos excepciones, y solo estas: la **derivación de anchos** (`conmutadores` → `barrido-continuidad` →
`plan-anchos`) se corre desde la etapa de escritorio, porque los gates de la Fase 5 leen ese plan; y
sobre un **sitio existente** se puede auditar en cualquier momento (`audita-responsivo.mjs`), que no
escribe nada. Lo que no se hace fuera de la etapa E es **aplicar** recetas.

La cobertura **no depende de las ventanas del usuario**: se mide siempre el catálogo de ventanas reales de
`lib/viewports.mjs`. Si él menciona una ventana concreta donde vio algo, se suma a `dispositivos`.

## Instalación en un cliente

```bash
cd <carpeta del cliente>
cp ~/.claude/skills/responsive-webflow/templates/responsive.config.json .
$EDITOR responsive.config.json      # es lo unico que cambia entre clientes
```

Si ya hay un `harness.config.json` de clone-to-webflow subiendo desde el cwd, se lee ese y no hace
falta el propio. Sin ninguno de los dos, todo aborta con instrucciones: **no hay sitio por defecto
a propósito**, porque un default silencioso mide el sitio equivocado y el número parece válido.

Los scripts viven en el skill y se invocan desde la carpeta del cliente:
`node ~/.claude/skills/responsive-webflow/scripts/<x>.mjs`.

## Reglas no negociables

1. **Se mide el HTML servido**, con `curl`/Playwright contra `https://{shortName}.webflow.io`.
   Nunca la respuesta de la API —puede aceptar la escritura y el sitio servir otra cosa— ni
   `*.design.webflow.com`, que es el shell vacío del Designer.
2. **Un gate omitido no es un gate en verde.** Sale como OMITIDO con su motivo, y así se reporta.
3. **Un criterio que no se pudo medir se dice.** Omitir la fila hace que el informe parezca verde.
4. **Solo staging.** Producción es compuerta humana.
5. **El CSS de modo UNIDAD se genera, no se escribe.** Editarlo a mano lo desacopla del JSON de
   medidas y la siguiente generación lo pisa.
6. **Ningún número estético sentencia solo.** Los cuatro criterios medidos son evidencia para el
   council, no veredicto.

---

## Fase 0 · El instrumento antes que el sujeto

```bash
cd ~/.claude/skills/responsive-webflow && npm run selftest
```

**`INSTRUMENTO VALIDADO` o el comando para.** Incluye la regresión del motor de modo UNIDAD contra
un caso con respuesta conocida: Cliente A construyó su escala el 2026-09-06 con un generador escrito a
mano y la verificó en once anchos con cero diferencias. El motor generalizado tiene que reproducir
ese CSS declaración a declaración y esa tabla ancho a ancho. Si no, la generalización perdió algo.

## Fase 1 · Perfil del sitio

```bash
node ~/.claude/skills/responsive-webflow/scripts/perfil.mjs [url]
```

Lee el HTML servido y saca, **por capa** (hoja nativa / `<style>` del head / `<style>` de los
Embed): cortes reales, conteo de `clamp()`/`vw`/`%`/`dvh`/`svh`, variables de unidad, `zoom` en
`body`, `data-wf-component`.

Sumar las capas mezcla lo que Webflow trae de fábrica con lo que escribió el proyecto y hace la
medición incomparable. La capa del `<body>` **gana por orden**: si tiene clases que no existen en
la nativa, una style guide page no las gobierna.

**El modo se propone.** Si choca con el config, se para y se decide antes de medir nada más.

## Los anchos no son una lista: se derivan

Windows maximizado cae en pocos anchos discretos: problema de **muestreo**, una lista lo cubre. Mac
en ventana cae en un **continuo**: problema de **continuidad**, y ninguna lista lo cubre por larga
que sea. Anadir muestras a un continuo sigue siendo muestrear. Medido en Cliente A: de 16 anchos a
mano, 7 eran muestras repetidas de un mismo estado y la banda con once estados tenia cinco.

```bash
node …/scripts/conmutadores.mjs          # cortes reales del CSS, por pagina
node …/scripts/barrido-continuidad.mjs   # tramos fluido/rigido/congelado, fronteras al pixel, continuidad
node …/scripts/plan-anchos.mjs           # -> responsive-out/plan-anchos.json, con huella
```

| Tramo | El plan genera |
|---|---|
| fluido | min, medio y max (la continuidad ya la aserto el barrido) |
| rigido | **un** ancho, solo tras `prueba-invariante` por pixeles en sus dos extremos; si no, se muestrea y se dice |
| congelado | un ancho |
| frontera | `N-1` y `N`, del pixel que biseco el barrido |
| contrato de movimiento | siempre |

`barrido-continuidad` sigue **bloques de texto** por identidad (una seccion a sangre mide igual que el
viewport y esconde el contenedor), segmenta por regimen, juzga con **residuo contra MAD** (piso 4 px),
biseca cada frontera y la contrasta con los cortes. Distingue **saturacion** (un `max-width` que llega a
su tope: continuo, INFO) de **discontinuidad** (brinca: HIGH). Los gates de `clone-to-webflow` leen el
plan con huella; si no existe, caen a la lista del config y dicen `POR_DEFECTO`.

## Fase 2 · Barrido y gates

```bash
node ~/.claude/skills/responsive-webflow/scripts/audita-responsivo.mjs
```

Un runner, un informe (`INFORME-RESPONSIVO.md`, severidad CRITICAL/HIGH/MEDIUM/LOW/INFO), un exit
code. Orquesta lo propio y lo prestado:

| Gate | Qué mide | De dónde |
|---|---|---|
| `perfil.mjs` | modo, capas, cortes reales | propio |
| `conmutadores.mjs` | los cortes del CSS y quién vive en cada uno | propio |
| `gate-banda.mjs` | **busca por bisección** dónde conmuta cada pieza | propio |
| `mide-estetica.mjs` | los cuatro criterios medibles de la rúbrica | propio |
| `barrido-continuidad.mjs` | continuidad a cualquier ancho; tramos y fronteras | propio |
| `plan-anchos.mjs` | el plan de medicion derivado, con huella | propio |
| `gate-desborde.mjs` | desborde **recorriendo**, N anchos × N páginas | clone-to-webflow |
| `mide-escalado.mjs` | centrado + desborde + tope en 15 anchos | clone-to-webflow |
| `gate-pines.mjs` | escenas fijadas: ancho del pin, centrado, recortes, entrada y salida | propio |
| `gate-integridad.mjs` | defectos sin declarar, a ciegas, recorriendo cada ventana | propio |
| `regimen-multiancho.mjs` | régimen por sección en todas las bandas, fundido | envuelve el prestado |

**`gate-banda` no comprueba pares a ciegas.** Un par 767/768 no ve el fallo que importa, porque a
los dos lados del par la nav puede ser la misma y el problema vivir en 991. Busca el ancho exacto
donde conmuta cada pieza y después: las dos piezas del mismo rol conmutan juntas, cada conmutador
cae sobre un límite de banda declarado, exactamente una pieza por rol a cada ancho, desborde cero.
Los **tramos mixtos** se reportan como dato — pueden ser deliberados.

## Fase 2b · Evaluación funcional y loop

Los gates de arriba miden lo que alguien declaró. Esto responde la pregunta que hasta ahora
contestaba una persona con su iPad: **¿está roto en alguna ventana?** Detalle, pesos y protocolo en
`references/rubrica-funcional.md`.

```bash
S=~/.claude/skills/responsive-webflow/scripts
node $S/evalua-responsivo.mjs --rapido     # para iterar: dispositivos + frames
node $S/evalua-responsivo.mjs              # la vuelta que cierra: todas las ventanas, barrido y hermanas
node $S/hoja-contacto.mjs                  # con PASS: capturas para el evaluador visual a ciegas
node $S/evaluador-visual.mjs --motor=codex # las lee OTRO modelo, por la suscripcion de ChatGPT: ciego y sin gastar la sesion
```

| | Criterio | Instrumento |
|---|---|---|
| R0 | cobertura: catálogo de 25 ventanas reales (ancho **y alto**, con portátiles de alto corto) + plan derivado + frames; las del usuario se suman | `lib/viewports.mjs` — sin ello la nota topa en 8.9 |
| R1 | integridad: texto recortado o pisado, control que no se puede pulsar, desborde, imagen rota, objetivo táctil — **sin selectores del cliente** | `gate-integridad.mjs` |
| R2 | escenas fijadas, y los pines que nadie declaró (C9) | `gate-pines.mjs` |
| R3 | continuidad entre anchos | `barrido-continuidad.mjs` |
| R4 | corte de banda | `gate-banda.mjs` |
| R5 | la misma pieza mide igual en páginas hermanas (`hermanas`) | `evalua-responsivo.mjs` |
| R6 | todo defecto que vio una persona tiene ya un check (`spec/escapes.json`) | `evalua-responsivo.mjs` |
| R7 | paridad de contenido: lo que hay en escritorio existe en tablet y en móvil | `gate-paridad.mjs` |

**El loop**: evaluar → arreglar **un** hallazgo, el que más resta → publicar a staging → no-regresión →
evaluar. Para en PASS (≥ 9.5 y cero HIGH), en **meseta** (dos vueltas sin mejorar, exit 3) o a las
seis iteraciones. El evaluador no arregla y quien arregla no se puntúa. Si la nota baja, el arreglo
se revierte.

**Un escape** —algo que ve una persona después de un PASS— se apunta en `spec/escapes.json` y se
convierte en check **antes** de arreglarlo. Es como el instrumento aprende; la medida de que funciona
es que los escapes por aprobado tiendan a cero.

## Fase 3 · Juicio estético

`mide-estetica.mjs` mide cuatro de los seis criterios de `references/rubrica-responsiva.md`:
coherencia de razones, medida (caracteres por línea), techo tipográfico y ritmo vertical.

Encima, el **council a ciegas** (`prompts/council-*.md`): dos auditores sobre el mismo pliego, sin
verse. Reciben los números ya medidos como datos, no como preguntas, y juzgan lo que ningún número
puede: si la versión móvil es el mismo sistema, si el tramo mixto es deliberado, si lo que se pierde
al bajar de banda se pierde a propósito.

## Fase 4 · Receta

### Modo UNIDAD

```bash
cp ~/.claude/skills/responsive-webflow/templates/medidas.schema.json medidas.json
# rellenar con las medidas de los frames — ver abajo
node .../scripts/genera-unidad.mjs medidas.json --verifica    # resuelve sin escribir
node .../scripts/genera-unidad.mjs medidas.json               # escribe el CSS
node .../scripts/verifica-unidad.mjs <url|mini-clon> medidas.json
```

**De dónde salen las medidas.** No hay script que las extraiga: un proceso de node no puede hablar
con el MCP de Figma. Las lee **el agente**, con `get_metadata` sobre el frame de cada banda, y
escribe el JSON. El procedimiento por elemento es el mismo siempre: medirlo en el frame de su banda,
anotar `x y w h r` en px de ese frame, y marcar `f` según lo que sea —`t` si es display (H1, H2,
lede), `tb` si es lectura o UI (cuerpo, nav, botones, campos, legal), `u` si es una caja.

Las posiciones derivadas (un icono centrado sobre un panel, una fila de columnas) se **resuelven al
escribir el JSON**, con el número puesto. El generador no calcula posiciones: esa lógica es
exactamente lo que se quitó del motor al generalizarlo, y devolverla lo vuelve a atar a un sitio.

El CSS va en **Site Settings → Head**, no por `whtml_builder`, que rechaza los cortes 767/1199.

Un elemento ausente en una banda **no vale**: hereda la caja de la banda anterior sin decirlo. Hay
que declararlo `oculto: true` (se apaga aquí a propósito) u `oculto: "heredado"` (no se pinta porque
su ancestro no se pinta). El generador aborta si falta.

### Modo NATIVO

`genera-escala-fluida.mjs` de clone-to-webflow emite tokens `clamp()` topados y **se autoverifica
en 9 anchos antes de escribir**, con payloads listos para `create_size_variable` con `custom_value`
—la única forma de meter un `clamp()` en una Variable de Webflow. Encima va el régimen por sección
y una tabla, por sección, de qué cambia en 991 / 767 / 479.

**Una sección sin régimen declarado no pasa.** El default silencioso es exactamente lo que se cuela
hasta llegar al iPad del cliente.

## Fase 5 · Aplicar y volver a medir

Solo staging. Después se corre la Fase 2 otra vez contra la URL publicada y **los números tienen
que salir iguales**. Un número que no se puede reproducir no es un número.

---

## Referencias

- `references/modos.md` — UNIDAD vs NATIVO, cuándo cada uno, y por qué tres factores y no uno.
- `references/rubrica-responsiva.md` — los seis criterios, con su número.
- `references/breakpoints-webflow.md` — las dos listas de breakpoints, la cascada, las dos capas.
- `references/gotchas.md` — lo aprendido, corrida a corrida.

## Relación con clone-to-webflow

Se **reusa**, no se copia (`lib/reuso.mjs`): cinco de los medidores multi-ancho ya existen y están
validados allí. Si no está instalado, los gates propios funcionan igual y los prestados salen como
OMITIDO con el motivo.

A la inversa, este skill se puede llamar como gate desde la Fase 5 de `clone-to-webflow`. En el orden
por bandas de ese harness, este skill es la última etapa (ver «Cuándo corre»).
