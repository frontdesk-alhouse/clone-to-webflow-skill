#!/usr/bin/env bash
# Instala clone-to-webflow (+ responsive-webflow, comando y agentes) en ~/.claude
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${CLAUDE_HOME:-$HOME/.claude}"

mkdir -p "$DEST/skills" "$DEST/commands" "$DEST/agents"
for s in clone-to-webflow responsive-webflow; do
  rm -rf "$DEST/skills/$s.tmp" && cp -R "$HERE/skills/$s" "$DEST/skills/$s.tmp"
  rm -rf "$DEST/skills/$s" && mv "$DEST/skills/$s.tmp" "$DEST/skills/$s"
done
cp "$HERE/commands/"*.md "$DEST/commands/"
cp "$HERE/agents/"*.md "$DEST/agents/"

echo "Instalando dependencias (Playwright, sharp, pixelmatch)..."
( cd "$DEST/skills/clone-to-webflow" && npm ci --no-audit --no-fund && npx playwright install chromium )

echo "Verificando el instrumento..."
( cd "$DEST/skills/clone-to-webflow" && npm test )
echo
echo "Listo. En Claude Code: /clone-to-webflow"
