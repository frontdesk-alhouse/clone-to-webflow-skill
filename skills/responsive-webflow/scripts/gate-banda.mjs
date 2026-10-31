#!/usr/bin/env node
/**
 * Gate · corte de banda limpio.
 *
 *   node gate-banda.mjs [url] [--json]
 *
 * La rubrica de clone-to-webflow declara este gate ("corte de banda limpio en los pares de
 * gates.banda") y nadie lo implemento nunca: `gates.banda` solo se usaba como fuente de anchos
 * para el medidor de centrado. Esto es el gate.
 *
 * No comprueba pares a ciegas. BUSCA, por biseccion, el ancho exacto en el que conmuta cada
 * pieza marcada. Un par 767/768 no ve el fallo que importa, porque a los dos lados del par la
 * nav es la misma; hay que encontrar el ancho donde de verdad cambia.
 *
 * Lo que se comprueba NO es que todos los conmutadores compartan un unico numero. Un sitio puede
 * tener, legitimamente, la nav conmutando en 768 y los juegos de secciones en 1200. Lo que no
 * puede pasar es:
 *   · que un conmutador caiga ENTRE limites de banda declarados — ahi nadie lo audita;
 *   · que las dos piezas del MISMO rol conmuten en anchos distintos — entre los dos anchos
 *     salen las dos a la vez, o ninguna. Es el caso de las dos barras.
 *   · que a algun ancho no se vea ninguna pieza de un rol, o se vean las dos.
 *   · que el corte introduzca desborde a alguno de sus dos lados.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium as cargaChromium, ARGS } from './lib/pw.mjs';
import { cargaConfig, url as urlDe } from './lib/config.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const cfg = cargaConfig();
const URL_ = args.find((a) => /^(https?|file):\/\//.test(a)) ?? urlDe(cfg, cfg.sitio.paginas[0]);

/**
 * Piezas cuyo conmutador se busca. Un rol con dos piezas es un par excluyente: exactamente una
 * de las dos tiene que verse a cualquier ancho.
 */
const S0 = cfg.selectores ?? {};
/* Pares por pagina: `selectores.porPagina[ruta]` sobreescribe (o anula con "") los pares globales
   cuando se mide esa URL. Hace falta porque un par como «cabecera del listado / toggle de filtros»
   solo existe en /proyectos: medido como global en el Home daba CRITICAL «ningun seccion en 991/992»
   por un hueco que no es (2026-10-14). */
const rutaMedida = (() => { try { return new URL(URL_).pathname.replace(/^\/|\/$/g, ''); } catch { return ''; } })();
const PP = S0.porPagina ?? {};
const extra = PP[rutaMedida] ?? PP[rutaMedida || 'home'] ?? {};
const S = { ...S0, ...extra };
const ROLES = [
  { rol: 'nav', a: S.navEscritorio, b: S.navMovil },
  { rol: 'seccion', a: S.seccionEscritorio, b: S.seccionMovil },
];
const activos = ROLES.filter((r) => r.a && r.b);

for (const r of activos) {
  if (r.a === r.b) {
    console.error(
      `\nEl rol "${r.rol}" tiene el mismo selector en las dos piezas ("${r.a}").\n` +
      `Un rol es un par EXCLUYENTE: la pieza de escritorio y la de movil son elementos\n` +
      `distintos, y el gate comprueba que se vea exactamente una. Con el mismo selector no\n` +
      `hay nada que comprobar.\n`
    );
    process.exit(2);
  }
}

if (!activos.length) {
  console.error(
    `\ngate-banda necesita al menos un par de piezas excluyentes en \`selectores\`:\n` +
    `  navEscritorio / navMovil       — para cazar las dos barras a la vez\n` +
    `  seccionEscritorio / seccionMovil\n\n` +
    `Sin ellas no hay conmutador que buscar. Rellenalos en ${cfg.__path}\n`
  );
  process.exit(2);
}

const MIN = Math.min(...Object.values(cfg.bandas).map((b) => b.min)) || 320;
const MAX = Math.max(...Object.values(cfg.bandas).map((b) => b.max));
const TOL = cfg.gates?.toleranciaBanda ?? 4;

const chromium = await cargaChromium();
const nav = await chromium.launch({ args: ARGS });
const pg = await nav.newPage({ viewport: { width: MAX, height: 900 }, deviceScaleFactor: 1 });
await pg.goto(URL_, { waitUntil: 'load' });
await pg.evaluate(() => document.fonts?.ready);

/** ¿Se pinta el selector a este ancho? Redimensiona y vuelve a medir; no recarga. */
async function visible(w, sel) {
  await pg.setViewportSize({ width: w, height: 900 });
  await pg.waitForTimeout(120);
  return pg.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, sel);
}

/**
 * Ancho mas pequeno en el que `sel` deja de verse (o empieza, segun la direccion). Devuelve el
 * par [ultimo visible, primer invisible]; el corte real es ese limite.
 */
async function conmutador(sel) {
  const alto = await visible(MAX, sel);
  const bajo = await visible(MIN, sel);
  if (alto === bajo) return null;   // no conmuta en todo el rango
  let lo = MIN, hi = MAX;           // invariante: visible(lo) === bajo, visible(hi) === alto
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((await visible(mid, sel)) === bajo) lo = mid; else hi = mid;
  }
  return { ultimoAbajo: lo, primeroArriba: hi, apareceAlCrecer: alto };
}

const encontrados = [];
for (const { rol, a, b } of activos) {
  for (const [cual, sel] of [['escritorio', a], ['movil', b]]) {
    const c = await conmutador(sel);
    encontrados.push({ rol, cual, sel, corte: c ? c.primeroArriba : null, detalle: c });
  }
}

// --- comprobaciones -------------------------------------------------------------------------
const fallos = [];

// 1 · Las dos piezas del MISMO rol conmutan en el mismo ancho.
for (const { rol } of activos) {
  const dos = encontrados.filter((e) => e.rol === rol && e.corte != null);
  if (dos.length === 2 && Math.abs(dos[0].corte - dos[1].corte) > TOL) {
    const [lo, hi] = dos.map((d) => d.corte).sort((x, y) => x - y);
    fallos.push({
      nivel: 'CRITICAL',
      que: `las dos piezas de "${rol}" conmutan en anchos distintos`,
      detalle: `${dos.map((d) => `${d.cual} en ${d.corte}`).join(' y ')}`,
      porque: `entre ${lo} y ${hi} se ven las dos a la vez o ninguna`,
    });
  }
}

// 2 · Cada conmutador cae sobre un limite de banda declarado.
// No se exige que TODOS compartan numero: un sitio puede conmutar la nav en un limite y los
// juegos de secciones en otro, y estar bien. Lo que no vale es un corte que ninguna banda conoce.
const cortes = encontrados.filter((e) => e.corte != null).map((e) => e.corte);
const unicos = [...new Set(cortes)].sort((x, y) => x - y);
const limites = [...new Set(Object.values(cfg.bandas).flatMap((b) => [b.min, b.max + 1]))].sort((a, b) => a - b);
for (const c of unicos) {
  if (!limites.some((l) => Math.abs(l - c) <= TOL)) {
    const quien = encontrados.filter((e) => e.corte === c).map((e) => `${e.rol}:${e.cual}`).join(', ');
    fallos.push({
      nivel: 'HIGH',
      que: `conmutador en ${c}px sin banda declarada (${quien})`,
      detalle: `las bandas del config cortan en ${limites.join(', ')}`,
      porque: 'un corte que el config no conoce no lo mide ningun gate, y el regimen a ese lado no esta declarado',
    });
  }
}

// 3 · A cada lado de cada corte: exactamente una pieza por rol, y desborde cero.
const lados = [...new Set(unicos.flatMap((c) => [c - 1, c]))].filter((w) => w >= MIN && w <= MAX).sort((a, b) => a - b);
const porAncho = [];
for (const w of lados) {
  const fila = { ancho: w, roles: {}, desborde: 0 };
  for (const { rol, a, b } of activos) {
    const va = await visible(w, a), vb = await visible(w, b);
    fila.roles[rol] = va && vb ? 'AMBAS' : va ? 'escritorio' : vb ? 'movil' : 'NINGUNA';
    if (va && vb) fallos.push({ nivel: 'CRITICAL', que: `dos "${rol}" a la vez en ${w}px`, detalle: `${a} y ${b} visibles`, porque: 'es el sintoma de conmutadores desalineados' });
    if (!va && !vb) fallos.push({ nivel: 'CRITICAL', que: `ningun "${rol}" en ${w}px`, detalle: `ni ${a} ni ${b}`, porque: 'hay un hueco entre bandas' });
  }
  await pg.setViewportSize({ width: w, height: 900 });
  await pg.waitForTimeout(120);
  fila.desborde = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (fila.desborde > 2) fallos.push({ nivel: 'HIGH', que: `desborde ${fila.desborde}px en ${w}px`, detalle: 'medido en reposo al lado del corte', porque: 'el corte introduce una caja mas ancha que la ventana' });
  porAncho.push(fila);
}

// 4 · Zonas mixtas: tramos donde dos roles estan en estados de banda distintos.
// NO es un fallo. Cliente A sirve, a proposito, la nav de escritorio sobre las secciones de tablet
// entre 768 y 1199. Pero es el tramo donde vive el fallo cuando lo hay, y nadie lo mira porque
// no es ninguno de los anchos redondos que se prueban. Se reporta para que lo juzgue el council.
const zonas = [];
if (activos.length > 1 && unicos.length > 1) {
  const bordes = [MIN, ...unicos, MAX + 1].sort((a, b) => a - b);
  for (let i = 0; i < bordes.length - 1; i++) {
    const desde = bordes[i], hasta = bordes[i + 1] - 1;
    if (hasta < desde) continue;
    const muestra = Math.floor((desde + hasta) / 2);
    const estado = {};
    for (const { rol, a, b } of activos) {
      estado[rol] = (await visible(muestra, a)) ? 'escritorio' : (await visible(muestra, b)) ? 'movil' : '—';
    }
    const vals = [...new Set(Object.values(estado))];
    zonas.push({ desde, hasta, estado, mixta: vals.length > 1 });
  }
}

await nav.close();

const informe = { url: URL_, fecha: new Date().toISOString().slice(0, 10), conmutadores: encontrados, porAncho, zonas, fallos };

if (flag('--json')) console.log(JSON.stringify(informe, null, 1));
else {
  console.log(`\nGate · corte de banda limpio · ${URL_}\n`);
  console.log('rol          pieza         corte encontrado');
  for (const e of encontrados) {
    console.log(`  ${e.rol.padEnd(11)}${e.cual.padEnd(13)}` +
      (e.corte == null ? 'no conmuta en todo el rango' : `${e.detalle.ultimoAbajo} -> ${e.corte}  (${e.detalle.apareceAlCrecer ? 'aparece al crecer' : 'desaparece al crecer'})`));
  }
  console.log(`\nA cada lado del corte:`);
  console.log('  ancho  ' + activos.map((r) => r.rol.padEnd(12)).join('') + 'desborde');
  for (const f of porAncho) {
    console.log(`  ${String(f.ancho).padEnd(7)}` + activos.map((r) => String(f.roles[r.rol]).padEnd(12)).join('') + f.desborde);
  }
  if (zonas.length) {
    console.log(`\nTramos (no son fallos: un tramo mixto puede ser deliberado — lo juzga el council):`);
    console.log('  rango           ' + activos.map((r) => r.rol.padEnd(12)).join(''));
    for (const z of zonas) {
      console.log(`  ${`${z.desde}-${z.hasta}`.padEnd(16)}` +
        activos.map((r) => z.estado[r.rol].padEnd(12)).join('') + (z.mixta ? ' <- MIXTO' : ''));
    }
  }
  if (fallos.length) {
    console.log('');
    for (const f of fallos) console.log(`  [${f.nivel}] ${f.que}\n           ${f.detalle}\n           -> ${f.porque}`);
  }
  console.log(fallos.length ? `\n${fallos.length} fallo(s).\n` : `\nCORTE LIMPIO.\n`);
}

if (cfg.salida) {
  mkdirSync(cfg.salida, { recursive: true });
  writeFileSync(join(cfg.salida, 'gate-banda.json'), JSON.stringify(informe, null, 1) + '\n');
}
process.exit(fallos.length ? 1 : 0);
