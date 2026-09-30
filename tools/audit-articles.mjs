/** Original PROCELYX articles on process discovery. Run: node tools/audit-articles.mjs */
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {load} from 'cheerio';

const articles=[
  {
    slug:'procesni-audit-kde-mizi-cas', image:'procesni-audit-kde-mizi-cas',
    title:'Kde vám z firmy mizí čas a marže? Procesní audit ukáže skutečnou příčinu',
    description:'Procesní audit pro malé a střední firmy: zmapujte cestu zakázky, změřte čekání, přepisování a opravy a vyberte první změnu s ověřitelným přínosem.',
    lead:'Všichni pracují naplno, ale zakázky se přesto vlečou. Než přidáte dalšího člověka nebo software, zjistěte, kde se práce skutečně zastavuje.',
    alt:'Majitel malé firmy s konzultantkou mapují kroky zakázky v dílně a kanceláři.',
    teaser:'Všichni pracují naplno, zakázky přesto čekají. Co přesně procesní audit zjistí a co z něj dostanete?',
    diagramTitle:'Co sleduje procesní audit',
    diagram:[['01 Poptávka','Co přichází a co chybí?'],['02 Předání','Kdo čeká na další krok?'],['03 Realizace','Kde se přepisuje či opravuje?'],['04 Výsledek','Co se mění pro zákazníka?']],
    body:`<p>Telefon zazvoní, zákazník chce nabídku. Obchodník najde starý e-mail, projektant čeká na správnou verzi podkladu, technik si upřesňuje zadání a fakturace nakonec zjišťuje, co bylo skutečně dodáno. Každý udělal svou práci. Přesto firma spotřebovala čas, který nikdo neplánoval. <strong>Procesní audit ukáže, kde tento čas vzniká a proč se ztráta opakuje.</strong></p>
<h2>Co při auditu skutečně mapujeme</h2><p>Nezačínáme seznamem aplikací, které byste měli koupit. Vezmeme jednu typickou zakázku a projdeme její cestu od první poptávky po předání a vyúčtování. U každého kroku zjišťujeme, co ho spustí, jaký podklad člověk dostane, v jakém systému pracuje, co vytvoří, komu výstup předá a jak pozná platnou verzi.</p>
<p>Vedle běžného průběhu zaznamenáme i odbočky: neúplné zadání, změnu rozsahu, čekání na schválení, vrácení k opravě. Právě výjimky bývají důvodem, proč se hezký procesní obrázek na poradě liší od reality v kanceláři.</p>
<div class="painbox"><b>Rychlý test pro majitele</b><p>Vyberte poslední dokončenou zakázku. Zeptejte se: Kdo držel další krok, na co čekal a kolikrát musel stejný údaj napsat znovu? Pokud odpověď hledáte ve třech schránkách a dvou tabulkách, máte dobré místo, kde začít.</p></div>
<h2>Ze stížnosti udělejte číslo</h2><p>„Předávání nás zdržuje“ je začátek rozhovoru. Pro rozhodnutí potřebujete alespoň odhad četnosti a dopadu. Kolikrát měsíčně se předání vrátí? Kolik minut stojí oprava? Kolik dní čeká zákazník? Kolik práce zůstane nevyfakturováno? Aktivní čas, čekání a přímou finanční ztrátu vedeme zvlášť. Nenásobíme automaticky každý den čekání hodinovou mzdou.</p>
<p>Pokud například chybějící informace dohledáváte 24krát měsíčně a každý případ zabere 12 minut, jde o téměř pět hodin práce. Jestli současně kvůli tomu nabídka stojí dva dny, může být obchodní dopad důležitější než samotná úspora času. Výchozí hodnoty označíme jako odhad, který v pilotu ověříme.</p>
<h2>Co z auditu dostanete</h2><ol><li><strong>Mapu současného toku zakázky</strong> včetně lidí, systémů, dokumentů a míst rozhodování.</li><li><strong>Seznam úzkých hrdel s důkazy</strong>, četností a dopadem; ne jen dojmy ze schůzky.</li><li><strong>Návrh prvního zásahu</strong> — může to být jasnější zadání, pravidlo předání, propojení systémů nebo AI asistent pro práci s nestrukturovanými podklady.</li><li><strong>Měřítko úspěchu</strong> pro malý pilot: například doba od poptávky k nabídce, počet vrácení nebo čas na dohledání podkladu.</li></ol>
<h2>Jak audit probíhá v PROCELYX</h2><p>Začít můžete sami: uvedete firmu, popíšete konkrétní problém a v interaktivním dotazníku s AI průvodcem poskládáte průchod zakázky. Mapu si můžete upravit, doplnit odpovědi a ukázkové vstupy či výstupy. Nemusíte znát všechna čísla ani popisovat celou firmu. Podklady pak zkontroluje člověk, ověří nejasnosti a společně zvolíme smysluplný první krok.</p>
<p><a href="https://nexus-one-production.up.railway.app/discovery/start">Otevřít vlastní procesní audit</a> můžete hned. Pokud raději začnete rozhovorem, <a href="/#contact">domluvte si konzultaci</a>. O tom, <a href="/clanky/jak-najit-uzka-hrdla-ve-firme/">jak měřit úzká hrdla</a>, píšeme také samostatně.</p>`
  },
  {
    slug:'ktery-proces-digitalizovat-prvni', image:'ktery-proces-digitalizovat-prvni',
    title:'Co digitalizovat jako první? Mapa zakázky rozhodne lépe než další porada',
    description:'Nevíte, který firemní proces digitalizovat nebo automatizovat? Praktický rozhodovací rámec: četnost, ztráty, data, výjimky a malý ověřitelný pilot.',
    lead:'Když má každý vedoucí svůj „nejdůležitější“ problém, rozhodnutí o automatizaci se snadno změní v soutěž o nejhlasitější argument. Pomůže společná mapa práce.',
    alt:'Majitel firmy a kolegyně porovnávají dokumenty s mapou procesu na stěně kanceláře.',
    teaser:'Obchod chce CRM, provoz plánování, účetní lepší podklady. Jak vybrat první krok podle skutečných ztrát?',
    diagramTitle:'Jak vybrat první proces k pilotu',
    diagram:[['Četnost','Kolikrát se krok opakuje?'],['Dopad','Čas, chyba, zdržení, peníze'],['Připravenost','Data, vlastník a jasný výstup'],['Pilot','Jedna změna, měření před a po']],
    body:`<p>Obchod chce nové CRM. Technik lepší plánování. Účetní už nechce honit chybějící předávací protokoly. Všichni mohou mít pravdu — a přesto by bylo drahé začít třemi systémy současně. <strong>První proces vybírejte podle toho, kolik opakované práce nebo zdržení způsobuje a jak dobře lze změnu ověřit.</strong></p>
<h2>Proč samotný seznam problémů nestačí</h2><p>„Zautomatizujeme fakturaci“ zní jasně, dokud nezjistíte, že faktura čeká na informaci o dokončení zakázky. „Zavedeme AI na nabídky“ zase nepomůže, pokud obchod stále dostává neúplné zadání a neví, která revize dokumentace platí. Audit se proto dívá na celý průchod zakázky a navazující předání. Lokální zrychlení jednoho kroku nesmí zhoršit další.</p>
<h2>Čtyři otázky pro rozumné pořadí</h2><ol><li><strong>Jak často se problém děje?</strong> Jednorázová výjimka může bolet, ale opakovaný ruční přepis 30krát týdně má jiný potenciál.</li><li><strong>Jaký je skutečný dopad?</strong> Oddělte aktivní práci, čekání, opravy, ztracené příležitosti a přímé náklady. Když číslo neznáte, napište rozpětí.</li><li><strong>Má proces vlastníka a použitelná data?</strong> Někdo musí potvrdit správný vstup i výstup. Bez toho automatizace jen rychleji přesune nejasnost dál.</li><li><strong>Lze změnu zkusit na malém vzorku?</strong> Vyberte jeden typ zakázky, jasné pravidlo kontroly a měření před a po.</li></ol>
<div class="painbox"><b>Modelová situace</b><p>Firma dostane 40 poptávek měsíčně. U poloviny chybí podklad a obchodník ho ručně dohledává. Jako první pilot může dávat smysl kontrola úplnosti zadání a upozornění na chybějící přílohy. Není nutné současně zavádět nové CRM, ERP a hlasového agenta.</p></div>
<h2>Ne každý problém potřebuje AI</h2><p>Když máte přesná pravidla a strukturované údaje, často stačí formulář, automatický přenos dat nebo kontrola povinných polí. AI pomáhá u e-mailů, volného textu a různorodých dokumentů, které člověk dosud čte a třídí. U ceny, termínu, technické správnosti či právního závazku musí být jasné, kdo návrh ověřuje a schvaluje. Praktické srovnání najdete v článku <a href="/clanky/je-ai-vhodna-pro-automatizaci-vasi-firmy/">kdy AI opravdu dává smysl</a>.</p>
<h2>Co udělat příští týden</h2><p>Vyberte tři nedávné zakázky stejného typu. Zapište, kdy přišly, kdo je převzal, jaké podklady chyběly, kdy vznikla nabídka, kolikrát se vracely a kdy se fakturovalo. Z těchto tří případů nakreslete jednu společnou mapu s variantami. Potom vyberte jedno místo, kde se opakuje ztráta a kde máte data pro měření.</p>
<p>V <a href="https://nexus-one-production.up.railway.app/discovery/start">procesním auditu PROCELYX</a> si můžete cestu zakázky sestavit sami nebo s AI průvodcem. Vyplňte jen to, co dnes víte; zbytek společně upřesníme. Výsledkem má být rozhodnutí, kde začít — nikoli další dokument, který zapadne v šuplíku. Detailní popis auditu najdete v článku <a href="/clanky/procesni-audit-kde-mizi-cas/">kde vám mizí čas a marže</a>.</p>`
  }
];

const escapeHtml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const template=await fs.readFile('public/clanky/jak-najit-procesy-pro-ai-automatizaci/index.html','utf8');
for(const article of articles){
  const $=load(template);
  const url=`https://procelyx.cz/clanky/${article.slug}/`;
  $('title').text(`${article.title} | PROCELYX`);
  $('meta[name="description"],meta[property="og:description"]').attr('content',article.description);
  $('link[rel="canonical"]').attr('href',url);
  $('meta[property="og:title"]').attr('content',article.title);
  $('meta[property="og:url"]').attr('content',url);
  $('meta[property="og:image"]').attr('content',`https://procelyx.cz/images/articles/${article.image}.jpg`);
  $('.articleHero .breadcrumbs').html(`<a href="/">PROCELYX</a> / <a href="/clanky/">Články</a> / PROCESNÍ AUDIT`);
  $('.articleHero .eyebrow').text('PROCESNÍ AUDIT');
  $('.articleHero h1').text(article.title);
  $('.articleHero .lead').text(article.lead);
  $('.articleHero .meta').html('<span>Praktický průvodce</span><span>28. 9. 2026</span><span>Redakce PROCELYX</span>');
  $('.articleHero .articleVisual').html(`<img src="/images/articles/${article.image}.webp" width="1200" height="675" alt="${escapeHtml(article.alt)}" decoding="async" fetchpriority="high">`);
  const graphic=`<figure class="articleInlineVisual"><img src="/images/articles/${article.slug}-infografika.webp" width="1200" height="675" loading="lazy" decoding="async" alt="Infografika: ${escapeHtml(article.diagramTitle)}"><figcaption>${escapeHtml(article.diagramTitle)}. Diagram slouží jako orientační pomůcka, skutečný postup závisí na firmě.</figcaption></figure>`;
  $('.articleBody .wrap').html(article.body.replace('</div>',`</div>${graphic}`)+`<div class="ctaBox"><h3>Začněte jednou zakázkou</h3><p>Otevřete si vlastní mapu procesu s AI průvodcem. Pak společně ověříme, kde změna skutečně pomůže.</p><a class="btn" href="https://nexus-one-production.up.railway.app/discovery/start">Spustit procesní audit</a></div><h2>Související články</h2><div class="related"><a href="/clanky/jak-zrychlit-prutok-zakazek-firmou/">Jak zrychlit průtok zakázek →</a><a href="/clanky/jak-najit-uzka-hrdla-ve-firme/">Jak najít úzká hrdla →</a></div>`);
  $('script[type="application/ld+json"]').text(JSON.stringify({'@context':'https://schema.org','@type':'Article',headline:article.title,description:article.description,datePublished:'2026-09-28',dateModified:'2026-09-28',author:{'@type':'Person',name:'Jaroslav Vojtášek'},publisher:{'@type':'Organization',name:'PROCELYX',url:'https://procelyx.cz/'},mainEntityOfPage:url,image:`https://procelyx.cz/images/articles/${article.image}.jpg`}));
  await fs.mkdir(`public/clanky/${article.slug}`,{recursive:true});
  await fs.writeFile(`public/clanky/${article.slug}/index.html`,$.html());
  const boxes=article.diagram.map(([name,detail],i)=>`<g><rect x="${72+i*282}" y="250" width="248" height="180" rx="22" fill="${i===3?'#082d4b':'#122535'}" stroke="${i===3?'#22d3ee':'#476474'}" stroke-width="2"/><text x="${92+i*282}" y="307" font-size="26" font-weight="700" fill="#f4fbff">${escapeHtml(name)}</text><foreignObject x="${92+i*282}" y="330" width="205" height="75"><div xmlns="http://www.w3.org/1999/xhtml" style="font:21px Arial;color:#b8dbe8;line-height:1.25">${escapeHtml(detail)}</div></foreignObject></g>`).join('');
  const arrows=[0,1,2].map(i=>`<path d="M${322+i*282} 340h27" stroke="#22d3ee" stroke-width="4" marker-end="url(#arrow)"/>`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#071521"/><stop offset="1" stop-color="#064a69"/></linearGradient><marker id="arrow" markerWidth="10" markerHeight="10" refX="7" refY="5" orient="auto"><path d="M1 1l7 4-7 4" fill="none" stroke="#22d3ee" stroke-width="1.8"/></marker></defs><rect width="1200" height="675" fill="url(#bg)"/><text x="72" y="105" font-family="Arial" font-size="20" font-weight="700" fill="#22d3ee">PROCELYX · PROCESNÍ AUDIT</text><text x="72" y="172" font-family="Arial" font-size="42" font-weight="700" fill="#fff">${escapeHtml(article.diagramTitle)}</text>${boxes}${arrows}<text x="72" y="553" font-family="Arial" font-size="22" fill="#aac8d6">Jedna skutečná zakázka. Jasný další krok.</text></svg>`;
  await fs.writeFile(`public/images/articles/${article.slug}-infografika.svg`,svg);
  await sharp(Buffer.from(svg)).webp({quality:88}).toFile(`public/images/articles/${article.slug}-infografika.webp`);
}

const $index=load(await fs.readFile('public/clanky/index.html','utf8'));
for(const article of articles){
  if($index(`.articleCards a[href="/clanky/${article.slug}/"]`).length) continue;
  $index('.articleCards').prepend(`<article class="articleCard"><a class="articleThumb" href="/clanky/${article.slug}/" tabindex="-1" aria-hidden="true"><img src="/images/articles/${article.image}.webp" alt="" width="1200" height="675" loading="lazy" decoding="async"></a><span>PROCESNÍ AUDIT</span><h2>${escapeHtml(article.title)}</h2><p>${escapeHtml(article.teaser)}</p><a href="/clanky/${article.slug}/">Číst článek →</a></article>`);
}
await fs.writeFile('public/clanky/index.html',$index.html());
let sitemap=await fs.readFile('public/sitemap.xml','utf8');
for(const article of articles){const url=`https://procelyx.cz/clanky/${article.slug}/`;if(!sitemap.includes(url)) sitemap=sitemap.replace('</urlset>',`<url><loc>${url}</loc><lastmod>2026-09-28</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>\n</urlset>`);}
await fs.writeFile('public/sitemap.xml',sitemap);

let homepage=await fs.readFile('public/index.html','utf8');
if(!homepage.includes('id="auditStartInvite"')){
  const marker='</div></div></div>\n<div class="workbench"';
  if(!homepage.includes(marker)) throw new Error('Homepage hero marker changed');
  const invite=`<section class="auditStartInvite" id="auditStartInvite" aria-labelledby="auditStartTitle"><p class="auditStartEyebrow" data-t="auditEyebrow">ZAČNĚTE TAM, KDE TO DÁVÁ SMYSL</p><h2 id="auditStartTitle" data-t="auditTitle">Nejdřív pochopit. Potom automatizovat.</h2><p data-t="auditText">Nejrychlejší cesta k plynulejším zakázkám nezačíná dalším softwarem. Začíná tím, že uvidíte, kde dnes práce čeká, vrací se a bere lidem energii. Procesní audit promění tyto dojmy v přehlednou mapu a pomůže vybrat první změnu, jejíž přínos půjde ověřit.</p><div class="auditStartActions"><a class="btn" href="https://nexus-one-production.up.railway.app/discovery/start" data-t="auditSelfCta">Zmapovat proces s AI průvodcem ↗</a><a class="textLink" href="#contact" data-t="auditMeetingCta">Domluvit konzultaci</a></div><small data-t="auditNote">Stačí jedna skutečná zakázka. Nemusíte mít hotovou analýzu.</small></section>`;
  homepage=homepage.replace(marker,`</div></div>${invite}</div>\n<div class="workbench"`);
  await fs.writeFile('public/index.html',homepage);
}
let translations=await fs.readFile('public/app.js','utf8');
if(!translations.includes("auditEyebrow:'ZAČNĚTE")){
  const marker='function updateAccessibleCopy(x){';
  if(!translations.includes(marker)) throw new Error('Translation insertion point changed');
  const additions=`Object.assign(T.cs,{auditEyebrow:'ZAČNĚTE TAM, KDE TO DÁVÁ SMYSL',auditTitle:'Nejdřív pochopit. Potom automatizovat.',auditText:'Nejrychlejší cesta k plynulejším zakázkám nezačíná dalším softwarem. Začíná tím, že uvidíte, kde dnes práce čeká, vrací se a bere lidem energii. Procesní audit promění tyto dojmy v přehlednou mapu a pomůže vybrat první změnu, jejíž přínos půjde ověřit.',auditSelfCta:'Zmapovat proces s AI průvodcem ↗',auditMeetingCta:'Domluvit konzultaci',auditNote:'Stačí jedna skutečná zakázka. Nemusíte mít hotovou analýzu.'});\nObject.assign(T.en,{auditEyebrow:'START WHERE IT MATTERS',auditTitle:'Understand first. Then automate.',auditText:'The fastest path to smoother orders does not start with another software purchase. It starts by seeing where work waits, comes back for corrections and drains your team. A process audit turns impressions into a clear map and helps you choose a first change you can measure.',auditSelfCta:'Map a process with an AI guide ↗',auditMeetingCta:'Book a consultation',auditNote:'One real order is enough. You do not need a complete analysis.'});\n`;
  translations=translations.replace(marker,additions+marker);
  await fs.writeFile('public/app.js',translations);
}
console.log(`Generated ${articles.length} process-audit articles.`);
