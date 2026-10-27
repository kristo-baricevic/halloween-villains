import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,nominationPairs,participants,transition} from '../src/index.js';

test('100 draws split all six nomination pairs and account for every entrant',()=>{
  const paired=new Set(nominationPairs.flat());
  for(let n=0;n<100;n++) {
    const s=fresh();
    assert.deepEqual(s.rounds.map(r=>r.length),[5,8,4,2,1]);
    const wild=s.rounds[0].flatMap(m=>m.sources);
    const byes=s.rounds[1].flatMap(m=>m.sources).filter(p=>!p.startsWith('@'));
    assert.equal(wild.length,10);assert.equal(byes.length,11);
    assert.equal(new Set([...wild,...byes]).size,21);
    for(const pair of nominationPairs) {
      assert.equal(pair.filter(p=>wild.includes(p)).length,1);
      assert.equal(pair.filter(p=>byes.includes(p)).length,1);
    }
    assert.equal(wild.filter(p=>!paired.has(p)).length,4);
  }
});

test('full tournament eliminates 20 entrants and crowns one champion',()=>{
  let s=fresh();const eliminated=new Set();
  const act=(action)=>{s=transition(s,{action,revision:s.revision},counts);};
  let counts={};act('open');
  for(let r=0;r<5;r++) {
    counts={};assert.equal(s.round,r);
    for(const m of s.rounds[r]) {
      const [a,b]=participants(s,m);
      assert.ok(a&&b);assert.ok(!eliminated.has(a)&&!eliminated.has(b));
      counts[m.id]={[a]:3,[b]:1};eliminated.add(b);
    }
    act('close');
    assert.equal(s.status,r===4?'complete':'open');
  }
  assert.equal(s.status,'complete');assert.equal(eliminated.size,20);
  assert.equal(Object.keys(s.winners).length,20);
});

test('ties block advancement, stale hosts are rejected, reopen clears decisions',()=>{
  let s=fresh();
  s=transition(s,{action:'open',revision:0},{});
  assert.throws(()=>transition(s,{action:'close',revision:0},{}),/bracket changed/);
  s=transition(s,{action:'close',revision:s.revision},{});
  assert.throws(()=>transition(s,{action:'advance',revision:s.revision},{}),/resolve every tie/);
  const m=s.rounds[0][0];
  s=transition(s,{action:'resolve',revision:s.revision,match:m.id,choice:m.sources[0]},{});
  assert.equal(s.winners[m.id],m.sources[0]);
  s=transition(s,{action:'reopen',revision:s.revision},{});
  assert.deepEqual(s.winners,{});assert.equal(s.status,'open');
});

test('last tie resolution automatically opens the next round in one revision',()=>{
 let s=fresh();s=transition(s,{action:'open',revision:s.revision},{});
 const matches=s.rounds[0];
 s=transition(s,{action:'close',revision:s.revision},{});
 assert.equal(s.status,'closed');
 for(const [i,m] of matches.entries()) {
  const revision=s.revision;
  s=transition(s,{action:'resolve',match:m.id,choice:m.sources[0],revision},{});
  assert.equal(s.revision,revision+1);
  assert.equal(s.round,i===matches.length-1?1:0);
 }
 assert.equal(s.status,'open');
 assert.ok(s.rounds[1].every(m=>participants(s,m).every(Boolean)));
});
