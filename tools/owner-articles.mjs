/** Editorial source for practical owner-focused articles. Run: node tools/owner-articles.mjs */
import fs from 'node:fs/promises';
import {load} from 'cheerio';

const published='2026-09-28';
const articles=[
  {
    slug:'jak-zrychlit-prutok-zakazek-firmou',
    title:'Jak zrychlit průtok zakázek firmou bez dalšího chaosu',
    description:'Zakázky čekají mezi obchodem, realizací a fakturací? Naučte se změřit průběžnou dobu, odhalit čekání a zrychlit předání bez velkého IT projektu.',
    category:'ZAKÁZKY · RŮST FIRMY',
    lead:'Zakázka může být hotová za tři dny práce a přesto se k zákazníkovi dostane za tři týdny. Kde zmizel zbytek času?',
    image:'jak-zrychlit-prutok-zakazek-firmou',
    alt:'Tým malé firmy společně plánuje předání zakázek mezi obchodem a realizací.',
    teaser:'Práce trvá tři dny, zákazník čeká tři týdny. Zjistěte, kde se zakázka zdržuje a jak zkrátit cestu od poptávky k předání.',
    related:[['jak-najit-uzka-hrdla-ve-firme','Jak najít úzká hrdla'],['automatizace-servisni-firmy-od-poptavky-po-fakturaci','Automatizace servisní firmy']],
    body:`<p>Majitel malé firmy často slyší: „Lidé jsou vytížení, potřebujeme dalšího člověka.“ Někdy ano. Jindy lidé pracují rychle, jen zakázka čeká na zadání, schválení, podklady nebo odpověď z jiného oddělení. Váš problém pak není rychlost jednotlivce, ale <strong>průtok celé zakázky</strong>.</p>
<h2>Nejdřív oddělte práci od čekání</h2><p>Vezměte pět nedávných zakázek. U každé si zapište datum přijetí poptávky, vytvoření nabídky, schválení, zahájení práce, předání a fakturace. Mezi těmito body rozlište aktivní práci a čekání. Například nabídka vznikla za 90 minut, ale na cenové podklady se čekalo čtyři dny. Zrychlení psaní nabídky o polovinu ušetří 45 minut; vyřešení předání podkladů může vrátit celé dny.</p>
<div class="painbox"><b>Malý test na tento týden</b><p>U jedné zakázky se zeptejte: Kdo má právě další krok? Co mu chybí? Kdo rozhodne, že může pokračovat? Pokud odpověď najdete až po sérii telefonátů, máte první místo k nápravě.</p></div>
<h2>Nakreslete skutečnou cestu jedné zakázky</h2><p>Začněte prvním kontaktem a skončete až zaplacením. U každého kroku uveďte vlastníka, vstup, výstup, používaný systém a předání dál. Neopisujte interní směrnici; projděte konkrétní zakázku z minulého týdne. Když se musela vrátit kvůli chybějícímu zadání, zakreslete i návrat. Když obchodník zapisuje stejná data do e-mailu, tabulky a CRM, ukažte všechna tři místa.</p>
<h2>Tři zásahy, které často pomohou dřív než nová aplikace</h2><ol><li><strong>Jasný minimální vstup.</strong> Domluvte se, bez kterých údajů nelze připravit nabídku ani začít práci. U různých typů zakázek může být seznam jiný.</li><li><strong>Jeden vlastník dalšího kroku.</strong> Každá otevřená zakázka má stav, odpovědnou osobu a termín další akce. Stav „čeká se“ musí říkat na koho a na co.</li><li><strong>Jedno předání dat.</strong> Schválená nabídka a přílohy se předají do realizace jako platný balíček. Změny se označují verzí, ne názvem „final_v3_opravene“.</li></ol>
<h2>Kdy zapojit automatizaci</h2><p>Jakmile znáte pravidla, lze automaticky vytáhnout údaje z poptávky, upozornit na chybějící podklady, založit navazující úkol nebo připravit zákazníkovi zprávu o stavu. Nejasné zadání, cena a změna rozsahu ale patří člověku ke schválení. Automatizace má zkrátit čekání a ruční přepis, nikoli rychleji šířit chybná data.</p>
<h2>Co měřit po změně</h2><p>Sledujte medián doby od poptávky k nabídce, od schválení k zahájení a od dokončení k fakturaci. Přidejte počet vrácení k doplnění a počet zakázek bez určeného dalšího kroku. Měřte stejným způsobem před pilotem i po něm. Pokud se zlepší jen rychlost jednoho oddělení, ale zákazník čeká stejně dlouho, hledali jste na špatném místě.</p>
<p><strong>Začněte jedním tokem zakázky.</strong> Malá změna v předání může přinést větší klid než další dashboard. Podrobnější postup k měření najdete v článku <a href="/clanky/jak-najit-uzka-hrdla-ve-firme/">o úzkých hrdlech</a>.</p>`
  },
  {
    slug:'jak-najit-uzka-hrdla-ve-firme',
    title:'Jak najít úzká hrdla ve firmě a spočítat jejich cenu',
    description:'Praktický návod pro majitele malé a střední firmy: kde hledat zdržení v procesu, jak měřit četnost, čas a finanční dopady a co řešit jako první.',
    category:'PROCESY · ÚZKÁ HRDLA',
    lead:'Když je každý „na sto procent vytížený“, ještě to neznamená, že firma pracuje plynule. Možná právě všichni čekají na stejné místo.',
    image:'jak-najit-uzka-hrdla-ve-firme',
    alt:'Vedoucí provozu s kolegyní zkoumají zpožděné zakázky na plánovací tabuli.',
    teaser:'Kde přesně zakázka stojí a kolik vás to stojí? Jednoduchý postup od mapy procesu k měřitelnému pilotu.',
    related:[['jak-zrychlit-prutok-zakazek-firmou','Jak zrychlit průtok zakázek'],['jak-spocitat-navratnost-ai-automatizace','Jak spočítat návratnost automatizace']],
    body:`<p>Úzké hrdlo není vždy člověk, který „nestíhá“. Může jím být neúplné zadání, jediný schvalovatel, stará verze výkresu, nepřipojený systém nebo faktura, která čeká na potvrzení dokončené práce. Když se zaměříte jen na nejhlasitější stížnost, můžete odstranit nepříjemnost, ale ne největší ztrátu.</p>
<h2>Ptejte se na jednu skutečnou zakázku</h2><p>Vyberte typický případ, nikoli ideální. Nechte člověka, který práci dělá, ukázat e-maily, soubory a skutečná předání. Ptejte se: Co krok spustilo? Co muselo být připravené? Kdy práce začala a skončila? Na co se čekalo? Kam šel výstup? Kdy se vracel k opravě? U služeb to může být cesta od telefonu k servisnímu protokolu, u projekce od zadání k platné revizi, u výroby od poptávky k expedici.</p>
<h2>Pět čísel, která stačí na začátek</h2><ol><li><strong>Četnost:</strong> kolikrát se problém objeví za týden nebo měsíc.</li><li><strong>Čas na výskyt:</strong> kolik minut zabere dohledání, přepis, oprava nebo ruční kontrola.</li><li><strong>Čekání:</strong> kolik hodin či dnů stojí zakázka, než může pokračovat.</li><li><strong>Přímý dopad:</strong> reklamace, přesčas, expresní doprava, storno nebo nevyfakturovaná práce.</li><li><strong>Dotčené zakázky:</strong> zda jde o výjimku, nebo o běžnou součást práce.</li></ol>
<p>Výpočet držte jednoduchý: <strong>počet výskytů za měsíc × minuty na výskyt ÷ 60 = hodiny ruční práce za měsíc</strong>. Přímé finanční ztráty počítejte zvlášť. Hodiny čekání nepřevádějte automaticky na mzdu: jsou důležité pro termín dodání a kapacitu, ale nejsou totéž jako odpracované hodiny. Neznáte přesné číslo? Označte jej jako odhad a ověřte během pilotu.</p>
<div class="painbox"><b>Ilustrační příklad, nikoli výsledek klienta</b><p>Firma doplňuje podklady u 20 poptávek měsíčně a každé doplnění zabere průměrně 15 minut aktivní práce. To je 5 hodin měsíčně. Pokud ale každá poptávka navíc čeká dva dny, hlavní přínos nemusí být úspora pěti hodin, nýbrž rychlejší odpověď zákazníkovi. Obě hodnoty měřte odděleně.</p></div>
<h2>Hledejte příčinu, ne viníka</h2><p>U každého místa napište, proč podle týmu vzniká. Přichází neúplné podklady? Není jasné, kdo schvaluje změnu? Zůstává platná verze v osobní schránce? Co dnes lidé dělají, aby se problém neopakoval? Někdy má tým chytrou ruční kontrolu, kterou by automatizace měla zachovat. Jindy jen hasí opakovanou výjimku.</p>
<h2>Jak vybrat první změnu</h2><p>Upřednostněte problém, který je častý, měřitelný, má jasného vlastníka a lze jej zkusit na malém vzorku. U kritických dokumentů či ceny zachovejte lidské schválení. Po dvou až čtyřech týdnech porovnejte stejná čísla jako před změnou. Pokud chyba nezmizela nebo se přesunula do dalšího oddělení, pilot upravte; neslavte jen vyšší rychlost jednoho kroku.</p>
<p>Na <a href="/clanky/jak-spocitat-navratnost-ai-automatizace/">návratnost automatizace</a> má smysl navázat až ve chvíli, kdy víte, co je skutečně ztráta, co čekání a co je pouze nepříjemný pocit.</p>`
  },
  {
    slug:'je-ai-vhodna-pro-automatizaci-vasi-firmy',
    title:'Je AI vhodná pro automatizaci vaší firmy? Rozhodněte podle procesu',
    description:'AI není odpověď na každý problém. Poznejte, kdy ve firmě použít pravidla, integraci nebo AI a jak spustit bezpečný pilot s měřitelným přínosem.',
    category:'AI · ROZHODOVÁNÍ',
    lead:'„Potřebujeme AI.“ Možná. Ale pokud tým třikrát opisuje stejný údaj, začal bych otázkou, proč ho vůbec zapisuje třikrát.',
    image:'je-ai-vhodna-pro-automatizaci-vasi-firmy',
    alt:'Majitelka a kolega porovnávají firemní dokumenty s daty v počítači při rozhodování o automatizaci.',
    teaser:'Kdy stačí pravidlo nebo integrace a kdy se vyplatí AI? Rozhodovací rámec pro majitele firmy bez technologického balastu.',
    related:[['jak-najit-procesy-pro-ai-automatizaci','Které procesy automatizovat'],['human-in-the-loop-ai-automatizace','Kdy musí rozhodnout člověk']],
    body:`<p>AI může číst e-maily, shrnout dokumenty a navrhnout odpověď. Umí ale také sebejistě doplnit údaj, který v podkladu není. Proto otázka nezní „Můžeme sem dát AI?“, nýbrž <strong>„Jaký úkon potřebujeme zlepšit, z jakých dat a s jakou kontrolou?“</strong></p>
<h2>Začněte rozhodovacím testem</h2><p>Pokud má krok přesná pravidla a strukturovaná data, začněte běžnou automatizací nebo propojením systémů. Například schválená objednávka se přenese do fakturačního systému s číslem zakázky. AI je užitečná tam, kde člověk dnes čte volný text, různé dokumenty nebo obrázky a hledá v nich význam. Typickým příkladem je poptávka v e-mailu s přílohami, ze které chcete vytáhnout termín, rozsah a chybějící podklady.</p>
<div class="painbox"><b>Tři možné odpovědi na stejný problém</b><p>„Informace z poptávky nejsou v evidenci.“ Při standardním formuláři stačí integrace. Při volných e-mailech může AI navrhnout strukturovaný zápis. Když se zadání mění po telefonu a nikdo není vlastníkem, nejdřív je třeba určit pracovní postup a odpovědnost.</p></div>
<h2>Kde AI pomáhá a kde má zastavit</h2><p>Dobrý pilot má jasný vstup, požadovaný výstup, ukázky správných i chybných případů a člověka, který výsledek potvrdí. AI může předvyplnit údaje a označit nejistotu. Neměla by sama bez kontroly schvalovat cenu, smlouvu, technickou revizi ani slibovat termín, který nezná. To platí zvlášť v zakázkové výrobě, projekci a službách s individuálními podmínkami.</p>
<h2>Co si připravit před pilotem</h2><ol><li><strong>Jeden konkrétní scénář.</strong> Například příjem a třídění poptávek, nikoli „AI pro celý obchod“.</li><li><strong>Deset až dvacet reprezentativních ukázek.</strong> Včetně neúplných, neobvyklých a chybně popsaných případů; citlivá data předem anonymizujte.</li><li><strong>Pravidlo úspěchu.</strong> Co musí být správně, co se smí navrhnout a kdy se případ předá člověku.</li><li><strong>Výchozí čísla.</strong> Četnost, ruční čas, počet oprav, doba odpovědi zákazníkovi.</li><li><strong>Vlastníka procesu.</strong> Kdo bude výsledek kontrolovat a upravovat pravidla.</li></ol>
<h2>Jak poznáte, že investice dává smysl</h2><p>Porovnejte čas a chybovost na stejném typu případů před pilotem a po něm. Započtěte i čas lidské kontroly, provoz modelu, správu integrace a řešení výjimek. Pilot nemusí automatizovat vše. Pokud bezpečně zvládne většinu běžných případů a složité předá odborníkovi, může firmě ulevit víc než velká, křehká automatizace.</p>
<p>Nejlepší výsledek někdy zní: „AI zatím nepotřebujete.“ Když nejprve opravíte vstupní formulář, označování verzí nebo předání mezi systémy, bude případná AI později přesnější i levnější. Pro výběr prvního kandidáta využijte <a href="/clanky/jak-najit-procesy-pro-ai-automatizaci/">seznam signálů vhodného procesu</a>.</p>`
  }
];

const template=await fs.readFile('public/clanky/jak-najit-procesy-pro-ai-automatizaci/index.html','utf8');
const escapeHtml=(value)=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
for(const item of articles){
  const $=load(template);
  const url=`https://procelyx.cz/clanky/${item.slug}/`;
  $('title').text(`${item.title} | PROCELYX`);
  $('meta[name="description"],meta[property="og:description"]').attr('content',item.description);
  $('link[rel="canonical"]').attr('href',url);
  $('meta[property="og:title"]').attr('content',item.title);
  $('meta[property="og:url"]').attr('content',url);
  $('meta[property="og:image"]').attr('content',`https://procelyx.cz/images/articles/${item.image}.jpg`);
  $('.articleHero .breadcrumbs').html(`<a href="/">PROCELYX</a> / <a href="/clanky/">Články</a> / ${escapeHtml(item.category)}`);
  $('.articleHero .eyebrow').text(item.category);
  $('.articleHero h1').text(item.title);
  $('.articleHero .lead').text(item.lead);
  $('.articleHero .meta').html('<span>Praktický průvodce</span><span>28. 9. 2026</span><span>Redakce PROCELYX</span>');
  $('.articleHero .articleVisual').html(`<img src="/images/articles/${item.image}.webp" width="1200" height="675" alt="${escapeHtml(item.alt)}" decoding="async" fetchpriority="high">`);
  const infographic=`<figure class="articleInlineVisual"><img src="/images/articles/${item.slug}-infografika.webp" width="1200" height="675" loading="lazy" decoding="async" alt="Schéma článku ${escapeHtml(item.title)}: konkrétní kroky a rozhodovací body."><figcaption>Praktické schéma k tématu článku. Ilustrační hodnoty jsou výslovně označené.</figcaption></figure>`;
  const bodyWithDiagram=item.body.replace('</div>',`</div>${infographic}`);
  $('.articleBody .wrap').html(`${bodyWithDiagram}<div class="ctaBox"><h3>Chcete najít první smysluplný krok u Vás?</h3><p>Popište mi, kudy prochází jedna zakázka a kde se zdržuje. Společně oddělíme odhad od faktů a navrhneme malý ověřitelný pilot.</p><a class="btn" href="/#contact">Probrat můj proces</a></div><h2>Související články</h2><div class="related">${item.related.map(([slug,title])=>`<a href="/clanky/${slug}/">${escapeHtml(title)} →</a>`).join('')}</div>`);
  $('script[type="application/ld+json"]').text(JSON.stringify({'@context':'https://schema.org','@type':'Article',headline:item.title,description:item.description,datePublished:published,dateModified:published,author:{'@type':'Person',name:'Jaroslav Vojtášek'},publisher:{'@type':'Organization',name:'PROCELYX',url:'https://procelyx.cz/'},mainEntityOfPage:url,image:`https://procelyx.cz/images/articles/${item.image}.jpg`}));
  await fs.mkdir(`public/clanky/${item.slug}`,{recursive:true});
  await fs.writeFile(`public/clanky/${item.slug}/index.html`,$.html());
}

// The service article already has a process diagram. Add a distinct field handoff photograph.
const existingPhotos=[
  ['automatizace-servisni-firmy-od-poptavky-po-fakturaci','servisni-firma-predani-zakazky','Servisní technik předává protokol kanceláři, kde navazuje další zpracování zakázky.','Předání mezi prací v terénu a administrativou je časté místo ručního přepisu.'],
];
for(const [slug,image,alt,caption] of existingPhotos){
  const path=`public/clanky/${slug}/index.html`;
  const $=load(await fs.readFile(path,'utf8'));
  if(!$('.articleBody .articleInlineVisual').length){
    $('.articleBody .wrap > h2').first().before(`<figure class="articleInlineVisual"><img src="/images/articles/${image}.webp" width="1200" height="675" loading="lazy" decoding="async" alt="${escapeHtml(alt)}"><figcaption>${escapeHtml(caption)}</figcaption></figure>`);
    await fs.writeFile(path,$.html());
  }
}

const $index=load(await fs.readFile('public/clanky/index.html','utf8'));
$index('title').text('Články o automatizaci procesů pro firmy | PROCELYX');
$index('meta[name="description"]').attr('content','Praktické články pro majitele menších a středních firem: průtok zakázek, úzká hrdla, měření ztrát a rozhodování, kde pomůže AI automatizace.');
$index('.articleHero h1').text('Méně čekání. Plynulejší zakázky. AI tam, kde dává smysl.');
$index('.articleHero .lead').text('Praktické návody pro majitele a manažery menších a středních firem. Najděte ztráty v procesu, změřte dopad a začněte změnou, která pomůže lidem i zákazníkům.');
for(const item of articles){
  if($index(`.articleCards a[href="/clanky/${item.slug}/"]`).length) continue;
  $index('.articleCards').prepend(`<article class="articleCard"><a class="articleThumb" href="/clanky/${item.slug}/" tabindex="-1" aria-hidden="true"><img src="/images/articles/${item.image}.webp" alt="" width="1200" height="675" loading="lazy" decoding="async"></a><span>${escapeHtml(item.category)}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.teaser)}</p><a href="/clanky/${item.slug}/">Číst článek →</a></article>`);
}
await fs.writeFile('public/clanky/index.html',$index.html());
let sitemap=await fs.readFile('public/sitemap.xml','utf8');
for(const item of articles){const url=`https://procelyx.cz/clanky/${item.slug}/`;if(!sitemap.includes(url))sitemap=sitemap.replace('</urlset>',`<url><loc>${url}</loc><lastmod>${published}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>\n</urlset>`);}
sitemap=sitemap.replace('<loc>https://procelyx.cz/clanky/</loc><lastmod>2026-09-23</lastmod>','<loc>https://procelyx.cz/clanky/</loc><lastmod>2026-09-28</lastmod>');
await fs.writeFile('public/sitemap.xml',sitemap);
console.log(`Generated ${articles.length} articles and updated index/sitemap.`);
