#!/usr/bin/env node
/**
 * Test de regresion de la regla concentrica.
 *
 * Va contra `evalua()` directamente, con cajas escritas a mano: sin navegador y sin Figma, asi que
 * corre en milisegundos y no depende de que ningun sitio este en pie. Lo que se prueba es la REGLA,
 * que es la parte que se puede romper al tocar umbrales.
 *
 * Si cambias `esquinaMax`, la tolerancia, o el criterio de "esquinado", este archivo tiene que
 * cambiar en la misma edicion. Esta duplicado a proposito respecto al script: asi una regresion
 * falla ruidosamente en vez de pasar en silencio.
 *
 *   node tests/radios-anidados.test.mjs
 */
import { evalua } from '../scripts/audita-radios-anidados.mjs';

const caja = (nombre, x, y, w, h, r) => ({ nombre, x, y, w, h, r: Array.isArray(r) ? r : [r, r, r, r] });

const casos = [
  {
    nombre: 'concentrico correcto: 12 + 8 = 20',
    par: { fuera: caja('caja', 0, 0, 200, 60, 20), dentro: caja('btn', 8, 8, 184, 44, 12) },
    esperado: 0,
  },
  {
    nombre: 'mismo numero que la pieza: las cuatro esquinas fallan',
    par: { fuera: caja('caja', 0, 0, 200, 60, 12), dentro: caja('btn', 8, 8, 184, 44, 12) },
    esperado: 4,
  },
  {
    nombre: 'pieza no esquinada (separacion > esquinaMax): la regla no aplica',
    par: { fuera: caja('caja', 0, 0, 400, 300, 12), dentro: caja('btn', 100, 100, 200, 100, 12) },
    esperado: 0,
  },
  {
    // izq 8 · sup 24 · der 32 · inf 16 — ninguna de las cuatro esquinas empareja, asi que ninguna
    // es un padding y la regla no aplica en ninguna. (La primera version de este caso daba 24/24 y
    // 8/8 en dos esquinas sin querer: eran paddings de verdad y el auditor hacia bien en marcarlas.)
    nombre: 'separaciones distintas en las cuatro esquinas: no es un padding, no aplica',
    par: { fuera: caja('caja', 0, 0, 200, 60, 12), dentro: caja('btn', 8, 24, 160, 20, 12) },
    esperado: 0,
  },
  {
    nombre: 'pieza sin radio: nada que concentrar',
    par: { fuera: caja('caja', 0, 0, 200, 60, 20), dentro: caja('btn', 8, 8, 184, 44, 0) },
    esperado: 0,
  },
  {
    nombre: 'la pieza se sale del contenedor: no es anidamiento',
    par: { fuera: caja('caja', 0, 0, 200, 60, 20), dentro: caja('btn', -8, -8, 216, 76, 12) },
    esperado: 0,
  },
  {
    nombre: 'radios por esquina: solo falla la que esta mal',
    par: { fuera: caja('caja', 0, 0, 200, 60, [20, 20, 12, 20]), dentro: caja('btn', 8, 8, 184, 44, 12) },
    esperado: 1,
  },
  {
    nombre: 'dentro de tolerancia (19.6 vs 20): pasa',
    par: { fuera: caja('caja', 0, 0, 200, 60, 19.6), dentro: caja('btn', 8, 8, 184, 44, 12) },
    esperado: 0,
  },
];

let fallos = 0;
for (const c of casos) {
  const r = evalua([c.par]);
  const ok = r.length === c.esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.nombre}${ok ? '' : `  (esperaba ${c.esperado}, dio ${r.length})`}`);
  if (!ok) r.forEach((h) => console.log(`         ${h.esquina}: tiene ${h.tiene}, debe ${h.debe}`));
}
console.log(`\n${casos.length - fallos}/${casos.length} de la regla concentrica`);
process.exit(fallos ? 1 : 0);
