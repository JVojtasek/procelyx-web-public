// Texts live in content/i18n/{cs,en}.json; the build publishes them as /i18n.js (window.PROCELYX_I18N)
// and injects the Czech ones into the HTML, so the page reads the same before and after JavaScript.
const T=window.PROCELYX_I18N;
function updateAccessibleCopy(x){
 // Image alt texts are slots: data-alt names the dictionary key (content/i18n, content/manifest.json).
 document.querySelectorAll('[data-alt]').forEach(img=>{const k=img.dataset.alt;if(T[x][k])img.alt=T[x][k]});
  document.querySelectorAll('.qrLink').forEach(a=>a.setAttribute('aria-label',x==='cs'?'QR kód a vizitka':'QR code and contact card'));
  document.querySelector('#ukazka .switch').setAttribute('aria-label',x==='cs'?'Způsob zpracování':'Processing method');
  document.querySelector('.skip').textContent=x==='cs'?'Přejít na obsah':'Skip to content';
}
const site=window.PROCELYX_CONFIG;
let lang=new URLSearchParams(location.search).get('lang')||(()=>{try{return sessionStorage.getItem('pxlang')}catch{return null}})()||'cs';
function setLang(x){x=x==='en'?'en':'cs';lang=x;updateAccessibleCopy(x);document.documentElement.lang=x;try{sessionStorage.setItem('pxlang',x)}catch{};document.querySelectorAll('[data-t]').forEach(e=>{const k=e.dataset.t;if(T[x][k])e.textContent=T[x][k]});document.querySelectorAll('[data-ph]').forEach(e=>{const k=e.dataset.ph;if(T[x][k])e.placeholder=T[x][k]});document.querySelector('#lang').textContent=x==='cs'?'EN':'CZ';document.title=site.seoTitle[x];document.querySelector('meta[name="description"]').content=site.seoDescription[x];document.querySelector('[data-site="founderTitle"]').textContent=site.founderTitle[x];document.querySelector('#lang').setAttribute('aria-label',x==='cs'?'Switch to English':'Přepnout do češtiny');document.querySelector('#menu').setAttribute('aria-label',x==='cs'?'Otevřít menu':'Open menu');document.querySelector('#chatBtn').setAttribute('aria-label',x==='cs'?'Otevřít ukázkového asistenta':'Open demo assistant');document.querySelector('#close').setAttribute('aria-label',x==='cs'?'Zavřít asistenta':'Close assistant');document.querySelector('#chatInput').setAttribute('aria-label',x==='cs'?'Dotaz pro ukázkového asistenta':'Question for demo assistant');document.querySelector('#chatForm button').setAttribute('aria-label',x==='cs'?'Odeslat dotaz':'Send question');document.querySelector('#leadForm').setAttribute('aria-label',x==='cs'?'Kontaktní formulář':'Contact form');document.querySelectorAll('.tr input').forEach((e,i)=>e.setAttribute('aria-label',(x==='cs'?'Vybrat položku ':'Select item ')+(i+1)))}
setLang(lang);
document.querySelector('#lang').onclick=()=>setLang(lang==='cs'?'en':'cs');
function closeMenu(){document.querySelector('#mobile').classList.remove('open');document.querySelector('#menu').setAttribute('aria-expanded','false')}
document.querySelector('#menu').onclick=()=>{const open=document.querySelector('#mobile').classList.toggle('open');document.querySelector('#menu').setAttribute('aria-expanded',String(open))};
document.querySelectorAll('#mobile a').forEach(a=>a.onclick=closeMenu);

document.querySelector('#analyze').onclick=()=>{const b=document.querySelector('#analyze');b.disabled=true;b.textContent=lang==='cs'?'Analyzuji...':'Analyzing...';setTimeout(()=>{document.querySelector('#stage1').classList.remove('active');document.querySelector('#stage2').classList.add('active')},700)};
function setExampleMode(manual){
  document.querySelector('#manualPanel').hidden=!manual;
  document.querySelector('#autoPanel').hidden=manual;
  document.querySelector('#manualButton').setAttribute('aria-pressed',String(manual));
  document.querySelector('#autoButton').setAttribute('aria-pressed',String(!manual));
}
document.querySelector('#manualButton').onclick=()=>setExampleMode(true);
document.querySelector('#autoButton').onclick=()=>setExampleMode(false);
function revealTechnicalDemo(){if(location.hash==='#demo')document.querySelector('.demoDisclosure').open=true;}
addEventListener('hashchange',revealTechnicalDemo);revealTechnicalDemo();
document.querySelector('a[href="#demo"]').addEventListener('click',()=>{document.querySelector('.demoDisclosure').open=true;});
document.querySelector('#export').onclick=()=>{
  const rows=[...document.querySelectorAll('.table label.tr')].filter(row=>row.querySelector('input').checked).map(row=>[...row.querySelectorAll('span')].map(cell=>cell.textContent.trim()));
  const msg=document.querySelector('#exportMsg');
  if(!rows.length){msg.textContent=lang==='cs'?'Nejprve vyberte alespoň jednu položku.':'Select at least one item first.';return;}
  const headers=lang==='cs'?['Díl','Typ','Délka']:['Part','Type','Length'];
  const csv='\ufeff'+[headers,...rows].map(row=>row.map(value=>'"'+value.replaceAll('"','""')+'"').join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='procelyx-modelova-ukazka.csv';document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  msg.textContent=lang==='cs'?'CSV s modelovými daty je připravený ke stažení. Počet položek: '+rows.length+'.':'The sample CSV is ready to download. Items: '+rows.length+'.';
};

// First touch in this tab session: campaign parameters (utm_*) and an external referring page
// (origin + path only). Sent only together with a submitted inquiry; see privacy.html section 6.
const leadSource=(()=>{
  const read=()=>{try{return JSON.parse(sessionStorage.getItem('pxsrc')||'null')}catch{return null}};
  const saved=read();if(saved&&typeof saved==='object')return saved;
  const q=new URLSearchParams(location.search),src={};
  for(const [param,field] of [['utm_source','utmSource'],['utm_medium','utmMedium'],['utm_campaign','utmCampaign'],['utm_content','utmContent'],['utm_term','utmTerm']]){const v=(q.get(param)||'').trim().slice(0,200);if(v)src[field]=v;}
  try{const r=new URL(document.referrer);if(r.protocol==='https:'&&r.hostname!=='procelyx.cz'&&r.hostname!=='www.procelyx.cz')src.referrer=(r.origin+r.pathname).slice(0,500);}catch{}
  try{sessionStorage.setItem('pxsrc',JSON.stringify(src))}catch{}
  return src;
})();
let submitting=false;
let submissionId=crypto.randomUUID();
document.querySelector('#leadForm').onsubmit=async e=>{
  e.preventDefault();
  if(submitting)return;
  const form=e.currentTarget;
  if(!form.reportValidity())return;
  const button=form.querySelector('button[type="submit"]');
  const msg=document.querySelector('#formMsg');
  const payload=Object.fromEntries(['company','name','email','phone','area','message','website'].map(id=>[id,document.getElementById(id).value.trim()]));
  payload.page='https://procelyx.cz'+location.pathname;
  payload.submissionId=submissionId;
  Object.assign(payload,leadSource);
  submitting=true;button.disabled=true;form.setAttribute('aria-busy','true');
  button.textContent=lang==='cs'?'Odesílám…':'Sending…';msg.className='';msg.textContent='';
  try{
    const response=await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok!==true)throw new Error(response.status===429?'rate_limited':'submit_failed');
    msg.className='formok';
    msg.textContent=lang==='cs'?'Děkuji, poptávka byla přijata k odeslání. Ozvu se vám co nejdříve.':'Thank you. Your inquiry has been accepted for sending. I will get back to you shortly.';
    form.reset();submissionId=crypto.randomUUID();
  }catch(err){
    msg.className='formerror';
    msg.textContent=err.message==='rate_limited'
      ?(lang==='cs'?'Odesíláte příliš často. Počkejte prosím minutu a zkuste to znovu.':'Too many attempts. Please wait a minute and try again.')
      :(lang==='cs'?`Odeslání se nepodařilo potvrdit. Text zůstal vyplněný. Zkuste odeslat znovu, napište na ${site.email} nebo zavolejte ${site.phone}.`:`Sending could not be confirmed. Your text has been kept. Please retry, email ${site.email} or call ${site.phone}.`);
  }finally{
    submitting=false;button.disabled=false;form.removeAttribute('aria-busy');button.textContent=T[lang].submit;
  }
};

const chat=document.querySelector('#chat');
document.querySelector('#chatBtn').hidden=!site.chatDemoEnabled;document.querySelector('#chatBtn').onclick=()=>{chat.classList.add('open');document.querySelector('#chatBtn').setAttribute('aria-expanded','true');document.querySelector('#chatInput').focus()};
function closeChat(){chat.classList.remove('open');document.querySelector('#chatBtn').setAttribute('aria-expanded','false');document.querySelector('#chatBtn').focus()}document.querySelector('#close').onclick=closeChat;document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMenu();if(chat.classList.contains('open'))closeChat()}});
const A={cs:{hub:'AI Hub je společná vrstva nad vašimi systémy a daty. Specializovaní agenti řeší obchod, projekty, znalosti, servis nebo reporting a předávají si kontext podle jasných pravidel.',sales:'Typicky umíme automatizovat kvalifikaci leadů, zápisy do CRM, návrhy odpovědí, follow-up, přípravu schůzek, nabídky a další obchodní rutinu.',start:'Začneme jedním konkrétním procesem. Zmapujeme ruční práci, navrhneme pilot a teprve po ověření přínosu řešení rozšiřujeme.',fallback:'Tohle může být dobrý kandidát na automatizaci. Popište proces ve formuláři a podíváme se, kde lze ubrat ruční práci.'},en:{hub:'An AI Hub is a shared layer over your systems and data. Specialized agents can handle sales, projects, knowledge, service or reporting and pass context according to clear rules.',sales:'Typical use cases include lead qualification, CRM updates, reply drafting, follow-up, meeting preparation, quotations and other repetitive sales work.',start:'We start with one concrete process, map the manual work, build a pilot and expand only after the value is proven.',fallback:'This may be a good automation candidate. Describe the process in the form and we can look at where manual work can be reduced.'}};
function add(m,w){const p=document.createElement('p');p.className=w;p.textContent=m;document.querySelector('#msgs').appendChild(p);document.querySelector('#msgs').scrollTop=document.querySelector('#msgs').scrollHeight}
function reply(q){const s=q.toLowerCase();const k=s.includes('hub')?'hub':s.includes('sales')||s.includes('obchod')?'sales':s.includes('start')||s.includes('zač')?'start':'fallback';setTimeout(()=>add(A[lang][k],'bot'),180)}
document.querySelectorAll('.chips button').forEach(b=>b.onclick=()=>{add(b.textContent,'user');reply(b.dataset.q)});
document.querySelector('#chatForm').onsubmit=e=>{e.preventDefault();const i=document.querySelector('#chatInput'),q=i.value.trim();if(!q)return;add(q,'user');i.value='';reply(q)};
document.querySelector('#chatContact').onclick=e=>{e.preventDefault();chat.classList.remove('open');document.querySelector('#chatBtn').setAttribute('aria-expanded','false');location.hash='contact';requestAnimationFrame(()=>document.querySelector('#name').focus({preventScroll:true}));};
document.querySelector('#year').textContent=new Date().getFullYear();
