---
description: Porta un diseno de Figma a Webflow con auditoria de diseno previa, scorer determinista y publicacion solo a staging. Con --sitio-existente entra por la linea base de un sitio ya publicado (lo que hacia /figma-to-webflow). Se reabre con --corregir.
---

Carga el skill `clone-to-webflow` y sigue su contrato. Este archivo solo orquesta.

Parsea de $ARGUMENTS:
1. `pagina` — (opcional) que pagina portar. Sin ella, la primera de `paginas` del config.
2. `--anchos 390,768,1440` — (opcional, por defecto los de `anchos`) anchos a medir.
3. `--umbral 9.9` — (opcional, por defecto el de `umbral`).
4. `--max-iter 6` — (opcional, por defecto el de `maxIter`).
5. `--solo-auditar` — para despues de la Fase 1. No escribe nada en Webflow.
6. `--corregir "<texto>"` — entra por la Fase 8 con esa correccion.
7. `--reentrada` — entra por la Fase 8 sin correccion concreta: solo detectar deriva y re-verificar.
8. `--council` — fuerza el council de la Fase 1 aunque las mediciones salgan limpias.
9. `--seccion <etiqueta>` — limita las fases 3-4 a esa seccion.
10. `--sitio-existente` — el sitio ya esta publicado y se va a MODIFICAR, no a construir de cero:
    entra por la Fase 1b (linea base), se salta la Fase 2 (pagina base), la Fase 1 informa sin
    bloquear si hay frame y se salta si no lo hay. Es lo que antes hacia `/figma-to-webflow`.
11. `--saltar-referencias` — reutiliza los PNG de `reference/` en vez de reexportarlos de Figma.
12. `--etapa <figma|escritorio|movil|tablet|responsividad>` — que banda del playbook se trabaja. Sin
    ella, la que `playbook.mjs estado` da como siguiente para esa pagina.
13. `--estado` — imprime el tablero del playbook y termina. No toca nada.

## Antes de empezar

Localiza `harness.config.json` subiendo desde el directorio actual. Si no aparece, **para** y dile
al usuario que copie la plantilla; no inventes un sitio por defecto.

Lee `KNOWN_LIMITATIONS.md`, `spec/floors.json`, `spec/desviaciones.json` y `spec/regimen.json` si
existen. Lo adjudicado entra a los prompts como `<accepted_limitations>` y **no se re-cobra**.

El motor vive en `~/.claude/skills/clone-to-webflow/scripts/` y se invoca **desde la carpeta del
cliente**.

## La compuerta del playbook (antes de cualquier fase que escriba)

El orden es **figma → escritorio → movil → tablet → responsividad**, por pagina
(`references/playbook-por-bandas.md`). Antes de tocar Webflow:

```bash
P=~/.claude/skills/clone-to-webflow/scripts/playbook.mjs
node $P estado --pagina <pagina>
node $P puede <etapa> --pagina <pagina>     # exit 1 → PARA
node $P abre  <etapa> --pagina <pagina>
```

- Si `puede` sale con 1, **para** y dile al usuario exactamente que falta: que aprobado o que frame de
  Figma. No adelantes trabajo de esa banda «mientras tanto» y no escribas reglas de una banda que no
  esta abierta.
- `aprueba` se corre **solo** cuando el usuario aprueba con palabras esa banda de esa pagina. Un PASS
  de gate, un «se ve bien» de pasada o la aprobacion de un plan no lo son. Nunca con `--por` tuyo.
- Al abrir una etapa con bandas ya aprobadas: `foto-sitio.mjs antes`. Al cerrarla: `comparar`.
- Con `--sitio-existente`, si `spec/playbook-estado.json` no existe, lo primero es reconstruir el
  tablero con el usuario: que bandas de que paginas da por aprobadas (`aprueba … --retroactivo
  --fecha … --fuente …`). Solo lo que conste o el confirme.
- `--corregir` sobre una banda aprobada empieza por `reabre <etapa> --motivo "…"`.

## Ruta normal

Ejecuta las fases 0 a 7 del SKILL en orden, **para la etapa abierta** (tabla «El orden por bandas» del SKILL: en
escritorio no se escribe movil, y la Fase 5 completa con `responsive-webflow` es la etapa de responsividad). Con `--sitio-existente`, la tabla «Los dos modos de
entrada» del SKILL dice que fase se corre, se salta o cambia de caracter; la Fase 5 es completa en
los dos modos. Tres cosas que no se negocian:

- **Fase 0 para el comando si el instrumento no da `INSTRUMENTO 22/22 VALIDADO`.** No sigas «a ver
  si sale».
- **Fase 1 es un gate bloqueante.** Con un FAIL de diseno abierto no se toca Webflow. Reconcilia
  antes de medir.
- **Publicar solo a staging.** `publishToWebflowSubdomain: true, customDomains: []`. Publicar a
  produccion se le pide al usuario y se espera su respuesta; no se asume.

Con `--solo-auditar`, termina tras la Fase 1 (o tras la 1b con `--sitio-existente`) y entrega el
informe. No escribas en Webflow.

**Los anchos no se escriben a mano.** Antes de la Fase 5 se corren `conmutadores`, `barrido-continuidad`
y `plan-anchos` de `responsive-webflow` (ver Fase 5 del SKILL); los gates leen ese plan. Si no
existe, caen a `gates.desborde` del config y lo dicen: `POR_DEFECTO`.

## Ruta de correccion (`--corregir` / `--reentrada`)

Fase 8 del SKILL, **y el orden de los pasos es lo que la hace segura**:

0. `detecta-deriva.mjs`. Si cambio algo que no cambio el harness, **lo cambio el usuario**: su
   cambio es la nueva verdad, se incorpora al spec y se repinta el frame. **Nunca se revierte.**
1. `foto-sitio.mjs antes` — linea base nueva.
2. **Extiende el gate ANTES de arreglar.** Si el gate dio PASS donde el usuario ve un defecto, el
   gate tiene un punto ciego: escribe el check nuevo y **comprueba que falla** contra el estado
   actual. Si no falla, el gate no sirve y no avances. Este paso no se salta.
3. Re-corre: diseno → Fase 1 completa; implementacion → Fases 3-4 solo en lo tocado; **Fase 5
   siempre completa**.
4. `foto-sitio.mjs comparar antes despues`.
5. Adjudica en `KNOWN_LIMITATIONS.md` (defecto medible, con el gate que ahora lo caza) o en
   `spec/desviaciones.json` (criterio del usuario — **sin subir el score**).

## Como reportar

Al terminar, una tabla seccion / antes / despues / nota, el estado de G1..G6, las desviaciones
declaradas, y **lo que quedo abierto con su numero**. Un numero que no se puede reproducir no es un
numero, y lo que no se logro se dice.
