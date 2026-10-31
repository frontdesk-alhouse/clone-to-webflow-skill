#!/usr/bin/env node
/**
 * Evaluador visual a ciegas, con un modelo que NO es el que construyo.
 *
 *   node evaluador-visual.mjs [--motor=codex|gemini|pliego] [--solo=pagina] [--max=10]
 *
 * Lee la hoja de contacto (`hoja-contacto.mjs`), arma un pliego por pagina con `prompts/evaluador-visual.md` y se lo
 * pasa, con las capturas adjuntas, a un modelo externo por su CLI. Por que externo:
 *   · es ciego de verdad: no sabe que se arreglo ni comparte los sesgos de quien lo arreglo;
 *   · no gasta creditos de la sesion que construye. Codex va por la suscripcion de ChatGPT.
 * `--motor=pliego` no llama a nadie: deja los pliegos escritos para pasarselos a quien se quiera (un subagente, p. ej.).
 *
 * Solo puede RESTAR. Lo que devuelve son hallazgos clasificados MEDIBLE / CRITERIO; los MEDIBLE entran al registro de
 * escapes y se vuelven check antes de arreglarse (references/rubrica-funcional.md).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargaConfig } from './lib/config.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const cfg = cargaConfig();
const OUT = cfg.salida || 'responsive-out';
const DIR = join(OUT, 'contacto');
const MOTOR = opt('motor') || 'codex';
const MAX = Number(opt('max') || 10);           // capturas por llamada: mas y el modelo deja de mirar las ultimas
const SOLO = opt('solo')?.split(',') ?? null;

const indicePath = join(DIR, 'indice.json');
if (!existsSync(indicePath)) { console.error(`No hay hoja de contacto (${indicePath}). Corre antes hoja-contacto.mjs.`); process.exit(2); }
const indice = JSON.parse(readFileSync(indicePath, 'utf8'));
const plantilla = readFileSync(join(AQUI, '../prompts/evaluador-visual.md'), 'utf8');

// Lo ya medido entra COMPACTO: criterios y hallazgos abiertos, no el informe entero.
const evalPath = join(OUT, 'evaluacion.json');
const evaluacion = existsSync(evalPath) ? (() => { const e = JSON.parse(readFileSync(evalPath, 'utf8')); return [`${e.veredicto} ${e.nota}/10`, ...e.criterios.map((c) => `${c.id} ${c.nombre}: ${c.omitido ? 'OMITIDO' : `${c.puntos}/${c.peso}`}`), ...(e.hallazgos ?? []).slice(0, 20).map((h) => `abierto · ${h.que}`)].join('\n'); })() : 'no hay evaluacion funcional previa: dilo en tu respuesta, porque entonces nada de lo medible esta descartado';
const limitaciones = [...(cfg.integridad?.ignora ?? []).map((x) => `${x.selector ?? x}: ${x.porque ?? 'sin motivo escrito'}`)].join('\n') || 'ninguna declarada';

const porPagina = {};
for (const c of indice.capturas) if (!SOLO || SOLO.includes(c.pagina)) (porPagina[c.pagina] ||= []).push(c);

const salida = [`# Hallazgos visuales · ${cfg.cliente ?? ''} · ${new Date().toISOString().slice(0, 10)} · motor ${MOTOR}`, ''];
for (const [pagina, capturas] of Object.entries(porPagina)) {
  for (let i = 0; i < capturas.length; i += MAX) {
    const lote = capturas.slice(i, i + MAX);
    const lista = lote.map((c, k) => `${k + 1}. [${c.pagina}] [${c.ventana}${c.dispositivo ? ' · ' + c.dispositivo : ''}] [${c.parada}] — imagen adjunta n.º ${k + 1}`).join('\n');
    const pliego = plantilla.replace('{{EVALUACION}}', evaluacion).replace('{{LIMITACIONES}}', limitaciones).replace('{{INDICE}}', lista);
    const base = join(DIR, `pliego-${pagina.replace(/\W+/g, '-')}-${i / MAX + 1}`);
    writeFileSync(`${base}.md`, `${pliego}\n\n<!-- capturas:\n${lote.map((c) => c.archivo).join('\n')}\n-->\n`);
    if (MOTOR === 'pliego') { console.log(`· ${base}.md  (${lote.length} capturas)`); continue; }

    let respuesta = '';
    try {
      if (MOTOR === 'codex') {
        // `< /dev/null` no es adorno: sin stdin cerrado `codex exec` se queda esperando para siempre.
        execFileSync('codex', ['exec', '-s', 'read-only', '--skip-git-repo-check', ...lote.flatMap((c) => ['-i', c.archivo]), '-o', `${base}.respuesta.md`, pliego], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
        respuesta = readFileSync(`${base}.respuesta.md`, 'utf8');
      } else if (MOTOR === 'gemini') {
        respuesta = execFileSync('gemini', ['--skip-trust', '-p', `${pliego}\n\nLas capturas estan en estos archivos, abrelos:\n${lote.map((c) => `@${c.archivo}`).join('\n')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
      } else { console.error(`motor desconocido: ${MOTOR}`); process.exit(2); }
    } catch (e) { respuesta = `NO SE PUDO EVALUAR este lote (${String(e.message).split('\n')[0]}). No es un lote limpio: es un lote sin mirar.`; }
    salida.push(`## /${pagina} · lote ${i / MAX + 1} (${lote.map((c) => `${c.ventana} ${c.parada}`).join(', ')})`, '', respuesta.trim() || '_sin hallazgos_', '');
    console.log(`· /${pagina} lote ${i / MAX + 1}: ${(respuesta.match(/MEDIBLE/g) || []).length} medibles · ${(respuesta.match(/CRITERIO/g) || []).length} de criterio`);
  }
}
if (MOTOR !== 'pliego') {
  writeFileSync(join(DIR, 'HALLAZGOS-VISUALES.md'), salida.join('\n') + '\n');
  console.log(`\n→ ${join(DIR, 'HALLAZGOS-VISUALES.md')}\nLos MEDIBLE van a spec/escapes.json (quien: "evaluador visual") y se vuelven check. Los CRITERIO, al usuario como pregunta.`);
}
