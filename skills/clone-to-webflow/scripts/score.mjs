#!/usr/bin/env node
/**
 * Clone-to-Webflow — EVALUADOR.
 *
 * Mismo papel que `figma-clone-evaluator` en el harness de Figma, y mismo contrato: puntúa
 * contra una rúbrica ponderada y escribe `feedback/<sección>/feedback-N.md` con encabezados
 * exactos, porque el orquestador **re-parsea la fila TOTAL del disco**, no del chat.
 *
 * La diferencia con el original es deliberada. Allá la rúbrica es mayormente cualitativa —su
 * propio evaluador explica que "un render de Figma de un frame correcto no coincide bit a bit
 * con otro render", así que Layout Match se puntúa correcto/cerca/mal—. Aquí el target es un
 * DOM y la medición es determinista, así que el evaluador es un script: mismo artefacto, sin
 * ruido de juicio, reproducible entre corridas.
 *
 * Se hereda su cláusula anti-generosidad: no vale "close enough" ni "captura el espíritu".
 * Un script no puede darse ese lujo, que es justamente el punto.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compare } from './diff.mjs';
import { probeInk } from './inkprobe.mjs';

import { UMBRAL, MAX_ITER } from './umbral.mjs';

export const THRESHOLD = UMBRAL;
export const MAX_ITERATIONS = MAX_ITER;

export const RUBRIC = [
  { key: 'estructural', label: 'Paridad estructural', weight: 0.40 },
  { key: 'geometria',   label: 'Geometría y superficie', weight: 0.25 },
  { key: 'texto',       label: 'Posición de texto', weight: 0.20 },
  { key: 'detalle',     label: 'Paridad de detalle', weight: 0.10 },
  { key: 'assets',      label: 'Assets', weight: 0.05 },
];

/** Banda determinista: el primer umbral que se cumple manda. */
const band = (v, table, fallback) => (table.find(([t]) => v >= t) ?? [null, fallback])[1];

const scoreStructural = (pct) => band(pct, [
  [99.9, 10], [99.7, 9], [99.4, 8], [99.0, 7], [98, 6], [96, 5], [92, 4], [85, 3], [70, 2],
], 1);

const scoreDetail = (pct) => band(pct, [
  [99.5, 10], [99.0, 9.5], [98.5, 9], [98, 8], [97, 7], [95, 6], [90, 5],
], 3);

/**
 * Geometría: píxeles distintos FUERA de las zonas de texto, descontando el piso declarado.
 *
 * El piso solo se descuenta si está declarado con razón en `spec/floors.json` y respaldado en
 * KNOWN_LIMITATIONS. Un piso no declarado no existe: así un defecto nuevo nunca se cuela
 * escondido detrás de "es antialiasing".
 */
function geometryScore(px, floor) {
  const net = Math.max(0, px - floor);
  if (net === 0) return 10;
  if (net <= 25) return 9.6;
  if (net <= 150) return 9.2;
  if (net <= 400) return 8;
  if (net <= 1000) return 6.5;
  if (net <= 3000) return 4.5;
  if (net <= 8000) return 3;
  return 1.5;
}

/**
 * Tolerancia de tinta: 1 px por defecto (redondeo de medio-interlineado). Un piso `textPx` en
 * `spec/floors.json` la sube SOLO para ese label y banda, y solo cuenta si viene con `why`,
 * con `textBoxes: "verificadas"` (las cajas DOM coinciden con las cajas de Figma al pixel,
 * medidas con use_figma) y con respaldo en KNOWN_LIMITATIONS. Cubre la diferencia de
 * colocacion de la tinta entre el rasterizador de Figma y Chrome para un cuerpo concreto
 * (KL-127: DM Sans 15/23); no cubre desplazamientos de layout, que mueven la caja.
 */
function textScore({ worst, missing }, tol = 1) {
  if (missing > 0) return 0;              // un nodo que falta o sobra no es un desajuste, es un error
  if (worst <= tol) return 10;
  if (worst === tol + 1) return 7;
  if (worst === tol + 2) return 5;
  return 2;
}
const textTolerance = (f) => (f && f.textPx > 1 && f.why && f.textBoxes === 'verificadas') ? f.textPx : 1;

const loadFloors = () => (existsSync('spec/floors.json')
  ? JSON.parse(readFileSync('spec/floors.json', 'utf8')) : {});

/**
 * Desviaciones declaradas: secciones donde el sitio se aparta A PROPOSITO de la referencia,
 * por instruccion. No se les sube el score —un piso de rasterizado y un cambio de diseno no
 * son la misma cosa y mezclarlos corromperia el instrumento—: se les cambia el VEREDICTO a
 * DESVIACION, que no se puede confundir ni con PASS ni con FAIL, y se imprime por que.
 */
const loadDeviations = () => {
  if (!existsSync('spec/desviaciones.json')) return {};
  const raw = JSON.parse(readFileSync('spec/desviaciones.json', 'utf8'));
  const out = {};
  for (const [nombre, d] of Object.entries(raw)) {
    if (nombre.startsWith('_')) continue;
    for (const s of d.secciones ?? []) out[s] = { nombre, ...d };
  }
  return out;
};

const nextIteration = (dir) => (existsSync(dir)
  ? readdirSync(dir).filter((f) => /^feedback-\d+\.md$/.test(f))
      .map((f) => +f.match(/\d+/)[0]).reduce((a, b) => Math.max(a, b), 0) + 1
  : 1);

const prevTotal = (dir, n) => {
  const f = join(dir, `feedback-${n - 1}.md`);
  if (n < 2 || !existsSync(f)) return null;
  const m = readFileSync(f, 'utf8').match(/\*\*TOTAL\*\*.*?\*\*([\d.]+)\/10\*\*/s);
  return m ? +m[1] : null;
};

export async function scoreSection(label, viewport = '1440', opts = {}) {
  const key = `${label}.${viewport}`;
  const reference = `reference/${key}.png`;
  const actual = `actual/${key}.png`;

  const trPath = [`spec/sections/${key}.textrects.json`, `spec/sections/${label}.textrects.json`]
    .find(existsSync);
  const textRects = trPath ? JSON.parse(readFileSync(trPath, 'utf8')).rects : null;

  const diff = await compare(reference, actual, 'diff', key, { textRects });
  const ink = trPath ? probeInk(label, viewport) : { worst: 0, missing: 0, rows: [], count: 0 };

  const floors = loadFloors();
  const floor = floors[key]?.nonTextPx ?? 0;
  const images = opts.images ?? null;   // [{src, naturalWidth}] cuando la captura lo aporta
  const brokenImages = images ? images.filter((i) => !i.naturalWidth) : [];

  // Piso ESTRUCTURAL: el rasterizado de glifos deja un residuo que no baja aunque el build
  // sea exacto (el footer da 99.528 % con 0 px fuera de texto y la tinta al pixel).
  //
  // La guarda que impide que esto tape defectos: el piso SOLO se honra si la geometria y la
  // posicion del texto estan limpias. Si algo se mueve, el piso deja de aplicar solo y el
  // criterio vuelve a puntuar crudo. Un piso no puede esconder un defecto que el resto de la
  // rubrica ya esta viendo.
  const geomClean = Math.max(0, (diff.detailNonText?.diffPx ?? 0) - floor) === 0;
  const textTol = textTolerance(floors[key]);
  const textClean = ink.worst <= textTol && ink.missing === 0;
  const structFloor = floors[key]?.structuralPct ?? null;
  const structHonored = structFloor !== null && geomClean && textClean
    && diff.structural.matchPct >= structFloor;
  // Mismo contrato para el canal de detalle. Hace falta desde que las ventanas del escritorio
  // son texto real: 147 nodos de 6.5 a 17 px rasterizados por Chrome contra el render de Figma
  // ponen un suelo que no es un defecto y que la mascara de texto no cubre —la mascara protege
  // al gate de geometria, no a este canal, que mide a resolucion completa. Se honra con la
  // misma guarda: solo si geometria y posicion de texto estan limpias.
  const detailFloor = floors[key]?.detailPct ?? null;
  const detailHonored = detailFloor !== null && geomClean && textClean
    && diff.detail.matchPct >= detailFloor;

  const scores = {
    estructural: structHonored ? 10 : scoreStructural(diff.structural.matchPct),
    geometria:   geometryScore(diff.detailNonText?.diffPx ?? 0, floor),
    texto:       textScore(ink, textTol),
    detalle:     detailHonored ? 10 : scoreDetail(diff.detail.matchPct),
    assets:      images ? (brokenImages.length ? 0 : 10) : 10,
  };

  // Compuerta dura: un alto o ancho equivocado no se promedia con nada.
  const dimsOk = diff.dimsMatch;
  const total = dimsOk
    ? +RUBRIC.reduce((a, c) => a + scores[c.key] * c.weight, 0).toFixed(2)
    : 0;

  const dir = join('feedback', key);
  const iteration = opts.iteration ?? nextIteration(dir);
  const previous = prevTotal(dir, iteration);

  const critical = [], major = [], minor = [];
  if (!dimsOk) {
    critical.push(`Dimensiones distintas: la referencia mide ${diff.reference.width}x${diff.reference.height} y el build ${diff.actual.width}x${diff.actual.height}. TOTAL forzado a 0 — el layout está mal, no "casi bien".`);
  }
  if (ink.missing) {
    critical.push(`${ink.missing} nodo(s) de texto presentes en un solo lado. Revisar contenido faltante o sobrante.`);
  }
  if (brokenImages.length) {
    critical.push(`${brokenImages.length} imagen(es) no renderizan (naturalWidth 0): ${brokenImages.map((i) => i.src).slice(0, 3).join(', ')}`);
  }
  if (ink.worst > textTol) {
    major.push(`Texto desplazado hasta ${ink.worst} px${textTol > 1 ? ` (tolerancia declarada ${textTol} px)` : ''}. Ambos bordes movidos = corrimiento real; un solo borde = antialiasing.`);
  }
  const netGeom = Math.max(0, (diff.detailNonText?.diffPx ?? 0) - floor);
  if (netGeom > 0) {
    const worst = (diff.nonTextRegions ?? [])[0];
    major.push(`${netGeom} px de diferencia fuera de zonas de texto${floor ? ` (piso declarado ${floor} px ya descontado)` : ''}${worst ? `; peor región en x${worst.x} y${worst.y} ${worst.w}x${worst.h} al ${worst.diffPct} %` : ''}.`);
  }
  if (scores.estructural < 10) {
    const w = diff.regions[0];
    (scores.estructural < 8 ? major : minor).push(`Estructural ${diff.structural.matchPct} % (10 exige 99.9)${w ? `; peor celda en x${w.x} y${w.y} al ${w.diffPct} %` : ''}.`);
  }
  if (scores.detalle < 10) {
    minor.push(`Detalle ${diff.detail.matchPct} % (10 exige 99.5).`);
  }

  const desv = loadDeviations()[key] ?? null;
  const verdict = desv ? 'DESVIACION' : (total >= THRESHOLD ? 'PASS' : 'FAIL');
  const row = (c) => `| ${c.label} | ${scores[c.key]}/10 | ${c.weight.toFixed(2)} | ${(scores[c.key] * c.weight).toFixed(2)} |`;
  const list = (arr) => (arr.length ? arr.map((t, i) => `${i + 1}. ${t}`).join('\n') : '_ninguno_');

  const md = `# Evaluación — ${label} @${viewport} — Iteración ${iteration}

## Scores
| Criterio | Score | Peso | Ponderado |
|---|---|---|---|
${RUBRIC.map(row).join('\n')}
| **TOTAL** | | | **${total}/10** |

## Veredicto: ${verdict} (umbral: ${THRESHOLD})
${desv ? `\n> **Desviacion declarada — \`${desv.nombre}\`.** ${desv.instruccion}\n>\n> ${desv.que}\n>\n> Lo que NO cambia: ${desv['no-cambia']}\n>\n> El score de esta tabla mide contra la referencia de Figma, que ya no es el juez de esas\n> superficies. El gate real de la desviacion es: ${desv.evidencia.join(' · ')}\n` : ''}

## Medición
| señal | valor |
|---|---|
| dimensiones | ${diff.reference.width}x${diff.reference.height} vs ${diff.actual.width}x${diff.actual.height} ${dimsOk ? '· exactas' : '· **DISTINTAS**'} |
| paridad estructural | ${diff.structural.matchPct} %${structHonored ? ` (piso declarado ${structFloor} % — ${floors[key].whyStructural})` : ''} |
| paridad de detalle | ${diff.detail.matchPct} % |
| fuera de zonas de texto | ${diff.detailNonText?.diffPx ?? 'n/d'} px${floor ? ` (piso declarado ${floor} px — ${floors[key].why})` : ''} |
| posición de texto | máx. ${ink.worst} px sobre ${ink.count} nodos${ink.missing ? ` · ${ink.missing} en un solo lado` : ''} |
| assets | ${images ? `${images.length} imagen(es), ${brokenImages.length} rota(s)` : 'no medido en esta pasada'} |

## Issues críticos
${list(critical)}

## Issues mayores
${list(major)}

## Issues menores
${list(minor)}

## Qué mejoró desde la iteración anterior
${previous === null ? '_primera iteración_' : (total > previous ? `TOTAL ${previous} → ${total}` : '_sin mejora en el TOTAL_')}

## Qué empeoró
${previous !== null && total < previous ? `**REGRESIÓN**: TOTAL ${previous} → ${total}` : '_nada_'}

## Observaciones del heatmap
- estructural: \`diff/${key}.struct.png\` · ${diff.grid.structCells} celda(s) con diferencia, peor ${diff.grid.structWorstPct} %
- detalle: \`diff/${key}.detail.png\` · ${diff.detailNonText?.cells ?? 0} celda(s) fuera de texto, peor ${diff.detailNonText?.worstCellPct ?? 0} %
`;

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `feedback-${iteration}.md`), md);

  return { total, verdict, iteration, previous, scores, diff, ink, path: join(dir, `feedback-${iteration}.md`) };
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const [label, viewport = '1440'] = process.argv.slice(2);
  if (!label) { console.error('uso: score.mjs <label> [viewport]'); process.exit(2); }
  const r = await scoreSection(label, viewport);
  const pad = (n, w = 6) => String(n).padStart(w);
  console.log(`\n  ${label} @${viewport} — iteración ${r.iteration}\n`);
  for (const c of RUBRIC) console.log(`   ${c.label.padEnd(24)} ${pad(r.scores[c.key])}/10   x${c.weight.toFixed(2)}`);
  console.log(`\n   TOTAL ${r.total}/10   ${r.verdict}${r.previous !== null ? `   (antes ${r.previous})` : ''}`);
  console.log(`   ${r.path}\n`);
  process.exit(r.verdict === 'PASS' ? 0 : 1);
}
