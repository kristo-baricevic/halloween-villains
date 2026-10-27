import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createApplication } from './app.js';

const port=Number(process.env.PORT??8765);
const host=process.env.HOST??'127.0.0.1';
const dataDir=resolve(process.env.DATA_DIR??fileURLToPath(new URL('../../../data/',import.meta.url)));
const {server,tournament}=createApplication({dataDir,secureCookies:process.env.COOKIE_SECURE==='true'});
server.listen(port,host,()=>{
  mkdirSync(dataDir,{recursive:true});
  writeFileSync(join(dataDir,'host-url.txt'),`http://localhost:${port}/host#${tournament.key}`,{mode:0o600});
  console.log(`Halloween Sweet Sixteen: http://localhost:${port}`);
  console.log(`Private host link saved in ${join(dataDir,'host-url.txt')}`);
});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{tournament.close();process.exit(0);}));
