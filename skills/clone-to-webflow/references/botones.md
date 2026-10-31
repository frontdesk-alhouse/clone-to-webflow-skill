# Botones

## Forma

Radio **por pieza**, no por escala de superficie: **el mismo numero en todos los anchos**
(`radios.piezas` del config). Valores de referencia: `btn` 12 · `capsula` 16 · `nav-pill` 16 ·
`chip` 5.

Si el boton va esquinado dentro de una caja, **el radio de la caja sale de la regla concentrica**:
`radio_caja = radio_boton + separacion`. Ver `reglas-de-sistema.md` §1(c).

## Estados — los cuatro, y el que siempre falta

| Estado | Obligatorio | Nota |
|---|---|---|
| reposo | si | |
| hover | si | |
| focus-visible | si | teclado; no se sustituye por el de hover |
| **presionado** (`:active`) | **si** | **en tactil el hover no existe**: sin `:active` el boton no da ninguna respuesta al dedo |

El presionado es el que se olvida porque en un raton parece redundante. En un telefono es el **unico**
feedback que hay.

## Variantes

Una clase base + un combo por tono. El texto **nunca** viaja en el nombre de la clase.

```
<pfx>-btn                 forma, tipografia, estados
<pfx>-btn--primary        el tono de accion
<pfx>-btn--ghost          sobre superficie
<pfx>-btn--sobre-oscuro   inversion para bandas oscuras
```

## El doble contorno

Es la firma visual del sistema y **no son dos `border`**: es un borde mas dos sombras.

```css
border: 1px solid <acento>;
box-shadow: 0 8px 22px -8px rgb(15 26 33 / .14),   /* sombra real  */
            0 0 0 3px <halo>;                       /* halo exterior */
border-radius: 12px;
```

Tres gotchas medidos:
- **El orden de las sombras es INVERSO al de CSS** cuando se traduce desde Figma.
- **Una sombra con `spread` no se ve si el marco no recorta.**
- **Un halo de radio 0 solo se pinta si el frame recorta.**

## Auditoria

El gate de detalle mide **fuera de las zonas de texto**, y **las etiquetas diminutas dentro de
botones quedan fuera de la mascara**: un boton pequeno puede acusar diferencia de «superficie» que
en realidad es su propio texto. Cuando pase, comprobarlo antes de tocar el boton.

Y una regla de composicion que ya costo una iteracion: cuando hay pastilla y contenido,
**la pastilla tiene que ser la caja EXTERIOR**.
