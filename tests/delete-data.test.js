'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createTestDb,seed,payload}=require('./helpers');const store=require('../lib/store');
const {previewDeletion,deleteData}=require('../lib/delete-data');
async function fixture(){
  const db=await createTestDb();const {c,actor}=await seed(db);
  const other=await store.saveClass(db,{...c,id:null,name:'Lớp khác',slug:'lop-khac',is_default:false},actor);
  await store.importStudents(db,other.id,[{name:'Lê Văn Cường',unit:'C'}],'replace',actor);
  await store.submit(db,c.id,payload(),new Date('2026-10-13T07:30:00+07:00'));
  await store.submit(db,c.id,{...payload('Trần Thị Bình'),status:'Vắng có lý do',absentReason:'Có việc',latitude:null,longitude:null,accuracy:null},new Date('2026-10-13T07:40:00+07:00'));
  await store.submit(db,other.id,payload('Lê Văn Cường','DEV-OTHER'),new Date('2026-10-13T07:35:00+07:00'));
  const sessions=(await db.query('SELECT id FROM sessions WHERE class_id=$1 ORDER BY opens_at',[c.id])).rows;
  await store.resolveDevice(db,{session_id:sessions[0].id,device_id:'DEV-A',note:'Đã kiểm tra'},actor);
  return {db,c,other,actor};
}
function confirmed(p){return {operation:p.operation,class_id:p.class_id,preview_hash:p.preview_hash,confirmation:p.confirmation_phrase,acknowledged:true};}
async function totals(db,classId){
  const counts={};for(const table of ['students','sessions','attendance_attempts'])counts[table]=Number((await db.query(`SELECT count(*) FROM ${table} WHERE class_id=$1`,[classId])).rows[0].count);
  counts.roster=Number((await db.query('SELECT count(*) FROM session_roster r JOIN sessions s ON s.id=r.session_id WHERE s.class_id=$1',[classId])).rows[0].count);return counts;
}
test('Xem trước chỉ đọc và hiển thị rõ phạm vi xóa',async()=>{
  const {db,c,actor}=await fixture();
  try{
    const before=await totals(db,c.id),p=await previewDeletion(db,'clear-class-attendance',c.id);
    assert.equal(p.will_delete.classes,0);assert.equal(p.will_delete.students,0);assert.equal(p.will_delete.sessions,0);
    assert.equal(p.will_delete.attendance_attempts,2);assert.equal(p.will_delete.attempts_with_reason,1);assert.equal(p.will_delete.device_notes,1);
    assert.ok(p.confirmation_phrase.includes(c.slug));assert.equal(p._class_ids,undefined);assert.deepEqual(await totals(db,c.id),before);
    assert.equal(Number((await db.query('SELECT count(*) FROM admin_users WHERE user_id=$1',[actor])).rows[0].count),1);
  }finally{await db.close();}
});
test('Xóa dữ liệu từng lớp giữ danh sách và lịch, không ảnh hưởng lớp khác',async()=>{
  const {db,c,other,actor}=await fixture();
  try{
    const before=await totals(db,c.id),otherBefore=await totals(db,other.id),p=await previewDeletion(db,'clear-class-attendance',c.id);
    await deleteData(db,confirmed(p),actor);
    assert.deepEqual(await totals(db,c.id),{...before,attendance_attempts:0});assert.deepEqual(await totals(db,other.id),otherBefore);
    assert.equal(Number((await db.query('SELECT count(*) FROM device_resolutions')).rows[0].count),0);
    assert.equal(Number((await db.query("SELECT count(*) FROM audit_logs WHERE class_id=$1 AND action='clear-class-attendance'",[c.id])).rows[0].count),1);
  }finally{await db.close();}
});
test('Xóa lớp xóa hết dữ liệu liên quan, tự chuyển lớp mặc định và giữ các lớp khác',async()=>{
  const {db,c,other,actor}=await fixture();
  try{
    const otherBefore=await totals(db,other.id),p=await previewDeletion(db,'delete-class',c.id);
    const result=await deleteData(db,confirmed(p),actor);
    assert.equal(result.remaining_classes,1);assert.equal(result.default_class_id,other.id);
    assert.deepEqual(await totals(db,c.id),{students:0,sessions:0,attendance_attempts:0,roster:0});assert.deepEqual(await totals(db,other.id),otherBefore);
    assert.equal((await db.query('SELECT 1 FROM classes WHERE id=$1',[c.id])).rows.length,0);
    assert.equal((await store.publicConfig(db,null,new Date('2026-10-13T07:50:00+07:00'))).classId,other.id);
  }finally{await db.close();}
});
test('Xóa toàn bộ dữ liệu giữ admin/schema, sau đó tạo lại lớp đầu tiên được',async()=>{
  const {db,c,actor}=await fixture();
  try{
    await db.query("INSERT INTO rate_limits(key,window_start,hits) VALUES('test',now(),1)");
    const migrations=(await db.query('SELECT * FROM schema_migrations')).rows;
    const p=await previewDeletion(db,'clear-all');assert.equal(p.will_delete.classes,2);assert.equal(p.will_delete.attendance_attempts,3);
    const result=await deleteData(db,confirmed(p),actor);assert.equal(result.remaining_classes,0);
    for(const table of ['classes','students','sessions','session_roster','attendance_attempts','device_resolutions','rate_limits'])assert.equal(Number((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count),0);
    assert.equal((await db.query('SELECT * FROM admin_users WHERE user_id=$1 AND enabled',[actor])).rows.length,1);
    assert.deepEqual((await db.query('SELECT * FROM schema_migrations')).rows,migrations);
    const logs=(await db.query('SELECT * FROM audit_logs')).rows;assert.equal(logs.length,1);assert.equal(logs[0].action,'clear-all');assert.equal(logs[0].class_id,null);
    const fresh=await store.saveClass(db,{...c,id:null,slug:'lop-moi',name:'Lớp mới',is_default:false},actor);assert.equal(fresh.is_default,true);
    await store.importStudents(db,fresh.id,[{name:'Nguyễn Văn An',unit:'A'}],'replace',actor);
    const r=await store.submit(db,fresh.id,payload(),new Date('2026-10-13T07:30:00+07:00'));assert.equal(r.matchState,'matched');
  }finally{await db.close();}
});
test('Xóa lớp cuối cùng không khóa quyền đăng nhập hoặc quyền tạo lớp lại',async()=>{
  const {db,c,other,actor}=await fixture();
  try{
    for(const id of [c.id,other.id])await deleteData(db,confirmed(await previewDeletion(db,'delete-class',id)),actor);
    assert.equal((await db.query('SELECT * FROM classes')).rows.length,0);
    assert.equal((await db.query('SELECT * FROM admin_users WHERE user_id=$1 AND enabled',[actor])).rows.length,1);
    const fresh=await store.saveClass(db,{...c,id:null,name:'Lớp tạo lại',slug:'tao-lai',is_default:true},actor);assert.equal(fresh.is_default,true);
  }finally{await db.close();}
});
test('Không xóa nếu thiếu xác nhận, sai câu xác nhận hoặc đổi lớp so với bản xem trước',async()=>{
  const {db,c,other,actor}=await fixture();
  try{
    const before=await totals(db,c.id),p=await previewDeletion(db,'delete-class',c.id);
    await assert.rejects(()=>deleteData(db,{...confirmed(p),acknowledged:false},actor),/xác nhận/);
    await assert.rejects(()=>deleteData(db,{...confirmed(p),confirmation:'XÓA'},actor),/chưa đúng/);
    await assert.rejects(()=>deleteData(db,{...confirmed(p),class_id:other.id},actor),/chưa đúng/);
    assert.deepEqual(await totals(db,c.id),before);assert.equal((await db.query('SELECT * FROM classes')).rows.length,2);
  }finally{await db.close();}
});
test('Có thêm lượt gửi sau khi xem trước thì yêu cầu xem lại, không âm thầm xóa lượt mới',async()=>{
  const {db,c,actor}=await fixture();
  try{
    const p=await previewDeletion(db,'clear-class-attendance',c.id);
    await store.submit(db,c.id,payload('Nguyễn Văn An','DEV-NEW'),new Date('2026-10-13T07:50:00+07:00'));
    await assert.rejects(()=>deleteData(db,confirmed(p),actor),e=>e.status===409);
    assert.equal((await totals(db,c.id)).attendance_attempts,3);
  }finally{await db.close();}
});
test('Lỗi giữa chừng rollback toàn bộ việc xóa, không mất một phần dữ liệu',async()=>{
  const {db,c,actor}=await fixture();
  try{
    await db.engine.exec(`CREATE FUNCTION reject_test_student_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test failure'; RETURN OLD; END $$;
      CREATE TRIGGER block_student_delete BEFORE DELETE ON students FOR EACH ROW EXECUTE FUNCTION reject_test_student_delete();`);
    const before=await totals(db,c.id),p=await previewDeletion(db,'delete-class',c.id);
    await assert.rejects(()=>deleteData(db,confirmed(p),actor),/Test failure/);
    assert.deepEqual(await totals(db,c.id),before);assert.equal((await db.query('SELECT * FROM classes WHERE id=$1',[c.id])).rows.length,1);
    assert.equal(Number((await db.query('SELECT count(*) FROM device_resolutions')).rows[0].count),1);
  }finally{await db.close();}
});
