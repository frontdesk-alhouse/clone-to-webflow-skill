#!/usr/bin/env node
/**
 * La regla concentrica de los radios anidados.
 *
 *     Cuando un elemento contiene a otro y hay separacion entre sus esquinas:
 *         radio_exterior = radio_interior + separacion
 *
 * Un boton de radio 12 con 8 px de aire dentro de una caja pide radio 20 en la caja. Concentrico,
 * no paralelo: es lo que hace que las dos curvas se vean equidistantes en toda la esquina en vez
 * de apretarse en la diagonal. Con el mismo radio en las dos, la distancia entre curvas se estrecha
 * justo en el punto donde el ojo la mide.
 *
 * COMO CONVIVE CON LA ESCALA POR LADO MENOR (`radios.mjs`). No compiten, se encadenan: la escala
 * fija el radio de la PIEZA segun su tamano; esta regla DERIVA el de la caja que la contiene
 * cuando la pieza va esquinada. Una es de superficies, la otra de anidamiento.
 *
 * QUE NO SE MARCA, y por que:
 *  - Si un ancestro de la caja exterior ya lleva radio, lo que hay dentro es cromo de una maqueta
 *    —la ventanita de una app dibujada dentro de una captura— y tiene su propia escala en
 *    miniatura. Sin esta exclusion la auditoria marca decenas de falsos positivos.
 *  - Si la pieza no va ESQUINADA la regla no aplica: se exige que sus dos separaciones a los lados
 *    de esa esquina sean iguales (es un padding) y no mayores que `radios.esquinaMax`. Una pieza
 *    centrada en una caja grande no tiene nada que ver con el radio del contenedor.
 *  - Los selectores de `radios.exentos` del config: objetos fisicos dibujados (marco de telefono,
 *    pantalla de un hero), que no son superficies del sitio.
 *
 * Dos modos, una sola implementacion de la regla:
 *   node scripts/audita-radios-anidados.mjs [url|archivo.html] [--ancho 1440]
 *   node scripts/audita-radios-anidados.mjs --figma arbol.json
 *
 * El arbol de Figma lo vuelca el agente con `use_figma`, con esta forma por nodo:
 *   { nombre, x, y, w, h, radios: [tl, tr, br, bl], hijos: [...] }
 * Las coordenadas pueden ser absolutas o relativas al padre: se detecta solo.
 */
import { readFileSync, existsSync } from 'node:fs';
import { CFG } from './config.mjs';

const TOL = CFG.radios?.tolerancia ?? 1;           // px
const ESQUINA_MAX = CFG.radios?.esquinaMax ?? 64;  // separacion maxima para considerar "esquinado"
const EXENTOS = (CFG.radios?.exentos || []).filter((s) => typeof s === 'string' && !s.startsWith('_'));

const ESQUINAS = [
  { id: 'sup-izq', ejeH: 'izq', ejeV: 'sup', i: 0 },
  { id: 'sup-der', ejeH: 'der', ejeV: 'sup', i: 1 },
  { id: 'inf-der', ejeH: 'der', ejeV: 'inf', i: 2 },
  { id: 'inf-izq', ejeH: 'izq', ejeV: 'inf', i: 3 },
];

/**
 * El nucleo de la regla, compartido por los dos modos. Recibe cajas ya normalizadas
 * ({ nombre, x, y, w, h, r:[tl,tr,br,bl] }) y devuelve los hallazgos.
 */
export function evalua(pares) {
  const hallazgos = [];
  for (const { fuera, dentro } of pares) {
    const sep = {
      izq: dentro.x - fuera.x,
      sup: dentro.y - fuera.y,
      der: (fuera.x + fuera.w) - (dentro.x + dentro.w),
      inf: (fuera.y + fuera.h) - (dentro.y + dentro.h),
    };
    for (const e of ESQUINAS) {
      const a = sep[e.ejeH], b = sep[e.ejeV];
      if (a < -0.5 || b < -0.5) continue;                  // la pieza se sale: no es anidamiento
      if (a > ESQUINA_MAX || b > ESQUINA_MAX) continue;    // no va esquinada: la regla no aplica
      if (Math.abs(a - b) > TOL) continue;                 // no es un padding uniforme en esa esquina
      const hueco = (a + b) / 2;
      const rDentro = dentro.r[e.i];
      if (!(rDentro > 0)) continue;                        // pieza sin radio: nada que concentrar
      const debe = rDentro + hueco;
      const tiene = fuera.r[e.i];
      if (Math.abs(tiene - debe) <= TOL) continue;
      hallazgos.push({
        fuera: fuera.nombre, dentro: dentro.nombre, esquina: e.id,
        hueco: Math.round(hueco * 100) / 100,
        rDentro: Math.round(rDentro * 100) / 100,
        tiene: Math.round(tiene * 100) / 100,
        debe: Math.round(debe * 100) / 100,
      });
    }
  }
  return hallazgos;
}

// ---------------------------------------------------------------- modo Figma
async function desdeFigma(path) {
  if (!existsSync(path)) { console.error(`\nNo existe ${path}\n`); process.exit(2); }
  const raiz = JSON.parse(readFileSync(path, 'utf8'));
  const pares = [];

  const rad = (n) => {
    if (Array.isArray(n.radios)) return n.radios.map(Number);
    const r = Number(n.cornerRadius ?? n.radio ?? 0) || 0;
    return [r, r, r, r];
  };

  // Se acumula el offset del padre: si las coordenadas ya son absolutas, el volcado debe traer
  // `absolutas: true` en la raiz. Adivinarlo produciria huecos negativos silenciosos.
  const absolutas = raiz.absolutas === true;
  const camina = (n, ox, oy, ancestroConRadio) => {
    const x = absolutas ? Number(n.x ?? 0) : ox + Number(n.x ?? 0);
    const y = absolutas ? Number(n.y ?? 0) : oy + Number(n.y ?? 0);
    const caja = { nombre: n.nombre ?? n.name ?? '(sin nombre)', x, y,
                   w: Number(n.w ?? n.width ?? 0), h: Number(n.h ?? n.height ?? 0), r: rad(n) };
    const tieneRadio = caja.r.some((v) => v > 0);
    const exento = EXENTOS.some((s) => caja.nombre.includes(s.replace(/^[#.]/, '')));

    for (const h of n.hijos ?? n.children ?? []) {
      const hx = absolutas ? Number(h.x ?? 0) : x + Number(h.x ?? 0);
      const hy = absolutas ? Number(h.y ?? 0) : y + Number(h.y ?? 0);
      const hijo = { nombre: h.nombre ?? h.name ?? '(sin nombre)', x: hx, y: hy,
                     w: Number(h.w ?? h.width ?? 0), h: Number(h.h ?? h.height ?? 0), r: rad(h) };
      if (tieneRadio && !ancestroConRadio && !exento && hijo.r.some((v) => v > 0)) {
        pares.push({ fuera: caja, dentro: hijo });
      }
      camina(h, x, y, ancestroConRadio || tieneRadio);
    }
  };
  camina(raiz, 0, 0, false);
  return { pares, contexto: `${path} (${pares.length} pares anidados)` };
}

// ------------------------------------------------------------------ modo DOM
async function desdeDom(URL, ancho) {
  const { chromium } = await import('playwright');
  const nav = await chromium.launch();
  const p = await nav.newPage({ viewport: { width: ancho, height: 900 }, deviceScaleFactor: 1 });
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1200);

  const pares = await p.evaluate(({ EXENTOS }) => {
    const radios = (e) => {
      const c = getComputedStyle(e);
      return [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomRightRadius, c.borderBottomLeftRadius]
        .map((v) => parseFloat(v) || 0);
    };
    const nom = (e) => {
      const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0] : '';
      return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${cls}`;
    };
    const visible = (e) => {
      const c = getComputedStyle(e);
      if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return false;
      const q = e.getBoundingClientRect();
      return q.width > 1 && q.height > 1;
    };
    const exento = (e) => EXENTOS.some((s) => e.matches?.(s));

    const fuera = [];
    for (const e of document.querySelectorAll('*')) {
      if (!visible(e)) continue;
      const r = radios(e);
      if (!r.some((v) => v > 0)) continue;

      // El contenedor a comprobar es el ancestro redondeado MAS CERCANO. Comparar contra todos los
      // ancestros redondeados generaria ruido cuadratico y acusaria relaciones que nadie diseno.
      let ancestro = null, hayAncestroPorEncima = false;
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        if (radios(a).some((v) => v > 0)) {
          if (!ancestro) ancestro = a; else { hayAncestroPorEncima = true; break; }
        }
      }
      if (!ancestro) continue;
      // Dentro de una maqueta ya redondeada la escala es otra: no se rige por la del sitio.
      if (hayAncestroPorEncima) continue;
      if (exento(ancestro) || exento(e)) continue;

      const qa = ancestro.getBoundingClientRect(), qe = e.getBoundingClientRect();
      fuera.push({
        fuera:  { nombre: nom(ancestro), x: qa.x, y: qa.y, w: qa.width, h: qa.height, r: radios(ancestro) },
        dentro: { nombre: nom(e),        x: qe.x, y: qe.y, w: qe.width, h: qe.height, r },
      });
    }
    return fuera;
  }, { EXENTOS });

  await nav.close();
  return { pares, contexto: `${URL} @${ancho}px (${pares.length} pares anidados)` };
}

// --------------------------------------------------------------------- main
// Solo se ejecuta al invocar el archivo directamente. Importado (por el test) exporta la regla y
// no arranca ningun navegador.
const esMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (!esMain) { /* importado como modulo */ } else {
const args = process.argv.slice(2);
let ancho = CFG.fluido?.anchoTope ?? 1440;
let figma = null;
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ancho') { ancho = +args[++i] || ancho; continue; }
  if (args[i] === '--figma') { figma = args[++i]; continue; }
  if (args[i].startsWith('--')) continue;
  pos.push(args[i]);
}

let datos;
if (figma) {
  datos = await desdeFigma(figma);
} else {
  const { BASE } = await import('./config.mjs');
  const destino = pos[0];
  const URL = !destino ? `${BASE}/`
    : destino.startsWith('http') ? destino
    : 'file://' + process.cwd() + '/' + destino.replace(/^\.\//, '');
  datos = await desdeDom(URL, ancho);
}

const hallazgos = evalua(datos.pares);

console.log(`\n  ${datos.contexto}\n`);
if (!datos.pares.length) {
  console.log('  No hay ningun par anidado con radio. Nada que comprobar.\n');
  process.exit(0);
}
if (!hallazgos.length) {
  console.log(`  PASA — las ${datos.pares.length} relaciones anidadas cumplen exterior = interior + separacion (±${TOL}px).\n`);
  process.exit(0);
}

console.log('  ' + 'contenedor'.padEnd(30) + 'pieza'.padEnd(30) + 'esquina'.padEnd(10) +
            'sep'.padStart(7) + 'r.int'.padStart(8) + 'tiene'.padStart(8) + 'debe'.padStart(8));
for (const h of hallazgos) {
  console.log('  ' + h.fuera.slice(0, 29).padEnd(30) + h.dentro.slice(0, 29).padEnd(30) + h.esquina.padEnd(10) +
              String(h.hueco).padStart(7) + String(h.rDentro).padStart(8) +
              String(h.tiene).padStart(8) + String(h.debe).padStart(8));
}
const paresRotos = new Set(hallazgos.map((h) => `${h.fuera}>${h.dentro}`)).size;
console.log(`\n  FALLA — ${hallazgos.length} esquina(s) no concentricas en ${paresRotos} de ${datos.pares.length} relaciones anidadas.`);
console.log(`  El radio del contenedor sale de la pieza: interior + separacion, no el mismo numero.\n`);
process.exit(1);
}
