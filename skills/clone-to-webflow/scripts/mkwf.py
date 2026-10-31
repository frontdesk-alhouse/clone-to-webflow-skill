#!/usr/bin/env python3
"""Genera la copia de verificacion <nombre>.wf.html: el mismo build, pero bajo el reset REAL
de Webflow. Existe porque publicar sin este paso ya costo una seccion entera: el reset del
sitio trae `p{margin-bottom:10px}` y `line-height:20px` heredado del body, y `*{margin:0}`
pierde por especificidad contra un selector de tipo."""
import sys, re, pathlib
src = pathlib.Path(sys.argv[1]); dst = src.with_suffix('').with_suffix('') 
dst = src.parent / (src.name.replace('.html', '.wf.html'))
s = src.read_text()
s = s.replace('<style>', '<link rel="stylesheet" href="webflow-reset.css">\n<style>', 1)
s = s.replace('*{ margin:0; padding:0; box-sizing:border-box }',
              '*{box-sizing:border-box}\n  body,section{margin:0;padding:0}')
dst.write_text(s)
print(dst)
