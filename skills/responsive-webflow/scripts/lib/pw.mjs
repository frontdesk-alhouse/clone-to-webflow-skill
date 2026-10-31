/**
 * Playwright, venga de donde venga.
 *
 * El skill no obliga a instalar una segunda copia del navegador: si clone-to-webflow ya esta
 * instalado, se usa el suyo. Si no hay ninguno, se dice con el comando exacto en vez de
 * reventar con un ERR_MODULE_NOT_FOUND que no explica nada.
 */
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CANDIDATOS = [
  `${homedir()}/.claude/skills/responsive-webflow/node_modules`,
  `${homedir()}/.claude/skills/clone-to-webflow/node_modules`,
];

export async function chromium() {
  const saca = (m) => m?.chromium ?? m?.default?.chromium;   // el paquete es CJS: cuelga de default
  try { const c = saca(await import('playwright')); if (c) return c; } catch { /* sigue */ }
  for (const base of CANDIDATOS) {
    for (const pkg of ['playwright', 'playwright-core']) {
      const dir = `${base}/${pkg}`;
      if (!existsSync(dir)) continue;
      try {
        // createRequire quiere un ARCHIVO, no un directorio: con la barra final no resuelve.
        const req = createRequire(`${base}/x.js`);
        const c = saca(await import(pathToFileURL(req.resolve(pkg)).href));
        if (c) return c;
      } catch { /* siguiente */ }
    }
  }
  console.error(
    `\nNo encuentro Playwright. Instalalo en el skill:\n\n` +
    `  cd ~/.claude/skills/responsive-webflow && npm i playwright && npx playwright install chromium\n\n` +
    `(o instala clone-to-webflow, que ya lo trae y se reusa automaticamente)\n`
  );
  process.exit(2);
}

/** Lanzado igual que en clone-to-webflow: sin barras de scroll y con el DPR clavado en 1. */
export const ARGS = ['--hide-scrollbars', '--force-device-scale-factor=1', '--font-render-hinting=none'];
