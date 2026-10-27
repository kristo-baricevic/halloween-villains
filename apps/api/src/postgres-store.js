import {rawBallots,validateExclusion} from './ballots.js';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { participants, roster, transition, RequestError, validateBallot } from '@halloween/tournament';

const initialState=JSON.parse(readFileSync(new URL('./initial-state.json',import.meta.url),'utf8'));

export class PostgresTournament {
  constructor({connectionString,key}) {
    if(!connectionString || !key || key.length<32) throw new Error('DATABASE_URL and a HOST_KEY of at least 32 characters are required');
    this.key=key;
    this.pool=new pg.Pool({connectionString,max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,allowExitOnIdle:true});
    this.pool.on('error',()=>console.error('Database connection interrupted'));
    this.ready=null;
  }
  async initialize() {
    if(!this.ready) this.ready=this.transaction(async client=>{
      // Serialize first-time setup across simultaneous serverless instances.
      await client.query('SELECT pg_advisory_xact_lock(2131162026)');
      await client.query('CREATE TABLE IF NOT EXISTS halloween_state (id INTEGER PRIMARY KEY, body JSONB NOT NULL)');
      await client.query('CREATE TABLE IF NOT EXISTS halloween_votes (voter TEXT, match TEXT, choice TEXT NOT NULL, PRIMARY KEY(voter,match))');
      await client.query('CREATE TABLE IF NOT EXISTS halloween_ballot_names (voter TEXT, round INTEGER, name TEXT NOT NULL, normalized_name TEXT NOT NULL, submitted_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(voter,round))');
      await client.query('CREATE TABLE IF NOT EXISTS halloween_excluded_votes (voter TEXT, match TEXT, PRIMARY KEY(voter,match))');
      await client.query('INSERT INTO halloween_state VALUES (1,$1) ON CONFLICT DO NOTHING',[JSON.stringify(initialState)]);
    }).catch(error=>{this.ready=null;throw error;});
    await this.ready;
  }
  async close() { await this.pool.end(); }
  async transaction(fn,readOnly=false) {
    const client=await this.pool.connect();
    try {
      await client.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
      const result=await fn(client);
      await client.query('COMMIT');
      return result;
    } catch(error) { await client.query('ROLLBACK');throw error; }
    finally { client.release(); }
  }
  async tallies(client) {
    const counts={};
    const {rows}=await client.query('SELECT match,choice,COUNT(*)::integer AS total FROM halloween_votes v WHERE NOT EXISTS (SELECT 1 FROM halloween_excluded_votes e WHERE e.voter=v.voter AND e.match=v.match) GROUP BY match,choice');
    for(const row of rows) (counts[row.match]??={})[row.choice]=row.total;
    return counts;
  }
  async view(voter,host) {
    await this.initialize();
    return this.transaction(async client=>{
      const state=(await client.query('SELECT body FROM halloween_state WHERE id=1')).rows[0].body;
      const counts=await this.tallies(client);
      const mine=Object.fromEntries((await client.query('SELECT match,choice FROM halloween_votes WHERE voter=$1',[voter])).rows.map(r=>[r.match,r.choice]));
      state.rounds.forEach((round,ri)=>round.forEach(match=>{
        match.participants=participants(state,match);
        match.counts=host || ri<state.round || (ri===state.round && ['closed','complete'].includes(state.status)) ? counts[match.id]??{} : null;
        match.myVote=mine[match.id]??null;
      }));
      const myName=(await client.query('SELECT name FROM halloween_ballot_names WHERE voter=$1 AND round=$2',[voter,state.round])).rows[0]?.name??'';
      return {...state,roster,host,myName};
    },true);
  }
  async rawBallots() {
    await this.initialize();
    return this.transaction(async client=>rawBallots((await client.query('SELECT body FROM halloween_state WHERE id=1')).rows[0].body,(await client.query('SELECT * FROM halloween_ballot_names')).rows,(await client.query('SELECT * FROM halloween_votes')).rows,(await client.query('SELECT * FROM halloween_excluded_votes')).rows),true);
  }
  async action(data,voter,host) {
    await this.initialize();
    return this.transaction(async client=>{
      // Every vote and host action locks the same row, so closing a round
      // cannot race an accepted ballot or calculate incomplete totals.
      let state=(await client.query('SELECT body FROM halloween_state WHERE id=1 FOR UPDATE')).rows[0].body;
      if(data.action==='submit') {
        const ballot=validateBallot(state,data);
        if((await client.query('SELECT 1 FROM halloween_ballot_names WHERE voter=$1 AND round=$2',[voter,state.round])).rowCount) throw new RequestError('Your ballot for this round has already been submitted.',409);
        for(const [match,choice] of Object.entries(ballot.picks)) await client.query('INSERT INTO halloween_votes VALUES ($1,$2,$3) ON CONFLICT(voter,match) DO UPDATE SET choice=excluded.choice',[voter,match,choice]);
        await client.query('INSERT INTO halloween_ballot_names VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT(voter,round) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,submitted_at=excluded.submitted_at',[voter,state.round,ballot.name,ballot.normalizedName]);
      } else {
        if(!host) throw new RequestError('Host access required.',403);
        if(data.action==='excludeBallot') {
          const matches=validateExclusion(state,data);
          const votes=(await client.query('SELECT match FROM halloween_votes WHERE voter=$1',[data.voter])).rows;
          if(!votes.some(v=>matches.includes(v.match)))throw new RequestError('Ballot not found.',404);
          for(const match of matches){
            if(data.excluded)await client.query('INSERT INTO halloween_excluded_votes VALUES ($1,$2) ON CONFLICT DO NOTHING',[data.voter,match]);
            else await client.query('DELETE FROM halloween_excluded_votes WHERE voter=$1 AND match=$2',[data.voter,match]);
          }
          state.revision++;
        } else state=transition(state,data,await this.tallies(client));
        if(data.action==='shuffle') {await client.query('DELETE FROM halloween_votes');await client.query('DELETE FROM halloween_ballot_names');await client.query('DELETE FROM halloween_excluded_votes');}
        await client.query('UPDATE halloween_state SET body=$1 WHERE id=1',[JSON.stringify(state)]);
      }
    });
  }
}
