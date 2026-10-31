#!/usr/bin/env node
/**
 * Prueba de regresion del motor de modo UNIDAD contra un caso con respuesta conocida.
 *
 * Cliente A construyo su escala el 2026-09-06 con un generador escrito a medida y la verifico en
 * once anchos con cero diferencias. Este skill generaliza ese generador. La pregunta que esta
 * prueba responde es una sola: **¿la generalizacion perdio algo?**
 *
 * NO se compara byte a byte, y no por comodidad: la logica derivada que el generador de Cliente A
 * ejecutaba al escribir (posiciones del CTA, bucles de columnas del footer) es exactamente lo
 * que se quito del motor. Comparar bytes mediria si se conservo un detalle de formato, no si se
 * conservo el CSS. Se compara el CONJUNTO DE DECLARACIONES resuelto por selector y por banda,
 * que es lo que el navegador acaba aplicando.
 *
 *   node regresion-cliente-a.mjs [css-generado] [css-original]
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const GEN = process.argv[2] ?? '/tmp/rw-regresion/responsive-tokens.css';
const ORIG = process.argv[3] ?? new URL("./cliente-a.tokens.css", import.meta.url).pathname;

for (const f of [GEN, ORIG]) if (!existsSync(f)) { console.error(`falta ${f}`); process.exit(2); }

/**
 * @media -> selector -> { prop: valor }. Aplana listas de selectores y funde reglas repetidas.
 *
 * Escanea por llaves, no por lineas: el generador original concatenaba varias reglas en un mismo
 * push, asi que en el CSS de referencia conviven `sel{...}sel{...}` en una sola linea. Un parser
 * por lineas se traga la segunda regla dentro del valor de la ultima propiedad de la primera y
 * reporta 149 diferencias que no existen.
 */
function parse(css) {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bandas = new Map();
  let i = 0, banda = null, buf = '';

  const reglas = () => {
    if (!bandas.has(banda)) bandas.set(banda, new Map());
    return bandas.get(banda);
  };

  while (i < limpio.length) {
    const c = limpio[i];
    if (c === '{') {
      const cabeza = buf.trim();
      buf = '';
      i++;
      if (cabeza.startsWith('@')) { banda = cabeza; continue; }
      // Cuerpo de regla: hasta la llave de cierre (las reglas no anidan aqui).
      let cuerpo = '';
      while (i < limpio.length && limpio[i] !== '}') cuerpo += limpio[i++];
      i++; // cierra
      if (banda == null) banda = '@media all';
      for (const sel of cabeza.split(',').map((s) => s.trim()).filter(Boolean)) {
        const r = reglas();
        if (!r.has(sel)) r.set(sel, new Map());
        const decls = r.get(sel);
        for (const d of cuerpo.split(';')) {
          const j = d.indexOf(':');
          if (j < 0) continue;
          decls.set(d.slice(0, j).trim(), norm(d.slice(j + 1).trim())); // la ultima gana, como en CSS
        }
      }
      continue;
    }
    if (c === '}') { banda = null; buf = ''; i++; continue; }
    buf += c;
    i++;
  }
  return bandas;
}

/** 44 y 44.00 son el mismo numero; 0.8205128 y 0.8205 no lo son y deben diferir. */
const norm = (v) => v
  .replace(/(\d+\.?\d*)px/g, (_, n) => `${+(+n).toFixed(2)}px`)
  .replace(/\s+/g, ' ')
  .trim();

const a = parse(readFileSync(GEN, 'utf8'));
const b = parse(readFileSync(ORIG, 'utf8'));

const fallos = [];
const bandas = new Set([...a.keys(), ...b.keys()]);
let selsOk = 0, declsOk = 0;

for (const banda of bandas) {
  const ra = a.get(banda), rb = b.get(banda);
  if (!ra) { fallos.push(`banda ausente en generado: ${banda}`); continue; }
  if (!rb) { fallos.push(`banda ausente en original: ${banda}`); continue; }
  const sels = new Set([...ra.keys(), ...rb.keys()]);
  for (const sel of sels) {
    const da = ra.get(sel), db = rb.get(sel);
    if (!da) { fallos.push(`${banda} · ${sel}: falta en generado`); continue; }
    if (!db) { fallos.push(`${banda} · ${sel}: sobra en generado`); continue; }
    const props = new Set([...da.keys(), ...db.keys()]);
    let sano = true;
    for (const p of props) {
      const va = da.get(p), vb = db.get(p);
      if (va === vb) { declsOk++; continue; }
      sano = false;
      if (va == null) fallos.push(`${banda} · ${sel} · ${p}: falta en generado (original: ${vb})`);
      else if (vb == null) fallos.push(`${banda} · ${sel} · ${p}: sobra en generado (${va})`);
      else fallos.push(`${banda} · ${sel} · ${p}: ${va}  vs  ${vb}`);
    }
    if (sano) selsOk++;
  }
}

console.log(`\nRegresion modo UNIDAD · generado vs. Cliente A 2026-09-06`);
console.log(`  ${bandas.size} bandas · ${selsOk} selectores identicos · ${declsOk} declaraciones identicas`);
if (fallos.length) {
  console.log(`\n  ${fallos.length} diferencias:\n` + fallos.map((f) => `    · ${f}`).join('\n') + '\n');
  console.log('REGRESION FALLIDA — la generalizacion perdio algo. No seguir.\n');
  process.exit(1);
}
console.log(`\nREGRESION LIMPIA — el motor generico reproduce el CSS escrito a mano.\n`);
