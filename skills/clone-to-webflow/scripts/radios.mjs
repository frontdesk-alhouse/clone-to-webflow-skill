#!/usr/bin/env node
/**
 * Audita el radio de esquina de cada caja contra la escala del cliente (`radios.escala` del
 * config), que va por LADO MENOR de la superficie. Con el lado MAYOR una foto vertical de
 * 424x520 caeria en el radio de panel y rompe la lectura de tarjeta: el lado menor es el que
 * gobierna como se percibe la curvatura.
 *
 * Se mide la caja RENDERIZADA, no el CSS: lo que importa es lo que se ve. Un radio vinculado a
 * un token puede quedar inerte si la clase conserva los cuatro longhands, y la respuesta de la
 * API no lo delata.
 *
 *   node scripts/radios.mjs [ancho=390] [url|local]
 */
import { chromium } from 'playwright';
import { BASE, CFG } from './config.mjs';

const destino = process.argv[3];
const URL = !destino ? `${BASE}/?v=${Date.now()}`
  : destino.startsWith('http') ? destino
  : 'file://' + process.cwd() + '/' + destino.replace(/^\.\//, '');
const ancho = +process.argv[2] || 390;

/* [[ladoMenorMinimo, radio], ...] de mayor a menor. El primer umbral que se cumple manda. */
const ESCALA = (CFG.radios?.escala ?? [[500, 64], [300, 32], [0, 16]])
  .slice().sort((a, b) => b[0] - a[0]);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: ancho, height: ancho > 767 ? 900 : 844 }, deviceScaleFactor: 1 });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1800);
const filas = await p.evaluate(({ ESCALA }) => {
  const toca = (menor) => (ESCALA.find(([min]) => menor >= min) ?? [0, 0])[1];
  return [...document.querySelectorAll('*')].map(e => {
    const c = getComputedStyle(e);
    const r = parseFloat(c.borderTopLeftRadius) || 0;
    if (!r || c.display === 'none' || !e.className || typeof e.className !== 'string') return null;
    const q = e.getBoundingClientRect();
    const menor = Math.round(Math.min(q.width, q.height));
    if (menor < 34) return null;
    /* Una caja es SUPERFICIE DEL SITIO si ningun ancestro lleva radio. Lo que va dentro de otra
       caja redondeada es cromo de una maqueta —la ventanita de una app dibujada dentro de una
       captura—, y ese tiene su propia escala en miniatura: no se rige por la del sitio ni debe
       tocarse. Sin esta separacion la auditoria marca 23 falsos positivos. */
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      if (parseFloat(getComputedStyle(a).borderTopLeftRadius) > 0) return null;
    }
    return { cls: e.className.split(' ')[0], w: Math.round(q.width), h: Math.round(q.height),
             menor, r: Math.round(r * 100) / 100, debe: toca(menor) };
  }).filter(Boolean);
}, { ESCALA });
const vistos = new Map();
for (const f of filas) if (!vistos.has(f.cls)) vistos.set(f.cls, f);
console.log(`\n  ${ancho}px — ${vistos.size} cajas con radio\n`);
console.log('  ' + 'clase'.padEnd(24) + 'caja'.padEnd(14) + 'lado menor'.padEnd(12) + 'radio'.padEnd(9) + 'escala   ');
for (const f of [...vistos.values()].sort((a, b) => b.menor - a.menor)) {
  const ok = Math.abs(f.r - f.debe) < 0.6;
  console.log('  ' + f.cls.padEnd(24) + `${f.w}x${f.h}`.padEnd(14) + String(f.menor).padEnd(12) +
    String(f.r).padEnd(9) + String(f.debe).padEnd(6) + (ok ? ' ok' : ' <-- NO CUADRA'));
}
await b.close();
