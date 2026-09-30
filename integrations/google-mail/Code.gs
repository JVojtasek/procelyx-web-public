/** PROCELYX private mail gateway. Deploy as owner, web app access Anyone.
 * Script property CONTACT_SHARED_SECRET must match Worker GOOGLE_MAIL_SECRET.
 * Requires only script.send_mail; never reads the owner's mailbox.
 */
function doGet() {
  return result_({service:'procelyx-mail',version:1});
}

function doPost(e) {
  var lock;
  try {
    if (!e || !e.postData || e.postData.contents.length > 60000) return result_({ok:false,error:'invalid_request'});
    var envelope = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('CONTACT_SHARED_SECRET');
    if (!secret || secret.length < 32) return result_({ok:false,error:'not_configured'});
    if (!Number.isSafeInteger(envelope.timestamp) || Math.abs(Date.now()-envelope.timestamp)>300000 ||
        !/^contact-[a-f0-9]{64}$/.test(envelope.id || '') || typeof envelope.payload !== 'string' ||
        !/^[a-f0-9]{64}$/.test(envelope.signature || '')) return result_({ok:false,error:'unauthorized'});
    var expected = hex_(Utilities.computeHmacSha256Signature(envelope.timestamp+'.'+envelope.id+'.'+envelope.payload,secret,Utilities.Charset.UTF_8));
    var difference=0;
    for(var i=0;i<64;i++) difference |= expected.charCodeAt(i)^envelope.signature.charCodeAt(i);
    if (difference) return result_({ok:false,error:'unauthorized'});
    var mail = JSON.parse(envelope.payload);
    var recipient = props.getProperty('CONTACT_TO') || 'info@procelyx.cz';
    if (mail.to!==recipient || !validEmail_(mail.replyTo) ||
        typeof mail.subject!=='string' || !mail.subject.startsWith('Nová poptávka PROCELYX — ') || mail.subject.length>160 || /[\r\n]/.test(mail.subject) ||
        typeof mail.text!=='string' || mail.text.length>15000 || !mail.text ||
        typeof mail.html!=='string' || mail.html.length>40000) return result_({ok:false,error:'invalid_message'});
    lock=LockService.getScriptLock();
    if(!lock.tryLock(5000)) return result_({ok:false,error:'busy'});
    var now=Date.now();
    var all=props.getProperties();
    var count=0;
    Object.keys(all).forEach(function(k){
      if(k.indexOf('sent:')!==0) return;
      var entry=JSON.parse(all[k]);
      if(now-entry.time>86400000) props.deleteProperty(k); else count++;
    });
    var storageKey='sent:'+envelope.id;
    var previous=props.getProperty(storageKey);
    if(previous){
      if(JSON.parse(previous).state==='sent') return result_({ok:true,id:envelope.id});
      return result_({ok:false,error:'delivery_uncertain'});
    }
    // A small site limit also keeps the deduplication store below its quota.
    if(count>=500 || MailApp.getRemainingDailyQuota()<1) return result_({ok:false,error:'quota_exceeded'});
    props.setProperty(storageKey,JSON.stringify({time:now,state:'sending'}));
    // Keep an uncertain marker if the send or the final state write throws.
    MailApp.sendEmail({to:recipient,subject:mail.subject,body:mail.text,htmlBody:mail.html,replyTo:mail.replyTo,name:'PROCELYX Web'});
    props.setProperty(storageKey,JSON.stringify({time:now,state:'sent'}));
    return result_({ok:true,id:envelope.id});
  } catch(error) {
    // No request bodies, addresses, provider details, or credentials in logs.
    return result_({ok:false,error:'delivery_uncertain'});
  } finally {
    if(lock && lock.hasLock()) lock.releaseLock();
  }
}
function validEmail_(value){return typeof value==='string' && value.length<=254 && /^[^\s@<>"\x00-\x1f\x7f]+@[^\s@<>"\x00-\x1f\x7f]+\.[^\s@<>"\x00-\x1f\x7f]+$/.test(value);}
function hex_(bytes){return bytes.map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function result_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
