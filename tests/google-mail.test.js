import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {handleContact,normalizeLead,sendLead} from '../src/contact.js';
const secret='test-only-shared-secret-not-for-production';
const lead=normalizeLead({company:'Test',name:'Testovací uživatel',email:'test@example.com',area:'Provoz',message:'Žluťoučký <kůň> & další',submissionId:'5c2f8d41-7aa6-4d5a-83cc-346c85fb3449'});
const env={CONTACT_PROVIDER:'google',GOOGLE_MAIL_URL:'https://script.google.com/macros/s/test-deployment/exec',GOOGLE_MAIL_SECRET:secret,CONTACT_TO:'info@procelyx.cz',CONTACT_FROM:'Web <web@procelyx.cz>',CONTACT_RATE_LIMITER:{limit:async()=>({success:true})}};
const source=readFileSync(new URL('../integrations/google-mail/Code.gs',import.meta.url),'utf8');
function gateway({quota=100,sendThrows=false,lockAvailable=true}={}){
  const store={CONTACT_SHARED_SECRET:secret};const messages=[];let locked=false;
  const context=vm.createContext({
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>store[k]||null,setProperty:(k,v)=>{store[k]=v},deleteProperty:k=>{delete store[k]},getProperties:()=>({...store})})},
    LockService:{getScriptLock:()=>({tryLock:()=>{locked=lockAvailable;return locked},hasLock:()=>locked,releaseLock:()=>{locked=false}})},
    MailApp:{getRemainingDailyQuota:()=>quota,sendEmail:m=>{messages.push(m);if(sendThrows)throw Error('ambiguous send')}},
    Utilities:{Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(value,key)=>Array.from(createHmac('sha256',key).update(value).digest())},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})}
  });
  vm.runInContext(source,context);
  return {store,messages,post:envelope=>context.doPost({postData:{contents:JSON.stringify(envelope)}})};
}
async function envelope(){let result;await sendLead(lead,env,async(url,options)=>{assert.equal(url,env.GOOGLE_MAIL_URL);result=JSON.parse(options.body);return Response.json({ok:true,id:result.id})});return result;}
test('Worker signs UTF-8 content and Google gateway sends only to the fixed recipient',async()=>{
  const data=await envelope();assert.equal(data.signature,createHmac('sha256',secret).update(`${data.timestamp}.${data.id}.${data.payload}`).digest('hex'));
  assert.ok(!JSON.stringify(data).includes(secret));const app=gateway();const result=app.post(data);assert.equal(result.ok,true);assert.equal(result.id,data.id);
  assert.equal(app.messages[0].to,'info@procelyx.cz');assert.equal(app.messages[0].replyTo,lead.email);assert.match(app.messages[0].htmlBody,/&lt;kůň&gt;/);
});
test('invalid signature and expired requests cannot send mail',async()=>{
  const data=await envelope();const app=gateway();
  assert.equal(app.post({...data,signature:'0'.repeat(64)}).error,'unauthorized');
  assert.equal(app.post({...data,timestamp:Date.now()-400000}).error,'unauthorized');
  assert.equal(app.messages.length,0);
});
test('recipient changes are rejected even with a valid signature',async()=>{
  const data=await envelope();data.payload=JSON.stringify({...JSON.parse(data.payload),to:'attacker@example.com'});data.signature=createHmac('sha256',secret).update(`${data.timestamp}.${data.id}.${data.payload}`).digest('hex');
  const app=gateway();assert.equal(app.post(data).error,'invalid_message');assert.equal(app.messages.length,0);
});
test('retry after a successful send returns its receipt without a second message',async()=>{
  const data=await envelope();const app=gateway();assert.equal(app.post(data).ok,true);assert.equal(app.post(data).ok,true);assert.equal(app.messages.length,1);
  assert.ok(!JSON.stringify(app.store).includes(lead.email));
});
test('an uncertain send is not retried and never reports success',async()=>{
  const app=gateway({sendThrows:true});const data=await envelope();assert.equal(app.post(data).ok,false);assert.equal(app.post(data).error,'delivery_uncertain');assert.equal(app.messages.length,1);
});
test('quota exhaustion and lock contention do not send',async()=>{
  const data=await envelope();for(const settings of [{quota:0},{lockAvailable:false}]){const app=gateway(settings);assert.equal(app.post(data).ok,false);assert.equal(app.messages.length,0);}
});
test('Google mode requires valid configuration and no Resend key',async()=>{
  const req=()=>new Request('https://procelyx.cz/api/contact',{method:'POST',headers:{origin:'https://procelyx.cz','content-type':'application/json'},body:JSON.stringify(lead)});
  for(const invalid of [{GOOGLE_MAIL_SECRET:''},{GOOGLE_MAIL_URL:'https://evil.example'},{CONTACT_PROVIDER:'unknown'}])assert.equal((await handleContact(req(),{...env,...invalid})).status,503);
  assert.equal((await handleContact(req(),env,async(url,o)=>Response.json({ok:true,id:JSON.parse(o.body).id}))).status,200);
});
test('ambiguous Google responses never fall through to Resend or claim success',async()=>{
  for(const reply of [()=>Response.json({ok:true,id:'wrong'}),()=>new Response('<html>Sign in</html>'),()=>{throw Error('timeout')}]){
    let calls=0;const req=new Request('https://procelyx.cz/api/contact',{method:'POST',headers:{origin:'https://procelyx.cz','content-type':'application/json'},body:JSON.stringify(lead)});
    const response=await handleContact(req,{...env,RESEND_API_KEY:'backup-test'},async url=>{assert.equal(url,env.GOOGLE_MAIL_URL);calls++;return reply()});assert.equal(response.status,502);assert.equal(calls,1);
  }
});

