#!/usr/bin/env node
/**
 * El instrumento antes que el sujeto.
 *
 *   npm run selftest
 *
 * Un numero que no se puede reproducir no es un numero, y un gate que nunca ha fallado no esta
 * probado. Esto comprueba las dos cosas: que el motor reproduce un caso con respuesta conocida, y
 * que los gates saben fallar.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { factores, declaraciones, esperado, completaBanda } from '../scripts/lib/unidad.mjs';
import { limpia } from '../scripts/lib/json.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
let ok = 0, mal = 0;
const prueba = (nombre, fn) => {
  try { fn(); console.log(`  ok    ${nombre}`); ok++; }
  catch (e) { console.log(`  FALLA ${nombre}\n          ${e.message}`); mal++; }
};
const igual = (a, b, q) => { if (a !== b) throw new Error(`${q}: ${a} != ${b}`); };
const cerca = (a, b, t, q) => { if (Math.abs(a - b) > t) throw new Error(`${q}: ${a} vs ${b}`); };

console.log('\nSelftest · responsive-webflow\n');
console.log('La matematica de la unidad, contra la tabla publicada de Cliente A (2026-09-06 §7):');

// Banda escritorio de Cliente A. Los seis numeros de esta tabla son la firma del motor.
const esc = completaBanda({ frame: 1440, umin: 0.8333333333333334, umax: 1.3333333333333333, min: 1200, max: 1920 });
for (const [w, u, t, h1, cuerpo] of [
  [1200, 0.833, 0.833, 53.3, 13.3],
  [1440, 1.000, 1.000, 64.0, 16.0],
  [1849, 1.284, 1.094, 70.0, 16.0],
  [1920, 1.333, 1.110, 71.0, 16.0],
  [2560, 1.333, 1.110, 71.0, 16.0],
]) {
  prueba(`${w}px -> u ${u} · t ${t} · H1 ${h1} · cuerpo ${cuerpo}`, () => {
    const f = factores(w, esc);
    cerca(f.u, u, 0.001, 'u'); cerca(f.t, t, 0.001, 't');
    cerca(64 * f.t, h1, 0.1, 'H1'); cerca(16 * f.tb, cuerpo, 0.1, 'cuerpo');
  });
}

console.log('\nLos tres estados de un elemento:');
prueba('pintado emite geometria y tipografia con su factor', () => {
  const d = declaraciones({ sel: '.h1', x: 80, fs: 64, ls: -0.03, f: 't' });
  igual(d.join(';'), 'left:calc(80px * var(--u));font-size:calc(64px * var(--t));letter-spacing:-0.03em', 'declaraciones');
});
prueba('oculto:true emite display:none', () => igual(declaraciones({ oculto: true }).join(''), 'display:none', 'oculto'));
prueba('oculto:"heredado" NO emite nada', () => igual(declaraciones({ oculto: 'heredado' }).length, 0, 'heredado'));
prueba('declarado sin nada medible da {} y no null', () => {
  const e = esperado({ sel: '.x', css: { color: 'red' } }, { u: 1, t: 1, tb: 1 });
  if (e === null) throw new Error('devolvio null: se confundiria con oculto');
  igual(Object.keys(e).length, 0, 'medibles');
});

console.log('\nLa limpieza de las llaves de documentacion:');
prueba('`_` se quita y `__` se conserva', () => {
  const r = limpia({ _: 'doc', a: 1, __path: 'x', b: { _: 'doc', c: 2 } });
  igual(JSON.stringify(r), '{"a":1,"__path":"x","b":{"c":2}}', 'limpia');
});

console.log('\nRegresion del motor de modo UNIDAD contra Cliente A:');
const MEDIDAS = join(AQUI, 'cliente-a.medidas.json');
const ORIG = process.env.CLIENTE_A_TOKENS ?? join(AQUI, "cliente-a.tokens.css");
if (!existsSync(ORIG)) {
  console.log(`  OMITIDA — no encuentro el caso de referencia:\n          ${ORIG}`);
  console.log('          (no es un aprobado: el motor queda sin comprobar contra respuesta conocida)');
} else {
  prueba('el motor generico reproduce el CSS escrito a mano', () => {
    execFileSync('node', [join(AQUI, 'fixture-cliente-a.mjs')], { stdio: 'pipe' });
    execFileSync('node', [join(RAIZ, 'scripts/genera-unidad.mjs'), MEDIDAS, '--out', '/tmp/rw-selftest'], { stdio: 'pipe' });
    const out = execFileSync('node', [join(AQUI, 'regresion-cliente-a.mjs'), '/tmp/rw-selftest/responsive-tokens.css', ORIG], { encoding: 'utf8' });
    if (!/REGRESION LIMPIA/.test(out)) throw new Error(out.trim().split('\n').slice(-6).join(' | '));
  });
}

console.log('\nLos gates saben fallar:');
const ROTO = join(AQUI, 'roto/conmutadores-desalineados.html');
prueba('gate-banda caza los conmutadores desalineados del caso roto', () => {
  const cfg = join(AQUI, 'roto/responsive.config.json');
  if (!existsSync(cfg)) throw new Error(`falta ${cfg}`);
  let salida = '', code = 0;
  try { salida = execFileSync('node', [join(RAIZ, 'scripts/gate-banda.mjs'), `file://${ROTO}`], { encoding: 'utf8', cwd: join(AQUI, 'roto') }); }
  catch (e) { code = e.status; salida = (e.stdout ?? '') + (e.stderr ?? ''); }
  if (code !== 1) throw new Error(`exit ${code}, se esperaba 1 — el gate no falla sobre un caso que SI esta roto`);
  if (!/MIXTO/.test(salida)) throw new Error('no reporto el tramo mixto 768-991');
  if (!/992/.test(salida)) throw new Error('no encontro el conmutador de nav en 992');
});

prueba('barrido-continuidad caza la discontinuidad de 32 px (la que 3x mediana no veia)', () => {
  const dir = join(AQUI, 'roto/discontinuidad');
  let salida = '', code = 0;
  try { salida = execFileSync('node', [join(RAIZ, 'scripts/barrido-continuidad.mjs'), `file://${join(dir, 'pagina.html')}`], { encoding: 'utf8', cwd: dir }); }
  catch (e) { code = e.status; salida = (e.stdout ?? '') + (e.stderr ?? ''); }
  if (code !== 1) throw new Error(`exit ${code}, se esperaba 1`);
  if (!/entre 880 y 920/.test(salida)) throw new Error('no cazo el +32 en 900');
  if (!/entre 1080 y 1100|entre 1100 y 1120/.test(salida)) throw new Error('no cazo el -32 en 1100 (el que anula la pendiente en un paso)');
});

const PINES = join(AQUI, 'roto/pines');
const pines = (caso) => {
  let salida = '', code = 0;
  try { salida = execFileSync('node', [join(RAIZ, 'scripts/gate-pines.mjs'), `file://${PINES}`], { encoding: 'utf8', cwd: join(PINES, caso), stdio: 'pipe' }); }
  catch (e) { code = e.status; salida = (e.stdout ?? '') + (e.stderr ?? ''); }
  return { code, salida };
};
prueba('gate-pines caza el pin que escribe px visuales bajo zoom (1192 en vez de 1310)', () => {
  const { code, salida } = pines('roto');
  if (code !== 1) throw new Error(`exit ${code}, se esperaba 1`);
  if (!/1310x945 escena C1 ancho del pin[^\n]*1191\.\d/.test(salida)) throw new Error('no midio el pin de ~1192 px a 1310');
  if (/1440x900 escena C1/.test(salida)) throw new Error('fallo a 1440, donde zoom = 1 y el defecto se cancela: mide otra cosa');
});
prueba('gate-pines deja pasar el mismo pin hecho con sticky', () => {
  const { code, salida } = pines('sano');
  if (code !== 0) throw new Error(`exit ${code}: ${salida.trim().split('\n').slice(-4).join(' | ')}`);
});
prueba('gate-pines sin escenas declaradas sale OMITIDO (exit 2), no en verde', () => {
  let code = 0;
  try { execFileSync('node', [join(RAIZ, 'scripts/gate-pines.mjs')], { cwd: join(AQUI, 'roto'), stdio: 'pipe' }); } catch (e) { code = e.status; }
  if (code !== 2) throw new Error(`exit ${code}, se esperaba 2`);
});

console.log('\nEl evaluador funcional sabe reprobar:');
const INTEG = join(AQUI, 'roto/integridad');
const evalua = (caso, extra = []) => {
  let salida = '', code = 0;
  try { salida = execFileSync('node', [join(RAIZ, 'scripts/evalua-responsivo.mjs'), `file://${INTEG}`, '--rapido', '--json', ...extra], { encoding: 'utf8', cwd: join(INTEG, caso), stdio: 'pipe' }); }
  catch (e) { code = e.status; salida = e.stdout ?? ''; }
  return { code, r: JSON.parse(salida.slice(salida.indexOf('{'))) };
};
prueba('gate-integridad caza texto recortado, texto pisado, control tapado, desborde e imagen rota', () => {
  let salida = '';
  try { execFileSync('node', [join(RAIZ, 'scripts/gate-integridad.mjs'), `file://${INTEG}`, '--rapido', '--json'], { encoding: 'utf8', cwd: join(INTEG, 'roto'), stdio: 'pipe' }); throw new Error('salio con 0 sobre el caso roto'); }
  catch (e) { if (e.status !== 1) throw e; salida = e.stdout; }
  const tipos = new Set(JSON.parse(salida).fallos.map((f) => f.tipo));
  for (const t of ['I1', 'I2', 'I3', 'I4', 'I5']) if (!tipos.has(t)) throw new Error(`no cazo ${t}`);
});
prueba('pagina sana (con carrusel, elipsis y nav fija): 10 y PASS, sin falsos positivos', () => {
  const { code, r } = evalua('sano');
  if (code !== 0 || r.veredicto !== 'PASS' || r.nota !== 10) throw new Error(`exit ${code} · ${r.veredicto} ${r.nota}`);
});
prueba('pagina rota: FAIL, nota por debajo del umbral y dice que se arregla primero', () => {
  const { code, r } = evalua('roto');
  if (code !== 1 || r.veredicto !== 'FAIL' || !(r.nota < r.umbral)) throw new Error(`exit ${code} · ${r.veredicto} ${r.nota}`);
  if (!r.siguiente?.que) throw new Error('no dio el siguiente hallazgo a atacar');
});
prueba('con el catalogo apagado y sin dispositivos la nota topa en 8.9 aunque todo lo demas este limpio', () => {
  const { code, r } = evalua('sin-dispositivos');
  if (code !== 1 || r.nota > 8.9 || !r.compuertas.some((c) => /catalogo/.test(c.porque))) throw new Error(`exit ${code} · nota ${r.nota}`);
});

console.log('\nLa paridad de contenido entre bandas:');
const PARIDAD = join(AQUI, 'roto/paridad');
const paridad = (caso) => { let salida = '', code = 0; try { salida = execFileSync('node', [join(RAIZ, 'scripts/gate-paridad.mjs'), `file://${PARIDAD}`, '--json'], { encoding: 'utf8', cwd: join(PARIDAD, caso), stdio: 'pipe' }); } catch (e) { code = e.status; salida = e.stdout ?? ''; } return { code, fallos: JSON.parse(salida).fallos }; };
prueba('gate-paridad caza la seccion que existe en escritorio y no en movil ni en tablet', () => {
  const { code, fallos } = paridad('roto');
  if (code !== 1) throw new Error(`exit ${code}, se esperaba 1`);
  const altos = fallos.filter((f) => f.nivel === 'HIGH');
  if (altos.length !== 2 || !altos.every((f) => /Tres partes/.test(f.que))) throw new Error(`esperaba 2 HIGH de «Tres partes»: ${altos.map((f) => f.que).join(' | ')}`);
});
prueba('no cuenta como perdido un rotulo que en movil es un <p>, ni la carta de un mazo que espera su turno', () => {
  const { fallos } = paridad('roto');
  if (fallos.some((f) => /OBJECIONES|Carta|equipo/.test(f.que))) throw new Error(fallos.map((f) => f.que).join(' | '));
});
prueba('una seccion omitida A PROPOSITO y declarada con su porque no es un fallo', () => { const { code } = paridad('declarada'); if (code !== 0) throw new Error(`exit ${code}`); });

console.log(`\n${ok} ok · ${mal} fallo(s)`);
console.log(mal ? '\nINSTRUMENTO NO VALIDADO — no seguir.\n' : '\nINSTRUMENTO VALIDADO\n');
process.exit(mal ? 1 : 0);
