# Kontrakt `nexus.article.v1` — články publikované z Nexus One

Sdílená dohoda mezi repozitářem webu a Nexus One (Redakce › Články). Nexus drží kopii pravidel v
`src/lib/editorial/article-contract.ts` (zod) a stejné fixtury v testech. Obě strany validují **striktně**: neznámé
pole = chyba. Navazuje na `nexus.site.v1` (obsah stránek jako data), článek je jen další typ souboru v `content/`.

## Soubor

`content/articles/<slug>.json`, jeden soubor = jeden článek. Název souboru je slug (`[a-z0-9]+(-[a-z0-9]+)*`, 3–90 znaků).
Schéma: `schemas/article.schema.json` (přítomnost tohoto souboru v repu je pro Nexus signál, že web články z Nexusu umí).

| Pole | Význam |
|---|---|
| `schema` | vždy `"nexus.article.v1"` |
| `slug` | shodný s názvem souboru; adresa `/clanky/<slug>/` |
| `version` | celé číslo, u aktualizace roste |
| `nexusId` | id článku v Nexusu (s `version` jde do `<meta name="nexus-article" content="<nexusId>:<version>">`, podle toho Nexus ověří nasazení) |
| `title`, `seoTitle`, `description`, `lead`, `teaser`, `category`, `typeLabel` | prostý text (bez `<` a `>`), délky ve schématu |
| `bodyHtml` | tělo článku, **jen povolená sada značek** (viz níže) |
| `faq` | `[{q, a}]`, nejvýš 6; web vyrobí sekci „Časté otázky“ a JSON-LD `FAQPage` |
| `related` | `[[slug, popisek]]`, nejvýš 6, slugy musí existovat (ručně psaný i Nexus článek) |
| `image` | `{mediaId, alt}` z knihovny webu (`content/media-library.json`), nebo `null`; nové soubory nahrává až R1b |
| `cta` | `{key, title, text, label, href}` (`href` vlastní stránka `/…` nebo `https://…`), nebo `null` |
| `keywords`, `aiNote` | štítky a poznámka o AI (nebo `null`) |
| `datePublished`, `dateModified` | `YYYY-MM-DD` (Europe/Prague), `dateModified >= datePublished` |

Autor v JSON-LD není v souboru: build ho bere z `content/site.json` (`founderName`), stejně jako u ručně psaných článků.

## Povolené HTML těla

`p h2 h3 ul ol li strong em a blockquote table thead tbody tr th td br`, `div.painbox` (jen s třídou `painbox`) a v něm `b`.
Odkazy jen na vlastní stránky (`/…`, ne `//`) nebo `https://…` s `rel="noopener"`. Žádné atributy kromě `href`/`rel` u `a`
a `class="painbox"` u `div`. Skripty, styly, `img`, `iframe`, komentáře a vše ostatní je chyba (validace odmítá, nic se netiše neodstraňuje).

## Co dělá build

`tools/build.mjs` (voláno i Workers Builds) zavolá `renderArticles()` z `tools/lib/articles.mjs`:

1. `public/clanky/<slug>/index.html` pro každý článek (stejná kostra a styly jako ručně psané články, JSON-LD `Article`, případně `FAQPage`),
2. karta článku (`data-nexus-article`) v `public/clanky/index.html` (nejnovější první),
3. URL v `public/sitemap.xml`,
4. smazaný soubor článku = stránka, karta i URL zmizí (jen stránky se značkou `nexus-article`).

Vygenerované stránky se **nekommitují** (vznikají při každém buildu). Ručně psaných 21 článků zůstává beze změny.
Slug nesmí kolidovat s ručně psaným článkem (`public/clanky/<slug>/` bez značky) — validace to odmítne.

## Validace a ochrana (`tools/validate-content.mjs`, `content-guard`)

- schéma + křížové kontroly: slug = název souboru, kolize s ručním článkem, obrázek v knihovně, existující `related`, datumy, odkaz výzvy;
- strojový PR (GitHub App Nexusu) smí **přidat, změnit nebo smazat jen `content/articles/*.json`** (a dál jen hodnoty slotů T2/T3); cokoli mimo `content/**` je chyba;
- `check-site.mjs` bere články z JSON jako ostatní: jeden H1, jedinečný titulek, popis, canonical, rozměry a alt obrázků, odkazy, sitemap.

## Ověření nasazení (Nexus)

Po sloučení Nexus čeká na check `Workers Builds` a stáhne `GET /clanky/<slug>/`: `<h1>` musí odpovídat titulku a
`<meta name="nexus-article">` verzi z JSON. Při neshodě zmrazí publikaci a změnu vrátí (smaže přidaný soubor).
