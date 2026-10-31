---
name: clone-to-webflow
description: "Harness portatil Figma → Webflow. Audita el diseno en Figma antes de tocar Webflow (calidad/AI-slop, radios, regimen responsivo, tokens, movimiento), construye la pagina base del cliente, portea seccion a seccion con un scorer determinista, corre los gates que la paridad no ve, y publica SOLO a staging. Se reabre con --corregir cuando algo no esta bien. Usalo SIEMPRE que se vaya a desplegar, implementar, portar o corregir un sitio en Webflow, o a pasar una pagina a movil, tablet o responsividad: aplica el playbook por bandas (Figma completo en escritorio, tablet y movil → escritorio → aprobado → movil → aprobado → tablet → aprobado → responsividad) y no abre una banda sin el aprobado registrado de la anterior."
argument-hint: "(se lanza con /clone-to-webflow — ver el comando para las banderas)"
metadata:
  author: alto-house
  version: "1.0.0"
  status: "motor validado contra Cliente A; fases 2-8 en primera corrida"
---

# Clone-to-Webflow

Portar un diseno a Webflow se rompe siempre igual: el ojo dice «se parece» y el numero dice otra
cosa. Este harness cierra el bucle con un **scorer determinista**, no con un modelo. El juicio de un
modelo entra donde de verdad aporta —calidad de diseno— y no donde produce ruido: contra un DOM la
medicion es reproducible, y un evaluador cualitativo derivo 9→8→7 sobre un frame que nunca cambio.

## Antes de nada: los dos ejes

| Eje | Pregunta | Instrumento | Fase |
|---|---|---|---|
| **Calidad** | ¿esta bien hecho? | `audita-calidad.mjs` (77 reglas de Impeccable sobre el frame) | 1 |
| **Fidelidad** | ¿el build se parece a la referencia? | `parity.mjs` + `score.mjs` | 3-4 |

Hacen falta los dos y en este orden. **Un clon puede sacar 10/10 de fidelidad replicando una
porqueria**, y no tiene sentido portar con precision de pixel un diseno que no deberia construirse.

## Instalacion en un cliente

```bash
cd <carpeta del cliente>
cp ~/.claude/skills/clone-to-webflow/templates/harness.config.json .
cp ~/.claude/skills/clone-to-webflow/templates/KNOWN_LIMITATIONS.seed.md KNOWN_LIMITATIONS.md
$EDITOR harness.config.json     # es LO UNICO que cambia entre clientes
```

Los scripts se invocan desde la carpeta del cliente y viven en el skill:
`node ~/.claude/skills/clone-to-webflow/scripts/<x>.mjs`. El config se busca **subiendo** desde el
directorio de trabajo. Sin config, todo aborta con instrucciones: no hay sitio por defecto a
proposito, porque un default silencioso mide el sitio equivocado y el numero parece valido.

## Reglas no negociables

1. **Publicar solo a staging.** `publishToWebflowSubdomain: true, customDomains: []`. Produccion es
   gate humano. Un hook `PreToolUse` lo bloquea, no solo el prompt.
2. **Verificar en el HTML servido**, con `curl` contra `https://{shortName}.webflow.io`. Nunca en la
   respuesta de la API —puede aceptar la escritura y el sitio servir otra cosa— ni en
   `*.design.webflow.com`, que es el shell vacio del Designer.
3. **Gana la procedencia.** Si el frame de Figma y el sitio discrepan por una decision ya aprobada,
   gana el sitio y se repinta el frame. No se le quitan al sitio elementos aprobados para que
   cuadre con un frame viejo.
4. **Un numero que no se puede reproducir no es un numero.** Tras publicar se vuelve a medir contra
   la URL publicada y los numeros tienen que salir iguales.
5. **Reportar lo que no se logro, con su numero.** Una desviacion declarada recibe verdict
   `DESVIACION`: no se le sube el score, porque eso corrompe el instrumento.
6. **El copy no se escribe en el Designer sin un «aplicalo» explicito.** Aprobar un plan que lo
   menciona no es autorizacion. Ver `references/gotchas-webflow.md`.
7. **No se abre una banda sin el aprobado registrado de la anterior.** El orden es el de abajo y lo
   vigila `scripts/playbook.mjs`. El aprobado es de una persona, explicito y con fecha: un PASS de
   gate no es un aprobado, y el agente no se aprueba a si mismo.

## El orden por bandas

```
A · figma  →  B · escritorio  →  C · movil  →  D · tablet  →  E · responsividad
```

Por pagina. Las 8 fases dicen **como**; esto dice **en que orden** y que tiene que estar cerrado antes.

| Etapa | Se abre si | Fases que corren | Se cierra con | Aprueba el usuario en |
|---|---|---|---|---|
| **A · figma** | hay sitemap y copy | 1 sobre los TRES frames (@1440, @768, @390) | Fase 1 sin FAIL y los tres frames declarados | Figma |
| **B · escritorio** | A aprobada | 2, 3, 4 solo a escritorio; 5 en anchos de escritorio, tambien por ENCIMA del frame | paridad ≥ umbral + gates | su Chrome, scroll real |
| **C · movil** | B aprobada | 3, 4, 5 contra el frame @390 | paridad + gates moviles; escritorio sin cambios | su telefono |
| **D · tablet** | C aprobada | 3, 4, 5 contra el frame @768 | paridad + gates de tablet; B y C sin cambios | tablet real |
| **E · responsividad** | B, C y D aprobadas | 5 completa con `responsive-webflow`: anchos derivados, cortes de banda, 1200–1439, escenas fijadas | `evalua-responsivo` en PASS (loop de `rubrica-funcional.md`) | los dispositivos que usa |

```bash
P=~/.claude/skills/clone-to-webflow/scripts/playbook.mjs
node $P estado                          # tablero y siguiente accion permitida por pagina
node $P puede <etapa> --pagina <p>      # exit 1 y el motivo: se PARA y se le dice al usuario que falta
node $P abre  <etapa> --pagina <p>      # en curso; recuerda la foto de las bandas congeladas
node $P aprueba <etapa> --pagina <p> --por <persona> --evidencia <informe>   # SOLO cuando lo dice con palabras
node $P reabre <etapa> --pagina <p> --motivo "…"    # correccion: las posteriores pasan a por-reverificar
```

Una banda aprobada queda **congelada**: `foto-sitio.mjs antes` al abrir la siguiente y `comparar` al
cerrarla. Si falta un frame de cualquier banda, se para y se dice cual. Con `--sitio-existente`
(`playbook.modo: "sitio-existente"`) no se exige la etapa A aprobada, pero cada banda sigue
necesitando SU frame. El detalle de cada etapa y el porque: `references/playbook-por-bandas.md`.

## Las 8 fases

### Fase 0 · El instrumento antes que el sujeto
```bash
cd ~/.claude/skills/clone-to-webflow && npm run selftest
```
**`INSTRUMENTO 22/22 VALIDADO` o el comando para.** 16 comprobaciones del motor de diff y 6 del
evaluador. Los seis numeros del evaluador son la firma: `identica 10 · dimensiones 0 · borde
ausente 8.63 · radio 12→4 9.5 · offset 20px 5.0 · solo antialiasing 10`. Si alguno cambia, el motor
perdio algo.

Se cargan `KNOWN_LIMITATIONS.md`, `spec/floors.json` y `spec/desviaciones.json`. Las decisiones ya
adjudicadas entran a los prompts como `<accepted_limitations>` que **no se re-cobran**: sin eso, el
ciclo redescubre lo resuelto y deja secciones en meseta por hallazgos sin solucion.

Se lee tambien **`spec/movimiento.json`**, el contrato de movimiento: es parte del gate, no un extra.
Sin el, `gate-movimiento.mjs` no arranca. Plantilla: `templates/movimiento.seed.json`. **Sus
`anchos` mandan sobre los del config**: el contrato esta indexado por ancho y el gate mide esos.

**Compuerta de fuente**, antes de construir nada en Figma: correr el probe de `loadFontAsync`. Si la
fuente de foundry no esta, elegir sustituto **por metrica de ancho, no por parecido de caracter** —
el ancho es lo que rompe layouts. Webflow si acepta subir la fuente real: la sustitucion es solo del
mockup.

## Los dos modos de entrada

| Fase | Sitio nuevo (por defecto) | `--sitio-existente` |
|---|---|---|
| 0 · Instrumento | si | si |
| 1 · Auditoria de Figma | **gate bloqueante** | se salta si no hay frame; con frame, informa sin bloquear |
| **1b · Linea base** | — | **si**: `foto-sitio antes` · `gate-desborde` · `gate-movimiento` · `inventario-estilos` |
| 2 · Pagina base `/styleguide` | si | **se salta** — el sitio ya tiene sistema |
| 3-4 · Bucle de paridad | si | solo en las secciones tocadas |
| 5 · Gates | si | **siempre completa** |
| 6-7 · Publicar / informe | si | si, mas `foto-sitio comparar antes despues` |

`--sitio-existente` es lo que antes hacia el comando `/figma-to-webflow` con su propio motor atado a
un cliente. Ahora es un modo de este, con el mismo motor. `--saltar-referencias` reutiliza los PNG
de `reference/` en vez de reexportarlos de Figma.

### Fase 1 · Auditoria de diseno en Figma — GATE BLOQUEANTE
No se toca Webflow con un FAIL de diseno abierto. **Primero se reconcilia, despues se mide**:
auditar contra un frame caduco produce un informe que pide deshacer lo que el cliente aprobo.

```bash
node …/scripts/audita-calidad.mjs        spec/shim.html      # calidad / AI-slop
node …/scripts/audita-regimen.mjs        --ancho 1440        # fluida vs rigida, por seccion
node …/scripts/audita-regimen.mjs        --ancho 390         # y en el ancho de las moviles
node …/scripts/radios.mjs                1440                # escala por lado menor
node …/scripts/audita-radios-anidados.mjs --figma arbol.json # regla concentrica
node …/scripts/mide-escalado.mjs                             # centrado, desborde y tope de 1440
```

El shim (`scripts/figma-shim.js`) corre **dentro de `use_figma`** y transpila el subarbol a HTML
sintetico; su salida es lo que come `audita-calidad.mjs`. El arbol para los radios lo vuelca el
agente en el formato que documenta `audita-radios-anidados.mjs`.

**Vinculacion de tokens: tree walk de `boundVariables` via `use_figma`, nunca `get_design_context`.**
Ese emite valores resueltos, donde una propiedad enlazada y una hardcodeada se ven identicas.
Medido: 8 de 8 nodos declarados "hardcodeados" estaban enlazados a las variables que el propio
informe nombraba.

Con las mediciones en la mano se corre el **council a ciegas** (`prompts/council-*.md`): el mismo
pliego a Codex y al agente `webflow-design-auditor`, sin que ninguno vea las conclusiones del otro,
y despues el diff. El valor no esta en que coincidan: esta en lo que uno ve y el otro no.

### Fase 1b · Linea base — solo con `--sitio-existente`
Antes de tocar nada, dejar escrito el «antes». Sin esto no hay contra que medir la no-regresion:
```bash
node …/scripts/foto-sitio.mjs antes          # todas las paginas x todos los anchos, pagina entera
node …/scripts/gate-desborde.mjs             # desborde RECORRIENDO, con el plan derivado si existe
node …/scripts/gate-movimiento.mjs           # el contrato, contra el sitio publicado
node …/scripts/inventario-estilos.mjs        # las dos capas de CSS y sus duplicados
```
Con `--solo-auditar`, el comando termina aqui y emite el informe.

### Fase 2 · Pagina base — `/styleguide` en el sitio del cliente
Se construye una vez y es la referencia contra la que se auditan todas las paginas. **El orden
importa** — ver `references/pagina-base.md`:

0. `genera-escala-fluida.mjs` → tokens `clamp()` topados en 1440, como Variables con `custom_value`.
1. Variables del resto de tokens. Se vinculan **solo donde el valor actual es identico**.
2. Clases nativas base: tipografia, superficie, layout.
3. Elementos reutilizables (botones, chips, cards) → **clases + combo, no componentes**.
4. Componentes reales: **solo navbar y footer**.

### Fase 3 · Bucle local barato — descubrir
Construir la seccion como HTML local e iterar contra el PNG de Figma exportado 1:1
(`download_assets`, `defaultScale: 1`). ~2 s por vuelta.

```bash
node …/scripts/parity.mjs <etiqueta> build/local/<x>.html "<selector>" 1440
```

**El loop caro se reserva para confirmar, no para descubrir.**

La **mascara de texto** (`spec/sections/<sec>.<ancho>.textrects.json`) es obligatoria y **por
ancho**: sin ella la geometria puntua 10 por defecto y el gate miente; y movil puede tener otra
estructura, no solo otro ancho.

Diagnostico de desplazamiento: **ambos bordes de la tinta movidos = corrimiento real, se corrige.
Un solo borde = antialiasing, se deja.**

### Fase 4 · Port a Webflow y bucle caro — confirmar
`data_whtml_builder` con la **separacion de capas obligatoria**: clase plana al parametro `css`,
todo lo anidado a un Embed. Los detalles y por que aborta la insercion entera: `references/gotchas-webflow.md`.

```bash
node …/scripts/promueve-clases.mjs      # .A etiqueta → .A-etiqueta, con querySelectorAll real
node …/scripts/parity.mjs <etiqueta> https://<short>.webflow.io "<selector>" 1440
```

Rubrica: estructural 0.40 · geometria fuera de texto 0.25 · posicion de texto 0.20 · detalle 0.10 ·
assets 0.05. Dimensiones distintas fuerzan **TOTAL 0**. Para en PASS (≥9.9), en meseta, o a las 6
iteraciones. **Seccion piloto barata y compartida primero**; las paginas con pineado, al final.

### Fase 5 · Los gates que la paridad no ve — G1..G6, y los que eran prosa
**Primero los anchos, derivados del sitio** (skill `responsive-webflow`, se reusa por ruta):
```bash
R=~/.claude/skills/responsive-webflow/scripts
node $R/conmutadores.mjs              # los cortes reales del CSS, por pagina
node $R/barrido-continuidad.mjs       # tramos fluido/rigido/congelado, fronteras al pixel, continuidad
node $R/plan-anchos.mjs               # -> responsive-out/plan-anchos.json, con huella
```
Despues los gates, que leen ese plan (y dicen `POR_DEFECTO` si no existe):
```bash
node …/scripts/gate-desborde.mjs      # G1, medido RECORRIENDO, en los anchos del plan
node …/scripts/gate-movimiento.mjs    # G2, G3, en los anchos del CONTRATO
node …/scripts/gate-estados.mjs       # hover/focus-visible/active: que existan y que TRANSICIONEN de verdad
node …/scripts/gate-encaje.mjs        # cabe lo esencial
node …/scripts/mide-centrado.mjs      # piezas centradas y dentro del marco
node …/scripts/gate-orden.mjs         # orden real de secciones por y (propone si no hay spec/orden.json)
node …/scripts/gate-imagenes.mjs    # imagenes a sangre: sin filete, outline, padding ni bandas (el placeholder de Figma los cuela)
node …/scripts/gate-lineas.mjs      # rayas de extremo a extremo: bajo 992 tocan 0 y W; desde 992, las lineas de margen
node …/scripts/gate-ancla-actual.mjs # enlaces del navbar a #ancla: no toman el estilo de pagina actual al llegar (scroll spy)
node …/scripts/gate-nav-solido.mjs  # el navbar cambia de estado al salir del hero (el script de scroll vive en el footer de cada pagina y duplicateOf no lo copia)
node $R/gate-banda.mjs                # corte de banda limpio: busca por biseccion donde conmuta cada pieza
node $R/gate-pines.mjs                # escenas fijadas: ancho del pin, centrado, recortes, entrada y salida sin salto
node $R/evalua-responsivo.mjs         # la nota funcional y el loop: integridad a ciegas + todo lo anterior (rubrica-funcional.md)
node …/scripts/foto-sitio.mjs comparar antes despues   # sin regresion
```
La tabla completa, el porque de cada umbral y que script cubre cada gate: `references/rubrica.md`.
Se suman **accesibilidad** (skill `accessibility-audit`) e **higiene + schema** (skill `ah-seo-schema`).

**Un gate de paridad a un solo ancho no prueba responsive.** El barrido lo aserta a cualquier ancho:
es la unica forma de cubrir la ventana de un Mac, que no cae en ningun ancho de ninguna lista.

**Y la paridad tampoco prueba los ESTADOS.** Se mide en reposo y con `VT_RM=1`, asi que todo lo que
vive en `:hover`, `:focus-visible` y `:active` le es invisible; `gate-movimiento` cubre revelados de
scroll, no estados de puntero. `gate-estados.mjs` cierra ese hueco, y lo hace preguntandole al
**navegador** (`getComputedStyle`), no a la hoja: un `transition` con un item malformado sigue
escrito en el CSS y el navegador lo descarta entero. Medido en un cliente real: 21 de 21 clases
declaraban transicion y las 21 median `0s`. Ver `references/gotchas-webflow.md`.

### Fase 6 · Aplicar y publicar
Antes de escribir una hoja regenerada: bajar el HTML publicado con `curl`, extraer el `<style>` y
compararlo **declaracion a declaracion** — los selectores coinciden, la diferencia esta en los
valores. **El archivo del repo no es la verdad** si la hoja se edito en vivo. Abortar si queda un
marcador de asset sin sustituir.

Publicar solo a staging, verificar con `curl`, **re-medir** contra la URL publicada.

Orden que no se puede invertir para SEO: **conectar dominio → fijarlo como primario → publicar →
generar sitemap**. Webflow no emite `<link rel="canonical">` sin dominio primario y `/sitemap.xml`
no se puede borrar una vez creado.

### Fase 7 · Informe y memoria del loop
Tabla seccion / antes / despues / nota, gates, desviaciones y lo abierto **con su numero**. Todo
hallazgo nuevo adjudicado se escribe a `KNOWN_LIMITATIONS.md` — es lo que impide que la siguiente
iteracion lo redescubra.

### Fase 8 · Re-entrada por correccion
`/clone-to-webflow --corregir "<lo que esta mal>"`. **El orden de los pasos es lo que lo hace seguro:**

```bash
node …/scripts/detecta-deriva.mjs        # 0 · ¿cambio algo, y quien?
node …/scripts/foto-sitio.mjs antes      # 1 · linea base nueva
#                                          2 · EXTENDER EL GATE antes de arreglar
#                                          3 · re-correr las fases afectadas
node …/scripts/foto-sitio.mjs comparar antes despues   # 4 · no-regresion
#                                          5 · adjudicar en KNOWN_LIMITATIONS o desviaciones
```

**El paso 2 no se salta.** Si el gate dio PASS donde tu ves un defecto, el gate tiene un punto
ciego: se extiende primero y se comprueba que **falla** contra el estado actual. Si no falla, el
gate no sirve y no se avanza. Sin esto el mismo defecto vuelve a pasar la siguiente vez.

Alcance del paso 3: correccion de **diseno** → Fase 1 completa; de **implementacion** → Fases 3-4
solo en lo tocado; **Fase 5 siempre completa**, porque un cambio local rompe el desborde en otro
lado y eso ya paso.

## Referencias

| Archivo | Que contiene |
|---|---|
| `references/playbook-por-bandas.md` | El orden figma → escritorio → movil → tablet → responsividad, que cierra cada etapa y como se registra el aprobado |
| `references/reglas-de-sistema.md` | Radios (las tres reglas), `line-height`, los dos regimenes responsivos, ocultar sin borrar, procedencia |
| `references/pagina-base.md` | Que es componente y que es clase, y por que; el orden de construccion |
| `references/botones.md` | Variantes, estados, el doble contorno |
| `references/gotchas-webflow.md` | El destilado de los 104 KL que aplica a cualquier cliente |
| `references/rubrica.md` | G1..G6, pesos, verdicts, clausula anti-generosidad |
| `references/pliego-council.md` | El pliego ciego y como se hace el diff |
| `vendor/impeccable/PROCEDENCIA.md` | De donde sale el detector de calidad y como actualizarlo |
