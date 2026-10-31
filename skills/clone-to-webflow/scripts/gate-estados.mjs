#!/usr/bin/env node
/**
 * Gate · la capa de estados: hover, focus-visible, active — y que de verdad transicionen.
 *
 *   node scripts/gate-estados.mjs [pagina...] [--ancho 1440]
 *
 * POR QUE EXISTE. En Cliente C la hoja publicada traia 21 clases `.dsn-*` con una regla
 * `:hover` y una `transition` declarada, y las 21 median `transition-duration: 0s` en el navegador.
 * El motivo era una serializacion rota del atajo:
 *
 *     transition: background-color .16s cubic-bezier(.2,0,0,1),
 *                 color undefined undefined,
 *                 transform undefined undefined;
 *
 * `transition` es una propiedad de lista separada por comas: si UN item no parsea, el navegador
 * tira la declaracion ENTERA. El hover seguia cambiando el color — instantaneamente, sin curva.
 *
 * Y no lo veia nadie. La paridad se mide en reposo y con VT_RM=1. `gate-movimiento` cobra
 * revelados de scroll, no estados de puntero. Un grep de la hoja encuentra la palabra
 * `transition` y da por hecho que hay transicion. El unico instrumento que lo caza es el
 * NAVEGADOR: `getComputedStyle`, que ya aplico el parser.
 *
 * LAS TRES COMPROBACIONES
 *
 *   E1 · `undefined` literal en cualquier declaracion. Nunca es intencional: es un valor de JS
 *        que se colo por el serializador. FAIL siempre, aunque la propiedad parezca inofensiva.
 *   E2 · Una clase con `:hover` que cambia una propiedad animable y mide duracion 0 s. FAIL.
 *        Es el caso de arriba: la intencion esta escrita y el navegador no la cumple.
 *   E3 · Un elemento ENFOCABLE (a, button, input, select, textarea, [tabindex]) cuya clase
 *        tiene `:hover` y no tiene `:focus-visible`. FAIL: el que navega con teclado no ve
 *        donde esta. WCAG 2.4.7.
 *
 * `:active` se informa, no se cobra: hay piezas donde el presionado no aporta nada.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { PAGINAS, ANCHOS, etiquetaDe, rutaDe, PREFIJO, BASE } from './config.mjs';

const args = process.argv.slice(2);
let ancho = 1440;
const pedidas = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ancho') { ancho = +args[++i] || ancho; continue; }
  if (args[i].startsWith('--')) continue;
  pedidas.push(args[i]);
}
const PFX = PREFIJO ? `${PREFIJO}-` : '';

/* Propiedades cuyo cambio en :hover el usuario espera ver transicionar. `color` y
   `background-color` incluidas a proposito: un salto de color es tan brusco como uno de forma. */
const ANIMABLES = ['background-color', 'color', 'transform', 'box-shadow', 'border-color',
                   'opacity', 'filter', 'backdrop-filter', 'border-bottom-color', 'border-top-color'];

const nav = await chromium.launch();
const fallos = [];
const informe = {};

const objetivo = (pedidas.length ? pedidas : PAGINAS.map(etiquetaDe));

for (const et of objetivo) {
  const slug = PAGINAS.includes(et) ? et : (PAGINAS.find((p) => etiquetaDe(p) === et) ?? null);
  if (slug === null) { console.log(`  ${JSON.stringify(et)}: no esta en \`paginas\` del config, se salta`); continue; }
  const p = await nav.newPage({ viewport: { width: ancho, height: 900 } });
  const resp = await p.goto(rutaDe(slug), { waitUntil: 'load' });
  const http = resp ? resp.status() : 0;
  if (http >= 400) { await p.close(); continue; }   // paginas sin publicar: las cobra gate-orden

  /* RECORRER ANTES DE MEDIR. Un estado de puntero se mide sobre la pagina ASENTADA, y hay dos
     razones por las que una foto a los 600 ms miente: las piezas por debajo del pliegue todavia
     no existen en su estado final, y una transicion puede declararse DESPUES del revelado — que
     es la cura de KL-DSN-032 cuando el motor de scroll escribe opacity/transform en linea sobre
     esa misma pieza. Sin recorrer, el gate veria esas clases a 0s y las acusaria de muertas
     estando bien. Se vuelve arriba al terminar: el hover no depende del scroll, pero el reposo si. */
  await p.evaluate(async () => {
    const paso = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += paso) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, document.body.scrollHeight);
  });
  await p.waitForTimeout(1200);        // que terminen los tweens del ultimo lote
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(400);

  /* LAS REGLAS SE LEEN DESDE NODE, NO DESDE LA PAGINA. `document.styleSheets[i].cssRules` lanza
     SecurityError para una hoja de otro origen, y la hoja de Webflow se sirve desde
     cdn.prod.website-files.com mientras la pagina esta en *.webflow.io. Un `try { } catch
     { continue }` sobre eso lee CERO reglas y el gate reporta «CAPA DE ESTADOS CORRECTA» sobre un
     sitio con 21 transiciones muertas. Medido en Cliente C el 2026-09-30: la primera version de
     este mismo gate hizo exactamente eso. Un catch que sigue adelante es un punto ciego.
     Las dos capas que hay que leer: la hoja nativa de Webflow y los <style> de los Embeds. */
  const hrefs = await p.$$eval('link[rel="stylesheet"]', (ls) => ls.map((l) => l.href));
  const inline = await p.$$eval('style', (ss) => ss.map((s) => s.textContent || ''));
  const fuentes = [...inline];
  for (const href of hrefs) {
    try {
      const res = await fetch(href);
      if (res.ok) fuentes.push(await res.text());
    } catch { /* una hoja que no baja se informa abajo como 0 reglas */ }
  }
  const CSS = fuentes.join('\n');
  if (!/\{/.test(CSS)) {
    console.log(`\n── ${et} @${ancho} ──────────────────────────────────────────`);
    console.log(`  NO SE PUDO LEER NI UNA HOJA (${hrefs.length} <link>, ${inline.length} <style>) — no se mide`);
    fallos.push({ pag: et, tipo: 'E0', n: 1 });
    await p.close();
    continue;
  }
  const REGLAS = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ sel: m[1].trim(), texto: m[2].trim() }))
    .filter((r) => r.sel && !r.sel.startsWith('@'));

  const r = await p.evaluate(({ PFX, ANIMABLES, reglas }) => {
    const crudo = [];
    const hover = new Map();     // clase base -> props animables que cambia su :hover
    const focus = new Set();
    const activo = new Set();

    const baseDe = (sel) => {
      // `.a.b:hover` -> `.a.b` ; `.a:hover .c` no se considera (el estado no es de la clase)
      const m = sel.trim().match(/^((?:\.[A-Za-z0-9_-]+)+)(:hover|:focus-visible|:active)$/);
      return m ? m[1] : null;
    };

    for (const { sel, texto } of reglas) {
      if (/\bundefined\b/.test(texto)) crudo.push({ sel, texto });
      for (const parte of sel.split(',')) {
        const b = baseDe(parte);
        if (!b) continue;
        if (!b.includes('.' + PFX.replace(/-$/, ''))) { /* no es del proyecto */ }
        if (parte.includes(':focus-visible')) { focus.add(b); continue; }
        if (parte.includes(':active')) { activo.add(b); continue; }
        const props = ANIMABLES.filter((pr) => new RegExp('(^|;|\\s)' + pr + '\\s*:').test(texto));
        if (props.length) hover.set(b, [...new Set([...(hover.get(b) ?? []), ...props])]);
        else if (!hover.has(b)) hover.set(b, []);
      }
    }

    /* Para cada base con :hover, buscar un elemento real y PREGUNTARLE AL NAVEGADOR. La hoja
       dice la intencion; solo el computed dice lo que se cumple. */
    const sinTransicion = [], sinFoco = [], noEncontradas = [];
    for (const [base, props] of hover) {
      if (!base.startsWith('.' + PFX)) continue;              // solo clases del proyecto
      const e = document.querySelector(base);
      if (!e) { noEncontradas.push(base); continue; }
      const cs = getComputedStyle(e);
      const durs = cs.transitionDuration.split(',').map((d) => parseFloat(d) || 0);
      const total = Math.max(...durs, 0);
      if (props.length && total === 0) sinTransicion.push({ base, props, dur: cs.transitionDuration });

      const enfocable = e.matches('a[href], button, input, select, textarea, [tabindex]')
                     || !!e.closest('a[href], button');
      if (enfocable && !focus.has(base)) sinFoco.push({ base, tag: e.tagName.toLowerCase() });
    }
    return {
      crudo, sinTransicion, sinFoco, noEncontradas,
      conHover: [...hover.keys()].filter((b) => b.startsWith('.' + PFX)).length,
      conActivo: [...activo].filter((b) => b.startsWith('.' + PFX)).length,
      conFoco: [...focus].filter((b) => b.startsWith('.' + PFX)).length,
    };
  }, { PFX, ANIMABLES, reglas: REGLAS });

  await p.close();
  informe[et] = r;

  console.log(`\n── ${et} @${ancho} ──────────────────────────────────────────`);
  console.log(`  ${r.conHover} con :hover · ${r.conFoco} con :focus-visible · ${r.conActivo} con :active`);

  if (r.crudo.length) {
    console.log(`\n  E1 · \`undefined\` literal en ${r.crudo.length} regla(s) — el serializador se colo:`);
    for (const c of r.crudo.slice(0, 8)) console.log(`     ${c.sel}`);
    if (r.crudo.length > 8) console.log(`     … y ${r.crudo.length - 8} mas`);
    fallos.push({ pag: et, tipo: 'E1', n: r.crudo.length });
  }
  if (r.sinTransicion.length) {
    console.log(`\n  E2 · ${r.sinTransicion.length} clase(s) con :hover animable y duracion 0s — SALTAN EN SECO:`);
    for (const s of r.sinTransicion) console.log(`     ${s.base.padEnd(26)} cambia ${s.props.join(', ')}`);
    fallos.push({ pag: et, tipo: 'E2', n: r.sinTransicion.length });
  }
  if (r.sinFoco.length) {
    console.log(`\n  E3 · ${r.sinFoco.length} elemento(s) enfocable(s) con :hover y sin :focus-visible — WCAG 2.4.7:`);
    for (const s of r.sinFoco) console.log(`     ${s.base.padEnd(26)} <${s.tag}>`);
    fallos.push({ pag: et, tipo: 'E3', n: r.sinFoco.length });
  }
  if (r.noEncontradas.length) {
    console.log(`\n  (${r.noEncontradas.length} clase(s) con :hover sin instancia en esta pagina, no se pueden medir aqui)`);
  }
}
await nav.close();

mkdirSync('spec', { recursive: true });
writeFileSync('spec/estados.json', JSON.stringify({ ancho, base: BASE, informe }, null, 2) + '\n');

console.log();
if (!fallos.length) { console.log('  CAPA DE ESTADOS CORRECTA.\n'); process.exit(0); }
console.log(`  ${fallos.reduce((a, f) => a + f.n, 0)} fallo(s) en ${new Set(fallos.map((f) => f.tipo)).size} comprobacion(es). spec/estados.json\n`);
process.exit(1);
