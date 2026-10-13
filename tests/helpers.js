'use strict';
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs/promises');const path=require('node:path');
async function createTestDb(){
  const engine=new PGlite();await engine.waitReady;
  await engine.exec(await fs.readFile(path.join(__dirname,'../migrations/001_core.sql'),'utf8'));
  let tail=Promise.resolve();
  async function lock(){let release;const wait=tail;tail=new Promise(resolve=>{release=resolve;});await wait;return release;}
  const query=(sql,params=[])=>engine.query(sql,params);
  const db={
    async query(sql,params){const release=await lock();try{return await query(sql,params);}finally{release();}},
    async connect(){const release=await lock();return {query,release};},
    engine,async close(){await tail;await engine.close();}
  };
  return db;
}
async function seed(db,students=[{name:'Nguyễn Văn An',unit:'Đơn vị A'},{name:'Trần Thị Bình',unit:'Đơn vị B'}]){
  const c=(await db.query('SELECT * FROM classes LIMIT 1')).rows[0];
  const actor='11111111-1111-4111-8111-111111111111';
  await db.query('INSERT INTO admin_users(user_id,email) VALUES($1,$2)',[actor,'admin@example.test']);
  const store=require('../lib/store');await store.importStudents(db,c.id,students,'replace',actor);
  return {c,actor,store};
}
function payload(name='Nguyễn Văn An',device='DEV-A'){
  return {requestId:require('node:crypto').randomUUID(),hoTen:name,donVi:'Đơn vị A',status:'Có mặt',absentReason:'',deviceId:device,latitude:13.993095,longitude:107.997195,accuracy:10,attendanceDate:'13/10/2026',userAgent:'Test browser'};
}
module.exports={createTestDb,seed,payload};
