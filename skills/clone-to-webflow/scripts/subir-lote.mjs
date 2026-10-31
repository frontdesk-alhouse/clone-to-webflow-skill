#!/usr/bin/env node
/**
 * Variante compacta de subir-assets.mjs.
 *
 * Los presigned de S3 solo varian en cuatro campos (key, policy, firma, fecha); el resto es
 * constante para todo el sitio. Escribir el objeto entero por asset costaba mas contexto que
 * el trabajo mismo, asi que aqui se pasa la tupla minima y la plantilla se rellena sola.
 *
 * Uso:  node scripts/subir-lote.mjs <lote.tsv>
 * TSV:  archivo <TAB> key <TAB> policy <TAB> firma <TAB> fecha
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

// La credencial lleva la FECHA de la firma dentro. Clavarla caduca en silencio: S3 responde
// SignatureDoesNotMatch sin decir que el dia no cuadra. Se deriva de la columna `fecha`.
// Access Key ID: el prefijo de X-Amz-Credential en la respuesta de subida firmada de Webflow.
const LLAVE = process.env.WEBFLOW_S3_KEY_ID;
if (!LLAVE) { console.error("Falta WEBFLOW_S3_KEY_ID (sale de X-Amz-Credential, antes de la primera /)."); process.exit(2); }
const cred = (fecha) => `${LLAVE}/${fecha.slice(0, 8)}/us-east-1/s3/aws4_request`;
const TIPO = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

const filas = readFileSync(process.argv[2], 'utf8').trim().split('\n');
let bien = 0;

for (const fila of filas) {
  const [archivo, key, policy, firma, fecha] = fila.split('\t');
  const ct = TIPO[extname(archivo).toLowerCase()];
  const fd = new FormData();
  fd.append('acl', 'public-read');
  fd.append('bucket', 'webflow-prod-assets');
  fd.append('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  fd.append('X-Amz-Credential', cred(fecha));
  fd.append('X-Amz-Date', fecha);
  fd.append('key', key);
  fd.append('policy', policy);
  fd.append('X-Amz-Signature', firma);
  fd.append('success_action_status', '201');
  fd.append('Content-Type', ct);
  fd.append('cache-control', 'max-age=31536000');
  // `file` va SIEMPRE al final: S3 ignora todo campo posterior al fichero.
  fd.append('file', new Blob([readFileSync(archivo)], { type: ct }), basename(archivo));

  const r = await fetch('https://webflow-prod-assets.s3.amazonaws.com/', { method: 'POST', body: fd });
  if (r.status === 201) bien++; else console.log(`  FALLO ${r.status} ${basename(archivo)}\n${(await r.text()).slice(0, 300)}`);
}
console.log(`  ${bien}/${filas.length} subidos`);
