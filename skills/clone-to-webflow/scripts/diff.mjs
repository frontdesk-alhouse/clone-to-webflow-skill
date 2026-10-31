#!/usr/bin/env node
/**
 * Clone-to-Webflow — motor de paridad visual de dos canales.
 *
 * Un solo porcentaje de píxeles distintos miente: el antialiasing de texto entre el
 * rasterizador de Figma y el del navegador nunca da cero, aunque el build sea exacto.
 * Si se mide con un número, ese ruido entierra la señal de layout. Por eso son dos:
 *
 *   ESTRUCTURAL  reduce ambas imágenes y las suaviza antes de comparar. Sobrevive el
 *                diseño — posición, tamaño, color, forma, jerarquía — y muere el
 *                antialiasing. Este canal SÍ puede llegar a coincidencia total.
 *
 *   DETALLE      resolución completa, ignorando píxeles que pixelmatch clasifica como
 *                antialiasing. Mide tipografía, radios finos, sombras, bordes de 1px.
 *                Tiene un piso físico: se calibra, no se asume.
 *
 * Salidas: heatmap por canal + regions.json con la rejilla de celdas ordenada por
 * diferencia, que es lo que consume el generador — no una lista de propiedades, sino
 * dónde exactamente está el problema y de qué tamaño.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';

export const DEFAULTS = {
  structScale: 8,        // divisor de escala del canal estructural
  structBlur: 0.6,       // sigma del blur posterior; 0 lo desactiva
  structThreshold: 0.08, // tolerancia de color de pixelmatch en el canal estructural
  detailThreshold: 0.1,  // tolerancia en el canal de detalle
  cellDesktop: 120,      // lado de la celda de la rejilla de regiones, en px full-res
  cellMobile: 65,
  mobileMaxWidth: 500,   // por debajo de esto se usa cellMobile
  textPadding: 3,        // la caja de texto de Figma es de LAYOUT, no de tinta: los glifos
                         // la rebasan ~1px por sobrepaso de curvas y acentos. Medido abajo.
};

/** Lee un PNG a {width,height,data(RGBA)} sin pasar por sharp, para no tocar los píxeles. */
function readPng(path) {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: png.data };
}

function writePng(path, width, height, data) {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width, height });
  data.copy(png.data);
  writeFileSync(path, PNG.sync.write(png));
}

/**
 * Recorta ambas imágenes a su intersección y devuelve además el área que NO se solapa.
 * Un desajuste de dimensiones es en sí un hallazgo: no se escala para "hacerlas encajar",
 * porque escalar convierte un error de tamaño en un error de nitidez y lo vuelve invisible.
 */
function intersect(a, b) {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const unionArea = Math.max(a.width, b.width) * Math.max(a.height, b.height);
  const orphanArea = unionArea - w * h;

  const crop = (img) => {
    if (img.width === w && img.height === h) return img.data;
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      img.data.copy(out, y * w * 4, y * img.width * 4, y * img.width * 4 + w * 4);
    }
    return out;
  };

  return {
    width: w, height: h,
    aData: crop(a), bData: crop(b),
    dimsMatch: a.width === b.width && a.height === b.height,
    orphanArea, unionArea,
  };
}

/** Reduce + suaviza una imagen RGBA cruda. Aquí es donde muere el antialiasing. */
async function shrink(data, width, height, scale, blurSigma) {
  const w = Math.max(1, Math.round(width / scale));
  const h = Math.max(1, Math.round(height / scale));
  let pipe = sharp(data, { raw: { width, height, channels: 4 } })
    .resize(w, h, { kernel: 'lanczos3', fit: 'fill' });
  if (blurSigma > 0) pipe = pipe.blur(blurSigma);
  const out = await pipe.ensureAlpha().raw().toBuffer();
  return { width: w, height: h, data: out };
}

/**
 * Rejilla de regiones sobre el mapa de diferencia estructural.
 * Se calcula en coordenadas full-res para que el feedback sea accionable, aunque la
 * medición viva en la imagen reducida.
 */
function regionGrid(diffMask, sw, sh, scale, cellFull) {
  const cell = Math.max(1, Math.round(cellFull / scale));
  const cells = [];
  for (let cy = 0; cy < sh; cy += cell) {
    for (let cx = 0; cx < sw; cx += cell) {
      const w = Math.min(cell, sw - cx);
      const h = Math.min(cell, sh - cy);
      let differing = 0;
      for (let y = cy; y < cy + h; y++) {
        for (let x = cx; x < cx + w; x++) {
          if (diffMask[y * sw + x]) differing++;
        }
      }
      const pct = (differing / (w * h)) * 100;
      if (pct > 0.01) {
        cells.push({
          x: Math.round(cx * scale), y: Math.round(cy * scale),
          w: Math.round(w * scale), h: Math.round(h * scale),
          diffPct: +pct.toFixed(2),
        });
      }
    }
  }
  cells.sort((p, q) => q.diffPct - p.diffPct);
  return cells;
}

/**
 * Máscara booleana de diferencias REALES a partir del PNG de salida de pixelmatch.
 *
 * pixelmatch usa dos colores y hay que separarlos, o la rejilla mide ruido:
 *   amarillo (255,255,0)  píxel que clasificó como antialiasing. Con includeAA:false
 *                         NO entra en el total, así que tampoco debe entrar aquí.
 *   magenta  (255,0,90)   diferencia real. Es la única que cuenta.
 *
 * Contarlos juntos fue un bug real de esta implementación: el footer daba 0.17 % global
 * y 10.51 % en su peor celda sobre un build geométricamente verificado como correcto.
 * El gate G6 habría reprobado una sección perfecta.
 */
function maskFromDiff(diffData, w, h) {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = diffData[i * 4], g = diffData[i * 4 + 1];
    if (r > 180 && g < 120) mask[i] = 1;
  }
  return mask;
}

/**
 * Máscara de zonas de texto, en coordenadas full-res de la sección.
 *
 * Existe porque el canal de detalle tiene un límite medido: sobre el footer —build
 * verificado como geométricamente correcto— el ruido de rasterizado de la tipografía
 * pequeña da 1.99 % en su peor celda, mientras que un borde de 1px ausente da 0.83 %
 * y un radio equivocado 0.17 %. El ruido del texto SUPERA a los defectos reales, así
 * que un gate sobre el detalle global no discrimina nada.
 *
 * Fuera del texto no hay ese piso: ahí viven radios, bordes, sombras y superficies, y
 * ahí el detalle sí puede exigir casi cero. Los rects salen de la metadata de Figma,
 * que dice exactamente qué nodo es `<text>`.
 */
function buildTextMask(rects, w, h, padding) {
  if (!rects?.length) return null;
  const mask = new Uint8Array(w * h);
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x - padding));
    const y0 = Math.max(0, Math.floor(r.y - padding));
    const x1 = Math.min(w, Math.ceil(r.x + r.w + padding));
    const y1 = Math.min(h, Math.ceil(r.y + r.h + padding));
    for (let y = y0; y < y1; y++) mask.fill(1, y * w + x0, y * w + x1);
  }
  return mask;
}

export async function compare(referencePath, actualPath, outDir, label, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const ref = readPng(referencePath);
  const act = readPng(actualPath);
  const ix = intersect(ref, act);

  // ---- canal de detalle: resolución completa, sin contar antialiasing ----
  const detailOut = Buffer.alloc(ix.width * ix.height * 4);
  const detailDiffPx = pixelmatch(ix.aData, ix.bData, detailOut, ix.width, ix.height, {
    threshold: o.detailThreshold,
    includeAA: false,
    alpha: 0.15,
    diffColor: [255, 0, 90],
  });

  // ---- canal estructural: reducido y suavizado ----
  const sRef = await shrink(ix.aData, ix.width, ix.height, o.structScale, o.structBlur);
  const sAct = await shrink(ix.bData, ix.width, ix.height, o.structScale, o.structBlur);
  const structOut = Buffer.alloc(sRef.width * sRef.height * 4);
  const structDiffPx = pixelmatch(sRef.data, sAct.data, structOut, sRef.width, sRef.height, {
    threshold: o.structThreshold,
    includeAA: false,
    alpha: 0.15,
    diffColor: [255, 0, 90],
  });

  // El área que no se solapa cuenta como 100% distinta en ambos canales: un desajuste
  // de dimensiones no se puede promediar hasta volverlo aceptable.
  const detailTotal = ix.width * ix.height + ix.orphanArea;
  const structTotal = sRef.width * sRef.height + ix.orphanArea / (o.structScale ** 2);
  const orphanStruct = ix.orphanArea / (o.structScale ** 2);

  const structMatch = 100 - ((structDiffPx + orphanStruct) / structTotal) * 100;
  const detailMatch = 100 - ((detailDiffPx + ix.orphanArea) / detailTotal) * 100;

  const cellFull = ref.width <= o.mobileMaxWidth ? o.cellMobile : o.cellDesktop;
  const regions = regionGrid(
    maskFromDiff(structOut, sRef.width, sRef.height),
    sRef.width, sRef.height, o.structScale, cellFull,
  );
  // El canal de detalle también se cuadricula, y es lo único que lo hace útil.
  // Un borde de 1px ausente en una tarjeta pesa 0.2 % del encuadre completo: promediado
  // contra millón y medio de píxeles desaparece, pero concentrado en su celda salta.
  // El promedio global del detalle es informativo; el gate va contra la peor celda.
  const detailMask = maskFromDiff(detailOut, ix.width, ix.height);
  const detailRegions = regionGrid(detailMask, ix.width, ix.height, 1, cellFull);

  // Mismo mapa, restando las zonas de texto: aquí el piso es casi cero y el gate es real.
  const textMask = buildTextMask(o.textRects, ix.width, ix.height, o.textPadding);
  let nonTextRegions = null, nonTextDiffPx = null;
  if (textMask) {
    const m = new Uint8Array(detailMask);
    let px = 0;
    for (let i = 0; i < m.length; i++) {
      if (textMask[i]) m[i] = 0;
      else if (m[i]) px++;
    }
    nonTextRegions = regionGrid(m, ix.width, ix.height, 1, cellFull);
    nonTextDiffPx = px;
  }

  mkdirSync(outDir, { recursive: true });
  writePng(join(outDir, `${label}.struct.png`), sRef.width, sRef.height, structOut);
  writePng(join(outDir, `${label}.detail.png`), ix.width, ix.height, detailOut);

  const report = {
    label,
    reference: { path: referencePath, width: ref.width, height: ref.height },
    actual: { path: actualPath, width: act.width, height: act.height },
    dimsMatch: ix.dimsMatch,
    orphanAreaPx: ix.orphanArea,
    structural: {
      matchPct: +structMatch.toFixed(3),
      diffPx: structDiffPx,
      comparedAt: `${sRef.width}x${sRef.height}`,
      scale: o.structScale, blur: o.structBlur, threshold: o.structThreshold,
    },
    detail: {
      matchPct: +detailMatch.toFixed(3),
      diffPx: detailDiffPx,
      comparedAt: `${ix.width}x${ix.height}`,
      threshold: o.detailThreshold, includeAA: false,
    },
    // Detalle fuera de las zonas de texto. Es el número que gatea: sin el piso de
    // rasterizado de la tipografía, un radio o un borde ausente no tienen dónde esconderse.
    detailNonText: textMask ? {
      diffPx: nonTextDiffPx,
      worstCellPct: nonTextRegions[0]?.diffPct ?? 0,
      cells: nonTextRegions.length,
    } : null,
    grid: {
      cellPx: cellFull,
      structCells: regions.length,
      structWorstPct: regions[0]?.diffPct ?? 0,
      detailCells: detailRegions.length,
      detailWorstPct: detailRegions[0]?.diffPct ?? 0,
    },
    regions: regions.slice(0, 40),
    detailRegions: detailRegions.slice(0, 40),
    nonTextRegions: nonTextRegions?.slice(0, 40) ?? null,
  };
  writeFileSync(join(outDir, `${label}.report.json`), JSON.stringify(report, null, 2));
  return report;
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const [reference, actual, outDir, label] = process.argv.slice(2);
  if (!reference || !actual || !outDir || !label) {
    console.error('uso: diff.mjs <reference.png> <actual.png> <outDir> <label>');
    process.exit(2);
  }
  const r = await compare(reference, actual, outDir, label);
  console.log(JSON.stringify(r, null, 2));
  if (!r.dimsMatch) {
    console.error(`\nDIMENSIONES DISTINTAS: referencia ${r.reference.width}x${r.reference.height} vs build ${r.actual.width}x${r.actual.height}`);
  }
}
