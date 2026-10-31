#!/usr/bin/env node
/**
 * Centrado de las piezas declaradas, ancho por ancho.
 *
 * Complementa a `mide-escalado.mjs`: aquel mide UNA seccion de referencia en un barrido largo,
 * este mide VARIAS piezas nombradas en los anchos donde el diseno cambia de banda. Sirve para
 * cazar la pieza suelta que se quedo con un ancho fijo mientras el resto ya encoge — una nav de
 * 1440 fijos dentro de una ventana de 768 se corta en silencio y ningun gate de paridad la ve.
 *
 * Las piezas salen de `selectores.centrado` del config: { nombre: selector }.
 *
 * CAPAS (portado del gate-centrado de Cliente A, 26/08): dos elementos que se dibujan uno sobre otro
 * y no deben desalinearse. Existe por un fallo de metodo: la capa de atras del hero asomaba cortada
 * y convivia con encaje 8/8, desborde 0 y centrado ok — ningun gate preguntaba si dos capas que
 * deben coincidir coinciden. `selectores.capas`: [ { "a": ".fondo", "b": ".frente", "eje": "left" } ].
 * `eje` es una clave del rect: left, top, right, bottom, width, height.
 *
 *   node scripts/mide-centrado.mjs [url]
 */
import { chromium } from 'playwright';
import { BASE, CFG, ANCHOS, ANCHOS_DESBORDE, SELECTORES } from './config.mjs';

const URL = process.argv[2] || `${BASE}/`;
const PIEZAS = SELECTORES.centrado || {};
const CAPAS = SELECTORES.capas || [];
const TOL_CAPAS = SELECTORES.toleranciaCapas ?? 1;
if (!Object.keys(PIEZAS).length && !CAPAS.length) {
  console.error('\nFalta `selectores.centrado` en harness.config.json: { "nav": ".mi-nav", ... }\n' +
    '(o `selectores.capas`: [ { "a": ".fondo", "b": ".frente", "eje": "left" } ])\n');
  process.exit(2);
}
// Los anchos de construccion mas los del gate de desborde, mas los bordes de banda por los dos
// lados. Un corte se rompe EN el borde, no cerca.
const bordes = (CFG.gates?.banda || []).flat();
const LISTA = [...new Set([...ANCHOS, ...ANCHOS_DESBORDE, ...bordes])].sort((a, b) => a - b);

const b = await chromium.launch();
const fallos = [];
console.log(`\n  ${URL}\n`);
for (const w of LISTA) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.goto(URL, { waitUntil: 'networkidle' });
  const r = await p.evaluate(({ PIEZAS, CAPAS }) => {
    const out = {};
    const vis = (e) => e && getComputedStyle(e).display !== 'none' && e.getClientRects().length;
    const capas = [];
    for (const { a, b, eje = 'left' } of CAPAS) {
      const ea = document.querySelector(a), eb = document.querySelector(b);
      if (!vis(ea) || !vis(eb)) { capas.push({ a, b, eje, oculto: true }); continue; }
      const ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect();
      capas.push({ a, b, eje, d: +Math.abs(ra[eje] - rb[eje]).toFixed(1) });
    }
    for (const [nombre, s] of Object.entries(PIEZAS)) {
      const e = document.querySelector(s);
      if (!e) { out[nombre] = null; continue; }
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || !e.getClientRects().length) { out[nombre] = 'oculto'; continue; }
      const q = e.getBoundingClientRect();
      out[nombre] = { x: Math.round(q.x), w: Math.round(q.width) };
    }
    return { piezas: out, capas, sw: document.documentElement.scrollWidth };
  }, { PIEZAS, CAPAS });
  await p.close();

  const trozos = [];
  for (const [nombre, v] of Object.entries(r.piezas)) {
    if (v === null) { trozos.push(`${nombre} ausente`); continue; }
    if (v === 'oculto') { trozos.push(`${nombre} oculto`); continue; }
    // Una pieza mas ancha que la ventana no esta "descentrada": esta cortada. Se dice distinto
    // porque se arregla distinto.
    if (v.w > w + 1) { trozos.push(`${nombre} CORTADA ${v.w}>${w}`); fallos.push(`${w}px · ${nombre} mide ${v.w} en ventana de ${w}`); continue; }
    const ok = Math.abs(v.x - (w - v.w) / 2) <= 1;
    trozos.push(`${nombre} ${ok ? 'ok' : 'DESCENTRADA'} (x=${v.x} w=${v.w})`);
    if (!ok) fallos.push(`${w}px · ${nombre} descentrada: x=${v.x}, esperaba ${Math.round((w - v.w) / 2)}`);
  }
  for (const c of r.capas) {
    if (c.oculto) { trozos.push(`capa ${c.a}/${c.b} oculta`); continue; }
    const ok = c.d <= TOL_CAPAS;
    trozos.push(`capa ${c.a}/${c.b}.${c.eje} ${ok ? 'ok' : `DESALINEADA ${c.d}px`}`);
    if (!ok) fallos.push(`${w}px · capas ${c.a} vs ${c.b} desalineadas ${c.d}px en ${c.eje} (tolerancia ${TOL_CAPAS})`);
  }
  if (r.sw > w + 1) fallos.push(`${w}px · desborde: scrollWidth ${r.sw}`);
  console.log(`  ${String(w).padStart(5)}  ${trozos.join(' | ')}${r.sw > w + 1 ? `  scrollW ${r.sw}` : ''}`);
}
await b.close();

if (fallos.length) {
  console.log(`\n  FALLA (${fallos.length}):`);
  fallos.forEach((f) => console.log(`    · ${f}`));
  process.exit(1);
}
console.log('\n  PASA — todas las piezas centradas, las capas alineadas y todo dentro del marco en todos los anchos.\n');
