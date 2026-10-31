#!/usr/bin/env node
/**
 * Carga de `harness.config.json` — lo unico que cambia entre clientes.
 *
 * Todo el motor de este harness venia con la URL de staging, la lista de paginas y los anchos
 * escritos en la cabecera de cada script. Eso funcionaba con un cliente y solo con uno. Aqui esos
 * valores se leen de un archivo, y los scripts quedan identicos entre proyectos.
 *
 * El archivo se busca SUBIENDO desde el directorio de trabajo, no desde el del script, porque el
 * harness vive en ~/.claude/skills y el proyecto del cliente vive en otro sitio. Se ejecuta desde
 * la carpeta del cliente; el motor viene de fuera.
 *
 * Si no aparece, se aborta con el path buscado. Un default silencioso aqui significaria medir el
 * sitio equivocado y creerse el numero.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from "node:url";

const NOMBRE = 'harness.config.json';

/** Sube desde `desde` hasta la raiz buscando el archivo de configuracion. */
export function localizaConfig(desde = process.cwd()) {
  let dir = resolve(desde);
  for (;;) {
    const cand = join(dir, NOMBRE);
    if (existsSync(cand)) return cand;
    const padre = dirname(dir);
    if (padre === dir) return null;
    dir = padre;
  }
}

let _cache = null;

export function cargaConfig() {
  if (_cache) return _cache;
  const path = localizaConfig();
  if (!path) {
    console.error(
      `\nNo encuentro ${NOMBRE} subiendo desde ${process.cwd()}.\n` +
      `Este harness no tiene sitio por defecto a proposito: sin configuracion mediria el sitio\n` +
      `equivocado y el numero pareceria valido. Copia la plantilla:\n\n` +
      `  cp ~/.claude/skills/clone-to-webflow/templates/harness.config.json .\n`
    );
    process.exit(2);
  }
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  cfg.__path = path;
  cfg.__raiz = dirname(path);
  if (cfg.webflow?.staging?.startsWith("file:./")) cfg.webflow.staging = pathToFileURL(resolve(cfg.__raiz, cfg.webflow.staging.slice(5))).href;
  validar(cfg);
  _cache = cfg;
  return cfg;
}

function validar(cfg) {
  const falta = [];
  if (!cfg.webflow?.staging) falta.push('webflow.staging');
  if (!cfg.webflow?.shortName) falta.push('webflow.shortName');
  if (!Array.isArray(cfg.anchos) || !cfg.anchos.length) falta.push('anchos');
  if (!Array.isArray(cfg.paginas) || !cfg.paginas.length) falta.push('paginas');
  if (falta.length) {
    console.error(`\n${cfg.__path} incompleto. Faltan: ${falta.join(', ')}\n`);
    process.exit(2);
  }
  // El staging NUNCA es un dominio de produccion. Es la barrera mas barata contra el error mas caro.
  const prod = cfg.webflow.produccion || [];
  if (prod.some((d) => cfg.webflow.staging.includes(d))) {
    console.error(
      `\n${cfg.__path}: webflow.staging apunta a un dominio de produccion (${cfg.webflow.staging}).\n` +
      `El harness mide y escribe contra staging. Usa https://${cfg.webflow.shortName}.webflow.io\n`
    );
    process.exit(2);
  }
  // *.design.webflow.com es el shell vacio del Designer, no el sitio publicado.
  if (/design\.webflow\.com/.test(cfg.webflow.staging)) {
    console.error(
      `\n${cfg.__path}: webflow.staging apunta a design.webflow.com, que es el shell del Designer\n` +
      `y no sirve el sitio publicado. Usa https://${cfg.webflow.shortName}.webflow.io\n`
    );
    process.exit(2);
  }
}

const cfg = cargaConfig();

export const CFG      = cfg;
export const RAIZ     = cfg.__raiz;
export const BASE     = cfg.webflow.staging.replace(/\/$/, '');
export const PAGINAS  = cfg.paginas;
export const ANCHOS   = cfg.anchos;
export const PREFIJO  = cfg.prefijo || '';
export const UMBRAL   = cfg.umbral ?? 9.9;
export const MAX_ITER = cfg.maxIter ?? 6;
export const SELECTORES = cfg.selectores || {};

/** Anchos del gate de desborde: mas amplios que los de construccion, con los bordes de banda. */
export const ANCHOS_DESBORDE = cfg.gates?.desborde || ANCHOS;
/** Pares [antes, despues] donde el diseno cambia de banda. */
export const BANDAS = cfg.gates?.banda || [];
/** Paginas que existen pero no se miden ni publican todavia. */
export const PAGINAS_BORRADOR = cfg.paginasBorrador || [];
/** Orden de porte de las paginas; sin el, el de `paginas`. */
export const ORDEN_PORT = cfg.ordenPort || cfg.paginas;
/** Donde vive el motor de movimiento: nombres de los embeds y su tope de caracteres. */
export const MOTION = { embeds: cfg.motion?.embeds || [], topeEmbed: cfg.motion?.topeEmbed ?? 10000 };
/** Cortes propios declarados a proposito (no nativos de Webflow). */
export const CORTES_DECLARADOS = cfg.conmutadores?.declarados || [];

/**
 * Ruta publicada por etiqueta, cuando no coinciden. La etiqueta nombra archivos (snapshots, diff, reference) y claves
 * de spec, asi que no puede llevar `/`: una pagina movida a una carpeta (Cliente A 2026-09-15: solutions-founders ->
 * solutions/founders, con 301) conserva su etiqueta y declara aqui su ruta nueva. Sin entrada, la ruta es la etiqueta.
 */
export const RUTAS = cfg.rutas || {};
/** URL publicada de una pagina. `''` es la home. */
export const rutaDe = (pagina) => `${BASE}/${RUTAS[pagina] ?? pagina}`.replace(/\/$/, '') || BASE;
/** Nombre de archivo estable para una pagina. */
export const etiquetaDe = (pagina) => pagina || 'home';

/** Path absoluto dentro del proyecto del cliente. */
export const enProyecto = (...partes) => join(RAIZ, ...partes);
