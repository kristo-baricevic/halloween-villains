const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names=['Wildcards','Sweet 16','Elite 8','Final Four','Championship'];
let state,busy=false;
function message(text){$('#adminMessage').textContent=text;}
async function request(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed.');return result;}
async function refresh(){const r=await fetch('/api/state');if(!r.ok)throw Error('Could not load results.');state=await r.json();render();}
function render(){
 $('#adminLogin').hidden=state.host;
 $('#adminDashboard').hidden=!state.host;
 if(!state.host){$('#adminDashboard').innerHTML='';return;}
 const matches=state.rounds[state.round],unresolved=matches.filter(m=>!state.winners[m.id]);
 const name=id=>state.roster.find(v=>v.id===id)?.name||'';
 const control=(action,label,disabled=false)=>`<button data-action="${action}" ${busy||disabled?'disabled':''}>${label}</button>`;
 $('#adminDashboard').innerHTML=`<div class="admin-heading"><h2>${names[state.round]} <span class="badge">${esc(state.status)}</span></h2><button id="adminLogout" ${busy?'disabled':''}>Log out</button></div><div class="admin-controls">${state.status==='setup'?control('open','Open voting'):state.status==='open'?control('close','End round & advance'):state.status==='closed'&&!unresolved.length?control('advance',state.round===4?'Crown the champion':'Advance & open '+names[state.round+1],unresolved.length>0):''}</div><p>${state.status==='open'?'Results update every three seconds. End the round to calculate winners and automatically open the next round. Ties pause advancement until resolved.':state.status==='closed'?(unresolved.length?'Choose a winner for each tied match. The bracket advances automatically after the last tie is resolved.':'All winners are decided. Advance when you are ready.') :state.status==='complete'?'The tournament is complete.':'Open voting when everyone is ready.'}</p><div class="admin-results">${matches.map((m,i)=>`<article class="admin-match"><h3>Match ${i+1}</h3>${m.participants.map(id=>`<div class="admin-result"><span>${esc(name(id))}${state.winners[m.id]===id?' — Winner':''}</span><strong>${m.counts?.[id]||0} votes</strong>${state.status==='closed'&&!state.winners[m.id]?`<button data-resolve="${m.id}" data-choice="${id}" ${busy?'disabled':''}>Choose winner</button>`:''}</div>`).join('')}</article>`).join('')}</div>`;
}
$('#adminLogin').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;const button=e.target.querySelector('button');button.disabled=true;try{await request('/api/login',{password:$('#adminPassword').value});$('#adminPassword').value='';message('');await refresh();}catch(e){message(e.message);}finally{busy=false;button.disabled=false;}});
$('#adminDashboard').addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b||busy)return;
 const action=b.dataset.action;
 if(action&&!confirm(action==='close'?'End this round? Winners will advance and the next round will open automatically, unless a tie needs resolving. The final round crowns the champion.':action==='advance'?'Advance the bracket? This round becomes final, and the next round opens immediately (or the champion is crowned).':'Open voting for everyone?'))return;
 if(b.dataset.resolve&&!confirm('Choose this contender as the winner? Resolving the last tie automatically advances the bracket.'))return;
 busy=true;render();
 try{if(b.id==='adminLogout'){await request('/api/logout',{});message('Logged out.');}else{await request('/api/action',{action:b.dataset.resolve?'resolve':action,match:b.dataset.resolve,choice:b.dataset.choice,revision:state.revision});message('Tournament updated.');}await refresh();}catch(e){message(e.message);await refresh().catch(()=>{});}finally{busy=false;if(state)render();}
});
refresh().catch(e=>message(e.message));setInterval(()=>{if(!busy&&!document.hidden)refresh().catch(e=>message(e.message));},3000);
