'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const esbuild=require('esbuild');
async function build(){
  const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
  await fs.rm(out,{recursive:true,force:true});await fs.mkdir(path.join(out,'admin'),{recursive:true});
  for(const file of ['index.html','style.css','config.js','app.js'])await fs.copyFile(path.join(root,file),path.join(out,file));
  for(const file of ['index.html','admin.css'])await fs.copyFile(path.join(root,'admin',file),path.join(out,'admin',file));
  await esbuild.build({entryPoints:[path.join(root,'admin/admin.js')],outfile:path.join(out,'admin/admin.js'),bundle:true,format:'esm',platform:'browser',minify:true,target:['es2020'],legalComments:'none'});
  console.log('Built attendance page (preserved layout/CSS) and admin dashboard into dist/.');
}
build().catch(e=>{console.error(e.message);process.exitCode=1;});
