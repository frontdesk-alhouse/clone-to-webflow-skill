#!/usr/bin/env node
/**
 * Gate · integridad de la pagina en cada ventana, SIN selectores del cliente.
 *
 *   node gate-integridad.mjs [base] [--json] [--solo=pagina,pagina] [--viewports=1310x945] [--rapido] [--salida=nombre]
 *
 * Por que existe: los demas gates miden lo que alguien penso en declarar (este pin, esta nav, esta seccion). Los
 * defectos que encontro el usuario en su iPad no estaban declarados en ningun sitio: un texto cortado, una tecla
 * fuera de su foto, una seccion pasando por encima de otra, unos botones de carrusel fuera de la ventana. Todos
 * comparten una forma que SI se puede buscar a ciegas, en cualquier sitio:
 *
 *   I1  texto recortado        un texto visible al que un ancestro con overflow (o la ventana) le come un lado
 *   I2  texto sobre texto      dos bloques de texto opacos, sin parentesco, ocupando el mismo sitio
 *   I3  control tapado         un enlace/boton visible cuyo centro lo ocupa OTRO elemento: no se puede pulsar
 *   I4  desborde de pagina     el documento es mas ancho que la ventana
 *   I5  imagen rota            cargada y con ancho natural 0
 *   I6  objetivo tactil        en movil, un control suelto de menos de 24 px (WCAG 2.5.8)
 *
 * Se mide RECORRIENDO la pagina con scroll real, en las ventanas de `lib/viewports.mjs` (dispositivos del usuario +
 * plan derivado + frames). Lo que es asi a proposito se adjudica en `integridad.ignora` (selectores), con su porque:
 * nunca se baja el umbral para que pase.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium as cargaChromium, ARGS } from './lib/pw.mjs';
import { cargaConfig, url as urlDe } from './lib/config.mjs';
import { viewports } from './lib/viewports.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const cfg = cargaConfig();
const JSON_ = args.includes('--json');
const di = (...a) => { if (!JSON_) console.log(...a); };
const BASE = args.find((a) => /^(https?|file):\/\//.test(a))?.replace(/\/$/, '') ?? null;
const SOLO = opt('solo')?.split(',') ?? null;
const SALIDA_DIR = cfg.salida || 'responsive-out';
const SALIDA = opt('salida') || 'gate-integridad';
const IGNORA = (cfg.integridad?.ignora ?? []).map((x) => (typeof x === 'string' ? x : x.selector)).filter(Boolean);
const PAGINAS = (cfg.sitio.paginas ?? ['']).filter((p) => !SOLO || SOLO.includes(p || 'home') || SOLO.includes(p));
const VP = viewports(cfg, { cli: opt('viewports'), rapido: args.includes('--rapido') });
const urlPagina = (p) => (BASE ? (BASE.startsWith('file:') ? `${BASE}/${p}` : `${BASE}/${(cfg.rutas?.[p] ?? p).replace(/^\//, '')}`.replace(/\/$/, '')) : urlDe(cfg, p));

// ---------------------------------------------------------------- lo que corre dentro de la pagina, en cada parada
const SONDA = ({ ignora, movil }) => {
  const H = innerHeight, W = innerWidth, out = [];
  const ruta = (el) => { const p = []; for (let n = el; n && n.nodeType === 1 && p.length < 3; n = n.parentElement) { const c = (typeof n.className === 'string' ? n.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.'); p.unshift(n.tagName.toLowerCase() + (c ? '.' + c : '')); } return p.join(' > '); };
  const ignorado = (el) => ignora.some((s) => { try { return el.closest(s); } catch { return false; } });
  const cadena = (el) => { const c = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) c.push(n); return c; };
  const estilo = new Map(); const cs = (n) => { let v = estilo.get(n); if (!v) { v = getComputedStyle(n); estilo.set(n, v); } return v; };
  const opac = (el) => { let o = 1; for (const n of cadena(el)) { const s = cs(n); if (s.display === 'none' || s.visibility === 'hidden') return 0; o *= parseFloat(s.opacity); } return o; };
  const fijo = (el) => cadena(el).some((n) => /fixed|sticky/.test(cs(n).position));
  /* ¿Esta PINTADO en ese punto? La pila real del navegador ya descuenta lo que recorta un overflow (un acordeon cerrado
     no aparece) y deja ver si encima hay algo OPACO y ajeno (la carta de arriba de un mazo tapa el texto de la de abajo). */
  const opaco = (n) => { const s = cs(n); if (s.backgroundImage !== 'none') return true; const m = s.backgroundColor.match(/rgba?\(([^)]+)\)/); if (!m) return false; const v = m[1].split(',').map(Number); return (v[3] ?? 1) > 0.5; };
  const pintado = (el, x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    // Un elemento con pointer-events:none no existe para la pila de pintado (una maqueta decorativa, por ejemplo). Ahi
    // solo queda la geometria: el punto tiene que caer dentro de todos los ancestros que recortan. No se presume oculto.
    if (cs(el).pointerEvents === 'none') return cadena(el).slice(1).every((n) => { const s = cs(n); if (s.overflowX === 'visible' && s.overflowY === 'visible') return true; const a = n.getBoundingClientRect(); return x >= a.left && x <= a.right && y >= a.top && y <= a.bottom; });
    const pila = document.elementsFromPoint(x, y), i = pila.findIndex((n) => n === el || el.contains(n));
    return i >= 0 && !pila.slice(0, i).some((n) => !n.contains(el) && opaco(n));
  };
  /* ¿El recorte es el borde de una PISTA? Tres o mas hermanos del mismo tipo puestos en fila dentro del que recorta:
     un carrusel o una cinta. La tarjeta que asoma cortada en el borde es el diseno, no un defecto. */
  const c0 = (n) => (typeof n.className === 'string' ? n.className.trim().split(/\s+/)[0] : '');
  const enPista = (el, clip) => {
    for (let n = el; n && n !== clip && n.parentElement; n = n.parentElement) {
      const herm = [...n.parentElement.children].filter((h) => h.tagName === n.tagName && c0(h) === c0(n));
      if (herm.length >= 3 && new Set(herm.map((h) => Math.round(h.getBoundingClientRect().left))).size >= 3) return true;
    }
    return false;
  };
  const decorativo = (el) => !!el.closest('[aria-hidden="true"], [inert]');
  const enVentana = (r) => r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < H && r.right > -W && r.left < 2 * W;

  // --- bloques de texto: un rect por elemento con texto propio
  const textos = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const vistos = new Set();
  for (let t = tw.nextNode(); t; t = tw.nextNode()) {
    if (!t.nodeValue.trim() || t.nodeValue.trim().length < 2) continue;
    const el = t.parentElement; if (!el || vistos.has(el) || /^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(el.tagName)) continue;
    vistos.add(el);
    const rg = document.createRange(); rg.selectNodeContents(el); const r = rg.getBoundingClientRect();
    if (!enVentana(r) || r.top < 0 && r.bottom < 40) continue;
    const o = opac(el); if (o < 0.5 || ignorado(el)) continue;
    textos.push({ el, r, o, fijo: fijo(el), txt: t.nodeValue.trim().slice(0, 40) });
  }

  // I1 · texto recortado en horizontal
  for (const t of textos) {
    if (cs(t.el).textOverflow === 'ellipsis') continue;
    let L = -Infinity, R = Infinity, quien = null, desplazable = false;
    for (const n of cadena(t.el).slice(1)) {
      if (n === document.documentElement || n === document.body) break;
      const ox = cs(n).overflowX; if (ox === 'visible') continue;
      if (ox === 'auto' || ox === 'scroll') { desplazable = true; break; }
      const a = n.getBoundingClientRect(); if (a.left > L) { L = a.left; } if (a.right < R) { R = a.right; quien = n; }
    }
    if (desplazable) continue;
    const porAncestro = Math.max(0, t.r.right - R) + Math.max(0, L - t.r.left);
    const porVentana = Math.max(0, t.r.right - W) + Math.max(0, -t.r.left);
    const corte = Math.max(porAncestro, porVentana), visible = 1 - corte / t.r.width;
    // menos de un cuarto a la vista = pieza fuera de escena a proposito (diapositiva que espera), no un recorte
    // se comprueba en un punto de la parte que SI deberia verse: si ahi no esta pintado, no es un recorte, es una pieza oculta
    const xv = (Math.max(t.r.left, L, 0) + Math.min(t.r.right, R, W)) / 2, yv = Math.max(t.r.top, 0) + Math.min(t.r.height, H) / 2;
    if (corte > 2 && porAncestro > porVentana && quien && enPista(t.el, quien)) continue;
    if (corte > 2 && visible > 0.25 && !pintado(t.el, xv, Math.min(yv, H - 1))) continue;
    if (corte > 2 && visible > 0.25) out.push({ tipo: 'I1', nivel: 'HIGH', donde: ruta(t.el), detalle: `«${t.txt}» pierde ${Math.round(corte)} px ${porVentana >= porAncestro ? 'contra el borde de la ventana' : 'contra ' + ruta(quien)}` });
  }

  // I2 · texto sobre texto
  const solidos = textos.filter((t) => t.o >= 0.9 && !t.fijo && t.r.top >= 0 && t.r.bottom <= H);
  for (let i = 0; i < solidos.length; i++) for (let j = i + 1; j < solidos.length; j++) {
    const a = solidos[i], b = solidos[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (!(ix > 6 && iy > 6 && ix * iy > 0.2 * Math.min(a.r.width * a.r.height, b.r.width * b.r.height))) continue;
    // los DOS tienen que estar pintados en el centro del solape; si uno esta recortado o debajo de algo opaco, no se pisan a la vista
    const cx = Math.max(a.r.left, b.r.left) + ix / 2, cy = Math.max(a.r.top, b.r.top) + iy / 2;
    if (!pintado(a.el, cx, cy) || !pintado(b.el, cx, cy)) continue;
    out.push({ tipo: 'I2', nivel: 'HIGH', donde: ruta(a.el), detalle: `«${a.txt}» y «${b.txt}» se pisan ${Math.round(ix)}×${Math.round(iy)} px (${ruta(b.el)})` });
  }

  // I3 · control tapado · I6 · objetivo tactil
  for (const el of document.querySelectorAll('a[href], button, [role="button"], input:not([type="hidden"]), select, textarea')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.top < 0 || r.bottom > H || r.left < 0 || r.right > W) continue;
    if (opac(el) < 0.5 || ignorado(el) || decorativo(el) || cs(el).pointerEvents === 'none') continue;
    const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (arriba && arriba !== el && !el.contains(arriba) && !arriba.contains(el) && !(arriba.closest('label') && arriba.closest('label').contains(el)) && !fijo(arriba) && opac(arriba) > 0.05) {
      out.push({ tipo: 'I3', nivel: 'HIGH', donde: ruta(el), detalle: `«${(el.innerText || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 30)}» no se puede pulsar: encima esta ${ruta(arriba)}` });
    }
    if (movil && Math.min(r.width, r.height) < 24 && cs(el).display !== 'inline') out.push({ tipo: 'I6', nivel: 'MEDIUM', donde: ruta(el), detalle: `objetivo tactil de ${Math.round(r.width)}×${Math.round(r.height)} px (minimo 24)` });
  }

  // I5 · imagen rota
  for (const im of document.images) { const r = im.getBoundingClientRect(); if (enVentana(r) && im.complete && im.naturalWidth === 0 && im.currentSrc && !ignorado(im)) out.push({ tipo: 'I5', nivel: 'HIGH', donde: ruta(im), detalle: `no carga: ${im.currentSrc.slice(-60)}` }); }

  // I4 · desborde de pagina
  const sw = document.documentElement.scrollWidth; if (sw > W + 1) out.push({ tipo: 'I4', nivel: 'HIGH', donde: 'documento', detalle: `scrollWidth ${sw} > ventana ${W}` });
  return out;
};

// ---------------------------------------------------------------- bucle
const hallazgos = new Map();      // clave → { ...h, pagina, vps:Set }
let paradasTotales = 0;
di(`\ngate-integridad · ${BASE ?? cfg.sitio.staging}\nventanas: ${VP.origen} → ${VP.lista.length}\n`);
const chromium = await cargaChromium();
const browser = await chromium.launch({ args: ARGS });
try {
  for (const pagina of PAGINAS) {
    for (const v of VP.lista) {
      const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1, hasTouch: v.w < 768, isMobile: v.w < 768 });
      const page = await ctx.newPage();
      const errores = [];
      page.on('pageerror', (e) => errores.push(e.message));
      try {
        await page.goto(urlPagina(pagina), { waitUntil: 'load', timeout: 90000 });
        await page.waitForTimeout(cfg.integridad?.esperaCarga ?? 1200);
        const alto = await page.evaluate(() => document.documentElement.scrollHeight);
        const paso = Math.round(v.h * 0.8);
        let n = 0;
        for (let y = 0; y < alto && n < 80; y += paso, n++) {
          await page.evaluate(async (y) => { const paso = 300; for (let c = scrollY; c < y; c += paso) { scrollTo(0, Math.min(y, c + paso)); await new Promise((r) => setTimeout(r, 30)); } scrollTo(0, y); }, y);
          await page.waitForTimeout(cfg.integridad?.esperaParada ?? 450);
          const encontrados = await page.evaluate(SONDA, { ignora: IGNORA, movil: v.w < 768 });
          paradasTotales++;
          for (const h of encontrados) {
            const k = `${pagina}|${h.tipo}|${h.donde}`;
            if (!hallazgos.has(k)) hallazgos.set(k, { ...h, pagina, vps: new Set() });
            hallazgos.get(k).vps.add(`${v.w}x${v.h}`);
          }
        }
        if (errores.length) { const k = `${pagina}|JS|${errores[0].slice(0, 60)}`; if (!hallazgos.has(k)) hallazgos.set(k, { tipo: 'JS', nivel: 'HIGH', donde: 'pagina', detalle: errores[0].slice(0, 160), pagina, vps: new Set() }); hallazgos.get(k).vps.add(`${v.w}x${v.h}`); }
      } catch (e) {
        hallazgos.set(`${pagina}|CARGA|${v.w}`, { tipo: 'CARGA', nivel: 'HIGH', donde: 'pagina', detalle: String(e.message).slice(0, 160), pagina, vps: new Set([`${v.w}x${v.h}`]) });
      }
      await ctx.close();
    }
    di(`· /${pagina}  ${[...hallazgos.values()].filter((h) => h.pagina === pagina).length} hallazgo(s)`);
  }
} finally { await browser.close(); }

// ---------------------------------------------------------------- informe
const lista = [...hallazgos.values()].map((h) => ({ ...h, vps: [...h.vps] }));
const NOMBRE = { I1: 'texto recortado', I2: 'texto sobre texto', I3: 'control tapado', I4: 'desborde de pagina', I5: 'imagen rota', I6: 'objetivo tactil', JS: 'error de pagina', CARGA: 'no cargo' };
const graves = lista.filter((h) => h.nivel === 'HIGH' || h.nivel === 'CRITICAL');
const md = [
  `# gate-integridad · ${new Date().toISOString()}`, '',
  `Base: ${BASE ?? cfg.sitio.staging} · ventanas: ${VP.origen} · ${PAGINAS.length} pagina(s) × ${VP.lista.length} ventana(s) · ${paradasTotales} paradas de scroll · **fallos ${graves.length}**`, '',
  '| pagina | tipo | nivel | donde | detalle | ventanas |', '|---|---|---|---|---|---|',
  ...lista.map((h) => `| /${h.pagina} | ${h.tipo} ${NOMBRE[h.tipo]} | ${h.nivel} | \`${h.donde}\` | ${h.detalle.replace(/\|/g, '/')} | ${h.vps.slice(0, 8).join(' ')}${h.vps.length > 8 ? ` +${h.vps.length - 8}` : ''} |`),
].join('\n') + '\n';
mkdirSync(SALIDA_DIR, { recursive: true });
writeFileSync(join(SALIDA_DIR, `${SALIDA}.md`), md);
writeFileSync(join(SALIDA_DIR, `${SALIDA}.json`), JSON.stringify({ ventanas: VP, paradas: paradasTotales, hallazgos: lista }, null, 1));

if (JSON_) console.log(JSON.stringify({ cobertura: VP.cobertura, ventanas: VP.lista.length, paradas: paradasTotales,
  fallos: lista.map((h) => ({ nivel: h.nivel, tipo: h.tipo, que: `/${h.pagina} · ${NOMBRE[h.tipo]} · ${h.donde}`, detalle: `${h.detalle} — en ${h.vps.slice(0, 6).join(', ')}${h.vps.length > 6 ? ` y ${h.vps.length - 6} mas` : ''}` })) }));
else console.log(`\n${graves.length ? 'FAIL' : 'PASS'} · ${graves.length} fallos graves, ${lista.length - graves.length} menores · ${paradasTotales} paradas → ${join(SALIDA_DIR, `${SALIDA}.md`)}`);
process.exit(graves.length ? 1 : 0);
