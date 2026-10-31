#!/usr/bin/env node
/**
 * Modo UNIDAD · verificador. ¿El sitio pinta lo que el JSON de medidas dice?
 *
 *   node verifica-unidad.mjs <url|archivo.html> [medidas.json] [--anchos 320,390,...] [--shots DIR] [--json]
 *
 * Port generalizado de responsive-scale-verify.js (Cliente A). Aquel construia la tabla de
 * esperados a mano, elemento por elemento; aqui sale del mismo JSON que genero el CSS y de la
 * misma formula que uso el generador (lib/unidad.mjs), asi que el verificador no puede estar
 * comprobando su propia copia de la regla.
 *
 * El contrato que verifica, y es el unico que importa:
 *   · en el ancho ancla de su banda, cada elemento coincide con el frame  (±1 px, ±0.6 en fuente)
 *   · entre anclas, coincide con  medida x factor  del elemento
 *   · desborde horizontal cero en todos los anchos
 *
 * Mide POR SELECTOR, no por atributos de instrumentacion, para que sirva igual sobre un mini-clon
 * local y sobre el sitio de Webflow publicado.
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { leeJson } from './lib/json.mjs';
import { pathToFileURL } from 'node:url';
import { chromium as cargaChromium, ARGS } from './lib/pw.mjs';
import { factores, bandaDe, esperado, completaBanda } from './lib/unidad.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { if (['--anchos', '--shots'].includes(args[i])) i++; continue; }
  pos.push(args[i]);
}

const DESTINO = pos[0];
if (!DESTINO) {
  console.error('\nuso: verifica-unidad.mjs <url|archivo.html> [medidas.json] [--anchos a,b,c] [--shots DIR] [--json]\n');
  process.exit(2);
}
const RUTA = resolve(pos[1] ?? 'medidas.json');
if (!existsSync(RUTA)) { console.error(`\nNo encuentro ${RUTA}\n`); process.exit(2); }

const medidas = leeJson(RUTA);
for (const n of Object.keys(medidas.bandas)) medidas.bandas[n] = completaBanda(medidas.bandas[n]);

const ANCHOS = (opt('--anchos') ?? '').length
  ? opt('--anchos').split(',').map(Number)
  : medidas.meta?.anchosVerifica ?? [320, 390, 600, 768, 1024, 1200, 1440, 1849, 1920, 2560, 3840];
const SHOTS = opt('--shots');
const REF = medidas.meta?.ref ?? {};
const TOL = { fs: 0.6, lh: 0.6, defecto: 1.0 };

const url = /^https?:\/\//.test(DESTINO) ? DESTINO : pathToFileURL(resolve(DESTINO)).href;

/**
 * Mide en el navegador.
 *
 * x e y salen de `offsetLeft`/`offsetTop`, no de restar rects contra un contenedor elegido a
 * mano. Son exactamente el sistema de coordenadas en el que esta escrito `left`/`top` del CSS
 * —el del offsetParent— asi que un elemento anidado (un link dentro de una columna dentro del
 * footer) se compara contra el mismo origen con el que se declaro, sin que el JSON tenga que
 * describir el arbol. Restar contra la seccion, en cambio, hace que un cambio de alto arriba
 * desplace todo lo de abajo y el gate acuse diez fallos donde hay uno.
 *
 * w y h salen del rect, que es fraccionario: offsetWidth redondea y a 1849px de ancho el
 * redondeo solo ya se come la tolerancia.
 */
const medir = ([sels, ref]) => {
  const out = {};
  const pag = ref.pagina ? document.querySelector(ref.pagina) : null;
  for (const [clave, sel] of Object.entries(sels)) {
    const el = document.querySelector(sel);
    if (!el) { out[clave] = null; continue; }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.display === 'none') { out[clave] = { oculto: true, w: 0, h: 0 }; continue; }
    out[clave] = {
      x: +el.offsetLeft.toFixed(1),
      y: +el.offsetTop.toFixed(1),
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
      r: parseFloat(cs.borderTopLeftRadius) || 0,
      fs: parseFloat(cs.fontSize),
      lh: parseFloat(cs.lineHeight) || null,
    };
  }
  out.__pagina = pag ? +pag.getBoundingClientRect().width.toFixed(1) : document.documentElement.clientWidth;
  out.__desborde = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  return out;
};

const chromium = await cargaChromium();
const nav = await chromium.launch({ args: ARGS });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const informe = [];
let fallos = 0;

for (const w of ANCHOS) {
  const nb = bandaDe(medidas, w);
  const banda = medidas.bandas[nb];
  const f = factores(w, banda);

  const pg = await nav.newPage({
    viewport: { width: w, height: w >= 3840 ? 2160 : Math.round(Math.max(700, w * 0.9)) },
    deviceScaleFactor: 1,
  });
  await pg.goto(url, { waitUntil: 'load' });
  await pg.evaluate(() => document.fonts?.ready);
  await pg.waitForTimeout(400);

  const sels = Object.fromEntries(Object.entries(banda.elementos).map(([k, el]) => [k, el.sel]));
  const got = await pg.evaluate(medir, [sels, REF]);

  const malos = [];
  for (const [k, el] of Object.entries(banda.elementos)) {
    const g = got[k];

    // "heredado" no es una asercion: dice que en esta banda el elemento no lo gobierna una regla
    // propia. Puede pintarse (lo pinta un selector compuesto o su padre) o no. No se comprueba.
    if (el.oculto === 'heredado') continue;

    // "oculto: true" SI es una asercion: apagado a proposito. Si se pinta, el CSS de otra banda
    // se colo — que es exactamente el fallo que llega al iPad del cliente.
    if (el.oculto === true) {
      if (g && !g.oculto && (g.w > 0 || g.h > 0)) malos.push(`${k}: declarado oculto y se pinta (${g.w}x${g.h})`);
      continue;
    }

    const exp = esperado(el, f);
    if (g == null) { malos.push(`${k}: selector "${el.sel}" no existe en el DOM`); continue; }
    if (g.oculto) { malos.push(`${k}: se espera pintado y esta en display:none`); continue; }
    // Declarado sin nada medible (solo `css`, o solo un radio heredado): existe y se pinta, basta.
    if (!Object.keys(exp).length) continue;
    for (const [p, v] of Object.entries(exp)) {
      const real = g[p];
      if (real == null) { malos.push(`${k}.${p}: no medible`); continue; }
      const tol = TOL[p] ?? TOL.defecto;
      if (Math.abs(real - v) > tol) malos.push(`${k}.${p} ${real} vs ${v.toFixed(1)}`);
    }
  }
  if (got.__desborde > 0) malos.push(`DESBORDE ${got.__desborde}px`);

  fallos += malos.length;
  informe.push({
    ancho: w, banda: nb,
    u: +f.u.toFixed(3), t: +f.t.toFixed(3), tb: +f.tb.toFixed(3),
    pagina: Math.round(got.__pagina), desborde: got.__desborde,
    muestra: Object.fromEntries((medidas.meta?.muestra ?? []).map((k) => [k, got[k]?.fs ?? null])),
    malos,
  });

  if (SHOTS) await pg.screenshot({
    path: `${SHOTS}/ref-${w}.png`,
    fullPage: Object.values(medidas.bandas).some((b) => b.frame === w),
  });
  await pg.close();
}
await nav.close();

if (flag('--json')) { console.log(JSON.stringify(informe, null, 1)); process.exit(fallos ? 1 : 0); }

const muestras = medidas.meta?.muestra ?? [];
console.log(`\nVerificacion modo UNIDAD · ${url}`);
console.log(`medidas: ${RUTA}\n`);
console.log(
  'ancho'.padEnd(7) + 'banda'.padEnd(13) + 'u'.padEnd(7) + 't'.padEnd(7) + 'tb'.padEnd(7) +
  'pagina'.padEnd(8) + muestras.map((m) => m.padEnd(8)).join('') + 'desb'.padEnd(6) + 'estado'
);
for (const r of informe) {
  console.log(
    String(r.ancho).padEnd(7) + r.banda.padEnd(13) +
    r.u.toFixed(3).padEnd(7) + r.t.toFixed(3).padEnd(7) + r.tb.toFixed(3).padEnd(7) +
    String(r.pagina).padEnd(8) +
    muestras.map((m) => String(r.muestra[m] ?? '—').padEnd(8)).join('') +
    String(r.desborde).padEnd(6) +
    (r.malos.length ? `FALLA (${r.malos.length})` : 'ok')
  );
}
const conFallo = informe.filter((r) => r.malos.length);
if (conFallo.length) {
  console.log('');
  for (const r of conFallo) console.log(`  ${r.ancho}px:\n` + r.malos.map((m) => `    · ${m}`).join('\n'));
}
console.log(
  conFallo.length
    ? `\n${fallos} diferencias en ${conFallo.length} de ${ANCHOS.length} anchos.\n`
    : `\nCERO DIFERENCIAS en ${ANCHOS.length} anchos.\n`
);
process.exit(fallos ? 1 : 0);
