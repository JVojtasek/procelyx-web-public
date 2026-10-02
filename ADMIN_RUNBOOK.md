# PROCELYX — správa webu

## Kde co je

- GitHub: `JVojtasek/procelyx-web-public`, produkční větev `procelyx-live` (kořen repozitáře = web). Do přepojení Cloudflare Workers Builds na tento repozitář se produkce nasazuje z původního privátního repozitáře (viz CLAUDE.md, sekce Nasazení).
- Cloudflare Worker procelyx-web, doména https://procelyx.cz; www přesměruje na hlavní doménu.
- Formulář: Cloudflare → Google Apps Script / MailApp → jarda.vojtasek@procelyx.cz v Google Workspace. Původní jarda@procelyx.cz a info@procelyx.cz jsou aliasy téže schránky. Resend je zachovaný pro řízené záložní přepnutí.
- Rezervace: odkaz v kontaktní sekci vede na soukromý typ schůzky „Úvodní konzultace PROCELYX“ v Microsoft Bookings. Trvá 60 minut, online přes Teams, úterý až pátek 13:00–15:00, nejdříve za 1 den a nejvýše 30 dní dopředu. Dostupnost se řídí pracovním kalendářem Outlook; pozvánky i údaje o rezervaci zpracovává prostředí Microsoft 365 organizace ARKANCE. Odkaz i podmínky zpracování změňte, pokud se schůzky přesunou do samostatného účtu PROCELYX.
- Pravidla repozitáře (CODEOWNERS, ruleset, `content-guard`) popisuje `CLAUDE.md`. Ruleset zatím neplatí (čeká na A1: veřejné repo nebo GitHub Pro) a podepisování commitů na A6; pořadí kroků a stav je v `CLAUDE.md`, oddíl „Stav hranice“. Do té doby neinstalovat GitHub App Nexusu do tohoto repa.

## Změny obsahu

Obsah úvodní stránky je jako data v `content/` (kontrakt `contract/nexus.site.v1.md`):

- `content/site.json`: jméno, IČO, sídlo, e-mail, telefon, titulky CZ/EN, SEO titulek a popis, ukázkový chat. Sídlo se zobrazí pouze na právní stránce; neposílá se v konfiguraci hlavní stránky.
- `content/i18n/cs.json` a `en.json`: všechny texty úvodní stránky (stejné klíče v obou jazycích, bez HTML). Build vloží české texty přímo do HTML a oba jazyky publikuje jako `/i18n.js`.
- `content/media.json`: který obrázek z knihovny ukazují obrázkové sloty (fotografie zakladatele `founderImage`, obrázky příkladů `caseImage1–3`). Knihovnu `content/media-library.json` generuje build ze všech rastrových souborů v `public/images/`. Fotografie zakladatele je nyní `public/images/jaroslav-vojtasek-procelyx.webp`, 1120 × 1400 px; původní nahraná fotografie zůstává mimo Git.
- `content/manifest.json`: které texty a obrázky smí Nexus One měnit (sloty, délky, úrovně T2/T3/DEV).

Po úpravě spusťte `npm run build` (obsahuje validaci `tools/validate-content.mjs`). Články jsou v `public/clanky/`.

Články z Nexus One (Redakce › Články) jsou data v `content/articles/<slug>.json` (kontrakt `contract/nexus.article.v1.md`). Nexus je přidává přes pull request z větve `nexus-chg-*` po schválení člověkem; build z nich vyrobí stránku, kartu ve výpisu `/clanky/` a URL v `sitemap.xml`. **Vygenerované stránky nekommitujte** (jsou v `.gitignore`). Stažení článku z webu = smazání souboru `content/articles/<slug>.json` (lidský PR, nebo návrat změny v Nexusu); stránka, karta i sitemap zmizí při dalším buildu.

Právní texty mají zdroj v `tools/legal-pages.mjs`. Po úpravě spusťte `node tools/legal-pages.mjs` a `npm run build`. Podmínky jsou české pro jednotlivě sjednávané B2B služby. Před spotřebitelskými objednávkami či placenými workshopy připravte odpovídající spotřebitelské informace a smluvní postup.

Infografiky mají zdroj v `tools/article-graphics.mjs`; generují se příkazem `node tools/article-graphics.mjs`. Web používá WebP, JPEG slouží ke sdílení, SVG je editovatelný zdroj. Nepotřebují placenou obrázkovou službu.

## Kontrola a zveřejnění

```powershell
npm ci
npm run build
npm test
npm run check
npx wrangler deploy --dry-run
```

Pro systémové certifikáty pracovní stanice lze nastavit `$env:NODE_USE_SYSTEM_CA='1'`. Nikdy nevypínejte ověřování TLS.

Změny jdou přes pull request do větve `procelyx-live`; po sloučení Cloudflare Workers Builds automaticky nasadí změnu. Nastavení: production branch `procelyx-live`, deploy command `npx wrangler deploy`, buildy ostatních větví vypnuté. Wrangler při deployi spouští sestavení statických stránek.

Po deployi ověřte build a spusťte `node tools/check-site.mjs --production`. Otevřete mobilní a desktopovou verzi a ověřte formulář skutečnou zprávou. Články mají indexaci povolenou; právní stránky mají noindex,follow a odkazy v patičce.

## Nastavení formuláře

Ve `wrangler.jsonc`:

- CONTACT_PROVIDER: google (hlavní kanál) nebo resend (řízené záložní přepnutí).
- CONTACT_TO: příjemce poptávek, nyní jarda.vojtasek@procelyx.cz. Při odesílání z vlastního Workspace účtu přímo na jeho primární adresu se zpráva zobrazí v Doručené poště; při odeslání na vlastní alias ji Gmail může ponechat jen v Odeslaných.
- CONTACT_FROM: PROCELYX Web <web@procelyx.cz>, musí patřit ověřené doméně v Resend.
- CONTACT_ENABLED: true; false bezpečně vypne odesílání a ukáže alternativní kontakt.
- CONTACT_RATE_LIMITER: 5 odeslání za 60 sekund na IP v dané lokalitě Cloudflare. Jde o základní ochranu, nikoli globální rozpočet e-mailů.

Ve Cloudflare Worker Settings → Variables and secrets → Production jsou pro Google šifrované GOOGLE_MAIL_URL a GOOGLE_MAIL_SECRET. Hodnota druhého musí odpovídat CONTACT_SHARED_SECRET ve Script Properties. CONTACT_TO ve Script Properties musí odpovídat příjemci ve Workeru. Pro případné záložní odesílání zůstává RESEND_API_KEY omezený na doménu procelyx.cz. Hodnoty klíčů nepatří do GitHubu, site.json, frontendu ani dokumentace.

Nasazení a opravy Google brány popisuje `integrations/google-mail/README.md`. Zdrojový kód i manifest jsou ve stejné složce. Skript běží pod přejmenovaným účtem jarda.vojtasek@procelyx.cz s jediným oprávněním odesílat e-maily. Odesílání není bez limitu: brána má strop 500 unikátních zpráv za klouzavých 24 hodin a respektuje zbývající kvótu Google.

Veřejný e-mail v site.json a příjemce CONTACT_TO jsou samostatné položky. Při změně schránky zkontrolujte obě. Klíč se mění pouze v zabezpečeném nastavení Workeru.

Formulář přijme jen JSON POST z produkčních domén, validuje pole, escapuje HTML a má honeypot, časový limit, rate limit a potlačení duplicit při opakování. Google brána ověřuje HMAC podpis celého požadavku a čas. Úspěch znamená přijetí zprávy poskytovatelem, nikoli potvrzení doručení. Při chybě zůstává text vyplněný. Reply-To míří na zákazníka. Aplikace nezapisuje obsah poptávek do logů. Ukládá se pouze technický otisk a stav odeslání s platností 24 hodin; staré položky se odstraňují při dalším požadavku.

Lokální server nemá produkční klíč a odmítá odesílání z localhostu; to je očekávané. Backendové testy používají náhradního poskytovatele. Produkční klíč není třeba kopírovat do počítače.

### Když zprávy nechodí

1. Ověřte poslední Cloudflare build a dostupnost webu.
2. Zkontrolujte CONTACT_PROVIDER. Pro Google ověřte Apps Script → Executions, aktuální deployment `/exec`, vlastníka, autorizaci a shodu Script Properties s Workerem. Pro Resend ověřte Domains → procelyx.cz a chyby DNS.
3. Ověřte secret, proměnné a rate-limit binding produkčního Workeru.
4. V Gmailu vyhledejte konkrétní test včetně Odeslaných. Při používání Resendu ověřte také jeho stav accepted/sent/delivered/bounced. Delivered znamená přijetí poštovním serverem, nikoli přečtení.
5. Vyhledejte stejný předmět v Gmailu včetně spamu; zkontrolujte Reply-To.
6. HTTP 400/403/415: neplatný požadavek; 429: četnost; 503: konfigurace/vypnutí; 502: odeslání. Nelogujte klíče ani obsah zpráv.

Worker má zapnuté vlastní diagnostické logy, automatické invocation logs jsou vypnuté. `contact_provider_rejected` obsahuje pouze HTTP status, bezpečný kód chyby a informaci o JSON odpovědi; `contact_operation_failed` pouze fázi a příznak timeoutu. Neobsahují obsah formuláře ani odpověď poskytovatele. Při 502 ověřte nejprve stav domény; platný klíč k neověřené doméně nestačí.

Google chyby se logují jako `contact_google_rejected` bez obsahu zprávy. `delivery_uncertain` vyžaduje nejdříve kontrolu schránky; timeout neznamená, že se nic neodeslalo. Automatické přepínání mezi poskytovateli je vypnuté, aby nevznikaly duplicity. Před změnou CONTACT_PROVIDER na resend musí být doména ověřená a provedeno skutečné doručení testu.

Google Workspace DNS kvůli webu neměňte. Přidané Resend záznamy jsou pouze TXT resend._domainkey, MX a TXT send, CNAME rsend. Aktuální DKIM obsah je v Resend. Google MX/SPF/DKIM zůstávají původní. Sledování otevření a kliknutí v Resend je vypnuté.

## Náklady

Statický web a ukázky nevolají placený AI model. Nebyl přidán nový placený tarif. Cloudflare a Resend mají vlastní limity účtu; překročení a existující předplatné se řídí dodavatelem. Resend Free při nastavení uvádí 3 000 e-mailů měsíčně a 100 denně. Před změnou tarifu ověřte aktuální ceník.

## Osobní údaje a právní dokumenty

Policy musí odpovídat skutečné správě schránky. Poptávky bez navazující smlouvy vymažte nejpozději 12 měsíců po posledním věcném kontaktu; web toto mazání automaticky neprovádí. Každý měsíc projděte staré zprávy a zohledněte kopie u zpracovatelů. Smluvní dokumentaci ponechte po potřebnou dobu podle policy, zákonné doklady podle příslušné lhůty. Právní nároky mohou vyžadovat delší uchování nezbytného rozsahu.

Žádosti o přístup, opravu, výmaz a námitky přijímá veřejný e-mail. Evidujte přijetí, přiměřeně ověřte totožnost a odpovězte zpravidla do jednoho měsíce. Před novou analytikou nebo sledováním upravte souhlasy a policy. Dnes nejsou reklamní ani analytické nástroje; jazyk se drží v sessionStorage v relaci karty.

Uchovejte doklady o použitelných zpracovatelských podmínkách Cloudflare, Resend a Google Workspace a ověřujte uchování/přístupy u účtů. Evropský region Resend nezaručuje výhradní zpracování v EU. Před zpracováním osobních údajů zákazníka v zakázce uzavřete samostatnou zpracovatelskou smlouvu a sjednejte subdodavatele.

Podmínky se uplatní až zahrnutím do konkrétní nabídky/smlouvy. Formulář nezakládá placenou objednávku. Finanční limit náhrady škody se sjednává samostatně podle rizika a zákonných omezení. Podmínky nejsou příslibem nulové odpovědnosti. Před významnými zakázkami nechte smluvní rámec prověřit českým advokátem.

Zdroje ověřené při přípravě: [občanský zákoník, § 435 a § 2898](https://www.zakonyprolidi.cz/cs/2012-89), [ÚOOÚ — cookies](https://uoou.gov.cz/verejnost/qa-otazky-a-odpovedi/cookies), [práva subjektů údajů](https://uoou.gov.cz/poradna/poradna-gdpr/prava-subjektu-udaju), [Resend DPA](https://resend.com/legal/dpa), [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), [Google Workspace DPA](https://workspace.google.com/terms/dpa_terms.html).

## QR vizitka a úvod po auditu

Tlačítko QR v horní liště vede na `/qr/`. Stránka nabízí velký kód, stažení offline obrázku a veřejného kontaktu ve formátu vCard. QR obsahuje přímo `https://procelyx.cz/`, bez placeného přesměrování. Obrázky `public/images/procelyx-qr.png` a `procelyx-vizitka.png` generuje interní nástroj mimo tento repozitář a ověří skutečné dekódování obou obrázků i zmenšeného kódu. Při změně veřejného jména, telefonu či e-mailu regenerujte také obrázek vizitky. vCard se aktualizuje běžným buildem z `config/site.json`; domácí adresu neobsahuje.

Na Androidu otevřete `https://procelyx.cz/qr/` v Chrome a vytvořte zástupce na ploše nazvaný PROCELYX QR. Pro použití bez připojení si předem stáhněte obrázek; webová zkratka sama není offline aplikace. Zákazník potřebuje internet k otevření webu.

Hlavní stránka má interaktivní modelový proces, portrét v úvodu a dříve umístěné O mně. Tři hlavní projekty jsou viditelné, další jsou rozbalovací. Technická simulace exportuje skutečné CSV s vybranými modelovými položkami. Chat zůstává lokálním průvodcem a odkazuje na skutečný kontakt.

Formulář nyní vyžaduje pouze jméno, e-mail a zprávu. Firma, telefon a oblast jsou volitelné i na serveru. Bez firmy se v předmětu použije jméno; chybějící kontext je v e-mailu označený. API, ochrany, Google brána a DNS zůstávají stejné.

## Návrat a rozšíření — postup

Při problému použijte Cloudflare Deployments → Rollback na ověřenou verzi. Potom vraťte odpovídající commit přes git revert, aby další automatický deploy chybu nevrátil. Neprovádějte force push ani změny DNS jako náhradu rollbacku aplikace.

## Napojení na Nexus One

Poptávka z formuláře se po přijetí e-mailu navíc předá do Nexus One (CRM PROCELYX). E-mail i odpověď návštěvníkovi zůstávají stejné; výpadek Nexus One poptávku neblokuje ani neztratí. Přeposílání je **vypnuté**, dokud `NEXUS_ENABLED` není `"true"`.

Proměnné ve `wrangler.jsonc` → `vars`:

- `NEXUS_ENABLED`: `"false"` (výchozí, nic se nepřeposílá) / `"true"`. Rollback = vrátit na `"false"`; e-maily běží dál, fronta zůstane do vypršení.
- `NEXUS_INBOUND_URL`: `https://<adresa Nexus One>/api/public/v1/inbound` — před zapnutím ověřte skutečnou produkční adresu Nexus One.
- `NEXUS_WEBSITE_KEY`: veřejný klíč webu `ws_…` z Nexus One (Web → Nastavení).
- Secret `NEXUS_INBOUND_SECRET` (podpisový klíč, min. 32 znaků) jen přes `npx wrangler secret put NEXUS_INBOUND_SECRET` — nikdy do Gitu, site.json ani dokumentace.
- KV binding `NEXUS_QUEUE` (fronta): `npx wrangler kv namespace create procelyx-web-nexus-queue` a vrácené `id` doplnit do `kv_namespaces` ve `wrangler.jsonc` (šablona je tam v komentáři). Bez bindingu zůstává přeposílání vypnuté.
- Cron `*/5 * * * *` (`triggers`) každých 5 minut znovu odešle poptávky z fronty.

Postup zapnutí: 1) nasadit web s `NEXUS_ENABLED: "false"` a novou stránkou Ochrana údajů (musí být veřejná dřív, než se přeposílání zapne); 2) vytvořit KV a doplnit binding; 3) v Nexus One připojit web, doplnit `NEXUS_WEBSITE_KEY` a secret; 4) commit `NEXUS_ENABLED: "true"` → nasazení; 5) testovací poptávka „TEST – ignorovat“ a kontrola v Nexus One (Web → Poptávky).

Jak funguje fronta: každá událost je podepsaná (`X-Nexus-Signature: v1=HMAC-SHA256`, časové okno 300 s) a nese `idempotencyKey` = `submissionId` formuláře, takže opakování nikdy nevytvoří duplicitu. Při chybě 429/5xx, výpadku sítě nebo timeoutu (8 s) se událost uloží do KV jako `q:<idempotencyKey>` a opakuje se s rostoucím odstupem (5 min … 6 h). 401/403 (nový klíč ještě není ve Workeru, vypnutý modul Web) se opakuje nejdříve po hodině. 413/422 (Nexus událost odmítl) se neopakuje a uloží se jako `dead:<idempotencyKey>` na 7 dní. Položka, které by vypršela 7denní lhůta fronty, se také přesune do `dead:` (důvod `expired`). Celkem poptávka v KV nikdy nezůstane déle než 14 dní od prvního pokusu (tuto lhůtu uvádí privacy.html); ruční přehrání přes `tools/replay-dead.mjs` začíná novou lhůtu. Logy obsahují jen stav, počet pokusů a výsledek, nikdy obsah poptávky.

Kontroly:

- Fronta: `npx wrangler kv key list --binding NEXUS_QUEUE --remote --prefix q:` — běžně prázdná.
- **Po každém nasazení webu i Nexus One:** `npx wrangler kv key list --binding NEXUS_QUEUE --remote --prefix dead:` musí být prázdné. Jinak zjistěte důvod (metadata `reason`/`status`: `rejected` 413/422 = oprava na straně Nexus One nebo webu, `expired` = Nexus One byl nedostupný déle než týden) a po opravě přehrajte: `node tools/replay-dead.mjs` (výpis, nic nemění), `node tools/replay-dead.mjs --key <uuid>` nebo `--all`. Přehrané položky odešle nejbližší cron.
- Workers Logs: denně hledejte `nexus_queue_stale` (nejstarší položka fronty je starší než 48 h), dokud nebude nastavený alert. Souhrn každého běhu je `nexus_drain` (`queued`, `sent`, `requeued`, `dead`, `oldestAgeH`).
- Rotace klíče v Nexus One: nový secret nastavte do Workeru (`npx wrangler secret put NEXUS_INBOUND_SECRET`) do 24 hodin — předchozí klíč platí ještě 24 h a Nexus One v Nastavení ukazuje varování, dokud Worker používá starý klíč. Ztracený klíč se neobnovuje, řeší se novou rotací.

Lokální test proti lokálnímu Nexus One (mimo `npm test`, žádný skutečný e-mail): `node tools/e2e-nexus.mjs` — popis v hlavičce souboru.
