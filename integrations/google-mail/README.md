# Google Workspace — hlavní odesílání formuláře

Brána běží ve firemním účtu jarda.vojtasek@procelyx.cz. Nečte schránku, vyžaduje pouze oprávnění `script.send_mail`. Příjemce je pevně určený ve Script Properties (`CONTACT_TO`, výchozí info@procelyx.cz). Klientské údaje nemohou změnit příjemce.

V produkci je CONTACT_TO výslovně nastavené na **jarda.vojtasek@procelyx.cz**. Původní jarda@procelyx.cz a info@procelyx.cz jsou aliasy téže schránky. Google při posílání vlastnímu aliasu zprávu vynechává z Inboxu, proto se doručuje na primární adresu. [Vysvětlení Google](https://knowledge.workspace.google.com/admin/support/troubleshooting/messages-sent-to-email-alias-or-group-arent-in-my-inbox?hl=en).

## Nasazení

1. Ve vlastním Apps Script projektu vložit celý `Code.gs` a manifest `appsscript.json`.
2. V Project Settings → Script Properties uložit náhodný alespoň 32znakový `CONTACT_SHARED_SECRET`. Nevkládat jej do kódu, Gitu ani URL.
3. Deploy → New deployment → Web app, Execute as owner, Who has access: Anyone. Veřejný endpoint přijme odeslání pouze s platným HMAC podpisem a časem v intervalu ±5 minut. Samotná znalost URL odeslání neumožní.
4. Při autorizaci ověřit firemní účet a jediné oprávnění odesílat e-maily.
5. V Cloudflare Production uložit totožnou hodnotu jako šifrovaný `GOOGLE_MAIL_SECRET`. Jako šifrovaný `GOOGLE_MAIL_URL` uložit nasazenou URL `https://script.google.com/macros/s/…/exec`, bez `/u/3/`, bez `/dev` a bez parametrů. URL není heslo, ale držíme ji mimo frontend.
6. Ve wrangler.jsonc nastavit `CONTACT_PROVIDER: "google"` a nasadit Worker. Oba secret bindings musí existovat před přepnutím.
7. Skutečný test provést přes veřejný formulář, potvrdit příjem v Google Workspace a Reply-To. Stejný požadavek zopakovat a ověřit jedinou zprávu.

Změna kódu v editoru sama neaktualizuje veřejné `/exec`. V Manage deployments zvolit Edit → New version → Deploy. Zachování stejného deploymentu zachová URL.

## Opakování, limity a záloha

Worker podepisuje celé tělo pomocí HMAC-SHA256. Apps Script ověřuje čas, podpis, formát a pevného příjemce. Script Lock a stav před/po odeslání brání souběžnému dvojímu odeslání. Ukládají se pouze technické otisky a stav, nikoli obsah poptávky. Platnost je 24 hodin; staré položky se čistí při dalším požadavku. Maximálně 500 unikátních odeslání v klouzavém období 24 hodin, zároveň platí dostupná kvóta účtu Google.

Při nejistém výsledku po zahájení odesílání zůstane stav `sending` a další pokus hlásí `delivery_uncertain`. Nejprve vyhledat zprávu ve schránce. Po kontrole lze odstranit pouze konkrétní `sent:contact-…` vlastnost; nikdy hromadně všechny vlastnosti ani podpisový klíč. Automatické přepnutí na Resend není zapnuté, protože timeout sám nepotvrzuje, že Google zprávu neodeslal.

Pro řízený návrat k Resendu: ověřit jeho doménu a test doručení, zkontrolovat nejasné pokusy, přepnout `CONTACT_PROVIDER` na `resend` a nasadit. `RESEND_API_KEY`, `CONTACT_FROM` a `CONTACT_TO` zůstávají připravené. Neověřený Resend zatím není funkční záloha.

Google Apps Script má vlastní kvóty a dostupnost, nejde o garanci nepřetržitého doručování. Nebyl objednán další tarif. Běžná kvóta Workspace je podle dokumentace 1 500 příjemců denně, zkušební účty mohou mít nižší limity. Vždy rozhoduje aktuální `MailApp.getRemainingDailyQuota()`.

Zdroje: [web apps](https://developers.google.com/apps-script/guides/web), [MailApp](https://developers.google.com/apps-script/reference/mail/mail-app), [kvóty](https://developers.google.com/apps-script/guides/services/quotas).
