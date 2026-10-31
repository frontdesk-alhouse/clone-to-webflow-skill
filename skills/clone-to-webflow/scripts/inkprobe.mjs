#!/usr/bin/env node
/**
 * Sonda de tinta — mide la POSICIÓN del texto, que es lo que la máscara de texto ciega.
 *
 * El canal de detalle enmascara las zonas de texto porque ahí el ruido de rasterizado
 * (1.99 % medido) supera a los defectos reales que debería atrapar (0.83 %, 0.17 %).
 * Pero enmascarar deja un hueco: un bloque de texto desplazado dejaría de verse.
 *
 * Esta sonda lo cierra sin porcentajes. Por cada nodo de texto de Figma busca la caja
 * real que ocupan los píxeles con tinta, en la referencia y en el build, y reporta el
 * delta. Es una medición directa: 0 px de desplazamiento es 0 px, sin umbral que ajustar.
 *
 *   node scripts/inkprobe.mjs footer 1440
 */

import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

import { existsSync } from 'node:fs';

/**
 * Caja de tinta dentro de un rect. "Tinta" es todo lo que se aparta del color de fondo
 * local, así que funciona igual sobre banda oscura y sobre banda clara — no se puede
 * asumir texto claro sobre oscuro, el sitio tiene las dos cosas.
 */
/**
 * Color de fondo del rect, estimado con la MEDIANA DE SUS PIXELES DE BORDE.
 *
 * La version anterior tomaba el color mas frecuente del rect, y eso falla sobre degradados
 * y fotos: ahi ningun color se repite, cada imagen elige un "fondo" distinto y las cajas de
 * tinta dejan de ser comparables. Lo cazo el boton Send del feature-stack, donde la sonda
 * reportaba 6px de desplazamiento sobre un label que estaba en la fila exacta (494..500 en
 * las dos imagenes). Sin este arreglo habria dado falsos negativos en todo texto sobre foto.
 */
function edgeMedian(img, x0, y0, x1, y1) {
  const ch = [[], [], []];
  const take = (x, y) => {
    const i = (y * img.width + x) * 4;
    ch[0].push(img.data[i]); ch[1].push(img.data[i + 1]); ch[2].push(img.data[i + 2]);
  };
  for (let x = x0; x < x1; x++) { take(x, y0); take(x, y1 - 1); }
  for (let y = y0; y < y1; y++) { take(x0, y); take(x1 - 1, y); }
  return ch.map((c) => c.sort((a, b) => a - b)[c.length >> 1] ?? 0);
}

/**
 * Caja de tinta dentro de un rect, contra un fondo dado.
 * El fondo se calcula UNA vez sobre la referencia y se aplica a las dos imagenes, para que
 * la comparacion sea de manzanas con manzanas.
 */
function inkBox(img, r, bg) {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.width, Math.ceil(r.x + r.w)), y1 = Math.min(img.height, Math.ceil(r.y + r.h));
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;

  // El anillo exterior de 1 px se excluye: es EXACTAMENTE de donde edgeMedian saca el fondo,
  // asi que contarlo tambien como tinta es contradictorio. Lo cazo el contador de la insignia
  // del diferenciador: el rect del numero roza la esquina redondeada de la pildora, y esos
  // pixeles mezclados —fondo por definicion— movian la caja 5 px. La caja de linea de Figma
  // siempre trae holgura sobre los glifos, asi que quitar 1 px no puede comerse texto.
  const ix0 = x0 + 1, iy0 = y0 + 1, ix1 = x1 - 1, iy1 = y1 - 1;

  // Umbral absoluto sobre la desviacion del fondo. Se probo uno RELATIVO (mitad del pico del
  // nodo) para normalizar diferencias de grosor de glifo: empeoro TODO —de 1 a 2 px en cinco
  // secciones ya aceptadas y a 6 px en el hero— porque recorta el glifo y la caja pasa a
  // depender de que pixel resulte ser el pico. Queda descartado y anotado.
  const isInk = (x, y) => {
    const i = (y * img.width + x) * 4;
    return Math.abs(img.data[i] - bg[0]) + Math.abs(img.data[i + 1] - bg[1])
         + Math.abs(img.data[i + 2] - bg[2]) > 90;
  };

  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) {
    if (!isInk(x, y)) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function probeInk(label, viewport = '1440') {
  const ref = PNG.sync.read(readFileSync(`reference/${label}.${viewport}.png`));
  const act = PNG.sync.read(readFileSync(`actual/${label}.${viewport}.png`));
  // Por viewport primero: en movil la seccion puede tener otra estructura y los rects
  // del desktop apuntan a zonas vacias ("ambos vacios" en todo).
  const trPath = [`spec/sections/${label}.${viewport}.textrects.json`,
                  `spec/sections/${label}.textrects.json`].find(existsSync);
  if (!trPath) throw new Error(`falta el archivo de rects de texto para ${label} @${viewport}`);
  const { rects } = JSON.parse(readFileSync(trPath, 'utf8'));

  const rows = [];
  let worst = 0, missing = 0;
  // Un rect puede marcarse `probe:false` para quedar FUERA de la sonda sin salir de la
  // mascara. Existe por un caso concreto y acotado: el historial difuminado del
  // feature-stack. Ahi el texto va bajo una mascara de degradado, asi que sus pixeles
  // rondan el umbral de "tinta" y la caja detectada crece o encoge con el ruido —la sonda
  // acusaba 2-3 px en un texto que no se ha movido—. Ese mismo texto SI se mide, a plena
  // opacidad, en el estado donde es la ventana activa. Excluirlo aqui no deja ningun
  // bloque sin medir; medirlo aqui solo mide el desvanecido.
  for (const r of rects) {
    if (r.probe === false) continue;
    if (r.probe === false) { rows.push({ name: r.name, status: 'tapado por otra capa' }); continue; }
    const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(ref.width, Math.ceil(r.x + r.w)), y1 = Math.min(ref.height, Math.ceil(r.y + r.h));
    if (x1 <= x0 || y1 <= y0) { rows.push({ name: r.name, status: 'rect fuera de la imagen' }); continue; }
    const bg = edgeMedian(ref, x0, y0, x1, y1);
    const a = inkBox(ref, r, bg), b = inkBox(act, r, bg);
    if (!a && !b) { rows.push({ name: r.name, status: 'ambos vacios' }); continue; }
    if (!a || !b) { rows.push({ name: r.name, status: a ? 'FALTA EN EL BUILD' : 'SOBRA EN EL BUILD' }); missing++; continue; }
    const row = { name: r.name, dx: b.x - a.x, dy: b.y - a.y, dw: b.w - a.w, dh: b.h - a.h };
    worst = Math.max(worst, Math.abs(row.dx), Math.abs(row.dy));
    rows.push(row);
  }
  return { rows, worst, missing, count: rects.length };
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const [label, viewport = '1440'] = process.argv.slice(2);
  if (!label) { console.error('uso: inkprobe.mjs <label> [viewport]'); process.exit(2); }
  const { rows, worst, missing, count } = probeInk(label, viewport);
  const pad = (v, w = 4) => String(v).padStart(w);
  console.log(`\n  sonda de tinta - ${label} @${viewport}   (${count} nodos de texto)\n`);
  for (const r of rows) {
    if (r.status) { console.log(`   ${r.name.slice(0, 34).padEnd(36)} ${r.status}`); continue; }
    const shift = Math.max(Math.abs(r.dx), Math.abs(r.dy));
    console.log(`   ${r.name.slice(0, 34).padEnd(36)} dx ${pad(r.dx)}  dy ${pad(r.dy)}   dw ${pad(r.dw)}  dh ${pad(r.dh)}${shift > 1 ? '  <-- DESPLAZADO' : ''}`);
  }
  console.log(`\n  desplazamiento maximo: ${worst} px${missing ? `   ·  ${missing} nodo(s) presentes en un solo lado` : ''}`);
  console.log(`  ${worst <= 1 && !missing ? 'PASS' : 'FAIL'} — el gate de posicion de texto tolera 1 px (redondeo de medio-interlineado), no mas.\n`);
  process.exit(worst <= 1 && !missing ? 0 : 1);
}
