# PROCELYX web — pravidla pro Claude Code

Veřejný web https://procelyx.cz (Cloudflare Worker + statická aktiva). Repozitář je **veřejný**: do Gitu patří jen to, co je určené pro veřejnost (kód a obsah webu). Nikdy klíče, interní dokumenty, lokální cesty ani osobní údaje mimo veřejné kontakty.

## Příkazy
- `npm ci` — závislosti
- `npm run build` — sestavení `public/**` (cheerio, obsah a konfigurace)
- `npm test` — testy (`node:test`), jen invariantní (žádné zmrazené snapshoty textů); vyžaduje předchozí `npm run build`
- `npm run test:migration` — jednorázová migrační kontrola W0c (archiv, CI ji spustí jen při změně `tools/extract-i18n.mjs`)
- `npm run check` — kontrola odkazů, sitemap, JSON-LD
- `npm run scan:public` — sken tajemství, e-mailů, interních URL a lokálních cest; nález = stop
- `npx wrangler deploy --dry-run` — kontrola balíčku Workeru bez nasazení

## Pravidla repozitáře
1. **Hranici cest vynucuje GitHub, ne heuristika:** `.github/CODEOWNERS` má `* @JVojtasek` a `/content/` bez vlastníka; ruleset `procelyx-live` (`ops/rulesets/procelyx-live.json`, nasazuje `node ops/apply-ruleset.mjs`) vyžaduje code owner review, povinné checky `web-checks` + `content-guard` (strict) a bypass má jen role admin. GitHub App Nexusu nemá bypass, takže mimo `content/**` nesloučí nic. **Hlavní kontrolou je code owner review (CODEOWNERS)**, `content-guard` je obrana do hloubky: povinný check se v rulesetu páruje jen jménem a aplikací GitHub Actions, takže stejnojmenný check z workflow v PR by ho mohl zdánlivě splnit. Proto strojový PR nesmí měnit nic v `.github/**` (content-guard ho vždy odmítne a CODEOWNERS vyžaduje revizi majitele). **Platí až po zapnutí rulesetu, viz „Stav hranice“.**
2. PR z větví `nexus-chg-*` a PR od bota **Claude Code nikdy neslučuje ručně ani přes bypass**. Slučuje je jen dispečer Nexusu přes App.
3. Claude Code slučuje přes admin bypass **jen** vlastní PR, kde `content-guard` hlásí „lidský“ (autor admin a všechny commity podepsané klíčem majitele) a checky jsou zelené. Když `content-guard` červená, nesloučí a hledá příčinu.
4. **Před každým vypnutím rulesetu** (nouze): nejdřív suspendovat instalaci App a zapnout zmrazení publikace v Nexusu (`SITE_PUBLISH_FREEZE=1`). Po zapnutí rulesetu obojí vrátit a zapsat událost do deníku Nexusu (`AuditEvent` přes `recordEvent`/`logOperation`, Web › Změny).
5. **Nouzový návrat nasazení** (Claude Code, ne Nexus): `npx wrangler deployments list` → `npx wrangler rollback <version-id> -m "důvod"`; pak v Nexusu zmrazit publikaci, dokud se v repu neudělá revert PR.
6. Žádné Actions secrets v repu, nikdy. Workflow mají `permissions` jen pro čtení.
7. Každá změna ve feature větvi a PR do `procelyx-live`. Přímý push do `procelyx-live` je zakázaný rulesetem.

## Stav hranice (dokud tu stojí „čeká“, nepředpokládat, že platí)
- **Ruleset: čeká na A1.** Na soukromém repu bez GitHub Pro vrací `gh api repos/JVojtasek/procelyx-web-public/rulesets` HTTP 403, takže ruleset neexistuje a `node ops/apply-ruleset.mjs` skončí chybou. Dokud skript nevypíše `OK: ruleset … active`, hranici drží jen `content-guard` (bez povinnosti) a disciplína Claude Code. **Do té doby neinstalovat GitHub App Nexusu (N1) do tohoto repa.**
- **Podepisování commitů: čeká na A6.** Majitel zatím nemá na GitHubu žádný SSH podpisový klíč (`gh api users/JVojtasek/ssh_signing_keys` = prázdné) a klony, ze kterých Claude Code commituje, nepodepisují. `content-guard` proto každý PR (i PR majitele a Claude Code) klasifikuje jako strojový a PR měnící cokoli mimo `content/**` je **očekávaně červený**. Claude Code takový PR nesloučí (pravidlo 3), vlastní PR mimo `content/**` zůstávají čekat na majitele.
- **Pořadí kroků (A6 → A1 → ruleset → N1):**
  1. Vygenerovat SSH klíč pro podepisování (`ssh-keygen -t ed25519 -f <soubor>`), `gh auth refresh -s admin:ssh_signing_key`, `gh ssh-key add <soubor>.pub --type signing`.
  2. V každém klonu, ze kterého Claude Code commituje (všechny lokální klony a worktree webu): `git config gpg.format ssh`, `git config user.signingkey <soubor>.pub`, `git config commit.gpgsign true`.
  3. Rozpracované PR přepodepsat: `git rebase --exec "git commit --amend --no-edit -S" <základ>` a `git push --force-with-lease`; `content-guard` pak musí hlásit „lidský“.
  4. A1: repo veřejné (nebo GitHub Pro).
  5. `node ops/apply-ruleset.mjs` — skript odmítne pokračovat, dokud kroky 1–2 neplatí nebo rulesety nejsou dostupné.
  6. Teprve potom instalace App Nexusu (N1).

## Checky
- `web-checks` (`.github/workflows/web-checks.yml`): sken (strom + metadata commitů: u PR jen commity PR a historie základní větve, e-maily jen GitHub noreply včetně `[bot]` účtů App), build, testy, kontrola webu, `wrangler deploy --dry-run`.
- `content-guard` (`.github/workflows/content-guard.yml`, `tools/content-guard.mjs`): běží ze základní větve přes `pull_request_target`, PR čte jen jako data. Lidský PR = autor admin a všechny commity ověřeně podepsané SSH klíčem majitele; vše ostatní je strojové a smí měnit jen `content/**` (obsah se ověří nástroji základní větve nad `refs/pull/<n>/merge`).
- Lidský PR vyžaduje SSH podpis registrovaným SSH klíčem majitele (PGP/GPG ani podpis GitHubu `web-flow` se nepočítá) a nejvýš 250 commitů. Check je vázaný na head SHA, pro který se spustil: novější push nebo zastaralý merge ref = červená, spustit znovu.
- `validate-content` je povinný, jakmile existuje `content/manifest.json` (W0c); striktní kontrakt `nexus.site.v1` / `nexus.article.v1` přichází s W0c.
- Před každým `wrangler deploy` (Workers Builds, `npm run deploy`) spouští wrangler vlastní build `tools/wrangler-build.mjs`: `npm run build`, pak `npm test` a `npm run check`. Testy a kontrolu přeskočí jen `PROCELYX_SKIP_GATE=1` (`npm run dev` a dry run ve `web-checks`, kde už testy proběhly).

## Nasazení
- Produkce: Cloudflare Workers Builds, production branch `procelyx-live`, deploy command `npx wrangler deploy`, buildy ostatních větví vypnuté.
- `wrangler.jsonc` je zdroj pravdy nasazení. Obsahuje jen veřejné identifikátory (klíč webu pro Nexus, adresa pro poptávky, id KV). Tajemství jen přes `npx wrangler secret put`.
- Nikdy nenasazovat ručně (`wrangler deploy`) mimo nouzový postup.

## Struktura
- `content/` — obsah úvodní stránky jako data (texty cs/en, identita a SEO, obrázkové sloty, manifest slotů); kontrakt `contract/nexus.site.v1.md`, schémata `schemas/`, injekce `tools/inject.mjs`, validace `tools/validate-content.mjs`
- `content/articles/<slug>.json` — články publikované z Nexus One (kontrakt `contract/nexus.article.v1.md`, schéma `schemas/article.schema.json`); build z nich vyrobí `public/clanky/<slug>/index.html`, kartu ve výpisu a URL v sitemap (`tools/lib/articles.mjs`). Vygenerované stránky se **nekommitují** (nejsou v `.gitignore`, aby šly přidat ručně psané články; commit vygenerované stránky odmítne `tests/articles.test.js`; po lokálním buildu `git restore public/clanky/index.html public/sitemap.xml`), 21 ručně psaných článků v `public/clanky/` se nemění; slug nesmí kolidovat s ručním článkem. Strojový PR smí přidat, změnit nebo smazat jen tyto soubory.
- `public/` — HTML, CSS, JS a obrázky webu (build je přepisuje na místě; `i18n.js` generuje build z `content/i18n`)
- `src/` — Worker (kontaktní formulář, přeposílání poptávek do Nexus One)
- `tools/` — build, kontroly, generátory stránek
- `tests/` — testy (`node --test`)
- `integrations/google-mail/` — Apps Script brána pro odesílání formuláře
