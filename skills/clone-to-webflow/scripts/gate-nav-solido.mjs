#!/usr/bin/env node
/**
 * Gate · el navbar cambia de estado al salir del hero.
 *
 *   node scripts/gate-nav-solido.mjs [pagina...] [--anchos 1920,390]
 *
 * POR QUE EXISTE. En Cliente B (Revisor, 2026-10-15) las seis paginas de proyecto salieron con el
 * navbar claro sobre fondo crema al hacer scroll: el script que pone .is-solid vive en el footer
 * de cada pagina y create_page con duplicateOf NO lo copia. Los demas gates miden con la pagina
 * arriba y no lo ven.
 *
 * QUE MIDE: en paginas con .vu-hero, el color de los enlaces del navbar con la pagina arriba y tras
 * bajar dos pantallas. FAIL si .vu-nav no gana .is-solid, o si el enlace queda claro (luminancia
 * > 0.6) sobre el fondo crema una vez fuera del hero.
 */
import { chromium } from 'playwright';
import { PAGINAS, etiquetaDe, rutaDe } from './config.mjs';
const args = process.argv.slice(2); let anchos = [1920, 390]; const pedidas = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--anchos') { anchos = args[++i].split(',').map(Number); continue; } if (!args[i].startsWith('--')) pedidas.push(args[i]); }
const objetivo = pedidas.length ? pedidas : PAGINAS.map(etiquetaDe);
const nav = await chromium.launch(); let fallos = 0;
console.log('\n== gate-nav-solido');
for (const w of anchos) for (const et of objetivo) {
  const pg = await (await nav.newContext({ viewport: { width: w, height: 900 } })).newPage();
  await pg.goto(rutaDe(et === 'home' ? '' : et), { waitUntil: 'networkidle' });
  const hay = await pg.evaluate(() => !!document.querySelector('.vu-hero'));
  if (!hay) { console.log(`  --    @${w} /${et === 'home' ? '' : et}  sin hero`); await pg.close(); continue; }
  await pg.evaluate(() => scrollTo(0, window.innerHeight * 2.2)); await pg.waitForTimeout(600);
  const r = await pg.evaluate(() => {
    const n = document.querySelector('.vu-nav'); if (!n) return null;
    const ls = [...n.querySelectorAll('.vu-nav-link')].filter((x) => !x.classList.contains('w--current') && !x.classList.contains('is-proyectos'));
    const visible = ls.find((x) => x.getBoundingClientRect().width > 0 && getComputedStyle(x).backgroundColor === 'rgba(0, 0, 0, 0)');
    const out = { solido: n.classList.contains('is-solid'), lum: null };
    if (visible) { const m = getComputedStyle(visible).color.match(/\d+/g).map(Number); out.lum = +((0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255).toFixed(2); }
    return out;
  });
  const mal = !r || !r.solido || (r.lum !== null && r.lum > 0.6);
  if (mal) fallos++;
  console.log(`  ${mal ? 'FAIL' : 'OK  '}  @${w} /${et === 'home' ? '' : et}  is-solid=${r && r.solido} luminancia=${r && r.lum}`);
  await pg.close();
}
await nav.close();
console.log(fallos ? `\n  ${fallos} vista(s) con navbar ilegible al hacer scroll: FAIL\n` : '\n  NAVBAR LEGIBLE FUERA DEL HERO en todas las paginas.\n');
process.exit(fallos ? 1 : 0);
