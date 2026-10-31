/**
 * En que ventanas se mide. Una sola respuesta para todos los gates que abren un navegador.
 *
 * La leccion de Cliente A (2026-09-16): los anchos que fallan son los que no son ningun frame. Un gate que mide a
 * 390 / 768 / 1440 mide justo donde el diseno esta garantizado. Por eso la lista sale de TRES fuentes y se dice cual:
 *
 *   1. `dispositivos` del config — las ventanas REALES en las que el usuario mira el sitio, ancho Y alto
 *      (un iPad como Sidecar es 1310×945; un iPad Pro horizontal, 1366×1024). Es lo que sustituye a «pruebalo tu».
 *   2. el plan derivado del sitio (`plan-anchos.json`: cortes, fronteras, tramos) — al alto por defecto.
 *   3. los frames de cada banda.
 *
 * La cobertura la da el CATALOGO (siempre, salvo `evaluacion.catalogo: false`); las ventanas del usuario se SUMAN.
 * Sin catalogo y sin dispositivos, `cobertura.dispositivos = false` y el evaluador lo cobra.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ALTO_POR_BANDA = { movil: 844, tablet: 1024, escritorio: 900 };

/**
 * Catalogo de ventanas del mundo real. Las ventanas del usuario son donde EL trabaja; no cubren donde miran sus
 * clientes. Por eso la cobertura no depende de lo que el declare: esto se mide siempre, y lo suyo se suma.
 * Son viewports (no pantallas). Los de `corto` existen porque una escena fijada de 900 px de alto se rompe en un
 * portatil con la barra del navegador y el dock comiendose 250 px, aunque el ancho sea «de frame».
 * `r` = entra tambien en --rapido.
 */
export const CATALOGO = [
  { nombre: 'movil estrecho', w: 320, h: 568 }, { nombre: 'Android comun', w: 360, h: 800, r: true }, { nombre: 'iPhone SE', w: 375, h: 667 },
  { nombre: 'iPhone 14/15', w: 393, h: 852, r: true }, { nombre: 'Android grande', w: 412, h: 915 }, { nombre: 'iPhone Pro Max', w: 430, h: 932 },
  { nombre: 'iPad mini', w: 744, h: 1133 }, { nombre: 'iPad', w: 768, h: 1024, r: true }, { nombre: 'iPad Air', w: 820, h: 1180 }, { nombre: 'iPad Pro 11', w: 834, h: 1194 },
  { nombre: 'iPad horizontal', w: 1024, h: 768, r: true }, { nombre: 'iPad Pro 12.9', w: 1024, h: 1366 }, { nombre: 'iPad Air horizontal', w: 1180, h: 820 },
  { nombre: 'portatil 1280 corto', w: 1280, h: 600, r: true }, { nombre: 'portatil 1280', w: 1280, h: 720 }, { nombre: 'iPad como Sidecar', w: 1310, h: 945 },
  { nombre: 'portatil 1366', w: 1366, h: 768, r: true }, { nombre: 'portatil 1366 corto', w: 1366, h: 650 }, { nombre: 'iPad Pro horizontal', w: 1366, h: 1024 },
  { nombre: 'MacBook Air 13', w: 1470, h: 840 }, { nombre: 'MacBook Pro 14', w: 1512, h: 870, r: true }, { nombre: 'Windows 125 %', w: 1536, h: 730 },
  { nombre: 'MacBook Pro 16', w: 1728, h: 1000 }, { nombre: 'Full HD', w: 1920, h: 960, r: true }, { nombre: 'monitor 2K', w: 2560, h: 1300 },
];

export function bandaDeAncho(cfg, w) {
  for (const [n, b] of Object.entries(cfg.bandas ?? {})) if (w >= b.min && w <= b.max) return n;
  return w < 768 ? 'movil' : w < 1200 ? 'tablet' : 'escritorio';
}

/**
 * @returns {{ lista: Array<{w:number,h:number,origen:string,nombre?:string}>, cobertura: {dispositivos:boolean, plan:boolean}, origen: string }}
 */
export function viewports(cfg, { cli = null, desde = 0, hasta = Infinity, rapido = false } = {}) {
  if (cli) {
    const lista = cli.split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { w, h: h || ALTO_POR_BANDA[bandaDeAncho(cfg, w)], origen: 'cli' }; });
    return { lista, cobertura: { dispositivos: false, plan: false }, origen: '--viewports (a mano: no cuenta como cobertura)' };
  }
  const porClave = new Map();
  const mete = (w, h, origen, nombre) => {
    if (!(w >= desde && w <= hasta)) return;
    const k = `${w}x${h}`;
    if (!porClave.has(k)) porClave.set(k, { w, h, origen, ...(nombre ? { nombre } : {}) });
  };
  const dispositivos = cfg.dispositivos ?? [];
  for (const d of dispositivos) mete(d.w, d.h, 'dispositivo', d.nombre);
  const conCatalogo = cfg.evaluacion?.catalogo !== false;
  if (conCatalogo) for (const d of CATALOGO) if (!rapido || d.r) mete(d.w, d.h, 'dispositivo', d.nombre);
  for (const b of Object.values(cfg.bandas ?? {})) if (b.frame) mete(b.frame, ALTO_POR_BANDA[bandaDeAncho(cfg, b.frame)], 'frame');

  const planPath = join(cfg.salida || 'responsive-out', 'plan-anchos.json');
  const hayPlan = existsSync(planPath);
  if (!rapido) {
    const anchos = hayPlan ? JSON.parse(readFileSync(planPath, 'utf8')).lista
      : [320, 390, 479, 767, 768, 991, 1024, 1199, 1200, 1280, 1366, 1439, 1440, 1728, 1920];
    for (const w of anchos) mete(w, ALTO_POR_BANDA[bandaDeAncho(cfg, w)], hayPlan ? 'plan' : 'por-defecto');
  }
  const lista = [...porClave.values()].sort((a, b) => a.w - b.w || a.h - b.h);
  const partes = [conCatalogo ? `catalogo de ${rapido ? CATALOGO.filter((d) => d.r).length : CATALOGO.length} ventanas reales` : 'SIN catalogo', `${dispositivos.length} del usuario`, rapido ? 'sin plan (--rapido)' : hayPlan ? `plan derivado (${planPath})` : 'POR_DEFECTO: no hay plan-anchos.json', 'frames'];
  return { lista, cobertura: { dispositivos: conCatalogo || dispositivos.length > 0, plan: hayPlan && !rapido }, origen: partes.join(' + ') };
}
