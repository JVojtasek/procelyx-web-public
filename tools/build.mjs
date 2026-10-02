import { readFile, writeFile, readdir } from 'node:fs/promises';
import { load } from 'cheerio';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { buildMediaLibrary, loadContent } from './lib/site-content.mjs';
import { applyContent } from './inject.mjs';
import { validateContent } from './validate-content.mjs';
import { renderArticles } from './lib/articles.mjs';
const root = resolve(import.meta.dirname, '..');
// Content lives in content/** (texts, identity, media, manifest nexus.site.v1). The media library is
// generated from public/images (raster files only), so image slots can point only to existing files.
await writeFile(resolve(root,'content/media-library.json'),JSON.stringify(buildMediaLibrary(root),null,2)+'\n');
const content = loadContent(root);
const problems = validateContent(root, content);
if (problems.length) { console.error('Content validation failed:\n- '+problems.join('\n- ')); process.exit(1); }
const config = content.site;
// Articles published from Nexus One (content/articles/*.json, contract nexus.article.v1): pages, list cards and sitemap entries are generated here,
// before the post-processing below, and are not committed (Workers Builds renders them on every deploy).
renderArticles(root, {site: config, library: content.library});
const manifestPages = new Map(content.manifest.pages.map(page => [page.file, page]));
const vcardEscape=value=>String(value).replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(';','\\;').replaceAll(',','\\,');
const nameParts=config.founderName.trim().split(/\s+/);
const family=nameParts.pop(),given=nameParts.join(' ');
await writeFile(resolve(root,'public/jaroslav-vojtasek.vcf'),[
  'BEGIN:VCARD','VERSION:3.0',`N:${vcardEscape(family)};${vcardEscape(given)};;;`,
  'FN:'+vcardEscape(config.founderName),'ORG:PROCELYX',
  'TEL;TYPE=WORK,VOICE:'+config.phone.replaceAll(' ',''),'EMAIL;TYPE=WORK:'+config.email,
  'URL:https://procelyx.cz/','END:VCARD',''
].join('\r\n'));
const {businessSeat, ...browserConfig}=config;
await writeFile(resolve(root,'public/site-config.js'),'window.PROCELYX_CONFIG = '+JSON.stringify(browserConfig).replaceAll('<','\\u003c')+';\n');
// Both dictionaries for the language switch in app.js; Czech is also injected straight into the HTML.
await writeFile(resolve(root,'public/i18n.js'),'window.PROCELYX_I18N = '+JSON.stringify(content.i18n).replaceAll('<','\\u003c')+';\n');
const versions={};
for(const name of ['app.js','site-config.js','i18n.js','styles.css','polish.css','clanky/article.css']) {
  versions[name]=createHash('sha256').update(await readFile(resolve(root,'public',name))).digest('hex').slice(0,12);
}
async function walk(dir) {
  for (const entry of await readdir(dir, {withFileTypes:true})) {
    const path = resolve(dir,entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.html')) {
      const $ = load(await readFile(path,'utf8'));
      // Brand mark is shared by the home page, articles and legal pages.
      $('header .brand,footer .brand').each((_,el) => {
        const brand = $(el);
        if (!brand.find('img.brand-logo').length) {
          brand.empty().append('<img class="brand-logo" src="/images/procelyx-wordmark.png" alt="PROCELYX" width="2172" height="724" decoding="async">');
        }
      });
      $('a[href^="mailto:"]').each((_,el) => { $(el).attr('href','mailto:'+config.email); if ($(el).find('b').length) $(el).find('b').text(config.email); else $(el).text(config.email); });
      $('a[href^="tel:"]').each((_,el) => { $(el).attr('href','tel:'+config.phone.replaceAll(' ','')); if ($(el).find('b').length) $(el).find('b').text(config.phone); else $(el).text(config.phone); });
      $('[data-site="founderName"]').text(config.founderName);
      if(!$('header a[href="/qr/"]').length){
        const qrLink='<a class="qrLink" href="/qr/" aria-label="QR kód a vizitka">QR</a>';
        if($('header .actions').length)$('header .actions').prepend(qrLink);
      }
      $('[data-site="businessId"]').text('IČO: '+config.businessId);
      $('[data-business-seat]').text(config.businessSeat ? 'Sídlo: '+config.businessSeat : '').attr('hidden',config.businessSeat ? null : '');
      $('[data-site="founderTitle"]').text(config.founderTitle.cs);
      // Pages listed in content/manifest.json get texts, SEO and image slots from content/** (tools/inject.mjs).
      const page = manifestPages.get(relative(root,path).split(sep).join('/'));
      if (page) applyContent($, content, page, {lang: content.manifest.site.defaultLanguage});
      // app.js reads the dictionaries from i18n.js, which must load right before it.
      const appScript = $('script[src^="/app.js"]');
      if (appScript.length && !$('script[src^="/i18n.js"]').length) appScript.before('<script src="/i18n.js"></script>');
      $('meta[property="og:image"]').each((_,el) => { if (!$(el).attr('content')?.includes('/articles/') && !$('meta[name="nexus-article"]').length) $(el).attr('content','https://procelyx.cz'+config.ogImage); });
      $('script[type="application/ld+json"]').each((_,el) => {
        const data = JSON.parse($(el).text());
        if (data['@type'] === 'ProfessionalService') { data.email=config.email;data.telephone=config.phone.replaceAll(' ','');data.founder.name=config.founderName; }
        // Articles are authored by the founder (owner decision); the build is the single source of the name.
        if (data['@type'] === 'Article') data.author={'@type':'Person',name:config.founderName};
        $(el).text(JSON.stringify(data).replaceAll('<','\\u003c'));
      });
      $('script[src],link[rel="stylesheet"]').each((_,el)=>{
        const attribute=el.tagName==='script'?'src':'href';
        const name=$(el).attr(attribute).split('?')[0].replace(/^\//,'');
        if(versions[name])$(el).attr(attribute,'/'+name+'?v='+versions[name]);
      });
      await writeFile(path,$.html());
    }
  }
}
await walk(resolve(root,'public'));
console.log('Public configuration and static pages updated. No secrets included.');
