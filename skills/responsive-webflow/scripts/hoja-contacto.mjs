#!/usr/bin/env node
/**
 * Hoja de contacto · las capturas que lee el evaluador visual.
 *
 *   node hoja-contacto.mjs [base] [--solo=pagina] [--todas]
 *
 * El juicio visual solo sirve si mira donde nadie miro. Por defecto captura en las ventanas que NO son un frame
 * (dispositivos del usuario y fronteras del plan): a los anchos de frame ya responde la paridad de clone-to-webflow.
 * En cada pagina: arriba, en la mitad de cada escena fijada declarada en `pines`, a cada cuarto del documento y abajo.
 * Siempre con scroll real, para que lo que se dispara con el scroll este disparado.
 *
 * Escribe `<salida>/contacto/<pagina>/<ancho>x<alto>-<parada>.png` y un `indice.json` con lo que es cada captura.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium as cargaChromium, ARGS } from './lib/pw.mjs';
import { cargaConfig, url as urlDe } from './lib/config.mjs';
import { viewports } from './lib/viewports.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const cfg = cargaConfig();
const BASE = args.find((a) => /^(https?|file):\/\//.test(a))?.replace(/\/$/, '') ?? null;
const SOLO = opt('solo')?.split(',') ?? null;
const DIR = join(cfg.salida || 'responsive-out', 'contacto');
const frames = new Set(Object.values(cfg.bandas ?? {}).map((b) => b.frame));
const VP = viewports(cfg, { rapido: !args.includes('--todas') });
const ventanas = VP.lista.filter((v) => args.includes('--todas') || v.origen === 'dispositivo' || !frames.has(v.w));
const lista = ventanas.length ? ventanas : VP.lista;   // sin dispositivos declarados se capturan los frames, y se dice
const PAGINAS = (cfg.sitio.paginas ?? ['']).filter((p) => !SOLO || SOLO.includes(p) || SOLO.includes(p || 'home'));
const urlPagina = (p) => (BASE ? (BASE.startsWith('file:') ? `${BASE}/${p}` : `${BASE}/${(cfg.rutas?.[p] ?? p).replace(/^\//, '')}`.replace(/\/$/, '')) : urlDe(cfg, p));

const indice = [];
const chromium = await cargaChromium();
const browser = await chromium.launch({ args: ARGS });
try {
  for (const pagina of PAGINAS) {
    const etiqueta = pagina || 'home';
    const ruta = cfg.rutas?.[pagina] ?? pagina;
    const escenas = (cfg.pines?.escenas ?? []).filter((e) => (e.ruta ?? '') === ruta);
    mkdirSync(join(DIR, etiqueta.replace(/\W+/g, '-')), { recursive: true });
    for (const v of lista) {
      const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1, hasTouch: v.w < 768, isMobile: v.w < 768 });
      const page = await ctx.newPage();
      await page.goto(urlPagina(pagina), { waitUntil: 'load', timeout: 90000 });
      await page.waitForTimeout(1500);
      const paradas = await page.evaluate((escenas) => {
        const max = document.documentElement.scrollHeight - innerHeight;
        const p = [{ nombre: 'arriba', y: 0 }];
        for (const e of escenas) {
          const pista = (e.pista && document.querySelector(e.pista)) || document.querySelector(e.pin)?.parentElement;
          if (!pista) continue;
          const r = pista.getBoundingClientRect(); if (!r.height) continue;
          p.push({ nombre: `escena-${(e.nombre || 'pin').replace(/\W+/g, '-')}`, y: r.top + scrollY + (r.height - innerHeight) / 2 });
        }
        for (const f of [0.25, 0.5, 0.75]) p.push({ nombre: `doc-${f * 100}`, y: max * f });
        p.push({ nombre: 'abajo', y: max });
        return p.map((x) => ({ ...x, y: Math.max(0, Math.min(max, Math.round(x.y))) }));
      }, escenas);
      for (const parada of paradas) {
        await page.evaluate(async (y) => { for (let c = scrollY; Math.abs(c - y) > 1;) { c += Math.max(-400, Math.min(400, y - c)); scrollTo(0, c); await new Promise((r) => setTimeout(r, 40)); } }, parada.y);
        await page.waitForTimeout(800);
        const archivo = join(DIR, etiqueta.replace(/\W+/g, '-'), `${v.w}x${v.h}-${parada.nombre}.png`);
        await page.screenshot({ path: archivo });
        indice.push({ pagina: etiqueta, ventana: `${v.w}x${v.h}`, origen: v.origen, dispositivo: v.nombre ?? null, parada: parada.nombre, y: parada.y, archivo });
      }
      await ctx.close();
    }
    console.log(`· /${pagina}  ${indice.filter((i) => i.pagina === etiqueta).length} capturas`);
  }
} finally { await browser.close(); }
writeFileSync(join(DIR, 'indice.json'), JSON.stringify({ ventanas: VP.origen, soloFrames: !ventanas.length, capturas: indice }, null, 1));
console.log(`\n${indice.length} capturas → ${DIR}/indice.json${ventanas.length ? '' : '\nAVISO: no hay dispositivos declarados ni plan; se capturaron solo los frames, que es donde menos falta hace mirar.'}`);
