'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const {createTestDb,seed,payload}=require('./helpers');const {createHandler}=require('../api/index');const {AppError}=require('../lib/domain');const {saveViewer,listViewers}=require('../lib/viewer-accounts');const store=require('../lib/store');
async function fixture(){
  const db=await createTestDb();const {c,actor}=await seed(db);const admin=(await db.query('SELECT * FROM admin_users WHERE user_id=$1',[actor])).rows[0];
  const other=await store.saveClass(db,{...c,id:null,name:'Lớp B',slug:'lop-b',is_default:false},actor);
  await store.importStudents(db,other.id,[{name:'Lê Văn Cường',unit:'B'}],'replace',actor);
  await store.submit(db,c.id,payload(),new Date('2026-10-13T07:25:00+07:00'));
  await store.submit(db,other.id,payload('Lê Văn Cường'),new Date('2026-10-13T07:25:00+07:00'));
  await db.query("INSERT INTO schema_migrations(version) VALUES('004_class_viewers_security')");
  let count=0;const calls=[];
  const remote={async createUser(input){calls.push({action:'create',email:input.email});return {data:{user:{id:`22222222-2222-4222-8222-${String(++count).padStart(12,'0')}`}}};},async updateUserById(id,input){calls.push({action:'password',id});return {};},async deleteUser(id){calls.push({action:'delete',id});return {};}};
  const viewer=await saveViewer(db,{operation:'create',email:'leader@example.test',password:'fake-password-only',class_id:c.id},admin,remote);
  async function request(action,params={},body=null,userId=viewer.user_id){
    process.env.APP_ORIGIN='http://localhost:3000';
    const req={url:`/api?${new URLSearchParams({action,...params})}`,method:body?'POST':'GET',body:body||{},headers:{origin:'http://localhost:3000','content-type':'application/json'},socket:{remoteAddress:'test'}};
    const res={setHeader(){},end(body){this.json=JSON.parse(body);}};
    await createHandler({db,adminAuth:remote,requireAdmin:async()=>{const user=(await db.query('SELECT * FROM admin_users WHERE user_id=$1 AND enabled',[userId])).rows[0];if(!user)throw new AppError('Đã thu hồi quyền.',403);return {...user,token:'fake-token'};}})(req,res);return res;
  }
  return {db,c,other,admin,viewer,remote,calls,request};
}
test('Lớp trưởng chỉ thấy lớp được giao, không đọc được dashboard lớp khác qua API',async()=>{
  const f=await fixture();try{
    const me=await f.request('me');assert.equal(me.json.role,'class_viewer');
    const classes=await f.request('classes');assert.equal(classes.json.length,1);assert.equal(classes.json[0].id,f.c.id);
    const own=await f.request('dashboard',{class_id:f.c.id,day:'2026-10-13'});assert.equal(own.statusCode,200);assert.equal(own.json.counts.total,2);
    assert.equal((await f.request('dashboard',{class_id:f.other.id,day:'2026-10-13'})).statusCode,403);
    const foreignSession=(await f.db.query('SELECT id FROM sessions WHERE class_id=$1 LIMIT 1',[f.other.id])).rows[0].id;
    const forged=await f.request('dashboard',{class_id:f.c.id,session_id:foreignSession,day:'2026-10-13'});
    assert.equal(forged.json.class.id,f.c.id);assert.ok(forged.json.sessions.every(s=>s.class_id===f.c.id));
    assert.deepEqual((await f.request('realtime-config')).json,{mode:'polling'});
    assert.equal((await f.request('classes',{},null,f.admin.user_id)).json.length,2);
  }finally{await f.db.close();}
});
test('Lớp trưởng không gọi được API sửa/xóa/duyệt, export, nhật ký hoặc tự cấp quyền',async()=>{
  const f=await fixture();try{
    for(const action of ['students','audit','export','template','viewers','deletion-preview'])assert.equal((await f.request(action,{class_id:f.c.id})).statusCode,403,action);
    for(const action of ['save-class','save-schedule','preview-import','import','reconcile','review-reason','resolve-device','save-student','sync-roster','manual-attendance','delete-data','change-password','save-viewer']){
      assert.equal((await f.request(action,{}, {class_id:f.c.id,user_id:f.viewer.user_id,role:'admin',enabled:true})).statusCode,403,action);
    }
    assert.equal((await f.db.query('SELECT count(*) FROM attendance_attempts')).rows[0].count,2);
  }finally{await f.db.close();}
});
test('Đổi lớp, thu hồi lớp và khóa tài khoản có hiệu lực ở yêu cầu tiếp theo',async()=>{
  const f=await fixture();try{
    await saveViewer(f.db,{operation:'assign',user_id:f.viewer.user_id,class_id:f.other.id},f.admin);
    assert.equal((await f.request('dashboard',{class_id:f.c.id})).statusCode,403);
    assert.equal((await f.request('classes')).json[0].id,f.other.id);
    await saveViewer(f.db,{operation:'assign',user_id:f.viewer.user_id,class_id:''},f.admin);
    assert.deepEqual((await f.request('classes')).json,[]);
    await saveViewer(f.db,{operation:'set-enabled',user_id:f.viewer.user_id,enabled:false},f.admin);
    assert.equal((await f.request('me')).statusCode,403);
    await saveViewer(f.db,{operation:'set-enabled',user_id:f.viewer.user_id,enabled:true},f.admin);
    assert.equal((await f.request('me')).statusCode,200);
  }finally{await f.db.close();}
});
test('Cấp/reset tài khoản chỉ cho admin; mật khẩu không vào database hay nhật ký',async()=>{
  const f=await fixture();try{
    const viewer=(await f.db.query('SELECT * FROM admin_users WHERE user_id=$1',[f.viewer.user_id])).rows[0];
    await assert.rejects(()=>saveViewer(f.db,{operation:'create'},viewer,f.remote),e=>e.status===403);
    await assert.rejects(()=>saveViewer(f.db,{operation:'set-enabled',user_id:f.admin.user_id,enabled:false},f.admin),e=>e.status===404);
    await assert.rejects(()=>saveViewer(f.db,{operation:'create',email:'other@example.test',password:'short',class_id:f.c.id},f.admin,f.remote),/Mật khẩu/);
    await saveViewer(f.db,{operation:'reset-password',user_id:viewer.user_id,password:'reset-fake-password'},f.admin,f.remote);
    const list=await listViewers(f.db,f.admin);assert.equal(list[0].classes[0].id,f.c.id);
    assert.ok(!JSON.stringify((await f.db.query('SELECT * FROM audit_logs')).rows).includes('reset-fake-password'));
    assert.ok(!Object.hasOwn(list[0],'password'));assert.equal(f.calls.length,2);
  }finally{await f.db.close();}
});
test('Xóa lớp gỡ quyền xem, vẫn giữ tài khoản để giao lớp mới',async()=>{
  const f=await fixture();try{
    const {previewDeletion,deleteData}=require('../lib/delete-data');const p=await previewDeletion(f.db,'delete-class',f.c.id);
    await deleteData(f.db,{operation:p.operation,class_id:p.class_id,preview_hash:p.preview_hash,confirmation:p.confirmation_phrase,acknowledged:true},f.admin.user_id);
    assert.deepEqual((await f.request('classes')).json,[]);assert.equal((await f.request('me')).statusCode,200);
    await saveViewer(f.db,{operation:'assign',user_id:f.viewer.user_id,class_id:f.other.id},f.admin);
    assert.equal((await f.request('classes')).json[0].id,f.other.id);
  }finally{await f.db.close();}
});
test('RLS lọc đúng lớp dù truy vấn Supabase không có bộ lọc; khóa/gỡ quyền chặn đọc',async()=>{
  const f=await fixture();try{
    await f.db.engine.exec(`CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    for(const file of ['002_supabase_security.sql','004_class_viewers_security.sql'])await f.db.engine.exec(await fs.readFile(path.join(__dirname,'../migrations',file),'utf8'));
    await f.db.engine.exec(`SET request.jwt.claim.sub='${f.viewer.user_id}'; SET ROLE authenticated;`);
    assert.equal((await f.db.engine.query('SELECT * FROM attendance_attempts')).rows.length,1);
    assert.ok((await f.db.engine.query('SELECT * FROM sessions')).rows.every(s=>s.class_id===f.c.id));
    assert.equal((await f.db.engine.query('SELECT public.is_attendance_admin() AS allowed')).rows[0].allowed,false);
    await assert.rejects(()=>f.db.engine.query("UPDATE attendance_attempts SET reason='hack'"),/permission denied/);
    await assert.rejects(()=>f.db.engine.query('SELECT * FROM class_viewers'),/permission denied/);
    await f.db.engine.exec('RESET ROLE');await f.db.query('DELETE FROM class_viewers WHERE user_id=$1',[f.viewer.user_id]);await f.db.engine.exec('SET ROLE authenticated');
    assert.equal((await f.db.engine.query('SELECT * FROM attendance_attempts')).rows.length,0);
    await f.db.engine.exec('RESET ROLE');await f.db.query('INSERT INTO class_viewers(user_id,class_id) VALUES($1,$2)',[f.viewer.user_id,f.c.id]);await f.db.query('UPDATE admin_users SET enabled=false WHERE user_id=$1',[f.viewer.user_id]);await f.db.engine.exec('SET ROLE authenticated');
    assert.equal((await f.db.engine.query('SELECT * FROM attendance_attempts')).rows.length,0);
    await f.db.engine.exec(`RESET ROLE; SET request.jwt.claim.sub='${f.admin.user_id}'; SET ROLE authenticated;`);
    assert.equal((await f.db.engine.query('SELECT * FROM attendance_attempts')).rows.length,2);
    await f.db.engine.exec('RESET ROLE');
  }finally{await f.db.close();}
});
test('Chưa migration bảo mật thì không cấp tài khoản; lỗi ghi DB dọn user Auth mới',async()=>{
  const f=await fixture();try{
    await f.db.query("DELETE FROM schema_migrations WHERE version='004_class_viewers_security'");
    await assert.rejects(()=>saveViewer(f.db,{operation:'create'},f.admin,f.remote),e=>e.status===503);
    await f.db.query("INSERT INTO schema_migrations(version) VALUES('004_class_viewers_security')");
    await f.db.engine.exec(`CREATE FUNCTION reject_viewer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test write failure'; END $$; CREATE TRIGGER reject_viewer BEFORE INSERT ON class_viewers FOR EACH ROW EXECUTE FUNCTION reject_viewer();`);
    await assert.rejects(()=>saveViewer(f.db,{operation:'create',email:'new@example.test',password:'another-fake-password',class_id:f.c.id},f.admin,f.remote),/Test write failure/);
    assert.equal((await f.db.query("SELECT * FROM admin_users WHERE email='new@example.test'")).rows.length,0);
    assert.equal(f.calls.at(-1).action,'delete');assert.notEqual(f.calls.at(-1).id,f.viewer.user_id);
  }finally{await f.db.close();}
});
