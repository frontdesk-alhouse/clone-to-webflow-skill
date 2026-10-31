#!/usr/bin/env node
/**
 * Fase 0 · Perfil responsivo del sitio, leido del HTML SERVIDO.
 *
 *   node perfil.mjs [url] [--json] [--out DIR]
 *
 * Sin esto el skill adivina el regimen y un default silencioso mide el sitio equivocado con un
 * numero que parece valido. Se lee lo que el navegador recibe —no la API de Webflow, que puede
 * aceptar la escritura y servir otra cosa, ni *.design.webflow.com, que es el shell vacio del
 * Designer.
 *
 * En Webflow el CSS vive en DOS capas y la segunda gana por orden: la hoja nativa del <head> y
 * los <style> de los Embed, que se pintan dentro del <body>. Se cuentan por separado a proposito:
 * un sitio con mas reglas en embeds que en la hoja nativa no se puede auditar desde el Designer.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { esNativo, porApi, NATIVOS_DESIGNER } from './lib/unidad.mjs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

let URL_ = args.find((a) => /^https?:\/\//.test(a));
let cfg = null;
if (!URL_) {
  ({ cargaConfig: cfg } = await import('./lib/config.mjs'));
  const c = cfg();
  URL_ = c.sitio.staging;
}

if (/\.design\.webflow\.com/.test(URL_)) {
  console.error('\n*.design.webflow.com es el shell vacio del Designer. Usa la URL publicada.\n');
  process.exit(2);
}

const trae = async (u) => {
  const r = await fetch(u, { headers: { 'user-agent': 'responsive-webflow/1.0' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} · ${u}`);
  return r.text();
};

const html = await trae(URL_);

// --- las dos capas de CSS -----------------------------------------------------------------
const enlaces = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
  .map((m) => (m[0].match(/href=["']([^"']+)["']/i) ?? [])[1])
  .filter(Boolean)
  .map((h) => new URL(h, URL_).href);

const idxBody = html.search(/<body[\s>]/i);
const estilos = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
const enHead = estilos.filter((m) => m.index < idxBody).map((m) => m[1]).join('\n');
const enBody = estilos.filter((m) => m.index >= idxBody).map((m) => m[1]).join('\n');

let nativa = '';
for (const href of enlaces) {
  if (!/website-files\.com|webflow|\.css$/i.test(href)) continue;
  try { nativa += '\n' + (await trae(href)); } catch (e) { console.error(`  aviso: ${e.message}`); }
}
// Las tres capas se analizan POR SEPARADO y ademas juntas. Sumarlas y reportar un solo numero
// mezcla lo que Webflow trae de fabrica con lo que escribio el proyecto, y hace incomparable la
// medicion: la hoja nativa aporta sus propios vh y sus cortes 991/767/479 aunque el sitio no los
// use. La capa que gobierna de verdad es la del <body>, que gana por orden.
const CAPAS = { nativa, head: enHead, embed: enBody };
const todo = Object.values(CAPAS).join('\n');

const cuentaReglas = (css) => (css.match(/\{/g) ?? []).length;

const cortesDe = (css) => {
  const m = new Map();
  for (const x of css.matchAll(/@media[^{]*?\((min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\)/gi)) {
    const w = Math.round(+x[2]);
    if (!m.has(w)) m.set(w, new Set());
    m.get(w).add(x[1].toLowerCase());
  }
  return [...m.entries()]
    .map(([ancho, t]) => {
      const tipo = [...t].sort().join('+');
      // Un corte con min Y max es nativo si lo es por cualquiera de los dos lados.
      const nativo = [...t].some((x) => esNativo(ancho, x));
      return { ancho, tipo, nativo, porApi: [...t].some((x) => porApi(ancho, x)) };
    })
    .sort((a, b) => a.ancho - b.ancho);
};

// `vh` no debe contar los dvh/svh: se excluye con un lookbehind, o `100dvh` inflaria el numero.
const unidadesDe = (css) => {
  const c = (re) => (css.match(re) ?? []).length;
  return {
    clamp: c(/clamp\s*\(/gi),
    dvh: c(/\d\s*dvh\b/gi), svh: c(/\d\s*svh\b/gi), vh: c(/(?<![ds])\b\d[\d.]*\s*vh\b/gi),
    vw: c(/\d[\d.]*\s*vw\b/gi), pct: c(/:\s*[\d.]+%/g),
    calcVar: c(/calc\([^)]*var\(--/gi),
  };
};

const clasesDe = (css) => new Set([...css.matchAll(/\.([A-Za-z][\w-]*)\s*[,{]/g)].map((m) => m[1]));

const porCapa = Object.fromEntries(Object.entries(CAPAS).map(([n, css]) => [n, {
  bytes: css.length, reglas: cuentaReglas(css), clases: clasesDe(css).size,
  cortes: cortesDe(css), unidades: unidadesDe(css),
}]));

const listaCortes = cortesDe(todo);
const unidades = unidadesDe(todo);
const clasesEmbed = clasesDe(enBody), clasesNativas = clasesDe(nativa);
const soloEmbed = [...clasesEmbed].filter((c) => !clasesNativas.has(c));
porCapa.nativa.hojas = enlaces.length;
porCapa.embed.soloEmbed = soloEmbed.length;

// --- senales de modo ----------------------------------------------------------------------
// Ojo con el limite izquierdo: sin el, `--_escala-v2---u: 1` (una Variable de Webflow, que se
// emite con el grupo por delante) cuenta como un `--u` suelto y el veredicto sale al reves.
// Se aceptan las DOS formas porque las dos son la misma unidad: escrita a mano en un embed, o
// declarada como Variable nativa —que es la unica manera de que el Designer la vea.
const VAR_UNIDAD = /(?<![\w-])--(?:_?[\w-]*?---)?(u|tb|t)\s*:/g;
const hallazgos = [...todo.matchAll(VAR_UNIDAD)];
const tienenUnidad = new Set(hallazgos.map((m) => m[1]));
const nombresUnidad = [...new Set(hallazgos.map((m) => m[0].replace(/\s*:$/, '')))];
const zoomBody = /body[^{]*\{[^}]*\bzoom\s*:/i.test(todo);
const componentes = (html.match(/data-wf-component/g) ?? []).length;

// --- veredicto ----------------------------------------------------------------------------
// Se PROPONE, no se impone. Y se decide sobre la capa que el PROYECTO escribio (head + embed),
// no sobre la hoja nativa, que trae sus propias unidades venga o no al caso.
const propio = unidadesDe(enHead + '\n' + enBody);
let modo, porque;
if (tienenUnidad.has('u') && tienenUnidad.has('t') && tienenUnidad.has('tb')) {
  modo = 'unidad';
  porque = 'declara --u, --t y --tb: la escala va por unidad unica desde el frame';
} else if (tienenUnidad.size) {
  modo = 'mixto';
  porque = `declara ${[...tienenUnidad].map((v) => '--' + v).join(', ')} pero le faltan ` +
    `${['u', 't', 'tb'].filter((v) => !tienenUnidad.has(v)).map((v) => '--' + v).join(', ')}: ` +
    `la unidad esta a medio aplicar, que es peor que no aplicarla — parte del sitio escala y parte no`;
} else if (propio.clamp >= 10) {
  modo = 'nativo';
  porque = `${propio.clamp} usos de clamp() en la capa propia: la escala es fluida por tokens`;
} else if (propio.clamp === 0) {
  modo = 'nativo';
  porque = `cero clamp() en la capa propia: no es un sitio fluido; se sostiene con ` +
    `${propio.pct} porcentajes y overrides por breakpoint`;
} else {
  modo = 'mixto';
  porque = `${propio.clamp} usos de clamp() conviven con overrides por breakpoint`;
}

const perfil = {
  url: URL_, fecha: new Date().toISOString().slice(0, 10),
  modo, porque,
  capas: porCapa,
  cortes: listaCortes,
  unidades,
  unidadesPropias: propio,
  senales: { varsUnidad: [...tienenUnidad], nombresUnidad, zoomBody, componentesWebflow: componentes },
};

if (flag('--json')) { console.log(JSON.stringify(perfil, null, 1)); }
else {
  console.log(`\nPerfil responsivo · ${URL_}\n`);
  console.log(`MODO PROPUESTO: ${modo.toUpperCase()}`);
  console.log(`  ${porque}\n`);
  const fila = (n, c) => `  ${n.padEnd(12)} ${String(c.reglas).padStart(5)} reglas · ${String(c.clases).padStart(4)} clases · ` +
    `clamp ×${String(c.unidades.clamp).padStart(3)} · vh ×${String(c.unidades.vh).padStart(3)} · vw ×${String(c.unidades.vw).padStart(3)} · % ×${c.unidades.pct}`;
  console.log(`Capas de CSS (la del <body> gana por orden):`);
  console.log(fila('hoja nativa', porCapa.nativa) + ` · ${enlaces.length} hoja(s)`);
  console.log(fila('<style> head', porCapa.head));
  console.log(fila('<style> body', porCapa.embed) + ` · ${soloEmbed.length} clases que NO existen en la nativa`);
  if (soloEmbed.length) console.log(`               -> una style guide page solo gobierna la capa nativa: esas ${soloEmbed.length} quedan fuera de su alcance`);
  console.log(`\nCortes, por capa (la nativa trae los suyos aunque el sitio no los use):`);
  for (const [n, c] of Object.entries(porCapa)) {
    if (!c.cortes.length) continue;
    console.log(`  ${n.padEnd(12)} ` + c.cortes.map((x) => `${x.ancho}${x.tipo === 'min' ? '+' : ''}${x.nativo ? '' : '*'}`).join(' · '));
  }
  console.log(`  (* = no es ninguno de los seis breakpoints de Webflow [${NATIVOS_DESIGNER.join(', ')}]: vive en un Embed que el Designer no muestra)`);
  console.log(`\nUnidades de la capa propia (head + embed), que es la comparable:`);
  console.log(`  clamp() ×${propio.clamp} · dvh ×${propio.dvh} · svh ×${propio.svh} · vh ×${propio.vh} · vw ×${propio.vw} · % ×${propio.pct} · calc(var()) ×${propio.calcVar}`);
  console.log(`Senales:   vars de unidad: ${nombresUnidad.join(', ') || 'ninguna'} · ` +
    `zoom en body: ${zoomBody ? 'SI (subpixel: desalinea bordes)' : 'no'} · data-wf-component ×${componentes}`);
  console.log(`\nEl modo se PROPONE. Si choca con lo declarado en el config, para y decide antes de medir.\n`);
}

const OUT = opt('--out', cfg ? (await import('./lib/config.mjs')).cargaConfig().salida ?? 'responsive-out' : null);
if (OUT) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'perfil-responsivo.json'), JSON.stringify(perfil, null, 1) + '\n');
  if (!flag('--json')) console.log(`escrito ${join(OUT, 'perfil-responsivo.json')}\n`);
}
