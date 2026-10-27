const $=s=>document.querySelector(s);
const names=['Wildcards','Sweet 16','Elite 8','Final Four','Championship'];
let imageManifest={};
let state,view='vote',busy=false,toastTimer;
let draft={},draftRevision=null,voterName='',nameEdited=false;
let key=localStorage.getItem('villain-host')||'';
if(location.pathname==='/host'&&location.hash.length>1){key=location.hash.slice(1);localStorage.setItem('villain-host',key);history.replaceState(null,'','/host');}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const villain=id=>state.roster.find(v=>v.id===id);
const icon=id=>{const img=imageManifest[id];return img?`<img class="portrait" src="${esc(img.path)}" alt="${esc(img.alt)}" loading="lazy" decoding="async" width="480" height="360">`:'';};
function notify(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',4500);}
async function refresh(force=false){
  try{const r=await fetch('/api/state',{headers:key?{Authorization:'Bearer '+key}:{}});if(!r.ok)throw Error();const next=await r.json();if(!force && document.activeElement?.id==='voterName')return;if(draftRevision!==next.revision){draft=Object.fromEntries(next.rounds[next.round].filter(m=>m.myVote).map(m=>[m.id,m.myVote]));draftRevision=next.revision;}if(!nameEdited)voterName=next.myName||'';if(force||JSON.stringify(next)!==JSON.stringify(state)){state=next;render();}}
  catch{/* Retry on the next refresh. */}
}
async function action(data){if(busy)return;busy=true;render();try{const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify({...data,revision:state.revision})});const result=await r.json();if(!r.ok)throw Error(result.error);await refresh(true);if(data.action==='submit')notify('Ballot submitted. You can change your picks and submit again until voting closes.');}catch(e){notify(e.message||'Could not save. Try again.');await refresh();}finally{busy=false;if(state)render();}}
function details(id){const v=villain(id);if(!v)return;$('#detailBody').innerHTML=`<span class="icon">${icon(id)}</span><h2>${esc(v.name)}</h2><p class="franchise">${esc(v.franchise)}</p><h3>The case for the crown</h3><p>${esc(v.pitch)}</p>`;$('#details').showModal();}
function matchCard(m,i){const winner=state.winners[m.id],open=state.status==='open';return `<article class="match"><div class="match-head"><span>Match ${i+1}</span><span>${winner?'Winner decided':state.status==='closed'?'Tied • host decision needed':draft[m.id]?(draft[m.id]===m.myVote?'Submitted pick':'Selected • not submitted'):open?'Choose your villain':'Voting opens soon'}</span></div><div class="pair">${m.participants.map(id=>{const v=villain(id);if(!v)return '';return `<section class="contender"><span class="icon">${icon(id)}</span><h3>${esc(v.name)}</h3><div class="franchise">${esc(v.franchise)}</div><button class="pitch" data-details="${id}">Read their nomination</button>${m.counts?`<div class="count">${m.counts[id]||0} vote${m.counts[id]===1?'':'s'}</div>`:''}${winner?`<div class="result">${winner===id?'✦ Advances':'Eliminated'}</div>`:open?`<button class="pick ${draft[m.id]===id?'selected':''}" aria-pressed="${draft[m.id]===id}" data-vote="${m.id}" data-choice="${id}">${draft[m.id]===id?'✓ Your pick':'Choose this villain'}</button>`:state.host&&state.status==='closed'?`<button class="pick" data-resolve="${m.id}" data-choice="${id}">Choose as winner</button>`:''}</section>`;}).join('')}</div></article>`;}
function bracket(){return `<div class="bracket">${state.rounds.map((rd,r)=>`<section class="round"><h3>${names[r]}</h3><div class="round-games">${rd.map(m=>`<div class="mini-match">${m.sources.map((src,i)=>{const id=m.participants[i],v=villain(id);let placeholder='Winner of '+(src[1]==='w'?'wildcard '+(Number(src.slice(2))+1):'previous match');return `<button ${id?`data-details="${id}"`:'disabled'} class="mini-player ${state.winners[m.id]===id&&id?'winner':''} ${id?'':'pending'}"><span>${esc(v?.name||placeholder)}</span><span>${m.counts&&id?m.counts[id]||0:''}${state.winners[m.id]===id&&id?' ✓':''}</span></button>`;}).join('')}</div>`).join('')}</div></section>`).join('')}</div>`;}
function render(){
 const rd=state.rounds[state.round];
 $('#stage').innerHTML=state.status==='complete'?'<h2>We have a champion.</h2><p>The votes are in. The crown has found its villain.</p>':`<h2>${names[state.round]}<span class="badge">${{setup:'Not open yet',open:'Voting open',closed:'Voting closed'}[state.status]}</span></h2><p>${state.status==='setup'?'The host is preparing the matchups. Take a look at the contenders while you wait.':state.status==='open'?'Choose one villain in each matchup, enter your name, then submit your ballot.':'Results are in. The host will resolve any ties and start the next round.'}</p>`;
 let html='';
 if(state.status==='complete'){const id=state.winners[state.rounds[4][0].id];html=`<div class="champion"><span class="icon">${icon(id)}</span><p>Best Halloween villain, 2026</p><h3>${esc(villain(id).name)}</h3><button data-details="${id}">Read the winning nomination</button></div>`;}
 if(view==='bracket'||state.status==='complete'&&view==='vote')html+=bracket();
 else if(view==='roster')html+=`<div class="roster">${state.roster.map(v=>`<article class="bio"><span class="icon">${icon(v.id)}</span><h3>${esc(v.name)}</h3><p class="franchise">${esc(v.franchise)}</p><p>${esc(v.pitch)}</p></article>`).join('')}</div>`;
 else{html+=`<div class="matches">${rd.map(matchCard).join('')}</div>`;if(state.round===0){const wild=new Set(rd.flatMap(m=>m.participants));html+=`<section class="byes"><h3>Already in the Sweet 16</h3><p>One contender from each two-nomination pair gets a bye. The remaining byes are drawn at random.</p><div class="chips">${state.roster.filter(v=>!wild.has(v.id)).map(v=>`<button class="chip" data-details="${v.id}">${icon(v.id)} ${esc(v.name)}</button>`).join('')}</div>`;}}
 if(view==='vote' && state.status==='open')html+=`<form id="ballotForm" class="ballot-form"><label for="voterName">Your name</label><input id="voterName" name="name" autocomplete="name" maxlength="100" required value="${esc(voterName)}" placeholder="Enter your name"><p>Your name is saved with your ballot so duplicate submissions can be reviewed. Picks count only after you submit.</p><button type="submit" ${busy?'disabled':''}>${busy?'Submitting…':'Submit ballot'}</button></form>`;
 $('#content').innerHTML=html;
 requestAnimationFrame(drawConnections);
 for(const mode of ['vote','bracket','roster'])$('#'+mode+'Tab').classList.toggle('active',view===mode);
}
function drawConnections(){
 const board=$('.bracket');if(!board)return;
 board.querySelector('svg')?.remove();
 const rect=board.getBoundingClientRect(), nodes=new Map();
 board.querySelectorAll('.round').forEach((col,r)=>col.querySelectorAll('.mini-match').forEach((el,i)=>nodes.set(state.rounds[r][i].id,el)));
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('width',board.scrollWidth);svg.setAttribute('height',board.scrollHeight);svg.setAttribute('aria-hidden','true');
 for(const rd of state.rounds)for(const m of rd)m.sources.forEach((source,i)=>{
  if(!source.startsWith('@'))return;
  const from=nodes.get(source.slice(1)).getBoundingClientRect(),to=nodes.get(m.id).children[i].getBoundingClientRect();
  const x1=from.right-rect.left+board.scrollLeft,y1=from.top+from.height/2-rect.top;
  const x2=to.left-rect.left+board.scrollLeft,y2=to.top+to.height/2-rect.top;
  const path=document.createElementNS(svg.namespaceURI,'path');
  path.setAttribute('d',`M ${x1} ${y1} H ${(x1+x2)/2} V ${y2} H ${x2}`);path.setAttribute('fill','none');path.setAttribute('stroke','#783913');path.setAttribute('stroke-width','1');svg.append(path);
 });board.prepend(svg);
}
window.addEventListener('resize',()=>requestAnimationFrame(drawConnections));
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.details)details(b.dataset.details);if(b.dataset.vote&&!busy){draft[b.dataset.vote]=b.dataset.choice;render();}if(b.dataset.resolve&&confirm('Advance '+villain(b.dataset.choice).name+' to resolve this tie?'))action({action:'resolve',match:b.dataset.resolve,choice:b.dataset.choice});if(b.dataset.action){const a=b.dataset.action;const prompts={close:'Close voting for everyone and calculate the winners?',shuffle:'Redraw matchups? Each two-nomination pair will keep one wildcard spot and one bye.',reopen:'Reopen this round? Votes are preserved, but its winner decisions will be cleared.',advance:'Advance the winners? You cannot edit this round afterward.'};if(!prompts[a]||confirm(prompts[a]))action({action:a});}if(b.id==='copyLink'){const url=location.origin+'/';try{await navigator.clipboard.writeText(url);notify('Voter link copied.');}catch{prompt('Copy this voter link:',url);}}});
for(const mode of ['vote','bracket','roster'])$('#'+mode+'Tab').onclick=()=>{view=mode;render();};
$('#closeDetails').onclick=()=>$('#details').close();
$('#details').onclick=e=>{if(e.target===$('#details'))$('#details').close();};
fetch('/villain-images.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{imageManifest=data.images;return refresh();}).catch(()=>{notify('Images could not load. Refresh to try again.');refresh();});setInterval(()=>{if(!busy&&!document.hidden)refresh();},3000);

document.addEventListener('input',e=>{if(e.target.id==='voterName'){voterName=e.target.value;nameEdited=true;}});
document.addEventListener('submit',e=>{
 if(e.target.id!=='ballotForm')return;
 e.preventDefault();
 if(!voterName.trim()){notify('Enter your name before submitting.');$('#voterName').focus();return;}
 if(state.rounds[state.round].some(m=>!draft[m.id])){notify('Choose one villain in every matchup before submitting.');return;}
 action({action:'submit',name:voterName,picks:{...draft}});
});
