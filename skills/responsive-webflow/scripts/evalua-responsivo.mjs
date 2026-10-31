#!/usr/bin/env node
/**
 * Evaluador funcional de responsividad. Una nota, un veredicto, y la lista de lo que hay que arreglar primero.
 *
 *   node evalua-responsivo.mjs [--rapido] [--solo=pagina] [--iter=N] [--json]
 *
 * Es el EVALUADOR del loop (references/rubrica-funcional.md). No arregla nada y no se fia de quien arregla: corre
 * los instrumentos, puntua con una rubrica fija y devuelve el siguiente hallazgo a atacar. El que construye
 * (webflow-port-builder o la sesion) lee el veredicto; nunca se puntua a si mismo.
 *
 * Por que una nota y no solo gates en verde: un loop necesita saber si la iteracion MEJORO. La nota baja por
 * hallazgo, con tope por criterio, y hay compuertas duras que la ponen a 0: un instrumento que no corrio no es un
 * instrumento en verde, y una ventana que no se midio no esta aprobada.
 *
 *   R0 cobertura      se midio donde el usuario mira (dispositivos declarados) y donde el sitio cambia (plan derivado)
 *   R1 integridad     nada cortado, pisado, tapado, roto ni desbordado, en ninguna ventana        gate-integridad
 *   R2 escenas        los pines entran, se quedan y sueltan bien                                   gate-pines
 *   R3 continuidad    entre anchos el layout no brinca                                             barrido-continuidad
 *   R4 bandas         cada corte cambia una sola vez y en su sitio                                 gate-banda
 *   R5 hermanas       la misma pieza mide lo mismo en paginas hermanas                             (aqui)
 *   R6 escapes        todo defecto que encontro una persona tiene ya un check que lo caza          spec/escapes.json
 *   R7 paridad        lo que hay en escritorio existe tambien en tablet y en movil                 gate-paridad
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargaConfig, url as urlDe } from './lib/config.mjs';
import { viewports } from './lib/viewports.mjs';
import { chromium as cargaChromium, ARGS } from './lib/pw.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const cfg = cargaConfig();
const RAIZ = cfg.__raiz;
const OUT = cfg.salida || 'responsive-out';
const JSON_ = args.includes('--json');
const RAPIDO = args.includes('--rapido');
const UMBRAL = cfg.evaluacion?.umbral ?? 9.5;
const di = (...a) => { if (!JSON_) console.log(...a); };

/** Peso de cada criterio sobre 10, y cuanto resta cada hallazgo. El tope es el peso: un criterio no resta mas de lo que vale. */
const RUBRICA = {
  R1: { nombre: 'integridad', peso: 3.5, resta: { CRITICAL: 1.5, HIGH: 0.7, MEDIUM: 0.15, LOW: 0.05 } },
  R2: { nombre: 'escenas fijadas', peso: 2.0, resta: { HIGH: 0.5 } },
  R3: { nombre: 'continuidad entre anchos', peso: 1.5, resta: { HIGH: 0.5, MEDIUM: 0.15 } },
  R4: { nombre: 'corte de banda', peso: 1.0, resta: { CRITICAL: 1, HIGH: 0.5, MEDIUM: 0.15 } },
  R5: { nombre: 'paginas hermanas', peso: 1.0, resta: { HIGH: 0.5 } },
  R6: { nombre: 'escapes con gate', peso: 1.0, resta: { HIGH: 0.5 } },
  R7: { nombre: 'paridad de contenido', peso: 1.5, resta: { HIGH: 0.75, MEDIUM: 0.1 } },
};

function corre(script, extra = []) {
  let out = '', code = 0;
  try { out = execFileSync('node', [join(AQUI, script), ...extra, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, cwd: process.cwd() }); }
  catch (e) { code = e.status ?? 1; out = (e.stdout ?? '') + (code === 2 ? (e.stderr ?? '') : ''); }
  if (code === 2) return { omitido: (out.trim().split('\n').find(Boolean) ?? 'no se pudo correr').slice(0, 200), hallazgos: [] };
  try { const d = JSON.parse(out.slice(out.indexOf('{'))); return { datos: d, hallazgos: (d.fallos ?? d.hallazgos ?? []).map((h) => ({ ...h, detalle: h.detalle || h.porque || '' })) }; }
  catch { return { omitido: `salida ilegible (exit ${code})`, hallazgos: [] }; }
}

// ---------------------------------------------------------------- R5 · paginas hermanas
/** `hermanas: [{ nombre, paginas:[..], piezas:[sel..], tolerancia:2 }]` — la misma pieza, medida igual, en paginas que comparten plantilla. */
async function mideHermanas() {
  const grupos = cfg.hermanas ?? [];
  if (!grupos.length) return { omitido: 'no hay grupos declarados en `hermanas` (si el sitio tiene paginas con la misma plantilla, declaralas)', hallazgos: [] };
  const VP = viewports(cfg, { rapido: true });
  const chromium = await cargaChromium(); const browser = await chromium.launch({ args: ARGS });
  const hallazgos = [];
  try {
    for (const g of grupos) for (const v of VP.lista) {
      const medidas = {};
      for (const pagina of g.paginas) {
        const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        await page.goto(urlDe(cfg, pagina), { waitUntil: 'load', timeout: 90000 }); await page.waitForTimeout(1200);
        medidas[pagina] = await page.evaluate((piezas) => Object.fromEntries(piezas.map((s) => { const e = document.querySelector(s); if (!e || !e.getBoundingClientRect().width) return [s, null]; const r = e.getBoundingClientRect(); return [s, { x: r.left, y: r.top + scrollY, w: r.width, h: r.height }]; })), g.piezas);
        await ctx.close();
      }
      for (const s of g.piezas) for (const eje of ['x', 'w', 'h', ...(g.comparaY ? ['y'] : [])]) {
        const vals = g.paginas.map((p) => medidas[p][s]?.[eje]).filter((x) => x != null);
        if (vals.length < 2) continue;
        const rango = Math.max(...vals) - Math.min(...vals);
        if (rango > (g.tolerancia ?? 2)) hallazgos.push({ nivel: 'HIGH', que: `${g.nombre} · ${s} · ${eje}`, detalle: `difiere ${rango.toFixed(1)} px entre hermanas a ${v.w}x${v.h}: ${g.paginas.map((p) => `${p || 'home'}=${medidas[p][s]?.[eje]?.toFixed(0) ?? '—'}`).join(' ')}` });
      }
    }
  } finally { await browser.close(); }
  return { hallazgos };
}

// ---------------------------------------------------------------- R6 · escapes
/** Un escape es un defecto que encontro una PERSONA despues de que el loop dijera PASS. Cada uno tiene que acabar en un check. */
function mideEscapes() {
  const ruta = join(RAIZ, cfg.evaluacion?.escapes ?? 'spec/escapes.json');
  if (!existsSync(ruta)) return { datos: { total: 0 }, hallazgos: [], nota: 'sin registro de escapes (spec/escapes.json): si una persona encuentra algo que el loop no vio, se apunta ahi' };
  const escapes = JSON.parse(readFileSync(ruta, 'utf8')).escapes ?? [];
  const hallazgos = escapes.filter((e) => !e.adjudicado && !(e.gate && existsSync(join(RAIZ, e.gate)) || e.gate && existsSync(join(AQUI, e.gate))))
    .map((e) => ({ nivel: 'HIGH', que: `escape sin gate · ${e.fecha} · ${e.que}`, detalle: `lo vio ${e.quien ?? 'una persona'} en ${e.ventana ?? '¿?'} y ningun check lo caza todavia. Primero el check que FALLA, despues el arreglo.` }));
  return { datos: { total: escapes.length, sinGate: hallazgos.length }, hallazgos };
}

// ---------------------------------------------------------------- corrida
di(`\nEvaluacion funcional · ${cfg.cliente ?? ''} · ${cfg.sitio.staging}\n`);
const solo = opt('solo') ? [`--solo=${opt('solo')}`] : [];
/** Una base explicita (otro staging, o `file://` en las pruebas) se pasa a los gates que recorren todas las paginas. */
const base = args.filter((a) => /^(https?|file):\/\//.test(a)).slice(0, 1);
const VP = viewports(cfg, { rapido: RAPIDO });
const partes = {
  R1: corre('gate-integridad.mjs', [...base, ...solo, ...(RAPIDO ? ['--rapido'] : [])]),
  // en --rapido las escenas se miden solo en las ventanas del usuario y los frames: es la vuelta de iterar, no la que cierra
  R2: corre('gate-pines.mjs', [...base, ...(solo.length ? [`--solo=${cfg.rutas?.[opt('solo')] ?? opt('solo')}`] : []),
    ...(RAPIDO ? [`--viewports=${VP.lista.map((v) => `${v.w}x${v.h}`).join(',')}`] : [])]),
  R3: RAPIDO ? { omitido: '--rapido', hallazgos: [] } : corre('barrido-continuidad.mjs'),
  R4: corre('gate-banda.mjs'),
  R5: RAPIDO ? { omitido: '--rapido', hallazgos: [] } : await mideHermanas(),
  R6: mideEscapes(),
  R7: corre('gate-paridad.mjs', [...base, ...solo]),
};

// ---------------------------------------------------------------- nota
const filas = Object.entries(RUBRICA).map(([id, r]) => {
  const p = partes[id], hs = p.hallazgos.filter((h) => h.nivel !== 'INFO');
  const resta = Math.min(r.peso, hs.reduce((a, h) => a + (r.resta[h.nivel] ?? 0), 0));
  return { id, ...r, omitido: p.omitido ?? null, hallazgos: hs, puntos: p.omitido ? null : +(r.peso - resta).toFixed(2) };
});
const medibles = filas.filter((f) => !f.omitido);
const pesoMedido = medibles.reduce((a, f) => a + f.peso, 0);
let nota = pesoMedido ? +(10 * medibles.reduce((a, f) => a + f.puntos, 0) / pesoMedido).toFixed(2) : 0;

// Compuertas duras. Ninguna se compensa con buena nota en otro criterio.
const compuertas = [];
if (!VP.cobertura.dispositivos) compuertas.push({ tope: 8.9, porque: 'R0 · el catalogo de ventanas reales esta apagado (`evaluacion.catalogo: false`) y no hay `dispositivos`: solo se midio a los anchos de frame, que es donde el diseno esta garantizado.' });
if (!VP.cobertura.plan && !RAPIDO) compuertas.push({ tope: 8.9, porque: 'R0 · no hay plan-anchos.json: los anchos son una lista por defecto, no los del sitio. Corre conmutadores → barrido-continuidad → plan-anchos.' });
if (partes.R1.omitido) compuertas.push({ tope: 0, porque: `R1 · la integridad no se pudo medir (${partes.R1.omitido}). Sin ella no hay evaluacion.` });
if (filas.some((f) => f.hallazgos.some((h) => h.nivel === 'CRITICAL'))) compuertas.push({ tope: 4.9, porque: 'hay un hallazgo CRITICAL' });
for (const c of compuertas) nota = Math.min(nota, c.tope);
const graves = filas.flatMap((f) => f.hallazgos.filter((h) => /HIGH|CRITICAL/.test(h.nivel)).map((h) => ({ ...h, criterio: f.id, cuesta: f.resta[h.nivel] ?? 0 })));
const veredicto = nota >= UMBRAL && !graves.length ? 'PASS' : 'FAIL';

// ---------------------------------------------------------------- historia del loop: mejoro o no
mkdirSync(OUT, { recursive: true });
const histPath = join(OUT, 'evaluacion.historia.jsonl');
const previas = existsSync(histPath) ? readFileSync(histPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const iter = Number(opt('iter') ?? previas.length + 1);
const ultima = previas.at(-1);
const delta = ultima ? +(nota - ultima.nota).toFixed(2) : null;
const meseta = previas.length >= 2 && previas.slice(-2).every((p) => Math.abs(p.nota - nota) < 0.05) && veredicto === 'FAIL';
if (!RAPIDO) appendFileSync(histPath, JSON.stringify({ iter, fecha: new Date().toISOString(), nota, veredicto, graves: graves.length }) + '\n');

const siguiente = [...graves].sort((a, b) => b.cuesta - a.cuesta)[0] ?? null;
const L = [
  `# Evaluacion funcional · ${cfg.cliente ?? 'sitio'} · iteracion ${iter}`, '',
  `**${veredicto} · ${nota.toFixed(2)} / 10** (umbral ${UMBRAL})${delta === null ? '' : ` · ${delta >= 0 ? '+' : ''}${delta} respecto a la anterior`}${meseta ? ' · **MESETA**: dos iteraciones sin mejorar. Se para y se informa; no se sigue probando a ciegas.' : ''}`, '',
  `Ventanas: ${VP.origen} → ${VP.lista.length}. ${VP.lista.filter((v) => v.origen === 'dispositivo').map((v) => `${v.nombre ?? ''} ${v.w}×${v.h}`).join(' · ')}`, '',
  ...(compuertas.length ? ['## Compuertas', '', ...compuertas.map((c) => `- tope ${c.tope}: ${c.porque}`), ''] : []),
  '## Rubrica', '', '| | criterio | peso | puntos | hallazgos |', '|---|---|---:|---:|---|',
  ...filas.map((f) => `| ${f.id} | ${f.nombre} | ${f.peso} | ${f.omitido ? 'OMITIDO' : f.puntos} | ${f.omitido ? f.omitido : f.hallazgos.length || '—'} |`), '',
  ...(filas.some((f) => f.omitido) ? ['> Un criterio omitido no suma ni resta: la nota se calcula sobre lo medido. No es un criterio en verde.', ''] : []),
  ...(siguiente ? ['## Lo siguiente que se arregla', '', `**[${siguiente.criterio} · ${siguiente.nivel}] ${siguiente.que}**`, '', siguiente.detalle, '', 'Gate primero: este hallazgo YA falla en un instrumento, asi que el arreglo se comprueba volviendo a correr esta evaluacion. Un arreglo por iteracion.', ''] : []),
  '## Hallazgos', '',
  ...filas.flatMap((f) => f.hallazgos.map((h) => `- **[${f.id} · ${h.nivel}]** ${h.que} — ${h.detalle}`)),
];
writeFileSync(join(OUT, 'EVALUACION.md'), L.join('\n') + '\n');
const resumen = { iter, nota, umbral: UMBRAL, veredicto, delta, meseta, compuertas, criterios: filas.map(({ id, nombre, peso, puntos, omitido, hallazgos }) => ({ id, nombre, peso, puntos, omitido, hallazgos: hallazgos.length })), siguiente };
writeFileSync(join(OUT, 'evaluacion.json'), JSON.stringify({ ...resumen, hallazgos: filas.flatMap((f) => f.hallazgos.map((h) => ({ criterio: f.id, ...h }))) }, null, 1));

if (JSON_) console.log(JSON.stringify(resumen));
else {
  for (const f of filas) console.log(`  ${f.id}  ${f.nombre.padEnd(28)} ${f.omitido ? `OMITIDO — ${f.omitido}` : `${f.puntos} / ${f.peso}${f.hallazgos.length ? `  (${f.hallazgos.length})` : ''}`}`);
  for (const c of compuertas) console.log(`  tope ${c.tope}: ${c.porque}`);
  console.log(`\n${veredicto} · ${nota.toFixed(2)} / 10${delta === null ? '' : ` (${delta >= 0 ? '+' : ''}${delta})`}${meseta ? ' · MESETA' : ''} → ${join(OUT, 'EVALUACION.md')}`);
  if (siguiente) console.log(`siguiente: [${siguiente.criterio}] ${siguiente.que}`);
}
process.exit(veredicto === 'PASS' ? 0 : meseta ? 3 : 1);
