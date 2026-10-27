const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names=['Wildcards','Sweet 16','Elite 8','Final Four','Championship'];
let state,busy=false,showRaw=false,ballots=[],rawRound=null;
function message(text){$('#adminMessage').textContent=text;}
async function request(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed.');return result;}
async function refresh(){const r=await fetch('/api/state');if(!r.ok)throw Error('Could not load results.');state=await r.json();if(state.host&&showRaw){const raw=await fetch('/api/ballots');if(!raw.ok)throw Error('Could not load raw votes.');ballots=await raw.json();}if(!state.host){ballots=[];showRaw=false;}render();}
function rawTable(){
 const round=rawRound??state.round,rows=ballots.filter(b=>b.round===round);
 const normalize=n=>n.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
 const repeats=new Map();for(const b of rows)if(b.name)repeats.set(normalize(b.name),(repeats.get(normalize(b.name))||0)+1);
 return `<section class="raw-votes"><h2>Raw votes</h2><label for="rawRound">Round</label> <select id="rawRound">${names.map((n,i)=>`<option value="${i}" ${i===round?'selected':''}>${n}</option>`).join('')}</select><p>Review duplicates before ending the round. Excluding a ballot removes its votes from totals; you can restore it while that round is open. Previous rounds are read-only.</p><div class="raw-table-scroll"><table><caption>${rows.length} ballots — ${names[round]}</caption><thead><tr><th>Name</th><th>Submitted</th><th>Ballot ID</th><th>Picks</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(b=>`<tr><td>${esc(b.name||'Unnamed legacy ballot')}${repeats.get(normalize(b.name))>1?'<small>Repeated name</small>':''}</td><td>${b.submittedAt?esc(new Date(b.submittedAt).toLocaleString()):'Unknown'}</td><td><code>${esc(b.voter)}</code></td><td>${state.rounds[round].map((m,i)=>`<div>Match ${i+1}: ${esc(state.roster.find(v=>v.id===b.picks[m.id])?.name||'No pick')}</div>`).join('')}</td><td>${b.excluded?'Excluded':'Counted'}</td><td>${round===state.round&&state.status==='open'?`<button data-ballot="${esc(b.voter)}" data-excluded="${!b.excluded}" ${busy?'disabled':''}>${b.excluded?'Restore':'Exclude'}</button>`:'Final'}</td></tr>`).join('')||'<tr><td colspan="6">No ballots submitted for this round.</td></tr>'}</tbody></table></div></section>`;
}
function render(){
 $('#adminLogin').hidden=state.host;
 $('#adminDashboard').hidden=!state.host;
 if(!state.host){$('#adminDashboard').innerHTML='';return;}
 const matches=state.rounds[state.round],unresolved=matches.filter(m=>!state.winners[m.id]);
 const name=id=>state.roster.find(v=>v.id===id)?.name||'';
 const control=(action,label,disabled=false)=>`<button data-action="${action}" ${busy||disabled?'disabled':''}>${label}</button>`;
 $('#adminDashboard').innerHTML=`<div class="admin-heading"><h2>${names[state.round]} <span class="badge">${esc(state.status)}</span></h2><button id="adminLogout" ${busy?'disabled':''}>Log out</button></div><div class="admin-controls">${state.status==='setup'?control('open','Open voting'):state.status==='open'?control('close','End round & advance'):state.status==='closed'&&!unresolved.length?control('advance',state.round===4?'Crown the champion':'Advance & open '+names[state.round+1],unresolved.length>0):''}<button id="toggleRaw" aria-expanded="${showRaw}">${showRaw?'Hide raw votes':'View raw votes'}</button></div>${showRaw?rawTable():''}<p>${state.status==='open'?'Results update every three seconds. End the round to calculate winners and automatically open the next round. Ties pause advancement until resolved.':state.status==='closed'?(unresolved.length?'Choose a winner for each tied match. The bracket advances automatically after the last tie is resolved.':'All winners are decided. Advance when you are ready.') :state.status==='complete'?'The tournament is complete.':'Open voting when everyone is ready.'}</p><div class="admin-results">${matches.map((m,i)=>`<article class="admin-match"><h3>Match ${i+1}</h3>${m.participants.map(id=>`<div class="admin-result"><span>${esc(name(id))}${state.winners[m.id]===id?' — Winner':''}</span><strong>${m.counts?.[id]||0} votes</strong>${state.status==='closed'&&!state.winners[m.id]?`<button data-resolve="${m.id}" data-choice="${id}" ${busy?'disabled':''}>Choose winner</button>`:''}</div>`).join('')}</article>`).join('')}</div>`;
}
$('#adminLogin').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;const button=e.target.querySelector('button');button.disabled=true;try{await request('/api/login',{password:$('#adminPassword').value});$('#adminPassword').value='';message('');await refresh();}catch(e){message(e.message);}finally{busy=false;button.disabled=false;}});
$('#adminDashboard').addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b||busy)return;
 if(b.id==='toggleRaw'){showRaw=!showRaw;busy=true;try{await refresh();}catch(e){message(e.message);}finally{busy=false;render();}return;}
 if(b.dataset.ballot){
  if(!confirm(b.dataset.excluded==='true'?'Exclude this ballot from the round totals? It will remain visible here and can be restored.':'Restore this ballot to the round totals?'))return;
  busy=true;render();try{await request('/api/action',{action:'excludeBallot',voter:b.dataset.ballot,round:rawRound??state.round,excluded:b.dataset.excluded==='true',revision:state.revision});await refresh();message('Ballot totals updated.');}catch(e){message(e.message);await refresh().catch(()=>{});}finally{busy=false;render();}return;
 }
 const action=b.dataset.action;
 if(action&&!confirm(action==='close'?'End this round? Winners will advance and the next round will open automatically, unless a tie needs resolving. The final round crowns the champion.':action==='advance'?'Advance the bracket? This round becomes final, and the next round opens immediately (or the champion is crowned).':'Open voting for everyone?'))return;
 if(b.dataset.resolve&&!confirm('Choose this contender as the winner? Resolving the last tie automatically advances the bracket.'))return;
 busy=true;render();
 try{if(b.id==='adminLogout'){await request('/api/logout',{});message('Logged out.');}else{await request('/api/action',{action:b.dataset.resolve?'resolve':action,match:b.dataset.resolve,choice:b.dataset.choice,revision:state.revision});message('Tournament updated.');}await refresh();}catch(e){message(e.message);await refresh().catch(()=>{});}finally{busy=false;if(state)render();}
});
refresh().catch(e=>message(e.message));setInterval(()=>{if(!busy&&!document.hidden)refresh().catch(e=>message(e.message));},3000);

$('#adminDashboard').addEventListener('change',e=>{if(e.target.id==='rawRound'){rawRound=Number(e.target.value);render();}});
