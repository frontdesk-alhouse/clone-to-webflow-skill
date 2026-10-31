#!/usr/bin/env node
/**
 * Gate · paridad de contenido entre bandas.
 *
 *   node gate-paridad.mjs [base] [--json] [--solo=pagina] [--salida=nombre]
 *
 * Por que existe (Cliente A, 2026-09-17): en /product la seccion «The three parts worth looking at up close» existia en
 * escritorio y en movil y tablet no. Nadie lo vio en semanas: los frames de Figma de 390 y 768 tampoco la tenian, el
 * port los copio fielmente, y todas las verificaciones de movil daban por bueno un orden de secciones al que le faltaba
 * una. Lo encontro el usuario en su telefono. Ningun gate compara QUE HAY en cada banda; este si.
 *
 * Por pagina, en el ancho de frame de cada banda, recorre la pagina y recoge los TITULARES que se pintan (h1–h3 y
 * role=heading; que ocupen sitio, tengan o no la opacidad aun a 0 por una entrada animada). La banda mas ancha es la
 * referencia. Un titular de la referencia que no aparece en otra banda es contenido perdido: HIGH. Al reves (solo en la
 * estrecha) es MEDIUM. El emparejado es difuso: el copy de movil puede ser mas corto.
 *
 * Lo que se quita a proposito se declara, con su porque:
 *   "paridad": { "omitidas": [{ "pagina": "product", "texto": "three parts", "bandas": ["movil"], "porque": "…" }] }
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium as cargaChromium, ARGS } from './lib/pw.mjs';
import { cargaConfig, url as urlDe } from './lib/config.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const cfg = cargaConfig();
const JSON_ = args.includes('--json');
const di = (...a) => { if (!JSON_) console.log(...a); };
const BASE = args.find((a) => /^(https?|file):\/\//.test(a))?.replace(/\/$/, '') ?? null;
const SOLO = opt('solo')?.split(',') ?? null;
const OUT = cfg.salida || 'responsive-out';
const SALIDA = opt('salida') || 'gate-paridad';
const OMITIDAS = cfg.paridad?.omitidas ?? [];
const UMBRAL = cfg.paridad?.similitud ?? 0.6;
const ALTO = { movil: 844, tablet: 1024, escritorio: 900 };
const BANDAS = Object.entries(cfg.bandas ?? {}).filter(([, b]) => b.frame).map(([n, b]) => ({ n, w: b.frame, h: ALTO[n] ?? 900 })).sort((a, b) => b.w - a.w);
if (BANDAS.length < 2) { console.error('gate-paridad: hacen falta al menos dos bandas con frame para comparar.'); process.exit(2); }
const PAGINAS = (cfg.sitio.paginas ?? ['']).filter((p) => !SOLO || SOLO.includes(p) || SOLO.includes(p || 'home'));
const urlPagina = (p) => (BASE ? (BASE.startsWith('file:') ? `${BASE}/${p}` : `${BASE}/${(cfg.rutas?.[p] ?? p).replace(/^\//, '')}`.replace(/\/$/, '')) : urlDe(cfg, p));

const norma = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const VACIAS = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'el', 'la', 'los', 'las', 'de', 'y', 'un', 'una', 'your', 'you', 'it', 'in', 'on', 'for']);
const fichas = (t) => new Set(norma(t).split(' ').filter((x) => x.length > 1 && !VACIAS.has(x)));
const similitud = (a, b) => { const A = fichas(a), B = fichas(b); if (!A.size || !B.size) return 0; let c = 0; for (const x of A) if (B.has(x)) c++; return c / Math.min(A.size, B.size); };
const omitida = (pagina, texto, banda) => OMITIDAS.some((o) => (o.pagina ?? pagina) === pagina && norma(texto).includes(norma(o.texto)) && (!o.bandas || o.bandas.includes(banda)));

const RECOGE = () => {
  const out = [];
  for (const h of document.querySelectorAll('h1, h2, h3, [role="heading"]')) {
    const t = (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length < 4 || !h.getClientRects().length) continue;
    const r = h.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    let visible = true; for (let n = h; n && n.nodeType === 1; n = n.parentElement) { if (getComputedStyle(n).visibility === 'hidden' && n === h) { visible = false; break; } }
    if (visible) out.push({ texto: t.slice(0, 120), y: Math.round(r.top + scrollY) });
  }
  return out;
};

const fallos = [], tabla = [];
di(`\ngate-paridad · ${BASE ?? cfg.sitio.staging}\nbandas: ${BANDAS.map((b) => `${b.n} @${b.w}`).join(' · ')}\n`);
const chromium = await cargaChromium();
const browser = await chromium.launch({ args: ARGS });
try {
  for (const pagina of PAGINAS) {
    const porBanda = {}, textoDe = {};
    for (const b of BANDAS) {
      const ctx = await browser.newContext({ viewport: { width: b.w, height: b.h }, deviceScaleFactor: 1, hasTouch: b.w < 1200, isMobile: b.w < 768 });
      const page = await ctx.newPage();
      await page.goto(urlPagina(pagina), { waitUntil: 'load', timeout: 90000 });
      await page.waitForTimeout(cfg.paridad?.esperaCarga ?? 1200);
      // se recorre entera: lo que se monta al entrar en pantalla tiene que haberse montado
      await page.evaluate(async () => { const max = document.documentElement.scrollHeight; for (let y = 0; y < max; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } scrollTo(0, 0); });
      await page.waitForTimeout(300);
      const vistos = new Map();
      for (const h of await page.evaluate(RECOGE)) if (!vistos.has(norma(h.texto))) vistos.set(norma(h.texto), h);
      porBanda[b.n] = [...vistos.values()].sort((x, y) => x.y - y.y);
      // Todo el texto que OCUPA SITIO en esta banda: fuera lo que esta en display:none, dentro lo que espera su turno con
      // visibility u opacidad (la carta de un mazo que aun no toca). Sin esto, un carrusel por pasos parece contenido perdido.
      textoDe[b.n] = norma(await page.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let t = ''; for (let n = w.nextNode(); n; n = w.nextNode()) { const e = n.parentElement; if (e && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(e.tagName) && e.getClientRects().length) t += ' ' + n.nodeValue; } return t; }));
      await ctx.close();
    }
    const ref = BANDAS[0];
    for (const b of BANDAS.slice(1)) {
      for (const h of porBanda[ref.n]) {
        // presente = hay un titular parecido, o su texto se pinta en la banda con otra etiqueta (un rotulo que en movil es un <p>)
        const par = porBanda[b.n].some((x) => similitud(h.texto, x.texto) >= UMBRAL) || textoDe[b.n].includes(norma(h.texto));
        tabla.push({ pagina, titular: h.texto, banda: b.n, esta: par });
        if (!par && !omitida(pagina, h.texto, b.n)) fallos.push({ nivel: 'HIGH', que: `/${pagina} · «${h.texto.slice(0, 60)}» no existe en ${b.n}`, detalle: `se ve a ${ref.w} (${ref.n}) y a ${b.w} no hay ningun titular que se le parezca. Si se quito a proposito, declaralo en paridad.omitidas con su porque; si no, falta la seccion — y lo primero es mirar si esta en el frame de Figma de esa banda.` });
      }
      for (const h of porBanda[b.n]) if (!porBanda[ref.n].some((x) => similitud(h.texto, x.texto) >= UMBRAL) && !textoDe[ref.n].includes(norma(h.texto)) && !omitida(pagina, h.texto, ref.n)) fallos.push({ nivel: 'MEDIUM', que: `/${pagina} · «${h.texto.slice(0, 60)}» solo existe en ${b.n}`, detalle: `a ${b.w} hay un titular que en ${ref.n} no aparece.` });
    }
    di(`· /${pagina}  ${BANDAS.map((b) => `${b.n} ${porBanda[b.n].length}`).join(' · ')} titulares`);
  }
} finally { await browser.close(); }

const graves = fallos.filter((f) => f.nivel === 'HIGH');
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${SALIDA}.md`), [
  `# gate-paridad · ${new Date().toISOString()}`, '', `Base: ${BASE ?? cfg.sitio.staging} · **fallos ${graves.length}**`, '',
  '| nivel | que | detalle |', '|---|---|---|', ...fallos.map((f) => `| ${f.nivel} | ${f.que} | ${f.detalle} |`), '',
  '## Titulares de la referencia y donde estan', '', '| pagina | titular | banda | esta |', '|---|---|---|---|',
  ...tabla.map((t) => `| /${t.pagina} | ${t.titular.slice(0, 70)} | ${t.banda} | ${t.esta ? 'si' : 'NO'} |`),
].join('\n') + '\n');
if (JSON_) console.log(JSON.stringify({ fallos }));
else { for (const f of fallos) console.log(`  [${f.nivel}] ${f.que}`); console.log(`\n${graves.length ? 'FAIL' : 'PASS'} · ${graves.length} titulares perdidos, ${fallos.length - graves.length} solo en banda estrecha → ${join(OUT, `${SALIDA}.md`)}`); }
process.exit(graves.length ? 1 : 0);
