/**
 * Lectura de JSON de configuracion con documentacion en linea.
 *
 * Las plantillas de este skill (y las de clone-to-webflow) documentan cada bloque con una llave
 * `_` al lado del contenido, para que el archivo se explique solo al abrirlo. Esas llaves hay que
 * quitarlas antes de usar el objeto, o un `_` dentro de `bandas` se lee como una banda mas y el
 * validador reporta huecos que no existen.
 *
 * `__` se respeta: son los campos que los cargadores anaden despues (`__path`, `__raiz`).
 */
import { readFileSync } from 'node:fs';

export function limpia(v) {
  if (Array.isArray(v)) return v.map(limpia);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => k !== '_' && !(k.startsWith('_') && !k.startsWith('__')))
        .map(([k, x]) => [k, limpia(x)])
    );
  }
  return v;
}

export const leeJson = (ruta) => limpia(JSON.parse(readFileSync(ruta, 'utf8')));
