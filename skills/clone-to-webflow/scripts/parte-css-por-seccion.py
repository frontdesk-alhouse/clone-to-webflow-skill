#!/usr/bin/env python3
"""Parte el CSS de Pricing en dos capas, por seccion.

  nativo/<sec>.css  ->  reglas de CLASE PLANA. Es lo que se le pasa a `data_whtml_builder`
                        en el parametro `css`, y Webflow las convierte en Clases reales,
                        visibles y editables en el panel de estilos del Designer.
  embed/<sec>.css   ->  lo que el motor de estilos de Webflow NO sabe escribir y por tanto
                        tiene que seguir viviendo en un Embed.

Que se queda en el Embed, y por que:
  · selectores de descendencia (`.vt-pp__feat span`) — `whtml_builder` RECHAZA la insercion
    entera si aparece uno: "Nested selectors are not allowed. StyleParser drops descendant
    selectors."
  · atributos y pseudo (`[hidden]`, `::before`) — mismo motivo.
  · custom properties y `var()` — el builder las resuelve a literales (KL-30).
  · las dos media queries del conmutador de breakpoint.
  · el reset. `gen-pricing-css.py` descarta el `*{margin:0;padding:0;box-sizing:border-box}`
    de los builds locales, y Webflow trae su propio normalize con `p{margin-bottom:10px}`.
    Eso es lo que corria 10 px cada parrafo del hero publicado. Va SCOPED al envoltorio para
    no tocar el resto del sitio.
"""
import re, pathlib, sys

SECS = ['pr-hero', 'pr-planes', 'pr-todo', 'pr-faq', 'pr-cta',
        'mpr-hero', 'mpr-planes', 'mpr-todo', 'mpr-faq', 'mpr-cta']

RAIZ = pathlib.Path('build/webflow/pricing')
(RAIZ / 'nativo').mkdir(parents=True, exist_ok=True)
(RAIZ / 'embed').mkdir(parents=True, exist_ok=True)

SEL_PLANO = re.compile(r'^(\.[A-Za-z0-9_-]+)+$')


def reglas(css):
    """Trocea CSS de primer nivel en (selector, cuerpo). Los bloques @ salen aparte."""
    i, out, ats = 0, [], []
    while i < len(css):
        if css[i].isspace():
            i += 1
            continue
        if css[i] == '@':
            j = css.index('{', i)
            k, hondo = j, 0
            while True:
                if css[k] == '{':
                    hondo += 1
                elif css[k] == '}':
                    hondo -= 1
                    if hondo == 0:
                        break
                k += 1
            ats.append(css[i:k + 1])
            i = k + 1
            continue
        j = css.find('{', i)
        if j < 0:
            break
        k = css.find('}', j)
        sel, cuerpo = css[i:j].strip(), css[j + 1:k].strip()
        if sel:
            out.append((sel, cuerpo))
        i = k + 1
    return out, ats


def es_plano(sel, cuerpo):
    # var()/custom property -> el builder lo hornea a literal, no sirve nativo
    if '--' in cuerpo.split(':')[0] or 'var(' in cuerpo:
        return False
    if re.search(r'(^|;)\s*--[A-Za-z0-9_-]+\s*:', ';' + cuerpo):
        return False
    return all(SEL_PLANO.match(s.strip()) for s in sel.split(','))


def limpia(css):
    css = re.sub(r'\s*\*\{[^}]*\}', '', css)
    css = re.sub(r'\s*body\{[^}]*\}', '', css)
    return css


def sin_comentarios(css):
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def minifica(t):
    t = sin_comentarios(t)
    t = re.sub(r'\s*([{};:,>])\s*', r'\1', t)
    t = re.sub(r';}', '}', t)
    return re.sub(r'\s+', ' ', t).strip()


# OJO con la especificidad. El primer intento fue `.vt-pri *{margin:0;padding:0}`, que pesa lo
# MISMO que una clase (0,1,0) y, al vivir en un Embed del body, gana por orden de aparicion: se
# comio el padding de 24 de las tarjetas y el de 12 de las filas, y `pr-todo` cayo a 2.68/10.
# Con :where() el selector pesa 0,0,1 — le gana al normalize de Webflow (p{margin-bottom:10px})
# por orden y pierde contra CUALQUIER clase nativa, que es justo lo que hace falta.
# `box-sizing` no se toca: Webflow ya hereda border-box desde html.
RESET = (
    '/* El reset que los builds locales dan por hecho y Webflow no. Va con :where() por\n'
    '   especificidad — ver el comentario del generador. */\n'
    ':where(.vt-pri) p{margin:0}\n'
    '/* El suavizado en gris lleva prefijo de proveedor y update_style lo rechaza. */\n'
    '.vt-pri{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}\n'
)

CONMUTADOR = """
@media (max-width:767px){
  .vt-ph,.vt-pp,.vt-pt,.vt-pf,.vt-pc{ display:none !important }
  .vt-mph,.vt-mpp,.vt-mpt,.vt-mpf,.vt-mpc{ display:block !important }
}
@media (min-width:768px){
  .vt-mph,.vt-mpp,.vt-mpt,.vt-mpf,.vt-mpc{ display:none !important }
}
"""

resto_total, resumen = [], []
for n in SECS:
    bruto = pathlib.Path(f'build/local/{n}.html').read_text()
    css = limpia(re.search(r'<style>(.*?)</style>', bruto, re.S).group(1))
    rs, ats = reglas(sin_comentarios(css))

    planas, resto = [], []
    for sel, cuerpo in rs:
        if not cuerpo:
            continue
        if es_plano(sel, cuerpo):
            # se expanden las listas por coma: una regla por clase, que es como las
            # guarda Webflow de todos modos
            for s in sel.split(','):
                planas.append(f'{s.strip()}{{{cuerpo}}}')
        else:
            resto.append(f'{sel}{{{cuerpo}}}')
    resto += ats

    (RAIZ / 'nativo' / f'{n}.css').write_text(minifica('\n'.join(planas)))
    (RAIZ / 'embed' / f'{n}.css').write_text('\n'.join(resto))
    if resto:
        resto_total.append(f'/* {n} */\n' + '\n'.join(resto))
    resumen.append((n, len(planas), len(resto)))

# En local los iconos son <img> a un .svg; en Webflow van INLINE como <svg>. La regla que los
# dimensiona tiene que valer para los dos.
hoja_embed = RESET + '\n'.join(resto_total) + '\n' + CONMUTADOR
for sel in ('.vt-pp__feat', '.vt-mpp__feat', '.vt-pc__mark', '.vt-mpc__mark'):
    hoja_embed = hoja_embed.replace(f'{sel} img{{', f'{sel} img, {sel} svg{{')

(RAIZ / 'embed' / '_pricing-embed.css').write_text(hoja_embed)

# El tope de un Embed de Webflow son 10 000 caracteres. El corte va SIEMPRE en limite de
# regla: partir dentro de una declaracion la anula entera.
mini, trozos, act = minifica(hoja_embed), [], ''
for pieza in re.findall(r'@media[^{]*\{(?:[^{}]|\{[^}]*\})*\}|[^{}]+\{[^}]*\}', mini):
    if len(act) + len(pieza) > 9500:
        trozos.append(act)
        act = ''
    act += pieza
if act:
    trozos.append(act)
for idx, t in enumerate(trozos, 1):
    (RAIZ / 'embed' / f'embed{idx}.txt').write_text(t)

print(f'{"seccion":<12} {"nativas":>8} {"al embed":>9}')
for n, a, b in resumen:
    print(f'{n:<12} {a:>8} {b:>9}')
print(f'\nembed final: {len(mini)} car. en {len(trozos)} trozo(s) '
      f'(antes: 22 000 en 3)')
