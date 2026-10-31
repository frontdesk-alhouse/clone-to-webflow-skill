# Impeccable — detector de antipatrones (empaquetado)

Origen: https://github.com/pbakaus/impeccable — Apache License 2.0 (ver `LICENSE`).
Revision empaquetada: `63b04e2`.

## Que es y por que esta aqui

Son las 77 reglas deterministas de Impeccable, sin modificar. La Fase 1 de este harness las corre
sobre un frame de Figma a traves de `scripts/figma-shim.js`, que transpila el subarbol a HTML
sintetico con estilos en linea. El motor estatico de Impeccable no lee HTML real sino un DOM
sintetico con un `getComputedStyle` falso, asi que las reglas funcionan tal cual.

Se empaqueta en vez de clonarse en cada corrida por una razon concreta: en el piloto se clono a un
directorio temporal y **se perdio con la sesion**, dejando la medida de calidad inejecutable meses
despues. Un gate que depende de una descarga no es un gate.

El detector no tiene dependencias externas —solo builtins de `node:`— asi que 1 MB de archivos
basta para que corra sin red.

## Que mide, y que NO

Mide **calidad** (¿esta bien hecho?), no **fidelidad** (¿se parece al original?). Son ejes
distintos y hacen falta los dos: un clon puede sacar 24/24 de fidelidad replicando una porqueria.

Los tres puntos ciegos verificados del shim y la asimetria del frame raiz estan en
`references/gotchas-webflow.md` y se filtran en la corrida. **Las reglas de copy son ingles
hardcodeado** (lista `BUZZWORDS`) e inutiles para copy en espanol: no se reportan hasta que exista
una lista ES.

## Actualizar

```bash
git clone --depth 1 https://github.com/pbakaus/impeccable.git /tmp/imp
cp -R /tmp/imp/.claude/skills/impeccable/scripts/detector <este directorio>/
cp /tmp/imp/.claude/skills/impeccable/scripts/detect.mjs   <este directorio>/
```
Y despues volver a comprobar los puntos ciegos: una version nueva puede cambiar que reglas
disparan, y la lista de supresiones es lo unico que impide que el informe se llene de ruido.
