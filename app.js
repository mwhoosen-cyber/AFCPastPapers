/* Standalone, dependency-free learner app. No admin code or credentials. */
(() => {
 'use strict';
 const $=s=>document.querySelector(s), config=window.EXAM_BANK_CONFIG||{}, cloud=config.mode==='supabase';
 const state={questions:[],topics:[],filtered:[],page:0,current:null,kind:'question',image:0,reportToken:'',reportId:null,loading:true,zoom:0};
 const signed=new Map();let readerVersion=0;
 const THEME='exam-bank.theme',FILTERS='exam-bank.filters',VIEW='exam-bank.view',SIGNED='exam-bank.signed',ZOOM={min:50,max:400,step:10};
 // A signed URL is a short-lived link to one immutable, content-addressed file.
 // Minting a fresh one for every view put a different token in the query string
 // each time, so the browser never recognised a picture it had already fetched
 // and downloaded the whole thing again. They now last the hour that Storage
 // already lets its files be cached for, and they survive a reload, which is
 // what lets that cache do its job at all. They sit beside the sign-in session
 // in this browser and are cleared with it.
 const SIGN_LIFE=3600,SIGN_KEEP=3300000,SIGN_LIMIT=900;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const base=(config.apiBase||'/learn/api').replace(/\/$/,'');
 // The publishable key is public by design, so it is not the access control:
 // the database only answers a signed-in reader. The session token lives in
 // this browser alone and is never sent anywhere except this Supabase project.
 const SESSION='exam-bank.session';let session=null;
 function restore(){try{const raw=localStorage.getItem(SESSION);const value=raw&&JSON.parse(raw);if(value&&value.access_token&&value.refresh_token)session=value;}catch{session=null;}}
 function remember(value){session=value;try{value?localStorage.setItem(SESSION,JSON.stringify(value)):localStorage.removeItem(SESSION);}catch{}}
 function keep(key,value){try{value==null?localStorage.removeItem(key):localStorage.setItem(key,JSON.stringify(value));}catch{}}
 function recall(key){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;}catch{return null;}}
 let signTimer;
 function persistSigned(){
   clearTimeout(signTimer);
   signTimer=setTimeout(()=>{
     // Longest-lived first and capped, so a long afternoon of reading cannot
     // fill this browser's storage with links that have already expired.
     const live=[...signed].filter(([,v])=>v.expires>Date.now()).sort((a,b)=>b[1].expires-a[1].expires).slice(0,SIGN_LIMIT);
     signed.clear();for(const [path,value] of live)signed.set(path,value);
     keep(SIGNED,Object.fromEntries(live));
   },1500);
 }
 function restoreSigned(){
   const saved=recall(SIGNED);if(!saved||typeof saved!=='object')return;
   for(const [path,value] of Object.entries(saved))
     if(value&&typeof value.url==='string'&&value.expires>Date.now())signed.set(path,value);
 }
 function forgetSigned(){clearTimeout(signTimer);signed.clear();keep(SIGNED,null);}
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
   const data=await json(`${config.url}/storage/v1/object/sign/${config.bucket||'exam-bank'}/${path.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:headers(),body:JSON.stringify({expiresIn:SIGN_LIFE})});
   const signedPath=data.signedURL||data.signedUrl;
   if(typeof signedPath!=='string')throw Error('The image could not be loaded.');
   const url=new URL(signedPath.startsWith('/object/')?'/storage/v1'+signedPath:signedPath,config.url).href;
   if(new URL(url).origin!==new URL(config.url).origin)throw Error('Invalid file address.');
   // Kept a little short of the hour it is good for, so a link handed out at
   // the last moment does not expire underneath a picture still arriving.
   signed.set(path,{url,expires:Date.now()+SIGN_KEEP});persistSigned();return url;
 }

 /* ---- The collection is kept, not fetched again --------------------------
    Every load used to download the whole collection: megabytes of JSON, most
    of this project's database egress, spent being told the same thing as last
    time. It changes only when a teacher republishes, so it is kept in this
    browser and fetched again when the published revision is different. Every
    step is allowed to fail: with no store available, or before the project
    has been given bank_revision(), the collection is downloaded as before. */
 const SHELF='catalogue';
 function shelf(mode){
   return new Promise((resolve,reject)=>{
     const request=indexedDB.open('exam-bank',1);
     request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(SHELF))db.createObjectStore(SHELF);};
     request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Storage is busy.'));
     request.onsuccess=()=>{try{resolve([request.result,request.result.transaction(SHELF,mode).objectStore(SHELF)]);}catch(error){request.result.close();reject(error);}};
   });
 }
 function shelved(mode,run){
   return new Promise((resolve,reject)=>shelf(mode).then(([db,store])=>{
     const call=run(store);
     call.onsuccess=()=>{resolve(call.result);db.close();};
     call.onerror=()=>{reject(call.error);db.close();};
   },reject));
 }
 const readCatalogue=()=>shelved('readonly',store=>store.get('current')).catch(()=>null);
 const writeCatalogue=value=>shelved('readwrite',store=>store.put(value,'current')).catch(()=>{});
 const dropCatalogue=()=>shelved('readwrite',store=>store.delete('current')).catch(()=>{});
 async function published(){
   try{
     const value=await json(`${config.url}/rest/v1/rpc/bank_revision`,{method:'POST',headers:headers(),body:'{}'});
     return typeof value==='string'&&value?value:null;
   }catch{return null;}
 }
 function theme(value){
   document.documentElement.dataset.theme=value;
   $('#theme').textContent=value==='dark'?'☀':'☾';
   $('#theme').setAttribute('aria-label',value==='dark'?'Switch to light mode':'Switch to dark mode');
   keep(THEME,undefined);try{localStorage.setItem(THEME,value);}catch{}
 }
 function topicName(code){return state.topics.find(t=>t.code===code)?.label||'Topic to be confirmed';}
 // A topic only means something alongside its grade: CHEM-IMF is a different
 // body of work in Grade 11 than in Grade 12, so the two are never merged.
 function topicLabel(grade,code){return `Grade ${grade} · ${topicName(code)}`;}
 function hasMemo(q){return q.memo_images.length>0||!!q.memo_text;}
 function options(id,values,label){const element=$(id);element.innerHTML=`<option value="">${label}</option>`+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');}
 function topics(){const selected=$('#topic').value,grade=Number($('#grade').value);const available=state.topics.filter(t=>!grade||t.examinable_in.includes(grade));$('#topic').innerHTML='<option value="">All topics'+(grade?` · Grade ${grade}`:'')+'</option>'+available.map(t=>`<option value="${esc(t.code)}">${esc(t.label)}</option>`).join('');if(available.some(t=>t.code===selected))$('#topic').value=selected;}

 /* ---- Topic picker -------------------------------------------------------
    51 topics in one dropdown is unusable, and a bare topic name hides the
    grade. The picker lists each grade-and-topic pair that actually has
    questions, with its count, and is searchable. Choosing one sets the grade
    and the topic together, so the two can never disagree. */
 function topicEntries(){
   // Counted as grade -> code -> total, so no delimiter has to be invented
   // for a composite key and no topic code can ever collide with one.
   const counts=new Map();
   for(const q of state.questions){
     if(!q.topic_primary||q.grade==null)continue;
     let inner=counts.get(q.grade);
     if(!inner)counts.set(q.grade,inner=new Map());
     inner.set(q.topic_primary,(inner.get(q.topic_primary)||0)+1);
   }
   const out=[];
   for(const [grade,inner] of counts)
     for(const [code,count] of inner)out.push({grade,code,label:topicName(code),count});
   return out.sort((a,b)=>a.grade-b.grade||a.label.localeCompare(b.label));
 }
 function syncTopicButton(){
   const code=$('#topic').value,grade=$('#grade').value;
   $('#topicButtonText').textContent=code?(grade?topicLabel(grade,code):topicName(code)):(grade?`All Grade ${grade} topics`:'All topics');
   $('#topicButton').classList.toggle('chosen',!!code);
 }
 function applyTopic(grade,code){
   $('#grade').value=grade==null?'':String(grade);
   topics();
   $('#topic').value=code||'';
   syncTopicButton();saveFilters();filter();
 }
 function renderTopicList(){
   const term=$('#topicSearch').value.trim().toLowerCase();
   const entries=topicEntries().filter(e=>!term||e.label.toLowerCase().includes(term)||('grade '+e.grade).includes(term));
   const current=$('#topic').value,currentGrade=$('#grade').value;
   let html=`<button type="button" class="picker-row all${current?'':' selected'}" data-grade="" data-code="" role="option" aria-selected="${!current}"><span class="row-label">All topics</span><span class="row-count">${state.questions.length}</span></button>`;
   let grade=null;
   for(const entry of entries){
     if(entry.grade!==grade){grade=entry.grade;html+=`<p class="picker-group">Grade ${grade}</p>`;}
     const selected=current===entry.code&&String(entry.grade)===String(currentGrade);
     html+=`<button type="button" class="picker-row${selected?' selected':''}" data-grade="${entry.grade}" data-code="${esc(entry.code)}" role="option" aria-selected="${selected}"><span class="row-label"><span class="row-grade">Gr ${entry.grade}</span>${esc(entry.label)}</span><span class="row-count">${entry.count}</span></button>`;
   }
   $('#topicList').innerHTML=entries.length?html:'<p class="picker-empty">No topic matches that search.</p>';
 }
 function openTopicPicker(){
   $('#topicSearch').value='';renderTopicList();$('#topicPicker').showModal();
   const selected=$('#topicList .selected');
   if(selected)selected.scrollIntoView({block:'center'});
   if(window.innerWidth>620)$('#topicSearch').focus();
 }

 function saveFilters(){keep(FILTERS,{grade:$('#grade').value,topic:$('#topic').value,year:$('#year').value,type:$('#type').value,category:$('#category').value});}
 function restoreFilters(){
   const saved=recall(FILTERS);if(!saved)return;
   for(const [id,value] of Object.entries(saved)){
     const element=$('#'+id);if(!element||!value)continue;
     if(id==='topic')continue;
     if([...element.options].some(o=>o.value===value))element.value=value;
   }
   topics();
   if(saved.topic&&[...$('#topic').options].some(o=>o.value===saved.topic))$('#topic').value=saved.topic;
 }
 function activeChips(){
   const chips=[];
   const grade=$('#grade').value,topic=$('#topic').value,year=$('#year').value,type=$('#type').value,category=$('#category').value;
   if(topic)chips.push(['topic',grade?topicLabel(grade,topic):topicName(topic)]);
   else if(grade)chips.push(['grade','Grade '+grade]);
   if(year)chips.push(['year',year]);
   if(type)chips.push(['type',type==='mcq'?'Multiple choice':'Written']);
   if(category)chips.push(['category',$('#category').selectedOptions[0].textContent]);
   $('#activeFilters').innerHTML=chips.map(([key,label])=>`<button type="button" class="filter-chip" data-drop="${key}">${esc(label)}<span aria-hidden="true">×</span><span class="visually-hidden">Remove filter</span></button>`).join('');
 }
 function banner(){
   const total=state.questions.length,shown=state.filtered.length;
   const number=n=>n.toLocaleString('en-ZA').replace(/,/g,' ');
   $('#bannerCount').textContent=number(shown);
   $('#bannerDetail').textContent=shown===total?`question${total===1?'':'s'} in the collection`:`of ${number(total)} questions match your filters`;
   $('#countBanner').hidden=false;
 }
 function filter(){
   const term=$('#search').value.trim().toLowerCase(),grade=$('#grade').value,year=$('#year').value,type=$('#type').value,topic=$('#topic').value,category=$('#category').value;
   state.filtered=state.questions.filter(q=>(!grade||q.grade==grade)&&(!year||q.year==year)&&(!type||q.question_type===type)&&(!topic||q.topic_primary===topic)&&(!category||q.category===category)&&(!term||`${q.text} ${topicName(q.topic_primary)} ${q.institution} ${q.year}`.toLowerCase().includes(term)));
   state.page=0;activeChips();render();
 }
 const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);const img=entry.target;asset(img.dataset.asset).then(url=>img.src=url).catch(()=>{img.parentElement?.classList.remove('loading');img.replaceWith(Object.assign(document.createElement('p'),{className:'preview-text',textContent:'Open to view'}));});}},{rootMargin:'150px'});
 function render(){
   observer.disconnect();const count=state.filtered.length,total=Math.ceil(count/12),start=state.page*12;
   $('#count').textContent=count+' question'+(count===1?'':'s');banner();
   $('#results').innerHTML=state.filtered.slice(start,start+12).map(q=>`<button class="question-card" data-id="${esc(q.question_id)}"><div class="preview${q.images.length?' loading':''}">${q.images.length?`<img data-asset="${esc(q.thumb||q.images[0])}" alt="Preview of question ${esc(q.number)}" loading="lazy">`:`<p class="preview-text">${esc((q.text||'Question preview unavailable.').slice(0,200))}</p>`}</div><div class="card-body"><div class="card-meta"><span>QUESTION ${esc(q.number)} · GRADE ${q.grade}</span><span>${esc(q.marks??'—')} marks</span></div><h3><span class="grade-badge">Gr ${q.grade}</span>${esc(topicName(q.topic_primary))}</h3><p class="card-source">${esc(q.institution)} · ${q.year} · ${esc(q.paper||'Combined')}</p><div class="card-footer"><span class="tag ${hasMemo(q)?'':'missing'}">${hasMemo(q)?'Memo':'No memo'}</span><span>${q.question_type==='mcq'?'MCQ':'Written'} ↗</span></div></div></button>`).join('')||'<div class="empty"><h3>No questions found</h3><p class="muted">Try another topic or reset the filters.</p></div>';
   $('#results').querySelectorAll('[data-asset]').forEach(img=>{const box=img.parentElement;img.style.opacity='0';
     img.onload=()=>{img.style.opacity='1';box.classList.remove('loading');};
     img.onerror=()=>{box.classList.remove('loading');img.replaceWith(Object.assign(document.createElement('p'),{className:'preview-text',textContent:'Open to view'}));};
     observer.observe(img);});
   $('#previous').disabled=state.page===0;$('#next').disabled=state.page+1>=total;$('#pageLabel').textContent=total?`Page ${state.page+1} of ${total}`:'0 results';
 }
 function memoTabState(){
   const has=!!hasMemo(state.current),tab=$('#memoTab');
   tab.disabled=!has;tab.classList.toggle('empty',!has);
   tab.querySelector('.tab-text').textContent=has?'Memo':'No memo';
   tab.title=has?'':'No memo has been added for this question yet.';
   if(!has&&state.kind==='memo')state.kind='question';
 }
 async function documentView(){
   const version=++readerVersion,q=state.current,memo=state.kind==='memo',images=memo?q.memo_images:q.images;
   $('#questionTab').setAttribute('aria-pressed',String(!memo));$('#memoTab').setAttribute('aria-pressed',String(memo));
   $('#imageCount').textContent=images.length?`${state.image+1} / ${images.length}`:'Text view';$('#prevImage').disabled=state.image===0;$('#nextImage').disabled=state.image>=images.length-1;
   // Nothing to page through on a one-page crop, so the phone reclaims the row.
   $('#reader').classList.toggle('single-page',images.length<=1);
   $('#original').hidden=true;$('#original').removeAttribute('href');$('#document').innerHTML='<p class="muted">Loading…</p>';
   const pdf=memo?q.memo_pdf:q.question_pdf;
   if(pdf)asset(pdf).then(url=>{if(version===readerVersion){$('#original').href=url;$('#original').hidden=false;}}).catch(()=>{});
   if(!images.length){$('#document').innerHTML=`<pre>${esc(memo?(q.memo_text||'No memo yet for this question.'):(q.text||'No image yet. Try the original PDF.'))}</pre>`;return;}
   try{const url=await asset(images[state.image]);if(version!==readerVersion)return;const image=new Image();image.alt=`${memo?'Memo':'Question'} ${q.number}, section ${state.image+1}`;image.src=url;image.onerror=()=>{if(version===readerVersion)$('#document').textContent='Image unavailable. Try the PDF, or report the error.';};$('#document').replaceChildren(image);$('#document').scrollTop=0;}
   catch(e){if(version===readerVersion)$('#document').textContent=e.message;}
 }
 function applyZoom(){
   const fit=!state.zoom,doc=$('#document');
   doc.classList.toggle('fit',fit);
   doc.style.setProperty('--zoom',(state.zoom||100)/100);
   $('#fit').setAttribute('aria-pressed',String(fit));
   $('#fitWidth').setAttribute('aria-pressed',String(state.zoom===100));
   $('#zoomLabel').textContent=fit?'':state.zoom+'%';
   $('#zoomRange').value=state.zoom||100;
   $('#zoomOut').disabled=!fit&&state.zoom<=ZOOM.min;
   $('#zoomIn').disabled=!fit&&state.zoom>=ZOOM.max;
 }
 // Zooming used to snap the page to its left edge because the viewer switched
 // its alignment. Instead, hold whatever point is in the middle of the view
 // (or under the fingers) steady across the change.
 function zoom(percent,focus){
   const doc=$('#document'),cw=doc.clientWidth||1,ch=doc.clientHeight||1;
   const fx=focus?focus.x:(doc.scrollLeft+cw/2)/Math.max(doc.scrollWidth,1);
   const fy=focus?focus.y:(doc.scrollTop+ch/2)/Math.max(doc.scrollHeight,1);
   state.zoom=percent?Math.min(ZOOM.max,Math.max(ZOOM.min,Math.round(percent/ZOOM.step)*ZOOM.step)):0;
   keep(VIEW,state.zoom);applyZoom();
   requestAnimationFrame(()=>{
     doc.scrollLeft=Math.max(0,fx*doc.scrollWidth-cw/2);
     doc.scrollTop=Math.max(0,fy*doc.scrollHeight-ch/2);
   });
 }
 function step(delta){zoom((state.zoom||100)+delta);}
 // Questions sharing this one's topic AND grade, in the collection's order.
 // Grade is part of the identity: Grade 11 intermolecular forces must never
 // hand the reader a Grade 12 question.
 function peers(){
   const c=state.current;if(!c)return [];
   return state.questions.filter(q=>q.topic_primary===c.topic_primary&&q.grade===c.grade);
 }
 function topicNav(){
   const list=peers(),index=list.findIndex(q=>q.question_id===state.current?.question_id),c=state.current;
   $('#prevTopic').disabled=index<1;$('#nextTopic').disabled=index<0||index>=list.length-1;
   $('#topicPosition').textContent=list.length>1?`${index+1} of ${list.length} · ${topicLabel(c.grade,c.topic_primary)}`:`Only question in ${topicLabel(c.grade,c.topic_primary)}`;
 }
 function stepTopic(delta){
   const list=peers(),index=list.findIndex(q=>q.question_id===state.current?.question_id),next=list[index+delta];
   if(next)openQuestion(next.question_id,true);
 }
 function link(id){try{history.replaceState(null,'',id?'#q='+encodeURIComponent(id):location.pathname+location.search);}catch{}}
 function openQuestion(id,keepZoom){
   const found=state.questions.find(q=>q.question_id===id);if(!found)return;
   state.current=found;state.kind='question';state.image=0;
   // Fit shows the whole crop and always fits the screen; a reader who prefers
   // to fill the width keeps that choice between questions and visits.
   if(!keepZoom){const saved=recall(VIEW);zoom(typeof saved==='number'?saved:0);}
   const q=state.current;
   $('#readerMeta').textContent=`QUESTION ${q.number} · GRADE ${q.grade} · ${q.year} · ${q.institution} · ${q.marks??'—'} MARKS`;
   $('#readerTitle').textContent=topicLabel(q.grade,q.topic_primary);
   memoTabState();
   if(!$('#reader').open)$('#reader').showModal();
   link(q.question_id);topicNav();documentView();
 }
 function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,6000);}
 $('#results').onclick=e=>{const card=e.target.closest('[data-id]');if(card)openQuestion(card.dataset.id);};
 $('#filters').onsubmit=e=>e.preventDefault();
 $('#filters').onchange=e=>{if(e.target.id==='grade'){topics();syncTopicButton();}saveFilters();filter();};
 let searchTimer;$('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(filter,180);};
 $('#clear').onclick=()=>{$('#filters').reset();topics();syncTopicButton();keep(FILTERS,null);filter();};
 $('#activeFilters').onclick=e=>{
   const chip=e.target.closest('[data-drop]');if(!chip)return;
   const key=chip.dataset.drop;
   if(key==='topic'){$('#topic').value='';}
   else if(key==='grade'){$('#grade').value='';topics();}
   else $('#'+key).value='';
   syncTopicButton();saveFilters();filter();
 };
 $('#topicButton').onclick=openTopicPicker;
 $('#topicSearch').oninput=renderTopicList;
 $('#topicList').onclick=e=>{
   const row=e.target.closest('[data-code]');if(!row)return;
   applyTopic(row.dataset.grade===''?null:Number(row.dataset.grade),row.dataset.code);
   $('#topicPicker').close();
 };
 $('#previous').onclick=()=>{state.page--;render();window.scrollTo({top:0,behavior:'smooth'});};
 $('#next').onclick=()=>{state.page++;render();window.scrollTo({top:0,behavior:'smooth'});};
 $('[id=questionTab]').onclick=()=>{state.kind='question';state.image=0;documentView();};
 $('#memoTab').onclick=()=>{if(!hasMemo(state.current))return;state.kind='memo';state.image=0;documentView();};
 $('#prevImage').onclick=()=>{state.image--;documentView();};$('#nextImage').onclick=()=>{state.image++;documentView();};
 $('#fit').onclick=()=>zoom(0);$('#fitWidth').onclick=()=>zoom(100);
 $('#zoomIn').onclick=()=>step(ZOOM.step*2);$('#zoomOut').onclick=()=>step(-ZOOM.step*2);
 $('#zoomRange').oninput=e=>zoom(Number(e.target.value));
 $('#prevTopic').onclick=()=>stepTopic(-1);$('#nextTopic').onclick=()=>stepTopic(1);
 // Double-tap swaps between the whole page and a readable full-width view.
 $('#document').ondblclick=()=>zoom(state.zoom?0:100);
 // Ctrl/⌘ + wheel on a trackpad, and two-finger pinch on a phone, both zoom
 // around the point being touched rather than the top-left corner.
 $('#document').addEventListener('wheel',e=>{
   if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();
   const doc=$('#document'),box=doc.getBoundingClientRect();
   const focus={x:(doc.scrollLeft+e.clientX-box.left)/Math.max(doc.scrollWidth,1),y:(doc.scrollTop+e.clientY-box.top)/Math.max(doc.scrollHeight,1)};
   zoom((state.zoom||100)*(e.deltaY<0?1.12:0.89),focus);
 },{passive:false});
 let pinch=null;const spread=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
 $('#document').addEventListener('touchstart',e=>{if(e.touches.length===2)pinch={gap:spread(e.touches)||1,zoom:state.zoom||100};},{passive:true});
 $('#document').addEventListener('touchmove',e=>{
   if(!pinch||e.touches.length!==2)return;e.preventDefault();
   const doc=$('#document'),box=doc.getBoundingClientRect();
   const mx=(e.touches[0].clientX+e.touches[1].clientX)/2-box.left,my=(e.touches[0].clientY+e.touches[1].clientY)/2-box.top;
   zoom(pinch.zoom*(spread(e.touches)/pinch.gap),{x:(doc.scrollLeft+mx)/Math.max(doc.scrollWidth,1),y:(doc.scrollTop+my)/Math.max(doc.scrollHeight,1)});
 },{passive:false});
 $('#document').addEventListener('touchend',()=>{pinch=null;},{passive:true});
 $('#theme').onclick=()=>theme(document.documentElement.dataset.theme==='dark'?'light':'dark');
 document.addEventListener('keydown',e=>{
   if($('#topicPicker').open&&e.key==='Escape')return;
   if(!$('#reader').open||$('#reportDialog').open||e.ctrlKey||e.metaKey||e.altKey)return;
   if(e.key==='ArrowRight'){e.preventDefault();stepTopic(1);}
   else if(e.key==='ArrowLeft'){e.preventDefault();stepTopic(-1);}
   else if(e.key==='+'||e.key==='='){e.preventDefault();step(ZOOM.step*2);}
   else if(e.key==='-'||e.key==='_'){e.preventDefault();step(-ZOOM.step*2);}
   else if(e.key==='0'){e.preventDefault();zoom(0);}
   else if(e.key==='m'||e.key==='M'){e.preventDefault();if(hasMemo(state.current)){state.kind=state.kind==='memo'?'question':'memo';state.image=0;documentView();}}
 });
 $('#reader').addEventListener('close',()=>link(null));
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
 function openReport(kind){
   if(!state.current)return;
   state.reportId=crypto.randomUUID();$('#reportForm').reset();
   if(kind)$('#reportKind').value=kind;
   $('#reportStatus').textContent='';
   $('#reportQuestion').textContent=`Question ${state.current.number} · ${topicLabel(state.current.grade,state.current.topic_primary)} · ${state.current.year}`;
   $('#reportDialog').showModal();$('#reportDetails').focus();
 }
 document.querySelectorAll('[data-report-kind]').forEach(b=>b.onclick=()=>openReport(b.dataset.reportKind));
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
   state.questions=[];state.topics=[];state.filtered=[];forgetSigned();
   $('#reader').close();$('#reportDialog').close();$('#topicPicker').close();
   $('#collection').hidden=true;$('#gate').hidden=false;$('#signOut').hidden=true;$('#countBanner').hidden=true;
   $('#modeLabel').textContent='Signed out';$('#signInStatus').textContent=message||'';
   $('#password').value='';
 }
 async function load(){
   try{
     if(cloud){
       if(!config.url||!config.publishableKey||config.publishableKey.includes('YOUR_')||!config.url.startsWith('https://'))throw Error('Supabase is not configured yet. Add the public project settings to connect this site.');
       const revision=await published(),saved=revision?await readCatalogue():null;
       if(saved&&saved.revision===revision&&Array.isArray(saved.questions)&&Array.isArray(saved.topics)){
         state.questions=saved.questions;state.topics=saved.topics;
       }else{
         [state.questions,state.topics]=await Promise.all([rows('learner_questions'),rows('learner_topics')]);
         if(revision)writeCatalogue({revision,questions:state.questions,topics:state.topics});
       }
     }
     else{const data=await json(base+'/catalogue');state.questions=data.questions;state.topics=data.topics;state.reportToken=data.report_token;}
     state.questions.sort((a,b)=>b.year-a.year||a.question_id.localeCompare(b.question_id,undefined,{numeric:true}));
     $('#gate').hidden=true;$('#collection').hidden=false;$('#signOut').hidden=!cloud;
     options('#grade',[...new Set(state.questions.map(q=>q.grade))].sort((a,b)=>a-b),'All grades');options('#year',[...new Set(state.questions.map(q=>q.year))].sort((a,b)=>b-a),'All years');
     topics();restoreFilters();syncTopicButton();filter();$('#modeLabel').textContent=cloud?'Connected':'Local preview';
     const deep=/^#q=(.+)$/.exec(location.hash||'');
     if(deep)openQuestion(decodeURIComponent(deep[1]));
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
 $('#signOut').onclick=()=>{remember(null);dropCatalogue();signedOut('You have been signed out.');};
 theme(document.documentElement.dataset.theme==='light'?'light':'dark');
 restore();restoreSigned();
 if(cloud&&!session)signedOut();else load();
})();
