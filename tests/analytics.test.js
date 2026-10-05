import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {analyticsConfig} from '../src/analytics.js';

const source=readFileSync(new URL('../public/analytics.js',import.meta.url),'utf8');
const CHOICE='procelyx-analytics-choice-v1', ID='procelyx-analytics-id-v1';
const projectToken='phc_'+'A'.repeat(24);
const enabledConfig={enabled:true,host:'https://eu.i.posthog.com',token:projectToken};
const settle=async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));};

function storage(initial={}) {
  const data=new Map(Object.entries(initial).map(([key,value])=>[key,JSON.stringify(value)]));
  return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key),data};
}

/** Minimal browser surface, with real event callbacks and storage, but no network or real DOM. */
async function browser({choice,pathname='/',search='',hash='',referrer='',navigator={},config=enabledConfig}={}) {
  const requests=[],nodes=new Map(),domEvents=new Map(),windowEvents=new Map();
  const local=storage(choice?{[CHOICE]:choice}:{}),session=storage();
  const legalLinks={children:[],append(node){this.children.push(node);}};
  const document={
    referrer,
    body:{append(node){if(node.id)nodes.set(node.id,node);}},
    getElementById:id=>nodes.get(id)||null,
    querySelector:selector=>selector==='.legalLinks'?legalLinks:null,
    addEventListener:(name,fn)=>domEvents.set(name,fn),
    createElement:tag=>{
      const choices=new Map();
      return {tagName:tag,children:[],setAttribute(){},append(node){this.children.push(node);},
        remove(){nodes.delete(this.id);},
        querySelector(selector){if(!choices.has(selector))choices.set(selector,{});return choices.get(selector);},
      };
    },
  };
  const window={addEventListener:(name,fn)=>windowEvents.set(name,fn)};
  const location={origin:'https://procelyx.cz',hostname:'procelyx.cz',pathname,search,hash};
  let uuid=0,now=Date.now(),random=0;
  class BrowserDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  vm.runInNewContext(source,{document,window,location,navigator,localStorage:local,sessionStorage:session,
    URL,Date:BrowserDate,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`,
      getRandomValues:array=>{for(let i=0;i<array.length;i++)array[i]=++random%256;return array;},
    },
    fetch:async(url,options={})=>{
      requests.push({url,options});
      return {ok:true,json:async()=>config};
    },
  });
  await settle();
  return {
    requests,local,session,location,navigator,window,legalLinks,
    advance:milliseconds=>{now+=milliseconds;},now:()=>now,
    captures:()=>requests.filter(request=>request.options.method==='POST').map(request=>({url:request.url,payload:JSON.parse(request.options.body)})),
    choose(allowed){
      window.PROCELYX_ANALYTICS.preferences();
      const box=nodes.get('pxAnalyticsConsent');
      assert.ok(box,'consent preferences must be available');
      box.querySelector(`[data-choice="${allowed?'yes':'no'}"]`).onclick();
    },
    click(href){domEvents.get('click')({target:{closest:()=>({getAttribute:()=>href})}});},
    externalChoice(value){local.setItem(CHOICE,JSON.stringify(value));windowEvents.get('storage')({key:CHOICE});},
    formSuccess(data){window.PROCELYX_ANALYTICS.capture('contact_form_success',data);},
  };
}

test('before consent and after rejection there are no analytics captures or identifiers',async()=>{
  const page=await browser();
  page.click('tel:+420000000000');page.formSuccess({email:'private@example.com'});
  assert.equal(page.captures().length,0);
  assert.equal(page.local.getItem(ID),null);
  assert.equal(page.session.getItem('px-analytics-session'),null);
  page.choose(false);page.click('mailto:private@example.com');page.formSuccess();
  assert.equal(page.captures().length,0);
  assert.equal(JSON.parse(page.local.getItem(CHOICE)).allowed,false);
});

test('granting consent emits one pageview; revoking consent stops captures and clears identifiers',async()=>{
  const page=await browser();
  page.choose(true);
  assert.deepEqual(page.captures().map(x=>x.payload.event),['$pageview']);
  assert.ok(page.local.getItem(ID));assert.ok(page.session.getItem('px-analytics-session'));
  page.click('/#contact');
  assert.equal(page.captures().at(-1).payload.event,'contact_cta_click');
  const before=page.captures().length;
  page.choose(false);page.click('tel:+420000000000');page.formSuccess();
  assert.equal(page.captures().length,before);
  assert.equal(page.local.getItem(ID),null);assert.equal(page.session.getItem('px-analytics-session'),null);
});

test('saved consent emits a pageview and cross-tab revocation stops all further captures',async()=>{
  const page=await browser({choice:{allowed:true,at:Date.now()}});
  assert.equal(page.captures().length,1);
  page.externalChoice({allowed:false,at:Date.now()});
  page.click('mailto:private@example.com');page.formSuccess();
  assert.equal(page.captures().length,1);
  assert.equal(page.local.getItem(ID),null);assert.equal(page.session.getItem('px-analytics-session'),null);
});

test('revoking and granting consent again starts a fresh anonymous pageview without resurrecting old identifiers',async()=>{
  const page=await browser();
  page.choose(true);
  const first=page.captures()[0].payload.properties;
  page.choose(false);
  assert.equal(page.local.getItem(ID),null);
  page.choose(true);
  assert.deepEqual(page.captures().map(x=>x.payload.event),['$pageview','$pageview']);
  const second=page.captures()[1].payload.properties;
  assert.notEqual(second.distinct_id,first.distinct_id);
  assert.notEqual(second.$session_id,first.$session_id);
});

test('granting consent in another tab records this open page exactly once and subsequent clicks are tracked',async()=>{
  const page=await browser({choice:{allowed:false,at:Date.now()}});
  assert.equal(page.captures().length,0);
  page.externalChoice({allowed:true,at:Date.now()});
  assert.deepEqual(page.captures().map(x=>x.payload.event),['$pageview']);
  page.externalChoice({allowed:true,at:Date.now()});
  page.click('/#contact');
  assert.deepEqual(page.captures().map(x=>x.payload.event),['$pageview','contact_cta_click']);
});

test('expired saved consent is ignored until the visitor makes a fresh choice',async()=>{
  const page=await browser({choice:{allowed:true,at:Date.now()-181*86400000}});
  page.formSuccess();assert.equal(page.captures().length,0);
  page.choose(true);assert.equal(page.captures().length,1);
});

test('global privacy control and Do Not Track prevent capture even with consent',async()=>{
  for(const optout of [{globalPrivacyControl:true},{doNotTrack:'1'}]) {
    const page=await browser({choice:{allowed:true,at:Date.now()},navigator:optout});
    page.click('tel:+420000000000');page.formSuccess();page.choose(true);
    assert.equal(page.captures().length,0);
    assert.equal(page.local.getItem(ID),null);
  }
});

test('privacy opt-out also takes effect immediately during an already-consented visit',async()=>{
  const page=await browser({choice:{allowed:true,at:Date.now()}});
  page.navigator.globalPrivacyControl=true;page.formSuccess();page.click('/discovery');
  assert.equal(page.captures().length,1);
});

test('PostHog session IDs are valid UUIDv7 with an embedded session-start timestamp, not UUIDv4 visitor IDs',async()=>{
  const page=await browser({choice:{allowed:true,at:Date.now()}});
  const properties=page.captures()[0].payload.properties;
  assert.match(properties.$session_id,/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const timestamp=parseInt(properties.$session_id.replaceAll('-','').slice(0,12),16);
  assert.ok(timestamp<=page.now());
  assert.ok(page.now()-timestamp<1000);
  assert.notEqual(properties.distinct_id,properties.$session_id);
  page.click('/#contact');
  assert.equal(page.captures()[1].payload.properties.$session_id,properties.$session_id);
});

test('session identity rotates after 30 minutes idle and after 24 hours even with continuing activity',async()=>{
  const page=await browser({choice:{allowed:true,at:Date.now()}});
  const first=page.captures()[0].payload.properties.$session_id;
  page.advance(31*60000);page.click('/#contact');
  const active=page.captures().at(-1).payload.properties.$session_id;
  assert.notEqual(active,first);
  for(let i=0;i<97;i++){page.advance(15*60000);page.click('/#contact');}
  assert.notEqual(page.captures().at(-1).payload.properties.$session_id,active);
});

test('private, authenticated and token-bearing routes cannot be captured',async()=>{
  for(const pathname of ['/dashboard/','/dashboard/mail/draft/private-id','/audit/private-token','/discovery/private-token','/api/contact','/auth/callback','/clanky/private/token/']) {
    const page=await browser({pathname,choice:{allowed:true,at:Date.now()}});
    page.formSuccess();page.click('tel:+420000000000');
    assert.equal(page.captures().length,0,pathname);
    assert.equal(page.local.getItem(ID),null,pathname);
  }
});

test('public page captures omit query strings, fragments, referrer paths, link targets and form values',async()=>{
  const secret='not-for-analytics-test-marker';
  const page=await browser({pathname:'/clanky/procesni-audit/',search:`?email=${secret}`,hash:`#${secret}`,
    referrer:`https://source.example/private/${secret}?key=${secret}`,choice:{allowed:true,at:Date.now()}});
  page.click(`mailto:${secret}@example.com`);
  page.click(`/discovery?token=${secret}`);
  page.formSuccess({company:secret,name:secret,email:secret,phone:secret,message:secret});
  page.window.PROCELYX_ANALYTICS.capture(secret,{message:secret});
  const captures=page.captures();
  assert.deepEqual(captures.map(x=>x.payload.event),['$pageview','contact_email_click','process_audit_click','contact_form_success']);
  for(const {url,payload} of captures) {
    assert.equal(url,'https://eu.i.posthog.com/i/v0/e/');
    assert.equal(payload.properties.$current_url,'https://procelyx.cz/clanky/procesni-audit/');
    assert.equal(payload.properties.$referrer,'https://source.example');
    assert.equal(payload.properties.$process_person_profile,false);
    assert.equal(payload.properties.$geoip_disable,true);
    assert.ok(!JSON.stringify(payload).includes(secret));
  }
});

test('browser refuses personal tokens and alternative ingestion hosts supplied by configuration',async()=>{
  for(const config of [{...enabledConfig,host:'https://other.example'},{...enabledConfig,token:'phx_'+'B'.repeat(24)},{enabled:false}]) {
    const page=await browser({config,choice:{allowed:true,at:Date.now()}});
    page.formSuccess();assert.equal(page.captures().length,0);
  }
});

test('Worker publishes only a valid project ingestion token, never a personal management key',async()=>{
  const privateKey='phx_'+'B'.repeat(24);
  for(const env of [{POSTHOG_PERSONAL_API_KEY:privateKey},{POSTHOG_PROJECT_TOKEN:privateKey,POSTHOG_PERSONAL_API_KEY:privateKey}]) {
    const response=analyticsConfig(env);
    assert.deepEqual(await response.json(),{enabled:false});
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  const response=analyticsConfig({POSTHOG_PROJECT_TOKEN:projectToken,POSTHOG_PERSONAL_API_KEY:privateKey,UNRELATED_SECRET:'private-marker'});
  const json=await response.json();
  assert.deepEqual(json,{enabled:true,token:projectToken,host:'https://eu.i.posthog.com',projectId:295120});
  assert.ok(!JSON.stringify(json).includes(privateKey));
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
});
