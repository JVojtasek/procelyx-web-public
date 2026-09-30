import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
const root=path.resolve('public');
// Same source as tools/build.mjs (content/site.json, since W0c).
const siteConfig=JSON.parse(await fs.readFile(path.resolve('content/site.json'),'utf8'));
const files=(await fs.readdir(root,{recursive:true})).filter(p=>p.endsWith('.html'));
const docs=new Map();const titles=new Set();let links=0,images=0,articles=0;
for(const file of files){
 const $=load(await fs.readFile(path.join(root,file),'utf8'));docs.set(file.replaceAll('\\','/'),$);
 assert.equal($('h1').length,1,`${file}: one H1 required`);
 const title=$('title').text();assert.ok(title,`${file}: title missing`);assert.ok(!titles.has(title),`${file}: duplicate title`);titles.add(title);
 assert.ok($('meta[name="description"]').attr('content'),`${file}: missing description`);
 assert.ok($('link[rel="canonical"]').attr('href')?.startsWith('https://procelyx.cz/'),`${file}: canonical`);
 $('script[type="application/ld+json"]').each((_,el)=>{
   const data=JSON.parse($(el).text());
   if(data['@type']==='Article'){
     assert.equal(data.author?.name,siteConfig.founderName,`${file}: Article author must be ${siteConfig.founderName}`);
     assert.match(String(data.datePublished),/^\d{4}-\d{2}-\d{2}/,`${file}: datePublished`);
     if(data.dateModified)assert.ok(String(data.datePublished)<=String(data.dateModified),`${file}: datePublished after dateModified`);
   }
 });
 if(file.replaceAll('\\','/').match(/^clanky\/[^/]+\/index.html$/)){
   articles++;assert.ok(!$('meta[name="robots"]').attr('content')?.includes('noindex'));
   assert.ok($('meta[property="og:image"]').attr('content')?.includes('/images/articles/'),`${file}: article image`);
   assert.equal($('.articleVisual img').length,1,`${file}: hero image`);
 }
 const origin='https://procelyx.cz/'+file.replaceAll('\\','/').replace(/index\.html$/,'');
 for(const el of $('a[href],img[src],script[src],link[href]').toArray()){
   const raw=$(el).attr('href')||$(el).attr('src');
   if(!raw||raw.startsWith('mailto:')||raw.startsWith('tel:'))continue;
   const url=new URL(raw,origin);if(url.origin!=='https://procelyx.cz')continue;
   const target=decodeURIComponent(url.pathname).slice(1)+(url.pathname.endsWith('/')?'index.html':'');
   await fs.access(path.join(root,target)).catch(()=>assert.fail(`${file}: broken ${raw}`));links++;
   if(el.tagName==='img'){images++;assert.ok($(el).attr('width')&&$(el).attr('height'),`${file}: dimensions missing`);assert.notEqual($(el).attr('alt'),undefined,`${file}: alt missing`);}
 }
}
for(const [file,$] of docs){
 const origin='https://procelyx.cz/'+file.replace(/index\.html$/,'');
 for(const el of $('a[href]').toArray()){
   const url=new URL($(el).attr('href'),origin);if(url.origin!=='https://procelyx.cz'||!url.hash)continue;
   const target=decodeURIComponent(url.pathname).slice(1)+(url.pathname.endsWith('/')?'index.html':'');
   const doc=docs.get(target);if(doc)assert.ok(doc('[id]').toArray().some(e=>doc(e).attr('id')===decodeURIComponent(url.hash.slice(1))),`${file}: missing anchor ${url.hash}`);
 }
}
const sitemap=load(await fs.readFile(path.join(root,'sitemap.xml'),'utf8'),{xmlMode:true});
for(const loc of sitemap('loc').toArray()){
 const url=new URL(sitemap(loc).text());assert.equal(url.origin,'https://procelyx.cz');
 const route=url.pathname.slice(1)+(url.pathname.endsWith('/')?'index.html':'');assert.ok(docs.has(route),`sitemap missing file ${route}`);
}
assert.equal(sitemap('loc').length,articles+2,'sitemap must include home, article index and every article');
console.log(`Checked ${files.length} pages, ${articles} articles, ${links} local links/assets, ${images} images and ${sitemap('loc').length} sitemap URLs. No broken links.`);
if(process.argv.includes('--production')){
 const urls=sitemap('loc').toArray().map(el=>sitemap(el).text());urls.push(...['robots.txt','sitemap.xml','qr/','images/procelyx-qr.png','images/procelyx-vizitka.png','jaroslav-vojtasek.vcf'].map(route=>'https://procelyx.cz/'+route));
 for(const url of urls){const r=await fetch(url);assert.equal(r.status,200,`${url}: ${r.status}`);await r.arrayBuffer();}
 const www=await fetch('https://www.procelyx.cz/',{redirect:'manual'});assert.ok([301,308].includes(www.status));assert.equal(www.headers.get('location'),'https://procelyx.cz/');
 const api=await fetch('https://procelyx.cz/api/contact');assert.equal(api.status,405);
 console.log(`Production: all ${sitemap('loc').length} sitemap URLs, robots/sitemap, QR page/images and vCard return 200; www redirects; contact GET returns 405.`);
}
