#!/usr/bin/env node
/**
 * Modo UNIDAD · generador. medidas.json -> responsive-tokens.css
 *
 *   node genera-unidad.mjs [medidas.json] [--out DIR] [--verifica]
 *
 * Es el port generalizado de responsive-scale-gen.js (Cliente A, 2026-09-06). Aquel emitia los
 * selectores escritos a mano —.nav, .h1, .lead, .capsule…— y calculaba a mano las posiciones
 * derivadas del CTA. Aqui el selector sale de `sel` y las posiciones derivadas se resuelven
 * al escribir el JSON, no al generar: el generador no sabe nada del sitio.
 *
 * Regla de fondo: no se piensa en pixeles, se piensa en el porcentaje del ancho del display.
 * Cada medida se toma en el frame de su banda y se emite como calc(px * var(--u)).
 *
 * El CSS NO se escribe a mano y NO se edita a mano: se regenera desde el JSON. Editar el CSS
 * lo desacopla de las medidas y la siguiente generacion lo pisa.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { leeJson } from './lib/json.mjs';
import { declaraciones, raiz, media, factores, completaBanda, esperado, bandaDe } from './lib/unidad.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--out'].includes(args[i - 1])));

const RUTA = resolve(pos[0] ?? 'medidas.json');
if (!existsSync(RUTA)) {
  console.error(
    `\nNo encuentro ${RUTA}.\n` +
    `Copia el esquema y rellenalo con las medidas de los frames:\n\n` +
    `  cp ~/.claude/skills/responsive-webflow/templates/medidas.schema.json medidas.json\n\n` +
    `O generalo desde Figma:  node medidas-desde-figma.mjs\n`
  );
  process.exit(2);
}

const medidas = leeJson(RUTA);
for (const n of Object.keys(medidas.bandas)) medidas.bandas[n] = completaBanda(medidas.bandas[n]);
valida(medidas);

const OUT = resolve(opt('--out', medidas.meta?.salida ?? 'responsive-out'));

function valida(m) {
  const errs = [];
  if (!m.bandas || !Object.keys(m.bandas).length) errs.push('falta `bandas`');
  const bs = Object.entries(m.bandas ?? {}).sort((a, b) => a[1].min - b[1].min);
  for (let i = 1; i < bs.length; i++) {
    if (bs[i][1].min !== bs[i - 1][1].max + 1)
      errs.push(`bandas no contiguas: ${bs[i - 1][0]} acaba en ${bs[i - 1][1].max}, ${bs[i][0]} empieza en ${bs[i][1].min}`);
  }
  for (const [n, b] of bs) {
    if (!b.frame) errs.push(`banda "${n}" sin frame ancla`);
    if (!b.elementos || !Object.keys(b.elementos).length) errs.push(`banda "${n}" sin elementos`);
    for (const [k, el] of Object.entries(b.elementos ?? {})) {
      if (!el.sel && !el.oculto) errs.push(`${n}.${k} sin \`sel\``);
      if (el.f && !['u', 't', 'tb'].includes(el.f)) errs.push(`${n}.${k}: factor "${el.f}" desconocido (u|t|tb)`);
      if (el.oculto != null && el.oculto !== true && el.oculto !== false && el.oculto !== 'heredado')
        errs.push(`${n}.${k}: oculto="${el.oculto}" desconocido (true | "heredado")`);
    }
  }
  // Un elemento que existe en una banda y no en otra tiene que estar declarado oculto,
  // no simplemente ausente: el default silencioso deja la caja de la banda anterior viva.
  const todos = new Set(bs.flatMap(([, b]) => Object.keys(b.elementos ?? {})));
  for (const [n, b] of bs) {
    for (const k of todos) {
      if (!(k in (b.elementos ?? {}))) {
        errs.push(`${n}: "${k}" no esta declarado. Si se apaga en esta banda: {"oculto": true}. ` +
          `Si no se pinta porque su ancestro no se pinta: {"oculto": "heredado"}. ` +
          `Ausente no vale: hereda la caja de la banda anterior sin decirlo.`);
      }
    }
  }
  if (errs.length) {
    console.error('\nmedidas.json invalido:\n' + errs.map((e) => `  · ${e}`).join('\n') + '\n');
    process.exit(2);
  }
}

function banda(nombre) {
  const b = medidas.bandas[nombre];
  const o = [`${media(medidas, nombre)}{`];
  o.push(`/* ===== ${nombre} · frame ${b.frame} · u = 100vw/${b.frame} acotado ` +
    `${b.umin.toFixed(4)}–${b.umax.toFixed(4)} · t = min(u, 1 + (u - 1) * .33) · tb = min(u, 1) ===== */`);
  o.push(raiz(b));
  if (b.css) for (const [sel, decls] of Object.entries(b.css)) o.push(`${sel}{${decls}}`);
  for (const [, el] of Object.entries(b.elementos)) {
    const d = declaraciones(el);
    if (d.length) o.push(`${el.sel}{${d.join(';')}}`);
  }
  o.push('}');
  return o.join('\n');
}

const orden = Object.keys(medidas.bandas).sort((a, b) => medidas.bandas[a].min - medidas.bandas[b].min);

if (flag('--verifica')) {
  // Resuelve cada elemento en los anchos de prueba y lo imprime, sin escribir nada.
  const anchos = medidas.meta?.anchosVerifica ?? [320, 390, 600, 768, 1024, 1200, 1440, 1849, 1920, 2560, 3840];
  console.log(`\nResolucion de ${RUTA} — ${anchos.length} anchos\n`);
  console.log('ancho  banda        u      t      tb     ' + (medidas.meta?.muestra ?? []).join('  '));
  for (const w of anchos) {
    const n = bandaDe(medidas, w);
    const f = factores(w, medidas.bandas[n]);
    const cols = (medidas.meta?.muestra ?? []).map((k) => {
      const el = medidas.bandas[n].elementos[k];
      const e = el ? esperado(el, f) : null;
      return e?.fs != null ? e.fs.toFixed(1).padStart(6) : '     —';
    });
    console.log(
      String(w).padEnd(6) + n.padEnd(13) +
      f.u.toFixed(3).padEnd(7) + f.t.toFixed(3).padEnd(7) + f.tb.toFixed(3).padEnd(7) + cols.join('  ')
    );
  }
  console.log('');
  process.exit(0);
}

const css =
  `/* ${medidas.meta?.cliente ?? 'sitio'} · escala proporcional por regla de tres desde el frame · ` +
  `--u = 100vw / frame, acotada; tipografia de alta resolucion: --t (display) y --tb (lectura/UI) · ` +
  `GENERADO por responsive-webflow desde ${RUTA.split('/').pop()} — no editar a mano */\n` +
  orden.map(banda).join('\n') + '\n';

mkdirSync(OUT, { recursive: true });
const destino = join(OUT, 'responsive-tokens.css');
writeFileSync(destino, css);
console.log(`${destino} · ${css.length} bytes · ${orden.length} bandas`);
console.log(`\nDonde va: Site Settings -> Custom Code -> Head, dentro de <style>.`);
console.log(`NO por whtml_builder: solo acepta <=991, <=767, <=479 y rechaza cualquier otro corte.`);
