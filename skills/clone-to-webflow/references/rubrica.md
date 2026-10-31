# Rubrica

Dos niveles: la **rubrica de seccion** (score numerico, la puerta del bucle de las fases 3-4) y los
**gates de pagina G1..G6** (pasa/no pasa, fase 5). Miden cosas distintas y ninguno sustituye al otro.

---

## Clausula anti-generosidad

No vale «se parece bastante», «captura el espiritu» ni «esencialmente igual». Un script no puede
darse ese lujo, **y ese es justamente el punto**: el evaluador es codigo y no un modelo porque
contra un DOM la medicion es determinista y reproducible entre corridas. Un evaluador cualitativo
derivo 9 → 8 → 7 sobre un frame que nunca cambio, y 2 puntos de un criterio con peso 0.30 son 0.6
del total: suficiente para cruzar el umbral y disparar la regla de meseta **por ruido**.

---

## Rubrica de seccion — umbral 9.9, maximo 6 iteraciones

| Criterio | Peso | Que mide |
|---|---|---|
| paridad estructural | 0.40 | forma general, sobre la imagen reducida |
| geometria y superficie | 0.25 | pixeles distintos **fuera** de las zonas de texto |
| posicion de texto | 0.20 | sonda de tinta por nodo |
| paridad de detalle | 0.10 | cifra de reporte a resolucion completa |
| assets | 0.05 | imagenes presentes y correctas |

**Dimensiones distintas fuerzan TOTAL 0.** No se escala para comparar: si la caja no mide lo mismo,
lo que sigue no significa nada.

### Verdicts
- **PASS** — total >= umbral.
- **FAIL** — total < umbral.
- **DESVIACION** — la seccion diverge **a proposito** y esta declarada en `spec/desviaciones.json`.
  **No se le sube el score**: subirlo corrompe el instrumento. Recibe su propio verdict y su propio
  criterio de aceptacion, que se enuncia en la declaracion.

### La mascara de texto es obligatoria
`spec/sections/<sec>.<ancho>.textrects.json`. **Sin ella la geometria puntua 10 por defecto y el
gate miente.** Y va **por ancho**: en movil la seccion puede tener **otra estructura**, no solo otro
ancho. Usar los rects de escritorio pone la mascara donde no va y el gate acusa como «fuera de
texto» lo que es texto.

### Los pisos
Un piso de rasterizado solo se descuenta si esta **declarado con razon** en `spec/floors.json` y
respaldado en `KNOWN_LIMITATIONS.md`. **Un piso no declarado no existe**, para que un defecto nuevo
no se cuele escondido detras de «es antialiasing».

Un piso se declara **con evidencia**, y la evidencia tiene una forma reconocible: *un elemento
ausente deja decenas de bloques de 24x24 al 100 % de diferencia; el antialiasing no deja ninguno por
encima del 50 %.*

### Por que la ZONA y no un umbral global
El dato incomodo que fundo toda la rubrica: **el ruido de rasterizado de la tipografia (1.99 %)
supera a los defectos reales** — borde ausente 0.83 %, radio equivocado 0.17 %. **Ningun umbral
global los separa.** Lo que si los separa es la zona: fuera del texto no hay piso de rasterizado.

Los dos gates de la version anterior resultaron inservibles al medirlos: `detalle >= 97 %` deja
pasar todo —un borde de 1 px ausente puntua **99.797 %**— y «ninguna celda estructural sobre 8 %»
reprueba builds correctos, porque la peor celda de una seccion buena es 8.44 %.

---

## Gates de pagina — G1..G6

| Gate | Senal | Criterio |
|---|---|---|
| **G1** | desborde horizontal | verde en todos los anchos de `gates.desborde`, **medido RECORRIENDO** |
| **G2** | `prefers-reduced-motion` | respetado en todas las secciones |
| **G3** | propiedades animadas | solo `opacity` y `transform` |
| **G4** | imagenes | ninguna rota, en dos anchos, **recorriendo** y solo sobre lo visible |
| **G5** | copy | sin residuo del clon donante |
| **G6a** | geometria y superficie fuera de zonas de texto | **0 px** |
| **G6b** | posicion de texto, sonda de tinta por nodo | **<= 1 px** |

Estructural y detalle globales son **cifras de reporte, no compuerta**.

### Dos advertencias metodologicas que ya costaron verdes falsos
- **El desborde en reposo miente.** Una home daba **0 px parada y 54 px recorriendola**. El
  movimiento saca fuera del marco elementos que en reposo estaban dentro. Todo chequeo de desborde
  estatico anterior estaba midiendo mal.
- **Las imagenes se comprueban recorriendo.** Con `loading="lazy"`, sin llegar a ellas dan
  `naturalWidth 0` y el gate estaria mintiendo. Y una imagen lazy dentro de un `display:none` **no
  dispara ni `load` ni `error`**, asi que esperarlas cuelga el gate para siempre: hay que acotar.

### Lo que se anade a los gates — y con que script
Durante meses estos cinco fueron prosa. Dos ya tenian script (regresion, regimen) y tres no. Ahora:

| Gate | Script | Que caza |
|---|---|---|
| **Orden real de secciones por `y`** | `scripts/gate-orden.mjs` | el DOM trae escritorio primero y movil despues; si el motion fija una seccion, el `order` va al **envoltorio del Embed**, no a la seccion. Compara contra `spec/orden.json` (o el contrato si dice `secciones_en_orden: true`); sin orden declarado **propone** el que mide y sale con exit 2 |
| **Corte de banda limpio** | `responsive-webflow/scripts/gate-banda.mjs` | **busca por biseccion** donde conmuta cada pieza. Un par 767/768 no ve el fallo: a los dos lados la nav puede ser la misma y el problema vivir en 991. Las dos piezas del mismo rol conmutan juntas; cada conmutador cae en un limite declarado |
| **Continuidad** | `responsive-webflow/scripts/barrido-continuidad.mjs` | el caso Mac: a cualquier ancho, nada brinca. Segmenta por regimen, residuo contra MAD (piso 4 px), biseca fronteras y las contrasta con los cortes. Distingue **saturacion** (un `max-width` que llega a su tope: continuo, INFO) de **discontinuidad** (brinca: HIGH) |
| **Sin regresion** | `scripts/foto-sitio.mjs comparar antes despues` | lo que se movio es lo que se pretendia mover |
| **Regimen declarado** | `scripts/audita-regimen.mjs` (envuelto por `responsive-webflow/scripts/regimen-multiancho.mjs` para todas las bandas) | una seccion sin regimen en `spec/regimen.json` **no pasa** |
| **Accesibilidad / higiene + schema** | skills `accessibility-audit`, `ah-seo-schema` | |

**Los anchos de todos estos gates salen de `responsive-out/plan-anchos.json`**, derivado del sitio
(barrido + cortes + contrato) y con huella. La lista a mano de `gates.desborde` es respaldo, y
cuando se usa se dice `POR_DEFECTO`.

### Regla forense de los pisos
**Un piso solo se declara con evidencia** en `spec/floors.json`, y antes hay que descartar que
esconda un elemento ausente: **un elemento que falta deja decenas de bloques de 24×24 al 100 % de
diferencia; el antialiasing no deja ninguno por encima del 50 %.** Si el mapa de diferencias tiene
bloques al 100 %, no es un piso: es algo que no esta.

---

## El instrumento se valida antes que el sujeto

`npm run selftest` → **`INSTRUMENTO 22/22 VALIDADO`** o el comando para. Firma del evaluador:

```
identica 10/10 · dimensiones 0/10 · borde ausente 8.63 · radio 12→4 9.5 · offset 20px 5.0 · solo AA 10/10
```

Los cuatro del medio **deben fallar**: de nada sirve que el canal de detalle ignore el ruido de
rasterizado si tambien es ciego a un error real. **Tiene que discriminar, no tolerar.**

Y el corolario que ahorra iteraciones enteras:

> **Un FAIL persistente no significa que el build este mal. Sospecha del instrumento antes de gastar
> otra iteracion de construccion.**

Dos secciones de un proyecto real subieron **7.5 → 9.1** y **7.6 → 9.2** sin tocar un solo nodo, solo
arreglando los insumos de evaluacion.

## G7 · Imagenes a sangre — `gate-imagenes.mjs`

| Check | Que mide | FAIL si |
|---|---|---|
| I1 | borde en el elemento de imagen (img, picture, background-image, clases foto/thumb/retrato) | algun lado con `border-style != none` y ancho > 0 |
| I2 | outline | visible con ancho > 0 |
| I3 | padding en `<img>` | cualquier lado > 0 |
| I4 | `object-fit: contain` con fondo visible | bandas >= 2 px |

Por que: el placeholder de imagen de Figma suele traer un stroke gris de 1 px que el port copia
como `border`. La paridad no lo cobra porque el frame lo tiene igual; el cliente lo ve como
«margenes grises». Se mide en el navegador con `getComputedStyle`.

## G8 · Lineas de extremo a extremo — `gate-lineas.mjs`

| Check | Que mide | FAIL si |
|---|---|---|
| L1 | rayas horizontales (borde arriba/abajo, box-shadow inset, o elemento <= 2 px con fondo) de ancho >= 40 % de la ventana | bajo 992 px no tocan 0 y W; desde 992 no tocan las lineas de margen ni la ventana |

Excluye cajas con bordes laterales y su contenido (el navbar si se mide), botones y campos, y lo
que liste `harness.config.json › lineas.ignora` (carruseles que desbordan a proposito).

Por que: en movil la raya hereda el padding de la seccion y queda a 20 px del borde; el navbar
flota con su franja. La paridad no lo cobra si el frame tiene la misma sangria, y en una captura
chica pasa. El arreglo tipico: la fila sale con margen negativo y recupera el texto con padding.

**I5 · seccion sin foto** (agregado 2026-10-15). Una `<section>` que a 1920 muestra al menos una
imagen y en el ancho medido no muestra ninguna: FAIL. Se compara contra una segunda pestaña a 1920.
Por que: una clase de imagen compartida que una pagina oculta bajo un corte (porque usa variantes
-m/-t propias) deja en negro el hero de las paginas que no tienen variantes, y en una captura chica
se lee como «foto oscura». Correr el gate tambien con `--ancho 390` y `--ancho 768`.

## G9 · Anclas sin estado de pagina actual — `gate-ancla-actual.mjs`

Por cada enlace del navbar con `#` cuyo destino existe en la pagina, lleva el destino a pantalla
y compara el enlace con la pagina arriba del todo. FAIL si cambia el fondo o si la letra queda del
color de su fondo. Por que: webflow.js marca `w--current` por scroll spy en los enlaces a ancla, y
el estilo de «pagina actual» del navbar se les aplica a mitad de pagina. Todos los demas gates miden
con la pagina arriba y no lo ven.

## G10 · Navbar legible fuera del hero — `gate-nav-solido.mjs`

En paginas con `.vu-hero`, baja dos pantallas y exige que `.vu-nav` gane `.is-solid` y que los enlaces
no queden claros sobre el fondo crema. Por que: `create_page` con `duplicateOf` copia el cuerpo pero no
el codigo de head ni el de footer; el script que alterna `.is-solid` vive en el footer. Medido en
Cliente B: 6 paginas de proyecto con el navbar invisible al hacer scroll.
