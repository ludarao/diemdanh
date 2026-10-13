'use strict';
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const {createHandler}=require('../api/index');const {createTestDb,seed}=require('./helpers');
let db;before(async()=>{db=await createTestDb();await seed(db);process.env.APP_ORIGIN='http://localhost:3000';});after(async()=>db.close());
async function request(url,{method='GET',body,origin='http://localhost:3000'}={}){
  const headers={'content-type':'application/json'};if(origin)headers.origin=origin;
  const req={url,method,headers,body:body||{},socket:{remoteAddress:'127.0.0.1'}};
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=v;}};
  await createHandler({db})(req,res);return {...res,json:JSON.parse(res.body)};
}
test('Ẩn danh không đọc danh sách, dashboard hoặc nhật ký và không sửa admin',async()=>{
  for(const action of ['classes','students','dashboard','audit','realtime-config','deletion-preview']){const r=await request(`/api?action=${action}`);assert.equal(r.statusCode,401);}
  for(const action of ['save-class','save-schedule','import','reconcile','review-reason','save-student','sync-roster','delete-data']){const r=await request(`/api?action=${action}`,{method:'POST',body:{}});assert.equal(r.statusCode,401);}
});
test('API quản trị từ nguồn khác bị từ chối và GET không được ghi dữ liệu',async()=>{
  assert.equal((await request('/api?action=save-class',{method:'POST',origin:'https://evil.test'})).statusCode,403);
  assert.equal((await request('/api?action=save-class')).statusCode,405);
  assert.equal((await request('/api?action=attendance',{method:'POST',origin:null})).statusCode,403);
  assert.equal((await request('/api?action=delete-data')).statusCode,405);
  assert.equal((await request('/api?action=delete-data',{method:'POST',origin:'https://evil.test'})).statusCode,403);
});
test('API công khai chỉ trả tọa độ/bán kính, không lộ danh sách/mật khẩu/khóa DB',async()=>{
  const r=await request('/api?action=config');assert.equal(r.statusCode,200);assert.equal(r.json.ALLOWED_RADIUS_METERS,100);
  assert.deepEqual(Object.keys(r.json).sort(),['ALLOWED_RADIUS_METERS','CLASSROOM_LAT','CLASSROOM_LNG','MAX_GPS_ACCURACY_METERS','classId','classSlug'].sort());
});
test('RLS Supabase từ chối anon và authenticated ngoài admin',async()=>{
  const {payload}=require('./helpers'),store=require('../lib/store');
  const c=(await db.query('SELECT * FROM classes LIMIT 1')).rows[0];
  await store.submit(db,c.id,payload(),new Date('2026-10-13T07:30:00+07:00'));
  await db.engine.exec(`CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  await db.engine.exec(await require('node:fs/promises').readFile(require('node:path').join(__dirname,'../migrations/002_supabase_security.sql'),'utf8'));
  await db.engine.exec('SET ROLE anon');await assert.rejects(()=>db.engine.query('SELECT * FROM students'),/permission denied/);await db.engine.exec('RESET ROLE');
  await db.engine.exec('SET ROLE authenticated');const a=await db.engine.query('SELECT * FROM attendance_attempts');assert.equal(a.rows.length,0);await assert.rejects(()=>db.engine.query('SELECT * FROM students'),/permission denied/);await db.engine.exec('RESET ROLE');
  await db.engine.exec("SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';SET ROLE authenticated");
  assert.equal((await db.engine.query('SELECT * FROM attendance_attempts')).rows.length,1);
  await assert.rejects(()=>db.engine.query("UPDATE attendance_attempts SET entered_name='Changed'"),/permission denied/);
  await db.engine.exec('RESET ROLE');
});
