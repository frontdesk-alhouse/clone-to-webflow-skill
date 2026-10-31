# Rúbrica funcional — «¿de verdad es responsive y funciona?»

La `rubrica-responsiva.md` responde «¿se ve bien entre anchos?». Esta responde lo anterior:
**¿está roto en alguna ventana?** Es la pregunta que hasta ahora contestaba una persona con su iPad.

## Por qué hacía falta una persona

Se revisó cada defecto que encontró el usuario en Cliente A y ninguno fue un problema de criterio.
Fueron tres huecos del instrumento, y los tres se pueden cerrar:

| Hueco | Qué pasaba | Cómo se cierra |
|---|---|---|
| **Ventanas** | Se medía a 390 / 768 / 1440, que es justo donde el diseño está garantizado. El defecto vivía en 1310×945. | Un **catálogo de 25 ventanas reales** (móviles, tablets en los dos sentidos, portátiles de alto corto, monitores), ancho **y alto**, más el plan derivado del sitio. Las ventanas del usuario se suman, pero la cobertura no depende de ellas: donde él trabaja no es donde miran sus clientes. `lib/viewports.mjs` |
| **Defectos sin declarar** | Cada gate medía lo que alguien pensó en declarar. Un texto cortado o una sección pasando por encima de otra no estaban en ninguna lista. | `gate-integridad.mjs`: busca a ciegas, sin selectores del cliente, las formas que comparten todos esos defectos |
| **Memoria** | El mismo tipo de fallo volvía en otra página porque el hallazgo se arreglaba y no quedaba en ningún gate. | `spec/escapes.json`: todo lo que ve una persona se convierte en un check que falla, con su caso roto |

Lo que queda del lado humano es poco y se dice abajo, en «Lo que el loop no puede ver».

## Los criterios

Nota sobre 10. Cada hallazgo resta según su nivel y un criterio nunca resta más de lo que pesa.

| | Criterio | Peso | Instrumento | Qué comprueba |
|---|---|---:|---|---|
| **R0** | Cobertura | compuerta | `lib/viewports.mjs` | Se midió en el catálogo de ventanas reales y donde el sitio cambia. Con el catálogo apagado o sin plan derivado la nota **topa en 8.9**: no se puede aprobar lo que no se midió |
| **R1** | Integridad | 3.5 | `gate-integridad.mjs` | I1 texto recortado · I2 texto sobre texto · I3 control tapado (no se puede pulsar) · I4 desborde · I5 imagen rota · I6 objetivo táctil. Recorriendo la página con scroll real en cada ventana |
| **R2** | Escenas fijadas | 2.0 | `gate-pines.mjs` | Ancho del pin, centrado, recortes, pieza dentro de su marco, entrada y salida sin salto ni solape. **C9**: descubre los pines que nadie declaró |
| **R3** | Continuidad | 1.5 | `barrido-continuidad.mjs` | Entre anchos la composición no brinca fuera de un corte declarado |
| **R4** | Corte de banda | 1.0 | `gate-banda.mjs` | Cada rol conmuta una vez y en un límite de banda; nunca dos navs ni ninguna |
| **R5** | Páginas hermanas | 1.0 | `evalua-responsivo.mjs` | La misma pieza mide lo mismo en páginas con la misma plantilla (`hermanas` en el config). Caza el «en Founders la tagline está 12 px más abajo que en RevOps» |
| **R6** | Escapes con gate | 1.0 | `spec/escapes.json` | Cada defecto que encontró una persona tiene un check que hoy lo cazaría |
| **R7** | Paridad de contenido | 1.5 | `gate-paridad.mjs` | Lo que hay en escritorio existe también en tablet y en móvil. Compara los titulares que se pintan en cada banda; lo omitido a propósito se declara en `paridad.omitidas`. Nació de una sección entera de Cliente A que no existía en móvil y que solo vio el usuario en su teléfono: faltaba también en los frames de Figma |

**PASS = nota ≥ 9.5 y cero hallazgos HIGH o CRITICAL.** Compuertas duras: integridad sin medir = 0;
un CRITICAL = tope 4.9. Un criterio **omitido** no suma ni resta y se dice en voz alta: no es verde.

Lo que es así a propósito se **adjudica** (`integridad.ignora` con su porqué, o `KNOWN_LIMITATIONS.md`).
Nunca se baja un umbral para que pase.

## El loop

```
        ┌──────────────────────────────────────────────────────────────┐
        ▼                                                              │
  EVALUAR  evalua-responsivo.mjs  → nota, veredicto, «lo siguiente»    │
        │                                                              │
        ├─ PASS ──────────► capturas para el juicio visual ─► aprobado del usuario
        ├─ MESETA (2 iteraciones sin mejorar) ─► se PARA y se informa  │
        ├─ iteración 6 ─► se PARA y se informa                         │
        ▼                                                              │
  ARREGLAR  un solo hallazgo: el que más resta                         │
        │   (ya falla en un instrumento: eso ES el «gate primero»)     │
        ▼                                                              │
  PUBLICAR a staging  →  NO-REGRESIÓN  foto-sitio comparar  ───────────┘
```

1. **El evaluador no arregla y el que arregla no se puntúa.** Misma separación que el harness de
   Figma: `evalua-responsivo.mjs` es determinista; quien construye solo lee su veredicto.
2. **Un arreglo por iteración.** Dos a la vez y no se sabe cuál movió la nota. `evaluacion.historia.jsonl`
   guarda nota y delta de cada vuelta.
3. **Si la nota baja, el arreglo se revierte** antes de intentar otra cosa.
4. **Meseta o seis iteraciones: se para.** Se entrega la tabla con lo que quedó abierto y su número.
   Seguir probando a ciegas es lo que gasta créditos sin mover nada.
5. **`--rapido`** (solo dispositivos y frames, sin barrido ni hermanas) es para iterar. La vuelta que
   cierra es siempre completa.
6. **Se mide lo servido**, en staging, después de publicar. Nunca la maqueta suelta.

## Quién hace qué, y qué cuesta

El loop está hecho para que el modelo caro solo aparezca donde hace falta.

| Paso | Quién | Coste |
|---|---|---|
| Evaluar (`evalua-responsivo.mjs`, todos los gates) | **script**: Node + Playwright | cero créditos. Al modelo le llega el `--json`: nota, criterios y «lo siguiente», unas treinta líneas, no el log |
| Hoja de contacto | script | cero |
| Juicio visual (`evaluador-visual.mjs`) | **Codex** por CLI, con las capturas adjuntas | suscripción de ChatGPT, no la sesión. Y es ciego de verdad: otro modelo, sin saber qué se arregló. `--motor=gemini` o `--motor=pliego` como alternativas |
| Escribir un check nuevo o su caso roto | Codex o un modelo barato | es código local; los skills se comparten por symlink |
| Arreglar en Webflow | la sesión de Claude | el MCP de Webflow no es portable a Codex. **Un hallazgo por vuelta**, con el `siguiente` del evaluador como único contexto |
| Decidir un CRITERIO | el usuario | una pregunta cerrada con su captura |

Reglas de ahorro: iterar siempre con `--rapido` y `--solo=<pagina>`; la vuelta completa solo para
cerrar. No releer informes enteros: `evaluacion.json` trae lo necesario. En meseta se **para**: seguir
es lo que gasta. Y un modelo más capaz solo entra cuando la meseta dice que el barato no pudo.

## El registro de escapes — cómo el loop aprende

Un **escape** es un defecto que ve una persona después de que el loop dijo PASS. Es el dato más
valioso del sistema: señala exactamente lo que el instrumento todavía no sabe ver.

```json
{ "escapes": [ {
  "fecha": "2026-09-17", "quien": "Revisor", "ventana": "1310x945 (iPad Sidecar)", "pagina": "product",
  "que": "franja de paper entre el panel del hero y el titular de pasos",
  "porQueNoSeVio": "ningun gate muestreaba color entre dos paneles",
  "gate": "scripts/gate-fondo-continuo.mjs", "caso": "falla 12/21 contra el estado anterior"
} ] }
```

Protocolo, siempre en este orden: **apuntar el escape → escribir el check → comprobar que FALLA
contra el estado actual → arreglar → comprobar que pasa**. Un escape sin `gate` resta en R6 hasta que
lo tenga. Si el check es general (sirve a cualquier cliente) se sube al skill con su caso en `tests/roto/`.

La medida de que esto funciona es una sola: **escapes por aprobado**. Tiene que tender a cero.

## El juicio visual — lo que ningún número responde

Con PASS en la mano (o antes, si se quiere una segunda opinión barata), `hoja-contacto.mjs` saca capturas de cada página en las ventanas que **no** son
frame, en las paradas de scroll donde pasa algo (inicio, mitad de cada escena fijada, final). Las lee
un evaluador a ciegas (`evaluador-visual.mjs` → Codex, con `prompts/evaluador-visual.md`). Reglas:

- Solo puede **restar**: un hallazgo visual nunca sube la nota.
- Cada hallazgo se clasifica: **medible** → se convierte en check (entra por el protocolo de
  escapes, con `quien: "evaluador visual"`) · **de criterio** → va al usuario como pregunta concreta
  con su captura, no como «revísalo».
- Lo que un script puede responder no se le pregunta: ya está en el pliego.

## Lo que el loop no puede ver

Se dice para que el aprobado del usuario mire ahí y no en lo que ya está medido:

- **Safari de iOS de verdad**: la barra de URL que se encoge, el rebote del scroll, la inercia táctil.
  Playwright emula el tamaño, no el navegador.
- **Rendimiento percibido**: si una escena va a tirones en un iPad viejo.
- **Gusto**: si algo es correcto y feo. Para eso está el council de `rubrica-responsiva.md`.

El aprobado de cada banda sigue siendo de una persona (playbook, regla 2). Lo que cambia es que llega
a una página que ya pasó por todo esto, y lo normal es que no encuentre nada.

## Primera corrida real — Cliente A, 2026-09-17

Sirve de calibración y de prueba de que el loop ve lo que antes solo veía una persona:

- Revisor fijó dos criterios ese día: la cobertura no puede depender de sus ventanas (de ahí el catálogo) y **ninguna
  maqueta sangra por la derecha** (lo que el agente había leído como composición era un defecto).
- `gate-integridad` pasó de 33 hallazgos a 5 al usar la pila de pintado del navegador: los acordeones
  cerrados y el mazo de cartas apiladas ya no cuentan como «texto pisado».
- Encontró **un defecto real que nadie había visto**: los enlaces del hero de `/product` se ven y no
  se pueden pulsar (los tapa el embed del hero). Confirmado con un clic de prueba.
- El evaluador visual (Codex) vio un panel 59 px corrido a 1310. Era una **cuarta escena fijada** con
  el fallo de KL-211 que se quedó fuera de la lista del día anterior. De ahí salió C9.
