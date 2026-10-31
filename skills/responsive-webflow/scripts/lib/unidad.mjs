#!/usr/bin/env node
/**
 * Modo UNIDAD — la matematica de la escala, en UN solo sitio.
 *
 * El generador y el verificador tienen que usar exactamente la misma formula, o el verificador
 * acaba comprobando su propia copia de la regla en vez del CSS. En el original de Cliente A la
 * formula estaba escrita dos veces (responsive-scale-gen.js:4 y responsive-scale-verify.js:6);
 * aqui vive una vez y los dos la importan.
 *
 * Tres factores, todos derivados de la misma unidad:
 *   --u   layout      clamp(umin, 100vw / frame, umax)          proporcional puro
 *   --t   display     min(u, 1 + (u - 1) * .33)                 hacia arriba crece un tercio
 *   --tb  lectura/UI  min(u, 1)                                 hacia arriba no crece
 *
 * `--u` es un NUMERO SIN UNIDAD. En CSS se obtiene con tan(atan2(100vw, <frame>px)): longitud
 * entre longitud da numero, que es lo que exigen scale() y calc(px * n). Un `calc(100vw / 390px)`
 * es invalido.
 */

/** Propiedades de caja: siempre escalan con --u. */
export const GEOMETRIA = {
  x: 'left', y: 'top', w: 'width', h: 'height',
  r: 'border-radius', inset: 'padding', gap: 'gap',
  minh: 'min-height', maxh: 'max-height', minw: 'min-width', maxw: 'max-width',
  top: 'top', left: 'left', right: 'right', bottom: 'bottom',
};

/** Propiedades tipograficas: escalan con el factor declarado en `f` (por defecto u). */
export const TIPOGRAFIA = { fs: 'font-size', lh: 'line-height' };

/** Propiedades que NO escalan: van literales. `ls` en em sigue a su tamano por definicion. */
export const LITERALES = { ls: (v) => `${v}em`, z: (v) => String(v) };

export const uOf = (w, frame, umin, umax) => Math.min(umax, Math.max(umin, w / frame));
export const tOf = (u) => Math.min(u, 1 + (u - 1) * 0.33);
export const tbOf = (u) => Math.min(u, 1);

/** Los tres factores de una banda a un ancho dado. */
export function factores(w, banda) {
  const u = uOf(w, banda.frame, banda.umin, banda.umax);
  return { u, t: tOf(u), tb: tbOf(u) };
}

/** Banda a la que cae un ancho, segun los rangos declarados en el JSON de medidas. */
export function bandaDe(medidas, w) {
  for (const [nombre, b] of Object.entries(medidas.bandas)) {
    if (w >= b.min && w <= b.max) return nombre;
  }
  // Por encima del tope manda la banda mas ancha: la pagina se congela y se centra.
  return Object.entries(medidas.bandas).sort((a, b) => b[1].max - a[1].max)[0][0];
}

const redondea = (v) => +(+v).toFixed(2);

/**
 * Declaraciones CSS de un elemento. Devuelve un array de `prop:valor` en orden estable,
 * para que dos generaciones del mismo JSON den el mismo texto.
 */
export function declaraciones(el) {
  // Dos formas de no pintarse, y no son la misma cosa:
  //   oculto: true         -> el elemento existe y se apaga en esta banda. Emite display:none.
  //   oculto: "heredado"   -> no se pinta porque su ancestro no se pinta, o la regla no aplica
  //                           en esta banda. NO emite nada: un display:none aqui es ruido, y
  //                           sobre un selector compuesto puede apagar lo que si debia verse.
  // Ausente no es ninguna de las dos: el generador lo rechaza. El default silencioso deja viva
  // la caja de la banda anterior, que es el fallo que llega al iPad del cliente.
  if (el.oculto === 'heredado') return [];
  if (el.oculto) return ['display:none'];
  const out = [];
  const f = el.f && ['u', 't', 'tb'].includes(el.f) ? el.f : 'u';

  for (const [k, prop] of Object.entries(GEOMETRIA)) {
    if (el[k] == null) continue;
    out.push(`${prop}:calc(${redondea(el[k])}px * var(--u))`);
  }
  for (const [k, prop] of Object.entries(TIPOGRAFIA)) {
    if (el[k] == null) continue;
    out.push(`${prop}:calc(${redondea(el[k])}px * var(--${f}))`);
  }
  for (const [k, fmt] of Object.entries(LITERALES)) {
    if (el[k] == null) continue;
    out.push(`${{ ls: 'letter-spacing', z: 'z-index' }[k]}:${fmt(el[k])}`);
  }
  if (el.css) for (const [prop, valor] of Object.entries(el.css)) out.push(`${prop}:${valor}`);
  if (el.mostrar) out.push(`display:${el.mostrar}`);
  return out;
}

/**
 * Valores esperados de un elemento a un ancho: la misma tabla que el verificador compara
 * contra el DOM. Solo las propiedades medibles con getBoundingClientRect + getComputedStyle.
 */
export function esperado(el, fac) {
  if (el.oculto) return null;   // true y "heredado" son igual de no-medibles
  const f = el.f && ['u', 't', 'tb'].includes(el.f) ? el.f : 'u';
  const e = {};
  for (const k of ['x', 'y', 'w', 'h', 'r']) if (el[k] != null) e[k] = el[k] * fac.u;
  for (const k of ['fs', 'lh']) if (el[k] != null) e[k] = el[k] * fac[f];
  return e;   // {} significa "declarado pero sin nada medible", que NO es lo mismo que oculto
}

/** El bloque :root de una banda. Es la unica linea que cambia entre bandas. */
export function raiz(banda) {
  return `:root{--u: clamp(${banda.umin.toFixed(4)}, tan(atan2(100vw, ${banda.frame}px)), ` +
    `${banda.umax.toFixed(4)}); --t: min(var(--u), 1 + (var(--u) - 1) * .33); ` +
    `--tb: min(var(--u), 1); --frame: ${banda.frame}px;}`;
}

/** Media query de una banda a partir de su rango. La banda mas ancha no lleva max-width. */
export function media(medidas, nombre) {
  const b = medidas.bandas[nombre];
  const esUltima = Object.values(medidas.bandas).every((o) => o.max <= b.max);
  const partes = [];
  if (b.min > 0) partes.push(`(min-width:${b.min}px)`);
  if (!esUltima) partes.push(`(max-width:${b.max}px)`);
  return partes.length ? `@media ${partes.join(' and ')}` : '@media all';
}

/**
 * Deriva umin/umax de los limites de la banda si no vienen dados. Es la regla de tres:
 * a `min` la unidad vale min/frame, a `max` vale max/frame. Declararlos a mano sigue
 * permitido — Cliente A topa movil en 1.20 (no en 767/390 = 1.97) porque a partir de 468 la
 * pagina se centra en vez de seguir creciendo.
 */
export function completaBanda(b) {
  return {
    ...b,
    umin: b.umin ?? b.min / b.frame,
    umax: b.umax ?? b.max / b.frame,
  };
}

/**
 * Los breakpoints de Webflow. Son DOS listas y confundirlas hace que un gate acuse cortes buenos:
 *   DESIGNER — los seis que el Designer ofrece. Un corte aqui es nativo y editable a mano.
 *   WHTML    — los tres que `data_whtml_builder` acepta al escribir por API. Un corte nativo hacia
 *              ARRIBA (1280/1440/1920) es legitimo pero no se puede mantener por API.
 * Y un `min-width: X` es el otro lado del `max-width: X-1`: el mismo limite visto desde arriba, no
 * un corte nuevo.
 */
export const NATIVOS_DESIGNER = [1920, 1440, 1280, 991, 767, 479];
export const NATIVOS_WHTML = [991, 767, 479];
export const esNativo = (ancho, tipo) => tipo === 'max'
  ? NATIVOS_DESIGNER.includes(ancho)
  : NATIVOS_DESIGNER.includes(ancho - 1) || NATIVOS_DESIGNER.includes(ancho);
export const porApi = (ancho, tipo) =>
  NATIVOS_WHTML.includes(tipo === 'max' ? ancho : ancho - 1);
