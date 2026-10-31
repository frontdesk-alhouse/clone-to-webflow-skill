#!/usr/bin/env node
/**
 * Loop rápido de paridad: captura una sección y la compara contra su PNG de Figma.
 *
 * Corre contra un HTML local mientras se afina, y contra la URL de staging de Webflow
 * cuando toca confirmar. Es el mismo medidor en los dos casos, que es justamente lo que
 * hace que el port a Webflow sea una transcripción verificable y no una segunda apuesta.
 *
 *   node scripts/parity.mjs footer build/local/footer.html "#footer" 1440
 *
 * El destino se pasa entero a proposito: el mismo medidor mide el HTML local (Fase 3, barato,
 * ~2 s por vuelta) y el sitio publicado (Fase 4, caro, para confirmar). Un solo instrumento.
 *   node scripts/parity.mjs footer https://<shortName>.webflow.io "#footer" 1440
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureAll } from './capture.mjs';
import { compare } from './diff.mjs';
import { scoreSection, RUBRIC, THRESHOLD } from './score.mjs';

const [label, target, selector, viewportArg, progressArg] = process.argv.slice(2);
if (!label || !target || !selector) {
  console.error('uso: parity.mjs <label> <url|archivo.html> <selector> [viewport=1440] [progreso]');
  process.exit(2);
}
const viewport = Number(viewportArg || 1440);
const url = target.startsWith('http') ? target : `file://${resolve(target)}`;
const reference = `reference/${label}.${viewport}.png`;
if (!existsSync(reference)) {
  console.error(`falta la referencia de Figma: ${reference}`);
  process.exit(2);
}

const shot = { label, selector, viewport };
if (progressArg != null) shot.progress = Number(progressArg);
// Las secciones con estados —el feature-stack lleva `is-1`..`is-4` en la misma seccion—
// no se pueden medir sin ponerlas en su estado. VT_PREP corre en la pagina antes de la
// captura; es la unica diferencia entre medir el estado 1 y el 4, y queda en el comando,
// no en el build.
if (process.env.VT_PREP) shot.prep = process.env.VT_PREP;

// Con la capa de movimiento puesta, medir el sitio publicado exige `reduced-motion`: es el
// estado de reposo declarado (G2), y es el unico que la referencia de Figma representa.
// Sin el, la mitad de la seccion esta en opacity 0 esperando su ScrollTrigger.
const rm = process.env.VT_RM === '1';
const [cap] = await captureAll({ url, outDir: 'actual', map: [shot], reducedMotion: rm });

// La mascara de texto vuelve real el gate del canal de detalle. Sin ella, el piso de
// rasterizado de la tipografia pequena (1.99 % medido en el footer) supera a los
// defectos que el gate deberia atrapar (borde ausente 0.83 %, radio equivocado 0.17 %).
// Por viewport primero: en movil la seccion puede tener OTRA estructura, no solo otro
// ancho. El footer movil es 2x2 con cajas tactiles de 44px; usar los rects del desktop
// pone la mascara donde no va y el gate acusa como "fuera de texto" lo que es texto.
const trPath = [`spec/sections/${label}.${viewport}.textrects.json`,
                `spec/sections/${label}.textrects.json`].find(existsSync);
const textRects = trPath ? JSON.parse(readFileSync(trPath, 'utf8')).rects : null;
if (!textRects) console.log(`  (sin mascara de texto: falta ${trPath} — el gate de detalle no aplica)`);

const r = await compare(reference, cap.out, 'diff', `${label}.${viewport}`, { textRects });

const ref = readFileSync(reference).length;
const pad = (n, w = 8) => String(n).padStart(w);

console.log(`
  referencia   ${r.reference.width}x${r.reference.height}   (${(ref / 1024).toFixed(0)} KB)
  build        ${r.actual.width}x${r.actual.height}   ${r.dimsMatch ? '' : '  <-- DIMENSIONES DISTINTAS'}

  ESTRUCTURAL  ${pad(r.structural.matchPct)} %   peor celda ${pad(r.grid.structWorstPct, 6)} %   celdas ${r.grid.structCells}
  DETALLE      ${pad(r.detail.matchPct)} %   peor celda ${pad(r.grid.detailWorstPct, 6)} %   celdas ${r.grid.detailCells}
  DET. NO-TEXTO ${r.detailNonText ? `${pad(r.detailNonText.diffPx, 7)} px  peor celda ${pad(r.detailNonText.worstCellPct, 6)} %   celdas ${r.detailNonText.cells}   <-- gate` : '        n/d'}
`);

if (cap.overflow?.overflows) {
  console.log(`  G1 OVERFLOW: scrollWidth ${cap.overflow.scrollWidth} > clientWidth ${cap.overflow.clientWidth}`);
  cap.overflow.offenders.slice(0, 5).forEach((o) => console.log(`     ${o.tag}.${o.cls}  ${o.left}..${o.right}`));
}

const worst = r.regions.slice(0, 8);
if (worst.length) {
  console.log('  regiones estructurales peores (x, y, w, h → % distinto):');
  worst.forEach((c) => console.log(`     ${pad(c.x, 5)} ${pad(c.y, 5)} ${pad(c.w, 5)} ${pad(c.h, 5)}  →  ${c.diffPct} %`));
}
const dworst = (r.nonTextRegions ?? r.detailRegions).slice(0, 8);
if (dworst.length) {
  console.log(`  regiones de detalle peores${r.nonTextRegions ? ' (fuera de texto)' : ''}:`);
  dworst.forEach((c) => console.log(`     ${pad(c.x, 5)} ${pad(c.y, 5)} ${pad(c.w, 5)} ${pad(c.h, 5)}  →  ${c.diffPct} %`));
} else if (r.nonTextRegions) {
  console.log('  regiones de detalle fuera de texto: ninguna. Superficies, radios, bordes y sombras exactos.');
}
console.log(`  heatmaps: diff/${label}.${viewport}.struct.png · diff/${label}.${viewport}.detail.png`);

// El paso del bucle termina SIEMPRE con un score en disco. La medicion informa; el
// veredicto lo da la rubrica, y el orquestador lo lee del archivo, no de esta consola.
const sc = await scoreSection(label, viewport);
console.log(`\n  ---- EVALUADOR · iteracion ${sc.iteration} ----`);
for (const c of RUBRIC) console.log(`   ${c.label.padEnd(24)} ${String(sc.scores[c.key]).padStart(5)}/10  x${c.weight.toFixed(2)}`);
console.log(`\n   TOTAL ${sc.total}/10   ${sc.verdict}  (umbral ${THRESHOLD})${sc.previous !== null ? `   antes ${sc.previous}` : ''}`);
console.log(`   ${sc.path}\n`);
process.exit(sc.verdict === 'PASS' ? 0 : 1);
