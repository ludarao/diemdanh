'use strict';
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const {createHash,randomUUID}=require('node:crypto');const fs=require('node:fs/promises');const path=require('node:path');
const {createTestDb,seed,payload}=require('./helpers');
const store=require('../lib/store');const {previewImport,csv}=require('../lib/import');
let db,c,actor;
before(async()=>{db=await createTestDb();({c,actor}=await seed(db));});after(async()=>{await db.close();});
const at=time=>new Date(`2026-10-13T${time}+07:00`);
test('Giữ nguyên HTML/CSS gốc',async()=>{
  const expected={'index.html':'268e0a83c268143bd69a0fe0b1b4bf9dfab010438ad98c49672081e0b18fd166','style.css':'367bdde2e86102d38309d2096c30b6903ab4ec2c99b7c51a5f3f1ba0c9becc5b'};
  for(const [file,hash]of Object.entries(expected))assert.equal(createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',file))).digest('hex'),hash);
});
test('Retry sau lỗi mạng trả cùng biên nhận; payload khác không dùng lại mã gửi',async()=>{
  const p=payload();const first=await store.submit(db,c.id,p,at('07:25:00'));
  const retry=await store.submit(db,c.id,p,at('09:00:00'));assert.equal(retry.id,first.id);assert.equal(retry.receivedAt,first.receivedAt);
  assert.equal(Number((await db.query('SELECT count(*) FROM attendance_attempts WHERE request_id=$1',[p.requestId])).rows[0].count),1);
  await assert.rejects(()=>store.submit(db,c.id,{...p,hoTen:'Tên khác'},at('09:00:00')),/dữ liệu khác/);
});
test('Tên sai được lưu, không tăng có mặt; liên kết thủ công cập nhật lại',async()=>{
  const a=await store.submit(db,c.id,payload('Trần Thị Binh','DEV-TYPO'),at('07:40:00'));
  let dashboard=await store.dashboard(db,c.id,'2026-10-13',null,at('08:05:00'));
  assert.equal(a.matchState,'unmatched');assert.equal(dashboard.counts.absent,1);assert.equal(dashboard.unmatched.length,1);
  const student=dashboard.rows.find(r=>r.name==='Trần Thị Bình');
  await store.reconcile(db,{attempt_id:a.id,student_id:student.student_id,note:'Đối chiếu tên thiếu dấu'},actor);
  dashboard=await store.dashboard(db,c.id,'2026-10-13',dashboard.session.id,at('08:05:00'));
  assert.equal(dashboard.counts.present,2);assert.equal(dashboard.unmatched.length,0);
  assert.equal((await db.query('SELECT entered_name FROM attendance_attempts WHERE id=$1',[a.id])).rows[0].entered_name,'Trần Thị Binh');
});
test('Sáng/chiều độc lập, sáng muộn vẫn nhận, trùng thiết bị cảnh báo cho cả hai',async()=>{
  const day='2026-10-14';
  await Promise.all(['Nguyễn Văn An','Trần Thị Bình'].map(name=>store.submit(db,c.id,payload(name,'DEV-SHARED'),new Date(`${day}T08:25:00+07:00`))));
  let d=await store.dashboard(db,c.id,day,null,new Date(`${day}T08:26:00+07:00`));
  assert.equal(d.counts.late,2);assert.equal(d.duplicateGroups.length,1);assert.ok(d.rows.every(r=>r.duplicate_device));
  await store.submit(db,c.id,payload('Nguyễn Văn An','DEV-SHARED'),new Date(`${day}T13:35:00+07:00`));
  d=await store.dashboard(db,c.id,day,null,new Date(`${day}T13:36:00+07:00`));assert.equal(d.session.name,'Chiều');assert.equal(d.counts.present,1);assert.equal(d.counts.pending,1);assert.equal(d.duplicateGroups.length,0);
});
test('Gửi đồng thời cùng request chỉ lưu một lần',async()=>{
  const p=payload('Nguyễn Văn An','DEV-RETRY');
  const results=await Promise.all(Array.from({length:5},()=>store.submit(db,c.id,p,new Date('2026-10-15T07:50:00+07:00'))));
  assert.equal(new Set(results.map(r=>r.id)).size,1);
});
test('Trước giờ mở vẫn lưu vào ngoài phiên; server bỏ qua ngày điện thoại',async()=>{
  const p={...payload(),attendanceDate:'01/01/1999'};
  const r=await store.submit(db,c.id,p,new Date('2026-10-16T06:30:00+07:00'));assert.equal(r.matchState,'outside_session');
  const d=await store.dashboard(db,c.id,'2026-10-16',null,new Date('2026-10-16T07:01:00+07:00'));assert.equal(d.outside.length,1);assert.equal(d.counts.present,0);
});
test('Báo lý do không đòi GPS, chờ duyệt rồi có phép, đến muộn thì chuyển trạng thái',async()=>{
  const day='2026-10-17',p={...payload('Trần Thị Bình'),status:'Vắng có lý do',absentReason:'Đi công tác',latitude:null,longitude:null,accuracy:null};
  const r=await store.submit(db,c.id,p,new Date(`${day}T07:10:00+07:00`));
  let d=await store.dashboard(db,c.id,day,null,new Date(`${day}T08:10:00+07:00`));assert.equal(d.rows.find(r=>r.name==='Trần Thị Bình').status,'absent');
  await store.reviewReason(db,{id:r.id,status:'approved'},actor);
  d=await store.dashboard(db,c.id,day,null,new Date(`${day}T08:11:00+07:00`));assert.equal(d.counts.excused,1);
  await store.submit(db,c.id,payload('Trần Thị Bình'),new Date(`${day}T08:30:00+07:00`));
  d=await store.dashboard(db,c.id,day,null,new Date(`${day}T08:31:00+07:00`));assert.equal(d.counts.late,1);assert.equal(d.counts.excused,0);assert.equal(d.rows.find(r=>r.name==='Trần Thị Bình').reason,'Đi công tác');
});
test('Đổi tọa độ/bán kính lấy từ database, không thay cấu hình bản ghi cũ',async()=>{
  const before=(await db.query('SELECT config_snapshot FROM attendance_attempts LIMIT 1')).rows[0].config_snapshot;
  const future=new Date('2099-10-13T07:30:00+07:00');
  await store.publicConfig(db,c.id,future);
  await store.saveClass(db,{...c,radius:200,apply_current:true},actor);
  const cfg=await store.publicConfig(db,c.id,future);assert.equal(cfg.ALLOWED_RADIUS_METERS,200);
  assert.deepEqual((await db.query('SELECT config_snapshot FROM attendance_attempts LIMIT 1')).rows[0].config_snapshot,before);
  await assert.rejects(()=>store.submit(db,c.id,{...payload(),latitude:0,longitude:0,distance:0},at('07:30:00')),/ngoài bán kính/);
});
test('Đổi lịch có dữ liệu cần xác nhận, phân lại phiên và giữ giờ gửi',async()=>{
  const day='2026-10-18';const r=await store.submit(db,c.id,payload(),new Date(`${day}T08:10:00+07:00`));
  const input={class_id:c.id,day,morning_open:'07:00',morning_deadline:'08:30',afternoon_open:'13:00',afternoon_deadline:'14:00'};
  await assert.rejects(()=>store.saveSchedule(db,input,actor),e=>e.status===409);
  await store.saveSchedule(db,{...input,confirm_changes:true},actor);
  let d=await store.dashboard(db,c.id,day,null,new Date(`${day}T08:20:00+07:00`));assert.equal(d.counts.present,1);assert.equal(d.rows.find(a=>a.name==='Nguyễn Văn An').received_at.toISOString(),r.receivedAt);
  await store.saveSchedule(db,{...input,confirm_changes:true,cancelled:true},actor);
  d=await store.dashboard(db,c.id,day,null,new Date(`${day}T08:20:00+07:00`));assert.equal(d.counts.absent,0);assert.equal(d.counts.cancelled,2);
});
test('Hai người trùng tên không tự đánh dấu cả hai có mặt',async()=>{
  const newClass=await store.saveClass(db,{...c,id:null,name:'Lớp trùng tên',slug:'lop-trung-ten',is_default:false},actor);
  await store.importStudents(db,newClass.id,[{name:'Nguyễn Văn An',unit:'A'},{name:'Nguyễn Văn An',unit:'B'}],'replace',actor);
  const r=await store.submit(db,newClass.id,payload(),at('07:30:00'));assert.equal(r.matchState,'ambiguous');
  const d=await store.dashboard(db,newClass.id,'2026-10-13',null,at('08:05:00'));assert.equal(d.counts.present,0);assert.equal(d.counts.absent,2);assert.equal(d.unmatched.length,1);
});
test('Mẫu CSV/Excel nhận bốn cột, ngày sinh và báo lỗi trước nhập',async()=>{
  const p=await previewImport({paste:'TT\tHọ và tên\tNgày sinh\tĐơn vị\n1\tNguyễn Văn An\t10/12/1976\tPA04\n2\tNguyễn Văn An\t\tB\n3\t\t\tC'});
  assert.equal(p.total,2);assert.equal(p.rows[0].birth_date,'1976-12-10');assert.equal(p.warnings.length,1);assert.equal(p.errors.length,1);
  const ExcelJS=require('exceljs'),w=new ExcelJS.Workbook();w.addWorksheet('Trống');const s=w.addWorksheet('Danh sách');s.addRow(['TT','Họ và tên','Ngày sinh','Đơn vị']);s.addRow([1,'Trần Thị Bình',new Date('1981-03-17T00:00:00Z'),'B']);
  const x=await previewImport({filename:'mau.xlsx',base64:Buffer.from(await w.xlsx.writeBuffer()).toString('base64')});assert.equal(x.sheet,'Danh sách');assert.equal(x.rows[0].birth_date,'1981-03-17');
  assert.ok(csv([['=HYPERLINK("x")']]).includes("'=HYPERLINK"));
});
test('Danh sách đã điểm danh không bị thay thế âm thầm; đồng bộ rõ ràng có nhật ký',async()=>{
  const before=await store.dashboard(db,c.id,'2026-10-13',null,at('08:05:00'));
  await store.importStudents(db,c.id,[{name:'Nguyễn Văn An',unit:'Đơn vị A'},{name:'Trần Thị Bình',unit:'Đơn vị B'},{name:'Lê Văn Cường',unit:'C'}],'replace',actor);
  let d=await store.dashboard(db,c.id,'2026-10-13',before.session.id,at('08:05:00'));assert.equal(d.counts.total,2);
  await store.syncRoster(db,{session_id:before.session.id,note:'Bổ sung học viên thiếu'},actor);
  d=await store.dashboard(db,c.id,'2026-10-13',before.session.id,at('08:05:00'));assert.equal(d.counts.total,3);assert.equal(d.counts.absent,1);
  assert.ok(Number((await db.query("SELECT count(*) FROM audit_logs WHERE action='sync_roster'")).rows[0].count)>0);
});
