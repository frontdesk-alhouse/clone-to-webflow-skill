#!/usr/bin/env node
/**
 * Runner. Un informe, un exit code.
 *
 *   node audita-responsivo.mjs [url] [--rapido] [--md]
 *
 * Hoy cada gate se corre a mano y nadie agrega: se acaba con seis salidas de consola en seis
 * momentos distintos y ninguna respuesta a "¿esta bien o no?". Esto las junta, las ordena por
 * severidad y devuelve un solo numero al shell.
 *
 * Corre lo propio siempre (perfil, conmutadores, banda, estetica) y lo prestado de
 * clone-to-webflow cuando esta y cuando su configuracion lo permite. Un gate que no se pudo
 * correr sale como OMITIDO con su motivo, nunca como verde.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { cargaConfig, url as urlDe } from './lib/config.mjs';
import { disponible, script as prestado } from './lib/reuso.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const cfg = cargaConfig();
const URL_ = args.find((a) => /^(https?|file):\/\//.test(a)) ?? urlDe(cfg, cfg.sitio.paginas[0]);
const RAPIDO = flag('--rapido');

const S = cfg.selectores ?? {};
const tieneRol = (a, b) => S[a] && S[b] && S[a] !== S[b];

const PASOS = [
  { id: 'perfil', fase: 0, titulo: 'Perfil del sitio', cmd: [join(AQUI, 'perfil.mjs'), URL_, '--json'], propio: true },
  { id: 'conmutadores', fase: 1, titulo: 'Conmutadores del CSS', cmd: [join(AQUI, 'conmutadores.mjs'), URL_, '--json'], propio: true },
  {
    id: 'banda', fase: 1, titulo: 'Corte de banda limpio', cmd: [join(AQUI, 'gate-banda.mjs'), URL_, '--json'], propio: true,
    salta: !(tieneRol('navEscritorio', 'navMovil') || tieneRol('seccionEscritorio', 'seccionMovil'))
      && 'faltan pares excluyentes en selectores (navEscritorio/navMovil o seccionEscritorio/seccionMovil)',
  },
  {
    id: 'pines', fase: 1, titulo: 'Escenas fijadas a los anchos derivados', cmd: [join(AQUI, 'gate-pines.mjs'), '--json'], propio: true,
    salta: !(cfg.pines?.escenas?.length) ? 'no hay escenas declaradas en pines.escenas (si el sitio tiene pines, declaralos)' : RAPIDO && '--rapido',
  },
  {
    id: 'desborde', fase: 1, titulo: 'Desborde recorriendo', cmd: [prestado('gate-desborde.mjs'), '--json'], propio: false,
    salta: !disponible() && 'clone-to-webflow no instalado',
  },
  {
    id: 'escalado', fase: 1, titulo: 'Centrado, desborde y tope en 15 anchos', cmd: [prestado('mide-escalado.mjs'), URL_], propio: false, texto: true,
    salta: !disponible() ? 'clone-to-webflow no instalado'
      : !(S.seccionEscritorio || S.seccionMovil) && 'faltan selectores.seccionEscritorio / seccionMovil',
  },
  { id: 'estetica', fase: 2, titulo: 'Rubrica responsiva', cmd: [join(AQUI, 'mide-estetica.mjs'), URL_, '--json'], propio: true, salta: RAPIDO && '--rapido' },
];

const ORDEN = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
const resultados = [];

for (const p of PASOS) {
  if (p.salta) { resultados.push({ ...p, estado: 'OMITIDO', motivo: p.salta, hallazgos: [] }); continue; }
  let out = '', code = 0;
  try {
    out = execFileSync('node', p.cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    code = e.status ?? 1;
    out = (e.stdout ?? '') + (e.stderr ?? '');
    if (code === 2) { resultados.push({ ...p, estado: 'OMITIDO', motivo: (out.trim().split('\n').find(Boolean) ?? 'no se pudo correr').slice(0, 160), hallazgos: [] }); continue; }
  }
  let datos = null;
  if (!p.texto) { try { datos = JSON.parse(out); } catch { /* salida no-JSON */ } }
  const hallazgos = (datos?.fallos ?? datos?.hallazgos ?? []).map((f) => ({
    nivel: f.nivel ?? 'MEDIUM', que: f.que, detalle: f.detalle ?? f.porque ?? '', gate: p.id,
  }));
  resultados.push({ ...p, estado: code ? 'FALLA' : 'PASA', code, datos, salida: p.texto ? out : null, hallazgos });
}

const todos = resultados.flatMap((r) => r.hallazgos).sort((a, b) => ORDEN[a.nivel] - ORDEN[b.nivel]);
const cuenta = (n) => todos.filter((h) => h.nivel === n).length;
const omitidos = resultados.filter((r) => r.estado === 'OMITIDO');
const perfil = resultados.find((r) => r.id === 'perfil')?.datos;

// --- informe ---------------------------------------------------------------------------------
const L = [];
L.push(`# Informe responsivo · ${cfg.cliente ?? 'sitio'}`);
L.push('');
L.push(`**${URL_}** · ${new Date().toISOString().slice(0, 10)} · medido en el HTML servido, no en la API ni en el Designer.`);
L.push('');
if (perfil) {
  L.push(`## Perfil`);
  L.push('');
  L.push(`**Modo propuesto: ${perfil.modo.toUpperCase()}** — ${perfil.porque}`);
  L.push('');
  L.push('| capa | reglas | clases | clamp() | vh | vw | % |');
  L.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const [n, c] of Object.entries(perfil.capas)) {
    L.push(`| ${n} | ${c.reglas} | ${c.clases} | ${c.unidades.clamp} | ${c.unidades.vh} | ${c.unidades.vw} | ${c.unidades.pct} |`);
  }
  L.push('');
  L.push(`Cortes: ${perfil.cortes.map((c) => `${c.ancho}${c.tipo === 'min' ? '+' : ''}${c.nativo ? '' : '*'}`).join(' · ')}  (\\* = propio)`);
  L.push('');
}
L.push(`## Resumen`);
L.push('');
L.push('| gate | fase | estado |');
L.push('|---|:--:|---|');
for (const r of resultados) {
  L.push(`| ${r.titulo} | ${r.fase} | ${r.estado === 'OMITIDO' ? `OMITIDO — ${r.motivo}` : r.estado}${r.hallazgos.length ? ` (${r.hallazgos.length})` : ''} |`);
}
L.push('');
L.push(`**${cuenta('CRITICAL')} CRITICAL · ${cuenta('HIGH')} HIGH · ${cuenta('MEDIUM')} MEDIUM · ${cuenta('LOW')} LOW · ${cuenta('INFO')} INFO**`);
if (omitidos.length) {
  L.push('');
  L.push(`> ${omitidos.length} gate(s) no se corrieron. Un gate omitido no es un gate en verde:`);
  for (const o of omitidos) L.push(`> · **${o.titulo}** — ${o.motivo}`);
}
if (todos.length) {
  L.push('');
  L.push(`## Hallazgos`);
  L.push('');
  for (const h of todos) {
    L.push(`### [${h.nivel}] ${h.que}`);
    L.push('');
    L.push(`\`${h.gate}\` · ${h.detalle}`);
    L.push('');
  }
}
const md = L.join('\n') + '\n';

if (flag('--md')) console.log(md);
else {
  console.log(`\nAuditoria responsiva · ${URL_}\n`);
  for (const r of resultados) {
    const est = r.estado === 'OMITIDO' ? `OMITIDO — ${r.motivo}` : r.estado + (r.hallazgos.length ? ` (${r.hallazgos.length})` : '');
    console.log(`  F${r.fase}  ${r.titulo.padEnd(42)}${est}`);
  }
  console.log(`\n  ${cuenta('CRITICAL')} CRITICAL · ${cuenta('HIGH')} HIGH · ${cuenta('MEDIUM')} MEDIUM · ${cuenta('LOW')} LOW · ${cuenta('INFO')} INFO`);
  if (todos.length) {
    console.log('');
    for (const h of todos.filter((x) => x.nivel !== 'INFO')) console.log(`  [${h.nivel}] ${h.gate} · ${h.que}`);
  }
  if (omitidos.length) {
    console.log(`\n  Un gate omitido no es un gate en verde:`);
    for (const o of omitidos) console.log(`    · ${o.titulo}: ${o.motivo}`);
  }
}

if (cfg.salida) {
  mkdirSync(cfg.salida, { recursive: true });
  writeFileSync(join(cfg.salida, 'INFORME-RESPONSIVO.md'), md);
  if (!flag('--md')) console.log(`\n  ${join(cfg.salida, 'INFORME-RESPONSIVO.md')}\n`);
}

process.exit(cuenta('CRITICAL') || cuenta('HIGH') ? 1 : 0);
