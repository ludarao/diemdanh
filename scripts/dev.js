'use strict';
const http=require('node:http');const fs=require('node:fs/promises');const path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
if(spawnSync(process.execPath,[path.join(__dirname,'build.js')],{stdio:'inherit'}).status!==0)process.exit(1);
const handler=require('../api/index');const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api'||url.pathname==='/api/index'){
    try{let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>3*1024*1024){res.statusCode=413;res.end('File too large');return;}}req.body=body?JSON.parse(body):{};await handler(req,res);}
    catch{res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:'Dữ liệu JSON không hợp lệ.'}));}return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;res.end();return;}
  const pathname=['/admin','/admin/'].includes(url.pathname)?'/admin/index.html':url.pathname==='/'?'/index.html':url.pathname;
  const file=path.resolve(root,'dist','.'+pathname);
  if(!file.startsWith(path.join(root,'dist')+path.sep)){res.statusCode=404;res.end();return;}
  try{const content=await fs.readFile(file);res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.end(req.method==='HEAD'?undefined:content);}
  catch{res.statusCode=404;res.end('Not found');}
});
const port=Number(process.env.PORT||3000);server.listen(port,'127.0.0.1',()=>console.log(`Local preview: http://localhost:${port} · Admin: http://localhost:${port}/admin`));
