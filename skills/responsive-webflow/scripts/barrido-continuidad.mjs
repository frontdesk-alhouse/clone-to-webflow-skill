#!/usr/bin/env node
/**
 * Barrido de continuidad. Resuelve el caso que ninguna lista de anchos puede: la ventana de un Mac,
 * a cualquier ancho.
 *
 *   node barrido-continuidad.mjs [url] [--paso 40] [--min 320] [--max 2560] [--json]
 *
 * Windows maximizado cae en pocos anchos discretos: es un problema de muestreo y una lista lo
 * cubre. Mac en ventana cae en un CONTINUO: es un problema de continuidad y ninguna lista lo cubre,
 * por larga que sea. Anadir muestras a un continuo sigue siendo muestrear. Esto no muestrea: recorre
 * y exige que entre dos pasos contiguos nada salte.
 *
 * Lo que mide por paso es una HUELLA barata, no "el contenedor": en un sitio real no hay un selector
 * valido en todas las bandas (.vt-nav no existe bajo 768). La huella: el ancho del mas ancho de un
 * conjunto FIJO de elementos seguidos, el alto del documento y el numero de elementos visibles.
 *
 * Por que un conjunto fijo: la primera version elegia en cada paso "el bloque visible mas ancho que
 * no llega al borde", y ese heuristico cambia de elemento entre pasos —a 340 elige uno, a 360 otro—
 * y fabrica fronteras que no existen (salio con 9 falsas en Cliente A). Aqui los elementos se eligen
 * UNA vez (los mas anchos en el extremo bajo y en el alto, para cubrir movil y escritorio), se marcan
 * con un atributo, y se siguen por identidad. Si `selectores.centrado` declara piezas, se siguen
 * tambien y se reportan por separado.
 *
 * La estadistica, y por que no es "3 x mediana" (que fue la primera version y fallaba en las dos
 * direcciones con datos reales):
 *   1. SEGMENTAR antes de juzgar. La serie se corta donde cambia de regimen (se mueve / no se
 *      mueve, tolerancia 4 px). Si se mezcla un tramo fluido con uno congelado en la misma banda,
 *      la mediana de los saltos es 0 y todo paso fluido parece un fallo.
 *   2. Dentro de un tramo, RESIDUO, no cociente: r_i = D_i - mediana(D). Falla si
 *      |r_i| > max(TOL_ABS, 3 * MAD). Un cociente "salto / mediana" es proporcional al paso, asi que
 *      un paso mas grueso te vuelve mas ciego, al reves de lo que quieres. El residuo caza un salto de
 *      32 px con paso 40; el cociente no veia nada por debajo de 80.
 *   3. Cada frontera entre tramos se BISECA hasta el pixel y se contrasta con los cortes reales del
 *      CSS (conmutadores.json). Frontera con corte declarado = limite de banda, correcto. Frontera
 *      sin corte = DISCONTINUIDAD.
 *   4. Un tramo con menos de 4 saltos no tiene estadistica: se vuelve a barrer a la mitad del paso,
 *      hasta 8 px.
 *
 * Lo que NO mide: desborde. El desborde en reposo miente (0 parado, 54 recorriendo). Se anota
 * scrollWidth como dato, pero la autoridad sigue siendo gate-desborde.mjs, que recorre.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium as cargaChromium, ARGS } from './lib/pw.mjs';
import { cargaConfig, url as urlDe } from './lib/config.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? +args[i + 1] : d; };
const cfg = cargaConfig();
const URL_ = args.find((a) => /^(https?|file):\/\//.test(a)) ?? urlDe(cfg, cfg.sitio.paginas[0]);
const PASO0 = opt('--paso', 40);
const MIN = opt('--min', Math.min(...Object.values(cfg.bandas).map((b) => b.min)) || 320);
const MAX = opt('--max', Math.max(...Object.values(cfg.bandas).map((b) => b.max), 2560));
const TOL_ABS = cfg.gates?.toleranciaBanda ?? 4;
const MIN_SALTOS = 4;
const PASO_MIN = 8;
const OUT = cfg.salida ?? 'responsive-out';

// Cortes reales del CSS, si conmutadores.mjs ya corrio. Sin ellos toda frontera es sospechosa.
const cortesDeclarados = (() => {
  const f = join(OUT, 'conmutadores.json');
  if (!existsSync(f)) return null;
  const d = JSON.parse(readFileSync(f, 'utf8'));
  // Un max-width:767 y un min-width:768 son el mismo limite. Se normaliza al lado "min".
  return [...new Set(d.cortes.map((c) => (c.tipo === 'max' ? c.ancho + 1 : c.ancho)))].sort((a, b) => a - b);
})();
if (!cortesDeclarados) console.error(`  AVISO: no hay ${join(OUT, 'conmutadores.json')}. Corre conmutadores.mjs antes: sin cortes declarados, toda frontera saldra como discontinuidad.`);

const chromium = await cargaChromium();
const nav = await chromium.launch({ args: ARGS });
const pg = await nav.newPage({ viewport: { width: MAX, height: 1000 }, deviceScaleFactor: 1 });
await pg.emulateMedia({ reducedMotion: 'reduce' });
await pg.goto(URL_, { waitUntil: 'load' });
await pg.evaluate(() => document.fonts?.ready);
await pg.waitForTimeout(600);

/**
 * Marca, a un ancho dado, los N bloques visibles mas anchos que no llegan al borde. Se llama en los
 * dos extremos del rango para tener candidatos de movil y de escritorio. El atributo sobrevive a
 * los cambios de viewport: es la identidad que el heuristico solo no tiene.
 */
async function marca(w, n = 5) {
  await pg.setViewportSize({ width: w, height: 1000 });
  await pg.waitForTimeout(150);
  return pg.evaluate((n) => {
    const vw = document.documentElement.clientWidth;
    const cands = [];
    // Se siguen BLOQUES DE TEXTO, no cajas: una seccion a todo el ancho mide igual que el viewport y
    // esconde el contenedor de contenido (en tablet, la seccion da 800 → 960 y el h1 da 688 → 688).
    // El texto nunca va a sangre, asi que su ancho es la medida del contenido sin ambiguedad.
    for (const el of document.querySelectorAll('h1, h2, h3, p, li, blockquote')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.width < vw - 1 && r.width > vw * 0.25 && (el.textContent ?? '').trim().length > 20) cands.push({ el, w: r.width });
    }
    cands.sort((a, b) => b.w - a.w);
    let k = document.querySelectorAll('[data-rw-track]').length;
    const nuevos = [];
    for (const c of cands.slice(0, n)) {
      if (c.el.hasAttribute('data-rw-track')) continue;
      c.el.setAttribute('data-rw-track', String(k++));
      nuevos.push(c.el.tagName.toLowerCase() + (c.el.className && typeof c.el.className === 'string' ? '.' + c.el.className.trim().split(/\s+/)[0] : ''));
    }
    return nuevos;
  }, n);
}

const PIEZAS = Object.entries(cfg.selectores?.centrado ?? {}).filter(([, v]) => typeof v === 'string' && v);

/** La huella a un ancho. Una sola pagina, redimensionada: 57 anchos en ~20 s. */
async function huella(w) {
  await pg.setViewportSize({ width: w, height: 1000 });
  await pg.waitForTimeout(110);
  return pg.evaluate((piezas) => {
    const de = document.documentElement, vw = de.clientWidth;
    let visibles = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) visibles++;
    }
    // El contenedor: el mas ancho de los elementos SEGUIDOS que este visible ahora.
    let cont = 0, quien = null;
    for (const el of document.querySelectorAll('[data-rw-track]')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      // Sin excluir el ancho completo: un contenedor min(100%, tope) mide igual que el viewport en su
      // banda fluida, y excluirlo dejaba el tramo 1200-1440 en "0 → 0". La exclusion era para ELEGIR
      // candidatos, no para medir los ya elegidos.
      if (r.width > cont && r.height > 0) { cont = r.width; quien = el.getAttribute('data-rw-track'); }
    }
    const pz = {};
    for (const [k, sel] of piezas) {
      const el = document.querySelector(sel);
      if (!el) { pz[k] = null; continue; }
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      pz[k] = cs.display === 'none' || r.width <= 0 ? null : +r.width.toFixed(1);
    }
    return { vw, cont: +cont.toFixed(1), quien, alto: Math.round(de.scrollHeight), visibles, scrollWidth: de.scrollWidth, piezas: pz };
  }, PIEZAS);
}

const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mad = (xs) => { const m = mediana(xs); return mediana(xs.map((x) => Math.abs(x - m))); };

/** Barre [a, b] con un paso. Devuelve las muestras. */
async function barre(a, b, paso) {
  const out = [];
  for (let w = a; w <= b; w += paso) out.push({ w, ...(await huella(w)) });
  if (out[out.length - 1].w !== b) out.push({ w: b, ...(await huella(b)) });
  return out;
}

/**
 * Segmenta por regimen del contenedor: "se mueve" (|D| > TOL) o "quieto". Devuelve tramos con sus
 * muestras. Un cambio de regimen entre dos muestras contiguas es una frontera candidata.
 */
function segmenta(muestras) {
  const tramos = [];
  let actual = null;
  for (let i = 1; i < muestras.length; i++) {
    const a = muestras[i - 1], b = muestras[i];
    const d = b.cont - a.cont;
    // Un paso que CRUZA un corte declarado no es parte de ningun tramo: es la frontera. Si se deja
    // dentro, su salto (ni la pendiente del tramo ni 0) forma un tramo de una sola muestra y la
    // biseccion posterior busca un cambio entre dos anchos donde no cambia nada.
    if (cortesDeclarados?.some((c) => c > a.w && c <= b.w)) { actual = null; continue; }
    const mueve = Math.abs(d) > TOL_ABS;
    if (!actual || actual.mueve !== mueve) {
      actual = { mueve, desde: muestras[i - 1].w, hasta: muestras[i].w, saltos: [d], muestras: [muestras[i - 1], muestras[i]] };
      tramos.push(actual);
    } else {
      actual.hasta = muestras[i].w;
      actual.saltos.push(d);
      actual.muestras.push(muestras[i]);
    }
  }
  return tramos;
}

/** Biseca entre dos anchos contiguos donde la huella cambio de regimen: devuelve el primer ancho del lado nuevo. */
async function bisecaFrontera(lo, hi, refLo, pendiente = 0) {
  // Solo sobre `cont`, y descontando la pendiente del tramo anterior: en un tramo fluido de
  // pendiente 1, a mitad de camino el valor esperado ya subio (mid - lo) px y eso no es un cambio.
  const cerca = (h) => Math.abs(h.cont - (refLo.cont + pendiente * (h.vw - refLo.vw))) <= TOL_ABS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cerca(await huella(mid))) lo = mid; else hi = mid;
  }
  return hi;
}

// --- elegir a quien seguir: en los extremos y en tres puntos intermedios, para que las bandas
//     que solo existen en medio (tablet) tambien tengan sus bloques ----------------------------
const seguidos = [];
for (const w of [MAX, MIN, Math.round((MIN + MAX) / 2), Math.round(MIN + (MAX - MIN) * 0.25), Math.round(MIN + (MAX - MIN) * 0.75)]) {
  seguidos.push(...await marca(w, 4));
}

// --- barrido grueso + refinado --------------------------------------------------------------
let muestras = await barre(MIN, MAX, PASO0);
let tramos = segmenta(muestras);

// Refinar TODO tramo con menos de MIN_SALTOS saltos, se mueva o no, a la mitad del paso hasta PASO_MIN.
// Los quietos cortos tambien: un brinco negativo igual a la pendiente por el paso anula el
// crecimiento y da D = 0 en un solo paso —parece una meseta y es una discontinuidad de 32 px que
// a paso 40 no se ve y a paso 20 si (+16 y luego -16).
for (let paso = PASO0 / 2; paso >= PASO_MIN; paso /= 2) {
  const cortos = tramos.filter((t) => t.saltos.length < MIN_SALTOS && t.hasta - t.desde >= paso);
  if (!cortos.length) break;
  for (const t of cortos) {
    const finas = await barre(t.desde, t.hasta, paso);
    // Sustituye las muestras del tramo por las finas y re-segmenta todo.
    muestras = muestras.filter((m) => m.w < t.desde || m.w > t.hasta).concat(finas).sort((a, b) => a.w - b.w);
  }
  tramos = segmenta(muestras);
}

// --- fronteras: bisecar y contrastar -------------------------------------------------------
const fronteras = [];
for (let i = 1; i < tramos.length; i++) {
  const prev = tramos[i - 1], act = tramos[i];
  const ultima = prev.muestras[prev.muestras.length - 1];
  const primera = act.muestras[0];
  // Entre el final de un tramo y el principio del siguiente hay exactamente un paso (contiguos) o
  // un paso que cruzo un corte declarado (y por eso no pertenece a ninguno). Se biseca ese paso.
  const lo = ultima.w, hi = primera.w === lo ? act.muestras[1].w : primera.w;
  const pasoPrev = prev.muestras.length > 1 ? prev.muestras[1].w - prev.muestras[0].w : PASO0;
  const pendiente = prev.mueve ? mediana(prev.saltos) / pasoPrev : 0;
  const declarado = cortesDeclarados?.find((c) => c > lo && c <= hi) ?? null;
  // ¿Hay SALTO de valor, o solo cambia la pendiente? Un max-width que satura pasa de fluido a quieto
  // sin brincar: es continuo. Una discontinuidad brinca. Son cosas distintas y se reportan distinto.
  const esperadoContinuo = ultima.cont + pendiente * (primera.w - lo);
  const salto = primera.cont - esperadoContinuo;
  const continuo = Math.abs(salto) <= TOL_ABS + Math.abs(pendiente) * 2;
  const exacto = await bisecaFrontera(lo, hi, ultima, pendiente);
  fronteras.push({ entre: [lo, hi], exacto, declarado, de: prev.mueve ? 'fluido' : 'quieto', a: act.mueve ? 'fluido' : 'quieto',
    salto: +salto.toFixed(1), continuo, desvio: declarado != null ? exacto - declarado : null });
}

// --- residuos dentro de cada tramo que se mueve -------------------------------------------
const fallos = [];
for (const t of tramos) {
  if (!t.mueve) continue;
  if (t.saltos.length < 2) continue;
  const med = mediana(t.saltos), dispersion = mad(t.saltos);
  const umbral = Math.max(TOL_ABS, 3 * dispersion);
  t.mediana = +med.toFixed(1); t.mad = +dispersion.toFixed(1); t.umbral = +umbral.toFixed(1);
  t.saltos.forEach((d, i) => {
    const r = d - med;
    if (Math.abs(r) > umbral) {
      const a = t.muestras[i].w, b = t.muestras[i + 1].w;
      // Un residuo justo en una frontera declarada no es discontinuidad: es el corte.
      const enCorte = cortesDeclarados?.some((c) => c > a && c <= b);
      /* Inicio de saturacion: el ULTIMO paso de un tramo fluido avanza MENOS que la mediana y el tramo
         muere en un tope continuo (max-width/clamp que satura, sin corte). No es un brinco: es el
         contenedor llegando a su maximo a mitad de paso. Cliente B 2026-10-08/14 (KL-B-13): 12 px
         entre 1680 y 1720 con tope en 1725. Se anota como INFO, no como HIGH. */
      const ultimoPaso = i === t.saltos.length - 1;
      const frena = Math.abs(d) < Math.abs(med);
      const topeDespues = fronteras.some((f) => f.entre[0] === b && f.continuo && f.declarado == null);
      if (!enCorte && ultimoPaso && frena && topeDespues) {
        fallos.push({ nivel: 'INFO', que: `inicio de saturacion entre ${a} y ${b}: avanza ${d.toFixed(1)} px de los ~${med.toFixed(1)} del tramo`, porque: 'el contenedor alcanza su tope a mitad de paso; el barrido confirma tope continuo justo despues, sin salto' });
      } else if (!enCorte) fallos.push({ nivel: 'HIGH', que: `salto de ${d.toFixed(1)} px entre ${a} y ${b} (esperado ~${med.toFixed(1)})`, porque: 'discontinuidad dentro de un tramo fluido: a ese ancho la composicion pega un brinco que ningun corte declara' });
    }
  });
}
for (const f of fronteras) {
  if (f.declarado != null) {
    // Corte declarado: legitimo. Solo se anota si conmuta lejos de donde dice (mas de 2 tolerancias).
    if (Math.abs(f.desvio) > 2 * TOL_ABS && !f.continuo)
      fallos.push({ nivel: 'MEDIUM', que: `el corte ${f.declarado} conmuta de verdad en ${f.exacto} (${f.desvio > 0 ? '+' : ''}${f.desvio} px)`, porque: 'la media query dice un numero y el contenido cambia en otro: algo mas gobierna ese tramo' });
    continue;
  }
  if (f.continuo) {
    // Sin corte pero sin salto: un tope (max-width / clamp) que satura. Es como funciona el CSS fluido.
    fallos.push({ nivel: 'INFO', que: `tope alcanzado en ${f.exacto}px (${f.de} → ${f.a}, sin salto)`, porque: 'el contenido deja de crecer o de encoger porque llega a su max/min-width; no es un corte, es la saturacion del tramo fluido' });
    continue;
  }
  fallos.push({ nivel: 'HIGH', que: `discontinuidad en ${f.exacto}px: salto de ${f.salto} px (${f.de} → ${f.a}) sin corte declarado`, porque: cortesDeclarados ? `los cortes del CSS son ${cortesDeclarados.join(', ')}: aqui el contenido brinca y nada lo explica` : 'sin conmutadores.json no hay contra que contrastar' });
}
// Visibles: un elemento que aparece o desaparece dentro de un tramo (no en frontera) es un conmutador escondido.
for (const t of tramos) {
  for (let i = 1; i < t.muestras.length; i++) {
    const a = t.muestras[i - 1], b = t.muestras[i];
    if (a.visibles !== b.visibles && !cortesDeclarados?.some((c) => c > a.w && c <= b.w)) {
      fallos.push({ nivel: 'MEDIUM', que: `${Math.abs(b.visibles - a.visibles)} elemento(s) ${b.visibles > a.visibles ? 'aparecen' : 'desaparecen'} entre ${a.w} y ${b.w}`, porque: 'algo conmuta a un ancho que no es un corte declarado' });
    }
  }
}

await nav.close();

// Regimen por tramo, que es lo que plan-anchos consume.
const regimen = tramos.map((t) => ({
  desde: t.desde, hasta: t.hasta,
  regimen: t.mueve ? 'fluido' : (t.muestras[0].cont >= Math.max(...muestras.map((m) => m.cont)) - TOL_ABS ? 'congelado' : 'rigido'),
  contenedor: [t.muestras[0].cont, t.muestras[t.muestras.length - 1].cont],
  saltos: t.saltos.length, mediana: t.mediana ?? 0, mad: t.mad ?? 0, umbral: t.umbral ?? TOL_ABS,
}));

const informe = { url: URL_, fecha: new Date().toISOString().slice(0, 10), paso: PASO0, rango: [MIN, MAX], tolerancia: TOL_ABS,
  seguidos, cortesDeclarados, muestras, tramos: regimen, fronteras, fallos };

if (flag('--json')) console.log(JSON.stringify(informe, null, 1));
else {
  console.log(`\nBarrido de continuidad · ${URL_} · ${MIN}→${MAX} paso ${PASO0} · ${muestras.length} muestras`);
  console.log(`seguidos: ${seguidos.join(', ')}\n`);
  console.log('tramo            regimen     contenedor        saltos  mediana  MAD    umbral');
  for (const t of regimen) {
    console.log(`  ${`${t.desde}-${t.hasta}`.padEnd(15)}${t.regimen.padEnd(12)}${`${t.contenedor[0]} → ${t.contenedor[1]}`.padEnd(18)}` +
      `${String(t.saltos).padEnd(8)}${String(t.mediana).padEnd(9)}${String(t.mad).padEnd(7)}${t.umbral}`);
  }
  console.log(`\nFronteras (bisecadas al pixel):`);
  for (const f of fronteras) console.log(`  ${String(f.exacto).padEnd(6)} ${f.de.padEnd(7)}→ ${f.a.padEnd(8)} salto ${String(f.salto).padStart(6)}  ` +
    (f.declarado != null ? `corte ${f.declarado}${Math.abs(f.desvio) > 2 * TOL_ABS ? ` (desvio ${f.desvio})` : ''}` : f.continuo ? 'tope (continuo)' : 'DISCONTINUIDAD'));
  if (fallos.length) { console.log(''); for (const f of fallos) console.log(`  [${f.nivel}] ${f.que}\n           -> ${f.porque}`); }
  console.log(fallos.length ? `\n${fallos.length} hallazgo(s).\n` : `\nCONTINUO: ninguna discontinuidad fuera de los cortes declarados.\n`);
  console.log(`(scrollWidth se anota como dato; el desborde lo juzga gate-desborde.mjs, que recorre)`);
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'barrido.json'), JSON.stringify(informe, null, 1) + '\n');
process.exit(fallos.some((f) => f.nivel === 'HIGH') ? 1 : 0);
