#!/usr/bin/env node
/**
 * Regimen por seccion, en TODAS las bandas, fundido en un solo archivo.
 *
 *   node regimen-multiancho.mjs [url] [--anchos 390,768,1440]
 *
 * `audita-regimen.mjs` de clone-to-webflow clasifica bien, pero corre a un ancho por invocacion
 * y SOBRESCRIBE spec/regimen.json entero. El flujo que su propio SKILL.md prescribe —correr a
 * 1440 y luego a 390— pierde la primera clasificacion, y el script delega la fusion al humano.
 * Ademas trata `fluido -> sin-medir` como discrepancia y sale con exit 1 aunque no haya nada mal:
 * una seccion movil sencillamente no se pinta a 1440.
 *
 * Este envoltorio corre una vez por banda, conserva cada resultado y funde. Y separa los dos
 * casos que el original mezcla:
 *   · CHOQUE   — la misma seccion mide fluida a un ancho y rigida a otro. Eso si es un problema:
 *                el regimen es una propiedad de la composicion, no del ancho.
 *   · SIN MEDIR — la seccion no se pinta a ese ancho. Es un dato, no un choque.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cargaConfig, url as urlDe, frameDe } from './lib/config.mjs';
import { disponible, script, aviso } from './lib/reuso.mjs';

if (!disponible()) { console.error('\n' + aviso() + '\n'); process.exit(2); }

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const cfg = cargaConfig();
const URL_ = args.find((a) => /^(https?|file):\/\//.test(a)) ?? urlDe(cfg, cfg.sitio.paginas[0]);
const ANCHOS = (opt('--anchos') ?? '').length
  ? opt('--anchos').split(',').map(Number)
  : Object.keys(cfg.bandas).map((b) => frameDe(cfg, b));

// audita-regimen escribe SIEMPRE en spec/regimen.json. Ese archivo, en un cliente real, puede ser
// MANUAL y con otro vocabulario (Cliente A: "proporcional+J", secciones por pagina) y lo lee el
// comando para <accepted_limitations>. No se toca: se aparta antes de cada corrida y se devuelve
// intacto al final, y lo que este script produce va a OTRO archivo.
const SALIDA = 'spec/regimen.json';
const APARTADO = 'spec/.regimen.json.apartado-por-multiancho';
const habiaPrevio = existsSync(SALIDA);
if (habiaPrevio) renameSync(SALIDA, APARTADO);
const devuelve = () => { if (habiaPrevio && existsSync(APARTADO)) { if (existsSync(SALIDA)) unlinkSync(SALIDA); renameSync(APARTADO, SALIDA); } };
process.on('exit', devuelve);
process.on('SIGINT', () => { devuelve(); process.exit(130); });

const porAncho = {};
for (const w of ANCHOS) {
  try {
    execFileSync('node', [script('audita-regimen.mjs'), URL_, '--ancho', String(w)], { stdio: 'pipe' });
  } catch { /* exit 1 por choques o secciones sin medir: el resultado igual se escribio */ }
  if (!existsSync(SALIDA)) { console.error(`  ${w}px: audita-regimen no escribio ${SALIDA}`); continue; }
  porAncho[w] = JSON.parse(readFileSync(SALIDA, 'utf8'));
  unlinkSync(SALIDA);   // el resultado por ancho ya esta en memoria; no se dejan copias sueltas
}

// --- fusion ---------------------------------------------------------------------------------
const etiquetas = [...new Set(Object.values(porAncho).flatMap((r) => Object.keys(r.secciones ?? {})))];
const fundido = {};
const choques = [];
for (const et of etiquetas) {
  const porW = {};
  for (const [w, r] of Object.entries(porAncho)) {
    const s = r.secciones?.[et];
    porW[w] = s ? s.regimen : 'sin-medir';
  }
  const medidos = [...new Set(Object.values(porW).filter((v) => v !== 'sin-medir'))];
  const regimen = medidos.length === 1 ? medidos[0] : medidos.length === 0 ? 'sin-medir' : 'CHOQUE';
  if (regimen === 'CHOQUE') {
    choques.push({ seccion: et, porAncho: porW,
      porque: 'el regimen es una propiedad de la composicion, no del ancho: una seccion no puede ser fluida a un ancho y rigida a otro' });
  }
  const ref = Object.values(porAncho).map((r) => r.secciones?.[et]).find(Boolean);
  fundido[et] = { selector: ref?.selector, regimen, porAncho: porW, senales: ref?.senales };
}

const informe = { url: URL_, fecha: new Date().toISOString().slice(0, 10), anchos: ANCHOS, secciones: fundido, choques };
const OUT = cfg.salida ?? 'responsive-out';
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'regimen-por-ancho.json'), JSON.stringify(informe, null, 2) + '\n');

const cuenta = (v) => Object.values(fundido).filter((s) => s.regimen === v).length;
console.log(`\nRegimen por seccion · ${ANCHOS.join(', ')}px · ${URL_}\n`);
console.log('seccion'.padEnd(24) + ANCHOS.map((w) => String(w).padEnd(12)).join('') + 'regimen');
for (const [et, s] of Object.entries(fundido)) {
  console.log(et.slice(0, 23).padEnd(24) + ANCHOS.map((w) => String(s.porAncho[w] ?? '—').padEnd(12)).join('') + s.regimen);
}
console.log(`\n  ${cuenta('rigido')} rigida(s) · ${cuenta('fluido')} fluida(s) · ${cuenta('sin-medir')} sin medir en ningun ancho · ${choques.length} choque(s)`);
console.log(`  ${join(OUT, 'regimen-por-ancho.json')}`);
if (choques.length) {
  console.log(`\n  CHOQUES (${choques.length}):`);
  for (const c of choques) console.log(`    · ${c.seccion}: ` + Object.entries(c.porAncho).map(([w, v]) => `${w}=${v}`).join(' '));
  console.log(`  Una seccion que mide fluida a un ancho y rigida a otro no tiene un regimen: tiene dos disenos.`);
}
console.log('');
process.exit(choques.length ? 1 : 0);
