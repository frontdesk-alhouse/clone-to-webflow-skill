#!/usr/bin/env node
/**
 * Desplazamiento de tinta ZONA A ZONA entre la referencia de Figma y la captura del build.
 * La sonda del evaluador dice que una zona esta mal; esto dice hacia donde y cuanto,
 * que es lo unico accionable.
 *
 *   node scripts/tinta-por-zona.mjs tsf-herobox.768
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const key = process.argv[2];
const ref = PNG.sync.read(readFileSync(`reference/${key}.png`));
const act = PNG.sync.read(readFileSync(`actual/${key}.png`));
const { rects } = JSON.parse(readFileSync(`spec/sections/${key}.textrects.json`, 'utf8'));

// caja de tinta = pixeles que se apartan del color dominante de la zona (el fondo)
const cajaTinta = (im, r) => {
  const cuenta = new Map();
  const px = (x, y) => { const i = (y * im.width + x) * 4; return [im.data[i], im.data[i+1], im.data[i+2]]; };
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (x < 0 || y < 0 || x >= im.width || y >= im.height) continue;
    const k = px(x, y).map(v => v >> 4).join(',');
    cuenta.set(k, (cuenta.get(k) || 0) + 1);
  }
  const fondo = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (x < 0 || y < 0 || x >= im.width || y >= im.height) continue;
    if (px(x, y).map(v => v >> 4).join(',') === fondo) continue;
    n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return n ? { x0, x1, y0, y1, n } : null;
};

const filas = [];
for (const r of rects) {
  const a = cajaTinta(ref, r), b = cajaTinta(act, r);
  if (!a || !b) { filas.push({ zona: r.name, nota: !a && !b ? 'sin tinta en ninguno' : !a ? 'solo build' : 'solo figma' }); continue; }
  const dx = b.x0 - a.x0, dy = b.y0 - a.y0, dw = (b.x1 - b.x0) - (a.x1 - a.x0);
  if (!dx && !dy && !dw) continue;
  filas.push({ zona: r.name, dx, dy, dAncho: dw, figma: `${a.x0}-${a.x1}`, build: `${b.x0}-${b.x1}` });
}
if (!filas.length) console.log('  toda la tinta cae donde la de Figma');
else console.table(filas);
