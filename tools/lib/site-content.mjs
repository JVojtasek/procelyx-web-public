// Loading content/** and generating the media library. Shared by build, validate-content and tests.
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {imageSize} from './image-size.mjs';

export const RASTER = /\.(jpg|jpeg|png|webp)$/i;

/** Stable media ID of a public image path: "/images/articles/a-b.webp" -> "img-articles--a-b-webp". */
export function mediaIdFor(path) {
  return 'img-' + path.replace(/^\/images\//, '').toLowerCase().replace(/\//g, '--').replace(/[^a-z0-9-]+/g, '-');
}

/** Every raster file under public/images as {mediaId: {path, width, height}}, sorted by ID. SVG is never offered. */
export function buildMediaLibrary(root) {
  const dir = resolve(root, 'public/images');
  const entries = [];
  for (const rel of readdirSync(dir, {recursive: true})) {
    const path = '/images/' + String(rel).split(/[\\/]/).join('/');
    // Approved article bytes are derived build output, referenced by their
    // own img-nexus SHA256 identities. They are not shared editable media.
    if (path.startsWith('/images/nexus/')) continue;
    if (!RASTER.test(path)) continue;
    const {width, height} = imageSize(readFileSync(join(dir, String(rel))));
    entries.push([mediaIdFor(path), {path, width, height}]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const ids = new Set(entries.map(([id]) => id));
  if (ids.size !== entries.length) throw new Error('media library: two images map to the same mediaId');
  return Object.fromEntries(entries);
}

const readJson = (root, rel) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

/** All content files. `library` is read from content/media-library.json (the build regenerates it first). */
export function loadContent(root) {
  return {
    site: readJson(root, 'content/site.json'),
    i18n: {cs: readJson(root, 'content/i18n/cs.json'), en: readJson(root, 'content/i18n/en.json')},
    media: readJson(root, 'content/media.json'),
    library: existsSync(resolve(root, 'content/media-library.json')) ? readJson(root, 'content/media-library.json') : buildMediaLibrary(root),
    manifest: readJson(root, 'content/manifest.json'),
  };
}

export function allSlots(manifest) {
  return manifest.pages.flatMap((page) => page.sections.flatMap((section) => section.slots.map((slot) => ({page, section, slot}))));
}
