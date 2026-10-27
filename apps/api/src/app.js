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
function adminSession(req,key) {
  const raw=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('admin='))?.slice(6)??'';
  const [expiry,signature]=raw.split('.');
  return /^\d+$/.test(expiry??'') && Number(expiry)>Date.now() && equal(signature??'',createHmac('sha256',key).update('admin:'+expiry).digest('hex'));
}
async function body(req) {
  if((req.headers['content-type']??'').split(';')[0]!=='application/json') throw new RequestError('JSON required.');
  let data;
  // Vercel may have already parsed the request before invoking the function.
  if(req.body!==undefined) {
    const raw=Buffer.isBuffer(req.body)?req.body.toString():typeof req.body==='string'?req.body:JSON.stringify(req.body);
    if(Buffer.byteLength(raw)>4096) throw new RequestError('Request too large.',413);
    try { data=JSON.parse(raw); } catch { throw new RequestError('Invalid JSON.'); }
  } else {
    const chunks=[];let size=0;
    for await(const chunk of req) {
      size+=chunk.length;
      if(size>4096) throw new RequestError('Request too large.',413);
      chunks.push(chunk);
    }
    try { data=JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new RequestError('Invalid JSON.'); }
  }
  if(!data||typeof data!=='object'||Array.isArray(data)) throw new RequestError('Invalid request.');
  return data;
}
export function createApplication({dataDir,secureCookies=false,tournament=new Tournament(dataDir)}) {
  const files=new Map([
    ['/', ['index.html','text/html']],['/host',['index.html','text/html']],
    ['/admin',['admin.html','text/html']],['/admin.js',['admin.js','text/javascript']],
    ['/app.js',['app.js','text/javascript']],['/style.css',['style.css','text/css']],
    ['/villain-images.json',['villain-images.json','application/json']],
  ].map(([route,[file,mime]])=>[route,{body:readFileSync(join(publicDirectory,file)),mime}]));
  const manifest=JSON.parse(files.get('/villain-images.json').body);
  for(const image of Object.values(manifest.images)) {
    if(!/^\/images\/villains\/v\d+\.(jpg|png|webp)$/.test(image.path)) throw new Error('Invalid image manifest path');
    const mime={jpg:'image/jpeg',png:'image/png',webp:'image/webp'}[image.path.split('.').pop()];
    files.set(image.path,{body:readFileSync(join(publicDirectory,image.path.slice(1))),mime});
  }
  const handler=async(req,res)=>{
    const {voter,cookie,host:bearerHost}=identity(req,tournament.key);
    const host=bearerHost||adminSession(req,tournament.key);
    let adminCookie;
    const cookieFlags=`; Path=/; HttpOnly; SameSite=Strict${secureCookies?'; Secure':''}`;
    const send=(status,content,mime='application/json')=>{
      const payload=Buffer.isBuffer(content)?content:Buffer.from(content);
      res.writeHead(status,{
        'Content-Type':mime.startsWith('image/')?mime:`${mime}; charset=utf-8`, 'Content-Length':payload.length,
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
        'Set-Cookie':[`voter=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secureCookies?'; Secure':''}`,...(adminCookie?[adminCookie]:[])],
      });
      res.end(payload);
    };
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      if(req.method==='GET') {
        if(path==='/healthz') return send(200,JSON.stringify({ok:true}));
        if(path==='/api/state') return send(200,JSON.stringify(await tournament.view(voter,host)));
        const file=files.get(path);
        if(file) return send(200,file.body,file.mime);
      }
      if(req.method==='POST' && (path==='/api/login'||path==='/api/logout')) {
        const data=await body(req);
        if(path==='/api/login') {
          if(typeof data.password!=='string'||!equal(data.password,tournament.key)) throw new RequestError('Incorrect admin password.',401);
          const expiry=String(Date.now()+8*60*60*1000);
          const signature=createHmac('sha256',tournament.key).update('admin:'+expiry).digest('hex');
          adminCookie=`admin=${expiry}.${signature}${cookieFlags}; Max-Age=28800`;
        } else adminCookie=`admin=${cookieFlags}; Max-Age=0`;
        return send(200,JSON.stringify({ok:true}));
      }
      if(req.method==='POST' && path==='/api/action') {
        await tournament.action(await body(req),voter,host);
        return send(200,JSON.stringify({ok:true}));
      }
      send(404,JSON.stringify({error:'Not found'}));
    } catch(error) {
      if(!(error instanceof RequestError)) console.error('Request failed:',error.message);
      if(!res.headersSent) send(error instanceof RequestError?error.status:500,JSON.stringify({error:error instanceof RequestError?error.message:'Could not save. Please try again.'}));
    }
  };
  const server=createServer(handler);
  server.requestTimeout=15000;
  return {server,tournament,handler};
}
