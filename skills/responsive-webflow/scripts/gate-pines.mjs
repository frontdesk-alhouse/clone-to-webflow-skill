#!/usr/bin/env node
/**
 * Gate · escenas fijadas (pin de scroll) a los anchos que no son ningun frame.
 *
 *   node gate-pines.mjs [base] [--json] [--solo=ruta] [--viewports=1310x945,1366x1024]
 *                       [--sirve=https://cdn/asset.js=local.js] [--inyecta=ruta:archivo.html] [--salida=nombre]
 *
 * Por que existe (Cliente A, 2026-09-16): todos los gates median a 1440 exactos, donde `zoom = 1` y `100% = 1440px`, asi
 * que los fallos se cancelaban. En un iPad como Sidecar (1310×945) el `pin:true` de GSAP escribia px VISUALES en un
 * layout con `zoom` en body: pin de 1192 en vez de 1310, pin-spacer 9 % corto, la seccion siguiente pasando por encima.
 * 318 fallos que ningun gate veia. Este es ese gate, generalizado.
 *
 * Se mide con scroll REAL a pasos: los disparadores de scroll tienen que dispararse. Por escena y por viewport:
 *   C1  ancho del pin = min(ventana, anchoMax) ± 1 mientras esta fijado
 *   C2  la escena, centrada en la ventana ± 2
 *   C3  textos y piezas sin recorte horizontal (ventana + ancestros con overflow)
 *   C4  cada pieza de `dentroDe`, dentro de su marco
 *   C5  al ENTRAR y al SOLTAR: el pin no salta y la seccion siguiente no le pasa por encima
 *   C0  sin errores de pagina
 *   C9  ningun pin sin declarar: todo lo que lleva `pin-spacer` o un ScrollTrigger con pin tiene que estar en `pines.escenas`
 *
 * Config (`pines`, en harness.config.json o responsive.config.json):
 *   { "escenas": [{ "ruta":"product", "nombre":"pasos", "pin":".x__fijo", "escena":".x__esc", "pista":".x-track",
 *                   "anchoMax":1440, "desde":1200, "textos":[".x p"], "piezas":[".x__ventana"], "dentroDe":[[".x__tecla",".x__foto"]] }],
 *     "viewports": [[1310,945]],  "anchosExtra": [1310,1366],  "alto": 900 }
 * Sin `viewports`, los anchos salen del plan derivado (`plan-anchos.json`) + `anchosExtra`. Sin escenas: exit 2 (OMITIDO).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium as cargaChromium, ARGS } from './lib/pw.mjs';
import { cargaConfig } from './lib/config.mjs';
import { CATALOGO } from './lib/viewports.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const cfg = cargaConfig();
const JSON_ = args.includes('--json');
const di = (...a) => { if (!JSON_) console.log(...a); };
const BASE = (args.find((a) => /^(https?|file):\/\//.test(a)) ?? cfg.sitio.staging).replace(/\/$/, '');
const SALIDA_DIR = cfg.salida || 'responsive-out';
const SALIDA = opt('salida') || 'gate-pines';
const SOLO = opt('solo')?.split(',') ?? null;
const SIRVE = (opt('sirve') || '').split(',').filter(Boolean).map((s) => { const i = s.lastIndexOf('='); return [s.slice(0, i), s.slice(i + 1)]; });
const INYECTA = (opt('inyecta') || '').split(',').filter(Boolean).map((s) => { const i = s.indexOf(':'); return { ruta: s.slice(0, i), html: readFileSync(s.slice(i + 1), 'utf8') }; });

const P = cfg.pines ?? {};
const ESCENAS = (P.escenas ?? []).filter((e) => e.pin && e.escena && (!SOLO || SOLO.includes(e.ruta)));
if (!ESCENAS.length) {
  console.error(`gate-pines: no hay escenas fijadas declaradas en \`pines.escenas\` de ${cfg.__path}. Si el sitio tiene pines, declaralos; si no, este gate no aplica.`);
  process.exit(2);
}
const MIN_ESC = cfg.bandas?.escritorio?.min ?? 1200;
const ALTO = P.alto ?? 900;

/** Viewports: explicitos, o derivados del plan de anchos del sitio. Nunca una lista escrita a mano en el script. */
function viewports() {
  const cli = opt('viewports');
  if (cli) return { lista: cli.split(',').map((s) => s.split('x').map(Number)), origen: '--viewports' };
  if (P.viewports?.length) return { lista: P.viewports, origen: 'pines.viewports' };
  const plan = join(SALIDA_DIR, 'plan-anchos.json');
  const extra = P.anchosExtra ?? [];
  // ventanas reales, con SU alto: las del usuario y el catalogo (los portatiles de alto corto son donde mas sufre un pin)
  const reales = [...(cfg.dispositivos ?? []), ...(cfg.evaluacion?.catalogo === false ? [] : CATALOGO)].map((d) => [d.w, d.h]);
  if (existsSync(plan)) {
    const anchos = [...new Set([...JSON.parse(readFileSync(plan, 'utf8')).lista, ...extra])].sort((a, b) => a - b);
    return { lista: [...reales, ...anchos.map((w) => [w, ALTO])], origen: `${reales.length} ventanas reales (catalogo + usuario) + ${plan} + anchosExtra` };
  }
  const defecto = [...new Set([MIN_ESC, 1280, 1310, 1366, 1439, 1440, 1728, 1920, ...extra])].sort((a, b) => a - b);
  return { lista: [...reales, ...defecto.map((w) => [w, ALTO])], origen: 'POR_DEFECTO: no hay plan-anchos.json. Corre conmutadores → barrido-continuidad → plan-anchos.' };
}
const VP = viewports();

const filas = [];
const anota = (r) => { filas.push(r); if (!r.ok) di(`  ✗ ${r.ruta || '/'} ${r.vp} ${r.escena} ${r.check}: ${r.valor} (umbral ${r.umbral})`); };

// ---------------------------------------------------------------- lo que corre dentro de la pagina
const HELPERS = `
window.__g = {
  opac(el){ let o=1; for(let n=el;n&&n.nodeType===1;n=n.parentElement){ const cs=getComputedStyle(n); o*=parseFloat(cs.opacity); if(cs.visibility==='hidden'||cs.display==='none') return 0; } return o; },
  visibleH(el){
    const r=el.getBoundingClientRect(); let L=Math.max(0,r.left), R=Math.min(innerWidth,r.right);
    for(let n=el.parentElement;n&&n!==document.documentElement;n=n.parentElement){
      if(getComputedStyle(n).overflowX==='visible') continue;
      const a=n.getBoundingClientRect(); L=Math.max(L,a.left); R=Math.min(R,a.right);
    }
    return { left:r.left, right:r.right, corte: Math.max(0,r.right-R)+Math.max(0,L-r.left) };
  },
  /* tramo fijado, en px de scroll: el del disparador si lo hay; si no, la geometria de la pista */
  tramo(pin, selPista){
    if(window.ScrollTrigger){
      const c=ScrollTrigger.getAll().filter(t=>t.trigger===pin||t.pin===pin||(t.trigger===pin.parentElement&&!t.trigger.classList.contains('pin-spacer')));
      c.sort((a,b)=>(b.end-b.start)-(a.end-a.start));
      if(c[0]&&c[0].end>c[0].start) return {start:c[0].start,end:c[0].end,via:'ScrollTrigger'};
    }
    const pista=(selPista&&document.querySelector(selPista))||pin.closest('.pin-spacer')||pin.parentElement;
    const r=pista.getBoundingClientRect(), p=pin.getBoundingClientRect();
    const tope=parseFloat(getComputedStyle(pin).top)||0;
    return {start:r.top+scrollY-tope, end:r.bottom+scrollY-p.height-tope, via:'geometria'};
  },
  /* la seccion que va DEBAJO en pantalla (no la hermana del DOM: con flex + order no coinciden) */
  siguiente(pin, selPista){
    const cont=(selPista&&document.querySelector(selPista))||pin.parentElement, cTop=cont.getBoundingClientRect().top;
    let mejor=null, mejorTop=Infinity;
    for(const s of document.querySelectorAll('section, footer, .w-embed > div')){
      if(s.contains(pin)||pin.contains(s)||cont.contains(s)) continue;
      const r=s.getBoundingClientRect();
      if(r.height<=50||getComputedStyle(s).display==='none') continue;
      if(r.top>cTop+10&&r.top<mejorTop){ mejor=s; mejorTop=r.top; }
    }
    return mejor;
  },
  frame(){ return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); },
};`;

async function irA(page, y, paso = 420) {
  await page.evaluate(async ({ y, paso }) => {
    const max = document.documentElement.scrollHeight - innerHeight;
    y = Math.max(0, Math.min(max, y));
    let cur = scrollY, guard = 0;
    while (Math.abs(cur - y) > 1 && guard++ < 400) {
      const d = Math.max(-paso, Math.min(paso, y - cur));
      scrollTo(0, cur + d); await new Promise((r) => setTimeout(r, 45)); cur = scrollY;
      if (Math.abs(d) < 1) break;
    }
  }, { y, paso });
  await page.waitForTimeout(300);
}

async function mideEscena(page, ctx, e) {
  const { ruta, vp, H } = ctx;
  const base = { ruta, vp, escena: e.nombre || e.pin };
  const tramo = await page.evaluate((e) => { const pin = document.querySelector(e.pin); return pin ? __g.tramo(pin, e.pista) : null; }, e);
  if (!tramo) { anota({ ...base, check: 'existe', ok: false, valor: `no hay ${e.pin}`, umbral: '—' }); return; }
  if (!(tramo.end > tramo.start)) { anota({ ...base, check: 'tiene recorrido', ok: false, valor: `start ${tramo.start} end ${tramo.end} (${tramo.via})`, umbral: 'end > start' }); return; }
  const { start, end } = tramo;

  for (const f of [0.12, 0.5, 0.9]) {
    await irA(page, start + (end - start) * f);
    await page.waitForTimeout(e.espera ?? 800);            // resortes y coreografia
    const m = await page.evaluate((e) => {
      const g = __g, pin = document.querySelector(e.pin), pr = pin.getBoundingClientRect();
      const enPantalla = (r) => r.width > 0 && r.bottom > 0 && r.top < innerHeight;
      const centros = [...document.querySelectorAll(e.escena)].map((x) => x.getBoundingClientRect()).filter(enPantalla)
        .map((r) => +(r.left + r.width / 2 - innerWidth / 2).toFixed(1));
      const visibles = (sels) => (sels || []).flatMap((sel) => [...document.querySelectorAll(sel)]
        .filter((x) => g.opac(x) > 0.5 && enPantalla(x.getBoundingClientRect())).map((x) => ({ sel, ...g.visibleH(x) })));
      const dentro = (e.dentroDe || []).map(([a, b]) => {
        const k = document.querySelector(a); if (!k || g.opac(k) <= 0.5 || !k.getBoundingClientRect().width) return null;
        const kr = k.getBoundingClientRect();
        const ok = [...document.querySelectorAll(b)].some((c) => { const r = c.getBoundingClientRect(); return kr.left >= r.left - 1 && kr.right <= r.right + 1 && kr.top >= r.top - 1 && kr.bottom <= r.bottom + 1; });
        return { par: `${a} en ${b}`, ok, kr: [kr.left, kr.top, kr.width, kr.height].map(Math.round) };
      }).filter(Boolean);
      return { pinW: pr.width, W: innerWidth, centros, textos: visibles(e.textos), piezas: visibles(e.piezas), dentro };
    }, e);
    const etq = `@${Math.round(f * 100)}%`;
    const esperado = Math.min(m.W, e.anchoMax ?? m.W);       // por encima del tope la composicion se congela, centrada
    const c1 = Math.abs(m.pinW - esperado) <= 1 || (e.anchoMax && m.W > e.anchoMax && m.pinW >= e.anchoMax - 1 && m.pinW <= m.W + 1);
    anota({ ...base, check: `C1 ancho del pin ${etq}`, ok: !!c1, valor: m.pinW.toFixed(1), umbral: `${esperado}±1` });
    const peor = m.centros.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    anota({ ...base, check: `C2 centrado ${etq}`, ok: Math.abs(peor) <= 2, valor: `${peor}px (${m.centros.length} escenas)`, umbral: '±2' });
    for (const t of [...m.textos, ...m.piezas]) anota({ ...base, check: `C3 sin recorte ${t.sel} ${etq}`, ok: t.corte <= 1, valor: `corte ${t.corte.toFixed(0)}px [${t.left.toFixed(0)}…${t.right.toFixed(0)}]`, umbral: '≤1' });
    for (const d of m.dentro) anota({ ...base, check: `C4 ${d.par} ${etq}`, ok: d.ok, valor: JSON.stringify(d.kr), umbral: 'dentro' });
  }

  for (const [nombre, desde, hasta] of [['entrada', start - 600, start + 200], ['salida', end - 200, end + 700]]) {
    await irA(page, desde - 400);
    await irA(page, desde, 40);
    const muestras = await page.evaluate(async ({ e, hasta }) => {
      const g = __g, pin = document.querySelector(e.pin), sig = g.siguiente(pin, e.pista);
      const max = document.documentElement.scrollHeight - innerHeight, out = [];
      for (let y = scrollY, k = 0; y <= Math.min(max, hasta) && k < 60; y += 40, k++) {
        scrollTo(0, y); await g.frame(); await g.frame();
        const r = pin.getBoundingClientRect(), n = sig ? sig.getBoundingClientRect() : null;
        out.push({ y: scrollY, bottom: r.bottom, sigTop: n ? n.top : null });
      }
      return out;
    }, { e, hasta });
    let salto = 0, encima = 0;
    for (let i = 1; i < muestras.length; i++) {
      const a = muestras[i - 1], b = muestras[i], dS = b.y - a.y, dB = b.bottom - a.bottom;
      // permitido: quieto (0) o subir con el scroll (−dS). Nada fuera de [−dS−3, +3].
      salto = Math.max(salto, dB > 3 ? dB : dB < -dS - 3 ? -dS - dB : 0);
      if (b.sigTop !== null && b.sigTop < H && b.sigTop < b.bottom - 2) encima = Math.max(encima, b.bottom - b.sigTop);
    }
    anota({ ...base, check: `C5 ${nombre} sin salto`, ok: salto <= 3, valor: `${salto.toFixed(0)}px`, umbral: '≤3' });
    anota({ ...base, check: `C5 ${nombre} nada encima`, ok: encima <= 2, valor: `${encima.toFixed(0)}px`, umbral: '≤2' });
  }
}

// ---------------------------------------------------------------- bucle
const rutas = [...new Set(ESCENAS.map((e) => e.ruta ?? ''))];
const urlDe = (ruta) => (BASE.startsWith('file:') ? `${BASE}/${ruta}` : `${BASE}/${ruta.replace(/^\//, '')}`.replace(/\/$/, '') || BASE);
di(`\ngate-pines · ${BASE}\nviewports: ${VP.origen}\n`);
const chromium = await cargaChromium();
const browser = await chromium.launch({ args: ARGS });
try {
  for (const ruta of rutas) {
    const escenas = ESCENAS.filter((e) => (e.ruta ?? '') === ruta);
    for (const [W, H] of VP.lista) {
      const aplican = escenas.filter((e) => W >= (e.desde ?? MIN_ESC) && W <= (e.hasta ?? Infinity));
      if (!aplican.length) continue;
      const vp = `${W}x${H}`;
      di(`· /${ruta} ${vp}`);
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errores = [];
      page.on('pageerror', (err) => errores.push(err.message));
      for (const [u, archivo] of SIRVE) await page.route(u, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: readFileSync(archivo, 'utf8') }));
      await page.goto(urlDe(ruta), { waitUntil: 'load', timeout: 90000 });
      for (const inj of INYECTA.filter((i) => i.ruta === ruta)) await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), inj.html);
      await page.waitForTimeout(P.esperaCarga ?? 1500);
      await page.addScriptTag({ content: HELPERS });
      // C9 · pines que nadie declaro. Un gate que solo mide lo declarado deja fuera justo la escena que se olvido
      // (Cliente A 2026-09-17: el mazo de agentes de /product llevaba el mismo fallo que las otras tres y no estaba en la lista).
      const sueltos = await page.evaluate((declarados) => {
        const cls = (n) => (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/)[0] : n.tagName.toLowerCase());
        const pines = new Set([...document.querySelectorAll('.pin-spacer > *')]);
        if (window.ScrollTrigger) for (const t of ScrollTrigger.getAll()) if (t.pin) pines.add(t.pin);
        return [...pines].filter((n) => !declarados.some((d) => { try { return n.matches(d) || n.querySelector(d) || n.closest(d); } catch { return false; } })).map(cls);
      }, escenas.map((e) => e.pin));
      for (const s of new Set(sueltos)) anota({ ruta, vp, escena: s, check: 'C9 pin sin declarar', ok: false, valor: `${s} esta fijado con pin-spacer y no figura en pines.escenas: nadie lo mide`, umbral: 'declarado' });
      for (const e of aplican) await mideEscena(page, { ruta, vp, H }, e);
      anota({ ruta, vp, escena: 'pagina', check: 'C0 errores de pagina', ok: errores.length === 0, valor: errores.slice(0, 2).join(' | ') || '0', umbral: '0' });
      await ctx.close();
    }
  }
} finally { await browser.close(); }

// ---------------------------------------------------------------- informe
const fallos = filas.filter((r) => !r.ok);
const md = [
  `# gate-pines · ${new Date().toISOString()}`, '',
  `Base: ${BASE} · viewports: ${VP.origen} · filas ${filas.length} · **fallos ${fallos.length}**`, '',
  '## Fallos', '', '| ruta | viewport | escena | check | valor | umbral |', '|---|---|---|---|---|---|',
  ...fallos.map((r) => `| /${r.ruta} | ${r.vp} | ${r.escena} | ${r.check} | ${r.valor} | ${r.umbral} |`),
  '', '## Todo', '', '| ruta | viewport | escena | check | ok | valor |', '|---|---|---|---|---|---|',
  ...filas.map((r) => `| /${r.ruta} | ${r.vp} | ${r.escena} | ${r.check} | ${r.ok ? 'ok' : 'FALLA'} | ${r.valor} |`),
].join('\n') + '\n';
mkdirSync(SALIDA_DIR, { recursive: true });
writeFileSync(join(SALIDA_DIR, `${SALIDA}.md`), md);

if (JSON_) {
  // Un hallazgo por escena y check (sin el punto del recorrido), con los viewports donde falla: el runner agrega, no repite.
  const grupos = {};
  for (const r of fallos) { const k = `/${r.ruta} · ${r.escena} · ${r.check.split(' @')[0]}`; (grupos[k] ||= []).push(`${r.vp}: ${r.valor}`); }
  console.log(JSON.stringify({ viewports: VP.origen, filas: filas.length,
    fallos: Object.entries(grupos).map(([que, d]) => ({ nivel: 'HIGH', que, detalle: [...new Set(d)].slice(0, 6).join(' · ') })) }));
} else console.log(`\n${fallos.length ? 'FAIL' : 'PASS'} · ${fallos.length} fallos de ${filas.length} → ${join(SALIDA_DIR, `${SALIDA}.md`)}`);
process.exit(fallos.length ? 1 : 0);
