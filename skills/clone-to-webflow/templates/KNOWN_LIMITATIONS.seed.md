# Limitaciones conocidas — {{CLIENTE}}

Este archivo es **la memoria del bucle**. Las entradas de aqui entran a los prompts de evaluacion
como `<accepted_limitations>` y **no se re-cobran**: sin eso, cada iteracion redescubre lo ya
resuelto y deja secciones en meseta por hallazgos sin solucion.

**Regla de escritura:** una entrada se anade cuando algo se adjudica, con su evidencia y su numero.
Una sospecha no es una entrada. Y cuando una correccion revela que un gate era ciego, la entrada
dice **cual es el gate nuevo** que ahora lo caza.

Las KL-000 son universales de Webflow y vienen ya adjudicadas: **no las vuelvas a pagar.** El
detalle completo esta en `references/gotchas-webflow.md`. La numeracion propia del proyecto empieza
en KL-100.

---

## KL-001 · `data_whtml_builder` aborta la insercion entera con un selector anidado
No la degrada: la aborta. Cura: partir la hoja — clase plana al parametro `css`, lo anidado a un
Embed. **Adjudicada.**

## KL-002 · Sin el parametro `css`, el builder borra las clases que ese CSS no declara
Y con ellas el elemento si es un `<span>` suelto, texto incluido. Toda etiqueta de texto necesita
una clase declarada. **Adjudicada.**

## KL-003 · `missing_font` es ruido: la propiedad si se escribe
**Adjudicada.** No investigar de nuevo.

## KL-004 · `update_style` rechaza propiedades con prefijo de proveedor
Y tumba el lote entero. Esas reglas viven en el Embed. **Adjudicada.**

## KL-005 · El reset se traduce, no se copia
`:where(.pfx) p { margin:0 }` (0,0,1), no `.pfx *{}` (0,1,0). `box-sizing` no hace falta.
**Adjudicada.**

## KL-006 · Un `border-radius` vinculado no sobrevive a los cuatro longhands
`remove_properties` de los cuatro en la misma llamada. Comprobar en el CSS publicado. **Adjudicada.**

## KL-007 · El `cssName` de una Variable no se adivina
Se lee de la respuesta de creacion y se registra antes de escribir un `var()`. **Adjudicada.**

## KL-008 · `data_element_builder` pierde tipo y texto a profundidad >= 2
Crear arboles de dos niveles como mucho. **Adjudicada.**

## KL-009 · `visibility:false` elimina el elemento del HTML publicado
Usar la clase de ocultamiento. **Adjudicada.**

## KL-010 · `overflow-x: clip` tiene que ir en `html` Y en `body`
Y `clip`, no `hidden`. **Adjudicada.**

## KL-011 · El desborde se mide recorriendo, no en reposo
Un chequeo estatico da verdes falsos. **Adjudicada.**

## KL-012 · El nombre de la hoja nativa lleva un hash que cambia en cada publicacion
Cualquier huella que lo incluya marcaria deriva en cada publish. Ya lo normaliza
`detecta-deriva.mjs`. **Adjudicada.**

## KL-013 · `*.design.webflow.com` no sirve el sitio publicado
Verificar contra `{shortName}.webflow.io` con `curl`, nunca contra la respuesta de la API.
**Adjudicada.**

## KL-014 · No existen `create_folder` ni `delete_page`
Las carpetas se crean a mano; las paginas se crean **solo con slug cerrado**. **Adjudicada.**

## KL-015 · El MCP no expone IX2 y el codigo libre exige Site Plan de pago
Todo el movimiento va en codigo libre; `set_site_freeform_code` da 404 en gratuito.
`register_inline_script` topa en 2.000 caracteres. **Adjudicada.**

## KL-016 · El archivo del repo no es la verdad si la hoja se edito en vivo
Comparar declaracion a declaracion contra el `<style>` publicado antes de regenerar. **Adjudicada.**

## KL-017 · Los assets se suben de uno en uno
El orden de respuesta no esta garantizado y ya provoco un intercambio de fotos. **Adjudicada.**

## KL-018 · Puntos ciegos del shim de calidad
`cramped-padding`, `low-contrast` sobre vidrio, `tiny-text`/`undersized-ui-text`, y las reglas de
copy en ingles. Ya suprimidos por `audita-calidad.mjs`. **Adjudicada.**

## KL-019 · El frame raiz necesita fill o el detector omite el contraste entero
Un informe sin fondo resoluble sale absuelto de algo que nadie ha mirado. **Adjudicada.**

## KL-020 · Codex infiere la vinculacion de tokens de valores resueltos
8 de 8 nodos declarados hardcodeados estaban enlazados. Se adjudica con un tree walk de
`boundVariables` **antes** de mandar reparar. **Adjudicada.**

---

# Del proyecto

<!-- KL-100 en adelante. Formato:
## KL-1xx · <titulo en una linea>
Que se observo, como se midio, que se decidio, y —si venia de una correccion— que gate nuevo lo caza.
-->
