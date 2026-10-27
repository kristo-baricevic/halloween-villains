import {rawBallots,validateExclusion} from './ballots.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fresh, participants, roster, transition, RequestError, validateBallot } from '@halloween/tournament';

export class Tournament {
  constructor(directory) {
    mkdirSync(directory,{recursive:true,mode:0o700});
    const keyPath=join(directory,'host.key');
    try { writeFileSync(keyPath,randomBytes(32).toString('base64url'),{flag:'wx',mode:0o600}); }
    catch(error) { if(error.code!=='EEXIST') throw error; }
    this.key=readFileSync(keyPath,'utf8').trim();
    this.db=new DatabaseSync(join(directory,'tournament.sqlite3'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, body TEXT); CREATE TABLE IF NOT EXISTS votes (voter TEXT, match TEXT, choice TEXT, PRIMARY KEY(voter,match));');
    this.db.exec('CREATE TABLE IF NOT EXISTS ballot_names (voter TEXT, round INTEGER, name TEXT NOT NULL, normalized_name TEXT NOT NULL, submitted_at TEXT NOT NULL, PRIMARY KEY(voter,round))');
    this.db.exec('CREATE TABLE IF NOT EXISTS excluded_votes (voter TEXT, match TEXT, PRIMARY KEY(voter,match))');
    this.db.prepare('INSERT OR IGNORE INTO state VALUES (1,?)').run(JSON.stringify(fresh()));
  }
  close() { this.db.close(); }
  readState() { return JSON.parse(this.db.prepare('SELECT body FROM state WHERE id=1').get().body); }
  tallies() {
    const counts={};
    for(const row of this.db.prepare('SELECT match,choice,COUNT(*) AS total FROM votes v WHERE NOT EXISTS (SELECT 1 FROM excluded_votes e WHERE e.voter=v.voter AND e.match=v.match) GROUP BY match,choice').all()) {
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
      return {...state,roster,host,myName:this.db.prepare('SELECT name FROM ballot_names WHERE voter=? AND round=?').get(voter,state.round)?.name??''};
    });
  }
  rawBallots() {
    return this.transaction(()=>rawBallots(this.readState(),this.db.prepare('SELECT * FROM ballot_names').all(),this.db.prepare('SELECT * FROM votes').all(),this.db.prepare('SELECT * FROM excluded_votes').all()));
  }
  action(data,voter,host) {
    this.transaction(()=>{
      let state=this.readState();
      if(data.action==='submit') {
        const ballot=validateBallot(state,data);
        if(this.db.prepare('SELECT 1 FROM ballot_names WHERE voter=? AND round=?').get(voter,state.round)) throw new RequestError('Your ballot for this round has already been submitted.',409);
        for(const [match,choice] of Object.entries(ballot.picks)) this.db.prepare('INSERT INTO votes VALUES (?,?,?) ON CONFLICT(voter,match) DO UPDATE SET choice=excluded.choice').run(voter,match,choice);
        this.db.prepare('INSERT INTO ballot_names VALUES (?,?,?,?,?) ON CONFLICT(voter,round) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,submitted_at=excluded.submitted_at').run(voter,state.round,ballot.name,ballot.normalizedName,new Date().toISOString());
      } else {
        if(!host) throw new RequestError('Host access required.',403);
        if(data.action==='excludeBallot') {
          const matches=validateExclusion(state,data);
          const votes=this.db.prepare('SELECT match FROM votes WHERE voter=?').all(data.voter);
          if(!votes.some(v=>matches.includes(v.match))) throw new RequestError('Ballot not found.',404);
          for(const match of matches) {
            if(data.excluded)this.db.prepare('INSERT OR IGNORE INTO excluded_votes VALUES (?,?)').run(data.voter,match);
            else this.db.prepare('DELETE FROM excluded_votes WHERE voter=? AND match=?').run(data.voter,match);
          }
          state.revision++;
        } else state=transition(state,data,this.tallies());
        if(data.action==='shuffle') this.db.exec('DELETE FROM votes; DELETE FROM ballot_names; DELETE FROM excluded_votes');
      }
      this.db.prepare('UPDATE state SET body=? WHERE id=1').run(JSON.stringify(state));
    },true);
  }
}
