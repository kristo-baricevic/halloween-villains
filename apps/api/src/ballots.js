import {RequestError} from '@halloween/tournament';
export function rawBallots(state,names,votes,excluded){
 const rows=[];
 for(const [round,matches] of state.rounds.entries()){
  const ids=new Set(matches.map(m=>m.id));
  const people=new Map(names.filter(n=>n.round===round).map(n=>[n.voter,{voter:n.voter,round,name:n.name,submittedAt:n.submitted_at,picks:{},excluded:false}]));
  for(const v of votes.filter(v=>ids.has(v.match))){
   if(!people.has(v.voter))people.set(v.voter,{voter:v.voter,round,name:'',submittedAt:null,picks:{},excluded:false});
   const b=people.get(v.voter);b.picks[v.match]=v.choice;
   if(excluded.some(e=>e.voter===v.voter&&e.match===v.match))b.excluded=true;
  }
  rows.push(...people.values());
 }
 return rows.sort((a,b)=>a.round-b.round||a.name.localeCompare(b.name)||a.voter.localeCompare(b.voter));
}
export function validateExclusion(state,data){
 if(data.revision!==state.revision)throw new RequestError('The bracket changed. Refresh and try again.');
 if(state.status!=='open'||data.round!==state.round)throw new RequestError('Only ballots in the current open round can be changed. Review duplicates before ending the round.');
 if(typeof data.excluded!=='boolean'||typeof data.voter!=='string')throw new RequestError('Invalid ballot.');
 return state.rounds[state.round].map(m=>m.id);
}
