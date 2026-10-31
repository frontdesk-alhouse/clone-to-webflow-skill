#!/usr/bin/env node
/**
 * Gate · los cortes del CSS, uno por uno, y quien vive en cada uno.
 *
 *   node conmutadores.mjs [url] [--json]
 *
 * Es el gemelo estatico de gate-banda: aquel busca en el navegador donde conmuta cada pieza;
 * este lee el CSS servido y dice que cortes existen, en que capa viven y que gobiernan.
 *
 * Dos cosas que solo se ven aqui:
 *   · whtml_builder solo acepta <=991, <=767 y <=479. Un corte propio (768, 1199, 1440…) NO se
 *     puede escribir por ahi: vive obligatoriamente en un Embed o en el Head, que es la capa que
 *     gana por orden y la que el Designer no muestra.
 *   · un corte que gobierna DOS reglas es casi siempre un override suelto que alguien dejo, y es
 *     donde se rompe la coherencia entre bandas.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cargaConfig } from './lib/config.mjs';
import { esNativo, porApi, NATIVOS_DESIGNER } from './lib/unidad.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const cfg = cargaConfig();
const URL_ = args.find((a) => /^https?:\/\//.test(a)) ?? cfg.sitio.staging;
// Por PAGINA, no solo la home: /product tiene su propio hero por banda y sus cortes viven en el embed
// de esa pagina. Leer solo la home los dejaba fuera, y el barrido de esa pagina los reportaba como
// "sin declarar". Si se pasa una URL explicita se lee solo esa.
const PAGINAS = args.some((a) => /^https?:\/\//.test(a)) ? [''] : (cfg.sitio.paginas ?? ['']);

const trae = async (u) => {
  const r = await fetch(u, { headers: { 'user-agent': 'responsive-webflow/1.0' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} · ${u}`);
  return r.text();
};

const base = URL_.replace(/\/$/, '');
const hojasVistas = new Set();
const capasPorPagina = [];
for (const pag of PAGINAS) {
  // `rutas` mapea la pagina a su ruta real (p. ej. "" -> "home-v2" mientras la portada nueva vive en otra ruta):
  // sin esto se leian los cortes de la pagina equivocada y el barrido los daba por «sin declarar».
  const rutaPag = cfg.rutas?.[pag] ?? pag;
  const urlPag = base + '/' + rutaPag.replace(/^\//, '');
  let html;
  try { html = await trae(urlPag); } catch (e) { console.error(`  aviso: ${e.message}`); continue; }
  const idxBody = html.search(/<body[\s>]/i);
  const bloques = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  const capas = {
    head: bloques.filter((m) => m.index < idxBody).map((m) => m[1]).join('\n'),
    embed: bloques.filter((m) => m.index >= idxBody).map((m) => m[1]).join('\n'),
    nativa: '',
  };
  for (const m of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)) {
    const href = (m[0].match(/href=["']([^"']+)["']/i) ?? [])[1];
    if (!href || !/website-files\.com|webflow|\.css$/i.test(href)) continue;
    const abs = new URL(href, urlPag).href;
    if (hojasVistas.has(abs)) continue;   // la hoja nativa es compartida: se lee una vez
    hojasVistas.add(abs);
    try { capas.nativa += '\n' + (await trae(abs)); } catch (e) { console.error(`  aviso: ${e.message}`); }
  }
  capasPorPagina.push({ pag: pag || 'home', capas });
}

/** Cada @media con su ancho, su tipo y los selectores de primer nivel que contiene. */
function bloquesMedia(css, capa, pag) {
  const out = [];
  const re = /@media([^{]*)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const cond = m[1].trim();
    let i = re.lastIndex, prof = 1, cuerpo = '';
    while (i < css.length && prof > 0) {
      const c = css[i];
      if (c === '{') prof++;
      else if (c === '}') { prof--; if (!prof) break; }
      cuerpo += c; i++;
    }
    re.lastIndex = i;
    const anchos = [...cond.matchAll(/\((min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\)/gi)]
      .map((x) => ({ tipo: x[1].toLowerCase(), ancho: Math.round(+x[2]) }));
    const sels = [...cuerpo.matchAll(/(^|[};])\s*([^{};@]+?)\s*\{/g)].map((x) => x[2].trim()).filter(Boolean);
    out.push({ capa, pag, cond, anchos, reglas: sels.length, selectores: sels });
  }
  return out;
}

const todos = capasPorPagina.flatMap(({ pag, capas }) => Object.entries(capas).flatMap(([n, css]) => bloquesMedia(css, n, pag)));


const DECLARADOS = cfg.conmutadores?.declarados ?? [];
// Un `max-width: 1199` declarado cubre tambien el `min-width: 1200`: es el mismo limite desde el otro
// lado. Se compara normalizando al lado "min" (max N -> N+1).
const limite = (ancho, tipo) => (tipo === 'max' ? ancho + 1 : ancho);
const estaDeclarado = (ancho, tipo) => DECLARADOS.some((d) => limite(d, 'max') === limite(ancho, tipo) || d === limite(ancho, tipo) || d === ancho);
const marcadores = Object.entries(cfg.selectores ?? {})
  .filter(([k, v]) => typeof v === 'string' && v && !['centrado'].includes(k))
  .map(([k, v]) => ({ rol: k, sel: v, clase: v.replace(/^[.#]/, '') }));

const porCorte = new Map();
for (const b of todos) {
  for (const a of b.anchos) {
    const clave = `${a.ancho}|${a.tipo}`;
    if (!porCorte.has(clave)) porCorte.set(clave, { ancho: a.ancho, tipo: a.tipo, capas: new Set(), paginas: new Set(), reglas: 0, marcadores: new Set() });
    const e = porCorte.get(clave);
    e.capas.add(b.capa);
    e.paginas.add(b.pag);
    e.reglas += b.reglas;
    for (const mk of marcadores) if (b.selectores.some((s) => s.includes(mk.clase))) e.marcadores.add(mk.rol);
  }
}
const cortes = [...porCorte.values()]
  .map((c) => ({ ...c, capas: [...c.capas], paginas: [...c.paginas], marcadores: [...c.marcadores],
    nativo: esNativo(c.ancho, c.tipo),
    porApi: porApi(c.ancho, c.tipo) }))
  .sort((a, b) => a.ancho - b.ancho || a.tipo.localeCompare(b.tipo));

const fallos = [];
for (const c of cortes) {
  const detalle = `${c.reglas} regla(s) en la capa ${c.capas.join('+')}` +
    (c.marcadores.length ? ` · gobierna ${c.marcadores.join(', ')}` : '');

  if (!c.nativo && !estaDeclarado(c.ancho, c.tipo)) {
    fallos.push({
      nivel: 'HIGH',
      que: `corte propio en ${c.ancho}px (${c.tipo}-width) sin declarar`,
      detalle,
      porque: `no es ninguno de los seis breakpoints de Webflow (${NATIVOS_DESIGNER.join(', ')}), ` +
        `asi que vive en un Embed y el Designer no lo muestra. Si es a proposito, anadelo a ` +
        `conmutadores.declarados en ${cfg.__path}`,
    });
    continue;
  }
  if (c.nativo && !c.porApi && c.capas.includes('embed')) {
    fallos.push({
      nivel: 'MEDIUM',
      que: `corte nativo ${c.ancho}px escrito en un Embed`,
      detalle,
      porque: 'es un breakpoint del Designer, pero data_whtml_builder solo escribe 991/767/479: ' +
        'lo que hay aqui se escribio a mano y no se puede mantener por API',
    });
    continue;
  }
  if (c.reglas <= 2) {
    fallos.push({
      nivel: 'MEDIUM', que: `corte en ${c.ancho}px (${c.tipo}) con solo ${c.reglas} regla(s)`,
      detalle,
      porque: 'un corte que gobierna una o dos reglas suele ser un override suelto, no una banda',
    });
  }
}

const informe = { url: URL_, paginas: PAGINAS.map((p) => p || 'home'), fecha: new Date().toISOString().slice(0, 10), cortes, fallos };
if (flag('--json')) console.log(JSON.stringify(informe, null, 1));
else {
  console.log(`\nGate · conmutadores del CSS servido · ${URL_} · ${PAGINAS.length} pagina(s)\n`);
  const corta = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s).padEnd(n);
  console.log('ancho  tipo  capa               reglas  paginas  gobierna                estado');
  for (const c of cortes) {
    console.log(
      String(c.ancho).padEnd(7) + c.tipo.padEnd(6) + corta(c.capas.join('+'), 19) +
      String(c.reglas).padStart(6) + '  ' + String(c.paginas.length).padEnd(9) + corta(c.marcadores.join(', ') || '—', 24) +
      (c.nativo ? (c.porApi ? 'nativo' : 'nativo (no por API)')
        : estaDeclarado(c.ancho, c.tipo) ? 'propio, declarado' : 'PROPIO sin declarar')
    );
  }
  if (fallos.length) {
    console.log('');
    for (const f of fallos) console.log(`  [${f.nivel}] ${f.que}\n           ${f.detalle}\n           -> ${f.porque}`);
  }
  console.log(fallos.length ? `\n${fallos.length} hallazgo(s).\n` : `\nSIN HALLAZGOS.\n`);
}
if (cfg.salida) {
  mkdirSync(cfg.salida, { recursive: true });
  writeFileSync(join(cfg.salida, 'conmutadores.json'), JSON.stringify(informe, null, 1) + '\n');
}
process.exit(fallos.some((f) => f.nivel === 'CRITICAL' || f.nivel === 'HIGH') ? 1 : 0);
