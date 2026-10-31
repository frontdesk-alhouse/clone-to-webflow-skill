#!/usr/bin/env node
/**
 * Gate · orden real de las secciones, por `y`.
 *
 *   node scripts/gate-orden.mjs [pagina] [ancho]
 *
 * La rubrica lo declara desde el principio ("orden real de secciones por y") y solo existia como
 * `_orden-real.mjs`: 20 lineas con una URL y un CSS de /tmp a fuego, que ordenaban por y y NO
 * comparaban contra nada. Esto compara.
 *
 * El orden esperado se DECLARA en spec/orden.json: { pagina: { ancho|default: [selectores...] } }.
 * Se puede tomar del contrato de movimiento (sus secciones traen sel/selMovil) SOLO si el contrato
 * dice "secciones_en_orden": true. No se asume: en Cliente A el contrato listaba how-it-works segundo y
 * en la pagina va quinto, y el gate acuso un desorden que no existia. Un contrato de movimiento
 * ordena por lo que anima, no por donde esta.
 *
 * Sin orden declarado el gate no adivina: mide, IMPRIME lo que ve a cada ancho como propuesta de
 * spec/orden.json, y sale con exit 2. Confirmar ese orden es una decision de diseno, no del gate.
 *
 * Por que se mide la y REAL y no el DOM: el marcado trae escritorio primero y movil despues, y al
 * mezclar bandas el orden visual deja de ser el del DOM. Y cuando el motor de scroll fija una
 * seccion (pin), Webflow la envuelve en un `.w-embed`: el hijo del flex es el ENVOLTORIO, no la
 * seccion, y el `order` hay que ponerselo a el. Medir la y de la seccion ya refleja donde acabo el
 * envoltorio, asi que el gate caza las dos cosas sin un caso especial.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { PAGINAS, ANCHOS, etiquetaDe, rutaDe } from './config.mjs';

const CONTRATO = existsSync('spec/movimiento.json') ? JSON.parse(readFileSync('spec/movimiento.json', 'utf8')) : null;
const ORDEN = existsSync('spec/orden.json') ? JSON.parse(readFileSync('spec/orden.json', 'utf8')) : null;
const CONTRATO_ORDENADO = !!CONTRATO?.secciones_en_orden;
// Sin orden declarado, el gate corre en modo PROPUESTA: mide, imprime, exit 2. No compara.
const PROPONE = !ORDEN && !CONTRATO_ORDENADO;
if (!CONTRATO && !ORDEN) {
  console.error(`
Falta spec/movimiento.json (para saber que secciones hay) o spec/orden.json (el orden esperado).
Con al menos el contrato, este gate mide y te propone el spec/orden.json.
`);
  process.exit(2);
}
const ANCHOS_GATE = CONTRATO?.anchos
  ? [...new Set(Object.values(CONTRATO.anchos).map(Number).filter(Boolean))].sort((a, b) => a - b)
  : ANCHOS;
const TOL_SOLAPE = 2;   // px: dos secciones a la misma y son un solape, no un orden

const URL_DE = Object.fromEntries(PAGINAS.map((p) => [etiquetaDe(p), p]));

/* `_aplica` del contrato trae SLUGS publicados ('' para la home) y URL_DE esta indexado por
   ETIQUETA ('home'). Para todas las paginas menos la home slug y etiqueta coinciden, asi que el
   guard `pag in URL_DE` solo falla en una: la home. Y falla en SILENCIO, con un «se salta» cuyo
   nombre de pagina sale vacio. En Cliente C la home era la UNICA pagina construida, de modo que
   el gate no medio nada y no dijo que no habia medido nada. Es la misma familia de fallo que ya
   estaba arreglada en gate-movimiento.mjs (ahi pedia `/undefined`, medía una 404 y la daba por
   verde). Se acepta cualquiera de las dos formas. (2026-09-30.) */
const slugDe = (pag) => (pag in URL_DE ? URL_DE[pag] : PAGINAS.includes(pag) ? pag : null);

/** Orden esperado de una pagina a un ancho: lista de { id, sels } donde sels son los candidatos. */
function esperado(pag, ancho) {
  if (ORDEN?.[pag]) {
    const lista = ORDEN[pag][String(ancho)] ?? ORDEN[pag].default;
    return lista ? lista.map((sel, i) => ({ id: `${i + 1}·${sel}`, sels: [sel] })) : null;
  }
  const def = CONTRATO?.paginas?.[pag];
  if (!def) return null;
  return def.secciones.map((s) => ({ id: s.id, sels: [s.sel, s.selMovil].filter(Boolean) }));
}

const args = process.argv.slice(2);
const pedidas = args.filter((a) => !/^\d+$/.test(a));
const anchosPedidos = args.some((a) => /^\d+$/.test(a)) ? ANCHOS_GATE.filter((w) => args.includes(String(w))) : ANCHOS_GATE;

/* Las claves que empiezan por `_` son documentacion, no paginas: es la convencion de todos los
   archivos de spec/ de este harness. Sin este filtro cada comentario del JSON salia por pantalla
   como «no esta en `paginas` del config, se salta». */
const paginas = Object.keys(ORDEN ?? CONTRATO.paginas).filter((k) => !k.startsWith('_')).flatMap((clave) => {
  const def = CONTRATO?.paginas?.[clave];
  return (def?._aplica ?? [clave]).map((pag) => ({ pag, clave }));
});

const nav = await chromium.launch();
const fallos = [];
const propuesta = {};
if (PROPONE) console.log('\n  Sin spec/orden.json ni "secciones_en_orden": true en el contrato. MODO PROPUESTA: se mide, no se compara.');

for (const { pag, clave } of paginas) {
  if (pedidas.length && !pedidas.includes(pag)) continue;
  const slug = slugDe(pag);
  if (slug === null) { console.log(`  ${JSON.stringify(pag)}: no esta en \`paginas\` del config, se salta`); continue; }
  console.log(`\n── ${etiquetaDe(slug)} ──────────────────────────────────────────`);
  for (const ancho of anchosPedidos) {
    const esp = esperado(clave, ancho);
    if (!esp) { console.log(`  @${ancho}  sin orden declarado`); continue; }
    const p = await nav.newPage({ viewport: { width: ancho, height: 900 } });
    const resp = await p.goto(rutaDe(slug), { waitUntil: 'load' });
    const http = resp ? resp.status() : 0;
    if (http >= 400) {
      /* Una 404 deja todas las secciones `oculta` y el gate, sin esto, la reporta como una pagina
         ordenada. Un verde sobre una 404 es peor que un rojo. */
      await p.close();
      console.log(`  @${String(ancho).padEnd(5)} HTTP ${http} en ${rutaDe(slug)} — no se mide`);
      fallos.push({ pag: etiquetaDe(slug), ancho, tipo: 'http', detalle: `HTTP ${http}` });
      continue;
    }
    await p.waitForTimeout(1200);
    await p.evaluate(() => window.ScrollTrigger?.refresh?.());
    await p.waitForTimeout(400);

    const medido = await p.evaluate((esp) => esp.map(({ id, sels }) => {
      for (const sel of sels) {
        // D1 (2026-10-14, KL-B-34): se cuentan TODAS las coincidencias visibles del selector. Una seccion que
        // aparece dos veces (dos navbars pegados en el Designer) no es un orden: con querySelector el gate
        // veia la primera y daba verde sobre una pagina rota.
        const visibles = [...document.querySelectorAll(sel)].filter((x) => { const c = getComputedStyle(x); const rr = x.getBoundingClientRect(); return c.display !== 'none' && !(rr.width === 0 && rr.height === 0); });
        const e = visibles[0];
        if (!e) continue;
        const r = e.getBoundingClientRect();
        return { id, sel, y: Math.round(r.top + window.scrollY), alto: Math.round(r.height), n: visibles.length };
      }
      return { id, sel: sels.join('|'), oculta: true };
    }), esp);
    await p.close();

    const visibles = medido.filter((m) => !m.oculta);
    const duplicadas = visibles.filter((m) => m.n > 1);
    for (const d of duplicadas) {
      console.log(`  @${String(ancho).padEnd(5)} DUPLICADA ${d.id}: ${d.n} coincidencias visibles de ${d.sel}`);
      fallos.push({ pag: etiquetaDe(slug), ancho, tipo: 'duplicada', detalle: `${d.id} x${d.n}` });
    }
    const porY = [...visibles].sort((a, b) => a.y - b.y);
    const declarado = visibles.map((m) => m.id);
    const real = porY.map((m) => m.id);
    const desorden = declarado.some((id, i) => id !== real[i]);

    const solapes = [];
    for (let i = 1; i < porY.length; i++) {
      const a = porY[i - 1], b = porY[i];
      if (b.y < a.y + a.alto - TOL_SOLAPE && b.y - a.y <= TOL_SOLAPE) solapes.push(`${a.id}/${b.id} en y=${a.y}`);
    }

    const linea = porY.map((m) => `${m.id}@${m.y}`).join('  ');
    const ocultas = medido.filter((m) => m.oculta).map((m) => m.id);
    if (PROPONE) {
      (propuesta[clave] ??= {})[String(ancho)] = porY.map((m) => m.sel);
      console.log(`  @${String(ancho).padEnd(5)} ${solapes.length ? 'SOLAPE   ' : 'medido   '}${linea}` +
        (ocultas.length ? `   (ocultas: ${ocultas.join(', ')})` : ''));
    } else {
      console.log(`  @${String(ancho).padEnd(5)} ${desorden ? 'DESORDEN ' : solapes.length ? 'SOLAPE   ' : 'ok       '}${linea}` +
        (ocultas.length ? `   (ocultas: ${ocultas.join(', ')})` : ''));
      if (desorden) fallos.push({ pag: etiquetaDe(slug), ancho, tipo: 'desorden', declarado: declarado.join(' → '), real: real.join(' → ') });
    }
    // Un solape es fallo tambien en modo propuesta: dos secciones a la misma y no son un orden.
    for (const s of solapes) fallos.push({ pag: etiquetaDe(slug), ancho, tipo: 'solape', detalle: s });
  }
}
await nav.close();

if (PROPONE) {
  console.log(`\n  PROPUESTA de spec/orden.json — es lo que el sitio PINTA hoy, no lo que debe pintar.`);
  console.log(`  Miralo en el navegador antes de guardarlo: confirmar el orden es una decision de diseno.\n`);
  console.log(JSON.stringify(propuesta, null, 2));
  console.log(`\n  Guardalo en spec/orden.json y vuelve a correr. Exit 2: sin orden declarado no hay veredicto.\n`);
  if (fallos.length) { console.log(`  Ademas, ${fallos.length} solape(s):`); for (const f of fallos) console.log(`   ${f.pag} @${f.ancho} · ${f.detalle}`); }
  process.exit(2);
}

console.log();
if (!fallos.length) console.log('  ORDEN CORRECTO en todas las paginas y anchos.\n');
else {
  console.log(`  ORDEN INCORRECTO en ${fallos.length} punto(s):\n`);
  for (const f of fallos) {
    if (f.tipo === 'desorden') console.log(`   ${f.pag} @${f.ancho}\n     declarado: ${f.declarado}\n     real:      ${f.real}`);
    else console.log(`   ${f.pag} @${f.ancho} · solape: ${f.detalle}`);
  }
  console.log(`\n  Si el motion fija una seccion, el \`order\` va al envoltorio .w-embed, no a la seccion.\n`);
}
process.exit(fallos.length ? 1 : 0);
