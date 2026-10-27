import { createApplication } from '../apps/api/src/app.js';
import { PostgresTournament } from '../apps/api/src/postgres-store.js';

let application;
export default async function handler(req,res) {
  try {
    application??=createApplication({
      tournament:new PostgresTournament({connectionString:process.env.DATABASE_URL,key:process.env.HOST_KEY}),
      secureCookies:true,
    });
    await application.handler(req,res);
  } catch {
    res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'The voting service is temporarily unavailable. Please try again.'}));
  }
}
