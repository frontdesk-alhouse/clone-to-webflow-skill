#!/usr/bin/env node
/**
 * Traduce el responsive-measures.json de Cliente A (esquema anidado y semantico, con posiciones
 * derivadas que calculaba el generador) al esquema plano y generico de responsive-webflow.
 *
 * Existe para una sola cosa: dar a la prueba de regresion un caso con respuesta conocida.
 * Cliente A corrio su verificador el 2026-09-06 y dio cero diferencias en once anchos. Si el
 * motor generalizado no reproduce ese mismo CSS y esa misma tabla, la generalizacion perdio
 * algo y no se sigue.
 *
 *   node fixture-cliente-a.mjs [--out ruta.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const SRC = process.env.CLIENTE_A_MEDIDAS;
if (!SRC) { console.log("fixture: sin CLIENTE_A_MEDIDAS; se usa tests/cliente-a.medidas.json versionado"); process.exit(0); }
const i = process.argv.indexOf('--out');
const OUT = i >= 0 ? process.argv[i + 1] : new URL('./cliente-a.medidas.json', import.meta.url).pathname;

const M = JSON.parse(readFileSync(SRC, 'utf8'));

const RANGOS = {
  mobile:  { nombre: 'movil',      min: 0,    max: 767 },
  tablet:  { nombre: 'tablet',     min: 768,  max: 1199 },
  desktop: { nombre: 'escritorio', min: 1200, max: 3840 },
};

/** Copia solo las llaves que el esquema generico entiende, en el orden en que las emite. */
const caja = (o, extra = {}) => ({
  ...(o.x != null ? { x: o.x } : {}), ...(o.y != null ? { y: o.y } : {}),
  ...(o.w != null ? { w: o.w } : {}), ...(o.h != null ? { h: o.h } : {}),
  ...(o.r != null ? { r: o.r } : {}), ...extra,
});
const tipo = (o) => ({
  ...(o.fs != null ? { fs: o.fs } : {}), ...(o.lh != null ? { lh: o.lh } : {}),
  ...(o.ls != null ? { ls: o.ls } : {}), ...(o.f ? { f: o.f } : {}),
});

function elementos(nb, d) {
  const esMovil = nb === 'mobile';
  const e = {};

  e.nav = { sel: '.nav', ...caja(d.nav, d.nav.r != null ? {} : {}), r: d.nav.r ?? 16,
    ...(esMovil ? { css: { background: 'transparent', border: '0', 'box-shadow': 'none' } } : {}) };

  if (esMovil) {
    // El wordmark se posiciona restando el 19 del isotipo: en movil la marca arranca en 0.
    e.brand = { sel: '.nav .brand', x: d.wordmark.x - 19, y: d.wordmark.y, h: d.wordmark.h, fs: d.wordmark.fs, f: 'u' };
    e.menu  = { sel: '.nav .menu', ...caja(d.menu) };
    e.links  = { sel: '.nav .links', oculto: true };
    e.navcta = { sel: '.nav .navcta', oculto: true };
  } else {
    e.brand = { sel: '.nav .brand', x: d.brand.x, y: d.brand.y, h: d.brand.h, fs: 18, f: 'u' };
    e.links  = { sel: '.nav .links', ...caja(d.links), ...tipo(d.links) };
    e.navcta = { sel: '.nav .navcta', ...caja(d.navcta), ...tipo(d.navcta) };
    e.menu   = { sel: '.nav .menu', oculto: true };
  }

  e.hero = { sel: '.hero', h: d.hero.h };
  e.h1   = { sel: '.h1', x: d.h1.x, y: d.h1.y, w: d.h1.w, ...tipo(d.h1) };
  e.lead = { sel: '.lead', x: d.lead.x, y: d.lead.y, w: d.lead.w, ...tipo(d.lead) };

  if (d.capsule) {
    const c = d.capsule;
    e.capsule = { sel: '.capsule', ...caja(c), mostrar: 'block' };
    e.capin   = { sel: '.capsule .in', x: c.input.x, y: c.input.y, ...tipo(c.input) };
    e.capbtn  = { sel: '.capsule .btn', ...caja(c.btn), ...tipo(c.btn) };
  } else {
    e.capsule = { sel: '.capsule', oculto: true };
    e.capin   = { sel: '.capsule .in', oculto: 'heredado' };
    e.capbtn  = { sel: '.capsule .btn', oculto: 'heredado' };
  }

  e.device  = { sel: '.device', ...caja(d.device), inset: d.device.inset };
  e.screen  = { sel: '.device .screen', r: d.device.rin };

  if (d.toggle) {
    const t = d.toggle;
    e.toggle    = { sel: '.toggle', ...caja(t), inset: 4, mostrar: 'flex' };
    e.toggleseg = { sel: '.toggle span', w: t.seg, h: t.segh, r: 8, fs: 13, f: 'tb' };
  } else {
    e.toggle    = { sel: '.toggle', oculto: true };
    e.toggleseg = { sel: '.toggle span', oculto: 'heredado' };
  }

  const c = d.cta;
  e.cta      = { sel: '.cta', h: c.h };
  e.ctapanel = { sel: '.cta .panel', ...caja(c.panel) };

  if (esMovil) {
    e.ctaiso  = { sel: '.cta .iso', ...caja(c.iso) };
    e.ctah2   = { sel: '.cta .h2', x: c.h2.x, y: c.h2.y, w: c.h2.w, ...tipo(c.h2), css: { 'text-align': 'center' } };
    e.ctaform = { sel: '.cta .form', x: c.form.x, y: c.form.y, w: c.form.w, h: c.form.h, gap: c.form.gap,
      css: { display: 'grid', 'grid-template-rows': '1fr 1fr' } };
    e.ctacampo = { sel: '.cta .form .fi,.cta .form .fb', r: 12, fs: 14, f: 'tb',
      css: { position: 'static', width: 'auto', height: 'auto' } };
    e.ctafi = { sel: '.cta .form .fi', oculto: 'heredado' };
    e.ctafb = { sel: '.cta .form .fb', oculto: 'heredado' };
  } else {
    // Posiciones derivadas: el original las calculaba al generar. Aqui se resuelven una vez.
    const isoX  = c.content.x + (c.content.w - c.iso) / 2;
    const h2y   = c.content.y + c.iso + c.sp1;
    const formY = h2y + c.h2.h + c.sp2;
    const fx    = c.content.x + (c.content.w - c.form.w) / 2;
    e.ctaiso  = { sel: '.cta .iso', x: isoX, y: c.content.y, w: c.iso, h: c.iso };
    e.ctah2   = { sel: '.cta .h2', x: c.content.x, y: h2y, w: c.content.w, ...tipo(c.h2), css: { 'text-align': 'center' } };
    e.ctaform = { sel: '.cta .form', x: fx, y: formY, w: c.form.w, h: c.form.h, r: c.form.r,
      css: { background: '#fdfeff', display: 'block' } };
    e.ctacampo = { sel: '.cta .form .fi,.cta .form .fb', oculto: 'heredado' };
    e.ctafi = { sel: '.cta .form .fi', x: 22, y: 18, fs: 14, f: 'tb' };
    e.ctafb = { sel: '.cta .form .fb', x: c.form.w - c.form.btn.w - 6, y: 6,
      w: c.form.btn.w, h: c.form.btn.h, r: c.form.btn.r, fs: 14, f: 'tb' };
  }

  const f = d.footer, fw = f.h2.w || f.w;
  e.footer  = { sel: '.footer', h: f.h };
  e.footh2  = { sel: '.footer .h2', x: f.x, y: f.h2.y, w: fw, ...tipo(f.h2) };
  e.cols    = { sel: '.footer .cols', x: f.x, y: f.cols.y, w: f.w };
  e.col     = { sel: '.footer .col', w: f.cols.colw };
  e.collabel = { sel: '.footer .col b', fs: f.cols.label, lh: 14, f: 'tb' };
  e.collink  = { sel: '.footer .col span', fs: f.cols.link, lh: f.cols.link * 1.5, y: f.cols.linky, f: 'tb' };
  e.hair    = { sel: '.footer .hair', x: f.x, y: f.hair.y, w: f.w };
  e.legal   = { sel: '.footer .legal', x: f.x, y: f.legal.y, fs: f.legal.fs, f: 'tb' };

  const step = f.cols.colw + f.cols.gapx;
  for (let k = 0; k < 4; k++) {
    const dos = f.cols.row2 != null;
    e[`col${k + 1}`] = { sel: `.footer .col:nth-child(${k + 1})`,
      x: (dos ? k % 2 : k) * step, y: (dos ? Math.floor(k / 2) : 0) * (f.cols.row2 || 0) };
    e[`collink${k + 1}`] = { sel: `.footer .col span:nth-of-type(${k + 1})`,
      y: f.cols.linky + k * f.cols.linkstep };
  }
  return e;
}

const salida = {
  meta: {
    cliente: 'Cliente A',
    origen: 'port de responsive-measures.json (2026-09-06) al esquema generico',
    ref: { pagina: '.page', secciones: ['.hero', '.cta', '.footer'] },
    anchosVerifica: [320, 390, 600, 768, 1024, 1200, 1440, 1849, 1920, 2560, 3840],
    muestra: ['h1', 'lead', 'collink'],
  },
  bandas: {},
};
for (const [nb, r] of Object.entries(RANGOS)) {
  const d = M[nb];
  salida.bandas[r.nombre] = {
    frame: d.frame, min: r.min, max: r.max, umin: d.umin, umax: d.umax,
    elementos: elementos(nb, d),
  };
}

writeFileSync(OUT, JSON.stringify(salida, null, 1) + '\n');
console.log(`${OUT} · ${Object.keys(salida.bandas).length} bandas · ` +
  Object.values(salida.bandas).map((b) => Object.keys(b.elementos).length + ' elementos').join(', '));
