import {nexusConfigured, buildLeadEvent, deliverOrQueue} from './nexus.js';
const ORIGINS = new Set(['https://procelyx.cz', 'https://www.procelyx.cz']);
const MAX_BYTES = 20000;
const LIMITS = { company: 160, name: 120, email: 254, phone: 80, area: 160, message: 5000, page: 500, website: 500, submissionId: 36 };
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', ...headers
  }});
}
export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const validEmail = value => /^[^\s@<>"\x00-\x1f\x7f]+@[^\s@<>"\x00-\x1f\x7f]+\.[^\s@<>"\x00-\x1f\x7f]+$/.test(value);

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new Error('payload_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_json');
  const chunks = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('payload_too_large'); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new Error('invalid_json'); }
}
// Optional marketing context. Invalid values are dropped (never a 400) and never used in the e-mail.
const OPTIONAL_LIMITS = { utmSource: 200, utmMedium: 200, utmCampaign: 200, utmContent: 200, utmTerm: 200 };
function optionalContext(data) {
  const context = {};
  for (const [key, max] of Object.entries(OPTIONAL_LIMITS)) {
    const value = typeof data[key] === 'string' ? data[key].trim() : '';
    if (value && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)) context[key] = value;
  }
  if (typeof data.referrer === 'string' && data.referrer.length <= 500 && !/[\x00-\x1f\x7f]/.test(data.referrer)) {
    try {
      const url = new URL(data.referrer);
      if (url.protocol === 'https:') context.referrer = url.origin + url.pathname;
    } catch {}
  }
  return context;
}
export function normalizeLead(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const lead = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    if (data[key] != null && typeof data[key] !== 'string') return null;
    lead[key] = (data[key] || '').trim();
    if (lead[key].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(lead[key])) return null;
    if (key !== 'message' && /[\r\n]/.test(lead[key])) return null;
  }
  if (lead.website) return lead;
  if (!lead.name || !lead.message || !validEmail(lead.email)) return null;
  if (lead.submissionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lead.submissionId)) return null;
  try {
    const page = new URL(lead.page || 'https://procelyx.cz/');
    if (!ORIGINS.has(page.origin)) return null;
    lead.page = page.origin + page.pathname;
  } catch { return null; }
  return {...lead, ...optionalContext(data)};
}
export function composeEmail(lead, env) {
  const fields = [['Firma / projekt', lead.company || 'Neuvedeno'], ['Jméno', lead.name], ['E-mail', lead.email],
    ['Telefon', lead.phone || '—'], ['Oblast', lead.area || 'Upřesníme při kontaktu'], ['Zdrojová stránka', lead.page]];
  return {
    from: env.CONTACT_FROM, to: [env.CONTACT_TO], reply_to: lead.email,
    subject: 'Nová poptávka PROCELYX — ' + (lead.company || lead.name).slice(0,100),
    text: ['Nová poptávka z PROCELYX.cz', '', ...fields.map(([k,v]) => `${k}: ${v}`), '', 'Co chce zákazník zlepšit:', lead.message].join('\n'),
    html: `<!doctype html><html lang="cs"><body style="font:16px/1.6 Arial,sans-serif;color:#17202a;padding:24px"><h1 style="font-size:24px">Nová poptávka PROCELYX</h1><table role="presentation">${fields.map(([k,v]) => `<tr><td style="padding:8px 20px 8px 0;color:#526372">${k}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table><h2 style="font-size:18px">Co chce zákazník zlepšit</h2><p style="white-space:pre-wrap">${escapeHtml(lead.message)}</p></body></html>`,
    tags: [{name:'source', value:'procelyx-web'}]
  };
}
// CRM sync (Nexus One) runs only after email acceptance, in ctx.waitUntil, with a
// durable KV outbox and the submissionId as idempotency key. A CRM outage never
// blocks email delivery or changes the visitor's response.
export async function sendLead(lead, env, send = fetch) {
  const email = composeEmail(lead, env);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({email, submissionId:lead.submissionId})));
  const key = 'contact-' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
  if (env.CONTACT_PROVIDER === 'google') return sendGoogle(email, key, env, send);
  const response = await send('https://api.resend.com/emails', {
    method:'POST', signal:AbortSignal.timeout(12000),
    headers:{'authorization':`Bearer ${env.RESEND_API_KEY}`, 'content-type':'application/json', 'accept':'application/json', 'user-agent':'procelyx-web/2.0', 'idempotency-key':key},
    body:JSON.stringify(email)
  });
  const result = await response.json().catch(() => ({}));
  // Acceptance is not proof of inbox delivery; verify that separately.
  const accepted = response.ok && typeof result.id === 'string' && result.id.length > 0;
  if (!accepted) console.error('contact_provider_rejected', {
    status:response.status,
    code: typeof result.name === 'string' && /^[a-z_]{1,60}$/.test(result.name) ? result.name : 'unknown',
    json: Boolean(response.headers.get('content-type')?.includes('application/json'))
  });
  return accepted;
}

export function mailConfigured(env) {
  if (env.CONTACT_PROVIDER === 'google') return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.GOOGLE_MAIL_URL || '') && (env.GOOGLE_MAIL_SECRET || '').length >= 32;
  return (!env.CONTACT_PROVIDER || env.CONTACT_PROVIDER === 'resend') && Boolean(env.RESEND_API_KEY);
}

async function sendGoogle(email, id, env, send) {
  const payload = JSON.stringify({to:email.to[0], subject:email.subject, text:email.text, html:email.html, replyTo:email.reply_to});
  const timestamp = Date.now();
  const encoder = new TextEncoder();
  const signingKey = await crypto.subtle.importKey('raw', encoder.encode(env.GOOGLE_MAIL_SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const signatureBytes = await crypto.subtle.sign('HMAC', signingKey, encoder.encode(`${timestamp}.${id}.${payload}`));
  const signature = Array.from(new Uint8Array(signatureBytes), b=>b.toString(16).padStart(2,'0')).join('');
  const response = await send(env.GOOGLE_MAIL_URL, {
    method:'POST', redirect:'follow', signal:AbortSignal.timeout(18000),
    headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify({timestamp,id,payload,signature})
  });
  const result = await response.json().catch(()=>({}));
  const accepted = response.ok && result.ok === true && result.id === id;
  if (!accepted) console.error('contact_google_rejected', {status:response.status,code:typeof result.error === 'string' && /^[a-z_]{1,60}$/.test(result.error)?result.error:'unknown'});
  // Never switch providers after an ambiguous response: the message may already
  // have been sent. A controlled provider switch is an operator action.
  return accepted;
}
// Never throws synchronously: a failure here must not turn an accepted inquiry into a 502.
function scheduleNexusForward(env, ctx, lead, send) {
  try {
    if (!ctx || typeof ctx.waitUntil !== 'function' || !nexusConfigured(env)) return;
    const idempotencyKey = lead.submissionId || crypto.randomUUID();
    const rawBody = JSON.stringify(buildLeadEvent(lead, {idempotencyKey, submittedAt: new Date().toISOString()}));
    ctx.waitUntil(deliverOrQueue(env, rawBody, idempotencyKey, {fetchImpl: send}).catch(() => console.error('nexus_forward_failed', {stage: 'nexus_forward'})));
  } catch {
    console.error('nexus_schedule_failed', {stage: 'nexus_schedule'});
  }
}
export async function handleContact(request, env, send = fetch, ctx) {
  if (request.method !== 'POST') return json({ok:false,error:'method_not_allowed'},405,{Allow:'POST'});
  if (!ORIGINS.has(request.headers.get('origin'))) return json({ok:false,error:'origin_not_allowed'},403);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ok:false,error:'unsupported_media_type'},415);
  let data;
  try { data = await readBody(request); }
  catch (err) { const large = err.message === 'payload_too_large'; return json({ok:false,error:large?'payload_too_large':'invalid_json'},large?413:400); }
  const lead = normalizeLead(data);
  if (!lead) return json({ok:false,error:'validation_failed'},400);
  if (lead.website) return json({ok:true});
  if (!mailConfigured(env) || !validEmail(env.CONTACT_TO || '') || !env.CONTACT_FROM || !env.CONTACT_RATE_LIMITER || env.CONTACT_ENABLED === 'false') return json({ok:false,error:'mail_not_configured'},503);
  let stage = 'rate_limit';
  try {
    const {success} = await env.CONTACT_RATE_LIMITER.limit({key:'contact:' + (request.headers.get('cf-connecting-ip') || 'unknown')});
    if (!success) return json({ok:false,error:'rate_limited'},429,{'Retry-After':'60'});
    stage = 'provider';
    if (!await sendLead(lead,env,send)) return json({ok:false,error:'mail_delivery_failed'},502);
    scheduleNexusForward(env, ctx, lead, send);
    return json({ok:true});
  } catch (error) {
    // Never log provider responses, form data or credentials.
    console.error('contact_operation_failed', {stage,timeout:error?.name === 'TimeoutError'});
    return json({ok:false,error:'mail_delivery_failed'},502);
  }
}
