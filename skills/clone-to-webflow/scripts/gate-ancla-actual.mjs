#!/usr/bin/env node
/**
 * Gate · los enlaces del navbar que apuntan a un ancla no cambian de aspecto al llegar a ella.
 *
 *   node scripts/gate-ancla-actual.mjs [pagina...] [--anchos 1920,390]
 *
 * POR QUE EXISTE. webflow.js marca con w--current el enlace cuyo #ancla esta en pantalla (scroll
 * spy). En Cliente B (Revisor, 2026-10-15) «Contacto» apunta a /#formulario: al bajar al formulario
 * del Home se ponia en la caja negra de «pagina actual», con la letra del mismo color que el fondo.
 * Ningun gate lo veia porque todos miden con la pagina arriba.
 *
 * QUE MIDE: por cada enlace del navbar con # cuyo destino existe en la pagina, el fondo y el color
 * con la pagina arriba del todo y con el destino en pantalla. FAIL si el fondo cambia o si el
 * texto queda del mismo color que su fondo.
 */
import { chromium } from 'playwright';
import { PAGINAS, etiquetaDe, rutaDe } from './config.mjs';
const args = process.argv.slice(2); let anchos = [1920, 390]; const pedidas = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--anchos') { anchos = args[++i].split(',').map(Number); continue; } if (!args[i].startsWith('--')) pedidas.push(args[i]); }
const objetivo = pedidas.length ? pedidas : PAGINAS.map(etiquetaDe);
const nav = await chromium.launch(); let fallos = 0;
console.log('\n== gate-ancla-actual');
for (const w of anchos) for (const et of objetivo) {
  const pg = await (await nav.newContext({ viewport: { width: w, height: 900 } })).newPage();
  await pg.goto(rutaDe(et === 'home' ? '' : et), { waitUntil: 'networkidle' });
  const lee = () => pg.evaluate(() => [...document.querySelectorAll('nav a[href*="#"], .w-nav a[href*="#"]')].map((a) => {
    const id = decodeURIComponent((a.getAttribute('href') || '').split('#')[1] || ''); const t = id && document.getElementById(id);
    const c = getComputedStyle(a); return { txt: a.textContent.trim(), id, existe: !!t, bg: c.backgroundColor, col: c.color, vis: a.getBoundingClientRect().width > 0 };
  }));
  const antes = await lee();
  const filas = [];
  for (const [i, a] of antes.entries()) {
    if (!a.existe || !a.vis) continue;
    await pg.evaluate((id) => document.getElementById(id).scrollIntoView({ block: 'center' }), a.id); await pg.waitForTimeout(900);
    const d = (await lee())[i];
    const mal = d.bg !== a.bg || d.col === d.bg;
    if (mal) fallos++;
    filas.push(`  ${mal ? 'FAIL' : 'OK  '}  @${w} /${et === 'home' ? '' : et}  «${a.txt}» → #${a.id}  fondo ${a.bg} → ${d.bg}, letra ${d.col}`);
    await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(400);
  }
  filas.forEach((f) => console.log(f));
  await pg.close();
}
await nav.close();
console.log(fallos ? `\n  ${fallos} enlace(s) de ancla cambian al llegar: FAIL\n` : '\n  ANCLAS SIN ESTADO ACTUAL en todas las paginas.\n');
process.exit(fallos ? 1 : 0);
