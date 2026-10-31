# Playbook por bandas

```
A · figma  →  B · escritorio  →  C · movil  →  D · tablet  →  E · responsividad
```

**Por pagina**, en este orden, y cada flecha es un aprobado de una persona, con fecha, escrito en
`spec/playbook-estado.json` del cliente. Las 8 fases del SKILL dicen COMO se hace cada cosa; este
documento dice EN QUE ORDEN se abren las bandas y que tiene que estar cerrado antes.

## Por que existe

En Cliente A la responsividad se arreglo tres veces a posteriori, una sesion entera cada vez: escenas
fijadas rotas entre 1200 y 1439, un panel recortado porque se leyo como derrame, movil y tablet
rehechos sobre un escritorio que seguia cambiando. La causa comun no fue tecnica. Fue de **orden**:
se abria una banda sin que la anterior estuviera cerrada, y los anchos intermedios no eran de nadie.

## Las cuatro reglas

1. **No se abre una banda sin el aprobado registrado de la anterior.** Lo comprueba
   `scripts/playbook.mjs puede <etapa> --pagina x`. Si dice que no, se para y se le dice al usuario
   que falta. No se «adelanta trabajo» de la banda siguiente.
2. **El aprobado es de una persona y es explicito.** No me lo doy yo. No se infiere de «se ve bien»,
   ni de aprobar un plan, ni de un PASS de gate. Se registra solo cuando el usuario lo dice con
   palabras sobre ESA banda de ESA pagina («escritorio de pricing aprobado»). Es la misma regla que
   el copy (`gotchas-webflow.md`).
3. **Una banda aprobada queda congelada.** Antes de abrir la siguiente: `foto-sitio.mjs antes`. Al
   cerrarla: `foto-sitio.mjs comparar antes despues`. Cero cambios en las congeladas, o se adjudica.
4. **Corregir una banda aprobada es reabrirla**, con motivo: `playbook.mjs reabre`. Las posteriores
   que estaban aprobadas pasan a `por-reverificar`: conservan su aprobado pero hay que volver a
   medirlas (`reverifica`, con informe en verde) antes de seguir. La correccion entra por la Fase 8:
   primero el gate que FALLA, despues el arreglo.

## Las cinco etapas

### A · Figma completo
- **Entra si** hay sitemap y copy de la pagina.
- **Se hace**: los TRES frames de la pagina —@1440, @768 y @390— declarados en
  `figma.framesPorPagina.<pagina>` del config. Fase 1 del SKILL sobre los tres (calidad, radios,
  regimen, escalado, fuente). Ademas, anotado en el frame o en `spec/`:
  - **regimen por seccion**: fluida o rigida (`reglas-de-sistema.md`). «Una seccion sin regimen no pasa».
  - **escenas fijadas**: que se fija, cuanto recorrido, que pasa al entrar y al soltar, y que hace en
    movil (en tactil no hay retencion de scroll). Van a `spec/movimiento.json`.
  - **formas que cruzan secciones**: un panel sin borde ni radio inferior CONTINUA en la seccion
    siguiente. Es una sola forma aunque en el DOM vayan a ser dos cajas. Se anota como una.
  - **tablet no es escritorio encogido**: si una seccion en @768 es el escritorio reencuadrado, se
    dice; si refluye, se dibuja.
  - **las mismas secciones en los tres frames**: se listan las secciones de @1440 y se comprueba una a una que están en
    @768 y en @390. La que falte se dibuja o se declara omitida con su porqué. En Cliente A una sección entera de
    `/product` no existía en los frames de tablet ni de móvil, el port los copió fielmente y nadie lo vio en semanas.
- **Sale con**: Fase 1 sin FAIL abierto, los tres frames existentes y con las mismas secciones. `aprueba figma` se niega si falta un frame.
- **Aprueba** el usuario, en Figma.

### B · Escritorio
- **Entra si** A esta aprobada (`--sitio-existente`: basta el frame @1440).
- **Se hace**: Fases 2–4 del SKILL **solo al ancho de escritorio**. No se escribe una sola regla de
  movil ni de tablet, aunque «ya que estamos». Fase 5 en los anchos de escritorio, **incluidos los de
  ENCIMA del frame** (1536, 1728, 1864, 1920): la ventana de un Mac no es ningun frame.
- **Sale con**: paridad ≥ umbral, gates de escritorio en verde, informe guardado.
- **Aprueba** el usuario en SU Chrome, con scroll real y sin reduced-motion. Un veredicto visual suyo
  gana a un PASS numerico.

### C · Movil
- **Entra si** B esta aprobada.
- **Se hace**: el frame @390 es la FUENTE, no el escritorio encogido. Texto nativo (el texto no
  escala como el layout), objetivos tactiles, gestos en vez de retencion de scroll. Las piezas de
  escritorio que no van se ocultan sin borrar.
- **Sale con**: paridad @390, `gate-desborde` y `gate-encaje` en anchos moviles (320–479), bandas
  congeladas sin cambios.
- **Aprueba** el usuario en su telefono real. El emulador no tiene barra de URL que se encoge.

### D · Tablet
- **Entra si** C esta aprobada. Va despues de movil a proposito: tablet se decide entre dos extremos
  ya cerrados, y casi siempre reusa piezas de uno u otro.
- **Se hace**: frame @768. Que refluye y que es escritorio reencuadrado se decide **por seccion**,
  nunca con un factor global.
- **Sale con**: paridad @768, gates de tablet (768–1199), `gate-banda` en 767/768, congeladas sin cambios.
- **Aprueba** el usuario en tablet real, vertical y horizontal.

### E · Responsividad
- **Entra si** B, C y D estan aprobadas. Antes no: medir continuidad entre bandas que todavia se
  mueven es medir ruido.
- **Se hace**: skill `responsive-webflow`. Los anchos se DERIVAN del sitio (`conmutadores` →
  `barrido-continuidad` → `plan-anchos`), no se escriben a mano. Lo que se mira aqui es lo que no es
  ningun frame:
  - los cortes de banda, a N−1 y N (`gate-banda`);
  - el tramo entre el minimo de escritorio y el frame (1200–1439): portatiles, un iPad como Sidecar
    (1310), un iPad Pro horizontal (1366);
  - por encima del frame: que se congela y que sigue creciendo;
  - el ALTO de ventana de las escenas fijadas (800, 900, 945, 1024), no solo el ancho;
  - las escenas fijadas a todos esos anchos (`gate-pines`).
- **Sale con**: `evalua-responsivo.mjs` en **PASS** (≥ 9.5, cero HIGH) en su vuelta completa, sobre el
  catálogo de ventanas reales; hoja de contacto leída por el evaluador visual; congeladas sin
  cambios. El loop y sus paradas: `responsive-webflow/references/rubrica-funcional.md`.
- **Aprueba** el usuario donde el mire. No se le pide una lista de dispositivos: sus ventanas son donde
  trabaja, no donde miran sus clientes, y la cobertura la pone el catalogo.

## Antes de pedir un aprobado, en CUALQUIER banda

El aprobado del usuario no es el primer par de ojos, es el último. Antes de pedírselo:

```bash
node ~/.claude/skills/responsive-webflow/scripts/evalua-responsivo.mjs --solo=<pagina>
```

y se itera hasta PASS, meseta o seis vueltas. El informe (`responsive-out/EVALUACION.md`) es la
`--evidencia` de `aprueba`. Si el usuario encuentra algo después de un PASS, eso es un **escape**:
se apunta en `spec/escapes.json` y se vuelve check antes de arreglarlo.

## El registro

```bash
P=~/.claude/skills/clone-to-webflow/scripts/playbook.mjs
node $P estado                                   # tablero: paginas × etapas y la siguiente accion
node $P puede movil --pagina pricing             # exit 1 y el motivo si no toca todavia
node $P abre  movil --pagina pricing             # la marca en curso y recuerda la foto de lo congelado
node $P aprueba movil --pagina pricing --por Revisor --evidencia responsive-out/gate-desborde.md --nota "iPhone 15"
node $P reabre escritorio --pagina pricing --motivo "el panel del hero se recorta"
node $P reverifica movil --pagina pricing --evidencia responsive-out/foto-sitio.comparar.md
```

- `aprueba` exige `--por` (y rechaza nombres de agente), exige un informe que exista, y se niega si el
  informe trae un rojo salvo que se diga con que KL esta adjudicado (`--adjudicado KL-nnn`).
- Aprobados anteriores al playbook: `--retroactivo --fecha AAAA-MM-DD --fuente "donde consta"`. Solo
  lo que CONSTA en el RUN-LOG o lo confirma el usuario. No se inventan.
- `playbook.modo: "sitio-existente"` en el config: no se exige la etapa A aprobada, pero para abrir
  una banda sigue haciendo falta SU frame.
- `playbook.bandas` cambia los anchos de frame si el cliente no usa 1440/768/390.

## Orden entre paginas

`ordenPort` del config. Pagina piloto barata y compartida primero; las que llevan escenas fijadas,
al final. Se puede llevar una pagina en C mientras otra esta en B: el registro es por pagina. Lo que
no se puede es tener dos etapas abiertas en LA MISMA pagina.

## Publicar

Todo lo anterior vive en staging. Produccion la publica el usuario; el chequeo previo es el skill
`webflow-mcp:safe-publish` y la higiene de `ah-seo-schema`. El playbook no lo reimplementa.
