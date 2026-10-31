#!/usr/bin/env node
/**
 * Gate de desborde horizontal, medido DURANTE el recorrido.
 *
 * Por que no vale el chequeo estatico: en Home a 1440 la pagina en reposo da 0 de desborde y
 * recorriendola da 54 px, con los `vt-hw-*` saliendose 499 px del marco. El movimiento saca
 * elementos fuera del marco que en reposo estaban dentro, asi que medir parado da un verde falso.
 * Todos los chequeos de desborde que dimos por buenos antes de 2026-08-24 estaban midiendo mal.
 *
 * Mide en cada ancho recorriendo la pagina en pasos, y devuelve el PEOR valor y quien lo causa.
 *
 *   node scripts/gate-desborde.mjs                       → las 5 paginas, los 7 anchos
 *   node scripts/gate-desborde.mjs home 1440             → una pagina, un ancho, con culpables
 *   node scripts/gate-desborde.mjs --json                → salida para otro script
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { CFG, BASE, PAGINAS, ANCHOS_DESBORDE as ANCHOS_A_MANO, rutaDe } from './config.mjs';

const PASO = 400;          // px de scroll entre mediciones
const TOLERANCIA = 2;      // px: por debajo de esto es redondeo, no desborde

/*
 * De donde salen los anchos, en este orden:
 *   1. responsive-out/plan-anchos.json — el plan DERIVADO del sitio (barrido + cortes + contrato),
 *      si existe y su huella cuadra con el conmutadores.json actual.
 *   2. gates.desborde del config — la lista a mano, y se dice POR_DEFECTO en voz alta.
 * Un plan con la huella caducada NO se usa a medias: se aborta con exit 2 diciendo que cambio. Un
 * plan viejo midiendo anchos viejos sin avisar es el default silencioso que este harness prohibe.
 */
const OUT = CFG.salida ?? 'responsive-out';
const hash = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);
let ANCHOS, ORIGEN;
const planPath = `${OUT}/plan-anchos.json`;
if (existsSync(planPath)) {
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const conmPath = `${OUT}/conmutadores.json`;
  const conmAhora = existsSync(conmPath) ? hash(JSON.parse(readFileSync(conmPath, 'utf8')).cortes) : null;
  if (plan.huella?.conmutadores && conmAhora && plan.huella.conmutadores !== conmAhora) {
    console.error(`\n${planPath} esta CADUCO: se derivo con conmutadores ${plan.huella.conmutadores} y ahora son ${conmAhora}.\n` +
      `Los cortes del CSS cambiaron. Vuelve a correr barrido-continuidad.mjs y plan-anchos.mjs; no se mide con un plan de otro sitio.\n`);
    process.exit(2);
  }
  ANCHOS = plan.lista;
  ORIGEN = `plan derivado (${plan.huella?.fecha}, huella ${plan.huella?.barrido})`;
} else {
  ANCHOS = ANCHOS_A_MANO;
  ORIGEN = 'POR_DEFECTO: gates.desborde del config, escrito a mano. No hay plan derivado (responsive-out/plan-anchos.json).';
}

const etiqueta = (p) => p || 'home';

async function mide(pagina, ancho, nav) {
  const p = await nav.newPage({ viewport: { width: ancho, height: 900 } });
  await p.goto(rutaDe(pagina), { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  const r = await p.evaluate(async ({ ancho, PASO, TOL }) => {
    const doc = document.documentElement;
    const culpables = new Map();
    let peor = 0, peorY = 0;
    const alto = () => document.body.scrollHeight;
    for (let y = 0; y < alto(); y += PASO) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 200));
      const d = doc.scrollWidth - ancho;
      if (d > peor) { peor = d; peorY = y; }
      if (d > TOL) {
        for (const e of document.querySelectorAll('body *')) {
          const b = e.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          const fuera = Math.round(Math.max(b.right - ancho, -b.left));
          if (fuera <= TOL) continue;
          const k = (e.className || '').toString().split(' ')[0] || e.tagName;
          culpables.set(k, Math.max(culpables.get(k) ?? 0, fuera));
        }
      }
    }
    return {
      peor: Math.max(0, peor), peorY,
      culpables: [...culpables].sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  }, { ancho, PASO, TOL: TOLERANCIA });
  await p.close();
  return r;
}

const args = process.argv.slice(2).filter((a) => a !== '--json');
const comoJson = process.argv.includes('--json');
const pagsPedidas = args.length
  ? PAGINAS.filter((p) => args.includes(etiqueta(p)))
  : PAGINAS;
const anchosPedidos = args.some((a) => /^\d+$/.test(a))
  ? ANCHOS.filter((w) => args.includes(String(w)))
  : ANCHOS;

if (!comoJson) console.log(`\n  anchos: ${ORIGEN}\n  ${ANCHOS.length} anchos · ${pagsPedidas.length} pagina(s)\n`);

const nav = await chromium.launch();
const informe = [];
for (const pagina of pagsPedidas) {
  const fila = { pagina: etiqueta(pagina) };
  for (const ancho of anchosPedidos) {
    const r = await mide(pagina, ancho, nav);
    fila[ancho] = r.peor;
    if (r.peor > TOLERANCIA) {
      informe.push({ pagina: etiqueta(pagina), ancho, ...r });
    }
  }
  if (!comoJson) console.log(`  ${fila.pagina.padEnd(20)} ` +
    anchosPedidos.map((w) => `${w}:${String(fila[w]).padStart(4)}`).join('  '));
}
await nav.close();

if (comoJson) {
  console.log(JSON.stringify(informe, null, 1));
} else {
  console.log();
  if (!informe.length) {
    console.log('  GATE VERDE — cero desborde en todo el recorrido, en todos los anchos.\n');
  } else {
    console.log(`  GATE ROJO — ${informe.length} combinacion(es) desbordan:\n`);
    for (const i of informe) {
      console.log(`   ${i.pagina} @${i.ancho}  ${i.peor}px  (peor a y=${i.peorY})`);
      for (const [c, px] of i.culpables) console.log(`      ${c.padEnd(26)} +${px}px`);
    }
    console.log();
  }
}
process.exit(informe.length ? 1 : 0);
