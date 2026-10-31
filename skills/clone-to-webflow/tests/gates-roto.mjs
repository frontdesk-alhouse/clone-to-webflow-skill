#!/usr/bin/env node
/**
 * Los gates saben fallar. Cada caso de tests/roto/ es un defecto construido a proposito; el gate
 * correspondiente tiene que salir con el codigo que dice, o el gate no esta probado.
 *
 *   node tests/gates-roto.mjs      (tambien: npm run test:gates)
 *
 * Va aparte del selftest del motor (22/22) para no tocar su firma.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
let ok = 0, mal = 0;
const corre = (script, args, cwd) => {
  try { return { code: 0, out: execFileSync('node', [join(RAIZ, 'scripts', script), ...args], { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { code: e.status, out: (e.stdout ?? '') + (e.stderr ?? '') }; }
};
const prueba = (nombre, fn) => { try { fn(); console.log(`  ok    ${nombre}`); ok++; } catch (e) { console.log(`  FALLA ${nombre}\n          ${e.message}`); mal++; } };

console.log('\nLos gates saben fallar\n');

const MOV = join(AQUI, 'roto/movimiento');
prueba('gate-movimiento: contrato con debe para 820 y config con 768 -> exit 2 (CONTRATO INCOMPLETO)', () => {
  copyFileSync(join(MOV, 'spec/movimiento.sin-anchos.json'), join(MOV, 'spec/movimiento.json'));
  const r = corre('gate-movimiento.mjs', [], MOV);
  unlinkSync(join(MOV, 'spec/movimiento.json'));
  if (r.code !== 2) throw new Error(`exit ${r.code}`);
  if (!/INCOMPLETO/.test(r.out) || !/nada para 768/.test(r.out)) throw new Error('no nombro el hueco');
});
prueba('gate-movimiento: contrato con anchos -> mide 820, no 768', () => {
  copyFileSync(join(MOV, 'spec/movimiento.con-anchos.json'), join(MOV, 'spec/movimiento.json'));
  const r = corre('gate-movimiento.mjs', [], MOV);
  unlinkSync(join(MOV, 'spec/movimiento.json'));
  if (!/@820/.test(r.out)) throw new Error('no midio 820');
  if (/@768/.test(r.out)) throw new Error('midio 768, que no esta en el contrato');
});

const ORD = join(AQUI, 'roto/orden');
prueba('gate-orden: secciones invertidas con `order` -> exit 1 (DESORDEN)', () => {
  const r = corre('gate-orden.mjs', [], ORD);
  if (r.code !== 1) throw new Error(`exit ${r.code}`);
  if (!/DESORDEN/.test(r.out)) throw new Error('no reporto DESORDEN');
});
prueba('gate-orden: sin spec/orden.json -> modo propuesta, exit 2', () => {
  const orden = join(ORD, 'spec/orden.json');
  const bak = orden + '.bak';
  copyFileSync(orden, bak); unlinkSync(orden);
  const r = corre('gate-orden.mjs', [], ORD);
  copyFileSync(bak, orden); unlinkSync(bak);
  if (r.code !== 2) throw new Error(`exit ${r.code}`);
  if (!/PROPUESTA/.test(r.out)) throw new Error('no propuso');
});

console.log(`\n${ok} ok · ${mal} fallo(s)`);
console.log(mal ? '\nHAY GATES QUE NO SABEN FALLAR — no seguir.\n' : '\nTODOS LOS GATES SABEN FALLAR\n');
process.exit(mal ? 1 : 0);
