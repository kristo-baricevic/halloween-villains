import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fresh, participants, roster, transition, RequestError } from '@halloween/tournament';

export class Tournament {
  constructor(directory) {
    mkdirSync(directory,{recursive:true,mode:0o700});
    const keyPath=join(directory,'host.key');
    try { writeFileSync(keyPath,randomBytes(32).toString('base64url'),{flag:'wx',mode:0o600}); }
    catch(error) { if(error.code!=='EEXIST') throw error; }
    this.key=readFileSync(keyPath,'utf8').trim();
    this.db=new DatabaseSync(join(directory,'tournament.sqlite3'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, body TEXT); CREATE TABLE IF NOT EXISTS votes (voter TEXT, match TEXT, choice TEXT, PRIMARY KEY(voter,match));');
    this.db.prepare('INSERT OR IGNORE INTO state VALUES (1,?)').run(JSON.stringify(fresh()));
  }
  close() { this.db.close(); }
  readState() { return JSON.parse(this.db.prepare('SELECT body FROM state WHERE id=1').get().body); }
  tallies() {
    const counts={};
    for(const row of this.db.prepare('SELECT match,choice,COUNT(*) AS total FROM votes GROUP BY match,choice').all()) {
      (counts[row.match]??={})[row.choice]=row.total;
    }
    return counts;
  }
  transaction(fn, write=false) {
    this.db.exec(write?'BEGIN IMMEDIATE':'BEGIN');
    try { const result=fn();this.db.exec('COMMIT');return result; }
    catch(error) { this.db.exec('ROLLBACK');throw error; }
  }
  view(voter,host) {
    return this.transaction(()=>{
      const state=this.readState(),counts=this.tallies();
      const mine=Object.fromEntries(this.db.prepare('SELECT match,choice FROM votes WHERE voter=?').all(voter).map(r=>[r.match,r.choice]));
      state.rounds.forEach((round,ri)=>round.forEach(match=>{
        match.participants=participants(state,match);
        match.counts=host || ri<state.round || (ri===state.round && ['closed','complete'].includes(state.status)) ? counts[match.id]??{} : null;
        match.myVote=mine[match.id]??null;
      }));
      return {...state,roster,host};
    });
  }
  action(data,voter,host) {
    this.transaction(()=>{
      let state=this.readState();
      if(data.action==='vote') {
        const match=state.rounds[state.round].find(m=>m.id===data.match);
        if(state.status!=='open'||!match) throw new RequestError('Voting is not open for this matchup.');
        if(!participants(state,match).includes(data.choice)) throw new RequestError('Choose a contestant in this matchup.');
        this.db.prepare('INSERT INTO votes VALUES (?,?,?) ON CONFLICT(voter,match) DO UPDATE SET choice=excluded.choice').run(voter,match.id,data.choice);
      } else {
        if(!host) throw new RequestError('Host access required.',403);
        state=transition(state,data,this.tallies());
        if(data.action==='shuffle') this.db.exec('DELETE FROM votes');
      }
      this.db.prepare('UPDATE state SET body=? WHERE id=1').run(JSON.stringify(state));
    },true);
  }
}
