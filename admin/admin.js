import { createClient } from '@supabase/supabase-js';
import { createDashboardUpdater, isRelevantDashboardChange } from './live-refresh.mjs';
const $=selector=>document.querySelector(selector);
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={present:'Đúng giờ',late:'Đi muộn',pending:'Chưa điểm danh',excused:'Vắng có phép',absent:'Vắng không phép',cancelled:'Phiên hủy'};
const reviewLabels={pending:'Chờ duyệt',approved:'Đã duyệt',rejected:'Từ chối'};
const fmt=value=>value?new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—';
const hm=value=>new Date(value).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit'});
const today=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;};
const state={role:'admin',viewers:[],classes:[],classId:'',view:'dashboard',filter:'absent',data:null,students:[],preview:null,newClass:false,loading:false,realtime:null,authTimer:null,dialogAction:null,deletionPreview:null};
const canManage=()=>state.role==='admin';
let refreshPromise=null,noticeTimer,realtimeGeneration=0,lastRealtimeSetup=0;
const updater=createDashboardUpdater({refresh:()=>loadDashboard(true)});
function dashboardVisible(){return !$('#appView').hidden&&state.view==='dashboard'&&!document.hidden;}
function updateRefreshActivity(refreshNow=false){
  if(dashboardVisible()){
    updater.resume({refreshNow});
    if(lastRealtimeSetup&&Date.now()-lastRealtimeSetup>=45*60*1000)setupRealtime();
  }else updater.pause();
}
async function api(action,body=null,params={},retry=true){
  const q=new URLSearchParams({action,...params});
  const response=await fetch(`/api?${q}`,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(response.status===401&&retry&&!['login','refresh','logout'].includes(action)){
    if(!refreshPromise)refreshPromise=api('refresh',{}, {},false).finally(()=>{refreshPromise=null;});
    try{await refreshPromise;return api(action,body,params,false);}catch{showLogin();}
  }
  if(response.status===403&&!canManage()){state.data=null;$('#resultTable').innerHTML='';$('#statCards').innerHTML='';closeDialog();showLogin();}
  if(!response.ok){const error=new Error(data.message||'Không xử lý được yêu cầu.');error.status=response.status;throw error;}
  return data;
}
function notice(message,error=false){$('#notice').textContent=message;$('#notice').className=`notice${error?' error':''}`;$('#notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{$('#notice').hidden=true;},6000);}
async function run(button,fn){if(button)button.disabled=true;try{return await fn();}catch(e){notice(e.message,true);}finally{if(button)button.disabled=false;syncDeleteConfirmation();}}
function showLogin(){
  $('#loginView').hidden=false;$('#appView').hidden=true;updater.pause();updater.setRealtimeConnected(false);clearInterval(state.authTimer);
  realtimeGeneration++;
  if(state.realtime){state.realtime.removeAllChannels();state.realtime=null;}
}
async function boot(){
  const user=await api('me');state.role=user.role||'admin';$('#userEmail').textContent=`${user.email}${canManage()?'':' · Chỉ xem'}`;
  for(const button of document.querySelectorAll('.nav-item'))button.hidden=!canManage()&&button.dataset.view!=='dashboard';
  $('#exportButton').hidden=!canManage();
  state.classes=await api('classes');
  for(const button of document.querySelectorAll('.nav-item'))button.disabled=!state.classes.length&&['dashboard','students','schedule'].includes(button.dataset.view);
  $('#dashboardContent').hidden=!state.classes.length;$('#noAssignedClass').hidden=canManage()||!!state.classes.length;
  if(!state.classes.length){
    state.classId='';state.data=null;state.students=[];state.preview=null;$('#importPreview').hidden=true;
    $('#classSelect').innerHTML='<option value="">Chưa có lớp học</option>';$('#classSelect').disabled=true;
    $('#sessionSelect').innerHTML='';updater.pause();updater.setRealtimeConnected(false);clearInterval(state.authTimer);
    realtimeGeneration++;if(state.realtime){await state.realtime.removeAllChannels();state.realtime=null;}
    $('#loginView').hidden=true;$('#appView').hidden=false;
    await openView(canManage()?'settings':'dashboard');if(canManage())prepareNewClass();return;
  }
  $('#classSelect').disabled=false;
  if(!state.classes.some(c=>c.id===state.classId))state.classId=state.classes[0].id;
  $('#classSelect').innerHTML=state.classes.map(c=>`<option value="${h(c.id)}">${h(c.name)}</option>`).join('');$('#classSelect').value=state.classId;
  $('#loginView').hidden=true;$('#appView').hidden=false;
  if(!canManage())state.view='dashboard';
  await loadDashboard();if(canManage())fillSettings();await setupRealtime();
  if(!canManage())await openView('dashboard');
  updateRefreshActivity();
  clearInterval(state.authTimer);state.authTimer=setInterval(()=>{if(dashboardVisible())setupRealtime();},45*60*1000);
}
async function setupRealtime(){
  const generation=++realtimeGeneration;
  updater.setRealtimeConnected(false);
  try{
    if(state.realtime){await state.realtime.removeAllChannels();state.realtime=null;}
    const cfg=await api('realtime-config');
    if(generation!==realtimeGeneration)return;
    lastRealtimeSetup=Date.now();
    if(cfg.mode==='polling'){$('#connectionState').textContent='● Tự làm mới mỗi 15 giây';$('#connectionState').classList.remove('live');return;}
    const client=createClient(cfg.url,cfg.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    state.realtime=client;await client.realtime.setAuth(cfg.token);
    const channel=client.channel(`attendance-${state.classId}`);
    const changed=payload=>{
      if(isRelevantDashboardChange(payload,{classId:state.classId,day:$('#dashboardDate').value,sessionId:$('#sessionSelect').value}))updater.notifyChange();
    };
    for(const table of ['attendance_attempts','sessions'])channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`class_id=eq.${state.classId}`},changed);
    channel.subscribe(status=>{
      if(generation!==realtimeGeneration)return;
      const live=status==='SUBSCRIBED';$('#connectionState').textContent=live?'● Đang cập nhật trực tiếp':'● Tự làm mới mỗi 15 giây';$('#connectionState').classList.toggle('live',live);
      updater.setRealtimeConnected(live);
    });
  }catch{if(generation!==realtimeGeneration)return;lastRealtimeSetup=Date.now();updater.setRealtimeConnected(false);$('#connectionState').textContent='● Tự làm mới mỗi 15 giây';$('#connectionState').classList.remove('live');}
}
async function loadDashboard(quiet=false){
  if(state.loading){state.reloadRequested=true;return;}
  if(!state.classId||!$('#dashboardDate').value)return;
  state.loading=true;
  try{
    const requestedClass=state.classId,requestedDay=$('#dashboardDate').value,requestedSession=$('#sessionSelect').value;
    const params={class_id:requestedClass,day:requestedDay};if(requestedSession)params.session_id=requestedSession;
    const d=await api('dashboard',null,params);
    if(requestedClass!==state.classId||requestedDay!==$('#dashboardDate').value||requestedSession!==$('#sessionSelect').value){state.reloadRequested=true;return;}
    state.data=d;
    updater.loaded(d.sessions,d.server_time);
    const sessionOptions=d.sessions.map(s=>`<option value="${h(s.id)}">${h(s.name)} · ${hm(s.opens_at)}–${hm(s.deadline_at)}</option>`).join('');
    if($('#sessionSelect').innerHTML!==sessionOptions)$('#sessionSelect').innerHTML=sessionOptions;
    if(d.session)$('#sessionSelect').value=d.session.id;
    $('#sessionHeading').textContent=d.session?`${d.session.name} · ${d.phase}`:'Chưa có phiên cho ngày này';
    $('#sessionDetail').textContent=d.session?`Đúng giờ ${hm(d.session.opens_at)}–${hm(d.session.deadline_at)} · Nhận muộn đến ${hm(d.session.accepts_until)} · Bán kính ${d.session.radius}m${d.roster_status==='empty'?' · Chưa có danh sách học viên: nhập danh sách cho đúng lớp.':''}`:'Tạo lịch trong mục Lịch điểm danh.';
    $('#updatedAt').textContent=`Cập nhật ${fmt(d.server_time)}`;
    const cards=[['total','Sĩ số',''],['present','Đúng giờ','positive'],['late','Đi muộn','warning'],['pending','Chưa điểm danh',''],['excused','Vắng có phép',''],['absent','Vắng không phép','danger']];
    $('#statCards').innerHTML=cards.map(([key,label,color])=>`<div class="stat-card ${color}"><small>${label}</small><strong>${d.counts[key]||0}</strong></div>`).join('');
    renderResults();
  }catch(e){$('#connectionState').textContent='● Mất kết nối · dữ liệu chưa cập nhật';$('#connectionState').classList.remove('live');if(!quiet)notice(e.message,true);}
  finally{state.loading=false;if(state.reloadRequested){state.reloadRequested=false;if(dashboardVisible())queueMicrotask(()=>loadDashboard(true));}}
}
function table(headers,rows,empty='Không có bản ghi trong danh sách này.'){
  return rows.length?`<table><thead><tr>${headers.map(x=>`<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`:`<div class="empty">${h(empty)}</div>`;
}
const badge=(status,label)=>`<span class="badge ${h(status)}">${h(label||labels[status]||reviewLabels[status]||status)}</span>`;
function searchMatches(row){const query=$('#searchInput').value.trim().toLocaleLowerCase('vi');return !query||`${row.name||row.entered_name} ${row.unit||row.entered_unit||''}`.toLocaleLowerCase('vi').includes(query);}
function renderResults(){
  const d=state.data;if(!d)return;
  const titles={absent:'Danh sách vắng',reason:'Vắng / đi muộn có lý do',pending:'Chưa điểm danh',duplicate:'Các nhóm trùng thiết bị',unmatched:'Đã gửi nhưng không khớp danh sách gốc',outside:'Lượt gửi chưa xác định phiên',all:'Tất cả học viên trong phiên'};
  const hints={absent:'Sau hạn đúng giờ, người chưa có mặt được tính vắng. Lượt đến muộn sẽ cập nhật lại.',reason:'Lý do được giữ riêng với kết quả có mặt. Chọn chi tiết để duyệt từng yêu cầu.',pending:'Danh sách này áp dụng trước khi hết giờ đúng giờ.',duplicate:'Cảnh báo để kiểm tra, không tự kết luận gian lận. Không cộng nhóm này vào sĩ số.',unmatched:'Giữ nguyên tên đã nhập. Tên trùng trong danh sách gốc cũng cần bạn đối chiếu.',outside:'Lượt ngoài lịch vẫn được lưu. Bạn có thể gán thủ công vào đúng phiên.',all:'Số liệu dựa trên danh sách gốc của phiên, mỗi học viên chỉ có một kết quả chính.'};
  $('#resultTitle').textContent=titles[state.filter];$('#resultHint').textContent=hints[state.filter];
  if(!canManage())$('#resultHint').textContent={reason:'Lý do và tình trạng duyệt do admin quản lý.',outside:'Các lượt gửi ngoài phiên của lớp.',unmatched:'Các tên chưa khớp danh sách lớp.'}[state.filter]||hints[state.filter];
  if(d.roster_status==='empty')$('#resultHint').textContent='Phiên chưa có danh sách học viên. Lượt gửi vẫn được lưu; sau khi nhập danh sách đúng lớp, hệ thống sẽ tự khớp lại tên.';
  const counts={absent:d.rows.filter(r=>['absent','excused'].includes(r.status)).length,reason:d.rows.filter(r=>r.reason).length+d.unmatched.filter(r=>r.reason).length,pending:d.counts.pending||0,duplicate:d.duplicateGroups.length,unmatched:d.unmatched.length,outside:d.outside.length,all:d.rows.length};
  for(const btn of $('#resultTabs').querySelectorAll('button')){const f=btn.dataset.filter;const names={absent:'Vắng',reason:'Có lý do',pending:'Chưa điểm danh',duplicate:'Trùng thiết bị',unmatched:'Tên không khớp',outside:'Ngoài phiên',all:'Tất cả'};btn.textContent=`${names[f]} (${counts[f]})`;btn.classList.toggle('active',f===state.filter);btn.setAttribute('aria-selected',String(f===state.filter));}
  if(state.filter==='duplicate'){
    const groups=d.duplicateGroups.filter(g=>g.attempts.some(searchMatches));
    $('#resultTable').innerHTML=table(['Thiết bị','Các tên liên quan','Tình trạng','Thao tác'],groups.map(g=>[
      `<strong>${h(g.device_id)}</strong>`,g.attempts.map(a=>`<strong>${h(a.entered_name)}</strong><small>${fmt(a.received_at)}${a.student_id?'':' · Tên chưa khớp'}</small>`).join(''),
      g.resolution?`${badge('approved','Đã xử lý')}<small>${h(g.resolution)}</small>`:badge('duplicate','Cần kiểm tra'),
      canManage()?`<button data-action="device" data-id="${h(g.device_id)}">Ghi chú xử lý</button>`:h(g.resolution?'Đã ghi chú':'Chưa xử lý')
    ]));return;
  }
  if(['unmatched','outside'].includes(state.filter)){
    const rows=(state.filter==='outside'?d.outside:d.unmatched).filter(searchMatches);
    $('#resultTable').innerHTML=table(['Tên đã nhập','Đơn vị','Giờ gửi','Loại / lý do','Thiết bị','Kiểm tra'],rows.map(a=>[
      `<strong>${h(a.entered_name)}</strong><small>${a.match_state==='ambiguous'?'Tên trùng cần đối chiếu':a.match_state==='outside_session'?'Chưa xác định phiên':d.roster_status==='empty'?'Chờ danh sách của phiên':'Không khớp danh sách gốc'}</small>`,h(a.entered_unit),fmt(a.received_at),
      `${badge(a.kind==='present'?'present':'pending',a.kind==='present'?'Có mặt':'Báo vắng / muộn')}<small>${h(a.reason)}</small>`,h(a.device_id),
      canManage()?`<button data-action="reconcile" data-id="${h(a.id)}">Đối chiếu / gán lại</button>`:`<button data-action="attempt-detail" data-id="${h(a.id)}">Chi tiết</button>`
    ]));return;
  }
  let rows=d.rows;
  if(state.filter==='absent')rows=rows.filter(r=>['absent','excused'].includes(r.status));
  if(state.filter==='pending')rows=rows.filter(r=>r.status==='pending');
  if(state.filter==='reason')rows=rows.filter(r=>r.reason);
  rows=rows.filter(searchMatches);
  $('#resultTable').innerHTML=table(['TT','Học viên','Trạng thái','Giờ nhận','Lý do','Thao tác'],rows.map(r=>[
    h(r.ordinal||''),`<strong>${h(r.name)}</strong><small>${h(r.unit)}</small>`,`${badge(r.status)}${r.duplicate_device?'<br>'+badge('duplicate','Trùng thiết bị'):''}`,
    `${fmt(r.received_at)}${r.late_minutes?`<small>Muộn ${r.late_minutes} phút</small>`:''}`,
    `${h(r.reason||'—')}${r.reason_status?'<br>'+badge(r.reason_status,reviewLabels[r.reason_status]):''}`,
    `<div class="table-actions"><button data-action="detail" data-id="${h(r.student_id)}">Chi tiết</button>${canManage()?`<button data-action="manual" data-id="${h(r.student_id)}">Ghi nhận</button>`:''}</div>`
  ]),d.session?'Không có học viên trong nhóm này.':'Chưa có phiên để thống kê.');
  if(state.filter==='reason'){
    const unmatched=d.unmatched.filter(a=>a.reason&&searchMatches(a));
    if(unmatched.length)$('#resultTable').innerHTML+=`<div class="table-heading"><h3>Lý do từ tên chưa khớp (${unmatched.length})</h3></div>`+table(['Tên đã nhập','Lý do','Tình trạng','Thao tác'],unmatched.map(a=>[h(a.entered_name),h(a.reason),badge(a.reason_status,reviewLabels[a.reason_status]),canManage()?`<button data-action="reconcile" data-id="${h(a.id)}">Đối chiếu trước</button>`:`<button data-action="attempt-detail" data-id="${h(a.id)}">Chi tiết</button>`]));
  }
}
async function openView(view){
  if(!canManage()&&view!=='dashboard')return;
  state.view=view;const titles={dashboard:'Tổng quan phiên',students:'Danh sách lớp',schedule:'Lịch điểm danh',settings:'Vị trí & cài đặt',data:'Dữ liệu & xóa lớp',audit:'Nhật ký thay đổi',account:'Tài khoản',viewers:'Tài khoản lớp trưởng'};
  updater.pause();
  $('#viewTitle').textContent=titles[view];for(const el of document.querySelectorAll('.view'))el.hidden=el.id!==`${view}View`;for(const el of document.querySelectorAll('.nav-item'))el.classList.toggle('active',el.dataset.view===view);
  if(view==='dashboard')await loadDashboard();if(view==='students')await loadStudents();if(view==='settings'){if(state.classes.length)fillSettings();else prepareNewClass();}if(view==='data')fillDataManagement();if(view==='schedule'){$('#scheduleDate').value=$('#dashboardDate').value;fillSchedule();}if(view==='audit')await loadAudit();
  if(view==='viewers')await loadViewers();
  updateRefreshActivity();
}
async function loadStudents(){
  state.students=await api('students',null,{class_id:state.classId});$('#studentCount').textContent=`Danh sách gốc · ${state.students.length} học viên`;
  $('#studentTable').innerHTML=table(['TT','Họ và tên','Ngày sinh','Đơn vị','Thao tác'],state.students.map(s=>[h(s.ordinal||''),`<strong>${h(s.name)}</strong>`,h(s.birth_date?String(s.birth_date).slice(0,10):'—'),h(s.unit),`<button data-action="student" data-id="${h(s.id)}">Sửa</button>`]),'Chưa có danh sách. Tải file Excel để nhập học viên.');
}
async function preview(input){
  state.preview=await api('preview-import',input);const p=state.preview;
  $('#importPreview').hidden=false;$('#confirmImport').checked=false;$('#previewHeading').textContent=`${p.sheet}: ${p.total} học viên`;
  $('#previewMessages').innerHTML=[...p.errors,...p.warnings].map(m=>`<li>${h(m)}</li>`).join('');
  $('#previewTable').innerHTML=table(p.headers,p.rows.map(r=>[h(r.ordinal),h(r.name),h(r.birth_date||''),h(r.unit)]));$('#commitImport').disabled=p.errors.length>0;
}
function fillSettings(){
  state.newClass=false;const c=state.classes.find(c=>c.id===state.classId);if(!c)return;
  const form=$('#settingsForm');for(const el of form.elements){if(!el.name)continue;if(el.type==='checkbox')el.checked=el.name==='apply_current'?false:!!c[el.name];else el.value=c[el.name]??'';}
  $('#attendanceLink').textContent=`Liên kết học viên: ${location.origin}/?class=${c.slug}`;$('#locationInfo').textContent=`Phiên bản vị trí hiện tại: ${c.revision}.`;
}
function fillSchedule(){
  const c=state.classes.find(c=>c.id===state.classId);if(!c)return;const form=$('#scheduleForm');
  const day=$('#scheduleDate').value||today();form.elements.day.value=day;
  let data=c;
  if(state.data?.sessions?.length&&day===$('#dashboardDate').value){const [morning,afternoon]=state.data.sessions;data={morning_open:hm(morning.opens_at),morning_deadline:hm(morning.deadline_at),afternoon_open:hm(afternoon.opens_at),afternoon_deadline:hm(afternoon.deadline_at)};form.elements.cancelled.checked=morning.state==='cancelled';}
  else form.elements.cancelled.checked=false;
  for(const name of ['morning_open','morning_deadline','afternoon_open','afternoon_deadline'])form.elements[name].value=data[name];
}
async function loadAudit(){
  const rows=await api('audit',null,state.classId?{class_id:state.classId}:{});
  const names={import_students:'Nhập danh sách',save_class:'Sửa cài đặt lớp',save_schedule:'Sửa lịch ngày',reconcile:'Đối chiếu tên / phiên',review_reason:'Duyệt lý do',resolve_device:'Xử lý trùng thiết bị',save_student:'Sửa học viên',sync_roster:'Đồng bộ danh sách phiên',manual_attendance:'Ghi nhận thủ công',repair_empty_roster:'Khôi phục danh sách phiên rỗng','clear-all':'Xóa toàn bộ dữ liệu','clear-class-attendance':'Xóa kết quả điểm danh của lớp','delete-class':'Xóa lớp học',viewer_create:'Cấp tài khoản lớp trưởng',viewer_assign:'Giao / đổi lớp trưởng',
    'viewer_set-enabled':'Khóa / mở tài khoản lớp trưởng','viewer_reset-password':'Cấp lại mật khẩu lớp trưởng'};
  $('#auditTable').innerHTML=table(['Thời điểm','Người thực hiện','Thao tác','Chi tiết'],rows.map(a=>[fmt(a.created_at),h(a.email||'Hệ thống'),h(names[a.action]||a.action),`<details><summary>Xem thay đổi</summary><pre>${h(JSON.stringify(a.details,null,2))}</pre></details>`]));
}
async function loadViewers(){
  state.viewers=await api('viewers');
  $('#createViewerButton').disabled=!state.classes.length;
  $('#viewerAccounts').innerHTML=table(['Email','Lớp được giao','Trạng thái','Thao tác'],state.viewers.map(v=>[
    h(v.email),v.classes.map(c=>h(c.name)).join(' · ')||'Chưa được giao lớp',v.enabled?'Đang hoạt động':'Đã khóa',
    `<div class="table-actions"><button data-viewer="assign" data-id="${h(v.user_id)}">Giao / đổi lớp</button><button data-viewer="set-enabled" data-id="${h(v.user_id)}">${v.enabled?'Khóa tài khoản':'Mở khóa'}</button><button data-viewer="reset-password" data-id="${h(v.user_id)}">Cấp lại mật khẩu</button></div>`
  ]),'Chưa có tài khoản lớp trưởng.');
}
function viewerClassOptions(selected=''){return state.classes.map(c=>`<option value="${h(c.id)}" ${c.id===selected?'selected':''}>${h(c.name)}</option>`).join('');}
function viewerDialog(operation,id=null){
  if(!canManage())return;
  const v=state.viewers.find(v=>v.user_id===id);
  if(operation!=='create'&&!v)return;
  let body,title;
  if(operation==='create'){
    if(!state.classes.length){notice('Tạo lớp học trước khi cấp tài khoản.',true);return;}
    title='Cấp tài khoản lớp trưởng';
    body=`<p class="muted">Bạn tự cung cấp email/mật khẩu cho lớp trưởng. Ứng dụng không gửi email.</p><label>Email<input type="email" name="email" autocomplete="off" required></label><label>Mật khẩu được cấp<input type="password" name="password" minlength="12" maxlength="1024" autocomplete="new-password" required></label><label>Lớp được xem<select name="class_id">${viewerClassOptions(state.classId)}</select></label>`;
  }else if(operation==='assign'){
    title=`Giao lớp · ${v.email}`;body=`<label>Lớp được xem<select name="class_id"><option value="">Không giao lớp — thu hồi quyền xem</option>${viewerClassOptions(v.classes[0]?.id)}</select></label><p class="muted">Thay thế quyền xem hiện tại. Tài khoản không xem được các lớp khác.</p>`;
  }else if(operation==='set-enabled'){
    title=`${v.enabled?'Khóa':'Mở khóa'} · ${v.email}`;body=`<p>${v.enabled?'Tài khoản sẽ bị chặn ở yêu cầu tiếp theo; dữ liệu lớp được giữ.':'Cho phép tài khoản đăng nhập và xem lớp được giao.'}</p>`;
  }else{
    title=`Cấp lại mật khẩu · ${v.email}`;body='<label>Mật khẩu mới được cấp<input type="password" name="password" minlength="12" maxlength="1024" autocomplete="new-password" required></label><p class="muted">Tự chuyển mật khẩu mới cho lớp trưởng. Nếu cần chặn truy cập ngay, khóa tài khoản trước.</p>';
  }
  openDialog(title,body,async values=>{
    await api('save-viewer',{...values,operation,...(id?{user_id:id}:{}),...(operation==='set-enabled'?{enabled:!v.enabled}:{})});
    closeDialog();await loadViewers();notice('Đã cập nhật tài khoản lớp trưởng.');return {handled:true};
  });
}
function openDialog(title,body,action,button='Lưu'){$('#dialogTitle').textContent=title;$('#dialogBody').innerHTML=body;state.dialogAction=action;state.deletionPreview=null;$('#confirmDialog').textContent=button;$('#confirmDialog').hidden=!action;$('#confirmDialog').disabled=false;$('#confirmDialog').className='primary';if(!$('#actionDialog').open)$('#actionDialog').showModal();}
function closeDialog(){$('#actionDialog').close();state.dialogAction=null;state.deletionPreview=null;}
function prepareNewClass(){
  state.newClass=true;$('#settingsForm').reset();const f=$('#settingsForm').elements;
  for(const [k,v] of Object.entries({latitude:13.993095,longitude:107.997195,radius:100,max_accuracy:150,morning_open:'07:00',morning_deadline:'08:00',afternoon_open:'13:30',afternoon_deadline:'14:00'}))f[k].value=v;
  f.auto_daily.checked=true;f.is_default.checked=!state.classes.length;
  $('#attendanceLink').textContent=state.classes.length?'Nhập tên và mã liên kết lớp mới rồi lưu.':'Chưa có lớp học. Nhập thông tin và lưu để tạo lớp đầu tiên.';
  $('#locationInfo').textContent='';
}
function fillDataManagement(){
  const c=state.classes.find(c=>c.id===state.classId);
  $('#deleteClassLabel').textContent=c?`${c.name} · mã liên kết ${c.slug}`:'Chưa có lớp học. Tạo lớp trong Vị trí & cài đặt.';
  $('#clearClassAttendanceButton').disabled=!c;$('#deleteClassButton').disabled=!c;
}
function syncDeleteConfirmation(){
  if(!state.deletionPreview||!state.dialogAction)return;
  $('#confirmDialog').disabled=$('#deleteConfirmation').value!==state.deletionPreview.confirmation_phrase||!$('#acknowledgeDelete').checked;
}
async function openDeletionDialog(operation){
  const params={operation};if(operation!=='clear-all')params.class_id=state.classId;
  const p=await api('deletion-preview',null,params);
  const labels={classes:'Lớp học',students:'Học viên (kể cả đã ngừng sử dụng)',sessions:'Phiên điểm danh',roster_entries:'Dòng danh sách phiên',attendance_attempts:'Lượt điểm danh / báo lý do',attempts_with_reason:'Trong đó có lý do',device_notes:'Ghi chú xử lý trùng thiết bị',audit_logs:'Nhật ký cũ',class_permissions:'Quyền xem lớp của lớp trưởng'};
  openDialog(p.title,`<p class="error">Dữ liệu bị xóa vĩnh viễn khỏi ứng dụng.</p>${table(['Dữ liệu sẽ xóa','Số lượng'],Object.entries(p.will_delete).map(([key,count])=>[h(labels[key]),h(count)]))}<p class="muted">${h(p.retained)}</p><label class="checkbox"><input type="checkbox" id="acknowledgeDelete" name="acknowledged">Tôi đã kiểm tra phạm vi và hiểu dữ liệu bị xóa</label><label>Nhập chính xác: <strong>${h(p.confirmation_phrase)}</strong><input id="deleteConfirmation" name="confirmation" autocomplete="off" required></label>`,async values=>{
    try{
      await api('delete-data',{operation:p.operation,class_id:p.class_id,preview_hash:p.preview_hash,confirmation:values.confirmation,acknowledged:values.acknowledged==='on'});
    }catch(e){if(e.status===409)await openDeletionDialog(operation);throw e;}
    closeDialog();state.data=null;state.preview=null;$('#sessionSelect').innerHTML='';
    await boot();await openView(state.classes.length?'data':'settings');
    notice(operation==='clear-class-attendance'?'Đã xóa kết quả điểm danh của lớp; danh sách học viên và lịch được giữ.':operation==='delete-class'?'Đã xóa lớp và dữ liệu liên quan.':'Đã xóa toàn bộ dữ liệu lớp học. Bạn có thể tạo lớp mới.');
    return {handled:true};
  },'Xác nhận xóa');
  state.deletionPreview=p;$('#confirmDialog').className='danger';syncDeleteConfirmation();
  $('#deleteConfirmation').addEventListener('input',syncDeleteConfirmation);$('#acknowledgeDelete').addEventListener('change',syncDeleteConfirmation);
}
function recordBy(id){return [...(state.data?.unmatched||[]),...(state.data?.outside||[]),...(state.data?.rows||[]).flatMap(r=>r.history)].find(a=>a.id===id);}
async function actionClick(event){
  const btn=event.target.closest('[data-action]');if(!btn)return;const id=btn.dataset.id,action=btn.dataset.action;
  if(!canManage()&&!['detail','attempt-detail'].includes(action))return;
  if(action==='attempt-detail'){const a=recordBy(id);if(!a)return;openDialog(`Lượt gửi · ${a.entered_name}`,`<p>${h(a.entered_unit)}</p><p>${fmt(a.received_at)}</p><p>${h(a.reason||'Không có lý do')}</p><p>${h(a.device_id)}</p>${a.reason?badge(a.reason_status,reviewLabels[a.reason_status]):''}`,null);return;}
  if(action==='student'){editStudent(state.students.find(s=>s.id===id));return;}
  if(action==='device'){
    const g=state.data.duplicateGroups.find(g=>g.device_id===id);
    openDialog('Xử lý cảnh báo thiết bị',`<p>${h(g.device_id)}</p><p>${g.attempts.map(a=>h(a.entered_name)).join(' · ')}</p><label>Ghi chú xác minh<textarea name="note" required rows="4">${h(g.resolution||'')}</textarea></label>`,async values=>{await api('resolve-device',{session_id:state.data.session.id,device_id:id,note:values.note});});return;
  }
  if(action==='reconcile'){
    const a=recordBy(id),sessions=state.data.sessions;
    if(!sessions.length){notice('Tạo lịch ngày này trước khi đối chiếu.',true);return;}
    const target=a.session_id||state.data.session?.id||sessions[0].id;
    const d=await api('dashboard',null,{class_id:state.classId,day:$('#dashboardDate').value,session_id:target});
    const options=d.rows.map(r=>`<option value="${h(r.student_id)}">${h(r.name)} · ${h(r.unit)}</option>`).join('');
    openDialog('Đối chiếu lượt gửi',`<div class="history"><strong>${h(a.entered_name)}</strong><p>${h(a.entered_unit)}</p><small>${fmt(a.received_at)} · ${h(a.device_id)}</small></div><label>Phiên<select name="session_id" id="reconcileSession">${sessions.map(s=>`<option value="${h(s.id)}" ${s.id===target?'selected':''}>${h(s.name)}</option>`).join('')}</select></label><label>Học viên gốc<select name="student_id" id="reconcileStudent"><option value="">Người ngoài danh sách — không liên kết học viên</option>${options}</select></label><label>Lý do đối chiếu<textarea name="note" required rows="3"></textarea></label>`,async values=>{await api('reconcile',{attempt_id:id,...values});});
    $('#reconcileSession').addEventListener('change',event=>run(null,async()=>{const d=await api('dashboard',null,{class_id:state.classId,day:$('#dashboardDate').value,session_id:event.target.value});$('#reconcileStudent').innerHTML='<option value="">Người ngoài danh sách — không liên kết học viên</option>'+d.rows.map(r=>`<option value="${h(r.student_id)}">${h(r.name)} · ${h(r.unit)}</option>`).join('');}));return;
  }
  if(action==='detail'){
    const r=state.data.rows.find(r=>r.student_id===id);
    openDialog(`Lịch sử · ${r.name}`,`<p>${h(r.unit)}</p>${r.history.length?r.history.map(a=>`<div class="history"><strong>${h(a.entered_name)} · ${a.kind==='present'?'Có mặt':'Báo vắng / muộn'}</strong><small>${fmt(a.received_at)} · ${h(a.device_id)}</small><p>${h(a.reason||'Không có lý do')}</p>${a.reason?`${badge(a.reason_status,reviewLabels[a.reason_status])}${canManage()?` <button type="button" data-review="approved" data-id="${h(a.id)}">Duyệt</button> <button type="button" data-review="rejected" data-id="${h(a.id)}">Từ chối</button>`:''}`:''}<small>Khoảng cách ${a.distance==null?'—':Math.round(a.distance)+'m'} · Sai số ${a.accuracy==null?'—':a.accuracy+'m'}</small></div>`).join(''):'<p>Chưa có lượt gửi.</p>'}`,null);
    for(const button of $('#dialogBody').querySelectorAll('[data-review]'))button.addEventListener('click',()=>run(button,async()=>{await api('review-reason',{id:button.dataset.id,status:button.dataset.review});closeDialog();await loadDashboard();notice('Đã cập nhật tình trạng duyệt.');}));return;
  }
  if(action==='manual'){
    const r=state.data.rows.find(r=>r.student_id===id),session=state.data.session;
    const time=`${$('#dashboardDate').value}T${hm(session.deadline_at)}`;
    openDialog(`Ghi nhận thủ công · ${r.name}`,`<label>Loại ghi nhận<select name="kind"><option value="present">Có mặt (tính đúng giờ/muộn theo giờ nhập)</option><option value="reason">Vắng có phép</option></select></label><label>Thời điểm thực tế (giờ Việt Nam)<input type="datetime-local" name="at" required value="${h(time)}"></label><label>Lý do ghi nhận thủ công<textarea name="note" required rows="3"></textarea></label>`,async values=>{await api('manual-attendance',{session_id:session.id,student_id:id,kind:values.kind,note:values.note,received_at:new Date(`${values.at}:00+07:00`).toISOString()});});
  }
}
function editStudent(s=null){
  openDialog(s?'Sửa học viên':'Thêm học viên',`<label>TT<input type="number" name="ordinal" min="1" value="${h(s?.ordinal||'')}"></label><label>Họ và tên<input name="name" required value="${h(s?.name||'')}"></label><label>Ngày sinh<input type="date" name="birth_date" value="${h(s?.birth_date?String(s.birth_date).slice(0,10):'')}"></label><label>Đơn vị<input name="unit" value="${h(s?.unit||'')}"></label>${s?'<label class="checkbox"><input name="inactive" type="checkbox">Ngừng sử dụng trong danh sách hiện hành</label>':''}<p class="muted">Sửa danh sách gốc không tự sửa danh sách của phiên đã có lượt gửi. Dùng Đồng bộ nếu muốn áp dụng cho phiên.</p>`,async values=>{await api('save-student',{class_id:state.classId,id:s?.id,...values,active:!values.inactive});await loadStudents();});
}
$('#createViewerButton').addEventListener('click',()=>viewerDialog('create'));
$('#viewerAccounts').addEventListener('click',event=>{const b=event.target.closest('[data-viewer]');if(b)viewerDialog(b.dataset.viewer,b.dataset.id);});
$('#refreshPermissions').addEventListener('click',()=>run($('#refreshPermissions'),()=>boot()));
$('#loginForm').addEventListener('submit',event=>{event.preventDefault();run(event.submitter,async()=>{$('#loginError').textContent='';try{await api('login',Object.fromEntries(new FormData(event.target)),{},false);event.target.elements.password.value='';await boot();}catch(e){$('#loginError').textContent=e.message;}});});
$('#logoutButton').addEventListener('click',()=>run($('#logoutButton'),async()=>{await api('logout',{});showLogin();}));
for(const btn of document.querySelectorAll('.nav-item'))btn.addEventListener('click',()=>run(null,()=>openView(btn.dataset.view)));
$('#classSelect').addEventListener('change',event=>run(null,async()=>{state.classId=event.target.value;state.data=null;state.preview=null;$('#importPreview').hidden=true;$('#sessionSelect').innerHTML='';await loadDashboard();await setupRealtime();await openView(state.view);}));
$('#dashboardDate').addEventListener('change',()=>{$('#sessionSelect').innerHTML='';run(null,()=>loadDashboard());});
$('#sessionSelect').addEventListener('change',()=>run(null,()=>loadDashboard()));
$('#refreshDashboard').addEventListener('click',()=>run($('#refreshDashboard'),()=>loadDashboard()));
$('#searchInput').addEventListener('input',renderResults);
$('#resultTabs').addEventListener('click',event=>{const button=event.target.closest('[data-filter]');if(button){state.filter=button.dataset.filter;renderResults();}});
$('#resultTable').addEventListener('click',event=>run(null,()=>actionClick(event)));$('#studentTable').addEventListener('click',event=>run(null,()=>actionClick(event)));
$('#closeDialog').addEventListener('click',closeDialog);$('#cancelDialog').addEventListener('click',closeDialog);
$('#actionForm').addEventListener('submit',event=>{event.preventDefault();run(event.submitter,async()=>{const action=state.dialogAction;if(!action)return;const values=Object.fromEntries(new FormData(event.target));const result=await action(values);if(result?.handled)return;closeDialog();await loadDashboard();notice('Đã lưu thay đổi.');});});
$('#addStudentButton').addEventListener('click',()=>editStudent());
$('#templateButton').addEventListener('click',()=>{location.href='/api?action=template';});
$('#exportButton').addEventListener('click',()=>{location.href=`/api?${new URLSearchParams({action:'export',class_id:state.classId,day:$('#dashboardDate').value,session_id:$('#sessionSelect').value})}`;});
$('#rosterFile').addEventListener('change',event=>run(null,async()=>{const file=event.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw new Error('File tối đa 2 MB.');const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Không đọc được file.'));reader.readAsDataURL(file);});await preview({filename:file.name,base64});}));
$('#previewPaste').addEventListener('click',()=>run($('#previewPaste'),()=>preview({paste:$('#rosterPaste').value})));
$('#commitImport').addEventListener('click',()=>run($('#commitImport'),async()=>{if(!state.preview||state.preview.errors.length)throw new Error('Kiểm tra lỗi nhập danh sách.');if(!$('#confirmImport').checked)throw new Error('Đánh dấu xác nhận sau khi kiểm tra danh sách.');const result=await api('import',{class_id:state.classId,rows:state.preview.rows,mode:$('#importMode').value});$('#importPreview').hidden=true;state.preview=null;await loadStudents();await loadDashboard();notice(`Đã nhập ${result.imported} học viên.${result.repaired_sessions ? ` Đã khôi phục ${result.repaired_sessions} phiên rỗng và khớp lại ${result.linked_attempts} lượt gửi.` : " Phiên đã có danh sách giữ lịch sử; dùng Đồng bộ nếu cần cập nhật."}`);}));
$('#syncRosterButton').addEventListener('click',()=>{if(!state.data?.session){notice('Chọn một phiên trong Tổng quan trước.',true);return;}const s=state.data.session;openDialog(`Đồng bộ danh sách · ${s.name}`,`<p>Áp dụng danh sách gốc hiện hành cho phiên ${h(s.name)} ngày ${h($('#dashboardDate').value)}. Tên khớp chính xác và duy nhất sẽ được liên kết lại; tên gần giống vẫn cần kiểm tra. Học viên ngừng sử dụng đã có lượt gửi vẫn giữ trong lịch sử.</p><label>Lý do đồng bộ<textarea name="note" required rows="3"></textarea></label>`,async values=>{await api('sync-roster',{session_id:s.id,note:values.note});});});
$('#scheduleDate').addEventListener('change',()=>run(null,async()=>{$('#dashboardDate').value=$('#scheduleDate').value;$('#sessionSelect').innerHTML='';await loadDashboard();fillSchedule();}));
$('#scheduleForm').addEventListener('submit',event=>{event.preventDefault();run(event.submitter,async()=>{const form=event.target,input={...Object.fromEntries(new FormData(form)),class_id:state.classId,cancelled:form.elements.cancelled.checked};try{await api('save-schedule',input);}catch(e){if(e.status!==409)throw e;openDialog('Xác nhận đổi lịch đã có dữ liệu',`<p>${h(e.message)}</p><p>Giờ nhận gốc được giữ. Các lượt gửi sẽ được phân lại theo lịch mới và kết quả đi muộn được tính lại; thao tác có nhật ký.</p>`,async()=>{await api('save-schedule',{...input,confirm_changes:true});},'Xác nhận đổi lịch');return;}$('#dashboardDate').value=input.day;$('#sessionSelect').innerHTML='';await loadDashboard();notice('Đã lưu lịch ngày này.');});});
$('#settingsForm').addEventListener('submit',event=>{event.preventDefault();run(event.submitter,async()=>{const form=event.target;const data=Object.fromEntries(new FormData(form));for(const key of ['is_default','auto_daily','apply_current'])data[key]=form.elements[key].checked;if(!state.newClass)data.id=state.classId;const c=await api('save-class',data);state.classId=c.id;await boot();await openView('settings');notice('Đã lưu cài đặt. Phiên hiện có giữ lịch giờ; dùng Lịch điểm danh để chỉnh riêng ngày.');});});
$('#newClassButton').addEventListener('click',prepareNewClass);
$('#clearClassAttendanceButton').addEventListener('click',()=>run($('#clearClassAttendanceButton'),()=>openDeletionDialog('clear-class-attendance')));
$('#deleteClassButton').addEventListener('click',()=>run($('#deleteClassButton'),()=>openDeletionDialog('delete-class')));
$('#clearAllDataButton').addEventListener('click',()=>run($('#clearAllDataButton'),()=>openDeletionDialog('clear-all')));
$('#locateClassButton').addEventListener('click',()=>{if(!navigator.geolocation){notice('Trình duyệt không hỗ trợ GPS.',true);return;}$('#locateClassButton').disabled=true;navigator.geolocation.getCurrentPosition(position=>{const f=$('#settingsForm').elements;f.latitude.value=position.coords.latitude;f.longitude.value=position.coords.longitude;$('#locationInfo').textContent=`Sai số GPS ±${Math.round(position.coords.accuracy)}m. Kiểm tra tọa độ rồi bấm Lưu cài đặt.`;$('#locateClassButton').disabled=false;},error=>{$('#locateClassButton').disabled=false;notice(`Không lấy được GPS: ${error.message}`,true);},{enableHighAccuracy:true,timeout:12000,maximumAge:0});});
$('#passwordForm').addEventListener('submit',event=>{event.preventDefault();run(event.submitter,async()=>{const f=event.target.elements;if(f.password.value!==f.confirmation.value)throw new Error('Hai mật khẩu chưa khớp.');await api('change-password',{password:f.password.value});event.target.reset();showLogin();notice('Đã đổi mật khẩu. Vui lòng đăng nhập lại.');});});
document.addEventListener('visibilitychange',()=>updateRefreshActivity(true));
$('#dashboardDate').value=today();$('#scheduleDate').value=today();
boot().catch(error=>{showLogin();if(error.status!==401)$('#loginError').textContent=error.message;});
