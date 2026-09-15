/* Standalone, dependency-free learner app. No admin code or credentials. */
(() => {
 'use strict';
 const $=s=>document.querySelector(s), config=window.EXAM_BANK_CONFIG||{}, cloud=config.mode==='supabase';
 const state={questions:[],topics:[],filtered:[],page:0,current:null,kind:'question',image:0,reportToken:'',reportId:null,loading:true};
 const signed=new Map();let readerVersion=0,captchaWidget=null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const base=(config.apiBase||'/learn/api').replace(/\/$/,'');
 const headers=()=>({apikey:config.publishableKey,'Content-Type':'application/json'});
 async function json(url,options={}) {
   const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});
   let data;try{data=await response.json();}catch{throw Error('The server did not return a valid response. Please try again.');}
   if(!response.ok)throw Error(data.error||data.message||'The request failed. Please try again.');
   return data;
 }
 async function rows(table){
   const all=[];
   for(let offset=0;;offset+=500){
     const page=await json(`${config.url}/rest/v1/${table}?select=payload&order=${table==='learner_questions'?'question_id':'code'}&limit=500&offset=${offset}`,{headers:headers()});
     all.push(...page.map(r=>r.payload));if(page.length<500)return all;
   }
 }
 async function asset(path){
   if(!cloud)return base+'/asset?path='+encodeURIComponent(path);
   const cached=signed.get(path);if(cached&&cached.expires>Date.now())return cached.url;
   const data=await json(`${config.url}/storage/v1/object/sign/${config.bucket||'exam-bank'}/${path.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:headers(),body:JSON.stringify({expiresIn:300})});
   const signedPath=data.signedURL||data.signedUrl;
   if(typeof signedPath!=='string')throw Error('The image could not be loaded.');
   const url=new URL(signedPath.startsWith('/object/')?'/storage/v1'+signedPath:signedPath,config.url).href;
   if(new URL(url).origin!==new URL(config.url).origin)throw Error('Invalid file address.');
   signed.set(path,{url,expires:Date.now()+240000});return url;
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
 const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);const img=entry.target;asset(img.dataset.asset).then(url=>img.src=url).catch(()=>{img.replaceWith(Object.assign(document.createElement('p'),{textContent:'Preview unavailable — open question'}));});}},{rootMargin:'150px'});
 function render(){
   observer.disconnect();const count=state.filtered.length,total=Math.ceil(count/12),start=state.page*12;
   $('#count').textContent=count+' question'+(count===1?'':'s');
   $('#results').innerHTML=state.filtered.slice(start,start+12).map(q=>`<button class="question-card" data-id="${esc(q.question_id)}"><div class="preview">${q.images.length?`<img data-asset="${esc(q.images[0])}" alt="Preview of question ${esc(q.number)}" loading="lazy">`:`<p class="preview-text">${esc((q.text||'Question preview unavailable.').slice(0,200))}</p>`}</div><div class="card-body"><div class="card-meta"><span>QUESTION ${esc(q.number)} · GRADE ${q.grade}</span><span>${esc(q.marks??'—')} marks</span></div><h3>${esc(topicName(q.topic_primary))}</h3><p class="card-source">${esc(q.institution)} · ${q.year} · ${esc(q.paper||'Combined')}</p><div class="card-footer"><span class="tag ${hasMemo(q)?'':'missing'}">${hasMemo(q)?'Memo available':'Memo not yet available'}</span><span>${q.question_type==='mcq'?'Multiple choice':'Written'} ↗</span></div></div></button>`).join('')||'<div class="empty"><h3>No questions found</h3><p>Try another topic, or reset your filters.</p></div>';
   $('#results').querySelectorAll('[data-asset]').forEach(img=>{img.style.opacity='0';img.onload=()=>img.style.opacity='1';img.onerror=()=>img.replaceWith(Object.assign(document.createElement('p'),{textContent:'Preview unavailable — open question'}));observer.observe(img);});
   $('#previous').disabled=state.page===0;$('#next').disabled=state.page+1>=total;$('#pageLabel').textContent=total?`Page ${state.page+1} of ${total}`:'0 results';
 }
 async function documentView(){
   const version=++readerVersion,q=state.current,memo=state.kind==='memo',images=memo?q.memo_images:q.images;
   $('#questionTab').setAttribute('aria-pressed',String(!memo));$('#memoTab').setAttribute('aria-pressed',String(memo));
   $('#imageCount').textContent=images.length?`${state.image+1} / ${images.length}`:'Text view';$('#prevImage').disabled=state.image===0;$('#nextImage').disabled=state.image>=images.length-1;
   $('#original').hidden=true;$('#original').removeAttribute('href');$('#document').innerHTML='<p class="muted">Loading…</p>';
   const pdf=memo?q.memo_pdf:q.question_pdf;
   if(pdf)asset(pdf).then(url=>{if(version===readerVersion){$('#original').href=url;$('#original').hidden=false;}}).catch(()=>{});
   if(!images.length){$('#document').innerHTML=`<pre>${esc(memo?(q.answer||'A marking memo has not been added yet. You can still practise the question.'):(q.text||'This question has no image yet. Try the original PDF.'))}</pre>`;return;}
   try{const url=await asset(images[state.image]);if(version!==readerVersion)return;const image=new Image();image.alt=`${memo?'Memo':'Question'} ${q.number}, section ${state.image+1}`;image.src=url;image.onerror=()=>{if(version===readerVersion)$('#document').textContent='Image unavailable. Try the original PDF or report this problem.';};$('#document').replaceChildren(image);$('#document').scrollTop=0;}
   catch(e){if(version===readerVersion)$('#document').textContent=e.message;}
 }
 function openQuestion(id){state.current=state.questions.find(q=>q.question_id===id);if(!state.current)return;state.kind='question';state.image=0;const q=state.current;$('#readerMeta').textContent=`Grade ${q.grade} · ${q.year} · ${q.institution} · ${q.marks??'—'} marks`;$('#readerTitle').textContent=`Question ${q.number} · ${topicName(q.topic_primary)}`;$('#reader').showModal();documentView();}
 function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,6000);}
 async function captcha(){
   if(!cloud)return;
   if(!config.turnstileSiteKey||config.turnstileSiteKey.includes('YOUR_'))throw Error('Reporting is not connected yet. The site owner needs to configure verification.');
   if(!window.turnstile)await new Promise((resolve,reject)=>{let script=document.querySelector('#turnstileScript');if(script)script.remove();script=document.createElement('script');script.id='turnstileScript';script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.onload=resolve;script.onerror=()=>reject(Error('Could not load verification. Check your connection.'));document.head.appendChild(script);});
   if(captchaWidget!==null)window.turnstile.reset(captchaWidget);else captchaWidget=window.turnstile.render('#captcha',{sitekey:config.turnstileSiteKey,action:'report'});
 }
 $('#results').onclick=e=>{const card=e.target.closest('[data-id]');if(card)openQuestion(card.dataset.id);};
 $('#filters').onsubmit=e=>e.preventDefault();$('#filters').onchange=e=>{if(e.target.id==='grade')topics();filter();};
 let searchTimer;$('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(filter,180);};
 $('#clear').onclick=()=>{$('#filters').reset();topics();filter();};
 $('#previous').onclick=()=>{state.page--;render();};$('#next').onclick=()=>{state.page++;render();};
 $('[id=questionTab]').onclick=()=>{state.kind='question';state.image=0;documentView();};$('#memoTab').onclick=()=>{state.kind='memo';state.image=0;documentView();};
 $('#prevImage').onclick=()=>{state.image--;documentView();};$('#nextImage').onclick=()=>{state.image++;documentView();};
 $('#fit').onclick=()=>{$('#document').classList.add('fit');$('#fit').setAttribute('aria-pressed','true');$('#zoom').setAttribute('aria-pressed','false');};$('#zoom').onclick=()=>{$('#document').classList.remove('fit');$('#fit').setAttribute('aria-pressed','false');$('#zoom').setAttribute('aria-pressed','true');};
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
 $('#reportButton').onclick=async()=>{state.reportId=crypto.randomUUID();$('#reportForm').reset();$('#reportStatus').textContent='';$('#reportQuestion').textContent=`Question ${state.current.number} · Grade ${state.current.grade} · ${state.current.year}`;$('#reportDialog').showModal();try{await captcha();}catch(e){$('#reportStatus').textContent=e.message;}};
 $('#reportForm').onsubmit=async e=>{
   e.preventDefault();const button=$('#submitReport');button.disabled=true;$('#reportStatus').textContent='Sending…';
   const data={id:state.reportId,question_id:state.current.question_id,kind:$('#reportKind').value,details:$('#reportDetails').value.trim()};
   try{
     if(cloud){data.captcha_token=window.turnstile?.getResponse(captchaWidget)||'';if(!data.captcha_token)throw Error('Please complete the verification.');await json(config.url+'/functions/v1/report-question',{method:'POST',headers:headers(),body:JSON.stringify(data)});}
     else await json(base+'/reports',{method:'POST',headers:{'Content-Type':'application/json','X-Learner-Token':state.reportToken},body:JSON.stringify(data)});
     $('#reportDialog').close();toast('Thank you. Your report has been sent to the question-bank team.');
   }catch(error){$('#reportStatus').textContent=error.message;if(cloud&&captchaWidget!==null)window.turnstile?.reset(captchaWidget);}
   finally{button.disabled=false;}
 };
 async function load(){
   try{
     if(cloud){if(!config.url||!config.publishableKey||config.publishableKey.includes('YOUR_')||!config.url.startsWith('https://'))throw Error('Supabase is not configured yet. Add the public project settings to connect this site.');[state.questions,state.topics]=await Promise.all([rows('learner_questions'),rows('learner_topics')]);}
     else{const data=await json(base+'/catalogue');state.questions=data.questions;state.topics=data.topics;state.reportToken=data.report_token;}
     state.questions.sort((a,b)=>b.year-a.year||a.question_id.localeCompare(b.question_id,undefined,{numeric:true}));
     options('#grade',[...new Set(state.questions.map(q=>q.grade))].sort((a,b)=>a-b),'All grades');options('#year',[...new Set(state.questions.map(q=>q.year))].sort((a,b)=>b-a),'All years');topics();filter();$('#modeLabel').textContent=cloud?'Connected':'Local preview';
   }catch(error){$('#loadError').textContent=error.message;$('#loadError').hidden=false;$('#count').textContent='Collection unavailable';$('#modeLabel').textContent='Not connected';$('#previous').disabled=true;$('#next').disabled=true;}
 }
 load();
})();
