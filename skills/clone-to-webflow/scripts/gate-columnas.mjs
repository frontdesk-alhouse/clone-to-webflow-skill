#!/usr/bin/env node
/**
 * Gate · columnas: todo borde vertical, imagen y bloque de texto cae en una columna de la reticula.
 *
 *   node scripts/gate-columnas.mjs [pagina...] [--anchos 390,768,1440,1920] [--tol 1] [--detalle]
 *
 * POR QUE EXISTE. Cliente B (Revisor, 2026-10-15): «me gusta la reticula de 12 columnas de Figma porque da
 * estructura y visibilidad; que el sitio se componga bajo esas columnas». Ningun gate cobraba que los bordes
 * verticales (celdas, navbar, botones, paneles), las fotos y los bloques cayeran en columna: el nav tenia
 * enlaces en u=7.06/8.16/9.30/10.90 y botones en u=9.98 / 11.81.
 *
 * LA RETICULA (config `columnas`, con estos valores por defecto)
 *   >= 992  : 12 columnas iguales, sin canal, entre las lineas de margen (--margen).
 *   768-991 :  8 columnas entre --borde (32).   < 768 : 4 columnas entre --borde (20).
 * Un borde es «de columna» si (x - margen) / ancho_col es entero (+-tol px). Los extremos 0 y W (a sangre) valen.
 * QUE MIDE: bordes izquierdo/derecho de 1 px o mas, imagenes/video/fondos con url y, con --texto, h1-h3/p.
 * QUE NO MIDE: elementos dentro de un marquee o carrusel (config `columnas.ignora`).
 */
import { chromium } from 'playwright';
import { PAGINAS, etiquetaDe, rutaDe, CFG } from './config.mjs';
const args = process.argv.slice(2); let anchos = [390, 768, 1440, 1920]; let tol = 1; let detalle = false; let texto = false; const pedidas = [];
for (let i = 0; i < args.length; i++) { const a = args[i];
  if (a === '--anchos') { anchos = args[++i].split(',').map(Number); continue; }
  if (a === '--tol') { tol = Number(args[++i]); continue; }
  if (a === '--detalle') { detalle = true; continue; }
  if (a === '--texto') { texto = true; continue; }
  if (!a.startsWith('--')) pedidas.push(a); }
const ignora = ((CFG.columnas && CFG.columnas.ignora) || ['.vu-marquee', '.vu-marquee *', '.w-webflow-badge', '.w-webflow-badge *', '.vu-check', '.vu-check *', '.vu-pop', '.vu-pop *']);
const objetivo = pedidas.length ? pedidas : PAGINAS.map(etiquetaDe);
// barra de desplazamiento CLASICA: con overlay (headless por defecto) 100vw = ancho de ventana y un calc con vw pasa; en un Mac con raton o en Windows no (2026-10-15, Cliente B: 2-3 px de desfase)
const nav = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar,OverlayScrollbarFlashAfterAnyScrollUpdate'] }); const fallos = [];
console.log('\n== gate-columnas');
for (const w of anchos) {
  const ctx = await nav.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' }); const pg = await ctx.newPage();
  for (const et of objetivo) {
    await pg.goto(rutaDe(et === 'home' ? '' : et), { waitUntil: 'networkidle' });
    const res = await pg.evaluate(({ ignora, tol, texto }) => {
      const W = document.documentElement.clientWidth; const BP = window.innerWidth; const n = BP >= 992 ? 12 : BP >= 768 ? 8 : 4;
      const m = BP >= 992 ? Math.max(96, (W - 1728) / 2) : (BP >= 768 ? 32 : 20);
      const c = (W - 2 * m) / n; const malas = [];
      const sel = ignora.join(',');
      for (const e of document.querySelectorAll('body *')) {
        if (sel && e.matches(sel)) continue;
        if (e.closest('.w-webflow-badge')) continue;
        const cs = getComputedStyle(e), r = e.getBoundingClientRect();
        if (cs.display === 'none' || !r.width || !r.height || r.bottom < 0 && false) continue;
        const lb = cs.borderLeftStyle !== 'none' && parseFloat(cs.borderLeftWidth) > 0;
        const rb = cs.borderRightStyle !== 'none' && parseFloat(cs.borderRightWidth) > 0;
        const media = /^(IMG|VIDEO)$/.test(e.tagName) || (cs.backgroundImage.includes('url') && r.width > 60);
        const txt = texto && /^(H1|H2|H3|P)$/.test(e.tagName);
        if (!(lb || rb || media || txt)) continue;
        if (r.width >= W - 1) continue; // a sangre
        if (r.left >= W - 1) continue; // fuera de la ventana (carrusel)
        const btn = /(^|\s)(vu-btn|w-button)/.test(String(e.className)) || (media && !(lb || rb)); let anclado = false; const pend = [];
        const lados = [];
        if (lb || media || txt) lados.push(['I', r.left]);
        if (rb || media || txt) lados.push(['D', r.right]);
        for (const [s, x] of lados) {
          if (Math.abs(x) <= tol || Math.abs(x - W) <= tol) continue;
          const u = (x - m) / c; const off = Math.abs(u - Math.round(u)) * c;
          // media/texto pueden ir con la sangria de 20 px hacia dentro de la celda (el borde de la celda manda)
          const sang = !(lb || rb) || false; const dentro = (s === 'I' ? 1 : -1) * ((u - Math.round(u)) * c);
          if (btn) { if (off <= Math.max(tol, 2) || Math.abs(dentro - 20) <= Math.max(tol, 2)) anclado = true; else pend.push({ k: (String(e.className).split(' ')[0]) + ' ' + s, u: +u.toFixed(2), off: Math.round(off), y: Math.round(r.top + scrollY) }); continue; }
          if (sang && Math.abs(dentro - 20) <= tol) continue;
          if (off > tol + 0.01) malas.push({ k: (e.className.toString().split(' ')[0] || e.tagName) + ' ' + s, u: +u.toFixed(2), off: Math.round(off), y: Math.round(r.top + scrollY) });
        }
        if (btn && !anclado && pend.length) malas.push(pend[0]);
      }
      return { n, m, c: +c.toFixed(1), malas };
    }, { ignora, tol, texto });
    const g = {}; res.malas.forEach(o => { g[o.k] = g[o.k] || { v: 0, u: new Set() }; g[o.k].v++; g[o.k].u.add(o.u); });
    const resumen = Object.entries(g).map(([k, o]) => `${k} x${o.v} u=${[...o.u].slice(0, 3).join('/')}`).join(' · ');
    console.log(`  @${w} (${res.n} col, ${res.c}px) /${et === 'home' ? '' : et}  ${res.malas.length ? 'FAIL ' + res.malas.length + (detalle ? ' · ' + resumen : '') : 'OK'}`);
    if (res.malas.length) fallos.push({ w, et, n: res.malas.length });
  }
  await ctx.close();
}
await nav.close();
console.log(fallos.length ? `\n  ${fallos.length} vista(s) con elementos fuera de columna: FAIL\n` : '\n  TODO EN COLUMNA en todas las paginas.\n');
process.exit(fallos.length ? 1 : 0);
