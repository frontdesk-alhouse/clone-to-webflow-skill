#!/usr/bin/env node
/**
 * Gate · la reticula estructural: lineas que cierran y superficies que dejan ver.
 *
 *   node scripts/gate-reticula.mjs [--ancho 1920]
 *
 * POR QUE EXISTE. En Cliente B (2026-10-13) el cliente pidio dos cosas que ningun gate
 * cobraba: que la banda de cifras se CERRARA con una linea inferior a sangre (tenia cabeza y no
 * pies: los verticales morian en el aire 25 px antes del final de la banda), y que el navbar
 * fijo fuera TRANSLUCIDO con desenfoque en vez de un bloque opaco. La paridad no lo ve (el frame
 * de Figma no lo trae), gate-estados mide puntero, gate-movimiento mide scroll. Esto es
 * geometria y superficie en reposo: se le pregunta al navegador y se compara con un contrato.
 *
 * CONTRATO: spec/reticula.json
 *   {
 *     "anchos": [1920],
 *     "piezas": [
 *       { "id": "...", "pagina": "home", "selector": ".vu-marquee",
 *         "lineas": { "arriba": true, "abajo": true, "aSangre": true, "tocaVerticales": ".vu-marquee-item" } },
 *       { "id": "...", "pagina": "home", "selector": ".vu-nav", "scrollHasta": ".vu-hero",
 *         "superficie": { "alphaMax": 0.95, "desenfoque": true } }
 *     ]
 *   }
 *
 * COMPROBACIONES
 *   L1 · linea arriba/abajo/izquierda/derecha: el elemento pinta 1 px de borde, box-shadow inset o un degradado de
 *        1 px (background-image 100% 1px a calc(100% - Npx)) en ese lado.
 *   L2 · a sangre: el rect del elemento cubre todo el ancho de la ventana (left <= 0, right >= innerWidth),
 *        y si la linea de abajo es un degradado, TAMBIEN la linea (su caja de posicionamiento segun background-origin).
 *   L3 · toca verticales: el bottom de los hijos con borde vertical coincide con la y de la linea
 *        de abajo (± 1 px). Si hay hueco entre ambos, la linea no cierra el recuadro.
 *   S1 · alpha del background-color en [alphaMin, alphaMax): translucido pero PRESENTE. Un nav
 *        transparente del todo tambien pasaria «< alphaMax» y no es lo pedido. Se mide tras
 *        scrollHasta y tras la transicion, para capturar el estado «solido» que pone el script.
 *   S2 · `desenfoque: true` exige blur() de 1..desenfoqueMaxPx; `desenfoque: false` exige none.
 *   F1 · `franja: { hasta, px }`: la distancia del borde superior del elemento al borde superior de su hijo `hasta`
 *        mide `px` (±1). Es la franja transparente de arriba del navbar. Se añadió el 2026-10-14 (KL-B-28) porque
 *        la franja de 20 px desaparecio en la variante oscuro (padding-top:0 escrito en el Designer) y S1/S2 no lo
 *        veian: una barra pegada a y=0 sigue siendo translucida y con blur.
 *        (Revisor 2026-10-13: la franja de arriba del nav va sin nada; la barra con un blur suave.)
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { rutaDe, enProyecto } from './config.mjs';

const args = process.argv.slice(2);
let anchoCli = null;
for (let i = 0; i < args.length; i++) if (args[i] === '--ancho') anchoCli = +args[++i];

const rutaContrato = enProyecto('spec', 'reticula.json');
if (!existsSync(rutaContrato)) {
  console.error('\nFalta spec/reticula.json. Sin contrato no hay reticula que medir.\n');
  process.exit(2);
}
const contrato = JSON.parse(readFileSync(rutaContrato, 'utf8'));
/* Una pieza puede traer sus propios `anchos` (p. ej. el navbar movil solo a 390): se mide en esos
   y se salta en los demas. Sin `anchos` propios hereda los del contrato. */
const anchosPiezas = contrato.piezas.flatMap((pz) => pz.anchos || []);
const anchos = anchoCli ? [anchoCli] : [...new Set([...(contrato.anchos || [1920]), ...anchosPiezas])];

const nav = await chromium.launch();
const fallos = [];
const informe = [];

for (const ancho of anchos) {
  for (const pieza of contrato.piezas) {
    if (pieza.anchos ? !pieza.anchos.includes(ancho) : !(contrato.anchos || [1920]).includes(ancho)) continue;
    const slug = pieza.pagina === 'home' ? '' : pieza.pagina;
    const p = await nav.newPage({ viewport: { width: ancho, height: 1080 }, reducedMotion: 'reduce' });
    const resp = await p.goto(rutaDe(slug), { waitUntil: 'load' });
    if (!resp || resp.status() >= 400) { await p.close(); continue; }
    await p.waitForTimeout(400);

    const r = await p.evaluate(({ pieza }) => {
      const el = document.querySelector(pieza.selector);
      if (!el) return { ausente: true };
      const salida = { ausente: false };

      if (pieza.scrollHasta) {
        const ref = document.querySelector(pieza.scrollHasta);
        if (ref) window.scrollTo(0, ref.getBoundingClientRect().bottom + window.scrollY + 200);
      }
      /* 450 ms: que termine la transicion de background-color (.2s) antes de leer el alpha,
         si no se lee un valor intermedio y el gate absuelve un navbar opaco. */
      return new Promise((res) => setTimeout(() => requestAnimationFrame(() => {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        salida.rect = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };

        if (pieza.lineas) {
          const sombras = cs.boxShadow === 'none' ? [] : cs.boxShadow.split(/,(?![^(]*\))/).map((s) => s.trim());
          const insetY = sombras.filter((s) => /inset/.test(s)).map((s) => {
            const nums = s.replace(/rgba?\([^)]*\)/g, '').match(/-?\d+(\.\d+)?px/g) || [];
            return parseFloat(nums[1] || '0');
          });
          /* Tercera forma de pintar una linea: un degradado de 1 px de alto como background-image,
             colocado a `calc(100% - Npx)` del borde. Es la unica que deja el padding del bloque
             intacto (la caja que mide la paridad no cambia) y aun asi cruza de orilla a orilla. */
          let lineaFondoY = null;   // y absoluta de esa linea, si existe
          /* Chromium devuelve background-size y -position SIN resolver (`100% 1px`,
             `0px calc(100% - 25px)`): la y de la linea se calcula a mano. Medido 2026-10-13. */
          if (/linear-gradient/.test(cs.backgroundImage)) {
            const tam = cs.backgroundSize.split(',')[0].trim().split(/\s+/);
            const posTxt = cs.backgroundPosition.split(',')[0].trim();
            const posY = posTxt.replace(/^\S+\s+/, '');          // lo que sigue al primer token
            const alto = parseFloat(tam[1] || '0'), ancho = parseFloat(tam[0] || '0');
            const anchoOk = tam[0] === '100%' || ancho >= rect.width - 1;
            /* La caja de posicionamiento depende de background-origin: padding-box por defecto;
               content-box descuenta el padding (es la forma de poner la linea al pie del contenido
               SIN calc(), que Webflow descarta al publicar: medido 2026-10-13, la hoja servida perdio
               `background-position: 0 calc(100% - 25px)` y la linea subio al borde superior). */
            const origen = (cs.backgroundOrigin || 'padding-box').split(',')[0].trim();
            const bT = parseFloat(cs.borderTopWidth) || 0, bB = parseFloat(cs.borderBottomWidth) || 0;
            const pT = parseFloat(cs.paddingTop) || 0, pB = parseFloat(cs.paddingBottom) || 0;
            let cajaTop = rect.top + bT, cajaBottom = rect.bottom - bB;          // padding-box
            if (origen === 'content-box') { cajaTop += pT; cajaBottom -= pB; }
            else if (origen === 'border-box') { cajaTop = rect.top; cajaBottom = rect.bottom; }
            const cajaAlto = cajaBottom - cajaTop;
            let y = null;
            const mc = posY.match(/^calc\(100%\s*-\s*([\d.]+)px\)$/);
            if (mc) y = cajaBottom - parseFloat(mc[1]);                        // pie de la linea
            else if (/^[\d.]+px$/.test(posY)) y = cajaTop + parseFloat(posY) + alto;
            else if (/^[\d.]+%$/.test(posY)) y = cajaTop + (cajaAlto - alto) * parseFloat(posY) / 100 + alto;
            if (alto >= 1 && alto <= 1.5 && anchoOk && y !== null) lineaFondoY = y;
            /* Extension horizontal de la linea: con background-size 100% el 100 % es el de la caja de
               posicionamiento, no el del elemento. Con origin content-box y padding lateral la linea
               se queda corta (medido 2026-10-13: 96 px por lado) aunque el elemento sea a sangre. */
            if (lineaFondoY !== null) {
              const bL = parseFloat(cs.borderLeftWidth) || 0, bR = parseFloat(cs.borderRightWidth) || 0;
              const pL = parseFloat(cs.paddingLeft) || 0, pR = parseFloat(cs.paddingRight) || 0;
              let l = rect.left + bL, r = rect.right - bR;
              if (origen === 'content-box') { l += pL; r -= pR; }
              else if (origen === 'border-box') { l = rect.left; r = rect.right; }
              if (tam[0] === '100%') salida.lineaAbajoX = { left: l, right: r };
              else salida.lineaAbajoX = { left: l, right: l + ancho };
            }
          }
          const arriba = parseFloat(cs.borderTopWidth) >= 1 || insetY.some((y) => y > 0);
          const abajo  = parseFloat(cs.borderBottomWidth) >= 1 || insetY.some((y) => y < 0) || lineaFondoY !== null;
          /* Lados: borde o box-shadow inset con desplazamiento en x (Revisor 2026-10-13: la barra del
             navbar movil tambien lleva las dos lineas laterales, como un recuadro). */
          const insetX = (cs.boxShadow || '').split(/\),\s*/).filter((s) => /inset/.test(s)).map((s) => {
            const nums = s.replace(/rgba?\([^)]*\)/g, '').match(/-?\d+(\.\d+)?px/g) || [];
            return parseFloat(nums[0] || '0');
          });
          const izquierda = parseFloat(cs.borderLeftWidth) >= 1 || insetX.some((x) => x > 0);
          const derecha = parseFloat(cs.borderRightWidth) >= 1 || insetX.some((x) => x < 0);
          salida.lineas = { arriba, abajo, izquierda, derecha };
          salida.lineaAbajoY = lineaFondoY !== null ? lineaFondoY : rect.bottom;
          const lx = salida.lineaAbajoX || { left: rect.left, right: rect.right };
          salida.aSangre = rect.left <= 0.5 && rect.right >= window.innerWidth - 0.5
            && lx.left <= 0.5 && lx.right >= window.innerWidth - 0.5;
          salida.aSangreDetalle = { elemento: [rect.left, rect.right], linea: [lx.left, lx.right] };
          if (pieza.lineas.tocaVerticales) {
            const hijos = [...el.querySelectorAll(pieza.lineas.tocaVerticales)]
              .filter((h) => h.getClientRects().length && getComputedStyle(h).display !== 'none');
            const bottoms = hijos.map((h) => h.getBoundingClientRect().bottom);
            const maxBottom = bottoms.length ? Math.max(...bottoms) : null;
            salida.verticales = { n: hijos.length, bottom: maxBottom, lineaAbajo: salida.lineaAbajoY,
              hueco: maxBottom === null ? null : salida.lineaAbajoY - maxBottom };
          }
        }
        if (pieza.superficie) {
          const m = cs.backgroundColor.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
          let alpha = 1;
          if (m) alpha = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
          if (cs.backgroundColor === 'transparent') alpha = 0;
          const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
          salida.superficie = { color: cs.backgroundColor, alpha, backdropFilter: bf, clase: el.className };
        }
        if (pieza.franja) {
          const hijo = el.querySelector(pieza.franja.hasta);
          const re = el.getBoundingClientRect();
          salida.franja = hijo ? { px: Math.round((hijo.getBoundingClientRect().top - re.top) * 100) / 100, hijo: true } : { px: null, hijo: false };
        }
        res(salida);
      }), pieza.scrollHasta ? 450 : 0));
    }, { pieza });
    await p.close();

    const et = `${pieza.id} @${ancho}`;
    console.log(`\n── ${et} ──────────────────────────────────────────`);
    if (r.ausente) { console.log(`  AUSENTE: ${pieza.selector}`); fallos.push({ pieza: et, tipo: 'ausente' }); informe.push({ pieza: pieza.id, ancho, ausente: true }); continue; }
    const fila = { pieza: pieza.id, ancho, ...r };
    informe.push(fila);

    if (pieza.lineas) {
      for (const lado of ['arriba', 'abajo', 'izquierda', 'derecha']) {
        if (pieza.lineas[lado] === undefined) continue;
        const ok = r.lineas[lado] === pieza.lineas[lado];
        console.log(`  L1 linea ${lado.padEnd(9)} ${ok ? 'OK  ' : 'FAIL'}  (mide ${r.lineas[lado]}, debe ${pieza.lineas[lado]})`);
        if (!ok) fallos.push({ pieza: et, tipo: `L1 linea ${lado}` });
      }
      if (pieza.lineas.aSangre) {
        const ld = r.aSangreDetalle ? ` · linea ${r.aSangreDetalle.linea[0].toFixed(1)}..${r.aSangreDetalle.linea[1].toFixed(1)}` : '';
        console.log(`  L2 a sangre     ${r.aSangre ? 'OK  ' : 'FAIL'}  (elemento ${r.rect.left.toFixed(1)}..${r.rect.right.toFixed(1)}${ld} / ${ancho})`);
        if (!r.aSangre) fallos.push({ pieza: et, tipo: 'L2 a sangre' });
      }
      if (pieza.lineas.tocaVerticales && pieza.lineas.abajo) {
        const v = r.verticales;
        const ok = v.n > 0 && v.hueco !== null && Math.abs(v.hueco) <= 1;
        console.log(`  L3 toca vert.   ${ok ? 'OK  ' : 'FAIL'}  (${v.n} verticales · hueco ${v.hueco === null ? '—' : v.hueco.toFixed(1) + ' px'} entre su pie y la linea de abajo)`);
        if (!ok) fallos.push({ pieza: et, tipo: 'L3 toca verticales' });
      }
    }
    if (pieza.superficie) {
      const s = r.superficie;
      const aMax = pieza.superficie.alphaMax ?? 1, aMin = pieza.superficie.alphaMin ?? 0.5;
      const okA = s.alpha < aMax && s.alpha >= aMin;
      console.log(`  S1 alpha        ${okA ? 'OK  ' : 'FAIL'}  (${s.color} → alpha ${s.alpha}, debe estar en [${aMin}, ${aMax}) : translucido pero presente)`);
      if (!okA) fallos.push({ pieza: et, tipo: 'S1 alpha' });
      if (pieza.superficie.desenfoque === true) {
        const mb = s.backdropFilter.match(/blur\(([\d.]+)px\)/);
        const px = mb ? parseFloat(mb[1]) : null;
        const max = pieza.superficie.desenfoqueMaxPx ?? Infinity;
        const okB = px !== null && px > 0 && px <= max;
        console.log(`  S2 desenfoque   ${okB ? 'OK  ' : 'FAIL'}  (backdrop-filter: ${s.backdropFilter}${Number.isFinite(max) ? ` · debe ser blur de 1..${max}px` : ''})`);
        if (!okB) fallos.push({ pieza: et, tipo: 'S2 desenfoque' });
      } else if (pieza.superficie.desenfoque === false) {
        const okB = s.backdropFilter === 'none';
        console.log(`  S2 sin desenf.  ${okB ? 'OK  ' : 'FAIL'}  (backdrop-filter: ${s.backdropFilter}, debe ser none)`);
        if (!okB) fallos.push({ pieza: et, tipo: 'S2 sin desenfoque' });
      }
      console.log(`     clase medida: ${s.clase}`);
    }
    if (pieza.franja) {
      const f = r.franja;
      const ok = f.hijo && Math.abs(f.px - pieza.franja.px) <= 1;
      console.log(`  F1 franja       ${ok ? 'OK  ' : 'FAIL'}  (del borde de ${pieza.selector} al de ${pieza.franja.hasta}: mide ${f.hijo ? f.px + ' px' : 'hijo ausente'}, debe ${pieza.franja.px} px)`);
      if (!ok) fallos.push({ pieza: et, tipo: 'F1 franja' });
    }
  }
}
await nav.close();

writeFileSync(enProyecto('spec', 'reticula.medida.json'), JSON.stringify({ fecha: new Date().toISOString(), informe, fallos }, null, 2) + '\n');
if (!fallos.length) { console.log('\n  RETICULA CORRECTA.\n'); process.exit(0); }
console.log(`\n  ${fallos.length} fallo(s). spec/reticula.medida.json\n`);
process.exit(1);
