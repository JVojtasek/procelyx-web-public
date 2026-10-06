import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {articleAssetErrors, assetPath, writeArticleAssets} from '../tools/lib/article-assets.mjs';
import {renderArticlePage} from '../tools/lib/articles.mjs';
import {validate} from '../tools/lib/json-schema-lite.mjs';
import {load} from 'cheerio';
import {buildMediaLibrary} from '../tools/lib/site-content.mjs';

const bytes = await sharp({create:{width:800,height:450,channels:3,background:'#125371'}}).webp().toBuffer();
const asset = {mediaId:'img-nexus-'+createHash('sha256').update(bytes).digest('hex'),mime:'image/webp',dataBase64:bytes.toString('base64'),width:800,height:450};
const data = {image:{mediaId:asset.mediaId,alt:'Modelový přehled toku zakázky'},assets:[asset],figures:[{mediaId:asset.mediaId,kind:'infographic',alt:'Modelový přehled toku zakázky',afterSection:1}],bodyHtml:'<p>Úvod</p><h2>První krok</h2><p>Obsah první sekce</p><h2>Druhý krok</h2><p>Obsah druhé sekce</p>'};

test('approved bytes survive materialization and a figure lands after the complete selected section', () => {
  assert.deepEqual(articleAssetErrors(data), []);
  const root = mkdtempSync(join(tmpdir(),'procelyx-media-'));
  try {
    writeArticleAssets(root,data);
    assert.deepEqual(readFileSync(join(root,'public',assetPath(asset.mediaId))),bytes);
    assert.deepEqual(buildMediaLibrary(root), {}, 'materialized article bytes must not change the committed shared media library on the next build');
  }
  finally { rmSync(root,{recursive:true,force:true}); }
  const html = renderArticlePage({...data,slug:'test-tok',title:'Praktický tok zakázky',seoTitle:'Praktický tok zakázky',description:'Popis modelového toku',category:'Procesy',typeLabel:'Příklad',lead:'Modelový přehled',faq:[],related:[],cta:null,aiNote:null,datePublished:'2026-10-05',dateModified:'2026-10-05',nexusId:'test1',version:1},{site:{founderName:'Veřejný autor',ogImage:'/images/example.webp',email:'info@example.com',phone:''},image:null});
  const $ = load(html);
  assert.equal($('.articleFigure img').attr('src'), assetPath(asset.mediaId));
  assert.equal($('.articleFigure').prev().text(), 'Obsah první sekce');
  assert.equal($('.articleFigure').next().text(), 'Druhý krok');
  assert.equal($('.articleFigure img').attr('alt'), data.figures[0].alt);
});

test('reject altered bytes, MIME/dimension mismatches, unknown references and oversized payloads', () => {
  for (const a of [{...asset,mediaId:'img-nexus-'+'0'.repeat(64)}, {...asset,mime:'image/svg+xml'}, {...asset,width:999}, {...asset,dataBase64:asset.dataBase64+'\n'}, {...asset,dataBase64:Buffer.alloc(450001).toString('base64')}]) assert.ok(articleAssetErrors({...data,assets:[a]}).length);
  assert.ok(articleAssetErrors({...data,figures:[{...data.figures[0],afterSection:3}]}).length);
  assert.ok(articleAssetErrors({...data,assets:[]}).length);
});

test('media capability schema remains strict and bounded', () => {
  const schema=JSON.parse(readFileSync(new URL('../schemas/article-media.schema.json',import.meta.url),'utf8'));
  assert.deepEqual(validate(schema,{assets:data.assets,figures:data.figures}),[]);
  assert.ok(validate(schema,{assets:[{...asset,remoteUrl:'https://example.com'}]}).length);
  assert.ok(validate(schema,{assets:Array(5).fill(asset)}).length);
  assert.ok(validate(schema,{figures:[{...data.figures[0],alt:'<script>'}]}).length);
});
