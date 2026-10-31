#!/usr/bin/env node
/**
 * Barrido de anchos contra la URL publicada.
 *
 * El gate de paridad mide a UN ancho, y a 1440 exacto `100%` y `1440px` son el mismo numero: por
 * construccion es ciego al centrado por encima del tope. Ese defecto no lo vio el medidor, lo vio
 * una persona en el sitio publicado. De ahi este barrido.
 *
 * Comprueba tres cosas por ancho:
 *   CENTRADO   la seccion de referencia queda centrada en el viewport.
 *   DESBORDE   `scrollWidth` no supera el ancho de la ventana.
 *   TOPE       por encima de `fluido.anchoTope` el cuerpo NO sigue creciendo. Es la mitad de la
 *              regla de 1440: el contenido se centra y la tipografia deja de escalar.
 *
 *   node scripts/mide-escalado.mjs [url]
 */
import { chromium } from 'playwright';
import { BASE, CFG, SELECTORES } from './config.mjs';

const URL = process.argv[2] || `${BASE}/`;
const ANCHOS = CFG.gates?.escalado ?? [360, 390, 430, 768, 834, 1024, 1194, 1200, 1280, 1366, 1440, 1728, 2048, 2560, 3440];
const TOPE = CFG.fluido?.anchoTope ?? 1440;

const sel = {
  escritorio: SELECTORES.seccionEscritorio,
  movil:      SELECTORES.seccionMovil,
  cuerpoE:    SELECTORES.cuerpoEscritorio,
  cuerpoM:    SELECTORES.cuerpoMovil,
};
if (!sel.escritorio && !sel.movil) {
  console.error('\nFalta `selectores.seccionEscritorio` (y/o `seccionMovil`) en harness.config.json.\n' +
                'Sin una seccion de referencia no hay nada contra lo que medir el centrado.\n');
  process.exit(2);
}

const b = await chromium.launch();
const filas = [];
console.log(`\n  ${URL}\n`);
console.log('   ancho  modo         contenido  centrado      cuerpo   desborde');
for (const w of ANCHOS) {
  const p = await b.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  const r = await p.evaluate(({ sel }) => {
    // `zoom` deforma toda medida tomada con getBoundingClientRect. Se lee para poder deshacerlo,
    // y porque su sola presencia es una senal: escalar por encima una maqueta de coordenadas
    // fijas es el fallo que este barrido existe para cazar.
    const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const vis = (s) => {
      if (!s) return null;
      const e = document.querySelector(s);
      if (!e || getComputedStyle(e).display === 'none' || !e.getClientRects().length) return null;
      const q = e.getBoundingClientRect();
      return { x: Math.round(q.x), w: Math.round(q.width) };
    };
    const fs = (s) => {
      if (!s) return null;
      const e = document.querySelector(s);
      if (!e || !e.getClientRects().length) return null;
      return Math.round(parseFloat(getComputedStyle(e).fontSize) * z * 10) / 10;
    };
    const esc = vis(sel.escritorio);
    return {
      z, modo: esc ? 'escritorio' : 'movil',
      sec: esc || vis(sel.movil),
      sw: document.documentElement.scrollWidth,
      cuerpo: fs(sel.cuerpoE) ?? fs(sel.cuerpoM),
    };
  }, { sel });
  await p.close();

  const cent = r.sec ? (Math.abs(r.sec.x - (w - r.sec.w) / 2) <= 2 ? 'ok' : 'DESCENTRADO') : '—';
  const desb = r.sw > w + 1 ? `DESBORDA ${r.sw}` : 'ok';
  filas.push({ w, ...r, cent, desb });
  console.log(`  ${String(w).padStart(6)}  ${r.modo.padEnd(12)} ${String(r.sec ? r.sec.w : '—').padStart(6)}px  ` +
              `${cent.padEnd(12)} ${String(r.cuerpo ?? '—').padStart(6)}px   ${desb}`);
}
await b.close();

// ---- Veredictos ----
const fallos = [];
for (const f of filas) {
  if (f.cent === 'DESCENTRADO') fallos.push(`${f.w}px: seccion descentrada (x=${f.sec.x}, w=${f.sec.w})`);
  if (f.desb !== 'ok') fallos.push(`${f.w}px: ${f.desb}`);
}

// El tope: por encima de `anchoTope` el cuerpo tiene que quedarse quieto. Un clamp() bien
// resuelto alcanza su maximo justo en el tope; si sigue subiendo, la pendiente no esta acotada.
const arriba = filas.filter((f) => f.w >= TOPE && f.cuerpo != null);
if (arriba.length >= 2) {
  const base = arriba[0].cuerpo;
  const crecen = arriba.filter((f) => f.cuerpo > base + 0.5);
  if (crecen.length) {
    fallos.push(`el cuerpo sigue creciendo por encima de ${TOPE}px: ` +
                `${base}px a ${arriba[0].w} -> ${crecen.map((f) => `${f.cuerpo}px a ${f.w}`).join(', ')}`);
  } else {
    console.log(`\n  TOPE ok — el cuerpo se queda en ${base}px de ${TOPE}px en adelante.`);
  }
} else if (arriba.length) {
  console.log(`\n  TOPE sin comprobar — hace falta mas de un ancho >= ${TOPE} con cuerpo medible.`);
}

if (fallos.length) {
  console.log(`\n  FALLA (${fallos.length}):`);
  fallos.forEach((f) => console.log(`    · ${f}`));
  process.exit(1);
}
console.log('\n  PASA — centrado, sin desborde y con el tope respetado en todo el barrido.\n');
