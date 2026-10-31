#!/usr/bin/env node
/**
 * Gate · las imagenes van a sangre de su caja: sin filete, sin margen interior, sin bandas.
 *
 *   node scripts/gate-imagenes.mjs [pagina...] [--ancho 1920]
 *
 * POR QUE EXISTE. En Cliente B todas las fotos (retratos, huecos de foto, thumbs de
 * tarjeta) salieron con un filete de 1 px #BDBDBD heredado del placeholder de Figma. La paridad
 * no lo cobra: el frame tenia el mismo filete, asi que el diff daba PASS. El cliente lo vio como
 * «margenes grises» y pidio quitarlos en todas las paginas y en las que vengan. Esto es lo que
 * impide que el siguiente port lo vuelva a traer.
 *
 * QUE MIDE (en el navegador, con getComputedStyle, nunca en la hoja):
 *   I1 · borde: cualquier lado con border-style distinto de none y ancho > 0. FAIL.
 *   I2 · outline visible. FAIL.
 *   I3 · padding en el propio elemento de imagen (margen interior que deja ver el fondo). FAIL.
 *   I4 · object-fit: contain con bandas (la caja no tiene la proporcion de la imagen y el fondo
 *        del elemento es visible): bandas >= 2 px. FAIL.
 *   I5 · seccion sin foto: una <section> que a 1920 muestra al menos una imagen y en este ancho
 *        no muestra ninguna (Cliente B 2026-10-15: la clase compartida del hero se oculta
 *        bajo 992 porque el Home usa variantes -m/-t; Nosotros y Como Trabajamos quedaron con el
 *        hero en negro en movil y tablet, y la captura chica lo hizo pasar por «foto oscura»). FAIL.
 *
 * QUE ES «IMAGEN»: todo <img> y <picture> de 40 px o mas, todo elemento con background-image,
 * y todo elemento cuya clase diga foto|thumb|retrato|imagen|hero-img (los huecos de foto son
 * imagenes aunque hoy lleven un texto). Se excluyen las leyendas (`*-cap`) y los logos (`*logo*`).
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { PAGINAS, etiquetaDe, rutaDe, enProyecto } from './config.mjs';

const args = process.argv.slice(2);
let ancho = 1920;
const pedidas = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ancho') { ancho = +args[++i] || ancho; continue; }
  if (args[i].startsWith('--')) continue;
  pedidas.push(args[i]);
}
const objetivo = pedidas.length ? pedidas : PAGINAS.map(etiquetaDe);
const paginaDe = (et) => (et === 'home' ? '' : et);

const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: ancho, height: Math.round(ancho * 9 / 16) } });
const pg = await ctx.newPage();
const fallos = [];
const informe = {};
// I5: por seccion, cuantas imagenes se VEN (caja >= 40 px, cargadas, o background-image con url)
const fotosPorSeccion = () => [...document.querySelectorAll('section')].map((sec) => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width >= 40 && r.height >= 40 && c.visibility !== 'hidden' && parseFloat(c.opacity) > 0; };
  let n = 0;
  for (const el of sec.querySelectorAll('img')) if (vis(el) && el.naturalWidth > 0) n++;
  for (const el of [sec, ...sec.querySelectorAll('*')]) { const bi = getComputedStyle(el).backgroundImage; if (bi && /url\(/.test(bi) && vis(el)) n++; }
  return { clase: (typeof sec.className === 'string' ? sec.className : '').trim() || 'section', n };
});
const ctxRef = ancho !== 1920 ? await nav.newContext({ viewport: { width: 1920, height: 1080 } }) : null;
const pgRef = ctxRef ? await ctxRef.newPage() : null;
const recorre = async (p) => p.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
  scrollTo(0, 0);
});

console.log(`\n== gate-imagenes @${ancho}`);
for (const et of objetivo) {
  const url = rutaDe(paginaDe(et));
  await pg.goto(url, { waitUntil: 'networkidle' });
  await pg.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    scrollTo(0, 0);
  });
  const filas = await pg.evaluate(() => {
    const out = [];
    const vistos = new Set();
    const cls = (el) => (typeof el.className === 'string' ? el.className : '').trim();
    const esImagen = (el) => {
      const c = cls(el);
      if (/-cap\b|logo/i.test(c)) return false;
      if (el.tagName === 'IMG' || el.tagName === 'PICTURE') return true;
      if (/(^|\s)[\w-]*(foto|thumb|retrato|imagen|hero-img)[\w-]*/i.test(c)) return true;
      const bi = getComputedStyle(el).backgroundImage;
      return bi && bi !== 'none' && /url\(/.test(bi);
    };
    for (const el of document.querySelectorAll('img, picture, [class]')) {
      if (vistos.has(el) || !esImagen(el)) continue;
      vistos.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      const cs = getComputedStyle(el);
      const lados = ['Top', 'Right', 'Bottom', 'Left'];
      const borde = lados.filter((l) => cs[`border${l}Style`] !== 'none' && parseFloat(cs[`border${l}Width`]) > 0)
        .map((l) => `${l.toLowerCase()} ${cs[`border${l}Width`]} ${cs[`border${l}Color`]}`);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? `${cs.outlineWidth} ${cs.outlineColor}` : null;
      const pad = lados.map((l) => parseFloat(cs[`padding${l}`]) || 0);
      const padding = el.tagName === 'IMG' && pad.some((v) => v > 0) ? pad.join('/') : null;
      let bandas = null;
      if (el.tagName === 'IMG' && cs.objectFit === 'contain' && el.naturalWidth && el.naturalHeight) {
        const esc = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight);
        const bx = r.width - el.naturalWidth * esc, by = r.height - el.naturalHeight * esc;
        const fondo = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
        if (fondo && Math.max(bx, by) >= 2) bandas = `${bx.toFixed(0)}x${by.toFixed(0)} px sobre ${cs.backgroundColor}`;
      }
      out.push({ clase: cls(el) || el.tagName.toLowerCase(), tag: el.tagName.toLowerCase(), caja: [Math.round(r.width), Math.round(r.height)], borde, outline, padding, bandas });
    }
    return out;
  });
  informe[et] = filas;
  const malas = filas.filter((f) => f.borde.length || f.outline || f.padding || f.bandas);
  console.log(`\n/${paginaDe(et)}  ${filas.length} imagenes`);
  if (pgRef) {
    await pgRef.goto(url, { waitUntil: 'networkidle' }); await recorre(pgRef);
    const ref = await pgRef.evaluate(fotosPorSeccion);
    const aqui = await pg.evaluate(fotosPorSeccion);
    ref.forEach((r, i) => {
      const a = aqui[i];
      if (r.n > 0 && a && a.clase === r.clase && a.n === 0) {
        console.log(`  FAIL  I5 ${r.clase}: ${r.n} imagen(es) a 1920, ninguna visible a ${ancho}`);
        fallos.push({ pagina: et, clase: r.clase, i5: `${r.n} a 1920, 0 a ${ancho}` });
        malas.push({ i5: true });
      }
    });
  }
  for (const f of malas.filter((m) => !m.i5)) {
    const motivos = [];
    if (f.borde.length) motivos.push(`I1 borde ${f.borde.join(', ')}`);
    if (f.outline) motivos.push(`I2 outline ${f.outline}`);
    if (f.padding) motivos.push(`I3 padding ${f.padding}`);
    if (f.bandas) motivos.push(`I4 bandas ${f.bandas}`);
    console.log(`  FAIL  ${f.clase} (${f.tag} ${f.caja.join('x')})  ${motivos.join(' · ')}`);
    fallos.push({ pagina: et, ...f });
  }
  if (!malas.length) console.log('  OK    todas a sangre, sin filete ni margen interior');
}
await nav.close();
try { mkdirSync(enProyecto('spec', 'gates'), { recursive: true }); writeFileSync(enProyecto('spec', 'gates', `imagenes.${ancho}.json`), JSON.stringify({ ancho, fecha: new Date().toISOString(), fallos, informe }, null, 1)); } catch {}
console.log(fallos.length ? `\n  ${fallos.length} imagen(es) con defecto: FAIL\n` : '\n  IMAGENES A SANGRE en todas las paginas.\n');
process.exit(fallos.length ? 1 : 0);
