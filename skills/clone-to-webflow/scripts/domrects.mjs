#!/usr/bin/env node
/**
 * Rects de texto tomados del DOM del build local.
 *
 * Complementa a textrects.mjs, que los saca de la metadata de Figma. Hace falta porque
 * `get_metadata` NO desciende en ciertos subárboles —los devuelve como si estuvieran vacíos—
 * y porque en los grupos de Figma las coordenadas del hijo repiten las del padre, así que un
 * extractor que acumula offsets cuenta dos veces.
 *
 * Es fiable solo cuando el modelo de caja ya coincide con Figma, y el riesgo de que una caja
 * demasiado grande tape un defecto lo cierra la sonda de tinta: mide el desplazamiento del
 * texto DENTRO del rect, así que un build corrido sigue cayendo.
 *
 *   node scripts/domrects.mjs <label> <archivo> <selector-seccion> <selector-de-texto> [viewport]
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [label, file, secSel, txtSel, viewport = '1440'] = process.argv.slice(2);
if (!txtSel) { console.error('faltan argumentos'); process.exit(2); }

const b = await chromium.launch({ args: ['--hide-scrollbars', '--force-device-scale-factor=1', '--font-render-hinting=none'] });
const pg = await b.newPage({ viewport: { width: +viewport, height: 1000 }, deviceScaleFactor: 1 });
// La mascara se mide con reduced-motion por la misma razon que la captura (KL-133): con la capa
// de entrada puesta, un nodo que aun no ha entrado esta 16 px mas abajo y la mascara sale movida.
await pg.emulateMedia({ reducedMotion: 'reduce' });
await pg.goto(/^https?:\/\//.test(file) ? file : 'file://' + resolve(file));
await pg.evaluate(() => document.fonts.ready);
const rects = await pg.evaluate(([secSel, txtSel]) => {
  const sec = document.querySelector(secSel).getBoundingClientRect();
  const out = [];
  for (const el of document.querySelectorAll(txtSel)) {
    if (!el.textContent.trim()) continue;
    // La caja del ELEMENTO no es la caja del TEXTO: un boton centrado de 122 px de ancho
    // devuelve 122 px de rect para dos palabras, y la sonda acaba midiendo el borde de la
    // pildora que hay detras, no la tinta. El rango de contenido da la caja real de los
    // glifos, que es lo que hay que enmascarar y lo que hay que medir.
    const rango = document.createRange();
    rango.selectNodeContents(el);
    const rr = rango.getBoundingClientRect();
    const r = rr.width && rr.height ? rr : el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (getComputedStyle(el).opacity === '0') continue;   // nodos ocultos no pintan tinta
    // 2 px de holgura: cuando la tinta toca el borde del rect, la sonda excluye su anillo
    // exterior y la caja medida se encoge sola. La holgura evita ese falso positivo sin
    // aflojar la medicion, que sigue siendo de DESPLAZAMIENTO dentro del rect.
    // La holgura solo aplica a cajas holgadas: en una etiqueta diminuta dentro de un boton
    // (el 'Send' de 23x18) los 2 px alcanzan el borde del boton y la sonda mide ESE borde.
    // Siempre 2 px: si la tinta toca el borde del rect, la sonda excluye su anillo exterior y
    // la caja medida se encoge sola (lo daba la barra de menu, con anchos exactos de Figma).
    // Las etiquetas diminutas dentro de un boton se excluyen de la lista, no se des-holgan.
    // Un texto tapado por otra capa no se puede medir: la tinta que hay en su rect es la del
    // vecino de encima. Se sigue enmascarando —ahi hay texto— pero no se sonda. Lo pedian las
    // ventanas del escritorio, donde la pila de notificaciones cubre media tabla.
    // No sirve `elementFromPoint`: el velo del escritorio esta encima de todo y es translucido,
    // asi que marcaria como tapado lo que se ve perfectamente. Lo que tapa de verdad es una
    // CAPA OPACA posterior en el documento —otra ventana, una notificacion—, y eso se decide
    // con el orden del DOM y la interseccion de rects.
    const capas = [...document.querySelectorAll('[data-capa]')];
    const tapado = capas.some((c) => {
      if (c.contains(el)) return false;
      if (!(el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      const q = c.getBoundingClientRect();
      return r.left < q.right && q.left < r.right && r.top < q.bottom && q.top < r.bottom;
    });
    out.push({ id: el.getAttribute('data-node') || 'dom', name: el.textContent.trim().slice(0, 40),
      x: +(r.x - sec.x).toFixed(2), y: +(r.y - sec.y).toFixed(2),
      w: +r.width.toFixed(2), h: +r.height.toFixed(2), dom: true, ...(tapado ? { probe: false } : {}) });
  }
  // La holgura no puede ser fija. En las ventanas del escritorio el interlineado es el de
  // Figma —round(fs x 1.302)— y las lineas quedan pegadas: 2 px de holgura invaden la linea
  // vecina y la sonda mide la tinta del vecino, no la propia. Se da a cada rect la holgura
  // mas grande que NO toque a otro (hasta 2 px), que es lo que la caja de Figma permite.
  for (const a of out) {
    let gap = 2;
    for (const b of out) {
      if (b === a) continue;
      const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
      const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      const sep = Math.max(dx, dy);          // separacion real entre las dos cajas
      if (sep < 0) continue;                 // ya se solapan: la holgura no lo empeora
      gap = Math.min(gap, sep / 2);
    }
    a.pad = +Math.max(0, gap).toFixed(2);
  }
  for (const a of out) {
    // Con menos de 1 px de holgura la sonda no puede medir: excluye un anillo de 1 px del rect
    // —de ahi saca el fondo— y ese anillo se come el filo del glifo, asi que la caja de tinta
    // sale recortada y el delta deja de ser una posicion. Se enmascara igual, pero no se sonda,
    // y queda dicho. Aqui son 8 de 147: contadores del dock y etiquetas pegadas a su vecina.
    if (a.pad < 1) a.probe = false;
    a.x = +(a.x - a.pad).toFixed(2); a.y = +(a.y - a.pad).toFixed(2);
    a.w = +(a.w + 2 * a.pad).toFixed(2); a.h = +(a.h + 2 * a.pad).toFixed(2);
  }
  return out;
}, [secSel, txtSel]);
await b.close();

const path = `spec/sections/${label}.${viewport}.textrects.json`;
const prev = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { root: {}, rects: [] };
prev.rects = [...prev.rects.filter((r) => !r.dom), ...rects];
prev.count = prev.rects.length;
writeFileSync(path, JSON.stringify(prev, null, 2) + '\n');
console.log(`${rects.length} rects del DOM · ${prev.count} en total → ${path}`);
