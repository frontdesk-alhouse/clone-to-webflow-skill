#!/usr/bin/env node
/**
 * Carga de configuracion — lo unico que cambia entre clientes.
 *
 * Busca `responsive.config.json` SUBIENDO desde el directorio de trabajo. Si no aparece, acepta
 * el `harness.config.json` de clone-to-webflow y traduce sus campos: un cliente que ya tiene el
 * harness de porte no deberia mantener dos archivos que dicen lo mismo.
 *
 * Sin ninguno de los dos se aborta. No hay sitio por defecto a proposito: un default silencioso
 * mide el sitio equivocado y el numero parece valido.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from "node:url";
import { limpia } from './json.mjs';

const PROPIO = 'responsive.config.json';
const PRESTADO = 'harness.config.json';

/** Sube desde `desde` hasta la raiz buscando cualquiera de los dos archivos. Gana el propio. */
export function localiza(desde = process.cwd()) {
  let dir = resolve(desde);
  for (;;) {
    for (const nombre of [PROPIO, PRESTADO]) {
      const cand = join(dir, nombre);
      if (existsSync(cand)) return { path: cand, nombre };
    }
    const padre = dirname(dir);
    if (padre === dir) return null;
    dir = padre;
  }
}

/** Traduce un harness.config.json de clone-to-webflow al esquema propio. */
function desdeHarness(h) {
  const frames = h.figma?.frames ?? {};
  const anchosFrame = Object.keys(frames).map(Number).filter(Boolean).sort((a, b) => a - b);
  const [fMovil, fTablet, fEsc] = anchosFrame.length === 3 ? anchosFrame : [390, 768, 1440];
  return {
    cliente: h.cliente ?? 'sin-nombre',
    sitio: { staging: h.webflow?.staging, paginas: h.paginas ?? [''] },
    modo: { regimen: 'auto' },
    /* Rangos por defecto (Cliente A: tablet hasta 1199). Un sitio que corta en los breakpoints nativos
       de Webflow (991/992) los declara en `bandas` del harness: { tablet: { min, max }, ... } y aqui
       se funden sobre el default. Sin eso gate-banda cobra un corte legitimo en 992 como «sin banda». */
    bandas: Object.fromEntries(Object.entries({
      movil:      { frame: fMovil,  min: 320,  max: 767,  hereda: null },
      tablet:     { frame: fTablet, min: 768,  max: 1199, hereda: null },
      escritorio: { frame: fEsc,    min: 1200, max: h.fluido?.anchoTope ? Math.max(1920, h.fluido.anchoTope) : 1920, hereda: null },
    }).map(([k, v]) => [k, { ...v, ...((h.bandas ?? {})[k] ?? {}) }])),
    gates: {
      desborde: h.gates?.desborde ?? h.anchos ?? [390, 768, 1440],
      escalado: h.gates?.escalado ?? [360, 390, 768, 1024, 1200, 1440, 1920, 2560],
      banda: h.gates?.banda ?? [],
      toleranciaBanda: 4,
    },
    // Se lee del harness si lo declara. Fijarlo en [] hacia que el 1199 de Cliente A saliera HIGH
    // siempre, aunque el usuario lo hubiera declarado — el gate no podia darse por satisfecho.
    conmutadores: { nativos: [991, 767, 479], declarados: h.conmutadores?.declarados ?? [] },
    selectores: h.selectores ?? {},
    // Escenas fijadas que mide gate-pines. Se declaran una vez, en el harness, y aqui solo pasan.
    pines: h.pines ?? {},
    // Lo que lee el evaluador funcional: ventanas reales del usuario, piezas que deben coincidir entre paginas
    // hermanas, adjudicaciones de integridad, y la ruta servida cuando no coincide con la etiqueta.
    dispositivos: h.dispositivos ?? [],
    hermanas: h.hermanas ?? [],
    integridad: h.integridad ?? {},
    paridad: h.paridad ?? {},
    evaluacion: h.evaluacion ?? {},
    rutas: h.rutas ?? {},
    estetica: { medidaMin: 45, medidaMax: 75, medidaTope: 100, toleranciaRazon: 0.15 },
    salida: 'responsive-out',
    __prestado: true,
  };
}

let _cache = null;

export function cargaConfig() {
  if (_cache) return _cache;
  const hit = localiza();
  if (!hit) {
    console.error(
      `\nNo encuentro ${PROPIO} ni ${PRESTADO} subiendo desde ${process.cwd()}.\n` +
      `Este skill no tiene sitio por defecto a proposito: sin configuracion mediria el sitio\n` +
      `equivocado y el numero pareceria valido. Copia la plantilla:\n\n` +
      `  cp ~/.claude/skills/responsive-webflow/templates/${PROPIO} .\n`
    );
    process.exit(2);
  }
  const crudo = limpia(JSON.parse(readFileSync(hit.path, 'utf8')));
  const cfg = hit.nombre === PRESTADO ? desdeHarness(crudo) : crudo;
  cfg.__path = hit.path;
  cfg.__raiz = dirname(hit.path);
  if (cfg.sitio?.staging?.startsWith("file:./")) cfg.sitio.staging = pathToFileURL(resolve(cfg.__raiz, cfg.sitio.staging.slice(5))).href;
  cfg.__origen = hit.nombre;
  valida(cfg);
  _cache = cfg;
  return cfg;
}

function valida(cfg) {
  const falta = [];
  if (!cfg.sitio?.staging) falta.push('sitio.staging');
  if (!Array.isArray(cfg.sitio?.paginas) || !cfg.sitio.paginas.length) falta.push('sitio.paginas');
  if (!cfg.bandas || !Object.keys(cfg.bandas).length) falta.push('bandas');
  if (falta.length) {
    console.error(`\n${cfg.__path} incompleto. Faltan: ${falta.join(', ')}\n`);
    process.exit(2);
  }

  const s = cfg.sitio.staging;
  if (/\.design\.webflow\.com/.test(s)) {
    console.error(
      `\nsitio.staging apunta a *.design.webflow.com, que es el shell vacio del Designer.\n` +
      `Se mide el HTML SERVIDO: usa https://<shortName>.webflow.io\n`
    );
    process.exit(2);
  }
  if (!/\.webflow\.io/.test(s)) {
    console.error(
      `\nAVISO: sitio.staging (${s}) no es un subdominio .webflow.io. Si es produccion, para:\n` +
      `este skill mide y recomienda contra staging.\n`
    );
  }

  // Las bandas tienen que cubrir sin huecos ni solapes: un hueco es un ancho sin regimen.
  const bs = Object.entries(cfg.bandas).sort((a, b) => a[1].min - b[1].min);
  for (let i = 1; i < bs.length; i++) {
    const [nPrev, prev] = bs[i - 1], [nAct, act] = bs[i];
    if (act.min !== prev.max + 1) {
      console.error(
        `\nBandas mal cortadas: ${nPrev} termina en ${prev.max} y ${nAct} empieza en ${act.min}.\n` +
        `Tienen que ser contiguas: un hueco es un ancho sin regimen declarado.\n`
      );
      process.exit(2);
    }
  }
  for (const [n, b] of bs) {
    if (!b.frame && !b.hereda) {
      console.error(
        `\nLa banda "${n}" no tiene frame propio ni declara de cual hereda.\n` +
        `Tablet no es escritorio encogido: si no hay banda propia hay que DECLARARLO.\n`
      );
      process.exit(2);
    }
  }
}

/** Banda a la que pertenece un ancho. */
export function bandaDe(cfg, w) {
  for (const [n, b] of Object.entries(cfg.bandas)) if (w >= b.min && w <= b.max) return n;
  const bs = Object.entries(cfg.bandas).sort((a, b) => b[1].max - a[1].max);
  return bs[0][0]; // por encima del tope manda la banda mas ancha
}

/** Frame ancla efectivo de una banda, resolviendo `hereda`. */
export function frameDe(cfg, banda, vistos = new Set()) {
  const b = cfg.bandas[banda];
  if (!b) throw new Error(`banda desconocida: ${banda}`);
  if (b.frame) return b.frame;
  if (vistos.has(banda)) throw new Error(`ciclo de herencia de bandas en "${banda}"`);
  vistos.add(banda);
  return frameDe(cfg, b.hereda, vistos);
}

/** URL servida de una pagina. `rutas` manda cuando la etiqueta no es la ruta (pagina movida a una carpeta). */
export const url = (cfg, pagina) => {
  const ruta = cfg.rutas?.[pagina] ?? pagina;
  return cfg.sitio.staging.replace(/\/$/, '') + (ruta ? `/${ruta.replace(/^\//, '')}` : '/');
};
