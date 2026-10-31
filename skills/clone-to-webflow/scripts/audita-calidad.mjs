#!/usr/bin/env node
/**
 * Auditoria de CALIDAD del diseno — el gate de la Fase 1.
 *
 * Corre las reglas deterministas de Impeccable (empaquetadas en `vendor/impeccable`) sobre el HTML
 * sintetico que `figma-shim.js` produce a partir de un frame de Figma, y filtra los puntos ciegos
 * que ya se verificaron como falsos positivos.
 *
 * POR QUE ES UN EJE APARTE. `parity.mjs` mide fidelidad: si el build se parece a la referencia. Eso
 * no dice nada de si la referencia esta bien hecha. Un clon puede sacar 10/10 de fidelidad
 * replicando una porqueria. Este script mide la otra pregunta, y por eso va ANTES: no tiene sentido
 * portar con precision de pixel un diseno que no deberia construirse.
 *
 * LOS TRES PUNTOS CIEGOS, medidos en el piloto y suprimidos aqui:
 *   cramped-padding  las secciones full-bleed cuyo hijo ocupa todo el alto con el texto centrado
 *                    leen como "pegado al borde"; en CSS real es height:100% + centrado.
 *   low-contrast     el shim no pinta imagenes, asi que un panel rgba() sobre la foto de un hero se
 *                    compone contra el fondo de pagina. 23 de 32 hallazgos del piloto eran esto.
 *   tiny-text        depende de si la maqueta de producto se dibujo con texto real o como vector:
 *                    asimetrico entre archivos, no comparable.
 *
 * Y las reglas de COPY (`marketing-buzzword`, `em-dash-overuse`) se suprimen cuando el copy esta en
 * espanol: su lista de terminos es ingles hardcodeado y solo produciria ruido. Con `--copy-en` se
 * dejan pasar.
 *
 * UNA ASIMETRIA QUE INVALIDA LA COMPARACION: si el frame raiz no tiene fill, el detector OMITE la
 * familia de contraste entera y el informe sale absuelto de algo que no se ha mirado. Para comparar
 * dos archivos, los dos frames raiz necesitan fill. Se avisa si el shim no trae fondo.
 *
 *   node scripts/audita-calidad.mjs <shim.html> [--copy-en] [--json] [--todo]
 *
 * `--todo` desactiva las supresiones: sirve para revisar si un punto ciego dejo de serlo, nunca
 * para puntuar.
 */
import { readFileSync, existsSync, openSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DETECTOR = join(AQUI, '..', 'vendor', 'impeccable', 'detect.mjs');

const args = process.argv.slice(2);
const copyEn = args.includes('--copy-en');
const json = args.includes('--json');
const todo = args.includes('--todo');
const objetivo = args.find((a) => !a.startsWith('--'));

if (!objetivo) {
  console.error('\nuso: audita-calidad.mjs <shim.html> [--copy-en] [--json] [--todo]\n' +
                'El shim lo produce scripts/figma-shim.js corriendo dentro de use_figma.\n');
  process.exit(2);
}
if (!existsSync(objetivo)) { console.error(`\nNo existe ${objetivo}\n`); process.exit(2); }
if (!existsSync(DETECTOR)) {
  console.error(`\nFalta el detector empaquetado en ${DETECTOR}.\n` +
                `Ver vendor/impeccable/PROCEDENCIA.md para reinstalarlo.\n`);
  process.exit(2);
}

/** Puntos ciegos verificados del shim. No son opiniones sobre las reglas: son limites del transpilador. */
const CIEGOS = {
  'cramped-padding': 'full-bleed con hijo de alto completo lee como pegado al borde',
  'low-contrast':    'el shim no pinta imagenes: el rgba se compone contra el fondo de pagina',
  'tiny-text':       'asimetrico segun si la maqueta se dibujo con texto o como vector',
  'undersized-ui-text': 'mismo caso que tiny-text',
};
const COPY_EN_INGLES = {
  'marketing-buzzword': 'lista de terminos en ingles hardcodeada',
  'em-dash-overuse':    'convencion tipografica distinta en espanol',
};

// La salida va a un ARCHIVO, no a una tuberia. El detector sale con codigo distinto de 0 cuando
// encuentra hallazgos —que es lo normal— y en esa via la captura por tuberia de Node devolvia el
// stdout cortado a 64 KB: el mismo archivo daba 71.881 bytes de JSON valido escrito a disco y
// 65.422 bytes truncados a media cadena por la tuberia. El corte aparecia justo en los archivos
// con MAS hallazgos, que son exactamente los que importan.
const tmp = join(tmpdir(), `c2w-calidad-${process.pid}.json`);
const fd = openSync(tmp, 'w');
let r;
try {
  r = spawnSync('node', [DETECTOR, '--json', resolve(objetivo)], { stdio: ['ignore', fd, 'pipe'], encoding: 'utf8' });
} finally {
  closeSync(fd);
}
if (r.error) { rmSync(tmp, { force: true }); console.error(`\nNo pude lanzar el detector: ${r.error.message}\n`); process.exit(2); }
const crudo = readFileSync(tmp, 'utf8');
rmSync(tmp, { force: true });
if (!crudo || !crudo.trim()) {
  console.error(`\nEl detector no devolvio nada (codigo ${r.status}):\n${r.stderr || '(sin stderr)'}\n`);
  process.exit(2);
}

let todos;
try {
  todos = JSON.parse(crudo);
} catch (e) {
  console.error(`\nEl detector devolvio JSON invalido (${crudo.length} bytes, codigo ${r.status}).`);
  console.error(`Suele ser salida truncada. Primeros 200 caracteres:\n${crudo.slice(0, 200)}\n`);
  process.exit(2);
}

// El aviso de modo degradado va por stderr y es exactamente el tipo de cosa que no se puede
// tragar: sin los parsers de HTML/CSS el detector NO evalua contraste ni selectores, y sus
// propias palabras son "an undercount, not a clean bill of health". Un gate a medio gas miente.
if (/DEGRADED/i.test(r.stderr || '')) {
  console.error(`\nEl detector corre en modo DEGRADADO: faltan htmlparser2 / css-select / css-tree / domutils.`);
  console.error(`En ese modo NO evalua contraste ni selectores y los hallazgos son un subconteo.`);
  console.error(`Instalalos antes de puntuar:  cd ${join(AQUI, '..')} && npm install\n`);
  process.exit(2);
}
const suprimidas = todo ? {} : { ...CIEGOS, ...(copyEn ? {} : COPY_EN_INGLES) };
const vivos = todos.filter((f) => !(f.antipattern in suprimidas));
const callados = todos.filter((f) => f.antipattern in suprimidas);

// El aviso de la asimetria: sin fondo en el frame raiz, la familia de contraste no se evalua y el
// informe parece limpio en algo que nadie ha mirado.
const html = readFileSync(objetivo, 'utf8');
const sinFondo = !/<body[^>]*style="[^"]*background/i.test(html) && !/<div[^>]*style="[^"]*background-color/i.test(html.slice(0, 4000));

if (json) {
  console.log(JSON.stringify({ vivos, suprimidos: callados, sinFondo }, null, 2));
  process.exit(vivos.length ? 1 : 0);
}

const porRegla = {};
for (const f of vivos) (porRegla[f.antipattern] ??= []).push(f);
const orden = Object.entries(porRegla).sort((a, b) => b[1].length - a[1].length);

console.log(`\n  ${objetivo}\n`);
if (!vivos.length) {
  console.log('  Sin hallazgos de calidad.');
} else {
  console.log('  ' + 'antipatron'.padEnd(34) + 'n'.padStart(4) + '  severidad   categoria');
  for (const [regla, fs] of orden) {
    console.log('  ' + regla.padEnd(34) + String(fs.length).padStart(4) +
                `  ${(fs[0].severity ?? '').padEnd(10)} ${fs[0].category ?? ''}`);
  }
  console.log(`\n  ${vivos.length} hallazgo(s) en ${orden.length} antipatron(es).`);
  console.log(`  Detalle: vuelve a correr con --json.`);
}

if (callados.length) {
  const c = {};
  for (const f of callados) (c[f.antipattern] ??= 0), c[f.antipattern]++;
  console.log(`\n  Suprimidos (punto ciego verificado del shim, NO son defectos):`);
  for (const [r, n] of Object.entries(c)) console.log(`    ${String(n).padStart(4)}  ${r} — ${suprimidas[r]}`);
}
if (sinFondo) {
  console.log(`\n  AVISO: el frame raiz parece no tener fill. Sin fondo resoluble el detector OMITE la`);
  console.log(`  familia de contraste entera, asi que este informe no la ha mirado. Pon fill al frame`);
  console.log(`  raiz antes de comparar contra otro archivo.`);
}
console.log();
process.exit(vivos.length ? 1 : 0);
