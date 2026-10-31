#!/usr/bin/env node
/**
 * Promueve a CLASE PLANA los selectores de descendencia que solo existen para dar
 * tipografia a un nodo de texto sin clase (`.vt-pp__btn span`, `.vt-pf__q b`, `.vt-ph__h1 p`).
 *
 * Por que hace falta y no es cosmetica: `data_whtml_builder` DESCARTA los elementos cuyo
 * `class` no aparece en el CSS que se le pasa. En el hero publicado eso se comio los dos
 * `<span>Monthly</span>` / `<span>Annual</span>` del toggle: las cajas quedaron, las
 * etiquetas no. Y su CSS tampoco podia ir en el parametro `css`, porque el builder rechaza
 * la insercion ENTERA en cuanto ve un selector anidado.
 *
 * El emparejado se hace con `querySelectorAll` dentro de un navegador de verdad, no con una
 * expresion regular sobre el HTML: la semantica de descendencia es exactamente la del motor
 * que va a pintar la pagina.
 *
 * Entra:  build/webflow/pricing/<sec>.html  +  build/webflow/pricing/embed/<sec>.css
 * Sale:   build/webflow/pricing/nativo2/<sec>.{html,css}  y el remanente real de embed.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const SECS = ['pr-hero', 'pr-planes', 'pr-todo', 'pr-faq', 'pr-cta',
              'mpr-hero', 'mpr-planes', 'mpr-todo', 'mpr-faq', 'mpr-cta'];
const RAIZ = 'build/webflow/pricing';
mkdirSync(`${RAIZ}/nativo2`, { recursive: true });

// Un selector se puede promover si es `.clase[.clase] etiqueta` y nada mas: sin atributos,
// sin pseudo, sin combinadores explicitos. Lo demas se queda en el embed a proposito.
const PROMOVIBLE = /^((?:\.[A-Za-z0-9_-]+)+)\s+([a-z]+)$/;
const nombre = (sel) => sel.trim().replace(/^\./, '').replace(/\./g, '_').replace(/\s+/g, '-');

function trocea(css) {
  const out = []; let i = 0;
  while (i < css.length) {
    if (/\s/.test(css[i])) { i++; continue; }
    if (css[i] === '@') {
      const j = css.indexOf('{', i); let k = j, d = 0;
      for (;; k++) { if (css[k] === '{') d++; else if (css[k] === '}') { d--; if (!d) break; } }
      out.push({ at: css.slice(i, k + 1) }); i = k + 1; continue;
    }
    const j = css.indexOf('{', i); if (j < 0) break;
    const k = css.indexOf('}', j);
    out.push({ sel: css.slice(i, j).trim(), body: css.slice(j + 1, k).trim() });
    i = k + 1;
  }
  return out;
}

const nav = await chromium.launch();
const pag = await nav.newPage();
const resumen = [];

for (const sec of SECS) {
  const fHtml = `${RAIZ}/${sec}.html`;
  if (!existsSync(fHtml)) { resumen.push([sec, '—', 'sin html portado']); continue; }
  const html = readFileSync(fHtml, 'utf8');
  const reglas = trocea(readFileSync(`${RAIZ}/embed/${sec}.css`, 'utf8'));

  await pag.setContent(`<!doctype html><body>${html}`);

  const promovidas = [], quedan = [];
  for (const r of reglas) {
    if (r.at) { quedan.push(r.at); continue; }
    const partes = r.sel.split(',').map(s => s.trim());
    const planas = [], nuevas = [];
    for (const p of partes) {
      const m = p.match(PROMOVIBLE);
      if (!m) { planas.push(p); continue; }
      const cls = nombre(p);
      // En local los iconos son <img> a un .svg; en el porte van INLINE como <svg>.
      // La regla que los dimensiona tiene que alcanzar a los dos.
      const busca = m[2] === 'img' ? `${p}, ${m[1]} svg` : p;
      const n = await pag.evaluate(([sel, cls]) => {
        const els = document.querySelectorAll(sel);
        els.forEach(e => e.classList.add(cls));
        return els.length;
      }, [busca, cls]);
      if (n > 0) nuevas.push(`.${cls}`); else planas.push(p);
    }
    if (nuevas.length) promovidas.push(`${nuevas.join(',')}{${r.body}}`);
    // Si lo que sobra del grupo por coma ya es plano, no tiene por que irse al embed.
    if (planas.length) {
      // Las custom properties y `var()` NO pueden volver a nativo aunque el selector sea
      // plano: el builder de Webflow las hornea a literal (KL-30).
      const tokens = /var\(|(^|;)\s*--[A-Za-z0-9_-]+\s*:/.test(';' + r.body);
      const dest = !tokens && planas.every(x => /^(\.[A-Za-z0-9_-]+)+$/.test(x)) ? promovidas : quedan;
      dest.push(`${planas.join(',')}{${r.body}}`);
    }
  }

  const salida = await pag.evaluate(() => document.body.innerHTML);
  writeFileSync(`${RAIZ}/nativo2/${sec}.html`, salida);
  const nativo = readFileSync(`${RAIZ}/nativo/${sec}.css`, 'utf8');
  writeFileSync(`${RAIZ}/nativo2/${sec}.css`, nativo + promovidas.join(''));
  writeFileSync(`${RAIZ}/nativo2/${sec}.embed.css`, quedan.join('\n'));
  resumen.push([sec, promovidas.length, quedan.length]);
}

await nav.close();
console.log('seccion        promovidas   siguen en embed');
for (const [a, b, c] of resumen) console.log(`${String(a).padEnd(14)} ${String(b).padStart(10)} ${String(c).padStart(17)}`);
