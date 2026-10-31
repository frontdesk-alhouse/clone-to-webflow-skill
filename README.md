# clone-to-webflow

Harness para Claude Code que lleva un diseño de **Figma a Webflow** con paridad medida, no a ojo.

> **EN** — A Claude Code harness that ports a Figma design to Webflow with *measured* parity. It audits the Figma file before touching Webflow, ports section by section against a deterministic pixel scorer, runs the gates parity can't see (overflow, order, motion, images, grid, states), and publishes **only to staging**. Docs and code comments are in Spanish.

## Qué hace

Portar a Webflow se rompe siempre igual: el ojo dice «se parece» y el número dice otra cosa. Este harness cierra el bucle con un **scorer determinista** (Playwright + pixelmatch), no con la opinión de un modelo.

| Fase | Qué pasa |
|---|---|
| 1 · Gate de diseño | Audita el frame de Figma **antes** de portar: calidad (77 reglas de [Impeccable](https://github.com/pbakaus/impeccable)), radios concéntricos, régimen responsivo por sección, tokens, movimiento. Council a ciegas de dos auditores. |
| 2 · Página base | Variables, escala fluida con `clamp()` y clases del sistema en Webflow. |
| 3-4 · Porte y paridad | Sección por sección: local contra el PNG de Figma hasta dar paridad, transcripción a Webflow, misma medición. |
| 5 · Gates | Desborde, orden, movimiento, imágenes, retícula, columnas, líneas, estados, nav, anclas. Cada gate tiene un caso roto que prueba que sabe fallar. |
| 6-7 · Staging | Publica solo a `*.webflow.io`. El config aborta si apunta a producción. |
| 8 · `--corregir` | Si un gate dio verde donde hay un defecto, primero se extiende el gate y se comprueba que falla; después se arregla. |

Se trabaja **por bandas** (escritorio → aprobado → móvil → aprobado → tablet → aprobado → responsividad): `playbook.mjs` no abre una banda sin el aprobado registrado de la anterior.

Incluye **responsive-webflow**, el skill hermano de la banda de responsividad: deriva los anchos a medir del propio sitio (no de una lista fija), busca cortes de banda por bisección y barre la continuidad entre anchos.

## Requisitos

- [Claude Code](https://claude.com/claude-code)
- Node 20+
- MCP de **Figma** y de **Webflow** conectados (el builder usa las herramientas del Designer)
- Un sitio Webflow con staging (`<shortName>.webflow.io`)

## Instalación

```bash
git clone https://github.com/frontdesk-alhouse/clone-to-webflow-skill.git
cd clone-to-webflow-skill
./install.sh
```

Copia a `~/.claude/`:

```
skills/clone-to-webflow/     motor, gates, referencias, plantillas, tests
skills/responsive-webflow/   banda de responsividad
commands/clone-to-webflow.md
agents/webflow-design-auditor.md
agents/webflow-port-builder.md
```

y corre `npm test` (selftest del scorer 22/22, regla concéntrica, gates que saben fallar, compuerta del playbook). No necesita red ni ningún sitio.

## Uso

En la carpeta del proyecto del cliente:

```bash
cp ~/.claude/skills/clone-to-webflow/templates/harness.config.json .
# edita: staging, shortName, archivo y frames de Figma, páginas
```

Luego en Claude Code:

```
/clone-to-webflow
/clone-to-webflow --etapa movil
/clone-to-webflow --corregir
```

Un cliente nuevo es `harness.config.json` y nada más. Las banderas están en `commands/clone-to-webflow.md`; el método completo en `skills/clone-to-webflow/SKILL.md`.

## Sobre los ejemplos

Las notas de los scripts citan casos reales que dieron origen a cada gate. Están anonimizados como *Cliente A/B/C/D*; las cifras y fechas se conservan porque son la evidencia de por qué existe cada regla.

## Licencia

MIT — ver [LICENSE](LICENSE). `skills/clone-to-webflow/vendor/impeccable/` viene del proyecto [Impeccable](https://github.com/pbakaus/impeccable) bajo Apache 2.0 (ver su `LICENSE` y `NOTICE.md`), empaquetado sin modificar.
