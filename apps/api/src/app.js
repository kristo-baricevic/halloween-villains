import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { publicDirectory } from '@halloween/web';
import { RequestError } from '@halloween/tournament';
import { Tournament } from './store.js';

function equal(a,b) {
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length && timingSafeEqual(x,y);
}
function identity(req,key) {
  const raw=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('voter='))?.slice(6)??'';
  const parts=raw.split('.');
  const sign=id=>createHmac('sha256',key).update(id).digest('hex');
  const valid=parts.length===2 && /^[0-9a-f]{48}$/.test(parts[0]) && equal(parts[1],sign(parts[0]));
  const voter=valid?parts[0]:randomBytes(24).toString('hex');
  return {voter,cookie:`${voter}.${sign(voter)}`,host:equal(req.headers.authorization??'',`Bearer ${key}`)};
}
async function body(req) {
  if((req.headers['content-type']??'').split(';')[0]!=='application/json') throw new RequestError('JSON required.');
  const chunks=[];let size=0;
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>4096) throw new RequestError('Request too large.',413);
    chunks.push(chunk);
  }
  let data;
  try { data=JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new RequestError('Invalid JSON.'); }
  if(!data||typeof data!=='object'||Array.isArray(data)) throw new RequestError('Invalid request.');
  return data;
}
export function createApplication({dataDir,secureCookies=false}) {
  const tournament=new Tournament(dataDir);
  const files=new Map([
    ['/', ['index.html','text/html']],['/host',['index.html','text/html']],
    ['/app.js',['app.js','text/javascript']],['/style.css',['style.css','text/css']],
  ].map(([route,[file,mime]])=>[route,{body:readFileSync(join(publicDirectory,file)),mime}]));
  const server=createServer(async(req,res)=>{
    const {voter,cookie,host}=identity(req,tournament.key);
    const send=(status,content,mime='application/json')=>{
      const payload=Buffer.isBuffer(content)?content:Buffer.from(content);
      res.writeHead(status,{
        'Content-Type':`${mime}; charset=utf-8`, 'Content-Length':payload.length,
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
        'Set-Cookie':`voter=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secureCookies?'; Secure':''}`,
      });
      res.end(payload);
    };
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      if(req.method==='GET') {
        if(path==='/healthz') return send(200,JSON.stringify({ok:true}));
        if(path==='/api/state') return send(200,JSON.stringify(tournament.view(voter,host)));
        const file=files.get(path);
        if(file) return send(200,file.body,file.mime);
      }
      if(req.method==='POST' && path==='/api/action') {
        tournament.action(await body(req),voter,host);
        return send(200,JSON.stringify({ok:true}));
      }
      send(404,JSON.stringify({error:'Not found'}));
    } catch(error) {
      if(!(error instanceof RequestError)) console.error('Request failed:',error.message);
      if(!res.headersSent) send(error instanceof RequestError?error.status:500,JSON.stringify({error:error instanceof RequestError?error.message:'Could not save. Please try again.'}));
    }
  });
  server.requestTimeout=15000;
  return {server,tournament};
}
