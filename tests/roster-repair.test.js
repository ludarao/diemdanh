'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createTestDb,payload}=require('./helpers');const store=require('../lib/store');
const actor='33333333-3333-4333-8333-333333333333';
async function fixture(){
  const db=await createTestDb();
  await db.query('INSERT INTO admin_users(user_id,email) VALUES($1,$2)',[actor,'roster-test@example.test']);
  const c=(await db.query('SELECT * FROM classes LIMIT 1')).rows[0];
  return {db,c};
}
const reason=(name,content)=>({...payload(name),status:'Vắng có lý do',absentReason:content,latitude:null,longitude:null,accuracy:null});
test('Phiên tạo trước danh sách, đã có ba lượt báo lý do: nhập danh sách khôi phục sĩ số và khớp cả ba',async()=>{
  const {db,c}=await fixture();
  try{
    await store.publicConfig(db,c.id,new Date('2026-10-13T07:00:00+07:00'));
    const ids=[];
    for(const content of ['Thử','Ngủ','Vắng'])ids.push((await store.submit(db,c.id,reason('Nguyễn Văn An',content),new Date('2026-10-13T07:20:00+07:00'))).id);
    assert.equal(Number((await db.query('SELECT count(*) FROM session_roster')).rows[0].count),0);
    await store.importStudents(db,c.id,[{name:'Nguyễn Văn An',unit:'A'},{name:'Trần Thị Bình',unit:'B'}],'replace',actor);
    const d=await store.dashboard(db,c.id,'2026-10-13',null,new Date('2026-10-13T08:01:00+07:00'));
    assert.equal(d.counts.total,2);assert.equal(d.unmatched.length,0);
    const student=d.rows.find(r=>r.name==='Nguyễn Văn An');assert.equal(student.history.length,3);assert.equal(student.reason,'Vắng');
    assert.deepEqual(student.history.map(a=>a.id),ids);
    assert.ok(student.history.every(a=>a.entered_name==='Nguyễn Văn An'&&a.reason_status==='pending'));
  }finally{await db.close();}
});
test('Dashboard tự sửa snapshot rỗng từ bản cũ sau khi danh sách đã được thêm, không phải điểm danh lại',async()=>{
  const {db,c}=await fixture();
  try{
    const r=await store.submit(db,c.id,payload(),new Date('2026-10-13T07:30:00+07:00'));
    await store.saveStudent(db,{class_id:c.id,name:'Nguyễn Văn An',unit:'A'},actor);
    const d=await store.dashboard(db,c.id,'2026-10-13',null,new Date('2026-10-13T08:30:00+07:00'));
    assert.equal(d.counts.present,1);assert.equal(d.counts.total,1);assert.equal(d.unmatched.length,0);
    assert.equal(d.rows[0].history[0].id,r.id);assert.equal(new Date(d.rows[0].received_at).toISOString(),r.receivedAt);
    const audits=Number((await db.query("SELECT count(*) FROM audit_logs WHERE action='repair_empty_roster'")).rows[0].count);
    assert.ok(audits>0);
    await store.dashboard(db,c.id,'2026-10-13',d.session.id,new Date('2026-10-13T08:31:00+07:00'));
    assert.equal(Number((await db.query("SELECT count(*) FROM audit_logs WHERE action='repair_empty_roster'")).rows[0].count),audits);
  }finally{await db.close();}
});
test('Khôi phục roster không tự ghép tên sai hoặc tên trùng, không ghi có mặt bằng lượt báo lý do',async()=>{
  const {db,c}=await fixture();
  try{
    await store.submit(db,c.id,reason('Nguyễn Văn An','Có việc'),new Date('2026-10-13T07:10:00+07:00'));
    await store.submit(db,c.id,payload('Nguyen Van An'),new Date('2026-10-13T07:15:00+07:00'));
    await store.importStudents(db,c.id,[{name:'Nguyễn Văn An',unit:'A'},{name:'Nguyễn Văn An',unit:'B'}],'replace',actor);
    const d=await store.dashboard(db,c.id,'2026-10-13',null,new Date('2026-10-13T08:01:00+07:00'));
    assert.equal(d.counts.total,2);assert.equal(d.counts.present,0);assert.equal(d.unmatched.length,2);
    assert.equal(d.unmatched.find(a=>a.entered_name==='Nguyễn Văn An').match_state,'ambiguous');
    assert.equal(d.unmatched.find(a=>a.entered_name==='Nguyen Van An').match_state,'unmatched');
  }finally{await db.close();}
});
