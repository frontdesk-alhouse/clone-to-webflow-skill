# Gotchas de este skill

Se alimenta corrida a corrida. Cada entrada dice qué pasó, no qué podría pasar.

## Del motor

- **El `_` de documentación se lee como dato.** Las plantillas documentan cada bloque con una llave
  `_` al lado. Un `_` dentro de `bandas` se lee como una banda más y el validador reporta huecos
  que no existen. Se limpia al cargar (`lib/json.mjs`), no en cada script.

- **`createRequire` quiere un archivo, no un directorio.** `createRequire(dir + '/')` no resuelve;
  `createRequire(dir + '/x.js')` sí. Y Playwright es CJS: `chromium` cuelga de `.default`, no del
  namespace. Los dos juntos hacen que el resolutor "no encuentre" un Playwright que está instalado.

- **Un parser de CSS por líneas se traga reglas enteras.** Los generadores concatenan varias reglas
  en un mismo `push`, así que en el CSS conviven `sel{...}sel{...}` en una sola línea. Un parser por
  líneas mete la segunda regla dentro del valor de la última propiedad de la primera y reporta 149
  diferencias que no existen. Hay que escanear por llaves.

- **Falta el límite izquierdo al buscar variables CSS.** `--u:` sin `(?<![\w-])` delante casa con la
  cola de `--_escala-v2---u: 1`, que es como Webflow emite una Variable de un grupo. El veredicto de
  modo salía al revés. Se aceptan las dos formas, pero con el límite puesto.

## Del método

- **Byte-equivalencia es el criterio equivocado para una generalización.** Al generalizar un
  generador escrito a mano, la lógica derivada que ejecutaba al escribir (posiciones calculadas,
  bucles de columnas) es justo lo que se quita. Comparar bytes mide si se conservó un detalle de
  formato. Lo que hay que comparar es el **conjunto de declaraciones resuelto por selector y por
  banda**, que es lo que el navegador acaba aplicando.

- **"No pintarse" son dos cosas distintas y confundirlas rompe el gate.** Un elemento apagado a
  propósito (`oculto: true`) debe emitir `display:none` y comprobarse. Un elemento que no se pinta
  porque su ancestro no se pinta (`oculto: "heredado"`) no debe emitir nada: un `display:none` sobre
  un selector compuesto apaga lo que sí debía verse. Lo descubrió la prueba de regresión.

- **Medir contra la sección desplaza todo lo de abajo.** Si `y` se toma restando rects contra el
  contenedor de sección, un cambio de alto arriba mueve todo y el gate acusa diez fallos donde hay
  uno. `offsetLeft`/`offsetTop` son el sistema de coordenadas real de `left`/`top`, y funcionan a
  cualquier profundidad sin que el JSON describa el árbol.

- **"Todos los conmutadores comparten un número" es una regla falsa.** Cliente A conmuta la nav en 768
  y los juegos de secciones en 1200, y está bien. Lo que sí se puede exigir: que cada conmutador
  caiga sobre un límite de banda declarado, y que las **dos piezas del mismo rol** conmuten juntas.
  El tramo mixto se reporta como dato, no como fallo — lo juzga el council.

- **Un par 767/768 no prueba el corte.** A los dos lados del par la nav puede ser la misma y el
  fallo vivir en 991. Hay que **buscar** por bisección el ancho donde de verdad conmuta cada pieza.

- **Las dos listas de breakpoints de Webflow no son la misma.** El Designer tiene seis
  (1920/1440/1280/base/991/767/479); `whtml_builder` escribe tres (991/767/479). Tratar 1440 como
  "corte propio" acusa como error algo nativo. Y un `min-width: X` es el otro lado del
  `max-width: X-1`, no un corte nuevo.

- **Un criterio que no se pudo medir se dice.** Omitir la fila hace que el informe parezca verde.
  Sale como `INFO · sin medir en <banda>` con el motivo.

## Del barrido de continuidad (2026-09-07)

- **"3 x mediana" falla en las dos direcciones.** Con la banda 1200-1920 del config, fluido y
  congelado se mezclan, la mediana de los saltos es 0 y todo paso fluido parece un fallo (6 falsos
  positivos). Y en banda fluida el umbral es proporcional al paso: a paso 40 es ciega bajo 80 px, y el
  defecto real que motivo gate-centrado fue de 37. Se segmenta primero y se juzga con residuo contra
  MAD, piso 4 px.

- **"El bloque visible mas ancho" cambia de identidad entre pasos.** A 340 elige uno, a 360 otro, y
  fabrica fronteras que no existen (9 falsas en Cliente A). Los elementos a seguir se eligen UNA vez, se
  marcan con un atributo y se siguen por identidad.

- **Una seccion a sangre mide igual que el viewport.** Seguirla esconde el contenedor rigido de 688
  que hay dentro (la seccion da 800 → 960, el h1 da 688 → 688). Se siguen bloques de TEXTO, que nunca
  van a sangre.

- **El paso que cruza un corte declarado no es parte de ningun tramo.** Su salto no es ni la pendiente
  ni 0, forma un tramo de una muestra, y la biseccion posterior busca un cambio entre dos anchos donde
  no cambia nada. Se saca de la segmentacion y se trata como frontera.

- **Saturacion no es discontinuidad.** Un `max-width` que llega a su tope pasa de fluido a quieto SIN
  brincar: es continuo y es como funciona el CSS fluido. Una discontinuidad brinca. La primera es INFO,
  la segunda HIGH. Cliente A satura en 835 (tablet) y nadie lo habia visto porque no es un corte.

- **Un brinco negativo igual a la pendiente por el paso da D = 0.** A paso 40 un -32 sobre pendiente
  +32 parece una meseta de un paso; a paso 20 son +16 y -16 y se ve. El refinado a medio paso se aplica
  a TODO tramo corto, no solo a los que se mueven.

- **Los hijos directos de una seccion Webflow pueden medir altura 0.** Son envoltorios `.w-embed` con
  el contenido en absoluto dentro. `prueba-invariante` busca la caja de contenido entre TODOS los
  descendientes, por area, no entre los hijos.

- **El contrato de movimiento no lista las secciones en orden de pagina.** En Cliente A lista
  how-it-works segundo y en la pagina va quinto; usarlo como orden esperado acuso un desorden que no
  existia. El orden se declara (`spec/orden.json`) o el gate propone lo que mide y sale con exit 2.

## De las escenas fijadas y los anchos sin frame (Cliente A, 2026-09-16)

- **Los anchos que fallan son los que no son ningun frame.** 1310×945 es un iPad usado como Sidecar;
  1366×1024, un iPad Pro horizontal; 1536 y 1728, portatiles. Ningun gate los media porque todos
  median a 1440 exactos, donde `zoom = 1` y `100% = 1440px`: los errores se cancelan justo ahi.
  318 fallos de 1219 comprobaciones, invisibles. De ahi la etapa de responsividad del playbook.
- **Un pin que escribe px no sobrevive a `zoom` en `body`.** `gate-pines.mjs` lo caza por el ancho
  del pin (C1) y por el salto al soltar (C5). Su caso roto (`tests/roto/pines/`) no usa GSAP: imita lo
  que hace, leer el rect visual y escribirlo como `width` de layout, y da los mismos 1192 px.
- **El ALTO de la ventana tambien es una variable.** Una escena fijada de 900 px de alto se comporta
  distinto a 800 y a 1024. `pines.viewports` lleva pares `[ancho, alto]` por eso.
- **«La seccion de abajo» no es la hermana del DOM.** Con flex y `order`, la hermana puede estar
  2000 px mas arriba; el gate dio un falso «le pasa por encima» de 2023 px. Se elige por posicion en
  pantalla.
- **Por encima del frame el panel se congela a su tope**, centrado: el ancho esperado del pin es
  `min(ventana, anchoMax)`, no la ventana. Sin eso, C1 falla en todo monitor ancho.
- **Una muestra de color para comprobar continuidad no se toma en el eje central**: ahi van el
  titular y la bajada, y el antialiasing del glifo cuenta como «otro color». Dos columnas laterales.
- **Un salto intermitente al entrar (`anticipatePin`) que tambien sale a 1440 no es de la banda**:
  se adjudica, no se persigue como regresion de responsividad.

## De los prestados

- **`audita-regimen.mjs` sobrescribe `spec/regimen.json` entero** en cada corrida, así que las dos
  corridas que su propio SKILL.md prescribe (1440 y 390) pierden la primera. Y trata
  `fluido → sin-medir` como discrepancia, saliendo con exit 1 sin que haya nada mal: una sección
  móvil sencillamente no se pinta a 1440. `regimen-multiancho.mjs` lo envuelve, conserva cada
  resultado y separa CHOQUE de SIN MEDIR.
