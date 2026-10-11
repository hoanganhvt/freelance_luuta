import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app.mjs';
import { openStore } from './store.mjs';
import { existsSync } from 'node:fs';

const app=createApp(openStore());
const production=process.argv.includes('--production');
if(production){const assets=existsSync('.cloudflare/output/v0/workers/default/assets/index.html')?'.cloudflare/output/v0/workers/default/assets':'dist';app.use(express.static(resolve(assets)));app.get('/{*path}',(req,res)=>res.sendFile(resolve(assets,'index.html')));}
else {const {createServer}=await import('vite');const vite=await createServer({configFile:false,server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
const port=Number(process.env.PORT||3000);
app.listen(port,'0.0.0.0',()=>console.log(`LUUTA đang chạy tại http://localhost:${port} (${production?'production':'demo'})`));
