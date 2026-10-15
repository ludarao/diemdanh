'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const {getPool}=require('../lib/db');
async function main(){
  const db=getPool();
  try{
    for(const file of ['001_core.sql','002_supabase_security.sql','003_class_viewers.sql','004_class_viewers_security.sql','005_group_permissions.sql']){
      const version=file.replace('.sql','');
      const exists=(await db.query("SELECT to_regclass('public.schema_migrations') AS table_name")).rows[0].table_name;
      if(exists&&(await db.query('SELECT 1 FROM schema_migrations WHERE version=$1',[version])).rows.length){console.log(`Already applied: ${file}`);continue;}
      await db.query(await fs.readFile(path.join(__dirname,'../migrations',file),'utf8'));console.log(`Applied: ${file}`);
    }
  }finally{await db.end();}
}
main().catch(e=>{console.error('Migration failed:',e.code||e.name,'Check connection, TLS certificate and SQL privileges. No secrets were printed.');process.exitCode=1;});
