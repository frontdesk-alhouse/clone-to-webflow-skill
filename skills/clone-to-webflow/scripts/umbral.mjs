#!/usr/bin/env node
/**
 * Constantes de puntuacion, con carga BLANDA de la configuracion.
 *
 * Separado de `config.mjs` a proposito. `config.mjs` aborta si no encuentra `harness.config.json`,
 * y hace bien: apunta a un SITIO, y un default silencioso ahi mide el sitio equivocado con un
 * numero que parece valido.
 *
 * El umbral y el tope de iteraciones no apuntan a ningun sitio. Y el selftest —que valida el
 * instrumento contra imagenes sinteticas y no toca la red— necesita el umbral pero ningun sitio.
 * Con la carga dura, `npm run selftest` moria sin decir nada desde la carpeta del propio harness,
 * que es justo desde donde uno lo corre la primera vez.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

function busca(desde = process.cwd()) {
  let dir = resolve(desde);
  for (;;) {
    const c = join(dir, 'harness.config.json');
    if (existsSync(c)) return c;
    const p = dirname(dir);
    if (p === dir) return null;
    dir = p;
  }
}

let cfg = null;
const path = busca();
if (path) { try { cfg = JSON.parse(readFileSync(path, 'utf8')); } catch { cfg = null; } }

export const UMBRAL   = cfg?.umbral  ?? 9.9;
export const MAX_ITER = cfg?.maxIter ?? 6;
/** true cuando se estan usando los valores por defecto: util para avisar en un informe. */
export const POR_DEFECTO = !cfg;
