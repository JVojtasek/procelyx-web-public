import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {load} from 'cheerio';
import worker from '../src/index.js';

test('old article GET and HEAD links redirect permanently to the new canonical URL', async()=>{
  for(const host of ['procelyx.cz','www.procelyx.cz'])for(const suffix of ['','/','/index.html'])for(const method of ['GET','HEAD']){
    const response=await worker.fetch(new Request(`https://${host}/clanky/nexus-one-centralni-mozek-firmy${suffix}?utm_source=old-link`,{method}),{});
    assert.equal(response.status,301);
    assert.equal(response.headers.get('location'),'https://procelyx.cz/clanky/procelyx-one-centralni-mozek-firmy/?utm_source=old-link');
  }
});

test('article redirect does not capture unrelated URLs or non-read requests',async()=>{
  for(const [path,method] of [['/clanky/nexus-one-centralni-mozek-firmy-extra/','GET'],['/clanky/procelyx-one-centralni-mozek-firmy/','GET'],['/clanky/nexus-one-centralni-mozek-firmy/','POST']]){
    const response=await worker.fetch(new Request('https://procelyx.cz'+path,{method}),{ASSETS:{fetch:async()=>new Response('assets',{status:202})}});
    assert.equal(response.status,202);
  }
});

test('rebranded article, search metadata, index and sitemap have a single canonical destination',()=>{
  const url='https://procelyx.cz/clanky/procelyx-one-centralni-mozek-firmy/';
  const html=readFileSync('public/clanky/procelyx-one-centralni-mozek-firmy/index.html','utf8');
  const $=load(html);
  assert.equal($('link[rel=canonical]').attr('href'),url);
  assert.equal($('meta[property="og:url"]').attr('content'),url);
  assert.match($('h1').text(),/PROCELYX ONE/);
  assert.doesNotMatch($('body').text(),/Nexus One|NEXUS ONE|Nexusu/);
  assert.match($('body').text(),/Nexus Brain/);
  const article=JSON.parse(readFileSync('content/articles/procelyx-one-centralni-mozek-firmy.json','utf8'));
  assert.equal(article.datePublished,'2026-10-06');
  assert.equal(article.version,2);
  assert.equal(article.assets.length,2);
  for(const img of $('img[src^="/images/nexus/"]').toArray()) assert.ok(existsSync('public'+$(img).attr('src')));
  const sitemap=readFileSync('public/sitemap.xml','utf8');
  assert.ok(sitemap.includes(url));
  assert.ok(!sitemap.includes('/clanky/nexus-one-centralni-mozek-firmy/'));
  const index=readFileSync('public/clanky/index.html','utf8');
  assert.ok(index.includes('/clanky/procelyx-one-centralni-mozek-firmy/'));
  assert.ok(!index.includes('/clanky/nexus-one-centralni-mozek-firmy/'));
});
