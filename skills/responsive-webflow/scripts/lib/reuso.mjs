/**
 * Puente a clone-to-webflow. Se REUSA, no se copia.
 *
 * Cinco de los medidores multi-ancho que hacen falta aqui ya existen y estan validados alli
 * (gate-desborde, mide-escalado, mide-centrado, foto-sitio, genera-escala-fluida). Duplicarlos
 * garantiza que dentro de tres meses midan cosas distintas con el mismo nombre.
 *
 * Si clone-to-webflow no esta instalado, el skill sigue funcionando con sus propios gates y lo
 * dice. Lo que no hace es fallar en silencio.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export const RAIZ = `${homedir()}/.claude/skills/clone-to-webflow`;
export const disponible = () => existsSync(`${RAIZ}/scripts/config.mjs`);
export const script = (n) => `${RAIZ}/scripts/${n}`;

/** Los medidores de clone-to-webflow y para que sirve cada uno aqui. */
export const PRESTADOS = {
  'gate-desborde.mjs':  { que: 'desborde horizontal RECORRIENDO, N anchos x N paginas', necesita: 'harness.config.json' },
  'mide-escalado.mjs':  { que: 'centrado + desborde + tope tipografico en 15 anchos', necesita: 'selectores.seccion*/cuerpo*' },
  'mide-centrado.mjs':  { que: 'centrado de N piezas en los anchos donde cambia la banda', necesita: 'selectores.centrado' },
  'foto-sitio.mjs':     { que: 'capturas N anchos x N paginas, con modo comparar antes/despues', necesita: 'harness.config.json' },
  'audita-regimen.mjs': { que: 'clasifica secciones en fluido/rigido — un ancho por corrida', necesita: 'spec/secciones.json' },
  'genera-escala-fluida.mjs': { que: 'tokens clamp() topados, autoverificados en 9 anchos', necesita: 'spec/escala-entrada.json' },
};

export function aviso() {
  if (disponible()) return null;
  return `clone-to-webflow no esta instalado en ${RAIZ}.\n` +
    `Los gates propios (perfil, banda, conmutadores, unidad) funcionan igual.\n` +
    `Los prestados no: ${Object.keys(PRESTADOS).join(', ')}.`;
}
