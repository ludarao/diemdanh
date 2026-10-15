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
    const res={statusCode:200,setHeader(){},end(body){try{this.json=JSON.parse(body);}catch{this.json=body;}}};
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
    for(const action of ['students','audit','export','template','viewers','deletion-preview','viewer-auth-status'])assert.equal((await f.request(action,{class_id:f.c.id})).statusCode,403,action);
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
    await f.db.query('UPDATE class_viewers SET can_import_roster=true,can_edit_schedule=true WHERE user_id=$1',[f.viewer.user_id]);
    await f.db.engine.exec(`SET request.jwt.claim.sub='${f.viewer.user_id}'; SET ROLE authenticated;`);
    assert.equal((await f.db.engine.query('SELECT * FROM attendance_attempts')).rows.length,1);
    assert.ok((await f.db.engine.query('SELECT * FROM sessions')).rows.every(s=>s.class_id===f.c.id));
    assert.equal((await f.db.engine.query('SELECT public.is_attendance_admin() AS allowed')).rows[0].allowed,false);
    await assert.rejects(()=>f.db.engine.query("UPDATE attendance_attempts SET reason='hack'"),/permission denied/);
    await assert.rejects(()=>f.db.engine.query('SELECT * FROM class_viewers'),/permission denied/);
    await assert.rejects(()=>f.db.engine.query("UPDATE sessions SET name='hack'"),/permission denied/);
    await assert.rejects(()=>f.db.engine.query("INSERT INTO students(class_id,name,normalized_name) VALUES($1,'hack','hack')",[f.c.id]),/permission denied/);
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

test('Quyền nhập danh sách riêng: nhập/đồng bộ đúng nhóm, không mở quyền chỉnh lịch',async()=>{
  const f=await fixture();try{
    await saveViewer(f.db,{operation:'permissions',user_id:f.viewer.user_id,class_id:f.c.id,can_import_roster:true,can_edit_schedule:false},f.admin);
    assert.equal((await f.request('students',{class_id:f.c.id})).statusCode,200);
    const template=await f.request('template',{class_id:f.c.id});assert.equal(template.statusCode,200);
    const preview=await f.request('preview-import',{}, {class_id:f.c.id,paste:'TT\tHọ và tên\tNgày sinh\tĐơn vị\n1\tNguyễn Văn An\t\tA\n2\tNgười Mới\t\t'});
    assert.equal(preview.statusCode,200);assert.equal(preview.json.class_id,f.c.id);assert.equal(preview.json.total,2);
    const oldRoster=(await store.dashboard(f.db,f.c.id,'2026-10-13',null,new Date('2026-10-13T07:30:00+07:00'))).rows;
    const beforeOther=(await store.listStudents(f.db,f.other.id));
    assert.equal((await f.request('import',{}, {class_id:f.c.id,rows:preview.json.rows,mode:'replace'})).statusCode,200);
    assert.deepEqual(await store.listStudents(f.db,f.other.id),beforeOther);
    const morning=(await f.db.query("SELECT id FROM sessions WHERE class_id=$1 AND name='Sáng'",[f.c.id])).rows[0].id;
    assert.equal((await store.dashboard(f.db,f.c.id,'2026-10-13',morning,new Date('2026-10-13T07:30:00+07:00'))).rows.length,oldRoster.length);
    assert.equal((await f.request('sync-roster',{}, {session_id:morning,note:'Cập nhật danh sách nhóm'})).statusCode,200);
    assert.ok((await f.db.query('SELECT name FROM session_roster WHERE session_id=$1',[morning])).rows.some(s=>s.name==='Người Mới'));
    const foreign=(await f.db.query('SELECT id FROM sessions WHERE class_id=$1 LIMIT 1',[f.other.id])).rows[0].id;
    assert.equal((await f.request('sync-roster',{}, {session_id:foreign,class_id:f.c.id,note:'Giả mạo nhóm'})).statusCode,403);
    assert.equal((await f.request('preview-import',{}, {class_id:f.other.id,paste:'x'})).statusCode,403);
    assert.equal((await f.request('import',{}, {class_id:f.other.id,rows:preview.json.rows,mode:'replace'})).statusCode,403);
    assert.equal((await f.request('save-default-schedule',{}, {class_id:f.c.id})).statusCode,403);
  }finally{await f.db.close();}
});
test('Quyền chỉnh lịch riêng: đổi mặc định không sửa phiên đã tạo, GPS hoặc nhóm khác',async()=>{
  const f=await fixture();try{
    await saveViewer(f.db,{operation:'permissions',user_id:f.viewer.user_id,class_id:f.c.id,can_import_roster:false,can_edit_schedule:true},f.admin);
    const sessions=(await f.db.query('SELECT * FROM sessions WHERE class_id=$1 ORDER BY id',[f.c.id])).rows;
    const before=(await f.db.query('SELECT * FROM classes WHERE id=$1',[f.c.id])).rows[0];
    const otherBefore=(await f.db.query('SELECT * FROM classes WHERE id=$1',[f.other.id])).rows[0];
    const times={morning_open:'07:30',morning_deadline:'08:30',afternoon_open:'14:00',afternoon_deadline:'14:30'};
    assert.equal((await f.request('save-default-schedule',{}, {class_id:f.c.id,...times})).statusCode,200);
    assert.deepEqual((await f.db.query('SELECT * FROM sessions WHERE class_id=$1 ORDER BY id',[f.c.id])).rows,sessions);
    const after=(await f.db.query('SELECT * FROM classes WHERE id=$1',[f.c.id])).rows[0];
    assert.deepEqual(after,{...before,...times});assert.deepEqual((await f.db.query('SELECT * FROM classes WHERE id=$1',[f.other.id])).rows[0],otherBefore);
    await store.ensureDay(f.db,after,'2026-10-16');
    assert.equal((await f.db.query("SELECT opens_at FROM sessions WHERE class_id=$1 AND day='2026-10-16' ORDER BY opens_at",[f.c.id])).rows[0].opens_at.toISOString(),'2026-10-16T00:30:00.000Z');
    for(const extra of [{latitude:1},{is_default:true},{auto_daily:false},{slug:'bad'},{role:'admin'}])assert.equal((await f.request('save-default-schedule',{}, {class_id:f.c.id,...times,...extra})).statusCode,400);
    assert.equal((await f.request('save-default-schedule',{}, {class_id:f.other.id,...times})).statusCode,403);
    assert.equal((await f.request('students',{class_id:f.c.id})).statusCode,403);
    assert.equal((await f.request('save-class',{}, {...after,latitude:1})).statusCode,403);
  }finally{await f.db.close();}
});
test('Chỉnh lịch ngày có xác nhận, giữ giờ gửi; quản lý không hủy/mở lại ngày nghỉ',async()=>{
  const f=await fixture();try{
    await saveViewer(f.db,{operation:'permissions',user_id:f.viewer.user_id,class_id:f.c.id,can_import_roster:false,can_edit_schedule:true},f.admin);
    const times={morning_open:'07:00',morning_deadline:'07:10',afternoon_open:'13:30',afternoon_deadline:'14:00'};
    const input={class_id:f.c.id,day:'2026-10-13',...times,cancelled:false};
    assert.equal((await f.request('save-schedule',{},input)).statusCode,409);
    assert.equal((await f.request('save-schedule',{}, {...input,confirm_changes:'false'})).statusCode,400);
    const before=(await f.db.query('SELECT received_at FROM attendance_attempts WHERE class_id=$1 ORDER BY id',[f.c.id])).rows;
    assert.equal((await f.request('save-schedule',{}, {...input,confirm_changes:true})).statusCode,200);
    assert.deepEqual((await f.db.query('SELECT received_at FROM attendance_attempts WHERE class_id=$1 ORDER BY id',[f.c.id])).rows,before);
    const d=await store.dashboard(f.db,f.c.id,input.day,null,new Date('2026-10-13T08:00:00+07:00'));assert.equal(d.counts.late,1);
    assert.equal((await f.request('save-schedule',{}, {...input,cancelled:true,confirm_changes:true})).statusCode,403);
    assert.equal((await f.request('save-schedule',{}, {...input,class_id:f.other.id,confirm_changes:true})).statusCode,403);
    assert.equal((await f.request('save-schedule',{}, {...input,latitude:1,confirm_changes:true})).statusCode,400);
    await store.saveSchedule(f.db,{...input,day:'2026-10-17',cancelled:true},f.admin.user_id);
    assert.equal((await f.request('save-schedule',{}, {...input,day:'2026-10-17'})).statusCode,403);
    assert.equal((await f.request('save-schedule',{}, {...input,day:'2026-10-17',cancelled:true})).statusCode,200);
    assert.equal((await f.db.query('SELECT morning_deadline FROM classes WHERE id=$1',[f.c.id])).rows[0].morning_deadline,'08:00');
    assert.ok((await f.db.query("SELECT * FROM audit_logs WHERE action='save_schedule' AND actor_id=$1",[f.viewer.user_id])).rows.length);
  }finally{await f.db.close();}
});
test('Admin cấp hai quyền; chuyển nhóm không tự mang quyền cũ và không chỉnh quyền của admin',async()=>{
  const f=await fixture();try{
    const initial=(await listViewers(f.db,f.admin))[0].classes[0];assert.equal(initial.can_import_roster,false);assert.equal(initial.can_edit_schedule,false);
    await saveViewer(f.db,{operation:'permissions',user_id:f.viewer.user_id,class_id:f.c.id,can_import_roster:true,can_edit_schedule:true},f.admin);
    const grant=(await f.request('classes')).json[0];assert.equal(grant.can_edit_schedule,true);assert.equal(grant.can_import_roster,true);
    for(const action of ['save-viewer','save-class','delete-data','review-reason','manual-attendance','save-student'])assert.equal((await f.request(action,{}, {class_id:f.c.id,user_id:f.viewer.user_id,role:'admin'})).statusCode,403);
    await assert.rejects(()=>saveViewer(f.db,{operation:'permissions',user_id:f.viewer.user_id,class_id:f.other.id,can_import_roster:true},f.admin),e=>e.status===404);
    await assert.rejects(()=>saveViewer(f.db,{operation:'permissions',user_id:f.admin.user_id,class_id:f.c.id,can_import_roster:true},f.admin),e=>e.status===404);
    await assert.rejects(()=>saveViewer(f.db,{operation:'permissions',user_id:f.viewer.user_id,class_id:f.c.id,can_import_roster:'true'},f.admin),e=>e.status===400);
    await saveViewer(f.db,{operation:'assign',user_id:f.viewer.user_id,class_id:f.other.id},f.admin);
    const assigned=(await f.request('classes')).json[0];assert.equal(assigned.can_import_roster,false);assert.equal(assigned.can_edit_schedule,false);
  }finally{await f.db.close();}
});
test('Quyền được kiểm tra lại trong transaction nếu thu hồi sau bước kiểm tra API',async()=>{
  const f=await fixture();try{
    await saveViewer(f.db,{operation:'permissions',user_id:f.viewer.user_id,class_id:f.c.id,can_import_roster:true,can_edit_schedule:true},f.admin);
    const actor=(await f.db.query('SELECT * FROM admin_users WHERE user_id=$1',[f.viewer.user_id])).rows[0];
    await require('../lib/permissions').authorize(f.db,actor,'import',new URL('http://localhost/api'),{class_id:f.c.id});
    await saveViewer(f.db,{operation:'permissions',user_id:f.viewer.user_id,class_id:f.c.id,can_import_roster:false,can_edit_schedule:false},f.admin);
    const before=await store.listStudents(f.db,f.c.id);
    await assert.rejects(()=>store.importStudents(f.db,f.c.id,[{name:'Không được nhập'}],'replace',actor.user_id),e=>e.status===403);
    assert.deepEqual(await store.listStudents(f.db,f.c.id),before);
    await assert.rejects(()=>store.saveDefaultSchedule(f.db,{class_id:f.c.id,morning_open:'07:30',morning_deadline:'08:30',afternoon_open:'13:30',afternoon_deadline:'14:00'},actor.user_id),e=>e.status===403);
    await f.db.query('UPDATE admin_users SET enabled=false WHERE user_id=$1',[actor.user_id]);
    await assert.rejects(()=>store.importStudents(f.db,f.c.id,[{name:'Không được nhập'}],'replace',actor.user_id),e=>e.status===403);
  }finally{await f.db.close();}
});
