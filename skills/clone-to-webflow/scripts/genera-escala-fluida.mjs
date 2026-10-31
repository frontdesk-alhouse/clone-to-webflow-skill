#!/usr/bin/env node
/**
 * Genera la escala fluida como tokens `clamp()` topados en `fluido.anchoTope`.
 *
 * POR QUE ESTE SCRIPT EXISTE. Escalar es la forma mas sencilla de hacer un sitio responsivo, y
 * tambien la que mas veces se ha roto aqui. Los fallos medidos no venian de `clamp()`: venian de
 * escalar POR ENCIMA una composicion de coordenadas fijas (`zoom` sobre el body, `transform` sobre
 * un hero cuyo motor mide en vivo). La fluidez es una propiedad de la composicion, no una tecnica
 * que se aplica despues. Este generador produce la mitad correcta —la escala— y
 * `audita-regimen.mjs` se encarga de que solo se aplique donde la composicion la admite.
 *
 * LA FORMULA, y por que topa exactamente en el tope:
 *
 *     pendiente = (max - min) / (anchoTope - anchoMin)
 *     corte     = min - pendiente * anchoMin
 *     token     = clamp(<min>px, <corte/16>rem + <pendiente*100>vw, <max>px)
 *
 *   en anchoMin  -> corte + pendiente*anchoMin = min   (exacto)
 *   en anchoTope -> corte + pendiente*anchoTope = max  (exacto)
 *   por encima   -> el `max` de clamp() manda: la tipografia deja de crecer sin media query.
 *
 * El corte va en `rem` y no en `px` a proposito: asi el token sigue respetando el tamano de fuente
 * que el usuario haya configurado en su navegador. La parte `vw` no puede hacerlo, pero el corte
 * es la mayor parte del valor en los anchos pequenos, que es donde importa.
 *
 * DOS AVISOS QUE NO SE PUEDEN ARREGLAR AQUI:
 *  - `100vw` incluye la barra de scroll clasica (~15 px en Windows) y `clientWidth` no. Para ANCHOS
 *    se prefiere `100%` de un contenedor topado; `vw` esta bien para tamanos de texto y espaciado,
 *    donde 15 px de viewport son decimas de pixel de resultado.
 *  - Un token de tamano con `clamp()` entra en Webflow como Variable con `custom_value`, no como
 *    valor tipado. La salida de aqui trae ya el payload listo.
 *
 * Entrada:  spec/escala-entrada.json   { "grupo": { "token": [min, max], ... }, ... }
 *           Un token con min === max es FIJO (una pieza, no una superficie) y sale en px pelados.
 *
 *   node scripts/genera-escala-fluida.mjs              genera spec/escala-fluida.json + CSS
 *   node scripts/genera-escala-fluida.mjs --verifica   resuelve cada token en un barrido de anchos
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { CFG } from './config.mjs';

const ENTRADA = 'spec/escala-entrada.json';
const SALIDA  = 'spec/escala-fluida.json';
const CSS     = 'spec/escala-fluida.css';

const MIN  = CFG.fluido?.anchoMin  ?? 390;
const TOPE = CFG.fluido?.anchoTope ?? 1440;
const verifica = process.argv.includes('--verifica');

if (!existsSync(ENTRADA)) {
  console.error(`\nFalta ${ENTRADA}. Formato:\n\n` +
`{
  "texto":   { "cuerpo": [15, 17], "h3": [22, 28], "h1": [34, 64] },
  "espacio": { "seccion": [64, 120], "bloque": [24, 40] }
}\n
Cada par es [valor en ${MIN}px, valor en ${TOPE}px]. Si los dos son iguales, el token es fijo.\n`);
  process.exit(2);
}
if (TOPE <= MIN) {
  console.error(`\nfluido.anchoTope (${TOPE}) tiene que ser mayor que fluido.anchoMin (${MIN}).\n`);
  process.exit(2);
}

const r4 = (n) => Math.round(n * 10000) / 10000;
const r2 = (n) => Math.round(n * 100) / 100;

/** Traduce un par [min, max] al token CSS y guarda las piezas para poder verificarlo. */
function token(nombre, min, max) {
  if (typeof min !== 'number' || typeof max !== 'number') throw new Error(`${nombre}: [min, max] tienen que ser numeros`);
  if (max < min) throw new Error(`${nombre}: max (${max}) es menor que min (${min}). Un token no encoge al crecer la ventana.`);
  if (min === max) return { nombre, min, max, fijo: true, css: `${min}px` };
  const pendiente = (max - min) / (TOPE - MIN);
  const corte = min - pendiente * MIN;
  const vw = r4(pendiente * 100);
  const rem = r4(corte / 16);
  // El corte puede ser negativo (escalas muy abiertas): `calc()` lo admite y clamp() lo acota.
  const preferido = `${rem}rem + ${vw}vw`;
  // Se guardan los coeficientes YA REDONDEADOS, que son los que de verdad van al CSS. Verificar
  // contra la matematica ideal en vez de contra lo que se emite deja pasar el error del
  // redondeo, que es justo el que nadie mira: con `pendiente` a 4 decimales, 1440px de viewport
  // multiplican la diferencia hasta media decima de pixel. Se comprueba lo que se entrega.
  return { nombre, min, max, fijo: false, pendiente: vw / 100, corte: rem * 16,
           css: `clamp(${min}px, calc(${preferido}), ${max}px)` };
}

/** Resuelve el valor que el navegador daria a un ancho dado. Es la comprobacion, no el token. */
const resuelve = (t, w) => t.fijo ? t.min : Math.min(t.max, Math.max(t.min, t.corte + t.pendiente * w));

const entrada = JSON.parse(readFileSync(ENTRADA, 'utf8'));
const grupos = {};
const planos = [];
for (const [grupo, tokens] of Object.entries(entrada)) {
  if (grupo.startsWith('_')) continue;
  grupos[grupo] = {};
  for (const [nombre, par] of Object.entries(tokens)) {
    const t = token(`${grupo}/${nombre}`, par[0], par[1]);
    grupos[grupo][nombre] = t;
    planos.push(t);
  }
}

// ---- Comprobacion de la propia formula, antes de emitir nada ----
const errores = [];
for (const t of planos) {
  if (t.fijo) continue;
  const enMin = resuelve(t, MIN), enTope = resuelve(t, TOPE);
  if (Math.abs(enMin - t.min) > 0.01) errores.push(`${t.nombre}: en ${MIN}px da ${r2(enMin)}, esperaba ${t.min}`);
  if (Math.abs(enTope - t.max) > 0.01) errores.push(`${t.nombre}: en ${TOPE}px da ${r2(enTope)}, esperaba ${t.max}`);
  for (const w of [TOPE + 480, TOPE * 2, 3440]) {
    if (resuelve(t, w) > t.max + 0.01) errores.push(`${t.nombre}: sigue creciendo en ${w}px (${r2(resuelve(t, w))} > ${t.max})`);
  }
}
if (errores.length) {
  console.error(`\nLa escala generada no cumple su propio contrato (${errores.length}):`);
  errores.forEach((e) => console.error(`  · ${e}`));
  process.exit(1);
}

if (verifica) {
  const anchos = [320, MIN, 768, 1024, 1200, TOPE, 1920, 2560, 3440];
  console.log('\n  ' + 'token'.padEnd(24) + anchos.map((w) => String(w).padStart(8)).join(''));
  for (const t of planos) {
    console.log('  ' + t.nombre.padEnd(24) + anchos.map((w) => String(r2(resuelve(t, w))).padStart(8)).join('') +
                (t.fijo ? '   (fijo)' : ''));
  }
  console.log(`\n  El tope esta en ${TOPE}px: de ahi en adelante ningun token crece.\n`);
  process.exit(0);
}

mkdirSync('spec', { recursive: true });

// Payloads listos para data_variable_tool > create_size_variable con custom_value.
const variables = planos.map((t) => ({
  name: t.nombre.replace('/', '-'),
  custom_value: t.css,
  _nota: t.fijo ? 'fijo — pieza, no superficie' : `${t.min}px en ${MIN} → ${t.max}px en ${TOPE}, topado`,
}));

writeFileSync(SALIDA, JSON.stringify({ anchoMin: MIN, anchoTope: TOPE, grupos, variables }, null, 2));

const css = [
  `/* Escala fluida — generada por genera-escala-fluida.mjs. No editar a mano. */`,
  `/* ${MIN}px → ${TOPE}px, topada: por encima de ${TOPE}px ningun valor crece. */`,
  `:root {`,
  ...planos.map((t) => `  --${t.nombre.replace('/', '-')}: ${t.css};`),
  `}`,
].join('\n');
writeFileSync(CSS, css + '\n');

console.log(`\n  ${planos.length} tokens · ${MIN}px → ${TOPE}px, topados\n`);
for (const t of planos) console.log(`  ${t.nombre.padEnd(24)} ${t.css}`);
console.log(`\n  ${SALIDA}   (incluye los payloads para data_variable_tool)`);
console.log(`  ${CSS}\n`);
