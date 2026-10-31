#!/usr/bin/env node
/**
 * Fotografia las cinco paginas publicadas enteras, a los tres anchos que importan, y compara
 * contra una toma anterior.
 *
 * Por que esto y no `parity.mjs`: la paridad mide UNA seccion contra su frame de Figma, y sirve
 * para portar. Aqui el trabajo es distinto —reconciliar clases repartidas por todo el sitio— y la
 * pregunta tambien: «¿se movio algo que no queria mover?». Para eso hace falta cubrir la pagina
 * entera, no las secciones mapeadas.
 *
 *   node scripts/foto-sitio.mjs antes      → toma y guarda en snapshots/antes/
 *   node scripts/foto-sitio.mjs despues    → toma y guarda en snapshots/despues/
 *   node scripts/foto-sitio.mjs comparar antes despues
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

import { BASE, PAGINAS, ANCHOS, rutaDe, etiquetaDe } from './config.mjs';

const DIR = 'snapshots';

const nombre = (pagina, ancho) => `${pagina || 'home'}.${ancho}`;

async function tomar(etiqueta) {
  const destino = `${DIR}/${etiqueta}`;
  mkdirSync(destino, { recursive: true });
  const nav = await chromium.launch();
  const hechas = [];
  for (const ancho of ANCHOS) {
    for (const pagina of PAGINAS) {
      const p = await nav.newPage({ viewport: { width: ancho, height: 900 } });
      // Sin movimiento: una foto de pagina entera con scrollytelling activo no es reproducible.
      await p.emulateMedia({ reducedMotion: 'reduce' });
      await p.goto(`${rutaDe(pagina)}?snap=${etiqueta}`, { waitUntil: 'load' });
      await p.waitForTimeout(2500);
      // Recorrer la pagina para disparar lo que carga o revela al entrar en pantalla.
      await p.evaluate(async () => {
        const alto = document.body.scrollHeight;
        for (let y = 0; y < alto; y += 600) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      await p.waitForTimeout(1200);
      // Esperar a que TODAS las imagenes esten decodificadas (2026-10-14): la foto del hero (eager, 2832 px con srcset)
      // a veces salia sin pintar y la comparacion daba CAMBIO falso en una banda congelada.
      await p.evaluate(() => Promise.all([...document.images].map((i) =>
        Promise.race([(i.complete ? Promise.resolve() : new Promise((r) => { i.onload = i.onerror = r; })).then(() => i.decode().catch(() => {})),
                      new Promise((r) => setTimeout(r, 8000))]))));
      const ruta = `${destino}/${nombre(pagina, ancho)}.png`;
      await p.screenshot({ path: ruta, fullPage: true });
      const { width, height } = PNG.sync.read(readFileSync(ruta));
      hechas.push({ vista: nombre(pagina, ancho), w: width, h: height });
      await p.close();
    }
  }
  await nav.close();
  writeFileSync(`${destino}/_indice.json`, JSON.stringify(hechas, null, 1));
  console.table(hechas);
  console.log(`\n  → ${destino}\n`);
}

function comparar(a, b) {
  const filas = [];
  for (const ancho of ANCHOS) {
    for (const pagina of PAGINAS) {
      const v = nombre(pagina, ancho);
      const ra = `${DIR}/${a}/${v}.png`, rb = `${DIR}/${b}/${v}.png`;
      if (!existsSync(ra) || !existsSync(rb)) { filas.push({ vista: v, estado: 'falta una toma' }); continue; }
      const ia = PNG.sync.read(readFileSync(ra)), ib = PNG.sync.read(readFileSync(rb));
      if (ia.width !== ib.width || ia.height !== ib.height) {
        filas.push({ vista: v, estado: `ALTO DISTINTO ${ia.height} → ${ib.height}` });
        continue;
      }
      const salida = new PNG({ width: ia.width, height: ia.height });
      const n = pixelmatch(ia.data, ib.data, salida.data, ia.width, ia.height, { threshold: 0.1 });
      const pct = (100 * n) / (ia.width * ia.height);
      if (n) {
        mkdirSync(`${DIR}/diff`, { recursive: true });
        writeFileSync(`${DIR}/diff/${v}.png`, PNG.sync.write(salida));
      }
      filas.push({ vista: v, pxDistintos: n, pct: +pct.toFixed(4), estado: n ? 'CAMBIO' : 'igual' });
    }
  }
  console.table(filas);
  const movidas = filas.filter((f) => f.estado !== 'igual');
  console.log(movidas.length
    ? `\n  ${movidas.length} vista(s) se movieron. Heatmaps en ${DIR}/diff/\n`
    : `\n  Ninguna vista se movio: el cambio fue puramente estructural.\n`);
}

const [modo, a, b] = process.argv.slice(2);
if (modo === 'comparar') comparar(a ?? 'antes', b ?? 'despues');
else if (modo) await tomar(modo);
else console.log('uso: foto-sitio.mjs <etiqueta> | foto-sitio.mjs comparar <a> <b>');
