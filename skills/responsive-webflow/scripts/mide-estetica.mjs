#!/usr/bin/env node
/**
 * Fase 2 · La mitad que ningun gate cubre: no "se rompe", sino "se ve bien entre anchos".
 *
 *   node mide-estetica.mjs [url] [--json]
 *
 * Los gates dicen que no hay desborde. No dicen que a 1920 el parrafo tenga 140 caracteres por
 * linea, ni que el H1 haya dejado de mandar sobre el cuerpo, ni que el aire entre secciones sea
 * un hueco a 390 y una apretura a 1920. Eso son juicios esteticos, y cada uno de los cuatro que
 * mide este script tiene un numero detras para que no sea opinion.
 *
 *   1 · Coherencia de razones — la razon H1/cuerpo y margen/contenido se conserva entre bandas.
 *       Que movil use 34 donde escritorio usa 64 no es un desajuste; que la RAZON cambie, si.
 *   2 · Medida — caracteres por linea del texto de lectura. 45-75 es el rango; >100 es ilegible.
 *   3 · Techo tipografico — el texto de lectura no crece por encima del frame ancla.
 *   4 · Ritmo vertical — el aire entre secciones, medido como % del ancho. Un valor literalmente
 *       constante entre bandas es un hueco abajo y una apretura arriba.
 *
 * Los cuatro se miden; ninguno se sentencia solo. El council (Fase 2) los lee junto a las
 * capturas y decide. Un numero fuera de rango puede estar bien; lo que no puede es no saberse.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium as cargaChromium, ARGS } from './lib/pw.mjs';
import { cargaConfig, url as urlDe, frameDe, bandaDe } from './lib/config.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const cfg = cargaConfig();
const URL_ = args.find((a) => /^(https?|file):\/\//.test(a)) ?? urlDe(cfg, cfg.sitio.paginas[0]);
const E = cfg.estetica ?? {};
const CPL_MIN = E.medidaMin ?? 45, CPL_MAX = E.medidaMax ?? 75, CPL_TOPE = E.medidaTope ?? 100;
const TOL_RAZON = E.toleranciaRazon ?? 0.15;

// Un ancho por banda (su frame) mas el tope real del sitio, que es donde se ve si algo crece sin
// freno. Medir solo en los frames esconde exactamente el fallo que se busca.
const bandas = Object.entries(cfg.bandas).sort((a, b) => a[1].min - b[1].min);
const TOPE = Math.max(...bandas.map(([, b]) => b.max));
const ANCHOS = [...new Set([...bandas.map(([n]) => frameDe(cfg, n)), TOPE, 2560])].sort((a, b) => a - b);

/** Recolecta en el DOM lo que hace falta para los cuatro criterios. */
const recoge = () => {
  const num = (v) => parseFloat(v) || 0;
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // --- bloques de texto de lectura: hojas con texto largo, sin hijos que aporten texto ---
  const bloques = [];
  for (const el of document.querySelectorAll('p, li, div, span, blockquote, dd')) {
    if (!vis(el)) continue;
    const propio = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    const total = (el.textContent ?? '').trim();
    if (total.length < 120) continue;
    if (propio.length < total.length * 0.8) continue;   // el texto lo aporta un hijo, no este
    const cs = getComputedStyle(el);
    const fs = num(cs.fontSize);
    const lh = num(cs.lineHeight) || fs * 1.4;
    const r = el.getBoundingClientRect();
    const lineas = Math.max(1, Math.round(r.height / lh));
    bloques.push({
      cpl: +(total.length / lineas).toFixed(1), chars: total.length, lineas,
      fs: +fs.toFixed(1), ancho: +r.width.toFixed(0),
      texto: total.slice(0, 48).replace(/\s+/g, ' '),
      sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''),
    });
  }

  // --- jerarquia: el titulo mas grande visible y el cuerpo dominante ---
  let h1 = 0, h1sel = null;
  for (const el of document.querySelectorAll('h1, h2, [class*=h1], [class*=title], [class*=heading]')) {
    if (!vis(el)) continue;
    const fs = num(getComputedStyle(el).fontSize);
    if (fs > h1) { h1 = fs; h1sel = el.tagName.toLowerCase(); }
  }
  const frec = new Map();
  for (const b of bloques) frec.set(b.fs, (frec.get(b.fs) ?? 0) + b.chars);
  const cuerpo = [...frec.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;

  // --- contenedor y margen de pagina: el bloque visible mas ancho que no llega al borde ---
  const vw = document.documentElement.clientWidth;
  let contenedor = 0;
  for (const el of document.querySelectorAll('main, section, div, header, footer')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > contenedor && r.width < vw - 1 && r.height > 80) contenedor = r.width;
  }

  // --- ritmo vertical: padding de las secciones de primer nivel ---
  const secciones = [];
  for (const el of document.querySelectorAll('body > section, body > div > section, main > section, body > main > section')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    secciones.push({ pt: num(cs.paddingTop), pb: num(cs.paddingBottom), h: +el.getBoundingClientRect().height.toFixed(0) });
  }

  return { vw, bloques, h1, h1sel, cuerpo, contenedor: +contenedor.toFixed(0), secciones };
};

const chromium = await cargaChromium();
const nav = await chromium.launch({ args: ARGS });
const pg = await nav.newPage({ viewport: { width: ANCHOS[ANCHOS.length - 1], height: 1000 }, deviceScaleFactor: 1 });
await pg.goto(URL_, { waitUntil: 'load' });
await pg.evaluate(() => document.fonts?.ready);

const porAncho = {};
for (const w of ANCHOS) {
  await pg.setViewportSize({ width: w, height: 1000 });
  await pg.waitForTimeout(250);
  porAncho[w] = await pg.evaluate(recoge);
}
await nav.close();

const hallazgos = [];
const push = (nivel, criterio, que, porque) => hallazgos.push({ nivel, criterio, que, porque });

// --- 1 · Coherencia de razones --------------------------------------------------------------
const razones = {};
for (const [n, b] of bandas) {
  const w = frameDe(cfg, n), d = porAncho[w];
  if (!d) continue;
  razones[n] = {
    ancho: w,
    jerarquia: d.cuerpo ? +(d.h1 / d.cuerpo).toFixed(2) : null,
    contenido: d.vw ? +(d.contenedor / d.vw).toFixed(3) : null,
    h1: d.h1, cuerpo: d.cuerpo, contenedor: d.contenedor,
  };
}
for (const clave of ['jerarquia', 'contenido']) {
  const vals = Object.entries(razones).map(([n, r]) => [n, r[clave]]).filter(([, v]) => v != null);
  if (vals.length < 2) continue;
  const nums = vals.map(([, v]) => v);
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const deriva = (hi - lo) / hi;
  if (deriva > TOL_RAZON) {
    push('MEDIUM', 'coherencia',
      `la razon "${clave}" cambia ${(deriva * 100).toFixed(0)}% entre bandas: ` +
      vals.map(([n, v]) => `${n} ${v}`).join(' · '),
      clave === 'jerarquia'
        ? 'si el H1 manda cuatro veces sobre el cuerpo en escritorio y dos en movil, no es el mismo sistema: es otro diseno'
        : 'el contenido ocupa una fraccion distinta del ancho en cada banda, asi que el aire lateral no se lee igual');
  }
}

// --- 2 · Medida (caracteres por linea) ------------------------------------------------------
const medida = {};
for (const w of ANCHOS) {
  const bs = porAncho[w]?.bloques ?? [];
  if (!bs.length) continue;
  const cpls = bs.map((b) => b.cpl).sort((a, b) => a - b);
  const p50 = cpls[Math.floor(cpls.length / 2)];
  const peor = bs.reduce((a, b) => (b.cpl > a.cpl ? b : a));
  medida[w] = { bloques: bs.length, mediana: p50, peor };
  if (peor.cpl > CPL_TOPE) {
    push('HIGH', 'medida', `${peor.cpl} caracteres por linea a ${w}px  (${peor.sel}: "${peor.texto}…")`,
      `por encima de ${CPL_TOPE} el ojo pierde el renglon al saltar: el texto crecio con el contenedor en vez de topar`);
  } else if (p50 > CPL_MAX) {
    push('MEDIUM', 'medida', `mediana ${p50} caracteres por linea a ${w}px`,
      `el rango comodo es ${CPL_MIN}-${CPL_MAX}; por encima cansa aunque no se rompa nada`);
  } else if (p50 < CPL_MIN && w >= 768) {
    push('MEDIUM', 'medida', `mediana ${p50} caracteres por linea a ${w}px`,
      `por debajo de ${CPL_MIN} la columna es tan estrecha que el texto se pica en trozos`);
  }
}

// --- 3 · Techo tipografico ------------------------------------------------------------------
const techo = {};
for (const [n, b] of bandas) {
  const frame = frameDe(cfg, n);
  const arriba = ANCHOS.filter((w) => w > frame && bandaDe(cfg, w) === n);
  if (!arriba.length || !porAncho[frame]?.cuerpo) continue;
  const base = porAncho[frame].cuerpo;
  for (const w of arriba) {
    const ahora = porAncho[w]?.cuerpo;
    if (!ahora) continue;
    techo[`${n}@${w}`] = { base, ahora, crece: +(ahora / base).toFixed(3) };
    if (ahora > base + 0.5) {
      push('HIGH', 'techo',
        `el cuerpo crece de ${base}px en ${frame} a ${ahora}px en ${w}`,
        'el texto de lectura y de UI no debe crecer por encima del frame ancla: el layout escala, la fuente no. ' +
        'Es la regla --tb, medida contra sitios que la aplican (Apollo mantiene el cuerpo en 18 de 1280 a 3840)');
    }
  }
}

// --- 4 · Ritmo vertical ---------------------------------------------------------------------
const ritmo = {};
for (const [n] of bandas) {
  const w = frameDe(cfg, n), d = porAncho[w];
  if (!d?.secciones?.length) continue;
  const pads = d.secciones.flatMap((s) => [s.pt, s.pb]).filter((v) => v > 0);
  if (!pads.length) continue;
  const med = pads.sort((a, b) => a - b)[Math.floor(pads.length / 2)];
  ritmo[n] = { ancho: w, padMediano: med, pctDelAncho: +((med / w) * 100).toFixed(2) };
}
const pcts = Object.values(ritmo).map((r) => r.pctDelAncho);
const pads = Object.values(ritmo).map((r) => r.padMediano);
if (pads.length >= 2 && new Set(pads).size === 1) {
  push('MEDIUM', 'ritmo', `el aire entre secciones es literalmente ${pads[0]}px en todas las bandas`,
    `en ${Math.min(...Object.values(ritmo).map((r) => r.ancho))} eso es ${Math.max(...pcts)}% del ancho y en ` +
    `${Math.max(...Object.values(ritmo).map((r) => r.ancho))} es ${Math.min(...pcts)}%: el mismo numero se lee como ` +
    `un hueco abajo y como una apretura arriba`);
}

// Un criterio que no se pudo medir se DICE. Omitirlo en silencio es el fallo exacto contra el que
// existe este skill: un informe sin la fila parece un informe con todo en verde.
const sinMedir = [];
for (const [n] of bandas) {
  if (!razones[n]) sinMedir.push({ criterio: 'coherencia', banda: n, porque: 'no se pinta nada medible en el frame de esta banda' });
  if (!ritmo[n]) sinMedir.push({ criterio: 'ritmo', banda: n, porque: 'ninguna seccion de primer nivel con padding a este ancho (¿la banda usa otro juego de secciones?)' });
}
if (!Object.keys(techo).length) sinMedir.push({ criterio: 'techo', banda: '—', porque: 'ninguna banda tiene anchos por encima de su frame en la lista medida' });
for (const s of sinMedir) push('INFO', s.criterio, `sin medir en ${s.banda}`, s.porque);

const informe = { url: URL_, fecha: new Date().toISOString().slice(0, 10), anchos: ANCHOS, razones, medida, techo, ritmo, sinMedir, hallazgos };

if (flag('--json')) console.log(JSON.stringify(informe, null, 1));
else {
  console.log(`\nRubrica responsiva · ${URL_}\n`);
  console.log('1 · Coherencia de razones');
  console.log('  banda        ancho   H1     cuerpo  H1/cuerpo  contenido/ventana');
  for (const [n, r] of Object.entries(razones)) {
    console.log(`  ${n.padEnd(13)}${String(r.ancho).padEnd(8)}${String(r.h1).padEnd(7)}${String(r.cuerpo).padEnd(8)}` +
      `${String(r.jerarquia ?? '—').padEnd(11)}${r.contenido ?? '—'}`);
  }
  console.log('\n2 · Medida (caracteres por linea)');
  console.log('  ancho   bloques  mediana  peor');
  for (const [w, m] of Object.entries(medida)) {
    console.log(`  ${w.padEnd(8)}${String(m.bloques).padEnd(9)}${String(m.mediana).padEnd(9)}${m.peor.cpl}  ${m.peor.sel}`);
  }
  if (Object.keys(techo).length) {
    console.log('\n3 · Techo tipografico (cuerpo por encima del frame de su banda)');
    for (const [k, t] of Object.entries(techo)) console.log(`  ${k.padEnd(20)}${t.base} -> ${t.ahora}  (x${t.crece})`);
  }
  if (Object.keys(ritmo).length) {
    console.log('\n4 · Ritmo vertical (padding mediano de seccion)');
    console.log('  banda        ancho   padding  % del ancho');
    for (const [n, r] of Object.entries(ritmo)) {
      console.log(`  ${n.padEnd(13)}${String(r.ancho).padEnd(8)}${String(r.padMediano).padEnd(9)}${r.pctDelAncho}%`);
    }
  }
  if (hallazgos.length) {
    console.log('');
    for (const h of hallazgos) console.log(`  [${h.nivel}] ${h.criterio} · ${h.que}\n           -> ${h.porque}`);
  }
  console.log(hallazgos.length
    ? `\n${hallazgos.length} hallazgo(s). Ninguno sentencia solo: los lee el council junto a las capturas.\n`
    : `\nLos cuatro criterios en rango.\n`);
}
if (cfg.salida) {
  mkdirSync(cfg.salida, { recursive: true });
  writeFileSync(join(cfg.salida, 'estetica.json'), JSON.stringify(informe, null, 1) + '\n');
}
process.exit(hallazgos.some((h) => h.nivel === 'CRITICAL') ? 1 : 0);
