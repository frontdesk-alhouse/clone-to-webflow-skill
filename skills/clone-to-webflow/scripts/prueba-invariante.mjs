#!/usr/bin/env node
/**
 * Prueba de invariancia: la misma seccion, capturada a dos anchos de la misma banda, tiene que dar
 * los MISMOS pixeles dentro de su caja de contenido.
 *
 *   node scripts/prueba-invariante.mjs <selector> <anchoA> <anchoB> [pagina] [--json]
 *
 * Es lo que convierte "esta banda parece rigida" en "esta banda ES rigida". Un tramo cuyo texto no
 * cambia de ancho entre 830 y 1160 puede seguir moviendo cosas por dentro (una imagen que escala,
 * un grid que reparte columnas). Si el render de la seccion es identico en los dos extremos, dentro
 * de la banda el render no depende del ancho y UN solo ancho cubre la banda. Si no, la banda no es
 * rigida por mucho que lo parezca y hay que barrerla.
 *
 * Portado de la sonda de Cliente A (30 lineas, URL a fuego). Compara la caja de contenido (sin el
 * padding lateral, que es lo que absorbe el ancho en una banda rigida) con tolerancia de color 12
 * por canal, que es la del antialiasing entre dos capturas del mismo render.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { rutaDe } from './config.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const pos = args.filter((a) => !a.startsWith('--'));
const [sel, a, b, pagina = ''] = pos;
if (!sel || !a || !b) { console.error('\nuso: prueba-invariante.mjs <selector> <anchoA> <anchoB> [pagina] [--json]\n'); process.exit(2); }
const anchos = [Number(a), Number(b)];
const UMBRAL_PCT = 0.5;   // % de pixeles distintos por encima del cual la banda NO es invariante

const nav = await chromium.launch();
const caps = [];
for (const w of anchos) {
  const ctx = await nav.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(rutaDe(pagina), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts?.ready);
  await p.waitForTimeout(1200);
  const caja = await p.evaluate((s) => {
    let n = document.querySelector(s);
    if (!n) return null;
    if (getComputedStyle(n).display === 'none') return { oculta: true };
    const vw = document.documentElement.clientWidth;
    // Una seccion a sangre mide igual que el viewport y su "caja de contenido" tambien: compararla
    // entre dos anchos siempre da "distinto tamano" aunque el contenido sea identico. Se baja hasta
    // la primera caja mas estrecha que el viewport, que es la que de verdad contiene el contenido.
    const cajaDe = (el) => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
      return { x: Math.round(r.x + pl), y: Math.round(r.y + window.scrollY), w: Math.round(el.clientWidth - pl - pr), h: Math.round(r.height), el };
    };
    let c = cajaDe(n), bajadas = 0;
    if (c.w >= vw - 2) {
      // Entre TODOS los descendientes, no solo los hijos: en Webflow los hijos directos de una
      // seccion pueden ser envoltorios .w-embed de altura 0 con el contenido en absoluto dentro, y
      // filtrar por altura los tira. Se busca la caja mas ancha que sea mas estrecha que el viewport
      // y tenga altura de verdad: esa es la que absorbe el ancho en una banda rigida.
      // Por AREA, no por ancho: un titulo de 688x114 es mas ancho que la tarjeta de 600x500 pero prueba
      // mucho menos. La caja mas grande es la que mas contenido compara.
      const cands = [...n.querySelectorAll('*')].map(cajaDe).filter((h) => h.h > 40 && h.w > 0 && h.w < vw - 2).sort((a, b) => b.w * b.h - a.w * a.h);
      if (cands.length) { n = cands[0].el; c = cands[0]; bajadas = 1; }
    }
    const nombre = n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/)[0] : '');
    return { x: c.x, y: c.y, w: c.w, h: c.h, medido: nombre, bajadas };
  }, sel);
  if (!caja) { console.error(`\n"${sel}" no existe en ${rutaDe(pagina)}\n`); await nav.close(); process.exit(2); }
  if (caja.oculta || caja.w <= 0 || caja.h <= 0) { caps.push({ w, oculta: true }); await ctx.close(); continue; }
  const buf = await p.screenshot({ clip: { x: caja.x, y: caja.y, width: caja.w, height: Math.min(caja.h, 4000) }, fullPage: true, scale: 'css' });
  caps.push({ w, caja, png: PNG.sync.read(buf) });
  await ctx.close();
}
await nav.close();

const [A, B] = caps;
let veredicto;
if (A.oculta || B.oculta) {
  veredicto = { invariante: false, motivo: `la seccion esta oculta a ${A.oculta ? A.w : B.w}px: los dos anchos no estan en la misma banda` };
} else if (A.png.width !== B.png.width || A.png.height !== B.png.height) {
  veredicto = { invariante: false, motivo: `distinto tamano: ${A.w}px -> ${A.png.width}x${A.png.height} · ${B.w}px -> ${B.png.width}x${B.png.height}`,
    cajas: [A.caja, B.caja] };
} else {
  let dif = 0;
  const d1 = A.png.data, d2 = B.png.data;
  for (let i = 0; i < d1.length; i += 4) {
    if (Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]) > 12) dif++;
  }
  const tot = A.png.width * A.png.height;
  const pct = (dif / tot) * 100;
  veredicto = { invariante: pct <= UMBRAL_PCT, pixelesDistintos: dif, total: tot, pct: +pct.toFixed(3), caja: `${A.png.width}x${A.png.height}` };
}

const out = { selector: sel, pagina: pagina || 'home', anchos, ...veredicto };
if (flag('--json')) console.log(JSON.stringify(out));
else {
  console.log(`\n${sel}${A.caja?.medido && A.caja.medido !== sel.replace(/^[.#]/, '') ? ` (caja medida: ${A.caja.medido})` : ''}  ${anchos[0]} vs ${anchos[1]}  ${out.caja ?? ''}`);
  if (out.motivo) console.log(`  NO INVARIANTE — ${out.motivo}`);
  else console.log(`  ${out.invariante ? 'INVARIANTE' : 'NO INVARIANTE'} — ${out.pixelesDistintos} de ${out.total} pixeles distintos (${out.pct} %)`);
  console.log('');
}
process.exit(out.invariante ? 0 : 1);
