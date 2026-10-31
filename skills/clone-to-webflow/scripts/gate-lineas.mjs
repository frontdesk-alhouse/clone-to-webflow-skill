#!/usr/bin/env node
/**
 * Gate · las lineas llegan al borde: toda raya horizontal del cuerpo va de extremo a extremo.
 *
 *   node scripts/gate-lineas.mjs [pagina...] [--anchos 390,768,1920]
 *
 * POR QUE EXISTE. En Cliente B (Revisor, 2026-10-15) las rayas del cuerpo en movil quedaban a
 * 20 px del borde (el padding de la seccion) y el navbar flotaba a 12 px: «todas las lineas tienen
 * que llegar al margen, eso tiene que estar como regla». La paridad no lo cobra si el frame tiene
 * la misma sangria, y a ojo pasa en cualquier captura chica.
 *
 * QUE MIDE (getComputedStyle, en el navegador):
 *   L1 · borde superior o inferior visible, box-shadow inset o elemento de <= 2 px de alto con
 *        fondo, de ancho >= 40 % de la ventana, que no toque los dos extremos permitidos.
 *        Extremos permitidos: por debajo de 992 px, 0 y el ancho de la ventana; desde 992, las
 *        lineas de margen (--margen) o la ventana completa.
 * QUE NO MIDE: cajas con bordes laterales y su contenido (paneles, tarjetas; el navbar SI se mide), botones y campos (borde de pieza, no raya: .vu-btn, .w-button, input, select,
 * textarea, radio > 0), carruseles que desbordan a proposito (config `lineas.ignora`).
 */
import { chromium } from 'playwright';
import { PAGINAS, etiquetaDe, rutaDe, CFG } from './config.mjs';
const args = process.argv.slice(2); let anchos = [390, 768, 1920]; const pedidas = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--anchos') { anchos = args[++i].split(',').map(Number); continue; } if (!args[i].startsWith('--')) pedidas.push(args[i]); }
const ignora = ['.vu-btn', '.w-button', 'input', 'select', 'textarea', ...((CFG.lineas && CFG.lineas.ignora) || [])];
const objetivo = pedidas.length ? pedidas : PAGINAS.map(etiquetaDe);
const nav = await chromium.launch(); const fallos = [];
console.log('\n== gate-lineas');
for (const w of anchos) {
  const pg = await (await nav.newContext({ viewport: { width: w, height: 900 } })).newPage();
  for (const et of objetivo) {
    await pg.goto(rutaDe(et === 'home' ? '' : et), { waitUntil: 'networkidle' });
    const malas = await pg.evaluate((ignora) => {
      const W = innerWidth; const pr = document.createElement('div'); pr.style.cssText = 'position:absolute;visibility:hidden;width:var(--margen)'; document.body.appendChild(pr); const m = pr.getBoundingClientRect().width; pr.remove();
      const ok = (l, r) => (Math.abs(l) <= 1 && Math.abs(r - W) <= 1) || (W >= 992 && Math.abs(l - m) <= 1 && Math.abs(r - (W - m)) <= 1);
      const out = {};
      for (const e of document.querySelectorAll('body *')) {
        if (ignora.some(s => e.matches(s) || e.closest(s))) continue;
        const cs = getComputedStyle(e);
        // una caja con bordes laterales (panel, tarjeta) no es raya, ni lo que va dentro; el navbar si se mide siempre
        const caja = (x) => { const c = getComputedStyle(x); return ['Left', 'Right'].some(s => c['border' + s + 'Style'] !== 'none' && parseFloat(c['border' + s + 'Width']) > 0); };
        if (!e.matches('.vu-nav-inner')) { let p = e, enCaja = false; while (p && p !== document.body) { if (caja(p) && !p.matches('.vu-nav-inner')) { enCaja = true; break; } p = p.parentElement; } if (enCaja) continue; } if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = e.getBoundingClientRect(); if (r.width < W * 0.4 || !r.height || r.bottom < -5000) continue;
        if (parseFloat(cs.borderTopLeftRadius) > 0) continue;
        const raya = ['Top', 'Bottom'].some(s => cs['border' + s + 'Style'] !== 'none' && parseFloat(cs['border' + s + 'Width']) > 0) || /inset/.test(cs.boxShadow) || (r.height <= 2 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)');
        if (!raya || ok(r.left, r.right)) continue;
        const k = (e.className || e.tagName).toString().split(' ')[0] + ' ' + Math.round(r.left) + '-' + Math.round(r.right); out[k] = (out[k] || 0) + 1;
      }
      return out;
    }, ignora);
    const n = Object.keys(malas).length;
    console.log(`  @${w} /${et === 'home' ? '' : et}  ${n ? 'FAIL ' + Object.entries(malas).map(([k, v]) => k + (v > 1 ? ' x' + v : '')).join(' · ') : 'OK'}`);
    if (n) fallos.push({ w, et, malas });
  }
}
await nav.close();
console.log(fallos.length ? `\n  ${fallos.length} vista(s) con lineas que no llegan al borde: FAIL\n` : '\n  LINEAS DE EXTREMO A EXTREMO en todas las paginas.\n');
process.exit(fallos.length ? 1 : 0);
