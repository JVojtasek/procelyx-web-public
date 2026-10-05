import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

export function cleanWebpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  let dimensions = null;
  let imageChunks = 0;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) return null;
    const kind = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length || ["EXIF", "XMP ", "ICCP", "ANIM", "ANMF"].includes(kind)) return null;
    if (kind === "VP8X") {
      if (size !== 10 || (bytes[data] & 0x2e) !== 0) return null;
      dimensions = { width: bytes.readUIntLE(data + 4, 3) + 1, height: bytes.readUIntLE(data + 7, 3) + 1 };
    } else if (kind === "VP8 ") {
      if (size < 10 || bytes.toString("hex", data + 3, data + 6) !== "9d012a") return null;
      imageChunks++;
      const frame = { width: bytes.readUInt16LE(data + 6) & 0x3fff, height: bytes.readUInt16LE(data + 8) & 0x3fff };
      if (dimensions && (dimensions.width !== frame.width || dimensions.height !== frame.height)) return null;
      dimensions = frame;
    } else if (kind === "VP8L") {
      if (size < 5 || bytes[data] !== 0x2f) return null;
      imageChunks++;
      const bits = bytes.readUInt32LE(data + 1);
      const frame = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      if (dimensions && (dimensions.width !== frame.width || dimensions.height !== frame.height)) return null;
      dimensions = frame;
    } else if (kind !== "ALPH") return null;
    offset = data + size + (size % 2);
    if (offset > bytes.length) return null;
  }
  return imageChunks === 1 ? dimensions : null;
}


export const assetPath = (id) => `/images/nexus/${id.slice(10)}.webp`;

/** Approved raster bytes travel in the article JSON; no remote downloads or arbitrary paths. */
export function articleAssetErrors(d) {
  const errors = [], seen = new Set(), referenced = new Set([d.image?.mediaId, ...(d.figures || []).map(f => f.mediaId)]);
  let total = 0;
  for (const a of d.assets || []) {
    if (!/^img-nexus-[a-f0-9]{64}$/.test(a.mediaId) || a.mime !== 'image/webp') { errors.push('invalid asset identity or MIME'); continue; }
    if (seen.has(a.mediaId)) errors.push('duplicate asset');
    seen.add(a.mediaId);
    const bytes = Buffer.from(a.dataBase64, 'base64');
    total += bytes.length;
    if (!bytes.length || bytes.length > 450000 || bytes.toString('base64') !== a.dataBase64) errors.push('invalid or oversized base64 asset');
    if (createHash('sha256').update(bytes).digest('hex') !== a.mediaId.slice(10)) errors.push('asset SHA256 mismatch');
    try {
      const size = cleanWebpDimensions(bytes);
      if (!size || size.width !== a.width || size.height !== a.height || Math.abs(a.width / a.height - 16 / 9) > 0.06 * (16 / 9)) errors.push('asset dimensions or format mismatch');
    } catch { errors.push('unsupported asset bytes'); }
    if (!referenced.has(a.mediaId)) errors.push('unreferenced asset');
  }
  if (total > 1500000) errors.push('article assets exceed 1.5 MB');
  const sections = (d.bodyHtml.match(/<h2(?:\s|>)/gi) || []).length;
  for (const f of d.figures || []) {
    if (f.mediaId.startsWith('img-nexus-') && !seen.has(f.mediaId)) errors.push('figure asset missing');
    if (f.kind === 'infographic' && Buffer.from((d.assets || []).find(a => a.mediaId === f.mediaId)?.dataBase64 || '', 'base64').length > 250000) errors.push('infographic exceeds 250 KB');
    if (f.afterSection > sections) errors.push('figure refers to a missing section');
  }
  if (d.image?.mediaId.startsWith('img-nexus-') && !seen.has(d.image.mediaId)) errors.push('hero asset missing');
  return [...new Set(errors)];
}

export function assetImage(d, mediaId, alt) {
  const a = (d.assets || []).find(a => a.mediaId === mediaId);
  return a ? {path: assetPath(a.mediaId), ogPath: assetPath(a.mediaId), width: a.width, height: a.height, alt} : null;
}

/** Call only after schema and content validation. Hashed files are immutable and shared safely. */
export function writeArticleAssets(root, d) {
  const errors = articleAssetErrors(d);
  if (errors.length) throw new Error(errors.join('; '));
  for (const a of d.assets || []) {
    const path = resolve(root, 'public', assetPath(a.mediaId).slice(1));
    mkdirSync(resolve(root, 'public/images/nexus'), {recursive: true});
    writeFileSync(path, Buffer.from(a.dataBase64, 'base64'));
  }
}
