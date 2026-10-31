#!/usr/bin/env node
/**
 * Clone-to-Webflow — captura del lado build.
 *
 * Cada detalle de aquí existe porque su ausencia produce un falso positivo global,
 * del tipo que hace perder iteraciones enteras persiguiendo un problema que no existe:
 *
 *   DPR 1                 con DPR 2 la imagen sale al doble y el diff compara escalas
 *                         distintas. Ya mordió antes: ver la nota de 2× DPR del clon del Cliente D.
 *   --hide-scrollbars     una scrollbar clásica se come ~15 px de ancho y desplaza TODA
 *                         la página hacia la izquierda. Diff rojo de punta a punta.
 *   recorte por rect      y no element.screenshot(): el screenshot de elemento hornea lo
 *                         que se pinta encima, y eso ya mordió en el clon de Clay.
 *   fuentes cargadas      document.fonts.ready antes de disparar, o la primera captura
 *                         sale con la fuente de respaldo.
 *   scroll a progreso     el frame de Figma de una sección pineada es un ESTADO, no una
 *                         posición. Sin llevar el scroll a su progreso se comparan cosas
 *                         distintas y el diff no significa nada.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);

export async function launch() {
  return chromium.launch({
    args: ['--hide-scrollbars', '--force-device-scale-factor=1', '--font-render-hinting=none'],
  });
}

export async function openPage(browser, { url, width, reducedMotion = false }) {
  const ctx = await browser.newContext({
    // 1000 y no 900: el hero de Solutions cede su hueco superior cuando la ventana no le da
    // (ver `section.vt-sh` en build/motion/sol.css). A 900 se capturaria el hero YA comprimido
    // y la referencia de Figma —que es la geometria canonica, con ventana holgada— dejaria de
    // corresponder. Ninguna otra seccion depende del alto de la ventana.
    // VT_ALTO: una seccion cuya geometria depende de 100vh (hero v11 de Cliente A) se mide al alto del frame de Figma.
    viewport: { width, height: Number(process.env.VT_ALTO || 1000) },
    deviceScaleFactor: 1,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  // `networkidle` deja de asentar en cuanto la pagina tiene un bucle de rAF vivo (GSAP +
  // Lenis): la medicion del sitio publicado se quedaba colgada 60 s. Se espera a `load` y
  // luego a que las fuentes y las imagenes esten listas, que es lo que de verdad decide el
  // pixel.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Hoja de sobreescritura bajo prueba: permite medir una banda nueva contra la URL
  // publicada ANTES de subirla a Webflow. Es el mismo camino que seguira el Embed, asi que
  // lo que mida aqui es lo que se vera alli. `VT_CSS` es una ruta local.
  if (process.env.VT_CSS) {
    // Al FINAL del body, no en el <head>: los Embeds de Webflow viven en el body y su
    // conmutador de bandas usa `!important`. Misma especificidad, gana el ultimo — que
    // es exactamente donde ira este bloque cuando sea un Embed.
    await page.evaluate((css) => {
      const s = document.createElement('style');
      s.textContent = css;
      document.body.appendChild(s);
    }, readFileSync(process.env.VT_CSS, 'utf8'));
  }
  await page.evaluate(() => document.fonts.ready);
  // Los fondos CSS solo se descargan cuando tocaria pintarlos, asi que el sitio publicado
  // se medía distinto en cada corrida. `networkidle` tampoco sirve ya: con GSAP y Lenis
  // vivos nunca asienta. Se enumeran las URL de background-image y se esperan una por una;
  // eso sí es determinista.
  await page.evaluate(async () => {
    const urls = new Set();
    for (const el of document.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none') continue;
      for (const m of bg.matchAll(/url\(["']?(.*?)["']?\)/g)) if (m[1]) urls.add(m[1]);
    }
    // `onload` dice que los bytes llegaron; NO dice que el mapa de bits este listo para pintar.
    // Con la pagina cargando 60+ imagenes la ultima baldosa llegaba tarde y el screenshot salia
    // con una banda sin pintar en un borde — 785 px de diferencia fantasma en el CTA. `decode()`
    // espera al bitmap.
    await Promise.all([...urls].map(async (u) => {
      const i = new Image(); i.src = u;
      try { await i.decode(); } catch { /* un asset roto lo caza el gate de imagenes, no este */ }
    }));
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(500);
  // Las imágenes en lazy no se resuelven solas si nunca entran al viewport.
  await page.evaluate(async () => {
    document.querySelectorAll('img[loading="lazy"]').forEach((i) => (i.loading = 'eager'));
    await Promise.all([...document.images].filter((i) => !i.complete)
      .map((i) => new Promise((r) => { i.onload = i.onerror = r; })));
    // `complete` no basta: una lazy aun no pedida puede reportarse completa y el bitmap con
    // decoding=async llega tarde. decode() de cada imagen con src espera al mapa de bits.
    await Promise.all([...document.images].filter((i) => i.currentSrc || i.src)
      .map((i) => i.decode().catch(() => {})));
  });
  return { ctx, page };
}

/**
 * Lleva el scroll al progreso p (0..1) del elemento pineado y espera a que la línea de
 * tiempo asiente. `settleMs` no es un número mágico de cortesía: GSAP con Lenis
 * interpola, y disparar antes captura un fotograma intermedio.
 */
async function scrollToProgress(page, selector, p, settleMs = 700) {
  await page.evaluate(async ({ selector, p }) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`selector no encontrado: ${selector}`);
    const r = el.getBoundingClientRect();
    const top = r.top + window.scrollY;
    const travel = Math.max(0, el.offsetHeight - window.innerHeight);
    window.scrollTo({ top: top + travel * p, behavior: 'instant' });
  }, { selector, p });
  await page.waitForTimeout(settleMs);
}

/** Screenshot de página completa recortado al rect del selector, en coordenadas de documento. */
async function shootRegion(page, selector, outPath) {
  const rect = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY),
             width: Math.round(r.width), height: Math.round(r.height) };
  }, selector);
  if (!rect) throw new Error(`selector no encontrado: ${selector}`);

  const full = await page.screenshot({ fullPage: true, animations: 'disabled' });
  const meta = await sharp(full).metadata();
  // Un rect que se sale del lienzo es en sí un hallazgo (overflow), no algo que recortar
  // en silencio: se acota y se reporta.
  const clip = {
    left: Math.max(0, Math.min(rect.x, meta.width - 1)),
    top: Math.max(0, Math.min(rect.y, meta.height - 1)),
    width: Math.min(rect.width, meta.width - Math.max(0, rect.x)),
    height: Math.min(rect.height, meta.height - Math.max(0, rect.y)),
  };
  const clamped = clip.width !== rect.width || clip.height !== rect.height;
  await sharp(full).extract(clip).png().toFile(outPath);
  return { rect, clip, clamped, pageSize: { width: meta.width, height: meta.height } };
}

/** Gate G1: overflow horizontal. Se mide en el documento, no a ojo. */
export async function measureOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const offenders = [];
    if (de.scrollWidth > de.clientWidth) {
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1)) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || '').toString().slice(0, 80),
            left: Math.round(r.left), right: Math.round(r.right),
          });
        }
        if (offenders.length >= 15) break;
      }
    }
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
             overflows: de.scrollWidth > de.clientWidth, offenders };
  });
}

export async function captureAll({ url, outDir, map, reducedMotion = false }) {
  mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const results = [];
  const byViewport = map.reduce((m, s) => ((m[s.viewport] ??= []).push(s), m), {});

  for (const [vw, shots] of Object.entries(byViewport)) {
    const { ctx, page } = await openPage(browser, { url, width: Number(vw), reducedMotion });
    const overflow = await measureOverflow(page);
    for (const shot of shots) {
      if (shot.prep) await page.evaluate(shot.prep);
      if (shot.progress != null) {
        await scrollToProgress(page, shot.pinSelector ?? shot.selector, shot.progress, shot.settleMs);
      }
      const suffix = '';
      const out = join(outDir, `${shot.label}.${vw}${suffix}.png`);
      const info = await shootRegion(page, shot.selector, out);
      results.push({ ...shot, out, ...info, overflow });
      console.log(`  ${shot.label} @${vw}${shot.progress != null ? ` p=${shot.progress}` : ''} → ${info.clip.width}x${info.clip.height}${info.clamped ? '  RECORTADO (overflow)' : ''}`);
    }
    await ctx.close();
  }
  await browser.close();
  writeFileSync(join(outDir, '_capture.json'), JSON.stringify(results, null, 2));
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url, out = 'actual', map } = ARGS;
  if (!url || !map) {
    console.error('uso: capture.mjs --url <url> --map <capture-map.json> [--out <dir>] [--reduced-motion]');
    process.exit(2);
  }
  await captureAll({
    url, outDir: out,
    map: JSON.parse(readFileSync(map, 'utf8')),
    reducedMotion: 'reduced-motion' in ARGS,
  });
}
