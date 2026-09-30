import test from 'node:test';
import assert from 'node:assert/strict';
import {handleContact,normalizeLead,composeEmail,sendLead} from '../src/contact.js';
import worker from '../src/index.js';
const lead={company:'Test firma',name:'Test uživatel',email:'customer@example.com',phone:'+420 000 000 000',area:'Provoz',message:'Potřebujeme zlepšit předávání práce.',page:'https://procelyx.cz/?campaign=test#contact',website:'',submissionId:'5c2f8d41-7aa6-4d5a-83cc-346c85fb3449'};
const env={RESEND_API_KEY:'test-only',CONTACT_TO:'owner@example.com',CONTACT_FROM:'Web <web@example.com>',CONTACT_RATE_LIMITER:{limit:async()=>({success:true})}};
const accepted=async()=>Response.json({id:'email-test'});
function request(data=lead,options={}){return new Request('https://procelyx.cz/api/contact',{method:'POST',headers:{origin:'https://procelyx.cz','content-type':'application/json',...options.headers},body:JSON.stringify(data)});}
test('only POST and production origins are allowed',async()=>{
  assert.equal((await handleContact(new Request('https://procelyx.cz/api/contact'),env)).status,405);
  for(const origin of ['https://evil.example','null',''])assert.equal((await handleContact(request(lead,{headers:{origin}}),env)).status,403);
});
test('strict shape, email and field limits reject malformed data',async()=>{
  for(const data of [null,[],true,{...lead,name:{}},{...lead,email:'a@b'},{...lead,email:'a@b.cz\r\nBcc: bad@example.com'},{...lead,company:'x'.repeat(161)},{...lead,message:''},{...lead,page:'https://evil.example'},{...lead,submissionId:'wrong'}]){
    assert.equal((await handleContact(request(data),env,accepted)).status,400,JSON.stringify(data));
  }
});
test('body size is enforced without relying on Content-Length',async()=>{
  const response=await handleContact(request({...lead,message:'ž'.repeat(11000)}),env,accepted);
  assert.equal(response.status,413);
});
test('invalid JSON and wrong media type return controlled JSON errors',async()=>{
  const r=new Request('https://procelyx.cz/api/contact',{method:'POST',headers:{origin:'https://procelyx.cz','content-type':'application/json'},body:'{'});
  assert.equal((await handleContact(r,env)).status,400);
  assert.equal((await handleContact(request(lead,{headers:{'content-type':'text/plain'}}),env)).status,415);
});
test('honeypot never calls the provider',async()=>{
  const response=await handleContact(request({...lead,website:'https://spam.example'}),{},()=>assert.fail('must not send spam'));
  assert.deepEqual(await response.json(),{ok:true});
});
test('missing configuration and rate limiting do not send mail',async()=>{
  assert.equal((await handleContact(request(),{},accepted)).status,503);
  assert.equal((await handleContact(request(),{...env,CONTACT_ENABLED:'false'},accepted)).status,503);
  const response=await handleContact(request(),{...env,CONTACT_RATE_LIMITER:{limit:async()=>({success:false})}},()=>assert.fail('must not send'));
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');
});
test('mail contains all fields, configured destination, Reply-To and escaped HTML',()=>{
  const mail=composeEmail(normalizeLead({...lead,company:'<img src=x onerror=alert(1)>',message:'<script>alert(1)</script>\nSecond line'}),env);
  assert.deepEqual(mail.to,['owner@example.com']);assert.equal(mail.from,env.CONTACT_FROM);assert.equal(mail.reply_to,lead.email);
  assert.ok(!mail.html.includes('<script>'));assert.ok(!mail.html.includes('<img'));assert.ok(mail.html.includes('&lt;script&gt;'));
  for(const text of [lead.name,lead.email,lead.phone,lead.area,'https://procelyx.cz/','Second line'])assert.ok(mail.text.includes(text));
  assert.ok(!mail.text.includes('campaign='));
});
test('provider rejection, invalid success and network failures never report success',async()=>{
  for(const send of [async()=>Response.json({error:'rejected'},{status:422}),async()=>Response.json({}),async()=>{throw new Error('timeout')}]){
    const response=await handleContact(request(),env,send);assert.equal(response.status,502);assert.equal((await response.json()).ok,false);
  }
});
test('valid requests succeed only after provider acceptance',async()=>{
  const response=await handleContact(request(),env,accepted);assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
});

test('minimal contact form sends without company, phone or area',async()=>{
  const minimal={name:'Test kontakt',email:'customer@example.com',message:'Ručně přepisujeme stejné údaje.'};
  let sent;
  const response=await handleContact(request(minimal),env,async(url,options)=>{sent=JSON.parse(options.body);return accepted();});
  assert.equal(response.status,200);
  assert.equal(sent.subject,'Nová poptávka PROCELYX — Test kontakt');
  assert.equal(sent.reply_to,minimal.email);
  assert.ok(sent.text.includes('Firma / projekt: Neuvedeno'));
  assert.ok(sent.text.includes('Oblast: Upřesníme při kontaktu'));
  assert.ok(!sent.text.includes('undefined'));
  for(const field of ['name','email','message']){
    assert.equal((await handleContact(request({...minimal,[field]:''}),env,()=>assert.fail('invalid inquiry must not send'))).status,400);
  }
});
test('retries share an idempotency key; edited payload gets a new key',async()=>{
  const keys=[];const send=async(url,opts)=>{assert.equal(url,'https://api.resend.com/emails');keys.push(opts.headers['idempotency-key']);return accepted();};
  await sendLead(normalizeLead(lead),env,send);await sendLead(normalizeLead(lead),env,send);await sendLead(normalizeLead({...lead,message:'Changed message'}),env,send);
  assert.equal(keys[0],keys[1]);assert.notEqual(keys[0],keys[2]);assert.ok(!keys[0].includes(lead.email));
});
test('www redirects preserve path, query and POST method with 308',async()=>{
  const response=await worker.fetch(new Request('https://www.procelyx.cz/clanky/?q=1'),{});
  assert.equal(response.status,308);assert.equal(response.headers.get('location'),'https://procelyx.cz/clanky/?q=1');
});

// --- Nexus One forwarding (W2): runs only after the e-mail was accepted and never changes the response.
import {baseEnv as nexusEnv, NEXUS_URL} from './nexus-helpers.js';
function fakeCtx(){const promises=[];return {promises,waitUntil(p){promises.push(p);}};}
function routedSend({nexusStatus=202,mail=accepted}={}){
  const calls={mail:0,nexus:[]};
  const send=async(url,opts)=>{
    if(url===NEXUS_URL){calls.nexus.push(opts);return Response.json({ok:nexusStatus<300},{status:nexusStatus});}
    calls.mail++;return mail(url,opts);
  };
  return {send,calls};
}
const withNexus=(extra={})=>({...env,...nexusEnv(),...extra});
test('accepted e-mail schedules exactly one Nexus event carrying submissionId as idempotencyKey',async()=>{
  const ctx=fakeCtx();const {send,calls}=routedSend();
  const response=await handleContact(request(),withNexus(),send,ctx);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
  assert.equal(ctx.promises.length,1);
  await Promise.all(ctx.promises);
  assert.equal(calls.mail,1);assert.equal(calls.nexus.length,1);
  const event=JSON.parse(calls.nexus[0].body);
  assert.equal(event.idempotencyKey,lead.submissionId);
  assert.equal(event.payload.email,lead.email);
  assert.equal(event.context.pageUrl,'https://procelyx.cz/');
});
test('no Nexus event for honeypot, validation errors, rate limiting or rejected e-mail',async()=>{
  const cases=[
    [request({...lead,website:'https://spam.example'}),withNexus()],
    [request({...lead,email:'a@b'}),withNexus()],
    [request(),withNexus({CONTACT_RATE_LIMITER:{limit:async()=>({success:false})}})],
    [request(),withNexus({CONTACT_ENABLED:'false'})]
  ];
  for(const [req,e] of cases){const ctx=fakeCtx();const {send}=routedSend();await handleContact(req,e,send,ctx);assert.equal(ctx.promises.length,0);}
  const ctx=fakeCtx();const {send}=routedSend({mail:async()=>Response.json({error:'rejected'},{status:422})});
  assert.equal((await handleContact(request(),withNexus(),send,ctx)).status,502);assert.equal(ctx.promises.length,0);
  const ctx2=fakeCtx();
  assert.equal((await handleContact(request(),withNexus(),async()=>{throw new Error('timeout')},ctx2)).status,502);assert.equal(ctx2.promises.length,0);
});
test('forwarding disabled or without ctx behaves exactly as before',async()=>{
  for(const [e,ctx] of [[withNexus({NEXUS_ENABLED:'false'}),fakeCtx()],[{...env},fakeCtx()],[withNexus(),undefined]]){
    const {send,calls}=routedSend();
    const response=await handleContact(request(),e,send,ctx);
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
    assert.equal(calls.mail,1);assert.equal(calls.nexus.length,0);
    if(ctx)assert.equal(ctx.promises.length,0);
  }
});
test('an exception while preparing the Nexus event never changes the 200 response',async()=>{
  const original=crypto.randomUUID;
  crypto.randomUUID=()=>{throw new Error('forced');};
  try{
    const ctx=fakeCtx();const {send,calls}=routedSend();
    const {submissionId,...withoutId}=lead;
    const response=await handleContact(request(withoutId),withNexus(),send,ctx);
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
    assert.equal(calls.mail,1);assert.equal(ctx.promises.length,0);
  }finally{crypto.randomUUID=original;}
  const throwingCtx={waitUntil(){throw new Error('forced');}};
  const {send}=routedSend();
  const response=await handleContact(request(),withNexus(),send,throwingCtx);
  assert.equal(response.status,200);
});
test('Nexus 500 keeps the visitor response 200, sends the e-mail once and queues the event',async()=>{
  const ctx=fakeCtx();const {send,calls}=routedSend({nexusStatus:500});const e=withNexus();
  const response=await handleContact(request(),e,send,ctx);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
  await Promise.all(ctx.promises);
  assert.equal(calls.mail,1);assert.equal(calls.nexus.length,1);
  assert.ok(e.NEXUS_QUEUE.store.has('q:'+lead.submissionId));
});
test('worker.fetch passes ctx to the contact handler',async()=>{
  const ctx=fakeCtx();
  const response=await worker.fetch(request(),{},ctx);
  assert.equal(response.status,503);assert.equal(ctx.promises.length,0);
});

// --- Optional marketing context (UTM, referrer): never required, never in the e-mail, invalid values are dropped.
const context={utmSource:'linkedin',utmMedium:'social',utmCampaign:'audit-2026',utmContent:'post-1',utmTerm:'procesni audit',referrer:'https://www.google.com/search?q=procelyx#x'};
test('optional UTM and referrer are kept when valid; referrer keeps only origin and path',()=>{
  const n=normalizeLead({...lead,...context});
  assert.equal(n.utmSource,'linkedin');assert.equal(n.utmMedium,'social');assert.equal(n.utmCampaign,'audit-2026');
  assert.equal(n.utmContent,'post-1');assert.equal(n.utmTerm,'procesni audit');
  assert.equal(n.referrer,'https://www.google.com/search');
  const old=normalizeLead(lead);
  for(const k of Object.keys(context))assert.equal(old[k],undefined);
});
test('invalid optional context is dropped instead of rejecting the inquiry',()=>{
  for(const bad of [{referrer:'http://example.com/'},{referrer:'javascript:alert(1)'},{referrer:'https://x.cz/'+'a'.repeat(600)},{referrer:{}},{referrer:'not a url'},
    {utmSource:'x'.repeat(201)},{utmSource:'a\r\nb'},{utmMedium:'a\u0000b'},{utmCampaign:42},{utmTerm:['a']},{utmContent:'   '}]){
    const n=normalizeLead({...lead,...bad});
    assert.ok(n,JSON.stringify(bad));
    for(const k of Object.keys(bad))assert.equal(n[k],undefined,JSON.stringify(bad));
  }
});
test('e-mail and its idempotency key are byte-identical with or without marketing context',async()=>{
  assert.deepEqual(composeEmail(normalizeLead({...lead,...context}),env),composeEmail(normalizeLead(lead),env));
  const keys=[];const send=async(url,opts)=>{keys.push(opts.headers['idempotency-key']);assert.ok(!opts.body.includes('linkedin'));assert.ok(!opts.body.includes('google.com'));return accepted();};
  await sendLead(normalizeLead(lead),env,send);await sendLead(normalizeLead({...lead,...context}),env,send);
  assert.equal(keys[0],keys[1]);
});
test('marketing context reaches the Nexus event',async()=>{
  const ctx=fakeCtx();const {send,calls}=routedSend();
  await handleContact(request({...lead,...context}),withNexus(),send,ctx);await Promise.all(ctx.promises);
  const event=JSON.parse(calls.nexus[0].body);
  assert.deepEqual(event.context,{pageUrl:'https://procelyx.cz/',referrer:'https://www.google.com/search',utm:{source:'linkedin',medium:'social',campaign:'audit-2026',content:'post-1',term:'procesni audit'}});
});
