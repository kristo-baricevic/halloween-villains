import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createHmac,createHash} from 'node:crypto';
import {fresh,roster} from '@halloween/tournament';
import {Tournament} from '../src/store.js';
import {createApplication} from '../src/app.js';
import {PostgresTournament} from '../src/postgres-store.js';

test('Vercel pre-parsed JSON bodies retain validation and await storage',async(t)=>{
  const seen=[];
  const {handler}=createApplication({secureCookies:true,tournament:{
    key:'test-only-host-key-at-least-32-characters',
    async action(data) {await new Promise(r=>setTimeout(r,10));seen.push(data);},
  }});
  const server=createServer(async(req,res)=>{
    const parts=[];for await(const part of req) parts.push(part);
    req.body=JSON.parse(Buffer.concat(parts).toString());
    await handler(req,res);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(r=>server.close(r)));
  const post=data=>fetch(`http://127.0.0.1:${server.address().port}/api/action`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const data={action:'vote',match:'w0',choice:'v1'};
  const response=await post(data);
  assert.equal(response.status,200);assert.deepEqual(seen,[data]);
  assert.match(response.headers.get('set-cookie'),/; Secure/);
  assert.equal((await post(null)).status,400);
  assert.equal((await post({padding:'x'.repeat(4097)})).status,413);
  assert.equal(seen.length,1);
});

for(const backend of ['sqlite',...(process.env.TEST_DATABASE_URL?['postgres']:[])]) test(`${backend}: HTTP voting, privacy, auth, concurrent ballots, and persistence`,async(t)=>{
  const dataDir=mkdtempSync(join(tmpdir(),'villain-api-'));
  const pgStore=backend==='postgres'?new PostgresTournament({connectionString:process.env.TEST_DATABASE_URL,key:'test-only-host-key-at-least-32-characters'}):undefined;
  if(pgStore) {
    await pgStore.initialize();
    await pgStore.pool.query('TRUNCATE halloween_votes, halloween_ballot_names');
    await pgStore.pool.query('UPDATE halloween_state SET body=$1 WHERE id=1',[JSON.stringify(fresh())]);
  }
  const {server,tournament}=createApplication({dataDir,...(pgStore?{tournament:pgStore}:{})});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await tournament.close();rmSync(dataDir,{recursive:true,force:true});});
  assert.equal((await fetch(base+'/admin')).status,200);
  const login=async(password)=>fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  assert.equal((await login('wrong')).status,401);
  const loggedIn=await login(tournament.key);
  assert.equal(loggedIn.status,200);
  const session=loggedIn.headers.getSetCookie().find(c=>c.startsWith('admin='));
  assert.match(session,/HttpOnly; SameSite=Strict/);
  const adminCookie=session.split(';')[0];
  const hostHeaders={Cookie:adminCookie};
  assert.equal((await (await fetch(base+'/api/state',{headers:hostHeaders})).json()).host,true);
  for(const cookie of [adminCookie+'tampered','admin=1.invalid']) assert.equal((await (await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json()).host,false);
  const logout=await fetch(base+'/api/logout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:adminCookie},body:'{}'});
  assert.match(logout.headers.getSetCookie().find(c=>c.startsWith('admin=')),/Max-Age=0/);

  const get=async(headers={})=>{const r=await fetch(base+'/api/state',{headers});return {response:r,state:await r.json()};};
  const post=async(data,headers={})=>{
    if(data.action==='vote')data={action:'submit',name:'Test Voter',revision:initial.state.revision+1,picks:{...Object.fromEntries(initial.state.rounds[0].map(m=>[m.id,m.participants[0]])),[data.match]:data.choice}};
    const r=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
    return {status:r.status,body:await r.json()};
  };
  let initial=await get();const m=initial.state.rounds[0][0], [a,b]=m.participants;
  const manifest=await (await fetch(base+'/villain-images.json')).json();
  assert.deepEqual(Object.keys(manifest.images).sort(),roster.map(v=>v.id).sort());
  for(const image of Object.values(manifest.images)) {
    assert.match(image.sourcePage,/^https:\/\//);
    const asset=await fetch(base+image.path);
    assert.equal(asset.status,200);
    assert.equal(asset.headers.get('content-type'),image.mimeType);
    const bytes=Buffer.from(await asset.arrayBuffer());
    assert.equal(bytes.length,image.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),image.sha256);
  }
  const cookie=initial.response.headers.get('set-cookie').split(';')[0];
  assert.ok(initial.response.headers.get('set-cookie').includes('HttpOnly'));
  assert.equal((await post({action:'open',revision:initial.state.revision})).status,403);
  assert.equal((await post({action:'open',revision:initial.state.revision},hostHeaders)).status,200);
  assert.equal((await post({action:'close',revision:initial.state.revision},hostHeaders)).status,400);
  assert.equal((await post({action:'vote',match:m.id,choice:a},{Cookie:cookie})).status,200);
  assert.equal((await post({action:'vote',match:m.id,choice:b},{Cookie:cookie})).status,409);
  const picks=Object.fromEntries(initial.state.rounds[0].map(m=>[m.id,m.participants[0]]));
  assert.equal((await post({action:'submit',revision:initial.state.revision+1,name:'Different Name',picks},{Cookie:cookie})).status,409);
  for(const name of ['', '   ',null,'x'.repeat(101)]) assert.equal((await post({action:'submit',revision:initial.state.revision+1,name,picks},{Cookie:cookie})).status,400);
  assert.equal((await post({action:'submit',revision:initial.state.revision+1,name:'Test',picks:{[m.id]:a}},{Cookie:cookie})).status,400);
  assert.equal((await post({action:'submit',revision:initial.state.revision,name:'Test',picks},{Cookie:cookie})).status,400);
  const publicState=(await get({Cookie:cookie})).state;
  assert.equal(publicState.myName,'Test Voter');
  assert.equal((await get()).state.myName,'');
  assert.equal(publicState.rounds[0][0].myVote,a);assert.equal(publicState.rounds[0][0].counts,null);
  assert.deepEqual((await get(hostHeaders)).state.rounds[0][0].counts,{[a]:1});
  await Promise.all(Array.from({length:40},()=>post({action:'vote',match:m.id,choice:a})));
  assert.deepEqual((await get(hostHeaders)).state.rounds[0][0].counts,{[a]:41});
  assert.equal((await post({action:'vote',match:m.id,choice:'invalid'},{Cookie:cookie})).status,400);
  const raceCookie=(await get()).response.headers.get('set-cookie').split(';')[0];
  const competing=await Promise.all([a,b].map(choice=>post({action:'vote',match:m.id,choice},{Cookie:raceCookie})));
  assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
  const state=(await get(hostHeaders)).state;
  assert.equal((await post({action:'close',revision:state.revision},hostHeaders)).status,200);
  assert.equal((await post({action:'vote',match:m.id,choice:a},{Cookie:cookie})).status,400);
  assert.equal((await get()).state.winners[m.id],a);
  for(const path of ['/data/host.key','/../host.key','/server.py','/package.json']) assert.equal((await fetch(base+path)).status,404);
  const closed=(await get(hostHeaders)).state;
  assert.equal((await post({action:'advance',revision:closed.revision},hostHeaders)).status,200);
  const advanced=(await get(hostHeaders)).state;
  assert.equal(advanced.round,1);assert.equal(advanced.status,'open');
  assert.ok(advanced.rounds[1].every(m=>m.participants.every(Boolean)));
  const malformed=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'});
  assert.equal(malformed.status,400);
  const reopened=backend==='postgres'?new PostgresTournament({connectionString:process.env.TEST_DATABASE_URL,key:tournament.key}):new Tournament(dataDir);
  assert.equal((await reopened.view('other',true)).winners[m.id],a);await reopened.close();
});

test('existing Python schema, host key and signed browser cookies remain compatible',async(t)=>{
  const dataDir=mkdtempSync(join(tmpdir(),'villain-legacy-'));
  const state=fresh();state.status='open';state.revision=7;
  const key='test-only-existing-host-key', voter='a'.repeat(48);
  writeFileSync(join(dataDir,'host.key'),key);
  const db=new DatabaseSync(join(dataDir,'tournament.sqlite3'));
  db.exec('CREATE TABLE state (id INTEGER PRIMARY KEY, body TEXT); CREATE TABLE votes (voter TEXT, match TEXT, choice TEXT, PRIMARY KEY(voter,match));');
  db.prepare('INSERT INTO state VALUES (1,?)').run(JSON.stringify(state));
  const match=state.rounds[0][0];
  db.prepare('INSERT INTO votes VALUES (?,?,?)').run(voter,match.id,match.sources[0]);db.close();
  const {server,tournament}=createApplication({dataDir});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));tournament.close();rmSync(dataDir,{recursive:true,force:true});});
  assert.equal(tournament.key,key);
  const signature=createHmac('sha256',key).update(voter).digest('hex');
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/state`,{headers:{Cookie:`voter=${voter}.${signature}`,Authorization:`Bearer ${key}`}});
  const actual=await r.json();
  assert.equal(actual.host,true);assert.equal(actual.revision,7);
  assert.equal(actual.rounds[0][0].myVote,match.sources[0]);
  assert.deepEqual(actual.rounds.map(r=>r.map(m=>m.sources)),state.rounds.map(r=>r.map(m=>m.sources)));
});
