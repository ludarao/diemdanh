'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const d=require('../lib/domain');
test('Dò tên giữ dấu và thứ tự, chỉ chuẩn hóa Unicode/khoảng trắng/hoa thường',()=>{
  assert.equal(d.normalizeName('  NGUYỄN   Văn An  '),d.normalizeName('Nguyễn Văn An'));
  assert.equal(d.normalizeName('Nguyễn Văn An'.normalize('NFD')),d.normalizeName('Nguyễn Văn An'));
  assert.notEqual(d.normalizeName('Nguyen Van An'),d.normalizeName('Nguyễn Văn An'));
  assert.notEqual(d.normalizeName('An Nguyễn Văn'),d.normalizeName('Nguyễn Văn An'));
});
test('Ngày sinh PostgreSQL giữ nguyên ngày khi máy chủ ở múi giờ Việt Nam',()=>{
  require('../lib/db');
  assert.equal(require('pg').types.getTypeParser(1082)('1976-12-10'),'1976-12-10');
});
test('Giờ Việt Nam, sáng/chiều và ranh giới nhận muộn',()=>{
  const s=d.scheduleTimes('2026-10-13',{});
  assert.equal(d.selectSession(s,'2026-10-13T06:59:59+07:00'),null);
  assert.equal(d.selectSession(s,'2026-10-13T08:00:00+07:00').name,'Sáng');
  assert.equal(d.selectSession(s,'2026-10-13T13:29:59+07:00').name,'Sáng');
  assert.equal(d.selectSession(s,'2026-10-13T13:30:00+07:00').name,'Chiều');
  assert.equal(d.selectSession(s,'2026-10-13T23:59:59+07:00').name,'Chiều');
  assert.equal(d.selectSession(s,'2026-10-14T00:00:00+07:00'),null);
  assert.equal(d.vnDate(new Date('2026-10-13T18:00:00Z')),'2026-10-14');
  assert.throws(()=>d.scheduleTimes('2026-10-13',{morning_deadline:'14:00'}));
  assert.throws(()=>d.dateOnly('2026-02-30'));
});
test('Server tính GPS, không tin khoảng cách khách gửi',()=>{
  const config={latitude:13.993095,longitude:107.997195,radius:100,max_accuracy:150};
  assert.equal(d.validateGps({latitude:config.latitude,longitude:config.longitude,accuracy:10,distance:99999},config).distance,0);
  assert.throws(()=>d.validateGps({latitude:0,longitude:0,accuracy:10,distance:0},config));
  assert.throws(()=>d.validateGps({latitude:config.latitude,longitude:config.longitude,accuracy:151},config));
  assert.throws(()=>d.validateGps({latitude:null,longitude:null,accuracy:1},config));
});
test('Hạn đúng giờ bao gồm giây cuối, đi muộn sau đó và sĩ số không cộng tên lạ',()=>{
  const session=d.scheduleTimes('2026-10-13',{})[0],roster=[{student_id:'1',name:'A'},{student_id:'2',name:'B'},{student_id:'3',name:'C'}];
  const attempts=[{student_id:'1',kind:'present',device_id:'X',received_at:'2026-10-13T08:00:00+07:00'},
    {student_id:'2',kind:'present',device_id:'Y',received_at:'2026-10-13T08:00:01+07:00'},
    {student_id:null,normalized_name:'unknown',kind:'present',device_id:'Z',received_at:'2026-10-13T07:30:00+07:00'}];
  const r=d.summarize(session,roster,attempts,'2026-10-13T08:01:00+07:00');
  assert.deepEqual(r.counts,{total:3,present:1,late:1,pending:0,excused:0,absent:1,cancelled:0});
  assert.equal(r.unmatched.length,1);assert.equal(r.rows[1].late_minutes,1);
});
