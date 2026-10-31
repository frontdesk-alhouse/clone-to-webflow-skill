#!/usr/bin/env node
/**
 * Inventario de las DOS capas de CSS del sitio.
 *
 * Un sitio portado desde Figma tiene los estilos repartidos en dos sitios que no se hablan:
 *   1. la hoja NATIVA de Webflow (`<shortName>.webflow.shared.*.css`), que es la que gobierna el
 *      Designer y la que una pagina de estilos puede editar;
 *   2. el CSS dentro de bloques <style> de embed, que vive en el <body> y por tanto GANA por
 *      orden a la hoja del <head>.
 *
 * La consecuencia practica: hay clases donde el Designer ensena un valor y el sitio pinta otro.
 * Este script lo mide en vez de suponerlo, y deja el resultado en spec/inventario-estilos.json
 * para poder comparar el antes y el despues de cada fase.
 *
 *   node scripts/inventario-estilos.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { BASE, PAGINAS, rutaDe } from './config.mjs';

const SALIDA = 'spec/inventario-estilos.json';

const baja = async (url) => {
  const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error(`${r.status} en ${url}`);
  return r.text();
};

const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const bloquesStyle = (html) =>
  [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);

/** Declaraciones por clase, pero SOLO de selectores de clase simple: son los unicos que
 *  Webflow sabe expresar nativamente, y por tanto los unicos reconciliables.
 *
 *  Se anota si la regla vive dentro de un @media, porque ESE es el discriminador que separa
 *  un override responsive legitimo de una deriva. Clasificar por nombre de propiedad no sirve:
 *  una banda cambia `font-size` y `line-height` con todo el derecho. */
const reglasSimples = (css) => {
  const limpio = sinComentarios(css);
  const fuera = new Map();
  let prof = 0, enMedia = 0;   // profundidad de llaves y a que profundidad abrio el @media
  const re = /@media[^{]*\{|([^{}@]+)\{([^{}]*)\}|\{|\}/g;
  for (const m of limpio.matchAll(re)) {
    const t = m[0];
    if (t.startsWith('@media')) { if (!enMedia) enMedia = prof + 1; prof++; continue; }
    if (t === '{') { prof++; continue; }
    if (t === '}') { prof--; if (enMedia && prof < enMedia) enMedia = 0; continue; }
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (!/^\.(vt-[A-Za-z0-9_-]+)$/.test(sel)) continue;
    const clase = sel.slice(1);
    const props = fuera.get(clase) ?? {};
    for (const dec of m[2].split(';')) {
      const i = dec.indexOf(':');
      if (i < 0) continue;
      const nombre = dec.slice(0, i).trim().toLowerCase();
      props[nombre] = { valor: dec.slice(i + 1).trim().replace(/\s+/g, ' '), enMedia: !!enMedia };
    }
    fuera.set(clase, props);
  }
  return fuera;
};

const clasesMencionadas = (css) =>
  new Set([...sinComentarios(css).matchAll(/\.(vt-[A-Za-z0-9_-]+)/g)].map((m) => m[1]));

/** Familias de valores: lo que se convierte en token. */
const familias = (css) => {
  const c = sinComentarios(css);
  const cuenta = (re, norm = (x) => x) => {
    const m = new Map();
    for (const x of c.matchAll(re)) {
      const k = norm(x[1]);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  return {
    color: cuenta(/(#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b)/g, (x) => x.toLowerCase()),
    radio: cuenta(/border-radius:\s*([^;}]+)/g, (x) => x.trim()),
    tamano: cuenta(/font-size:\s*([0-9.]+px)/g),
    familia: cuenta(/font-family:\s*([^;}]+)/g, (x) => x.trim()),
  };
};

// ── recogida ────────────────────────────────────────────────────────────────
const html = Object.fromEntries(
  await Promise.all(PAGINAS.map(async (p) => [p || 'home', await baja(rutaDe(p))])),
);

const urlHoja = (Object.values(html)[0].match(/href="([^"]*website-files[^"]*\.css[^"]*)"/) ?? [])[1];
if (!urlHoja) throw new Error('no encuentro la hoja compartida de Webflow en el HTML');
const cssNativo = await baja(urlHoja);

let cssEmbed = '';
const porPagina = {};
for (const [nombre, h] of Object.entries(html)) {
  const bl = bloquesStyle(h);
  const unido = bl.join('\n');
  cssEmbed += '\n' + unido;
  porPagina[nombre] = {
    bloques: bl.length,
    bytes: unido.length,
    clases: clasesMencionadas(unido).size,
  };
}

// ── cruce ───────────────────────────────────────────────────────────────────
const nativas = clasesMencionadas(cssNativo);
const embebidas = clasesMencionadas(cssEmbed);
const soloEmbed = [...embebidas].filter((c) => !nativas.has(c)).sort();
const enAmbas = [...embebidas].filter((c) => nativas.has(c)).sort();

const simplesNat = reglasSimples(cssNativo);
const simplesEmb = reglasSimples(cssEmbed);

const cubos = { ruido: [], deriva: [], responsive: [] };
const conflictosPorProp = new Map();

for (const clase of [...simplesEmb.keys()].filter((c) => simplesNat.has(c)).sort()) {
  const a = simplesNat.get(clase), b = simplesEmb.get(clase);
  const comunes = Object.keys(b).filter((p) => p in a);
  const choques = comunes
    .filter((p) => a[p].valor !== b[p].valor)
    .map((p) => ({ prop: p, nativa: a[p].valor, embed: b[p].valor, enMedia: b[p].enMedia }));

  if (!choques.length) {
    cubos[comunes.length ? 'ruido' : 'responsive'].push({
      clase, nota: comunes.length ? 'valor identico' : 'solo anade',
    });
    continue;
  }
  for (const ch of choques) conflictosPorProp.set(ch.prop, (conflictosPorProp.get(ch.prop) ?? 0) + 1);

  // El discriminador es el CONTEXTO, no la propiedad: si todo lo que choca vive dentro de un
  // @media, es una banda haciendo su trabajo. Si algo choca a nivel raiz, eso es deriva: dos
  // fuentes de verdad para el mismo valor incondicional.
  const todoEnMedia = choques.every((ch) => ch.enMedia);
  cubos[todoEnMedia ? 'responsive' : 'deriva'].push({
    clase,
    choques: todoEnMedia ? choques : choques.filter((ch) => !ch.enMedia),
  });
}

const informe = {
  generado: null, // se estampa fuera: Date.now() no es reproducible dentro del harness
  fuente: { base: BASE, hoja: urlHoja, paginas: PAGINAS.map((p) => p || 'home') },
  porPagina,
  capas: {
    nativas: nativas.size,
    embebidas: embebidas.size,
    soloEmbed: soloEmbed.length,
    enAmbas: enAmbas.length,
    embedBloques: Object.values(porPagina).reduce((s, p) => s + p.bloques, 0),
    embedBytes: Object.values(porPagina).reduce((s, p) => s + p.bytes, 0),
  },
  clasesSimplesEnAmbas: simplesEmb.size && [...simplesEmb.keys()].filter((c) => simplesNat.has(c)).length,
  cubos: {
    ruido: cubos.ruido.length,
    deriva: cubos.deriva.length,
    responsive: cubos.responsive.length,
  },
  conflictosPorProp: [...conflictosPorProp].sort((a, b) => b[1] - a[1]),
  detalle: cubos,
  valores: { nativo: familias(cssNativo), embed: familias(cssEmbed) },
  soloEmbed,
};

mkdirSync(dirname(SALIDA), { recursive: true });
writeFileSync(SALIDA, JSON.stringify(informe, null, 1));

// ── resumen legible ─────────────────────────────────────────────────────────
const { capas, cubos: cb } = informe;
console.log(`\n  hoja nativa: ${urlHoja.split('/').pop()}`);
console.table(porPagina);
console.log(`  clases vt-* nativas ......... ${capas.nativas}`);
console.log(`  clases vt-* en embed ........ ${capas.embebidas}  (${capas.embedBloques} bloques, ${(capas.embedBytes / 1024).toFixed(0)} KB)`);
console.log(`    · solo en embed ........... ${capas.soloEmbed}   ← el Designer NO las gobierna`);
console.log(`    · en ambas ................ ${capas.enAmbas}   ← el embed pisa a la clase`);
console.log(`\n  de las que son selector de clase SIMPLE en ambas capas:`);
console.log(`    A · ruido (valor identico) . ${cb.ruido}   → borrable del embed, sin riesgo`);
console.log(`    B · deriva real ............ ${cb.deriva}   → subir el valor bueno a la clase`);
console.log(`    C · responsive legitimo .... ${cb.responsive}   → se queda, se documenta`);
console.log(`\n  propiedades que mas chocan:`, informe.conflictosPorProp.slice(0, 8).map(([p, n]) => `${p}×${n}`).join('  '));
console.log(`\n  → ${SALIDA}\n`);
