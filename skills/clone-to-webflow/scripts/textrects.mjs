#!/usr/bin/env node
/**
 * Extrae los rects de los nodos de texto desde el XML de `mcp__figma__get_metadata`
 * y los normaliza al origen de la sección.
 *
 * Alimenta la máscara de texto de diff.mjs, que es lo que vuelve real el gate del canal
 * de detalle: dentro del texto hay un piso de rasterizado que supera a los defectos
 * reales; fuera del texto, no.
 *
 *   node scripts/textrects.mjs spec/sections/footer.390.meta.xml > spec/sections/footer.390.textrects.json
 *
 * OJO — las coordenadas del XML de Figma son RELATIVAS AL PADRE, no absolutas. Hay que
 * acumular los offsets bajando el árbol. Con un footer de un solo nivel no se nota; con
 * el footer móvil, que anida columns > row > col > link > label, un extractor plano
 * coloca la máscara en el lugar equivocado y el gate reporta como "fuera de texto" lo
 * que en realidad es texto. Pasó, y por eso este script recorre en profundidad.
 */

import { readFileSync } from 'node:fs';

let src = readFileSync(process.argv[2], 'utf8');
// get_metadata vuelca a archivo cuando la respuesta es grande, y ahi el formato es
// [{type,text}] en vez de XML crudo. Se acepta cualquiera de los dos.
if (src.trimStart().startsWith('[')) {
  src = JSON.parse(src).map((e) => e.text ?? '').join('');
}

/** Tokeniza el XML en aperturas, cierres y self-closing, en orden de documento. */
function* tokens(xml) {
  const re = /<(\/?)([\w-]+)((?:\s+[\w-]+="[^"]*")*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const [, closing, tag, attrStr, selfClose] = m;
    const attrs = Object.fromEntries(
      [...attrStr.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]),
    );
    yield { tag, attrs, kind: closing ? 'close' : selfClose ? 'self' : 'open' };
  }
}

const rects = [];
let root = null;
const stack = []; // offsets acumulados de los ancestros

for (const t of tokens(src)) {
  if (t.kind === 'close') { stack.pop(); continue; }

  const hasGeom = t.attrs.x != null && t.attrs.width != null;
  const px = stack.length ? stack[stack.length - 1] : { x: 0, y: 0 };
  const ax = hasGeom ? px.x + parseFloat(t.attrs.x) : px.x;
  const ay = hasGeom ? px.y + parseFloat(t.attrs.y) : px.y;

  if (!root && hasGeom) {
    // El primer nodo con geometría es la sección: su esquina es el origen.
    root = { id: t.attrs.id, name: t.attrs.name, width: +t.attrs.width, height: +t.attrs.height,
             ox: parseFloat(t.attrs.x), oy: parseFloat(t.attrs.y) };
  } else if (t.tag === 'text' && hasGeom) {
    rects.push({
      id: t.attrs.id,
      name: (t.attrs.name || '').slice(0, 60),
      x: +(ax - root.ox).toFixed(2),
      y: +(ay - root.oy).toFixed(2),
      w: +parseFloat(t.attrs.width).toFixed(2),
      h: +parseFloat(t.attrs.height).toFixed(2),
    });
  }

  if (t.kind === 'open') stack.push({ x: ax, y: ay });
}

if (!root) { console.error('no encuentro el nodo raíz con coordenadas'); process.exit(2); }

process.stdout.write(JSON.stringify({
  root: { id: root.id, name: root.name, width: root.width, height: root.height },
  count: rects.length,
  rects,
}, null, 2) + '\n');
