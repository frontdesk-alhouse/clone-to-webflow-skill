# El council a ciegas

La medicion de la Fase 1 es determinista, pero **decidir si un diseno esta bien hecho no lo es**. Ahi
si entra el juicio, y entra por duplicado: **Codex y un agente Claude reciben el mismo pliego, sin
ver las conclusiones del otro**, y despues se hace el diff.

**El valor no esta en que coincidan. Esta en las tres o cuatro cosas que uno ve y el otro no.**
Convergencia sube la confianza; divergencia marca donde hay que mirar.

## Como se corre

```bash
# Lado Codex — gasta cuota de ChatGPT, no la de Claude
CODEX=$(ls -d ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null | sort -V | tail -1)
[ -z "$CODEX" ] && { echo "falta el plugin openai-codex"; exit 1; }
node "$CODEX" task --write --json --cwd "$PWD" --effort high "$(cat prompts/council-codex.md)"

# Lado Claude — el agente webflow-design-auditor, con el mismo pliego
```

Los dos escriben a archivos **distintos** (`council/codex.md`, `council/claude.md`) y **ninguno lee
el del otro**. El diff lo hace quien orquesta, despues.

## Que va en el pliego

1. **Las mediciones deterministas ya hechas**, como datos: salida de `audita-calidad.mjs`,
   `radios.mjs`, `audita-radios-anidados.mjs`, `audita-regimen.mjs`, `mide-escalado.mjs`, y el tree
   walk de `boundVariables`.
2. **Las capturas** del frame en los tres anchos.
3. **`<accepted_limitations>`** — el contenido de `KNOWN_LIMITATIONS.md` y `spec/desviaciones.json`,
   marcado explicitamente como **decisiones ya adjudicadas que no se re-plantean ni se penalizan**.
   Sin esto, cada corrida redescubre lo resuelto y deja el diagnostico en meseta.
4. **El gate creativo del cliente**, si existe: lo que este vetado por criterio, con su razon.
5. **La pregunta**, que no es «puntua esto» sino: *¿que hay aqui que no deberia construirse, y por
   que?*

## Que NO va en el pliego

- **Las conclusiones del otro evaluador.** Es lo unico que rompe el ejercicio.
- **Tu opinion sobre el diseno.** Un pliego que insinua la respuesta la recibe de vuelta.
- **Deducciones sobre vinculacion de tokens.** Codex la infiere de valores resueltos, donde una
  propiedad enlazada y una hardcodeada **se ven identicas**, y ante la duda reporta «hardcoded».
  Medido: **8 de 8 nodos** que declaro hardcodeados estaban enlazados a las variables que el propio
  informe nombraba. Ese dato entra **ya adjudicado** por el tree walk, como hecho, no como pregunta.

## Como se hace el diff

Tres cubos:

| | Que significa | Que se hace |
|---|---|---|
| **Coinciden** | sube la confianza | se acepta |
| **Solo uno lo ve** | ahi esta el valor | se **adjudica midiendo**, no votando |
| **Se contradicen** | uno de los dos parte de un dato malo | se busca el dato, no el consenso |

Nada del council se convierte en una tarea de reparacion sin pasar antes por una medicion que lo
confirme. El council **senala donde mirar**; el numero decide.

## Calidad relativa observada

- **Codex** es el riguroso: separa evidencia de inferencia, declara los limites de su muestra, y
  encuentra datos primarios. Su punto ciego es la vinculacion de tokens (arriba).
- **Un agente Claude** con las herramientas MCP puede **verificar en vivo** lo que afirma, que es
  justo lo que a Codex le falta. A cambio gasta cuota.

Archivar el pliego junto a las dos respuestas, para que la corrida sea auditable.
