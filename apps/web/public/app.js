const $=s=>document.querySelector(s);
const names=['Wildcards','Sweet 16','Elite 8','Final Four','Championship'];
const icons=['🎃','🍷','🧬','👖','🔪','🐙','🪆','🪲','🦋','🌲','🧵','🪴','🎈','🧤','🏒','🎩','🕰️','🪞','🐦‍⬛','🪆','✋'];
let state,view='vote',busy=false,toastTimer;
let key=localStorage.getItem('villain-host')||'';
if(location.pathname==='/host'&&location.hash.length>1){key=location.hash.slice(1);localStorage.setItem('villain-host',key);history.replaceState(null,'','/host');}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const villain=id=>state.roster.find(v=>v.id===id);
const icon=id=>icons[Number(id?.slice(1))-1]||'✦';
function notify(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',4500);}
async function refresh(force=false){
  try{const r=await fetch('/api/state',{headers:key?{Authorization:'Bearer '+key}:{}});if(!r.ok)throw Error();const next=await r.json();$('#connection').textContent='Connected • updates live';if(force||JSON.stringify(next)!==JSON.stringify(state)){state=next;render();}}
  catch{$('#connection').textContent='Connection lost • retrying';}
}
async function action(data){if(busy)return;busy=true;try{const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify({...data,revision:state.revision})});const result=await r.json();if(!r.ok)throw Error(result.error);await refresh(true);if(data.action==='vote')notify('Vote saved. You can change it until voting closes.');}catch(e){notify(e.message||'Could not save. Try again.');await refresh();}finally{busy=false;}}
function details(id){const v=villain(id);if(!v)return;$('#detailBody').innerHTML=`<span class="icon">${icon(id)}</span><h2>${esc(v.name)}</h2><p class="franchise">${esc(v.franchise)}</p><h3>The case for the crown</h3><p>${esc(v.pitch)}</p>`;$('#details').showModal();}
function hostPanel(){
 if(!state.host){return location.pathname==='/host'?`<section class="host-panel"><h2>Host access</h2><p>Open the private host link saved with the app, or enter your host key.</p><form id="login" class="host-login"><input type="password" id="hostKey" aria-label="Host key" required><button class="primary">Unlock host controls</button></form></section>`:'';}
 const all=state.rounds[state.round].every(m=>state.winners[m.id]);
 let controls='';
 if(state.status==='setup')controls='<button data-action="shuffle">Shuffle matchups</button><button class="primary" data-action="open">Open wildcard voting</button>';
 if(state.status==='open')controls='<button class="primary" data-action="close">Close this round</button>';
 if(state.status==='closed')controls=`<button data-action="reopen">Reopen voting</button><button class="primary" data-action="advance" ${all?'':'disabled'}>${state.round===4?'Crown the champion':'Open '+names[state.round+1]+' voting'}</button>`;
 return `<section class="host-panel"><h2>Host controls</h2><p>${state.status==='complete'?'The champion has been crowned.':state.status==='closed'&&!all?'Resolve tied matches below before opening the next round.':'You control when rounds open and close. Only you see vote totals while voting is open.'}</p><div class="host-actions">${controls}<button id="copyLink">Copy voter link</button></div></section>`;
}
function matchCard(m,i){const winner=state.winners[m.id],open=state.status==='open';return `<article class="match"><div class="match-head"><span>Match ${i+1}</span><span>${winner?'Winner decided':state.status==='closed'?'Tied • host decision needed':m.myVote?'Your vote is saved':open?'Choose your villain':'Voting opens soon'}</span></div><div class="pair">${m.participants.map(id=>{const v=villain(id);if(!v)return '';return `<section class="contender"><span class="icon" aria-hidden="true">${icon(id)}</span><h3>${esc(v.name)}</h3><div class="franchise">${esc(v.franchise)}</div><button class="pitch" data-details="${id}">Read their nomination</button>${m.counts?`<div class="count">${m.counts[id]||0} vote${m.counts[id]===1?'':'s'}</div>`:''}${winner?`<div class="result">${winner===id?'✦ Advances':'Eliminated'}</div>`:open?`<button class="pick ${m.myVote===id?'selected':''}" aria-pressed="${m.myVote===id}" data-vote="${m.id}" data-choice="${id}">${m.myVote===id?'✓ Your pick':'Vote for this villain'}</button>`:state.host&&state.status==='closed'?`<button class="pick" data-resolve="${m.id}" data-choice="${id}">Choose as winner</button>`:''}</section>`;}).join('')}</div></article>`;}
function bracket(){return `<div class="bracket">${state.rounds.map((rd,r)=>`<section class="round"><h3>${names[r]}</h3><div class="round-games">${rd.map(m=>`<div class="mini-match">${m.sources.map((src,i)=>{const id=m.participants[i],v=villain(id);let placeholder='Winner of '+(src[1]==='w'?'wildcard '+(Number(src.slice(2))+1):'previous match');return `<button ${id?`data-details="${id}"`:'disabled'} class="mini-player ${state.winners[m.id]===id&&id?'winner':''} ${id?'':'pending'}"><span>${esc(v?.name||placeholder)}</span><span>${m.counts&&id?m.counts[id]||0:''}${state.winners[m.id]===id&&id?' ✓':''}</span></button>`;}).join('')}</div>`).join('')}</div></section>`).join('')}</div>`;}
function render(){
 const rd=state.rounds[state.round];
 $('#host').innerHTML=hostPanel();
 $('#progress').textContent=state.status==='complete'?'Tournament complete':`${rd.filter(m=>m.myVote).length} of ${rd.length} picks saved this round`;
 $('#stage').innerHTML=state.status==='complete'?'<h2>We have a champion.</h2><p>The votes are in. The crown has found its villain.</p>':`<h2>${names[state.round]}<span class="badge">${{setup:'Not open yet',open:'Voting open',closed:'Voting closed'}[state.status]}</span></h2><p>${state.status==='setup'?'The host is preparing the matchups. Take a look at the contenders while you wait.':state.status==='open'?'Pick one villain in each matchup. Read the nominations before casting your votes.':'Results are in. The host will resolve any ties and start the next round.'}</p>`;
 let html='';
 if(state.status==='complete'){const id=state.winners[state.rounds[4][0].id];html=`<div class="champion"><span class="icon">${icon(id)}</span><p>Best Halloween villain, 2026</p><h3>${esc(villain(id).name)}</h3><button data-details="${id}">Read the winning nomination</button></div>`;}
 if(view==='bracket'||state.status==='complete'&&view==='vote')html+=bracket();
 else if(view==='roster')html+=`<div class="roster">${state.roster.map(v=>`<article class="bio"><span class="icon">${icon(v.id)}</span><h3>${esc(v.name)}</h3><p class="franchise">${esc(v.franchise)}</p><p>${esc(v.pitch)}</p></article>`).join('')}</div>`;
 else{html+=`<div class="matches">${rd.map(matchCard).join('')}</div>`;if(state.round===0){const wild=new Set(rd.flatMap(m=>m.participants));html+=`<section class="byes"><h3>Already in the Sweet 16</h3><p>One contender from each two-nomination pair gets a bye. The remaining byes are drawn at random.</p><div class="chips">${state.roster.filter(v=>!wild.has(v.id)).map(v=>`<button class="chip" data-details="${v.id}">${icon(v.id)} ${esc(v.name)}</button>`).join('')}</div>`;}}
 $('#content').innerHTML=html;
 requestAnimationFrame(drawConnections);
 for(const mode of ['vote','bracket','roster'])$('#'+mode+'Tab').classList.toggle('active',view===mode);
 if($('#login'))$('#login').onsubmit=e=>{e.preventDefault();key=$('#hostKey').value.trim();localStorage.setItem('villain-host',key);refresh(true);};
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
  path.setAttribute('d',`M ${x1} ${y1} H ${(x1+x2)/2} V ${y2} H ${x2}`);path.setAttribute('fill','none');path.setAttribute('stroke','#a99aa9');path.setAttribute('stroke-width','1');svg.append(path);
 });board.prepend(svg);
}
window.addEventListener('resize',()=>requestAnimationFrame(drawConnections));
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.details)details(b.dataset.details);if(b.dataset.vote)action({action:'vote',match:b.dataset.vote,choice:b.dataset.choice});if(b.dataset.resolve&&confirm('Advance '+villain(b.dataset.choice).name+' to resolve this tie?'))action({action:'resolve',match:b.dataset.resolve,choice:b.dataset.choice});if(b.dataset.action){const a=b.dataset.action;const prompts={close:'Close voting for everyone and calculate the winners?',shuffle:'Redraw matchups? Each two-nomination pair will keep one wildcard spot and one bye.',reopen:'Reopen this round? Votes are preserved, but its winner decisions will be cleared.',advance:'Advance the winners? You cannot edit this round afterward.'};if(!prompts[a]||confirm(prompts[a]))action({action:a});}if(b.id==='copyLink'){const url=location.origin+'/';try{await navigator.clipboard.writeText(url);notify('Voter link copied.');}catch{prompt('Copy this voter link:',url);}}});
for(const mode of ['vote','bracket','roster'])$('#'+mode+'Tab').onclick=()=>{view=mode;render();};
$('#closeDetails').onclick=()=>$('#details').close();
$('#details').onclick=e=>{if(e.target===$('#details'))$('#details').close();};
refresh();setInterval(()=>{if(!busy&&!document.hidden)refresh();},3000);
