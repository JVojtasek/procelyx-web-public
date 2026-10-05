/* Small opt-in web analytics client. No replay, autocapture, profiles, form values or URL query strings. */
(function () {
  'use strict';
  const choiceKey = 'procelyx-analytics-choice-v1', idKey = 'procelyx-analytics-id-v1';
  const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  let config, visitor, session, choice = read(choiceKey), pageSent = false;
  if (choice && Date.now() - choice.at > 180 * 86400000) choice = null;
  const isBlocked = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  const safePath = path => /^\/(?:$|clanky\/(?:[a-z0-9-]+\/)?$|qr\/$|privacy\.html$|pravni-informace\.html$|obchodni-podminky\.html$)/.test(path) ? path : null;
  function sessionId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let stamp = BigInt(Date.now());
    for (let i = 5; i >= 0; i--) { bytes[i] = Number(stamp & 255n); stamp >>= 8n; }
    bytes[6] = (bytes[6] & 15) | 112; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  function resetTracking() {
    visitor = null; session = null; pageSent = false;
    try { localStorage.removeItem(idKey); sessionStorage.removeItem('px-analytics-session'); } catch {}
  }
  function capture(event, props) {
    const path = safePath(location.pathname);
    if (!config?.enabled || choice?.allowed !== true || isBlocked() || !path) return;
    visitor ||= read(idKey)?.id || crypto.randomUUID();
    write(idKey, {id: visitor});
    try {
      const old = JSON.parse(sessionStorage.getItem('px-analytics-session') || 'null');
      session = old && Date.now() - old.at < 1800000 && Date.now() - old.startedAt < 86400000 ? old.id : sessionId();
      sessionStorage.setItem('px-analytics-session', JSON.stringify({id: session, at: Date.now(), startedAt: old?.id === session ? old.startedAt : Date.now()}));
    } catch { session ||= sessionId(); }
    let referrer = '', referringDomain = '$direct';
    try {
      const source = new URL(document.referrer);
      if (source.protocol === 'https:' || source.protocol === 'http:') {
        referrer = source.origin; referringDomain = source.hostname.toLowerCase();
      }
    } catch {}
    const payload = {api_key: config.token, event, properties: {
      distinct_id: visitor, $session_id: session, $current_url: location.origin + path,
      $pathname: path, $host: location.hostname, $referrer: referrer, $referring_domain: referringDomain,
      $process_person_profile: false, $geoip_disable: true, site: 'procelyx.cz', ...props,
    }};
    fetch(config.host + '/i/v0/e/', {method: 'POST', body: JSON.stringify(payload), headers: {'Content-Type': 'application/json'}, keepalive: true}).catch(() => {});
  }
  const pageview = () => { if (!pageSent && choice?.allowed && !isBlocked()) { capture('$pageview', {}); pageSent = true; } };
  function decide(allowed) {
    choice = {allowed, at: Date.now()}; write(choiceKey, choice);
    document.getElementById('pxAnalyticsConsent')?.remove();
    if (!allowed) {
      resetTracking();
    } else pageview();
  }
  function showChoices() {
    if (!config?.enabled || document.getElementById('pxAnalyticsConsent')) return;
    const box = document.createElement('section'); box.id = 'pxAnalyticsConsent'; box.className = 'pxConsent';
    box.setAttribute('aria-label', 'Nastavení měření návštěvnosti');
    box.innerHTML = '<strong>Pomůžete nám zlepšovat web?</strong><p>Se souhlasem měříme návštěvy a kliknutí přes PostHog v EU. Obsah formulářů ani záznam obrazovky nesbíráme. <a href="/privacy.html#cookies">Podrobnosti</a></p><div><button type="button" data-choice="no">Pouze nezbytné</button><button type="button" data-choice="yes">Povolit měření</button></div>';
    box.querySelector('[data-choice="no"]').onclick = () => decide(false);
    box.querySelector('[data-choice="yes"]').onclick = () => decide(true);
    document.body.append(box);
  }
  window.PROCELYX_ANALYTICS = {capture: event => { if (event === 'contact_form_success') capture(event, {}); }, preferences: showChoices};
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href]'); if (!a) return;
    const raw = a.getAttribute('href');
    if (raw.startsWith('tel:')) capture('contact_phone_click', {});
    else if (raw.startsWith('mailto:')) capture('contact_email_click', {});
    else if (raw.includes('/discovery') || /\baudit\b/.test(raw)) capture('process_audit_click', {});
    else if (raw.includes('bookings') || raw.includes('outlook.office.com')) capture('meeting_booking_click', {});
    else if (raw.endsWith('#contact')) capture('contact_cta_click', {});
  });
  window.addEventListener('storage', e => { if (e.key === choiceKey) { choice = read(choiceKey); if (!choice?.allowed) resetTracking(); else pageview(); } });
  fetch('/api/analytics-config').then(r => r.ok ? r.json() : null).then(c => {
    if (!c?.enabled || c.host !== 'https://eu.i.posthog.com' || !/^phc_[A-Za-z0-9]{10,160}$/.test(c.token)) return;
    config = c;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'pxAnalyticsSettings'; button.textContent = 'Nastavení měření'; button.onclick = showChoices;
    document.querySelector('.legalLinks')?.append(button);
    if (!choice && !isBlocked()) showChoices(); else pageview();
  }).catch(() => {});
})();
