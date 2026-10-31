#!/usr/bin/env node
/**
 * La compuerta sabe cerrarse.   npm run test:playbook
 *
 * Una compuerta que nunca ha dicho que no, no esta probada. Se monta un cliente de mentira en una carpeta
 * temporal y se le pide a playbook.mjs lo que NO debe conceder, ademas de lo que si.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAYBOOK = join(dirname(fileURLToPath(import.meta.url)), '../scripts/playbook.mjs');
let ok = 0, mal = 0;
const prueba = (nombre, fn) => {
  try { fn(); console.log(`  ok    ${nombre}`); ok++; } catch (e) { console.log(`  FALLA ${nombre}\n          ${e.message}`); mal++; }
};

function cliente({ frames, framesPorPagina, modo } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'playbook-'));
  mkdirSync(join(dir, 'informes'));
  writeFileSync(join(dir, 'informes/verde.md'), '# gate\n\nBase: x · filas 12 · **fallos 0**\n\nPASS · 0 fallos de 12\n');
  writeFileSync(join(dir, 'informes/rojo.md'), '# gate\n\nFAIL · 3 fallos de 12\n');
  writeFileSync(join(dir, 'informes/evaluacion-fail.md'), '# Evaluacion funcional\n\n**FAIL · 7.20 / 10** (umbral 9.5)\n');
  writeFileSync(join(dir, 'informes/evaluacion-pass.md'), '# Evaluacion funcional\n\n**PASS · 9.80 / 10** (umbral 9.5)\n');
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify({
    cliente: 'PRUEBA', webflow: { staging: 'https://prueba.webflow.io', shortName: 'prueba' },
    figma: { frames: frames ?? { 1440: '1:1', 768: '1:2', 390: '1:3' }, ...(framesPorPagina ? { framesPorPagina } : {}) },
    paginas: ['', 'pricing'], anchos: [390, 768, 1440], ...(modo ? { playbook: { modo } } : {}),
  }));
  const corre = (...args) => {
    try { return { code: 0, out: execFileSync('node', [PLAYBOOK, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }) }; }
    catch (e) { return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
  };
  return { dir, corre, estado: () => JSON.parse(readFileSync(join(dir, 'spec/playbook-estado.json'), 'utf8')) };
}
const exige = (r, code, re, que) => {
  if (r.code !== code) throw new Error(`${que}: exit ${r.code}, se esperaba ${code} — ${r.out.trim().slice(0, 200)}`);
  if (re && !re.test(r.out)) throw new Error(`${que}: la salida no dice ${re} — ${r.out.trim().slice(0, 200)}`);
};
const VERDE = ['--evidencia', 'informes/verde.md'];
const aprueba = (c, etapa, pagina = 'pricing') => exige(c.corre('aprueba', etapa, '--pagina', pagina, '--por', 'Revisor', ...VERDE), 0, /APROBADA/, `aprueba ${etapa}`);

console.log('\nTest · playbook por bandas\n\nEl orden:');
const a = cliente();
prueba('escritorio NO se abre sin el aprobado de figma', () => exige(a.corre('puede', 'escritorio', '--pagina', 'pricing'), 1, /figma.*no tiene aprobado/, 'puede'));
prueba('movil NO se abre sin el aprobado de escritorio', () => { aprueba(a, 'figma'); exige(a.corre('puede', 'movil', '--pagina', 'pricing'), 1, /escritorio/, 'puede'); });
prueba('tablet NO se abre con escritorio aprobado y movil sin aprobar', () => { aprueba(a, 'escritorio'); exige(a.corre('puede', 'tablet', '--pagina', 'pricing'), 1, /movil/, 'puede'); });
prueba('movil SI se abre con escritorio aprobado, y avisa de las bandas congeladas', () => exige(a.corre('abre', 'movil', '--pagina', 'pricing'), 0, /congeladas: escritorio/, 'abre'));
prueba('responsividad NO se abre hasta tener las tres bandas', () => { aprueba(a, 'movil'); exige(a.corre('puede', 'responsividad', '--pagina', 'pricing'), 1, /tablet/, 'puede'); });
prueba('con las tres aprobadas, responsividad SI', () => { aprueba(a, 'tablet'); exige(a.corre('puede', 'responsividad', '--pagina', 'pricing'), 0, /SE PUEDE/, 'puede'); });
prueba('el aprobado de una pagina no abre otra', () => exige(a.corre('puede', 'escritorio', '--pagina', 'home'), 1, /figma/, 'puede home'));

console.log('\nEl aprobado:');
const b = cliente();
prueba('sin --por no hay aprobado', () => exige(b.corre('aprueba', 'figma', '--pagina', 'pricing', ...VERDE), 2, /--por/, 'aprueba'));
prueba('el agente no se aprueba a si mismo', () => exige(b.corre('aprueba', 'figma', '--pagina', 'pricing', '--por', 'Claude', ...VERDE), 1, /no se aprueba a si mismo/, 'aprueba'));
prueba('sin informe de gates no hay aprobado', () => exige(b.corre('aprueba', 'figma', '--pagina', 'pricing', '--por', 'Revisor'), 1, /--evidencia/, 'aprueba'));
prueba('sobre un informe en rojo no hay aprobado', () => exige(b.corre('aprueba', 'figma', '--pagina', 'pricing', '--por', 'Revisor', '--evidencia', 'informes/rojo.md'), 1, /rojo/, 'aprueba'));
prueba('una EVALUACION.md en FAIL tampoco sirve de evidencia, y una en PASS si', () => {
  const e = cliente();
  exige(e.corre('aprueba', 'figma', '--pagina', 'pricing', '--por', 'Revisor', '--evidencia', 'informes/evaluacion-fail.md'), 1, /rojo/, 'fail');
  exige(e.corre('aprueba', 'figma', '--pagina', 'pricing', '--por', 'Revisor', '--evidencia', 'informes/evaluacion-pass.md'), 0, /APROBADA/, 'pass');
  rmSync(e.dir, { recursive: true, force: true });
});
prueba('un rojo adjudicado si pasa, y queda escrito', () => {
  exige(b.corre('aprueba', 'figma', '--pagina', 'pricing', '--por', 'Revisor', '--evidencia', 'informes/rojo.md', '--adjudicado', 'KL-211'), 0, /APROBADA/, 'aprueba');
  if (b.estado().paginas.pricing.figma.adjudicado !== 'KL-211') throw new Error('no guardo la adjudicacion');
});
prueba('no se aprueba una etapa saltandose la anterior', () => exige(b.corre('aprueba', 'movil', '--pagina', 'pricing', '--por', 'Revisor', ...VERDE), 1, /escritorio/, 'aprueba'));
prueba('retroactivo exige fecha y fuente, y las guarda', () => {
  exige(b.corre('aprueba', 'escritorio', '--pagina', 'pricing', '--por', 'Revisor', '--retroactivo'), 2, /--fecha/, 'retro sin datos');
  exige(b.corre('aprueba', 'escritorio', '--pagina', 'pricing', '--por', 'Revisor', '--retroactivo', '--fecha', '2026-09-14', '--fuente', 'RUN-LOG'), 0, /2026-09-14/, 'retro');
  if (b.estado().paginas.pricing.escritorio.fuente !== 'RUN-LOG') throw new Error('no guardo la fuente');
});

console.log('\nLos frames de Figma:');
const c = cliente({ frames: { 1440: '1:1', 768: '', 390: '1:3' } });
prueba('figma NO se aprueba si falta el frame de tablet', () => exige(c.corre('aprueba', 'figma', '--pagina', 'pricing', '--por', 'Revisor', ...VERDE), 1, /tablet @768/, 'aprueba figma'));
const d = cliente({ modo: 'sitio-existente', framesPorPagina: { pricing: { 1440: '9:1', 768: '9:2', 390: '' } } });
prueba('sitio-existente: escritorio se abre sin la etapa figma', () => exige(d.corre('puede', 'escritorio', '--pagina', 'pricing'), 0, /SE PUEDE/, 'puede'));
prueba('sitio-existente: movil NO se abre sin su frame, aunque escritorio este aprobado', () => {
  aprueba(d, 'escritorio');
  exige(d.corre('puede', 'movil', '--pagina', 'pricing'), 1, /movil @390.*framesPorPagina/, 'puede');
});

console.log('\nLa correccion:');
prueba('reabrir escritorio deja movil y tablet por-reverificar, sin borrar su aprobado', () => {
  exige(a.corre('reabre', 'escritorio', '--pagina', 'pricing', '--motivo', 'panel recortado'), 0, /Por reverificar: movil, tablet/, 'reabre');
  const p = a.estado().paginas.pricing;
  if (p.movil.estado !== 'por-reverificar' || p.movil.por !== 'Revisor') throw new Error(JSON.stringify(p.movil));
  if (p.figma.estado !== 'aprobada') throw new Error('toco una etapa ANTERIOR');
});
prueba('con escritorio reabierto, movil no se reverifica todavia', () => exige(a.corre('reverifica', 'movil', '--pagina', 'pricing', ...VERDE), 1, /escritorio/, 'reverifica'));
prueba('cerrado escritorio, movil se reverifica y recupera su aprobado', () => {
  aprueba(a, 'escritorio');
  exige(a.corre('reverifica', 'movil', '--pagina', 'pricing', ...VERDE), 0, /recupera el aprobado de Revisor/, 'reverifica');
});
prueba('reabrir sin motivo no se permite', () => exige(a.corre('reabre', 'tablet', '--pagina', 'pricing'), 2, /--motivo/, 'reabre'));

console.log('\nEl tablero:');
prueba('estado --json dice la siguiente accion de cada pagina', () => {
  const j = JSON.parse(a.corre('estado', '--json').out);
  if (!/^tablet: reverificar/.test(j.paginas.pricing.siguiente)) throw new Error(j.paginas.pricing.siguiente);
  if (!/^figma: se puede abrir/.test(j.paginas.home.siguiente)) throw new Error(j.paginas.home.siguiente);
});
prueba('una pagina que no esta en el config se rechaza', () => exige(a.corre('puede', 'movil', '--pagina', 'inventada'), 2, /no esta en/, 'puede'));

for (const x of [a, b, c, d]) rmSync(x.dir, { recursive: true, force: true });
console.log(`\n${ok} ok · ${mal} fallo(s)\n${mal ? 'COMPUERTA NO VALIDADA' : 'COMPUERTA VALIDADA'}\n`);
process.exit(mal ? 1 : 0);
