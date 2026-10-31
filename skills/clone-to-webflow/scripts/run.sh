#!/usr/bin/env bash
# Bucle desatendido de las fases 3-4, con Claude Code en modo headless.
#
# POR QUE UN GUION Y NO UNA SESION. Una seccion puede necesitar seis vueltas de construir-medir-
# reparar. Hacerlas en una conversacion gasta contexto en trabajo mecanico y obliga a estar delante.
# Aqui cada vuelta es un proceso nuevo que arranca leyendo el feedback del disco: el estado vive en
# los archivos, no en el contexto, que es lo que permite que el bucle sobreviva a un corte.
#
# El veredicto SIEMPRE se lee del archivo, nunca de lo que el modelo diga en su respuesta.
#
#   scripts/run.sh <etiqueta> <selector> [ancho] [max-iter]
#
# Se ejecuta desde la carpeta del cliente (la que tiene harness.config.json).
set -euo pipefail

ETIQUETA="${1:?uso: run.sh <etiqueta> <selector> [ancho] [max-iter]}"
SELECTOR="${2:?falta el selector}"
ANCHO="${3:-1440}"
MAX="${4:-6}"

SKILL="$HOME/.claude/skills/clone-to-webflow"
[ -f harness.config.json ] || { echo "No hay harness.config.json en $PWD"; exit 2; }

STAGING=$(node -e "console.log(JSON.parse(require('fs').readFileSync('harness.config.json','utf8')).webflow.staging)")
FEEDBACK="feedback/${ETIQUETA}.${ANCHO}"

echo "== instrumento =="
( cd "$SKILL" && npm run --silent selftest ) | tail -1 | grep -q "22/22 VALIDADO" \
  || { echo "El instrumento NO esta validado. No se construye nada."; exit 1; }

anterior=""
for (( i=1; i<=MAX; i++ )); do
  echo
  echo "== iteracion $i/$MAX — $ETIQUETA @${ANCHO} =="

  # Medir primero: la iteracion 1 puede ya estar en PASS y entonces no hay nada que reparar.
  set +e
  node "$SKILL/scripts/parity.mjs" "$ETIQUETA" "$STAGING" "$SELECTOR" "$ANCHO" > "logs/parity-${ETIQUETA}-${ANCHO}-${i}.txt" 2>&1
  set -e
  ultimo=$(ls -1 "$FEEDBACK"/feedback-*.md 2>/dev/null | sort -V | tail -1 || true)
  if [ -z "$ultimo" ]; then echo "El scorer no dejo feedback en $FEEDBACK. Abortando."; exit 1; fi

  total=$(grep -oE '\*\*[0-9]+(\.[0-9]+)?/10\*\*' "$ultimo" | head -1 | grep -oE '[0-9]+(\.[0-9]+)?' || echo "")
  veredicto=$(grep -oE '^## Veredicto: [A-Z]+' "$ultimo" | head -1 | awk '{print $3}' || echo "")
  echo "   TOTAL ${total:-?}/10   ${veredicto:-?}   ($ultimo)"

  if [ "$veredicto" = "PASS" ] || [ "$veredicto" = "DESVIACION" ]; then
    echo "   $veredicto en la iteracion $i."; exit 0
  fi

  # Meseta: si el numero no mejora, el problema puede ser el instrumento y no el build. Se para y
  # se avisa en vez de gastar las vueltas que quedan persiguiendo un fantasma.
  if [ -n "$anterior" ] && [ -n "$total" ] && [ "$(echo "$total <= $anterior" | bc -l)" = "1" ]; then
    echo "   MESETA: $anterior -> $total. Un FAIL que no cede puede ser el instrumento."
    echo "   Comprueba la mascara de texto, la referencia y los pisos declarados antes de seguir."
    exit 3
  fi
  anterior="$total"

  PROMPT="Eres el constructor del harness Clone-to-Webflow. Repara la seccion '$ETIQUETA' a ${ANCHO}px.

Lee el feedback en $ultimo y arregla SOLO lo que enumera, empezando por los criticos.
Lee tambien KNOWN_LIMITATIONS.md: lo que este adjudicado ahi NO se vuelve a tocar ni a discutir.

Reglas que no se negocian:
- Publicar solo a staging: publishToWebflowSubdomain true, customDomains vacio.
- Nunca el toggle de visibilidad para ocultar.
- Si el frame y el sitio discrepan por una decision aprobada, gana el sitio.
- No subas ningun score ni toques spec/desviaciones.json para que algo pase.

No midas ni te puntues: de eso se encarga el guion en la siguiente vuelta."

  # Quien repara. Por defecto `claude`, para no cambiarle el comportamiento a nadie.
  # VT_MOTOR=codex manda la reparacion a Codex: construye y repara, pero NO mide (bajo su sandbox
  # Chromium no arranca: bootstrap_check_in ... Permission denied 1100). Medir es siempre de este
  # guion, en las dos ramas. Si la seccion ya toca Webflow, Codex necesita ademas `codex mcp login
  # webflow`, que es interactivo: sin eso su OAuth responde invalid_grant.
  LOG="logs/reparar-${ETIQUETA}-${ANCHO}.txt"
  case "${VT_MOTOR:-claude}" in
    codex)
      # La copia del marketplace es estable; la de cache lleva la version en la ruta, asi que
      # se toma la mas nueva en vez de clavar un numero que caduca al actualizarse el plugin.
      CC="$HOME/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs"
      if [ ! -f "$CC" ]; then
        CC="$(ls -1t "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null | head -1)"
      fi
      if [ -z "$CC" ] || [ ! -f "$CC" ]; then
        echo "   VT_MOTOR=codex pero no encuentro codex-companion.mjs" >&2; exit 4
      fi
      echo "   reparando con codex ..."
      node "$CC" task --write "$PROMPT" >> "$LOG" 2>&1 || true
      ;;
    claude)
      echo "   reparando con claude -p ..."
      claude -p "$PROMPT" \
        --allowedTools "Read,Write,Edit,Bash,mcp__claude_ai_Webflow__*" \
        >> "$LOG" 2>&1 || true
      ;;
    *)
      echo "   VT_MOTOR desconocido: '${VT_MOTOR}'. Valores validos: claude, codex." >&2; exit 4
      ;;
  esac
done

echo
echo "Agotadas las $MAX iteraciones sin PASS. Ultimo total: ${anterior:-?}/10"
exit 1
