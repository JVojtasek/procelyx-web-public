// Original editorial process diagrams. No external images, fonts or runtime service.
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {load} from 'cheerio';
const topics=[
 ['automatizace-poptavek-email-crm-ai','Z e-mailu do CRM','Poptávka se neztratí mezi schránkou a obchodníkem.',['Poptávka','AI vytěžení','Kontrola','CRM + úkol'],'mail','flow'],
 ['ai-projektovy-asistent-porady-ukoly-follow-up','Z porady k hotovému úkolu','Zápis má smysl, když na něj naváže práce.',['Porada','Přepis','Úkoly','Follow-up'],'calendar','flow'],
 ['hlasovy-ai-asistent-obchod-servis','Hovor, který má pokračování','Informace z telefonu se promění v další krok.',['Hovor','Shrnutí','CRM','Úkol'],'voice','flow'],
 ['automatizace-ubytovani-rezervace-hoste-ai','Péče o hosta bez přepisování','Jedna rezervace propojí komunikaci i provoz.',['Dotaz hosta','Rezervace','Příjezd','Provoz'],'hotel','flow'],
 ['automatizace-servisni-firmy-od-poptavky-po-fakturaci','Servis v jednom procesu','Od požadavku přes technika až k faktuře.',['Požadavek','Dispečink','Technik','Fakturace'],'service','flow'],
 ['automatizace-zakaznicke-komunikace-stav-zakazky','Zákazník ví, co se děje','Stav zakázky spustí správnou zprávu.',['Přijato','Zpracování','Hotovo','Informování'],'status','flow'],
 ['ai-asistent-projektova-kancelar-poptavky-dokumentace','Přílohy pod kontrolou','Termíny, požadavky a chybějící podklady na jednom místě.',['Poptávka','Dokumenty','Termíny','Předání týmu'],'document','flow'],
 ['automatizace-kooperace-step-bom-technolog','Správné podklady pro kooperaci','Kusovník a soubory se spojí do kontrolovaného balíčku.',['STEP + BOM','Výběr dílů','Kontrola','Export'],'cube','flow'],
 ['automatizace-nakupovanych-dilu-cad-erp-pdm','Díl zadáte pouze jednou','Rozhodnutí konstruktéra naváže na firemní systémy.',['CAD model','Výběr dílu','PDM','ERP'],'cube','flow'],
 ['ocr-ai-technicke-vykresy-dokumentace','Z výkresu k ověřeným datům','AI čte. Technolog kontroluje.',['Výkres','OCR + AI','Ověření','Řízená data'],'drawing','document'],
 ['human-in-the-loop-ai-automatizace','Rozhodnutí zůstává člověku','Automatizace má jasný bod schválení.',['AI návrh','Člověk','Schválení','Provedení'],'human','approval'],
 ['jeden-zdroj-pravdy-cenik-data-ai','Jeden řízený zdroj pravdy','Odpovědi a nabídky vycházejí ze stejných dat.',['Ceník','Dokumenty','CRM','Nabídky'],'database','hub'],
 ['ai-hub-agenti-asistenti-ve-firme','Digitální tým s jasnými rolemi','Společný kontext. Pravidla. Dohled člověka.',['Obchod','Projekty','Znalosti','Servis'],'hub','hub'],
 ['7-mist-kde-vyrobni-firma-plati-technologa-za-administrativu','Odborník má dělat odbornou práci','Propojte podklady a omezte ruční administrativu.',['Výkresy','Kusovníky','Exporty','Kontroly'],'drawing','hub'],
 ['jak-najit-procesy-pro-ai-automatizaci','Který proces má jít první?','Hledejte opakování, jasné vstupy a měřitelný přínos.',['Opakování','Ruční práce','Jasná data','Malý pilot'],'search','flow'],
 ['jak-spocitat-navratnost-ai-automatizace','Pilot musí prokázat přínos','Porovnejte čas, chyby a skutečné náklady.',['Čas','Četnost','Náklady','Přínos'],'chart','roi']
];
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const shapes={
 mail:'<rect x="4" y="10" width="56" height="42" rx="5"/><path d="m5 13 27 22 27-22"/>',
 calendar:'<rect x="7" y="10" width="50" height="48" rx="5"/><path d="M7 24h50M20 4v13M44 4v13m-24 24 8 8 16-17"/>',
 voice:'<path d="M5 26v12m9-22v32m9-37v42m9-48v54m9-46v38m9-33v28m9-19v10"/>',
 hotel:'<path d="M10 59V6h44v53M4 59h56M25 59V43h14v16M20 17h4m16 0h4m-24 12h4m16 0h4"/>',
 service:'<path d="M40 6a15 15 0 0 0-17 20L6 43a8 8 0 0 0 12 12l18-18A15 15 0 0 0 56 19L43 31 33 21Z"/>',
 status:'<circle cx="32" cy="32" r="26"/><path d="m18 31 10 11 20-22"/>',
 document:'<path d="M14 5h25l13 13v41H14ZM39 5v15h13M23 31h20M23 40h20M23 49h12"/>',
 cube:'<path d="m32 3 27 15v30L32 63 5 48V18Zm0 30v30M5 18l27 15 27-15M18 10l28 15v16"/>',
 drawing:'<rect x="3" y="8" width="58" height="48" rx="2"/><path d="M14 43V24h18v-6h17v25ZM10 49h43M10 47v4m43-4v4M37 25v12h8"/>',
 human:'<circle cx="32" cy="16" r="11"/><path d="M10 58v-9a22 22 0 0 1 44 0v9M22 45l8 8 15-17"/>',
 database:'<ellipse cx="32" cy="12" rx="25" ry="9"/><path d="M7 12v38c0 12 50 12 50 0V12M7 31c0 12 50 12 50 0"/>',
 hub:'<circle cx="32" cy="32" r="12"/><path d="M32 3v17m0 24v17M3 32h17m24 0h17M11 11l13 13m16 16 13 13m0-42L40 24M24 40 11 53"/>',
 search:'<circle cx="27" cy="27" r="21"/><path d="m43 43 17 17M15 28h24M27 16v24"/>',
 chart:'<path d="M6 5v53h54M16 45l12-17 12 7 18-24M46 11h12v12"/>'
};
function icon(kind,x,y,scale=1,color='#69e0cf'){return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${shapes[kind]}</g>`;}
function label(s,x,y,size=26,color='#edf4fb',anchor='start'){return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" fill="${color}">${esc(s)}</text>`;}
function box(s,x,y,w=224,h=112,color='#69e0cf'){return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#152630" stroke="${color}" stroke-opacity=".65"/>`+label(s,x+w/2,y+h/2+9,27,'#edf4fb','middle');}
function diagram(topic){const[slug,title,subtitle,nodes,kind,layout]=topic;
 let main='';
 if(layout==='hub'){
   const center=kind==='database'?'Řízená data':kind==='drawing'?'Technolog':'AI Hub';
   main=`<path d="M320 326h150l80 93m-230 102h150l80-93m100-9 80-93h150m-230 102 80 93h150" stroke="#46746f" stroke-width="3" fill="none"/>`;
   main+=box(nodes[0],85,270,260,110)+box(nodes[1],85,465,260,110)+box(nodes[2],855,270,260,110)+box(nodes[3],855,465,260,110);
   main+='<circle cx="600" cy="420" r="115" fill="#153a38" stroke="#69e0cf" stroke-width="2"/>';
   main+=icon(kind,568,345,1)+label(center,600,470,30,'#d6fff4','middle');
 }else if(layout==='document'){
   main='<rect x="70" y="245" width="360" height="320" rx="10" fill="#162632" stroke="#395264"/><path d="M125 470V345h105v-45h125v170ZM260 332v99h63M110 511h259M110 498v26m259-26v26M392 300v170m-12-170h24m-24 170h24" fill="none" stroke="#9dbed0" stroke-width="3"/>';
   main+=label('Technický výkres',250,280,21,'#a7bacb','middle')+label('Podklady ke kontrole',250,547,21,'#a7bacb','middle');
   main+='<path d="M455 409h73" stroke="#69e0cf" stroke-width="3" marker-end="url(#arrow)"/>';
   main+=box('OCR + AI',555,330,220,150)+box('Ověření člověkem',830,330,300,150,'#e7bc79');
   main+=label('Rozměry · materiál · tolerance',850,542,23,'#a7bacb','middle');
 }else if(layout==='roi'){
   main='<path d="M95 260v296h630" stroke="#53727c" stroke-width="2"/><path d="M105 486C270 480 260 416 370 405S545 365 685 299" fill="none" stroke="#69e0cf" stroke-width="5"/><path d="M105 405h580" fill="none" stroke="#e7bc79" stroke-width="2" stroke-dasharray="9 9"/>';
   main+=label('Přínos pilotu',480,283,25,'#69e0cf')+label('Náklady',540,442,25,'#e7bc79')+label('Doba provozu',490,596,21,'#a7bacb');
   main+=box('Ušetřený čas',815,270,300,82)+box('Méně oprav',815,373,300,82)+box('Náklady na provoz',815,476,300,82);
   main+=label('Ilustrační model, nikoli naměřené výsledky',95,630,19,'#a7bacb');
 }else{
   main+=icon(kind,87,248,1.4);
   main+=label(layout==='approval'?'Kontrola před provedením':'Propojené kroky místo ručního přepisování',210,297,26,'#a7bacb');
   nodes.forEach((n,i)=>{const x=70+i*283;main+=box(n,x,366,210,115,layout==='approval'&&i===1?'#e7bc79':'#69e0cf');if(i<3)main+=`<path d="M${x+219} 423h50" stroke="#69e0cf" stroke-width="2" marker-end="url(#arrow)"/>`;});
   if(layout==='approval')main+=label('Jasná odpovědnost za citlivé kroky',600,560,24,'#e7bc79','middle');
   else main+=label('Vstup',70,541,20,'#829aaa')+label('Zpracování a kontrola',600,541,20,'#829aaa','middle')+label('Navazující práce',1130,541,20,'#829aaa','end');
 }
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#26404b" stroke-width=".5" opacity=".4"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 8 5 0 9" fill="none" stroke="#69e0cf" stroke-width="1.5"/></marker></defs><rect width="1200" height="675" fill="#0c1720"/><rect width="1200" height="675" fill="url(#grid)"/><rect x="0" y="0" width="8" height="675" fill="#69e0cf"/>${label('PROCELYX',70,62,22,'#69e0cf')}${label('Schéma procesu',1130,62,19,'#a7bacb','end')}<path d="M70 87h1060" stroke="#29414d"/>${label(title,70,151,title.length>37?36:40)}${label(subtitle,70,198,23,'#a7bacb')}${main}</svg>`;
}
await fs.mkdir('public/images/articles',{recursive:true});
for(const topic of topics){
 const [slug,title,,nodes]=topic;
 const svg=diagram(topic);const base='public/images/articles/'+slug;
 await fs.writeFile(base+'.svg',svg);
 await sharp(Buffer.from(svg)).webp({quality:88}).toFile(base+'.webp');
 await sharp(Buffer.from(svg)).jpeg({quality:88,mozjpeg:true}).toFile(base+'.jpg');
 const file='public/clanky/'+slug+'/index.html';const $=load(await fs.readFile(file,'utf8'));
 const image='/images/articles/'+slug+'.webp';const alt=title+': '+nodes.join(' → ')+'.';
 $('.articleVisual').remove();
 $('.articleHero .wrap').append(`<figure class="articleVisual"><img src="${image}" width="1200" height="675" alt="${esc(alt)}" decoding="async" fetchpriority="high"></figure>`);
 for(const [attr,key,value] of [['property','og:image','https://procelyx.cz/images/articles/'+slug+'.jpg'],['name','twitter:card','summary_large_image'],['property','og:image:width','1200'],['property','og:image:height','675']]){
  $(`meta[${attr}="${key}"]`).remove();$('head').append(`<meta ${attr}="${key}" content="${value}">`);
 }
 $('script[type="application/ld+json"]').each((_,el)=>{const data=JSON.parse($(el).text());if(data['@type']==='Article'){data.image='https://procelyx.cz/images/articles/'+slug+'.jpg';$(el).text(JSON.stringify(data));}});
 // Secondary pages keep visible navigation on small screens.
 $('header .articleBack').remove();$('header .actions').prepend('<a class="articleBack" href="/clanky/">Články</a>');
 await fs.writeFile(file,$.html());
}
const indexPath='public/clanky/index.html';const $=load(await fs.readFile(indexPath,'utf8'));
$('.articleCard').each((_,el)=>{const link=$(el).find('a').attr('href');const slug=link?.split('/').filter(Boolean).at(-1);const topic=topics.find(x=>x[0]===slug);if(topic){$(el).find('.articleThumb').remove();$(el).prepend(`<a class="articleThumb" href="${link}" tabindex="-1" aria-hidden="true"><img src="/images/articles/${slug}.webp" alt="" width="1200" height="675" loading="lazy" decoding="async"></a>`);}});
$('header .articleBack').remove();$('header .actions').prepend('<a class="articleBack" href="/">Domů</a>');
await fs.writeFile(indexPath,$.html());
const homePath='public/index.html';const home=load(await fs.readFile(homePath,'utf8'));
home('.usecaseGrid article').each((_,el)=>{const slug=home(el).find('a').attr('href')?.split('/').filter(Boolean).at(-1);const topic=topics.find(x=>x[0]===slug);if(topic){home(el).find('.caseImage').remove();home(el).prepend(`<img class="caseImage" src="/images/articles/${slug}.webp" alt="${esc(topic[1])}" width="1200" height="675" loading="lazy" decoding="async">`);}});
await fs.writeFile(homePath,home.html());
const og=diagram(['home','Méně rutiny. Více prostoru pro práci.','AI automatizace a digitální procesy pro firmy.',['Poptávka','AI + člověk','Realizace','Přínos'],'hub','flow']);
await sharp(Buffer.from(og)).jpeg({quality:90,mozjpeg:true}).toFile('public/images/procelyx-process.jpg');
console.log('Created 16 original process diagrams, article heroes, thumbnails and individual social previews.');
