/* Standalone, dependency-free learner app. No admin code or credentials. */
(() => {
 'use strict';
 const $=s=>document.querySelector(s), config=window.EXAM_BANK_CONFIG||{}, cloud=config.mode==='supabase';
 const state={questions:[],topics:[],filtered:[],page:0,current:null,kind:'question',image:0,reportToken:'',reportId:null,loading:true,zoom:0};
 const signed=new Map();let readerVersion=0;
 const THEME='exam-bank.theme',ZOOM={min:50,max:400,step:10};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const base=(config.apiBase||'/learn/api').replace(/\/$/,'');
 // The publishable key is public by design, so it is not the access control:
 // the database only answers a signed-in reader. The session token lives in
 // this browser alone and is never sent anywhere except this Supabase project.
 const SESSION='exam-bank.session';let session=null;
 function restore(){try{const raw=localStorage.getItem(SESSION);const value=raw&&JSON.parse(raw);if(value&&value.access_token&&value.refresh_token)session=value;}catch{session=null;}}
 function remember(value){session=value;try{value?localStorage.setItem(SESSION,JSON.stringify(value)):localStorage.removeItem(SESSION);}catch{}}
 const headers=()=>({apikey:config.publishableKey,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.access_token}:{})});
 async function json(url,options={}) {
   const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});
   let data;try{data=await response.json();}catch{throw Error('The server did not return a valid response. Please try again.');}
   if(!response.ok)throw Error(data.error_description||data.msg||data.error||data.message||'The request failed. Please try again.');
   return data;
 }
 async function grant(body){
   const type=body.refresh_token?'refresh_token':'password';
   const data=await json(`${config.url}/auth/v1/token?grant_type=${type}`,
     {method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(!data.access_token||!data.refresh_token)throw Error('Sign in did not complete. Please try again.');
   return {access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+(Number(data.expires_in)||3600)*1000};
 }
 // Renew shortly before expiry so a long reading session does not break.
 async function fresh(){
   if(!cloud||!session||session.expires_at-Date.now()>60000)return;
   try{remember(await grant({refresh_token:session.refresh_token}));}
   catch{remember(null);signedOut('Your session has ended. Please sign in again.');throw Error('Your session has ended. Please sign in again.');}
 }
 async function rows(table){
   const all=[];
   for(let offset=0;;offset+=500){
     await fresh();
     const page=await json(`${config.url}/rest/v1/${table}?select=payload&order=${table==='learner_questions'?'question_id':'code'}&limit=500&offset=${offset}`,{headers:headers()});
     all.push(...page.map(r=>r.payload));if(page.length<500)return all;
   }
 }
 async function asset(path){
   if(!cloud)return base+'/asset?path='+encodeURIComponent(path);
   const cached=signed.get(path);if(cached&&cached.expires>Date.now())return cached.url;
   await fresh();
   const data=await json(`${config.url}/storage/v1/object/sign/${config.bucket||'exam-bank'}/${path.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:headers(),body:JSON.stringify({expiresIn:300})});
   const signedPath=data.signedURL||data.signedUrl;
   if(typeof signedPath!=='string')throw Error('The image could not be loaded.');
   const url=new URL(signedPath.startsWith('/object/')?'/storage/v1'+signedPath:signedPath,config.url).href;
   if(new URL(url).origin!==new URL(config.url).origin)throw Error('Invalid file address.');
   signed.set(path,{url,expires:Date.now()+240000});return url;
 }
 function theme(value){
   document.documentElement.dataset.theme=value;
   $('#theme').textContent=value==='dark'?'☀':'☾';
   $('#theme').setAttribute('aria-label',value==='dark'?'Switch to light mode':'Switch to dark mode');
   try{localStorage.setItem(THEME,value);}catch{}
 }
 function topicName(code){return state.topics.find(t=>t.code===code)?.label||'Topic to be confirmed';}
 function hasMemo(q){return q.memo_images.length||q.answer;}
 function options(id,values,label){const element=$(id);element.innerHTML=`<option value="">${label}</option>`+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');}
 function topics(){const selected=$('#topic').value,grade=Number($('#grade').value);const available=state.topics.filter(t=>!grade||t.examinable_in.includes(grade));$('#topic').innerHTML='<option value="">All topics'+(grade?` · Grade ${grade}`:'')+'</option>'+available.map(t=>`<option value="${esc(t.code)}">${esc(t.label)}</option>`).join('');if(available.some(t=>t.code===selected))$('#topic').value=selected;}
 function filter(){
   const term=$('#search').value.trim().toLowerCase(),grade=$('#grade').value,year=$('#year').value,type=$('#type').value,topic=$('#topic').value,category=$('#category').value;
   state.filtered=state.questions.filter(q=>(!grade||q.grade==grade)&&(!year||q.year==year)&&(!type||q.question_type===type)&&(!topic||q.topic_primary===topic)&&(!category||q.category===category)&&(!term||`${q.text} ${topicName(q.topic_primary)} ${q.institution} ${q.year}`.toLowerCase().includes(term)));
   state.page=0;render();
 }
 const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);const img=entry.target;asset(img.dataset.asset).then(url=>img.src=url).catch(()=>{img.parentElement?.classList.remove('loading');img.replaceWith(Object.assign(document.createElement('p'),{className:'preview-text',textContent:'Open to view'}));});}},{rootMargin:'150px'});
 function render(){
   observer.disconnect();const count=state.filtered.length,total=Math.ceil(count/12),start=state.page*12;
   $('#count').textContent=count+' question'+(count===1?'':'s');
   $('#results').innerHTML=state.filtered.slice(start,start+12).map(q=>`<button class="question-card" data-id="${esc(q.question_id)}"><div class="preview${q.images.length?' loading':''}">${q.images.length?`<img data-asset="${esc(q.images[0])}" alt="Preview of question ${esc(q.number)}" loading="lazy">`:`<p class="preview-text">${esc((q.text||'Question preview unavailable.').slice(0,200))}</p>`}</div><div class="card-body"><div class="card-meta"><span>QUESTION ${esc(q.number)} · GRADE ${q.grade}</span><span>${esc(q.marks??'—')} marks</span></div><h3>${esc(topicName(q.topic_primary))}</h3><p class="card-source">${esc(q.institution)} · ${q.year} · ${esc(q.paper||'Combined')}</p><div class="card-footer"><span class="tag ${hasMemo(q)?'':'missing'}">${hasMemo(q)?'Memo':'No memo'}</span><span>${q.question_type==='mcq'?'MCQ':'Written'} ↗</span></div></div></button>`).join('')||'<div class="empty"><h3>No questions found</h3><p class="muted">Try another topic or reset the filters.</p></div>';
   $('#results').querySelectorAll('[data-asset]').forEach(img=>{const box=img.parentElement;img.style.opacity='0';
     img.onload=()=>{img.style.opacity='1';box.classList.remove('loading');};
     img.onerror=()=>{box.classList.remove('loading');img.replaceWith(Object.assign(document.createElement('p'),{className:'preview-text',textContent:'Open to view'}));};
     observer.observe(img);});
   $('#previous').disabled=state.page===0;$('#next').disabled=state.page+1>=total;$('#pageLabel').textContent=total?`Page ${state.page+1} of ${total}`:'0 results';
 }
 async function documentView(){
   const version=++readerVersion,q=state.current,memo=state.kind==='memo',images=memo?q.memo_images:q.images;
   $('#questionTab').setAttribute('aria-pressed',String(!memo));$('#memoTab').setAttribute('aria-pressed',String(memo));
   $('#imageCount').textContent=images.length?`${state.image+1} / ${images.length}`:'Text view';$('#prevImage').disabled=state.image===0;$('#nextImage').disabled=state.image>=images.length-1;
   $('#original').hidden=true;$('#original').removeAttribute('href');$('#document').innerHTML='<p class="muted">Loading…</p>';
   const pdf=memo?q.memo_pdf:q.question_pdf;
   if(pdf)asset(pdf).then(url=>{if(version===readerVersion){$('#original').href=url;$('#original').hidden=false;}}).catch(()=>{});
   if(!images.length){$('#document').innerHTML=`<pre>${esc(memo?(q.answer||'No memo yet for this question.'):(q.text||'No image yet. Try the original PDF.'))}</pre>`;return;}
   try{const url=await asset(images[state.image]);if(version!==readerVersion)return;const image=new Image();image.alt=`${memo?'Memo':'Question'} ${q.number}, section ${state.image+1}`;image.src=url;image.onerror=()=>{if(version===readerVersion)$('#document').textContent='Image unavailable. Try the PDF, or report the error.';};$('#document').replaceChildren(image);$('#document').scrollTop=0;}
   catch(e){if(version===readerVersion)$('#document').textContent=e.message;}
 }
 function zoom(percent){
   // 0 fits the whole page; anything else is a width multiple of the viewer.
   state.zoom=percent?Math.min(ZOOM.max,Math.max(ZOOM.min,Math.round(percent/ZOOM.step)*ZOOM.step)):0;
   const fit=!state.zoom;
   $('#document').classList.toggle('fit',fit);
   $('#document').style.setProperty('--zoom',(state.zoom||100)/100);
   $('#fit').setAttribute('aria-pressed',String(fit));
   $('#zoomLabel').textContent=fit?'':state.zoom+'%';
   $('#zoomRange').value=state.zoom||100;
   $('#zoomOut').disabled=state.zoom!==0&&state.zoom<=ZOOM.min;
   $('#zoomIn').disabled=state.zoom>=ZOOM.max;
 }
 function step(delta){zoom((state.zoom||100)+delta);}
 // Questions sharing this one's topic, in the order the collection lists them.
 function peers(){return state.current?state.questions.filter(q=>q.topic_primary===state.current.topic_primary):[];}
 function topicNav(){
   const list=peers(),index=list.findIndex(q=>q.question_id===state.current?.question_id);
   $('#prevTopic').disabled=index<1;$('#nextTopic').disabled=index<0||index>=list.length-1;
   $('#topicPosition').textContent=list.length>1?`${index+1} of ${list.length} in this topic`:'Only question in this topic';
 }
 function stepTopic(delta){
   const list=peers(),index=list.findIndex(q=>q.question_id===state.current?.question_id),next=list[index+delta];
   if(next)openQuestion(next.question_id,true);
 }
 function openQuestion(id,keepZoom){
   const found=state.questions.find(q=>q.question_id===id);if(!found)return;
   state.current=found;state.kind='question';state.image=0;
   // On a phone a fitted full-width crop is unreadable, so start at 200%.
   // Moving through a topic keeps whatever zoom the reader has settled on.
   if(!keepZoom)zoom(window.innerWidth>620?0:200);
   const q=state.current;
   $('#readerMeta').textContent=`Grade ${q.grade} · ${q.year} · ${q.institution} · ${q.marks??'—'} marks`;
   $('#readerTitle').textContent=`Question ${q.number} · ${topicName(q.topic_primary)}`;
   if(!$('#reader').open)$('#reader').showModal();
   topicNav();documentView();
 }
 function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,6000);}
 $('#results').onclick=e=>{const card=e.target.closest('[data-id]');if(card)openQuestion(card.dataset.id);};
 $('#filters').onsubmit=e=>e.preventDefault();$('#filters').onchange=e=>{if(e.target.id==='grade')topics();filter();};
 let searchTimer;$('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(filter,180);};
 $('#clear').onclick=()=>{$('#filters').reset();topics();filter();};
 $('#previous').onclick=()=>{state.page--;render();};$('#next').onclick=()=>{state.page++;render();};
 $('[id=questionTab]').onclick=()=>{state.kind='question';state.image=0;documentView();};$('#memoTab').onclick=()=>{state.kind='memo';state.image=0;documentView();};
 $('#prevImage').onclick=()=>{state.image--;documentView();};$('#nextImage').onclick=()=>{state.image++;documentView();};
 $('#fit').onclick=()=>zoom(0);$('#zoomIn').onclick=()=>step(ZOOM.step*2);$('#zoomOut').onclick=()=>step(-ZOOM.step*2);
 $('#zoomRange').oninput=e=>zoom(Number(e.target.value));
 $('#prevTopic').onclick=()=>stepTopic(-1);$('#nextTopic').onclick=()=>stepTopic(1);
 // Double-tap the page to swap between the whole page and a readable 200%.
 $('#document').ondblclick=()=>zoom(state.zoom?0:200);
 $('#theme').onclick=()=>theme(document.documentElement.dataset.theme==='dark'?'light':'dark');
 document.addEventListener('keydown',e=>{
   if(!$('#reader').open||$('#reportDialog').open||e.ctrlKey||e.metaKey||e.altKey)return;
   if(e.key==='ArrowRight'){e.preventDefault();stepTopic(1);}
   else if(e.key==='ArrowLeft'){e.preventDefault();stepTopic(-1);}
   else if(e.key==='+'||e.key==='='){e.preventDefault();step(ZOOM.step*2);}
   else if(e.key==='-'||e.key==='_'){e.preventDefault();step(-ZOOM.step*2);}
   else if(e.key==='0'){e.preventDefault();zoom(0);}
 });
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
 $('#reportButton').onclick=()=>{state.reportId=crypto.randomUUID();$('#reportForm').reset();$('#reportStatus').textContent='';$('#reportQuestion').textContent=`Question ${state.current.number} · Grade ${state.current.grade} · ${state.current.year}`;$('#reportDialog').showModal();$('#reportDetails').focus();};
 $('#reportForm').onsubmit=async e=>{
   e.preventDefault();const button=$('#submitReport');button.disabled=true;$('#reportStatus').textContent='Sending…';
   const data={id:state.reportId,question_id:state.current.question_id,kind:$('#reportKind').value,details:$('#reportDetails').value.trim()};
   try{
     // Reports are written by the signed-in reader; the session is the check.
     if(cloud){await fresh();await json(config.url+'/rest/v1/rpc/report_question',{method:'POST',headers:headers(),
       body:JSON.stringify({report_id:data.id,qid:data.question_id,report_kind:data.kind,description:data.details})});}
     else await json(base+'/reports',{method:'POST',headers:{'Content-Type':'application/json','X-Learner-Token':state.reportToken},body:JSON.stringify(data)});
     $('#reportDialog').close();toast('Thanks — your report has been sent.');
   }catch(error){$('#reportStatus').textContent=error.message;}
   finally{button.disabled=false;}
 };
 function signedOut(message){
   state.questions=[];state.topics=[];state.filtered=[];signed.clear();
   $('#reader').close();$('#reportDialog').close();
   $('#collection').hidden=true;$('#gate').hidden=false;$('#signOut').hidden=true;
   $('#modeLabel').textContent='Signed out';$('#signInStatus').textContent=message||'';
   $('#password').value='';
 }
 async function load(){
   try{
     if(cloud){
       if(!config.url||!config.publishableKey||config.publishableKey.includes('YOUR_')||!config.url.startsWith('https://'))throw Error('Supabase is not configured yet. Add the public project settings to connect this site.');
       [state.questions,state.topics]=await Promise.all([rows('learner_questions'),rows('learner_topics')]);
     }
     else{const data=await json(base+'/catalogue');state.questions=data.questions;state.topics=data.topics;state.reportToken=data.report_token;}
     state.questions.sort((a,b)=>b.year-a.year||a.question_id.localeCompare(b.question_id,undefined,{numeric:true}));
     $('#gate').hidden=true;$('#collection').hidden=false;$('#signOut').hidden=!cloud;
     options('#grade',[...new Set(state.questions.map(q=>q.grade))].sort((a,b)=>a-b),'All grades');options('#year',[...new Set(state.questions.map(q=>q.year))].sort((a,b)=>b-a),'All years');topics();filter();$('#modeLabel').textContent=cloud?'Connected':'Local preview';
   }catch(error){
     // An expired or revoked session must return to the prompt, not an error page.
     if(cloud&&!session){signedOut(error.message.includes('session')?error.message:'');return;}
     $('#collection').hidden=false;$('#loadError').textContent=error.message;$('#loadError').hidden=false;$('#count').textContent='Collection unavailable';$('#modeLabel').textContent='Not connected';$('#previous').disabled=true;$('#next').disabled=true;
   }
 }
 $('#signInForm').onsubmit=async e=>{
   e.preventDefault();const button=$('#signInButton');button.disabled=true;$('#signInStatus').textContent='Signing in…';
   try{
     remember(await grant({email:$('#email').value.trim(),password:$('#password').value}));
     $('#password').value='';$('#signInStatus').textContent='';await load();
   }catch(error){
     remember(null);
     $('#signInStatus').textContent=/credential|grant|password|email/i.test(error.message)?'That email and password did not match. Please check with your teacher.':error.message;
   }
   finally{button.disabled=false;}
 };
 $('#signOut').onclick=()=>{remember(null);signedOut('You have been signed out.');};
 theme(document.documentElement.dataset.theme==='light'?'light':'dark');
 restore();
 if(cloud&&!session)signedOut();else load();
})();
