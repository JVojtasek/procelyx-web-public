# Kontrakt `nexus.site.v1` — obsah webu jako data

Sdílená dohoda mezi repozitářem webu a Nexus One (úpravy webu větou přes Mozek). Nexus drží kopii tohoto
souboru v `src/lib/site/contract/README.md`. Obě strany validují **striktně**: neznámé pole = chyba.

## Soubory (`content/**`)

| Soubor | Obsah | Kdo mění |
|---|---|---|
| `content/manifest.json` | stránky → sekce → sloty (schéma `schemas/manifest.schema.json`) | jen vývoj (lidský PR) |
| `content/i18n/cs.json`, `en.json` | plochý slovník `{ "<klíč>": "<prostý text>" }`, stejné klíče v obou jazycích, bez `<` a `>` | sloty T2/T3 (Nexus), jinak vývoj |
| `content/site.json` | identita a SEO (`email`, `phone`, `founderName`, `founderTitle`, `seoTitle`, `seoDescription`, `ogImage`, `chatDemoEnabled`, `businessId`, `businessSeat`) | `seoTitle`, `seoDescription`, `founderTitle` přes sloty; identita jen vývoj |
| `content/media.json` | `{ "<mediaKey>": { "mediaId": "<id>" } }` — který obrázek z knihovny slot ukazuje | obrázkové sloty (Nexus) |
| `content/media-library.json` | `{ "<mediaId>": { "path", "width", "height" } }` — **generuje build** ze všech rastrových souborů `public/images/**` | nikdo ručně |
| `content/articles/<slug>.json` | článek publikovaný z Nexusu — **samostatný kontrakt** `contract/nexus.article.v1.md` (schéma `schemas/article.schema.json`) | Nexus (přidat, změnit, smazat po schválení člověkem) |

`mediaId` = `img-` + cesta pod `/images/` malými písmeny, `/` → `--`, ostatní znaky → `-`
(např. `/images/articles/a-b.webp` → `img-articles--a-b-webp`). SVG se do knihovny nedostane (na web jde jen rastr).

Fotografie zakladatele je **jen** v `media.json` (`founderImage`). Stará pole `site.json` `founderImage`, `founderImageWidth`
a `founderImageHeight` build nečte a schéma je odmítá jako neznámá pole (žádná přechodná záloha).

**Nahrané fotky (`content/media/**`) ve v1 zatím nejsou.** Validace soubory v `content/media/` odmítá jako neznámé a strojový PR
nesmí měnit knihovnu, takže obrázkové sloty vybírají jen z `public/images/**`. Kopírování `content/media/<sha8>.webp` →
`public/images/media/` (s kontrolou magic bytes, rozměrů a velikosti) a jeho povolení ve validaci přijde samostatným PR webu
**před** N2c (nahrávání fotek z Nexusu); N2c na něm závisí.

## Slot

```jsonc
{
  "id": "home.hero.h1",                 // stabilní ID, na stránce jako data-slot
  "type": "text",                        // text | paragraph | seo.title | seo.description | image
  "label": "Hlavní nadpis: „…“",
  "selector": "[data-slot=\"home.hero.h1\"]",
  "key": "h1",                           // vazba: právě jedno z key | siteKey | mediaKey
  "minLength": 8, "maxLength": 66,       // povinné kromě image; platí pro cs i en
  "tier": "T2",                          // T2 | T3 | DEV | NEVER
  "i18n": true,
  "related": ["home.seo.title"],         // volitelné
  "derivedAssets": [],                   // vcard | qr | vizitka-png | og-image | json-ld
  "affectsLegal": false
}
```

- **Obrázkový slot:** `mediaKey` (klíč v `media.json`) + `altKey` (`<mediaKey>.alt` v i18n), bez délek. Na stránce `<img data-slot="…">`.
- **Slot ze `site.json`:** `siteKey` (`seoTitle`, `seoDescription`, `founderTitle`, `email`, `phone`, `founderName`, `businessId`, `businessSeat`).
- **Úrovně:** `T2` obsah (schvaluje ADMIN), `T3` navigace a ovládací prvky (ADMIN, vyšší opatrnost), `DEV` jen vývojový PR, `NEVER` nikdy přes Nexus.
  Slot s `derivedAssets` nebo `affectsLegal: true` musí být `DEV` nebo `NEVER`.
- Klíče slovníku bez slotu (texty jen pro JavaScript, starší varianty) Nexus **nemění**.

## Injekce (`tools/inject.mjs`)

`injectPage(html, {i18n, site, media, library}, pageManifest, {lang = "cs"}) → html` — čistá, idempotentní funkce (jen cheerio):

1. každý `[data-t=klíč]` dostane text `i18n[lang][klíč]` (když existuje a není prázdný) — stejné pravidlo jako `setLang()` v `public/app.js`;
2. každý `[data-ph=klíč]` dostane `placeholder`;
3. textové sloty označí prvky `data-slot`; obrázkové sloty nastaví `src`, `width`, `height` z knihovny, `alt` z i18n a `data-alt` (klíč pro přepnutí jazyka);
   SEO sloty nastaví `<title>`, `meta description` a Open Graph; identitu nastaví podle `data-site`, `mailto:` a `tel:`;
4. každý `selector` slotu pak musí něco najít, jinak výjimka.

Build (`tools/build.mjs`) vloží české texty přímo do HTML a vygeneruje `public/i18n.js`
(`window.PROCELYX_I18N = {cs, en}`, verze `?v=<sha>`), takže stránka vypadá stejně před i po JavaScriptu.

**Vendoring:** Nexus drží byte-identickou kopii `src/lib/site/vendor/inject.mjs` s hlavičkou `// source-sha256: …`
a nikdy za běhu nespouští kód z repa webu.

## Fixtures

`tests/fixtures/contract/*.json` = `{name, note, lang?, html, content, manifest, expectedHtml | expectedError}` (14 případů:
text, vnořené prvky, escapování, chybějící klíč, placeholder, duplicitní klíč, obrázek, výměna obrázku, SEO, angličtina a 4 chybové).
Spouští je `tests/contract-fixtures.test.js` zde i testy v Nexusu (vendorovaná kopie ve `src/lib/site/__fixtures__/contract/`).

## Validace

- `tools/validate-content.mjs` (běží v buildu, tedy i ve Workers Builds a v `content-guard`): schémata `schemas/*.json`,
  stejné klíče cs/en, délky slotů, alt texty, `mediaId` jen z knihovny, knihovna = `public/images`, žádné neznámé soubory v `content/`, SVG jen z allowlistu prvků a atributů (odkazy jen `#id`, entity se dekódují před kontrolou, bez animací SMIL).
- Jeden klíč (`key`/`altKey`), `siteKey` nebo `mediaKey` smí vázat jen sloty stejné úrovně; hodnota je upravitelná, jen když ji
  vážou výhradně sloty T2/T3.
- `--base <adresář>` (strojové PR v `content-guard`): proti základní větvi se smí lišit **jen hodnoty slotů T2/T3**;
  manifest, sady klíčů, knihovna a vše ostatní musí zůstat stejné.
- `web-checks` po buildu ověří, že commitnutá `content/media-library.json` odpovídá `public/images` (jinak by zastaralá
  knihovna po sloučení zablokovala všechny strojové PR).
