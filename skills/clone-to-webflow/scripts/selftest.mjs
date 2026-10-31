#!/usr/bin/env node
/**
 * Validación del instrumento — corre ANTES de construir nada.
 *
 * Si el medidor tiene ruido, cada iteración de build se gasta persiguiendo fantasmas.
 * La memoria de calibración del harness de Figma documenta exactamente eso: dos secciones
 * subieron de 7.5 a 9.1 sin tocar un solo nodo, solo arreglando los insumos de evaluación.
 *
 * Veintidos comprobaciones en dos bloques — 16 del motor de diff y 6 del evaluador:
 *   1  identidad         imagen contra sí misma        → 100.000 % en ambos canales
 *   2  desplazamiento 20px                             → el estructural LO VE
 *   3  desplazamiento 1px                              → el estructural NO lo castiga
 *   4  dimensiones distintas                           → se reporta, no se escala
 *   5  solo antialiasing  misma capa, otro rasterizado → AMBOS canales lo ignoran
 *   6  tipo 59→57px      error real, pequeño           → el detalle LO VE
 *   7  radio 12→4        error real, local             → el detalle LO VE
 *   8  borde 1px ausente error real, finísimo          → el detalle LO VE
 *
 * El bloque 5-8 es el que justifica el diseño de dos canales, y va junto a propósito:
 * de nada sirve que el canal de detalle ignore el ruido de rasterizado si además se
 * queda ciego ante un error de verdad. Tiene que discriminar, no tolerar.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { compare } from './diff.mjs';

const TMP = join(process.cwd(), 'logs', 'selftest');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const W = 1440, H = 480;

/** Una maqueta con los ingredientes que de verdad rompen estas comparaciones:
 *  texto grande, texto pequeño, un radio, una sombra y un borde de 1px.
 *
 *  EL TEXTO DE ESTA MAQUETA ESTA CONGELADO A PROPOSITO. No es copy de ningun cliente: es un
 *  patron de prueba, y los numeros de referencia del bloque 2 (borde 8.63 · radio 9.5 · offset
 *  5.0) estan calibrados contra estos pixeles exactos. Cambiar una palabra mueve el rasterizado
 *  y con el los tres numeros, y entonces la corrida deja de ser comparable con las anteriores.
 *  Si hay que tocarlo, se vuelve a levantar la linea base y se anota el porque. */
const scene = ({ cardX = 900, cardY = 96, hero = 59, radius = 12, border = 1 } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#e8edf5"/>
  <text x="60" y="140" font-family="Helvetica" font-size="${hero}" fill="#101921">Stop managing tools.</text>
  <text x="60" y="205" font-family="Helvetica" font-size="${hero}" fill="#0f62fe">Start directing revenue.</text>
  <text x="60" y="262" font-family="Helvetica" font-size="16" fill="#384256">Cliente A finds your customers, writes and sends the outreach, and books the meeting.</text>
  <text x="60" y="300" font-family="Courier" font-size="10" fill="#384256" letter-spacing="1.4">SIX TOOLS, SIX BILLS</text>
  <rect x="${cardX}" y="${cardY}" width="440" height="288" rx="${radius}"
        fill="#fdfeff" stroke="#a855f7" stroke-width="${border}"/>
  <rect x="${cardX - 3}" y="${cardY - 3}" width="446" height="294" rx="${radius + 3}"
        fill="none" stroke="#e0dcf5" stroke-width="3"/>
  <text x="${cardX + 24}" y="${cardY + 48}" font-family="Helvetica" font-size="24" fill="#101921">Meeting booked</text>
  <text x="${cardX + 24}" y="${cardY + 84}" font-family="Helvetica" font-size="15" fill="#384256">Dana Whitfield · VP of Sales</text>
</svg>`;

const render = async (svg, path, extra) => {
  let p = sharp(Buffer.from(svg)).png();
  if (extra) p = extra(p);
  await p.toFile(path);
  return path;
};

const base      = await render(scene(), join(TMP, 'base.png'));
const copyOf    = await render(scene(), join(TMP, 'copy.png'));
const off20     = await render(scene({ cardX: 920 }), join(TMP, 'off20.png'));
const off1      = await render(scene({ cardX: 901 }), join(TMP, 'off1.png'));
const aaOnly    = await render(scene(), join(TMP, 'aa.png'), (p) => p.blur(0.4));
const type57    = await render(scene({ hero: 57 }), join(TMP, 'type57.png'));
const radius4   = await render(scene({ radius: 4 }), join(TMP, 'radius4.png'));
const noBorder  = await render(scene({ border: 0 }), join(TMP, 'noborder.png'));
const narrower  = await sharp(Buffer.from(scene())).extract({ left: 0, top: 0, width: W - 40, height: H }).png()
                    .toFile(join(TMP, 'narrow.png')).then(() => join(TMP, 'narrow.png'));

// Las zonas de texto de la maqueta. Fuera de ellas viven la tarjeta, su radio y su borde:
// exactamente las clases de defecto que el gate de detalle tiene que atrapar.
const TEXT_RECTS = [
  { x: 55, y: 90,  w: 720, h: 62 },   // h1 linea 1
  { x: 55, y: 155, w: 720, h: 62 },   // h1 linea 2
  { x: 55, y: 244, w: 820, h: 26 },   // body
  { x: 55, y: 286, w: 320, h: 20 },   // eyebrow
  { x: 918, y: 160, w: 320, h: 36 },  // titulo de tarjeta
  { x: 918, y: 200, w: 380, h: 26 },  // subtitulo de tarjeta
];

const results = [];
const run = async (name, a, b) => {
  const r = await compare(a, b, TMP, name, { textRects: TEXT_RECTS });
  results.push({ name, struct: r.structural.matchPct, detail: r.detail.matchPct, dims: r.dimsMatch,
    sCells: r.grid.structCells, sWorst: r.grid.structWorstPct,
    dCells: r.grid.detailCells, dWorst: r.grid.detailWorstPct,
    ntPx: r.detailNonText?.diffPx ?? 0, ntWorst: r.detailNonText?.worstCellPct ?? 0 });
  return r;
};

await run('01-identidad', base, copyOf);
await run('02-offset20',  base, off20);
await run('03-offset1',   base, off1);
await run('04-dims',      base, narrower);
await run('05-solo-aa',   base, aaOnly);
await run('06-tipo57',    base, type57);
await run('07-radio4',    base, radius4);
await run('08-sinborde',  base, noBorder);

const row = (r) => `${r.name.padEnd(14)} struct ${String(r.struct).padStart(8)}% (peor celda ${String(r.sWorst).padStart(6)}%)  detail ${String(r.detail).padStart(8)}%  no-texto ${String(r.ntPx).padStart(6)} px / peor celda ${String(r.ntWorst).padStart(6)}%`;
console.log('\n' + results.map(row).join('\n') + '\n');

const get = (n) => results.find((r) => r.name.startsWith(n));
const checks = [
  ['identidad estructural = 100',        get('01').struct === 100],
  ['identidad detalle = 100',            get('01').detail === 100],
  ['offset 20px detectado (<99.5)',      get('02').struct < 99.5],
  ['offset 1px tolerado (>=99.5)',       get('03').struct >= 99.5],
  ['dimensiones distintas reportadas',   get('04').dims === false],
  ['dimensiones distintas penalizadas',  get('04').struct < 99.5],
  ['solo-AA: estructural intacto >=99.5', get('05').struct >= 99.5],
  ['solo-AA: detalle NO lo castiga (=100)', get('05').detail === 100],
  ['tipo 59→57: el detalle lo ve',       get('06').detail < 100],
  ['radio 12→4: el detalle lo ve',       get('07').detail < 100],
  ['borde 1px ausente: el detalle lo ve', get('08').detail < 100],
  // Lo que de verdad importa: la peor celda separa defecto real de ruido de rasterizado.
  // Medido en esta corrida — ruido 0.00 %, radio 0.35 %, borde 1.67 %, tipo 31.1 %.
  // La frontera está entre 0 y 0.35, así que el gate provisional es 0.3 %. Es provisional
  // a propósito: aquí el "ruido" es un blur sintético, y el ruido real de Figma contra
  // navegador puede ser mayor. Se recalibra contra el primer par real antes de puntuar.
  ['solo-AA: peor celda de detalle = 0',        get('05').dWorst === 0],
  // El gate real: detalle FUERA de las zonas de texto. Ahi no hay piso de rasterizado.
  ['solo-AA: no-texto = 0 px',                  get('05').ntPx === 0],
  ['identidad: no-texto = 0 px',                get('01').ntPx === 0],
  ['radio 12→4: no-texto lo atrapa',            get('07').ntPx > 0],
  ['borde ausente: no-texto lo atrapa',         get('08').ntPx > 0],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} del motor de diff — artefactos en ${TMP}`);

// ============================================================================
// Bloque 2 — el EVALUADOR. Un scorer que solo sabe aprobar no sirve de nada:
// aquí se le meten defectos conocidos y se exige que los repruebe.
// ============================================================================
import { copyFileSync, writeFileSync as wf, mkdirSync as mk, rmSync as rm } from 'node:fs';
import { scoreSection, THRESHOLD } from './score.mjs';

const KEY = '_selftest.9999';
mk('reference', { recursive: true }); mk('actual', { recursive: true }); mk('spec/sections', { recursive: true });
wf(`spec/sections/${KEY}.textrects.json`, JSON.stringify({ rects: TEXT_RECTS }));
copyFileSync(base, `reference/${KEY}.png`);

const scoreCase = async (name, actualPath) => {
  copyFileSync(actualPath, `actual/${KEY}.png`);
  rm(`feedback/${KEY}`, { recursive: true, force: true });
  const r = await scoreSection('_selftest', '9999');
  return { name, total: r.total, verdict: r.verdict };
};

const sc = [];
sc.push(await scoreCase('identica',        copyOf));
sc.push(await scoreCase('dimensiones',     narrower));
sc.push(await scoreCase('borde ausente',   noBorder));
sc.push(await scoreCase('radio 12->4',     radius4));
sc.push(await scoreCase('offset 20px',     off20));
sc.push(await scoreCase('solo antialiasing', aaOnly));

console.log('\n  EVALUADOR:');
sc.forEach((r) => console.log(`   ${r.name.padEnd(20)} TOTAL ${String(r.total).padStart(5)}/10   ${r.verdict}`));

const S = (n) => sc.find((r) => r.name.startsWith(n));
const checks2 = [
  ['seccion identica puntua 10.0',            S('identica').total === 10],
  ['dimensiones malas fuerzan TOTAL 0',       S('dimensiones').total === 0],
  ['borde de 1px ausente NO llega al umbral', S('borde').total < THRESHOLD],
  ['radio equivocado NO llega al umbral',     S('radio').total < THRESHOLD],
  ['desplazamiento de 20px NO llega',         S('offset').total < THRESHOLD],
  ['ruido de rasterizado SI pasa',            S('solo antialiasing').total >= THRESHOLD],
];

let failed2 = 0;
console.log();
for (const [l, ok] of checks2) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (!ok) failed2++; }
rm(`reference/${KEY}.png`, { force: true }); rm(`actual/${KEY}.png`, { force: true });
rm(`spec/sections/${KEY}.textrects.json`, { force: true }); rm(`feedback/${KEY}`, { recursive: true, force: true });
// Los heatmaps del caso sintetico tambien se barren: si no, cada corrida deja tres PNG en `diff/`
// del proyecto del cliente y acaban confundiendose con los de una seccion real.
for (const ext of ['struct.png', 'detail.png', 'report.json']) rm(`diff/${KEY}.${ext}`, { force: true });
console.log(`\n${checks2.length - failed2}/${checks2.length} del evaluador`);

// Una sola linea de veredicto para que el orquestador no tenga que sumar dos bloques ni
// interpretar la salida. La Fase 0 se para con lo que diga esta linea, y con nada mas.
const tot = checks.length + checks2.length;
const okTot = tot - failed - failed2;
console.log(`\nINSTRUMENTO ${okTot}/${tot} ${failed + failed2 ? 'NO VALIDADO' : 'VALIDADO'}`);
process.exit(failed + failed2 ? 1 : 0);
