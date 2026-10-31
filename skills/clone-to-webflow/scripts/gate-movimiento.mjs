#!/usr/bin/env node
/**
 * Gate del contrato de movimiento: comprueba `spec/movimiento.json` contra el sitio publicado.
 *
 * La pregunta que responde: «¿se mueve lo que dijimos que se mueve, en el ancho que dijimos?».
 * Nace de un fallo real: la banda de tablet de Solutions ocultaba `.vt-sf`, que es donde vive el
 * motor del scrollytelling, y la seccion se quedo quieta durante semanas sin que nada avisara —
 * el motor abandona con `if (!sec.offsetHeight) return`, en silencio.
 *
 *   node scripts/gate-movimiento.mjs                 → todas las paginas, los tres anchos
 *   node scripts/gate-movimiento.mjs home 1440
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';

import { BASE, PAGINAS, ANCHOS, etiquetaDe, rutaDe } from './config.mjs';

// Sin contrato no hay gate. Un stack de ENOENT no le dice a nadie que hacer, y este es el
// archivo que un cliente nuevo todavia no tiene: el fallo tiene que ensenar el formato.
if (!existsSync('spec/movimiento.json')) {
  console.error(`
Falta spec/movimiento.json — el contrato de movimiento, que es lo que este gate comprueba.

Declara que se mueve, donde, y en que ancho. Ejemplo:

{
  "paginas": {
    "home": {
      "secciones": {
        "hero":  { "sel": "#hero",  "selMovil": "#m-hero", "revela": true },
        "cifra": { "sel": "#cifra", "revela": true }
      }
    }
  }
}

Nace de un fallo real: una banda de tablet ocultaba la seccion donde vive el motor del
scrollytelling y la seccion se quedo quieta durante semanas sin que nada avisara — el motor
abandona en silencio con \`if (!sec.offsetHeight) return\`.
`);
  process.exit(2);
}
const CONTRATO = JSON.parse(readFileSync('spec/movimiento.json', 'utf8'));
const MIN_REVELADO = 1;

/* Los anchos salen del CONTRATO, no del config. El contrato esta indexado por ancho ("390",
   "820", "1440"); si el gate mide los anchos del config ([390, 768, 1440]) y el contrato dice 820,
   a 768 el `debe` sale vacio y la seccion cae en el caso "sin compromiso", que nunca falla. Asi se
   apago el gate de tablet en silencio al cambiar de motor. Si el contrato no declara `anchos`, se
   cae al config DICIENDOLO. */
const ANCHOS_CONTRATO = CONTRATO.anchos
  ? [...new Set(Object.values(CONTRATO.anchos).map(Number).filter(Boolean))].sort((a, b) => a - b)
  : null;
if (!ANCHOS_CONTRATO) {
  console.error(`  AVISO: spec/movimiento.json no declara "anchos"; se miden los del config (${ANCHOS.join(', ')}).\n` +
    `  Declara "anchos": { "movil": 390, "tablet": 820, "escritorio": 1440 } para que el contrato mande.`);
}
const ANCHOS_GATE = ANCHOS_CONTRATO ?? ANCHOS;   // elementos que deben cambiar transform u opacity para contar como revelado

/* Etiqueta del contrato -> slug publicado. Sale de `paginas` del config: la home es '' y su
   etiqueta es 'home', el resto coincide consigo mismo. */
const URL_DE = Object.fromEntries(PAGINAS.map((p) => [etiquetaDe(p), p]));

/** Expande la entrada `solutions` a sus tres paginas reales. */
function contratosPorPagina() {
  const fuera = [];
  for (const [clave, def] of Object.entries(CONTRATO.paginas)) {
    for (const pag of def._aplica ?? [clave]) fuera.push({ pag, secciones: def.secciones });
  }
  return fuera;
}

async function observa(nav, pagina, ancho, secciones, reducido = false) {
  const p = await nav.newPage({ viewport: { width: ancho, height: 900 } });
  if (reducido) await p.emulateMedia({ reducedMotion: 'reduce' });
  /* `_aplica` del contrato trae SLUGS publicados ('' para la home), pero URL_DE esta indexado por
     ETIQUETA ('home'). Sin el fallback, URL_DE[''] es undefined, rutaDe(undefined) pide `/undefined`
     y el gate mide una pagina 404: todas las secciones salen `oculta` y el resumen dice CONTRATO
     CUMPLIDO. Un verde sobre una 404 es peor que un rojo. (Cliente C, 2026-09-30.) */
  /* Foto en DOMContentLoaded: un revelado DE CARGA (el hero, que esta sobre el pliegue, o el
     `ficha-hero` del contrato que entra «sin esperar scroll») ya termino cuando llega la foto de
     abajo, asi que recorrer no ve ningun cambio y la seccion salia QUIETA con la animacion
     funcionando. Medido en Cliente C @390: a 600 ms las opacidades iban 0.78/0.61/0.34/0.00 y a
     1200 ms ya estaban en 1. (2026-09-30.) */
  await p.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      window.__vtCarga = new Map();
      for (const e of document.querySelectorAll('*')) {
        const c = getComputedStyle(e);
        window.__vtCarga.set(e, c.transform + '|' + c.opacity);
      }
    }, { once: true });
  });
  const resp = await p.goto(rutaDe(URL_DE[pagina] ?? pagina), { waitUntil: 'load' });
  const http = resp ? resp.status() : 0;
  if (http >= 400) { await p.close(); return { http, movidos: {}, visibles: {}, pins: [], pinsDentro: {} }; }
  await p.waitForTimeout(2600);

  const r = await p.evaluate(async ({ secciones, ancho }) => {
    const clave = ancho < 768 ? 'selMovil' : 'sel';
    const elegido = {};
    for (const s of secciones) {
      const sel = (clave === 'selMovil' && s.selMovil) ? s.selMovil : s.sel;
      const el = document.querySelector(sel);
      elegido[s.id] = el && getComputedStyle(el).display !== 'none' ? { sel, el } : { sel, el: null };
    }
    // foto de transform/opacity de todo lo que cuelga de cada seccion visible
    const antes = {};
    for (const [id, { el }] of Object.entries(elegido)) {
      if (!el) { antes[id] = null; continue; }
      antes[id] = new Map();
      for (const e of el.querySelectorAll('*')) {
        const c = getComputedStyle(e);
        antes[id].set(e, c.transform + '|' + c.opacity);
      }
    }
    // recorrer entera. El alto se relee en cada paso: con contenido perezoso la pagina crece mientras se recorre
    // (Cliente A /solutions-founders @390: 6388 al cargar, 10355 al final) y un alto congelado no llegaba nunca a las
    // ultimas secciones, que salian QUIETA sin haberse visto (2026-09-14).
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 130));
    }
    const movidos = {};
    for (const [id, mapa] of Object.entries(antes)) {
      if (!mapa) { movidos[id] = null; continue; }
      let n = 0;
      const vistos = new Set();
      mapa.forEach((v, e) => {
        const c = getComputedStyle(e);
        if (c.transform + '|' + c.opacity !== v) { n++; vistos.add(e); }
      });
      /* Y lo que se movio ENTRE la carga y ahora, que es el revelado de carga. Aqui NO vale la
         comparacion exacta: al entrar la tipografia real cambia el ancho del texto y cualquier
         centrado por transform se recalcula. Medido en Cliente C: las etiquetas del stepper
         pasaban de -54.0781 a -55.1016 (1 px) y de 23.125 a 23.0469 (0.08 px) SIN animacion
         ninguna, y bajo reduced-motion eso se leia como «la pagina se mueve». Una recolocacion de
         un pixel por reflujo de fuente no es movimiento; un revelado de 24 px o una opacidad
         0 -> 1 si. */
      const carga = window.__vtCarga;
      if (carga) {
        const tr = (m) => {
          const v = /matrix3d\(([^)]+)\)/.exec(m) ? /matrix3d\(([^)]+)\)/.exec(m)[1].split(',').map(Number).slice(12, 14)
                   : /matrix\(([^)]+)\)/.exec(m) ? /matrix\(([^)]+)\)/.exec(m)[1].split(',').map(Number).slice(4, 6)
                   : [0, 0];
          return v;
        };
        const el = elegido[id].el;
        for (const e of el.querySelectorAll('*')) {
          if (vistos.has(e) || !carga.has(e)) continue;
          const c = getComputedStyle(e);
          const [a0, o0] = carga.get(e).split('|');
          const [x0, y0] = tr(a0), [x1, y1] = tr(c.transform);
          const mueve = Math.abs(+c.opacity - +o0) > 0.02 ||
                        Math.abs(x1 - x0) > 2 || Math.abs(y1 - y0) > 2;
          if (mueve) n++;
        }
      }
      movidos[id] = n;
    }
    const pins = (window.ScrollTrigger?.getAll?.() ?? [])
      .filter((t) => t.pin)
      .map((t) => (t.trigger?.className ?? '').toString().split(' ')[0] || t.trigger?.tagName || '?');
    // pin por CONTENCION: el trigger fijado cuelga de la seccion (el hero v11 fija #h11-deck dentro de .h11-hero y el
    // nombre de clase no delata a la seccion; el heuristico por nombre lo daba por SIN-PIN)
    const pinsDentro = {};
    for (const [id, { el }] of Object.entries(elegido)) pinsDentro[id] = !!el && (window.ScrollTrigger?.getAll?.() ?? []).some((t) => t.pin && t.trigger && el.contains(t.trigger));
    return { movidos, visibles: Object.fromEntries(Object.entries(elegido).map(([k, v]) => [k, !!v.el])), pins, pinsDentro };
  }, { secciones, ancho });

  await p.close();
  return r;
}

const args = process.argv.slice(2);
const pedidas = args.filter((a) => !/^\d+$/.test(a));
const anchosPedidos = args.some((a) => /^\d+$/.test(a)) ? ANCHOS_GATE.filter((w) => args.includes(String(w))) : ANCHOS_GATE;
// Un ancho pedido que el contrato no conoce no se mide "a ver": es una medicion sin compromiso.
for (const a of args.filter((x) => /^\d+$/.test(x)).map(Number)) {
  if (!ANCHOS_GATE.includes(a)) {
    console.error(`\nEl ancho ${a} no esta en el contrato (${ANCHOS_GATE.join(', ')}). Medirlo no comprueba nada.\n`);
    process.exit(2);
  }
}
const huecos = [];   // secciones con `debe` que no cubren el ancho medido

const nav = await chromium.launch();
const fallos = [];
const noPublicadas = [];   // el contrato promete movimiento en una pagina que no responde

for (const { pag, secciones } of contratosPorPagina()) {
  // El contrato nombra la home por su SLUG ('') y la ayuda del script la pide por ETIQUETA
  // ('home'): se aceptan las dos o `gate-movimiento.mjs home` filtra hasta quedarse sin nada.
  if (pedidas.length && !pedidas.includes(pag) && !pedidas.includes(etiquetaDe(pag))) continue;
  console.log(`\n── ${etiquetaDe(pag)} ──────────────────────────────────────────`);
  for (const ancho of anchosPedidos) {
    const r = await observa(nav, pag, ancho, secciones);
    if (r.http >= 400) {
      console.log(`  @${String(ancho).padEnd(5)} PAGINA NO PUBLICADA (HTTP ${r.http}) — no se mide`);
      noPublicadas.push({ pag: etiquetaDe(pag), ancho, http: r.http });
      continue;
    }
    const linea = [];
    for (const s of secciones) {
      const debe = (s.debe ?? {})[String(ancho)] ?? '';
      const n = r.movidos[s.id];
      // Una seccion CON compromisos que no dice nada de este ancho es un hueco del contrato, no un
      // "sin compromiso": el gate no puede dar verde sobre lo que el contrato no declara.
      if (s.debe && !(String(ancho) in s.debe) && r.visibles[s.id]) huecos.push({ pag, ancho, seccion: s.id, tiene: Object.keys(s.debe).join('/') });
      let estado;
      // Con compromiso en este ancho, una seccion que no esta no es «oculta»: es el compromiso incumplido.
      // Antes salia `oculta`, que nunca falla, y un contrato sobre un selector inexistente daba CUMPLIDO.
      if (!r.visibles[s.id]) estado = debe ? 'AUSENTE' : 'oculta';
      else if (/^pin/.test(debe)) {
        const hayPin = r.pinsDentro?.[s.id] || r.pins.some((c) => (s.sel + (s.selMovil ?? '')).includes(c) || c.includes(s.sel.slice(1, 8)));
        estado = hayPin ? 'pin' : (n >= MIN_REVELADO ? 'SIN-PIN' : 'QUIETA');
      } else if (/revelado|escalonado/.test(debe)) {
        estado = n >= MIN_REVELADO ? `rev(${n})` : 'QUIETA';
      } else if (/^bucle/.test(debe)) {
        // marquee / carrusel automatico: algo dentro de la seccion cambia de transform sin scroll de por medio
        estado = n >= 1 ? `bucle(${n})` : 'QUIETA';
      } else if (/^quieta/.test(debe)) {
        // compromiso de NO moverse en este ancho (p. ej. marquee solo en movil): moverse es el incumplimiento
        estado = n > 0 ? `MOVIDA(${n})` : 'quieta';
      } else estado = n > 0 ? `mov(${n})` : '—';
      if (estado === 'QUIETA' || estado === 'SIN-PIN' || estado === 'AUSENTE' || estado.startsWith('MOVIDA'))
        fallos.push({ pag, ancho, seccion: s.id, debe, visto: estado, movidos: n });
      linea.push(`${s.id}:${estado}`);
    }
    console.log(`  @${String(ancho).padEnd(5)} ${linea.join('  ')}`);
  }
}

// reduced-motion: la pagina no se mueve y no se rompe
console.log('\n── reduced-motion ─────────────────────────────────');
for (const { pag, secciones } of contratosPorPagina()) {
  // El contrato nombra la home por su SLUG ('') y la ayuda del script la pide por ETIQUETA
  // ('home'): se aceptan las dos o `gate-movimiento.mjs home` filtra hasta quedarse sin nada.
  if (pedidas.length && !pedidas.includes(pag) && !pedidas.includes(etiquetaDe(pag))) continue;
  const r = await observa(nav, pag, 1440, secciones, true);
  const total = Object.values(r.movidos).reduce((s, n) => s + (n ?? 0), 0);
  const ok = total === 0;
  console.log(`  ${pag.padEnd(20)} ${ok ? 'quieta' : `SE MUEVE (${total} elementos)`}`);
  if (!ok) fallos.push({ pag, ancho: 1440, seccion: '(reduced-motion)', debe: 'quieta', visto: `${total} se mueven` });
}

await nav.close();

// Los huecos van antes que los fallos y salen con exit 2, no 1: un contrato incompleto no es un
// sitio roto, es un instrumento que no puede medir. Y no se mezclan con el veredicto.
if (huecos.length) {
  console.log(`\n  CONTRATO INCOMPLETO — ${huecos.length} seccion(es) con compromisos que no cubren el ancho medido:\n`);
  for (const h of huecos) console.log(`   ${h.pag} @${h.ancho} · ${h.seccion}: tiene debe para ${h.tiene}, nada para ${h.ancho}`);
  console.log(`\n  O el contrato declara ese ancho en \`debe\`, o \`anchos\` del contrato deja de incluirlo. No se da verde sobre lo que no esta declarado.\n`);
  process.exit(2);
}

/* Una pagina que no responde no se cuenta como cumplida. Antes salian todas sus secciones como
   `oculta` —que nunca falla— y el resumen daba CONTRATO CUMPLIDO sobre una 404. */
if (noPublicadas.length) {
  const paginas = [...new Set(noPublicadas.map((n) => `${n.pag} (HTTP ${n.http})`))];
  console.log(`\n  SIN MEDIR — ${paginas.length} pagina(s) del contrato no responden: ${paginas.join(' · ')}`);
  console.log('  O se publican, o su entrada sale del contrato. Prometer movimiento en una pagina que no existe no se puede comprobar.');
}

console.log();
if (!fallos.length) console.log(`  CONTRATO CUMPLIDO en las paginas medidas${noPublicadas.length ? ' (ver SIN MEDIR arriba)' : ''}.\n`);
else {
  console.log(`  CONTRATO INCUMPLIDO en ${fallos.length} punto(s):\n`);
  for (const f of fallos) console.log(`   ${f.pag} @${f.ancho} · ${f.seccion}: debe «${f.debe}», se ve «${f.visto}»`);
  console.log();
}
process.exit(fallos.length ? 1 : 0);
