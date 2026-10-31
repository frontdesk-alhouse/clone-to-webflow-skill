#!/usr/bin/env node
/**
 * Clasifica cada seccion en FLUIDA o RIGIDA, y lo hace midiendo, no opinando.
 *
 * DE DONDE SALE ESTA REGLA. Los fallos de escalado de este harness —el `zoom` global revertido, la
 * banda de tablet que crecio de 688 a 780 y descuadro cuatro cosas de una vez, el hero cuyo motor
 * mide en vivo y al que cualquier escala le rompe el vector— tienen todos la misma causa, y no es
 * `clamp()`:
 *
 *     Si la composicion lleva superposiciones en pixeles, el contenido se congela
 *     y lo que crece son los margenes.
 *
 * La fluidez es una propiedad de la COMPOSICION, no una tecnica de CSS que se aplica despues. Una
 * seccion de flujo escala con clamp() sin problema; una calibrada en pixeles no puede escalar. Por
 * eso el regimen es POR SECCION y no global, y por eso se decide antes de construir.
 *
 * LOS TRES DISCRIMINANTES. Con que se cumpla uno, la seccion es rigida:
 *   1. hijos en posicion absoluta con coordenadas en pixeles calibradas contra un ancho,
 *   2. `transform`/`scale` sobre algo que anima,
 *   3. un motor de movimiento que mide en vivo con `getBoundingClientRect`.
 *
 * Una seccion que no cumple ninguno es fluida. Una seccion sin clasificar NO PASA el gate: el
 * default silencioso es exactamente lo que se colo hasta llegar al iPad de un cliente.
 *
 * Las secciones salen de `spec/secciones.json` — [{ "etiqueta": "hero", "selector": "#hero" }, ...].
 * Sin ese archivo se auto-detectan las de primer nivel y se avisa de que hay que fijarlas.
 *
 *   node scripts/audita-regimen.mjs [url] [--ancho 1440]
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { BASE, CFG } from './config.mjs';

// El valor de una bandera NO es un posicional. Buscar "el primero que no empieza por --" tomaba
// el 768 de `--ancho 768` como si fuera la URL.
const args = process.argv.slice(2);
const posicionales = [];
let ancho = CFG.fluido?.anchoTope ?? 1440;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ancho') { ancho = +args[++i] || ancho; continue; }
  if (args[i].startsWith('--')) continue;
  posicionales.push(args[i]);
}
const destino = posicionales[0];
const URL = !destino ? `${BASE}/`
  : destino.startsWith('http') ? destino
  : 'file://' + process.cwd() + '/' + destino.replace(/^\.\//, '');

const SALIDA = 'spec/regimen.json';
const declarado = existsSync(SALIDA) ? JSON.parse(readFileSync(SALIDA, 'utf8')) : null;
const SECCIONES = existsSync('spec/secciones.json')
  ? JSON.parse(readFileSync('spec/secciones.json', 'utf8'))
  : null;

// Anchos contra los que una coordenada fija resulta sospechosa de estar "calibrada".
const CALIBRES = [...new Set([...(CFG.anchos || []), CFG.fluido?.anchoTope ?? 1440, 688, 1440, 1200])];

const nav = await chromium.launch();
const p = await nav.newPage({ viewport: { width: ancho, height: 900 }, deviceScaleFactor: 1 });
await p.emulateMedia({ reducedMotion: 'reduce' });
await p.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);

const salida = await p.evaluate(({ SECCIONES, CALIBRES, ancho }) => {
  // Todo el JS en linea de la pagina, incluidos los embeds de Webflow (que es donde vive el
  // motion en un sitio portado, porque el MCP no expone IX2 y no hay otro sitio donde ponerlo).
  const guiones = [...document.querySelectorAll('script')]
    .filter((s) => !s.src && s.textContent.trim())
    .map((s) => s.textContent);

  const lista = SECCIONES ?? [...document.querySelectorAll('body section, body > div > section, main > section')]
    .map((e, i) => ({
      etiqueta: e.id || (typeof e.className === 'string' && e.className.split(' ')[0]) || `seccion-${i + 1}`,
      selector: e.id ? `#${e.id}` : null,
      _auto: true,
      _nodo: i,
    }));

  const nodosAuto = SECCIONES ? null : [...document.querySelectorAll('body section, body > div > section, main > section')];

  // Las etiquetas son la CLAVE del archivo de salida. En auto-deteccion varias secciones comparten
  // la primera clase (`vt-fs` tres veces en esta pagina) y sin desambiguar la ultima se come a las
  // anteriores: el informe ensenaria tres y el archivo guardaria una.
  const cuenta = {};
  for (const s of lista) {
    const base = s.etiqueta;
    cuenta[base] = (cuenta[base] ?? 0) + 1;
  }
  const visto = {};
  for (const s of lista) {
    if (cuenta[s.etiqueta] > 1) {
      visto[s.etiqueta] = (visto[s.etiqueta] ?? 0) + 1;
      s.etiqueta = `${s.etiqueta}-${visto[s.etiqueta]}`;
    }
  }

  const resultados = [];
  for (const s of lista) {
    const raiz = s.selector ? document.querySelector(s.selector) : nodosAuto[s._nodo];
    if (!raiz) { resultados.push({ ...s, error: 'no encontrada en la pagina' }); continue; }

    const senales = [];
    const hijos = [...raiz.querySelectorAll('*')];
    const caja = raiz.getBoundingClientRect();

    // Una seccion que a este ancho no se pinta —las de movil vistas a 1440— no se puede
    // clasificar aqui: sus hijos no tienen caja y los tres discriminantes leerian ceros. Decir
    // "fluida" de algo que no se ha medido es peor que no decir nada, asi que se marca y se
    // remite al ancho donde si existe. Es el mismo error que produjo el iPad: un default
    // silencioso sobre una banda que nadie habia mirado.
    if (caja.width < 1 || caja.height < 1) {
      resultados.push({
        etiqueta: s.etiqueta,
        selector: s.selector ?? `(auto) ${raiz.tagName.toLowerCase()}${raiz.id ? '#' + raiz.id : ''}`,
        auto: !!s._auto,
        caja: { w: 0, h: 0 },
        regimen: 'sin-medir',
        senales: [{ n: 0, que: `no se pinta a ${ancho}px — clasificar en el ancho donde exista`, ejemplos: [] }],
      });
      continue;
    }

    // --- 1. Superposiciones en pixeles ---
    const absolutos = [];
    for (const e of hijos) {
      const c = getComputedStyle(e);
      if (c.position !== 'absolute' && c.position !== 'fixed') continue;
      const lados = ['left', 'top', 'right', 'bottom']
        .map((k) => ({ k, v: c[k] }))
        .filter(({ v }) => v !== 'auto' && /px$/.test(v) && Math.abs(parseFloat(v)) > 0.5);
      if (!lados.length) continue;
      // Un elemento que CUBRE a su padre no es una superposicion calibrada: es un fondo. Y cubrir
      // no significa solo inset 0 — un video de fondo lleva insets negativos simetricos
      // (-1440/-900/-1440/-900) para desbordar por los cuatro lados. Lo que distingue una
      // calibracion de esquina de una cobertura es la SIMETRIA: si izquierda iguala a derecha y
      // arriba iguala a abajo, la pieza esta centrada por construccion y escala sola.
      const n = (k) => (c[k] === 'auto' ? null : parseFloat(c[k]));
      const [l, t, r, b] = ['left', 'top', 'right', 'bottom'].map(n);
      const simetrico = [l, t, r, b].every((v) => v !== null) &&
                        Math.abs(l - r) < 1 && Math.abs(t - b) < 1;
      if (simetrico) continue;
      absolutos.push({
        cls: (typeof e.className === 'string' ? e.className.split(' ')[0] : '') || e.tagName.toLowerCase(),
        coords: lados.map(({ k, v }) => `${k}:${v}`).join(' '),
      });
    }
    if (absolutos.length) {
      senales.push({ n: 1, que: `${absolutos.length} hijo(s) en posicion absoluta con coordenadas en px`,
                     ejemplos: absolutos.slice(0, 4) });
    }

    // Anchos fijos calibrados: una caja con `width` en px igual a un ancho de diseno, dentro de una
    // ventana que ya no mide eso, es la firma de una composicion congelada.
    const fijos = [];
    for (const e of [raiz, ...hijos]) {
      const c = getComputedStyle(e);
      if (!/px$/.test(c.width)) continue;
      const w = Math.round(parseFloat(c.width));
      if (CALIBRES.includes(w) && w > ancho + 1) {
        fijos.push({ cls: (typeof e.className === 'string' ? e.className.split(' ')[0] : '') || e.tagName.toLowerCase(), w });
      }
    }
    if (fijos.length) {
      senales.push({ n: 1, que: `${fijos.length} caja(s) con ancho fijo calibrado y mas ancho que la ventana`,
                     ejemplos: fijos.slice(0, 4) });
    }

    // --- 2. transform/scale sobre algo que anima ---
    const escalados = [];
    for (const e of hijos) {
      const c = getComputedStyle(e);
      const t = c.transform;
      let escala = 1;
      if (t && t !== 'none') {
        const m = t.match(/matrix\(([^)]+)\)/);
        if (m) { const n = m[1].split(',').map(Number); escala = Math.hypot(n[0], n[1]); }
      }
      const anima = c.transitionProperty.includes('transform') || c.transitionProperty === 'all' ||
                    (c.animationName && c.animationName !== 'none') ||
                    c.willChange.includes('transform');
      if (Math.abs(escala - 1) > 0.01 && anima) {
        escalados.push({ cls: (typeof e.className === 'string' ? e.className.split(' ')[0] : '') || e.tagName.toLowerCase(),
                         escala: Math.round(escala * 1000) / 1000 });
      }
    }
    if (escalados.length) {
      senales.push({ n: 2, que: `${escalados.length} elemento(s) escalados con transform y animables`,
                     ejemplos: escalados.slice(0, 4) });
    }
    // `zoom` sobre el body es el caso extremo del mismo problema: escalar por encima.
    const z = parseFloat(getComputedStyle(document.body).zoom);
    if (z && Math.abs(z - 1) > 0.001) {
      senales.push({ n: 2, que: `el documento lleva zoom ${z} sobre <body> — escalado global`, ejemplos: [] });
    }

    // --- 3. Motor que mide en vivo ---
    const claves = [s.selector, raiz.id ? `#${raiz.id}` : null, raiz.id || null,
                    typeof raiz.className === 'string' ? raiz.className.split(' ')[0] : null]
                   .filter(Boolean);
    const motores = guiones.filter((g) => /getBoundingClientRect|visualViewport/.test(g) &&
                                          claves.some((k) => g.includes(k.replace(/^[#.]/, ''))));
    if (motores.length) {
      senales.push({ n: 3, que: `${motores.length} bloque(s) de script miden en vivo y nombran esta seccion`,
                     ejemplos: motores.map((g) => g.match(/.{0,60}getBoundingClientRect.{0,30}/s)?.[0]?.replace(/\s+/g, ' ') ?? '').slice(0, 2) });
    }

    resultados.push({
      etiqueta: s.etiqueta,
      selector: s.selector ?? `(auto) ${raiz.tagName.toLowerCase()}${raiz.id ? '#' + raiz.id : ''}`,
      auto: !!s._auto,
      caja: { w: Math.round(caja.width), h: Math.round(caja.height) },
      regimen: senales.length ? 'rigido' : 'fluido',
      senales,
    });
  }
  return resultados;
}, { SECCIONES, CALIBRES, ancho });

await nav.close();

// ---- Informe ----
console.log(`\n  ${URL}  @${ancho}px\n`);
const rig = salida.filter((s) => s.regimen === 'rigido');
const flu = salida.filter((s) => s.regimen === 'fluido');
const sin = salida.filter((s) => s.regimen === 'sin-medir');
const err = salida.filter((s) => s.error);

for (const s of salida) {
  if (s.error) { console.log(`  ${s.etiqueta.padEnd(26)} ERROR — ${s.error}`); continue; }
  console.log(`  ${s.etiqueta.padEnd(26)} ${s.regimen.toUpperCase().padEnd(8)} ${s.caja.w}x${s.caja.h}`);
  for (const sn of s.senales) {
    console.log(`      (${sn.n}) ${sn.que}`);
    for (const e of sn.ejemplos) console.log(`           ${typeof e === 'string' ? e : JSON.stringify(e)}`);
  }
}

// Si ya habia un regimen declarado, lo que importa no es el recuento: es la DISCREPANCIA. Una
// seccion declarada fluida que mide rigida es una que se va a romper en el primer ancho intermedio.
/* El regimen declarado de una seccion puede ser UNO (lo normal) o uno POR ANCHO. Lo segundo no es
   una escapatoria para no decidir: es el caso en que la seccion no tiene un diseno sino dos, y eso
   hay que escribirlo a mano. El hero de Cliente C es acordeon a 1440 y una foto unica por debajo
   —asi esta en Figma y asi lo dice su contrato de movimiento—, de modo que mide rigido a 1440 y
   fluido a 390. Comparando contra un unico valor, uno de los dos anchos acusaba para siempre una
   discrepancia que no existe, y una alarma que siempre suena deja de leerse. (2026-09-30.) */
const declaradoDe = (et) => {
  const d = declarado?.secciones?.[et];
  if (!d) return null;
  return d.porAncho?.[String(ancho)] ?? d.porAncho?.[ancho] ?? d.regimen ?? null;
};

const choques = [];
if (declarado?.secciones) {
  for (const s of salida) {
    const antes = declaradoDe(s.etiqueta);
    if (antes && antes !== s.regimen) choques.push(`${s.etiqueta}: declarada ${antes}, mide ${s.regimen}`);
  }
}

/* Un archivo con `"declarado": true` lo escribio una persona: trae la decision, no una medicion.
   Escribir encima la medicion de esta corrida —que es lo que hacia— borraba esa decision, y por
   eso `declarado` nunca contenia otra cosa que la medicion del ancho anterior: la comparacion de
   arriba no comparaba contra nada. Con la marca puesta se conserva lo decidido y la medicion entra
   al lado, en `medido`. Sin la marca, el comportamiento es el de siempre. */
const ES_DECLARACION = declarado?.declarado === true;

mkdirSync('spec', { recursive: true });
if (ES_DECLARACION) {
  const secciones = { ...declarado.secciones };
  for (const s of salida.filter((x) => !x.error)) {
    secciones[s.etiqueta] = {
      ...(secciones[s.etiqueta] ?? { selector: s.selector, regimen: s.regimen }),
      medido: { ...(secciones[s.etiqueta]?.medido ?? {}), [String(ancho)]: s.regimen },
      senales: s.senales,
    };
  }
  writeFileSync(SALIDA, JSON.stringify({ ...declarado, secciones }, null, 2) + '\n');
} else {
  writeFileSync(SALIDA, JSON.stringify({
    url: URL, ancho,
    secciones: Object.fromEntries(salida.filter((s) => !s.error).map((s) => [s.etiqueta, {
      selector: s.selector, regimen: s.regimen, senales: s.senales,
    }])),
  }, null, 2));
}

console.log(`\n  ${rig.length} rigida(s) · ${flu.length} fluida(s)` +
            `${sin.length ? ` · ${sin.length} sin medir a este ancho` : ''}` +
            `${err.length ? ` · ${err.length} sin encontrar` : ''}`);
console.log(`  ${SALIDA}`);

if (!SECCIONES) {
  console.log(`\n  AVISO: no hay spec/secciones.json, asi que las secciones se auto-detectaron.`);
  console.log(`  Fijalas en ese archivo antes de construir — una seccion sin regimen declarado no pasa el gate.`);
}
if (choques.length) {
  console.log(`\n  DISCREPANCIA con lo declarado (${choques.length}):`);
  choques.forEach((c) => console.log(`    · ${c}`));
  console.log(`  Una seccion declarada fluida que mide rigida se rompe en el primer ancho intermedio.`);
}
if (sin.length) {
  console.log(`\n  ${sin.length} seccion(es) no se pintan a ${ancho}px: ${sin.map((s) => s.etiqueta).join(', ')}`);
  console.log(`  Vuelve a correr en su ancho (--ancho ${Math.min(...(CFG.anchos || [390]))}) y funde los dos archivos.`);
}
if (err.length || choques.length) process.exit(1);
console.log();
