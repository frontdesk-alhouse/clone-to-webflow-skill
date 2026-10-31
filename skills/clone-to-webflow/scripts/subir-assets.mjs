#!/usr/bin/env node
/**
 * Sube a Webflow los ficheros cuyos presigned devolvio `data_assets_tool > create_asset`.
 *
 * Existe porque el Designer no esta disponible en las sesiones largas —se duerme con el
 * navegador— y `asset_tool > upload_image_by_url`, que es del Designer, deja de responder. La
 * via de datos (create_asset -> POST a S3 -> CDN) funciona sin el, pero pide subir los bytes a
 * mano; esto es esa mano.
 *
 * Uso:  node scripts/subir-assets.mjs <lote.json>
 * donde lote.json es [{ archivo, uploadUrl, uploadDetails, hostedUrl }, ...] tal cual sale de
 * la respuesta del MCP, con `archivo` anadido.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const lote = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const mapa = {};

for (const it of lote) {
  const fd = new FormData();
  // El orden importa poco, pero `file` va SIEMPRE al final: S3 ignora todo campo posterior.
  const d = it.uploadDetails;
  fd.append('acl', d.acl);
  fd.append('bucket', d.bucket);
  fd.append('X-Amz-Algorithm', d.xAmzAlgorithm);
  fd.append('X-Amz-Credential', d.xAmzCredential);
  fd.append('X-Amz-Date', d.xAmzDate);
  fd.append('key', d.key);
  fd.append('policy', d.policy);
  fd.append('X-Amz-Signature', d.xAmzSignature);
  fd.append('success_action_status', d.successActionStatus);
  fd.append('Content-Type', d.contentType);
  fd.append('cache-control', d.cacheControl);
  fd.append('file', new Blob([readFileSync(it.archivo)], { type: d.contentType }), basename(it.archivo));

  const r = await fetch(it.uploadUrl, { method: 'POST', body: fd });
  const ok = r.status === 201;
  console.log(`  ${ok ? 'ok ' : 'FALLO ' + r.status} ${basename(it.archivo)}`);
  if (ok) mapa[basename(it.archivo)] = it.hostedUrl;
}
console.log(JSON.stringify(mapa, null, 2));
