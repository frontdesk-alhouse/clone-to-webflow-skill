/**
 * Gate de encaje — ¿cabe lo importante, a lo ancho y a lo alto?
 *
 * Traduce a algo medible el requisito de que la informacion importante se vea sin scroll,
 * sea cual sea la pantalla. Dos comprobaciones distintas:
 *
 *   HORIZONTAL — la pagina no se desplaza de lado, y lo `esencial` no queda cortado por los
 *                bordes laterales.
 *   VERTICAL   — en las secciones de PANTALLA, lo declarado `esencial` en spec/esencial.json
 *                queda dentro de la ventana cuando su seccion esta arriba del todo.
 *
 * POR QUE LA HORIZONTAL NO RECORRE TODOS LOS ELEMENTOS. Lo hacia, y acuso dos veces a piezas que
 * estan fuera del marco A PROPOSITO: las cuatro tarjetas del carrusel de how-works (499 px en
 * todos los tamanos) y las piezas flotantes de la cifra, que ORBITAN hacia fuera al entrar y
 * vuelven a su sitio al acabar el recorrido —medido: en reposo el desborde es 0 en 1280, 1440 y
 * 1920, y solo aparece en el fotograma de entrada—. Un barrido que se para en un punto de scroll
 * cualquiera fotografia el instante mas extremo de una animacion deliberada y lo llama defecto.
 * Lo que si es un defecto, y no depende del fotograma, son estas dos cosas.
 *
 * La vertical se mide poniendo la seccion en su sitio (scroll a su inicio) y preguntando si el
 * esencial cae dentro. No vale medir en reposo: una seccion que empieza a mitad de pagina se
 * juzga por como se ve cuando llegas a ella.
 *
 * Uso:  node scripts/gate-encaje.mjs [url]
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';

import { BASE } from './config.mjs';

const url = process.argv[2] || `${BASE}/`;
if (!existsSync('spec/esencial.json')) {
  console.error(`
Falta spec/esencial.json — la declaracion de que es "lo importante" en cada seccion de pantalla.

Este gate traduce a algo medible el requisito de que la informacion importante se vea sin scroll.
No puede adivinar cual es: se declara. Ejemplo:

{
  "secciones": {
    "hero": { "sel": "#hero", "esencial": ["#hero h1", "#hero .cta"] }
  }
}
`);
  process.exit(2);
}
const spec = JSON.parse(readFileSync('spec/esencial.json', 'utf8'));
const nav = await chromium.launch();

const filas = [];
let fallos = 0;

for (const [w, h, nombre] of spec.barrido) {
  const p = await nav.newPage({ viewport: { width: w, height: h } });
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(2400);

  const r = await p.evaluate(async (secciones) => {
    const vis = e => { const c = getComputedStyle(e); return c.display !== 'none' && e.offsetWidth > 0; };

    // ── horizontal 1/2: ¿la pagina se desplaza de lado? ───────────────────────
    // Frame-independiente y es el fallo que el usuario nota. `body{overflow-x:clip}` deberia
    // dejarlo siempre en cero; si no lo esta, algo lo ha roto.
    const barra = Math.max(0, document.documentElement.scrollWidth - innerWidth);

    // ── vertical: cada seccion de PANTALLA, puesta en su sitio ────────────────
    const fuera = [];
    for (const [clase, d] of Object.entries(secciones)) {
      if (d.tipo !== 'pantalla') continue;
      const s = document.querySelector('.' + clase);
      if (!s || !vis(s)) continue;

      // llevar la seccion al borde superior de la ventana
      const top = s.getBoundingClientRect().top + scrollY;
      window.scrollTo(0, Math.max(0, Math.round(top)));
      await new Promise(r => setTimeout(r, 240));

      for (const sel of d.esencial || []) {
        const e = document.querySelector(sel);
        if (!e || !vis(e)) continue;
        const b = e.getBoundingClientRect();
        const sobra = Math.round(b.bottom - innerHeight);
        if (sobra > 1) fuera.push({ clase, sel, sobra, eje: 'v' });
        // horizontal 2/2: lo esencial tampoco puede quedar cortado por los lados. Aqui si vale
        // acusar aunque algo lo recorte: que este recortado es exactamente el defecto.
        const lado = Math.round(Math.max(b.right - innerWidth, -b.left));
        if (lado > 1) fuera.push({ clase, sel, sobra: lado, eje: 'h' });
      }
    }
    window.scrollTo(0, 0);
    return { barra, fuera };
  }, spec.secciones);

  await p.close();

  const lados = r.fuera.filter(x => x.eje === 'h');
  const altos = r.fuera.filter(x => x.eje === 'v');
  const okH = r.barra <= 1 && lados.length === 0;
  const okV = altos.length === 0;
  if (!okH || !okV) fallos++;
  filas.push({ w, h, nombre, ...r, lados, altos, okH, okV });
}

await nav.close();

// ── informe ────────────────────────────────────────────────────────────────────
console.log('\n=== GATE DE ENCAJE ===\n');
console.log('  ' + 'pantalla'.padEnd(12) + 'cual'.padEnd(23) + 'horizontal'.padEnd(22) + 'vertical');
console.log('  ' + '─'.repeat(86));
for (const f of filas) {
  const hz = f.okH ? 'cabe'
    : [f.barra > 1 ? `scroll lateral ${f.barra}px` : null,
       ...f.lados.map(x => `${x.sel} +${x.sobra}`)].filter(Boolean).join(', ');
  const vt = f.okV ? 'cabe' : f.altos.map(x => `${x.sel} +${x.sobra}`).join(', ');
  console.log('  ' + `${f.w}×${f.h}`.padEnd(12) +
    f.nombre.slice(0, 21).padEnd(23) +
    ((f.okH ? '  ' : '! ') + hz).padEnd(22) +
    ((f.okV ? '  ' : '! ') + vt));
}
console.log('\n  ' + (fallos ? `${fallos} de ${filas.length} tamaños fallan` : `los ${filas.length} tamaños pasan`));
process.exit(fallos ? 1 : 0);
