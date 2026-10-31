#!/usr/bin/env node
/**
 * Huella del sitio publicado, para saber si algo cambio desde la ultima corrida — y QUIEN lo cambio.
 *
 * ES EL PRIMER PASO DE LA RE-ENTRADA, y va antes que cualquier arreglo. Si el sitio cambio y no lo
 * cambio el harness, lo cambio una persona: ese cambio es la nueva verdad y se incorpora al spec.
 * No se revierte para que cuadre con un spec viejo. Auditar contra una referencia caduca produce un
 * informe que pide deshacer lo que el cliente ya aprobo, y eso ya paso.
 *
 * QUE SE MIDE Y POR QUE ASI. Se baja el HTML publicado con fetch y se separan tres huellas por
 * pagina, porque saber QUE capa se movio dice quien la movio:
 *   estructura  el arbol de etiquetas y clases, sin texto     → cambio de maquetacion
 *   texto       solo el contenido visible                     → cambio de copy
 *   estilo      los <style> en linea + los href de las hojas  → cambio en el Designer o en un embed
 *
 * Se mide sobre el HTML SERVIDO, nunca sobre la respuesta de la API ni sobre el archivo del repo:
 * la API puede aceptar una escritura y el sitio servir otra cosa, y una hoja editada en vivo hace
 * que el archivo del repo deje de ser la verdad.
 *
 *   node scripts/detecta-deriva.mjs registra    guarda la huella actual como referencia
 *   node scripts/detecta-deriva.mjs             compara contra la ultima registrada
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { BASE, PAGINAS, etiquetaDe, rutaDe } from './config.mjs';

const SALIDA = 'spec/huella.json';
const registra = process.argv[2] === 'registra';

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Arbol de etiquetas y clases, sin texto: cambia si se mueve la maquetacion, no si se mueve el copy. */
function estructura(html) {
  const cuerpo = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const etiquetas = [...cuerpo.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)].map(([, tag, attrs]) => {
    const cls = attrs.match(/\bclass\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    const id = attrs.match(/\bid\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    return `${tag.toLowerCase()}${id ? '#' + id : ''}${cls ? '.' + cls.trim().split(/\s+/).join('.') : ''}`;
  });
  return { hash: sha(etiquetas.join('\n')), n: etiquetas.length };
}

/** Texto visible, normalizado. */
function texto(html) {
  const t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { hash: sha(t), n: t.length };
}

/** Los <style> en linea y las hojas enlazadas. Es la capa que se toca desde el Designer. */
function estilo(html) {
  const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const hojas = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
    .map((m) => m[0].match(/href=["']([^"']+)["']/i)?.[1] ?? '')
    // El nombre de la hoja de Webflow lleva un hash que cambia en CADA publicacion. Sin quitarlo,
    // toda publicacion pareceria un cambio de estilo y la senal no valdria para nada.
    .map((h) => h.replace(/\.[a-f0-9]{6,}\./g, '.HASH.').replace(/\?.*$/, ''));
  const norm = inline.map((c) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim());
  return { hash: sha([...hojas, ...norm].join('\n')), bloques: inline.length, bytes: norm.join('').length };
}

async function huella() {
  const out = {};
  for (const pagina of PAGINAS) {
    const url = rutaDe(pagina);   // respeta cfg.rutas (pagina movida con 301)
    let html;
    try {
      const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
      if (!r.ok) { out[etiquetaDe(pagina)] = { error: `${r.status}` }; continue; }
      html = await r.text();
    } catch (e) {
      out[etiquetaDe(pagina)] = { error: e.message }; continue;
    }
    out[etiquetaDe(pagina)] = { url, estructura: estructura(html), texto: texto(html), estilo: estilo(html) };
  }
  return out;
}

const ahora = await huella();

if (registra) {
  mkdirSync('spec', { recursive: true });
  const previo = existsSync(SALIDA) ? JSON.parse(readFileSync(SALIDA, 'utf8')) : null;
  writeFileSync(SALIDA, JSON.stringify({
    // La marca de tiempo entra por argumento del entorno o se omite: los scripts de este harness
    // no inventan fechas, para que dos corridas del mismo estado den el mismo archivo.
    registrado: process.env.C2W_FECHA || null,
    anterior: previo?.registrado ?? null,
    paginas: ahora,
  }, null, 2));
  console.log(`\n  Huella registrada — ${Object.keys(ahora).length} pagina(s) en ${SALIDA}\n`);
  for (const [p, v] of Object.entries(ahora)) {
    console.log(v.error ? `  ${p.padEnd(24)} ERROR ${v.error}`
      : `  ${p.padEnd(24)} estructura ${v.estructura.hash}  texto ${v.texto.hash}  estilo ${v.estilo.hash}`);
  }
  console.log();
  process.exit(0);
}

if (!existsSync(SALIDA)) {
  console.error(`\nNo hay huella registrada (${SALIDA}).\n` +
                `Registra una antes de poder detectar deriva:\n\n  node scripts/detecta-deriva.mjs registra\n`);
  process.exit(2);
}

const antes = JSON.parse(readFileSync(SALIDA, 'utf8')).paginas;
const cambios = [];
const CAPAS = [
  ['estructura', 'maquetacion — se movieron elementos o clases'],
  ['texto',      'copy — cambio el contenido visible'],
  ['estilo',     'estilos — se toco el Designer o un embed'],
];

console.log(`\n  ${BASE}\n`);
for (const [p, v] of Object.entries(ahora)) {
  const a = antes[p];
  if (!a) { console.log(`  ${p.padEnd(24)} NUEVA — no estaba en la huella`); cambios.push(`${p}: pagina nueva`); continue; }
  if (v.error || a.error) { console.log(`  ${p.padEnd(24)} ERROR ${v.error ?? a.error}`); continue; }
  const movidas = CAPAS.filter(([k]) => v[k].hash !== a[k].hash);
  if (!movidas.length) { console.log(`  ${p.padEnd(24)} sin cambios`); continue; }
  console.log(`  ${p.padEnd(24)} CAMBIO en ${movidas.map(([k]) => k).join(', ')}`);
  for (const [k, desc] of movidas) {
    const det = k === 'estilo'
      ? `${a[k].bloques}→${v[k].bloques} bloques, ${a[k].bytes}→${v[k].bytes} bytes`
      : `${a[k].n}→${v[k].n}`;
    console.log(`      ${k.padEnd(12)} ${desc}  (${det})`);
    cambios.push(`${p} · ${k}: ${desc}`);
  }
}
for (const p of Object.keys(antes)) {
  if (!(p in ahora)) { console.log(`  ${p.padEnd(24)} YA NO SE MIDE — esta en la huella pero no en config.paginas`); }
}

if (!cambios.length) {
  console.log(`\n  Sin deriva. El sitio publicado es el mismo que se registro.\n`);
  process.exit(0);
}

console.log(`\n  DERIVA DETECTADA — ${cambios.length} cambio(s).`);
console.log(`
  Antes de tocar nada, resolver la procedencia:
    · Si lo cambio el harness, registra la huella nueva y sigue.
    · Si lo cambio una persona, ESE cambio es la nueva verdad. Se incorpora al spec y se repinta
      el frame de Figma. No se revierte para que cuadre con el spec anterior.
  Y solo despues: linea base nueva (foto-sitio.mjs antes) y re-correr los gates.
`);
process.exit(1);
