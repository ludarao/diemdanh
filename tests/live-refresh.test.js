'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const load=()=>import('../admin/live-refresh.mjs');
function fakeClock(start=0){
  let time=start,id=0;const jobs=new Map();
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  return {now:()=>time,setTimer(fn,delay){const key=++id;jobs.set(key,{at:time+delay,fn});return key;},clearTimer(key){jobs.delete(key);},
    async tick(ms){const end=time+ms;while(true){const next=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;time=next[1].at;jobs.delete(next[0]);next[1].fn();await flush();}time=end;await flush();}}
}
test('Realtime hoạt động chỉ đối chiếu 60 request/giờ thay vì 1440',async()=>{
  const {createDashboardUpdater}=await load(),clock=fakeClock();let calls=0;
  const u=createDashboardUpdater({...clock,refresh:async()=>{calls++;}});
  u.setRealtimeConnected(true);u.resume({refreshNow:false});await clock.tick(3600000);
  assert.equal(calls,60);u.pause();
});
test('Mất Realtime dùng chu kỳ 15 giây và trở lại 60 giây khi kết nối lại',async()=>{
  const {createDashboardUpdater}=await load(),clock=fakeClock();let calls=0;
  const u=createDashboardUpdater({...clock,refresh:async()=>{calls++;}});
  u.resume({refreshNow:false});await clock.tick(60000);assert.equal(calls,4);
  u.setRealtimeConnected(true);await clock.tick(59999);assert.equal(calls,4);await clock.tick(1);assert.equal(calls,5);u.pause();
});
test('Tab ẩn không gọi API do polling, sự kiện Realtime hoặc mốc giờ; quay lại tải một lần',async()=>{
  const {createDashboardUpdater}=await load(),clock=fakeClock(Date.parse('2026-10-13T07:59:30+07:00'));let calls=0;
  const u=createDashboardUpdater({...clock,refresh:async()=>{calls++;}});
  u.loaded([{opens_at:'2026-10-13T07:00:00+07:00',deadline_at:'2026-10-13T08:00:00+07:00',accepts_until:'2026-10-13T13:30:00+07:00'}],new Date(clock.now()).toISOString());
  u.resume({refreshNow:false});u.pause();for(let i=0;i<80;i++)u.notifyChange();await clock.tick(3600000);assert.equal(calls,0);
  u.resume();await clock.tick(0);assert.equal(calls,1);u.pause();
});
test('Gộp 80 sự kiện trong một đợt thành một request, không chạy hai request đồng thời',async()=>{
  const {createDashboardUpdater}=await load(),clock=fakeClock();let calls=0,finish;
  const u=createDashboardUpdater({...clock,refresh:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  u.loaded([],new Date(0).toISOString());u.resume({refreshNow:false});
  for(let i=0;i<80;i++)u.notifyChange();await clock.tick(2000);assert.equal(calls,1);
  for(let i=0;i<80;i++)u.notifyChange();await clock.tick(2000);assert.equal(calls,1);
  finish();await clock.tick(0);await clock.tick(2000);assert.equal(calls,2);u.pause();finish();
});
test('Tự cập nhật khi hết hạn đúng giờ dù không có học viên gửi, dùng đồng hồ server',async()=>{
  const {createDashboardUpdater}=await load(),clock=fakeClock(Date.parse('2026-10-13T06:59:30+07:00'));let calls=0;
  const u=createDashboardUpdater({...clock,refresh:async()=>{calls++;}});
  // Client clock is one hour behind the server.
  u.loaded([{opens_at:'2026-10-13T07:00:00+07:00',deadline_at:'2026-10-13T08:00:00+07:00',accepts_until:'2026-10-13T13:30:00+07:00'}],'2026-10-13T07:59:30+07:00');
  u.setRealtimeConnected(true);u.resume({refreshNow:false});await clock.tick(30000);assert.equal(calls,0);
  await clock.tick(1);assert.equal(calls,1);u.pause();
});
test('Sự kiện lớp khác/ngày khác/phiên khác không gọi lại dashboard đang xem',async()=>{
  const {isRelevantDashboardChange:relevant}=await load(),ctx={classId:'class-a',day:'2026-10-13',sessionId:'morning'};
  const event={table:'attendance_attempts',new:{class_id:'class-a',session_id:'morning',received_at:'2026-10-13T00:20:00Z'}};
  assert.equal(relevant(event,ctx),true);
  assert.equal(relevant({...event,new:{...event.new,class_id:'other'}},ctx),false);
  assert.equal(relevant({...event,new:{...event.new,session_id:'afternoon'}},ctx),false);
  assert.equal(relevant({...event,new:{...event.new,received_at:'2026-10-12T00:20:00Z'}},ctx),false);
  assert.equal(relevant({...event,new:{...event.new,session_id:null}},ctx),true);
  assert.equal(relevant({...event,eventType:'UPDATE',new:{...event.new,session_id:'afternoon'}},ctx),true);
  assert.equal(relevant({table:'sessions',new:{class_id:'class-a',day:'2026-10-13'}},ctx),true);
});
