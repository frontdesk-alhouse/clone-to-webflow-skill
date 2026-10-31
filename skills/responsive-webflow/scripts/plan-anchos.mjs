#!/usr/bin/env node
/**
 * Plan de anchos, DERIVADO del sitio. Sustituye a la lista escrita a mano.
 *
 *   node plan-anchos.mjs [--json]
 *
 * Consume lo que ya se midio y lo convierte en un plan de medicion:
 *   · responsive-out/barrido.json       tramos (fluido / rigido / congelado) y fronteras al pixel
 *   · responsive-out/conmutadores.json  cortes reales del CSS
 *   · spec/movimiento.json              anchos del contrato de movimiento, si lo hay
 *
 * Y decide, por tramo:
 *   fluido      -> min, medio y max del tramo (para los gates que RECORREN y no pueden barrer a 40 px;
 *                  la continuidad ya la aserto barrido-continuidad, que es otro gate)
 *   rigido      -> UN ancho, pero solo despues de PROBARLO con prueba-invariante en sus dos extremos.
 *                  Si no es invariante, no era rigido: se muestrea como fluido y se dice.
 *   congelado   -> un ancho
 *   frontera    -> N-1 y N, del pixel que biseco el barrido
 *   contrato    -> siempre, todos los anchos que el contrato de movimiento nombre
 *
 * El plan lleva HUELLA: fecha, hash de conmutadores.json y anchos del contrato. gate-desborde la
 * comprueba y aborta si no cuadra: un plan caduco midiendo anchos viejos sin avisar es el default
 * silencioso que este skill prohibe.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cargaConfig } from './lib/config.mjs';
import { disponible, script } from './lib/reuso.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const cfg = cargaConfig();
const OUT = cfg.salida ?? 'responsive-out';

const lee = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const barrido = lee(join(OUT, 'barrido.json'));
const conm = lee(join(OUT, 'conmutadores.json'));
const contrato = lee('spec/movimiento.json');

if (!barrido) { console.error(`\nFalta ${join(OUT, 'barrido.json')}. Corre barrido-continuidad.mjs primero: el plan se deriva del barrido, no se inventa.\n`); process.exit(2); }
if (!conm) console.error(`  AVISO: no hay ${join(OUT, 'conmutadores.json')}; las fronteras del barrido no se contrastaron con cortes.`);

const TOL = cfg.gates?.toleranciaBanda ?? 4;
const anchos = new Map();   // ancho -> Set(motivos)
const add = (w, motivo) => { w = Math.round(w); if (!anchos.has(w)) anchos.set(w, new Set()); anchos.get(w).add(motivo); };

// --- fronteras: los dos lados ---------------------------------------------------------------
for (const f of barrido.fronteras ?? []) { add(f.exacto - 1, 'frontera-1'); add(f.exacto, 'frontera'); }
// cortes declarados que el barrido no vio conmutar tambien se miden a los dos lados: que no muevan el
// contenido no quiere decir que no muevan otra cosa
for (const c of conm?.cortes ?? []) { const w = c.tipo === 'max' ? c.ancho + 1 : c.ancho; add(w - 1, 'corte-1'); add(w, 'corte'); }

// --- contrato de movimiento -----------------------------------------------------------------
const anchosContrato = contrato?.anchos ? [...new Set(Object.values(contrato.anchos).map(Number).filter(Boolean))].sort((a, b) => a - b) : [];
for (const w of anchosContrato) add(w, 'contrato');

// --- tramos -----------------------------------------------------------------------------------
const S = cfg.selectores ?? {};
const candidatosSeccion = [S.seccionEscritorio, S.seccionMovil].filter(Boolean);
const rigidos = [];
const puedeProbar = disponible() && existsSync('harness.config.json') && candidatosSeccion.length > 0;
if (!puedeProbar) console.error(`  AVISO: no puedo probar la rigidez (${!disponible() ? 'clone-to-webflow no instalado' : !existsSync('harness.config.json') ? 'sin harness.config.json en el cwd' : 'sin selectores.seccion*'}): los tramos rigidos se muestrean como fluidos, por seguridad.`);

function prueba(desde, hasta) {
  // Devuelve { invariante, detalle } probando con el primer selector que no este oculto.
  for (const sel of candidatosSeccion) {
    try {
      const out = execFileSync('node', [script('prueba-invariante.mjs'), sel, String(desde), String(hasta), '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const r = JSON.parse(out.trim().split('\n').pop());
      return { invariante: !!r.invariante, detalle: r.motivo ?? `${r.pct}% distintos en ${r.caja}`, selector: sel };
    } catch (e) {
      const out = ((e.stdout ?? '') + '').trim().split('\n').pop();
      try { const r = JSON.parse(out); if (r.motivo?.includes('oculta')) continue; return { invariante: false, detalle: r.motivo ?? `${r.pct}%`, selector: sel }; } catch { /* siguiente */ }
    }
  }
  return { invariante: false, detalle: 'ningun selector de seccion visible en ese tramo', selector: null };
}

const tramos = [];
for (const t of barrido.tramos ?? []) {
  const largo = t.hasta - t.desde;
  const info = { ...t, plan: null, prueba: null };
  if (t.regimen === 'fluido') {
    info.plan = 'muestreo min/medio/max (la continuidad la aserto el barrido)';
    add(t.desde, 'fluido-min'); add(Math.round((t.desde + t.hasta) / 2), 'fluido-medio'); add(t.hasta, 'fluido-max');
  } else if (t.regimen === 'congelado') {
    info.plan = 'un ancho (congelado: por encima del tope todo es identico)';
    add(Math.round((t.desde + t.hasta) / 2), 'congelado');
  } else {
    // rigido: se PRUEBA
    if (puedeProbar && largo >= 2 * TOL) {
      const r = prueba(t.desde + 1, t.hasta - 1);
      info.prueba = r;
      if (r.invariante) { info.plan = 'un ancho (rigidez PROBADA por pixeles)'; add(Math.round((t.desde + t.hasta) / 2), 'rigido-probado'); rigidos.push(info); }
      else { info.plan = 'muestreo min/medio/max: el barrido lo dio rigido pero NO es invariante'; add(t.desde, 'rigido-no-invariante'); add(Math.round((t.desde + t.hasta) / 2), 'rigido-no-invariante'); add(t.hasta, 'rigido-no-invariante'); }
    } else {
      info.plan = 'muestreo min/medio/max (rigidez SIN PROBAR)';
      add(t.desde, 'rigido-sin-probar'); add(Math.round((t.desde + t.hasta) / 2), 'rigido-sin-probar'); add(t.hasta, 'rigido-sin-probar');
    }
  }
  tramos.push(info);
}

// --- huella ------------------------------------------------------------------------------------
const hash = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);
const plan = {
  huella: {
    fecha: new Date().toISOString().slice(0, 10),
    conmutadores: conm ? hash(conm.cortes) : null,
    barrido: hash({ tramos: barrido.tramos, fronteras: barrido.fronteras }),
    anchosContrato,
    url: barrido.url,
  },
  tramos,
  anchos: [...anchos.entries()].sort((a, b) => a[0] - b[0]).map(([w, m]) => ({ w, motivos: [...m] })),
  lista: [...anchos.keys()].sort((a, b) => a - b),
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'plan-anchos.json'), JSON.stringify(plan, null, 1) + '\n');

if (flag('--json')) { console.log(JSON.stringify(plan, null, 1)); process.exit(0); }
console.log(`\nPlan de anchos derivado · ${barrido.url}\n`);
console.log('tramo            regimen     plan');
for (const t of tramos) console.log(`  ${`${t.desde}-${t.hasta}`.padEnd(15)}${t.regimen.padEnd(12)}${t.plan}${t.prueba ? `\n${' '.repeat(29)}prueba: ${t.prueba.selector ?? '—'} · ${t.prueba.detalle}` : ''}`);
console.log(`\n${plan.lista.length} anchos: ${plan.lista.join(', ')}`);
console.log(`\nMotivos:`);
for (const { w, motivos } of plan.anchos) console.log(`  ${String(w).padEnd(6)} ${motivos.join(', ')}`);
const antes = cfg.gates?.desborde ?? [];
if (antes.length) {
  const soloAntes = antes.filter((w) => !anchos.has(w)), soloAhora = plan.lista.filter((w) => !antes.includes(w));
  console.log(`\nFrente a la lista a mano (${antes.length}): ${soloAntes.length} se quitan [${soloAntes.join(', ')}] · ${soloAhora.length} se anaden [${soloAhora.join(', ')}]`);
}
console.log(`\nhuella ${plan.huella.conmutadores ?? '—'} / ${plan.huella.barrido} · ${join(OUT, 'plan-anchos.json')}\n`);
