// Single source for the privacy notice version and the texts shared by the Worker
// (consent record sent to Nexus One) and tools/legal-pages.mjs (privacy.html).
// Pure ES module without dependencies so both the Worker and Node scripts can import it.

// Effective date of the current privacy notice version (ISO date, max 50 chars).
export const PRIVACY_VERSION = '2026-10-01';
// Human readable date shown on privacy.html ("Verze ze dne …").
export const PRIVACY_VERSION_LABEL = '1. října 2026';
// Short notice shown under the contact form; it is also sent as consent.text with every inquiry.
export const PRIVACY_NOTICE_TEXT = 'Údaje použiji k vyřízení vaší nezávazné poptávky. Odesláním nevzniká objednávka ani přihlášení k reklamě.';
// Paragraph about processing the inquiry in Nexus One (privacy.html, section 3).
export const PRIVACY_PROCESSING_HTML = 'Web nevytváří vlastní databázi obsahu poptávek. Kopii poptávky předá do interního systému pro správu zákazníků Nexus One, který provozuje PROCELYX. Tam z ní vznikne záznam firmy a kontaktní osoby a připomínka k odpovědi. Pro rychlejší vyřízení může Nexus One vytvořit stručné shrnutí poptávky a návrh odpovědi pomocí AI modelu u zpracovatele AI modelů. Výstup AI je jen pomůcka: odpověď i další postup vždy kontroluje a odesílá člověk. Aplikace Nexus One běží u poskytovatelů Railway (provoz aplikace) a Neon (databáze), AI modely jsou dostupné přes službu OpenRouter. Pokud Nexus One není dočasně dostupný, čeká poptávka v technické frontě u Cloudflare, aby ji bylo možné předat později, a to nejdéle 14 dní (nejvýše 7 dní ve frontě pro automatické opakování a zbytek jako odložený záznam pro ruční opětovné předání po odstranění poruchy). Poté se automaticky odstraní. Při ručním opětovném předání začíná tato lhůta běžet znovu. Záznam v Nexus One podléhá lhůtám uvedeným v části 4 a automaticky se odstraní nejpozději 24 měsíců po přijetí.';
