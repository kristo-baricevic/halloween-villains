import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const roster = JSON.parse(readFileSync(new URL('./roster.json', import.meta.url), 'utf8'));
export const roundNames = ['Wildcards', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];
// Each pair belongs to one nominator. Names are intentionally omitted.
export const nominationPairs = [['v1','v2'], ['v3','v4'], ['v5','v6'], ['v8','v9'], ['v11','v12'], ['v17','v18']];

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function fresh() {
  const wildcards = [], byes = [], paired = new Set(nominationPairs.flat());
  for (const pair of nominationPairs) {
    const [wildcard, bye] = shuffle(pair);
    wildcards.push(wildcard);
    byes.push(bye);
  }
  const remaining = shuffle(roster.map(v => v.id).filter(id => !paired.has(id)));
  const needed = 10 - wildcards.length;
  const field = shuffle([...wildcards, ...remaining.slice(0, needed)]);
  const seeds = [...shuffle([...byes, ...remaining.slice(needed)]), ...Array.from({length:5}, (_,i) => `@w${i}`)];
  const rounds = [Array.from({length:5}, (_,i) => ({id:`w${i}`, sources:field.slice(i*2,i*2+2)}))];
  const order = [1,16,8,9,5,12,4,13,6,11,3,14,7,10,2,15];
  rounds.push(Array.from({length:8}, (_,i) => ({id:`r1m${i}`,sources:[seeds[order[2*i]-1],seeds[order[2*i+1]-1]]})));
  for (let r=2;r<5;r++) rounds.push(Array.from({length:rounds[r-1].length/2}, (_,i) => ({id:`r${r}m${i}`,sources:[`@${rounds[r-1][2*i].id}`,`@${rounds[r-1][2*i+1].id}`]})));
  return {round:0,status:'setup',rounds,winners:{},revision:0};
}

export const participants = (state, match) => match.sources.map(s => s.startsWith('@') ? state.winners[s.slice(1)] ?? null : s);

export class RequestError extends Error {
  constructor(message, status=400) { super(message); this.status=status; }
}
const requireCondition = (condition,message) => { if(!condition) throw new RequestError(message); };

/** Pure host transition; caller supplies tallies and persists atomically. */
export function transition(previous, data, counts) {
  requireCondition(data.revision === previous.revision, 'The bracket changed. Refresh and try again.');
  let state = structuredClone(previous);
  const current = state.rounds[state.round];
  switch(data.action) {
    case 'shuffle':
      requireCondition(state.status==='setup','Shuffle is only available before voting starts.');
      state=fresh();
      break;
    case 'open':
      requireCondition(state.status==='setup','This round has already started.');
      state.status='open';
      break;
    case 'close':
      requireCondition(state.status==='open','Voting is not open.');
      state.status='closed';
      for(const match of current) {
        const [a,b]=participants(state,match), tally=counts[match.id]??{};
        if((tally[a]??0)!==(tally[b]??0)) state.winners[match.id]=(tally[a]??0)>(tally[b]??0)?a:b;
      }
      break;
    case 'resolve': {
      const match=current.find(m=>m.id===data.match);
      requireCondition(state.status==='closed' && match && !state.winners[match.id],'Only unresolved ties can be decided.');
      requireCondition(participants(state,match).includes(data.choice),'Invalid winner.');
      state.winners[match.id]=data.choice;
      break;
    }
    case 'reopen':
      requireCondition(state.status==='closed','Only the current closed round can be reopened.');
      for(const match of current) delete state.winners[match.id];
      state.status='open';
      break;
    case 'advance':
      requireCondition(state.status==='closed' && current.every(m=>state.winners[m.id]),'Close voting and resolve every tie first.');
      if(state.round===4) state.status='complete';
      else { state.round++; state.status='open'; }
      break;
    default: throw new RequestError('Unknown action.');
  }
  state.revision=previous.revision+1;
  return state;
}
