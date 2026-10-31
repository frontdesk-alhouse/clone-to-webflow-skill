#!/usr/bin/env node
/**
 * playbook · el orden por bandas, con registro y compuerta.
 *
 *   figma  →  escritorio  →  movil  →  tablet  →  responsividad
 *
 * Por que existe: en Cliente A la responsividad se arreglo tres veces a posteriori. La causa no fue tecnica sino de
 * ORDEN: se abria una banda sin que la anterior estuviera cerrada y aprobada. Un documento que dice el orden se
 * olvida; un archivo de estado que el comando consulta antes de tocar nada, no.
 *
 *   node playbook.mjs estado   [--pagina x] [--json]
 *   node playbook.mjs puede    <etapa> --pagina x            exit 0 = se puede abrir · exit 1 = dice que falta
 *   node playbook.mjs abre     <etapa> --pagina x            (corre `puede` y marca en-curso)
 *   node playbook.mjs aprueba  <etapa> --pagina x --por Revisor --evidencia informe.md [--nota ".."] [--adjudicado KL-nn]
 *   node playbook.mjs aprueba  <etapa> --pagina x --por Revisor --retroactivo --fecha 2026-09-14 --fuente "RUN-LOG .."
 *   node playbook.mjs reabre   <etapa> --pagina x --motivo ".."   (las aprobadas posteriores pasan a por-reverificar)
 *   node playbook.mjs reverifica <etapa> --pagina x --evidencia informe.md
 *
 * El aprobado es de una PERSONA y es explicito. Un PASS de gate no es un aprobado, y este script no deja que el
 * agente se apruebe a si mismo: `--por` es obligatorio y no admite nombres de agente.
 *
 * El estado vive en el proyecto del cliente (`spec/playbook-estado.json`), no en el skill: sobrevive a sesiones.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { CFG, RAIZ, PAGINAS, ORDEN_PORT, etiquetaDe } from './config.mjs';

export const ETAPAS = ['figma', 'escritorio', 'movil', 'tablet', 'responsividad'];
/** Que tiene que estar APROBADO para abrir cada etapa. */
const REQUIERE = {
  figma: [],
  escritorio: ['figma'],
  movil: ['escritorio'],
  tablet: ['movil'],
  responsividad: ['escritorio', 'movil', 'tablet'],
};
/** Ancho del frame de Figma que es la FUENTE de cada banda. Configurable en `playbook.bandas`. */
const BANDAS = { escritorio: 1440, tablet: 768, movil: 390, ...(CFG.playbook?.bandas || {}) };
/** `sitio-existente`: no se exige la etapa figma aprobada, pero SI el frame de la banda que se abre. */
const MODO = CFG.playbook?.modo || 'nuevo';
const ARCHIVO = join(RAIZ, CFG.playbook?.archivo || 'spec/playbook-estado.json');
const AGENTE = /claude|codex|gpt|gemini|agente|agent|\bia\b|\bai\b/i;
const ROJO = [/^[\s*#>|-]*(FAIL|FALLA)\b/m, /NO VALIDADO/, /VEREDICTO[^\n]*FAIL/i, /fallos\W{0,4}[1-9]/i, /✗/];

// ---------------------------------------------------------------- argumentos
const [, , orden, ...resto] = process.argv;
const opt = (k) => { const i = resto.indexOf(`--${k}`); return i >= 0 && resto[i + 1] && !resto[i + 1].startsWith('--') ? resto[i + 1] : null; };
const opts = (k) => resto.flatMap((a, i) => (a === `--${k}` && resto[i + 1] ? [resto[i + 1]] : []));
const bandera = (k) => resto.includes(`--${k}`);
const etapaArg = resto.find((a) => ETAPAS.includes(a));
const hoy = () => new Date().toISOString().slice(0, 10);
const muere = (msg, code = 1) => { console.error(`\n${msg}\n`); process.exit(code); };

// ---------------------------------------------------------------- estado
/** Paginas del playbook: las de `paginas` y las de `ordenPort` (una pagina puede estar en el orden de porte sin medirse aun). */
const CRUDAS = [...new Set([...ORDEN_PORT, ...PAGINAS])];
const ETIQUETAS = CRUDAS.map(etiquetaDe);
/** La clave tal como esta escrita en el config (`''` para la home), a partir de su etiqueta. */
const cruda = (etiqueta) => CRUDAS.find((p) => etiquetaDe(p) === etiqueta);
const lee = () => (existsSync(ARCHIVO) ? JSON.parse(readFileSync(ARCHIVO, 'utf8')) : { version: 1, paginas: {} });
const guarda = (estado) => {
  mkdirSync(dirname(ARCHIVO), { recursive: true });
  const doc = 'Registro del playbook por bandas de clone-to-webflow. Lo escribe scripts/playbook.mjs; los aprobados son de una persona, con fecha. No se edita a mano.';
  writeFileSync(ARCHIVO, JSON.stringify({ _: doc, ...estado, version: 1 }, null, 2) + '\n');
};
const celda = (estado, pagina, etapa) => estado.paginas?.[pagina]?.[etapa] || { estado: 'sin-registro' };
/** Devuelve un estado NUEVO con la celda cambiada y una linea mas de historial. No muta el que recibe. */
const conCelda = (estado, pagina, etapa, cambio, suceso) => {
  const previa = celda(estado, pagina, etapa);
  const historial = [...(previa.historial || []), { fecha: hoy(), ...suceso }];
  const nueva = { ...previa, ...cambio, historial };
  return { ...estado, paginas: { ...estado.paginas, [pagina]: { ...(estado.paginas?.[pagina] || {}), [etapa]: nueva } } };
};

// ---------------------------------------------------------------- reglas
/** Frames de Figma de una pagina: por pagina si estan declarados; si no, los del sitio (y se avisa). */
function framesDe(pagina) {
  const fpp = CFG.figma?.framesPorPagina || {};
  const porPagina = fpp[pagina] ?? fpp[cruda(pagina)];   // por etiqueta (`home`) o por la clave del config (`''`)
  if (porPagina) return { frames: porPagina, fuente: 'figma.framesPorPagina' };
  return { frames: CFG.figma?.frames || {}, fuente: 'figma.frames (del SITIO, no de la pagina)' };
}
const framesQueFaltan = (pagina, bandas) => {
  const { frames } = framesDe(pagina);
  return bandas.filter((b) => !String(frames[String(BANDAS[b])] || '').trim()).map((b) => `${b} @${BANDAS[b]}`);
};

/** Motivos por los que NO se puede abrir una etapa. Vacio = se puede. */
function bloqueos(estado, pagina, etapa) {
  const motivos = [];
  for (const previa of REQUIERE[etapa]) {
    if (previa === 'figma' && MODO === 'sitio-existente') continue;
    const c = celda(estado, pagina, previa);
    if (c.estado === 'aprobada') continue;
    motivos.push(c.estado === 'por-reverificar'
      ? `«${previa}» esta por-reverificar (se reabrio una etapa anterior): corre sus gates y \`reverifica ${previa}\``
      : `«${previa}» no tiene aprobado registrado (estado: ${c.estado}). Lo da una persona, con \`aprueba ${previa} --por …\``);
  }
  // El frame de la banda que se abre es su fuente: sin el no hay contra que medir, en ningun modo.
  const bandasNecesarias = etapa === 'figma' ? [] : etapa === 'responsividad' ? Object.keys(BANDAS) : [etapa];
  const faltan = framesQueFaltan(pagina, bandasNecesarias);
  if (faltan.length) motivos.push(`falta el frame de Figma de: ${faltan.join(', ')} (${framesDe(pagina).fuente})`);
  return motivos;
}

/** La siguiente accion permitida para una pagina. */
function siguiente(estado, pagina) {
  for (const etapa of ETAPAS) {
    const c = celda(estado, pagina, etapa);
    if (c.estado === 'aprobada') continue;
    if (etapa === 'figma' && MODO === 'sitio-existente' && c.estado === 'sin-registro') continue;
    if (c.estado === 'en-curso') return `${etapa}: en curso → cerrar gates y pedir el aprobado`;
    if (c.estado === 'por-reverificar') return `${etapa}: reverificar (gates + foto-sitio comparar)`;
    const b = bloqueos(estado, pagina, etapa);
    return b.length ? `${etapa}: BLOQUEADA — ${b[0]}` : `${etapa}: se puede abrir`;
  }
  return 'completa';
}

function evidenciaVerde(rutas, adjudicado) {
  if (!rutas.length) muere('Falta --evidencia <informe>: un aprobado sin informe de gates no se registra.\nSi el aprobado es anterior al playbook, usa --retroactivo --fecha AAAA-MM-DD --fuente "donde consta".');
  const rel = [];
  for (const r of rutas) {
    const abs = isAbsolute(r) ? r : join(process.cwd(), r);
    if (!existsSync(abs)) muere(`La evidencia no existe: ${abs}`);
    const rojo = ROJO.find((re) => re.test(readFileSync(abs, 'utf8')));
    if (rojo && !adjudicado) muere(`La evidencia ${r} trae un rojo (${rojo}). No se aprueba sobre un informe en rojo.\nSi el fallo esta adjudicado, dilo: --adjudicado KL-nnn`);
    rel.push(relative(RAIZ, abs));
  }
  return rel;
}

// ---------------------------------------------------------------- ordenes
const exigePagina = () => {
  const p = opt('pagina');
  if (p === null) muere(`Falta --pagina. Paginas del config: ${ETIQUETAS.join(', ')}`, 2);
  if (!ETIQUETAS.includes(p)) muere(`«${p}» no esta en \`paginas\` ni en \`ordenPort\` de ${relative(process.cwd(), CFG.__path) || 'harness.config.json'}. Hay: ${ETIQUETAS.join(', ')}`, 2);
  return p;
};
const exigeEtapa = () => etapaArg || muere(`Falta la etapa. Una de: ${ETAPAS.join(' → ')}`, 2);

function ordenEstado() {
  const estado = lee();
  const paginas = opt('pagina') ? [exigePagina()] : ETIQUETAS;
  if (bandera('json')) {
    console.log(JSON.stringify({ modo: MODO, archivo: ARCHIVO, paginas: Object.fromEntries(paginas.map((p) => [p, { etapas: Object.fromEntries(ETAPAS.map((e) => [e, celda(estado, p, e).estado])), siguiente: siguiente(estado, p) }])) }, null, 1));
    return;
  }
  const marca = { 'sin-registro': '·', 'en-curso': '◐', aprobada: '✓', 'por-reverificar': '↻' };
  const ancho = Math.max(8, ...paginas.map((p) => p.length));
  console.log(`\nPlaybook por bandas · ${CFG.cliente || ''} · modo ${MODO}\n${relative(process.cwd(), ARCHIVO)}${existsSync(ARCHIVO) ? '' : '  (aun no existe: nada registrado)'}\n`);
  console.log(`${'pagina'.padEnd(ancho)}  ${ETAPAS.map((e) => e.slice(0, 6).padEnd(7)).join('')} siguiente`);
  for (const p of paginas) {
    console.log(`${p.padEnd(ancho)}  ${ETAPAS.map((e) => marca[celda(estado, p, e).estado].padEnd(7)).join('')} ${siguiente(estado, p)}`);
  }
  console.log('\n✓ aprobada · ◐ en curso · ↻ por reverificar · · sin registro\n');
}

function ordenPuede({ callado = false } = {}) {
  const etapa = exigeEtapa(), pagina = exigePagina();
  const motivos = bloqueos(lee(), pagina, etapa);
  if (motivos.length) muere(`NO se puede abrir «${etapa}» en «${pagina}»:\n${motivos.map((m) => `  - ${m}`).join('\n')}\n\nEl orden es ${ETAPAS.join(' → ')}. No se abre una banda sin el aprobado de la anterior.`);
  if (!callado) {
    const { fuente } = framesDe(pagina);
    console.log(`SE PUEDE abrir «${etapa}» en «${pagina}».${/SITIO/.test(fuente) && etapa !== 'figma' ? `\nAVISO: frames leidos de ${fuente}. Declara figma.framesPorPagina.${pagina} para que el chequeo sea de esta pagina.` : ''}`);
  }
  return { etapa, pagina };
}

function ordenAbre() {
  const { etapa, pagina } = ordenPuede({ callado: true });
  const estado = lee();
  if (celda(estado, pagina, etapa).estado === 'aprobada') muere(`«${etapa}» de «${pagina}» ya esta aprobada. Para corregirla: reabre ${etapa} --pagina ${pagina} --motivo "…"`);
  guarda(conCelda(estado, pagina, etapa, { estado: 'en-curso', abierta: hoy() }, { suceso: 'abre' }));
  const congeladas = ETAPAS.filter((e) => !['figma', etapa].includes(e) && celda(estado, pagina, e).estado === 'aprobada');
  console.log(`«${etapa}» de «${pagina}» → en-curso.`);
  if (congeladas.length) console.log(`Bandas congeladas: ${congeladas.join(', ')}. ANTES de tocar nada: foto-sitio.mjs antes. Al cerrar: foto-sitio.mjs comparar → cero cambios en ellas.`);
}

function ordenAprueba() {
  const etapa = exigeEtapa(), pagina = exigePagina();
  const por = opt('por');
  if (!por) muere('Falta --por <persona>. El aprobado es de una persona y es explicito.', 2);
  if (AGENTE.test(por)) muere(`«${por}» no puede aprobar: el agente no se aprueba a si mismo. Un PASS de gate no es un aprobado.`);
  const estado = lee();
  const pendientes = bloqueos(estado, pagina, etapa);
  if (pendientes.length) muere(`No se aprueba «${etapa}» con la anterior abierta:\n${pendientes.map((m) => `  - ${m}`).join('\n')}`);
  if (etapa === 'figma') {
    const faltan = framesQueFaltan(pagina, Object.keys(BANDAS));
    if (faltan.length) muere(`«figma» no se aprueba incompleta. Falta el frame de: ${faltan.join(', ')} (${framesDe(pagina).fuente}).\nPrimero TODOS los frames: escritorio, tablet y movil.`);
  }
  const retro = bandera('retroactivo');
  if (retro && !(opt('fecha') && opt('fuente'))) muere('--retroactivo exige --fecha AAAA-MM-DD y --fuente "donde consta ese aprobado".', 2);
  const evidencia = retro ? [] : evidenciaVerde(opts('evidencia'), opt('adjudicado'));
  const cambio = { estado: 'aprobada', por, fecha: retro ? opt('fecha') : hoy(), evidencia,
    ...(opt('nota') ? { nota: opt('nota') } : {}), ...(retro ? { fuente: opt('fuente') } : {}), ...(opt('adjudicado') ? { adjudicado: opt('adjudicado') } : {}) };
  guarda(conCelda(estado, pagina, etapa, cambio, { suceso: retro ? 'aprueba-retroactivo' : 'aprueba', por }));
  console.log(`«${etapa}» de «${pagina}» APROBADA por ${por} (${cambio.fecha}). Queda congelada.\nSiguiente → ${siguiente(lee(), pagina)}`);
}

function ordenReabre() {
  const etapa = exigeEtapa(), pagina = exigePagina();
  const motivo = opt('motivo') || muere('Falta --motivo "…": una banda aprobada no se reabre sin decir por que.', 2);
  let estado = conCelda(lee(), pagina, etapa, { estado: 'en-curso', abierta: hoy() }, { suceso: 'reabre', motivo });
  const arrastradas = [];
  for (const posterior of ETAPAS.slice(ETAPAS.indexOf(etapa) + 1)) {
    if (celda(estado, pagina, posterior).estado !== 'aprobada') continue;
    estado = conCelda(estado, pagina, posterior, { estado: 'por-reverificar' }, { suceso: 'por-reverificar', causa: `se reabrio ${etapa}: ${motivo}` });
    arrastradas.push(posterior);
  }
  guarda(estado);
  console.log(`«${etapa}» de «${pagina}» reabierta. ${arrastradas.length ? `Por reverificar: ${arrastradas.join(', ')} (conservan su aprobado; hay que volver a medirlas).` : 'Ninguna etapa posterior estaba aprobada.'}\nFase 8: primero el gate que FALLA, despues el arreglo.`);
}

function ordenReverifica() {
  const etapa = exigeEtapa(), pagina = exigePagina();
  const estado = lee();
  const c = celda(estado, pagina, etapa);
  if (c.estado !== 'por-reverificar') muere(`«${etapa}» de «${pagina}» no esta por-reverificar (estado: ${c.estado}).`);
  const pendientes = bloqueos(estado, pagina, etapa);
  if (pendientes.length) muere(`Antes hay que cerrar lo anterior:\n${pendientes.map((m) => `  - ${m}`).join('\n')}`);
  const evidencia = evidenciaVerde(opts('evidencia'), opt('adjudicado'));
  guarda(conCelda(estado, pagina, etapa, { estado: 'aprobada', reverificada: hoy(), evidencia: [...(c.evidencia || []), ...evidencia] }, { suceso: 'reverifica' }));
  console.log(`«${etapa}» de «${pagina}» reverificada: recupera el aprobado de ${c.por} (${c.fecha}).`);
}

const ORDENES = { estado: ordenEstado, puede: ordenPuede, abre: ordenAbre, aprueba: ordenAprueba, reabre: ordenReabre, reverifica: ordenReverifica };
if (!ORDENES[orden]) muere(`Uso: playbook.mjs <${Object.keys(ORDENES).join('|')}> [etapa] --pagina x\nEtapas: ${ETAPAS.join(' → ')}`, 2);
ORDENES[orden]();
