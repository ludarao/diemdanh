'use strict';
const {requireClassAccess,roleOf}=require('./permissions');
const { createHash } = require('node:crypto');
const { AppError, normalizeName, text, finite, vnDate, dateOnly, scheduleTimes, selectSession, validateGps, summarize } = require('./domain');
const { transaction, audit } = require('./db');
const uuid = value => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || '')) throw new AppError('Mã bản ghi không hợp lệ.');
  return value;
};
async function classBy(db, identifier) {
  const result = identifier ? await db.query('SELECT * FROM classes WHERE slug=$1 OR id::text=$1', [String(identifier)]) : await db.query('SELECT * FROM classes WHERE is_default');
  if (!result.rows[0]) throw new AppError(identifier?'Không tìm thấy nhóm. Kiểm tra liên kết điểm danh.':'Chưa có nhóm điểm danh. Vui lòng liên hệ quản trị viên để tạo nhóm.', 404);
  return result.rows[0];
}
async function copyRoster(client, sessionId, classId) {
  await client.query(`INSERT INTO session_roster(session_id,student_id,ordinal,name,normalized_name,unit)
    SELECT $1,id,ordinal,name,normalized_name,unit FROM students WHERE class_id=$2 AND active ON CONFLICT DO NOTHING`, [sessionId,classId]);
}
async function matchUnlinkedAttempts(client, sessionId) {
  const linked=await client.query(`UPDATE attendance_attempts a SET student_id=r.student_id,match_state='matched'
    FROM session_roster r WHERE a.session_id=$1 AND a.student_id IS NULL AND r.session_id=a.session_id
    AND r.normalized_name=a.normalized_name
    AND (SELECT count(*) FROM session_roster peers WHERE peers.session_id=a.session_id AND peers.normalized_name=a.normalized_name)=1
    RETURNING a.id`,[sessionId]);
  await client.query(`UPDATE attendance_attempts a SET match_state='ambiguous'
    WHERE a.session_id=$1 AND a.student_id IS NULL
    AND (SELECT count(*) FROM session_roster r WHERE r.session_id=a.session_id AND r.normalized_name=a.normalized_name)>1`,[sessionId]);
  return linked.rows.length;
}
// The caller holds a class lock. Only genuinely empty snapshots are repaired;
// populated historical rosters and manually reconciled identities stay intact.
async function hydrateEmptyRosters(client,classId,sessionIds=null,actor=null) {
  const empty=(await client.query(`SELECT s.id FROM sessions s WHERE s.class_id=$1
    AND ($2::uuid[] IS NULL OR s.id=ANY($2::uuid[]))
    AND NOT EXISTS(SELECT 1 FROM session_roster r WHERE r.session_id=s.id)
    AND EXISTS(SELECT 1 FROM students st WHERE st.class_id=s.class_id AND st.active)
    ORDER BY s.id FOR UPDATE`,[classId,sessionIds])).rows;
  let repaired=0,linked=0;
  for(const s of empty){
    if((await client.query('SELECT 1 FROM session_roster WHERE session_id=$1 LIMIT 1',[s.id])).rows.length)continue;
    await copyRoster(client,s.id,classId);
    const matched=await matchUnlinkedAttempts(client,s.id);
    const total=Number((await client.query('SELECT count(*) FROM session_roster WHERE session_id=$1',[s.id])).rows[0].count);
    await audit(client,actor,'repair_empty_roster',classId,{session_id:s.id,students:total,linked_attempts:matched});
    repaired++;linked+=matched;
  }
  return {repaired_sessions:repaired,linked_attempts:linked};
}
async function restoreEmptyRosters(db,classId,sessionIds) {
  if(!sessionIds.length)return;
  const needsRepair=(await db.query(`SELECT 1 FROM sessions s WHERE s.id=ANY($1::uuid[]) AND s.class_id=$2
    AND NOT EXISTS(SELECT 1 FROM session_roster r WHERE r.session_id=s.id)
    AND EXISTS(SELECT 1 FROM students st WHERE st.class_id=s.class_id AND st.active) LIMIT 1`,[sessionIds,classId])).rows.length;
  if(!needsRepair)return;
  await transaction(db,async client=>{
    await client.query('SELECT id FROM classes WHERE id=$1 FOR SHARE',[classId]);
    await hydrateEmptyRosters(client,classId,sessionIds);
  });
}
async function ensureDay(db, c, day) {
  const existing = await db.query('SELECT * FROM sessions WHERE class_id=$1 AND day=$2 ORDER BY opens_at', [c.id,day]);
  if (existing.rows.length) {await restoreEmptyRosters(db,c.id,existing.rows.map(s=>s.id));return existing.rows;}
  if (!c.auto_daily) return existing.rows;
  return transaction(db, async client => {
    const current = await client.query('SELECT * FROM classes WHERE id=$1 FOR SHARE', [c.id]);
    c = current.rows[0];
    if(!c)throw new AppError('Nhóm đã bị xóa. Vui lòng kiểm tra lại liên kết.',404);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`day:${c.id}:${day}`]);
    if (c.auto_daily) for (const t of scheduleTimes(day,c)) {
      const inserted = await client.query(`INSERT INTO sessions(class_id,day,name,opens_at,deadline_at,accepts_until,latitude,longitude,radius,max_accuracy,config_revision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(class_id,day,name) DO NOTHING RETURNING id`,
        [c.id,day,t.name,t.opens_at,t.deadline_at,t.accepts_until,c.latitude,c.longitude,c.radius,c.max_accuracy,c.revision]);
      if (inserted.rows[0]) await copyRoster(client,inserted.rows[0].id,c.id);
    }
    return (await client.query('SELECT * FROM sessions WHERE class_id=$1 AND day=$2 ORDER BY opens_at',[c.id,day])).rows;
  });
}
async function publicConfig(db, identifier, now = new Date()) {
  const c = await classBy(db,identifier);
  const sessions = await ensureDay(db,c,vnDate(now));
  const current = selectSession(sessions,now) || c;
  return { classId:c.id, classSlug:c.slug, CLASSROOM_LAT:Number(current.latitude), CLASSROOM_LNG:Number(current.longitude),
    ALLOWED_RADIUS_METERS:Number(current.radius), MAX_GPS_ACCURACY_METERS:Number(current.max_accuracy) };
}
async function submit(db, identifier, input, now = new Date()) {
  const c = await classBy(db,identifier);
  const name = text(input.hoTen,'Họ và tên'), unit = text(input.donVi,'Đơn vị',500);
  const device = text(input.deviceId,'Mã thiết bị',150), request = uuid(input.requestId);
  if (!['Có mặt','Vắng có lý do'].includes(input.status)) throw new AppError('Trạng thái không hợp lệ.');
  const kind = input.status === 'Có mặt' ? 'present' : 'reason';
  const reason = text(input.absentReason || '', 'Lý do', 3000, kind === 'reason');
  const payloadHash = createHash('sha256').update(JSON.stringify({ name,unit,device,kind,reason,latitude:input.latitude,longitude:input.longitude,accuracy:input.accuracy,declaredDate:input.attendanceDate })).digest('hex');
  const previous = await db.query('SELECT * FROM attendance_attempts WHERE class_id=$1 AND request_id=$2',[c.id,request]);
  if (previous.rows[0]) {
    if (previous.rows[0].payload_hash !== payloadHash) throw new AppError('Mã gửi đã dùng cho dữ liệu khác. Hãy gửi lại.',409);
    return receipt(previous.rows[0]);
  }
  await ensureDay(db,c,vnDate(now));
  return transaction(db, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`request:${c.id}:${request}`]);
    const retry = await client.query('SELECT * FROM attendance_attempts WHERE class_id=$1 AND request_id=$2',[c.id,request]);
    if (retry.rows[0]) {
      if (retry.rows[0].payload_hash !== payloadHash) throw new AppError('Mã gửi đã dùng cho dữ liệu khác.',409);
      return receipt(retry.rows[0]);
    }
    const settings = (await client.query('SELECT * FROM classes WHERE id=$1 FOR SHARE',[c.id])).rows[0];
    const daySessions = (await client.query('SELECT * FROM sessions WHERE class_id=$1 AND day=$2 ORDER BY opens_at FOR SHARE',[c.id,vnDate(now)])).rows;
    const session = selectSession(daySessions,now), cfg = session || settings;
    let gps = {latitude:null,longitude:null,accuracy:null,distance:null};
    if (kind === 'present') gps = validateGps(input,cfg);
    else if (input.latitude != null && input.longitude != null && input.accuracy != null) {
      gps.latitude = finite(input.latitude,'Vĩ độ',-90,90); gps.longitude = finite(input.longitude,'Kinh độ',-180,180);
      gps.accuracy = finite(input.accuracy,'Sai số GPS',0,100000);
    }
    const matches = session ? (await client.query('SELECT student_id FROM session_roster WHERE session_id=$1 AND normalized_name=$2',[session.id,normalizeName(name)])).rows : [];
    const match = !session ? 'outside_session' : matches.length === 1 ? 'matched' : matches.length ? 'ambiguous' : 'unmatched';
    // Serialize shared-device writes in one session, while unrelated devices write independently.
    if (session && kind === 'present') await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`device:${session.id}:${device}`]);
    const record = (await client.query(`INSERT INTO attendance_attempts(class_id,request_id,payload_hash,session_id,student_id,entered_name,normalized_name,
      entered_unit,declared_date,received_at,kind,match_state,reason,reason_status,device_id,user_agent,latitude,longitude,accuracy,distance,config_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [c.id,request,payloadHash,session?.id || null,match === 'matched' ? matches[0].student_id : null,name,normalizeName(name),unit,
        String(input.attendanceDate || '').slice(0,40),now,kind,match,reason,reason ? 'pending' : null,device,String(input.userAgent || '').slice(0,1000),
        gps.latitude,gps.longitude,gps.accuracy,gps.distance,JSON.stringify({latitude:cfg.latitude,longitude:cfg.longitude,radius:cfg.radius,max_accuracy:cfg.max_accuracy,revision:cfg.config_revision || cfg.revision})])).rows[0];
    return receipt(record);
  });
}
function receipt(a) {
  return { status:'success', id:a.id, receivedAt:new Date(a.received_at).toISOString(), matchState:a.match_state,
    message:'Dữ liệu đã được lưu vào hệ thống.', receipt:{name:a.entered_name,donVi:a.entered_unit,status:a.kind === 'present' ? 'Có mặt' : 'Vắng có lý do',reason:a.reason,deviceId:a.device_id} };
}
async function dashboard(db, classId, day, sessionId, now = new Date()) {
  const c = await classBy(db,classId); dateOnly(day);
  let sessions = (await db.query('SELECT * FROM sessions WHERE class_id=$1 AND day=$2 ORDER BY opens_at',[c.id,day])).rows;
  if (!sessions.length && day === vnDate(now)) sessions = await ensureDay(db,c,day);
  const session = sessions.find(s => s.id === sessionId) || selectSession(sessions,now) || sessions[0];
  const outside = (await db.query(`SELECT * FROM attendance_attempts WHERE class_id=$1 AND session_id IS NULL
    AND received_at >= $2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
    AND received_at < ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' ORDER BY received_at`,[c.id,day])).rows;
  if (!session) return { class:c,sessions,session:null,rows:[],unmatched:[],outside,duplicateGroups:[],counts:{total:0},server_time:now.toISOString() };
  await restoreEmptyRosters(db,c.id,[session.id]);
  // One database snapshot keeps roster and attempts consistent during imports/reconciliation.
  const result = await transaction(db,async client => {
    const currentSession=(await client.query('SELECT * FROM sessions WHERE id=$1',[session.id])).rows[0];
    if(!currentSession)throw new AppError('Phiên đã bị xóa. Vui lòng tải lại danh sách nhóm.',404);
    const roster = (await client.query('SELECT * FROM session_roster WHERE session_id=$1 ORDER BY ordinal NULLS LAST,name',[session.id])).rows;
    const attempts = (await client.query(`SELECT a.*,d.note AS device_resolution FROM attendance_attempts a
      LEFT JOIN device_resolutions d ON d.session_id=a.session_id AND d.device_id=a.device_id WHERE a.session_id=$1 ORDER BY a.received_at`,[session.id])).rows;
    return {...summarize(currentSession,roster,attempts,now),roster_status:roster.length?'ready':'empty'};
  },{isolation:'repeatable read'});
  return { ...result,class:c,sessions,outside };
}
async function listStudents(db,classId) {
  await classBy(db,classId);
  return (await db.query('SELECT * FROM students WHERE class_id=$1 AND active ORDER BY ordinal NULLS LAST,name',[classId])).rows;
}
async function importStudents(db,classId,rows,mode,actor) {
  if (!['append','replace'].includes(mode)) throw new AppError('Chọn cách nhập danh sách.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 3000) throw new AppError('Danh sách cần có từ 1 đến 3000 người tham gia.');
  const clean = rows.map((r,i) => ({name:text(r.name,`Họ tên dòng ${i+1}`),unit:text(r.unit || '','Đơn vị',500,false),
    ordinal:r.ordinal == null ? i+1 : finite(r.ordinal,'TT',1,1000000),birth_date:r.birth_date ? dateOnly(r.birth_date) : null}));
  return transaction(db,async client => {
    await requireClassAccess(client,actor,classId,'can_import_roster',{lock:true});
    const c = (await client.query('SELECT * FROM classes WHERE id=$1 FOR UPDATE',[uuid(classId)])).rows[0];
    if (!c) throw new AppError('Không tìm thấy nhóm.',404);
    const old = (await client.query('SELECT * FROM students WHERE class_id=$1 AND active',[classId])).rows;
    if (mode === 'replace') await client.query('UPDATE students SET active=false WHERE class_id=$1',[classId]);
    const used = new Set();
    for (const r of clean) {
      const candidates = old.filter(o => o.normalized_name === normalizeName(r.name) && o.unit === r.unit && !used.has(o.id));
      // Reuse only an unambiguous existing identity during replacement; never silently merge duplicate names.
      if (mode === 'replace' && candidates.length === 1) {
        used.add(candidates[0].id);
        await client.query('UPDATE students SET active=true,name=$2,normalized_name=$3,unit=$4,ordinal=$5,birth_date=$6 WHERE id=$1',[candidates[0].id,r.name,normalizeName(r.name),r.unit,r.ordinal,r.birth_date]);
      } else await client.query('INSERT INTO students(class_id,name,normalized_name,unit,ordinal,birth_date) VALUES($1,$2,$3,$4,$5,$6)',[classId,r.name,normalizeName(r.name),r.unit,r.ordinal,r.birth_date]);
    }
    // Empty sessions are safe to refresh after the first import. Existing attendance snapshots stay intact.
    const empty = (await client.query(`SELECT s.id FROM sessions s WHERE s.class_id=$1 AND s.accepts_until>now()
      AND NOT EXISTS(SELECT 1 FROM attendance_attempts a WHERE a.session_id=s.id) FOR UPDATE`,[classId])).rows;
    for (const s of empty) { await client.query('DELETE FROM session_roster WHERE session_id=$1',[s.id]); await copyRoster(client,s.id,classId); }
    const repaired=await hydrateEmptyRosters(client,classId,null,actor);
    await audit(client,actor,'import_students',classId,{mode,rows:clean.length,refreshed_sessions:empty.length,...repaired});
    return { imported:clean.length, refreshed_sessions:empty.length,...repaired };
  });
}
async function saveClass(db,input,actor) {
  const name = text(input.name,'Tên nhóm');
  const slug = text(input.slug,'Mã liên kết',100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new AppError('Mã liên kết chỉ dùng chữ không dấu, số và dấu gạch ngang.');
  const cfg = {latitude:finite(input.latitude,'Vĩ độ',-90,90),longitude:finite(input.longitude,'Kinh độ',-180,180),radius:finite(input.radius,'Bán kính',1,100000),max_accuracy:finite(input.max_accuracy,'Sai số GPS',1,100000)};
  scheduleTimes(vnDate(),input);
  return transaction(db,async client => {
    let before = null;
    await client.query('LOCK TABLE classes IN SHARE ROW EXCLUSIVE MODE');
    if (input.id) {
      before = (await client.query('SELECT * FROM classes WHERE id=$1 FOR UPDATE',[uuid(input.id)])).rows[0];
      if (!before) throw new AppError('Không tìm thấy nhóm.',404);
      if (before.is_default && input.is_default !== true) throw new AppError('Hãy đặt một nhóm khác làm mặc định trước khi bỏ mặc định của nhóm này.');
    }
    const firstClass=Number((await client.query('SELECT count(*) FROM classes')).rows[0].count)===0;
    const isDefault=input.is_default===true||firstClass;
    if (isDefault) await client.query('UPDATE classes SET is_default=false WHERE is_default');
    const values = [name,slug,isDefault,input.auto_daily === true,cfg.latitude,cfg.longitude,cfg.radius,cfg.max_accuracy,input.morning_open,input.morning_deadline,input.afternoon_open,input.afternoon_deadline];
    const c = input.id ? (await client.query(`UPDATE classes SET name=$1,slug=$2,is_default=$3,auto_daily=$4,latitude=$5,longitude=$6,radius=$7,max_accuracy=$8,
      morning_open=$9,morning_deadline=$10,afternoon_open=$11,afternoon_deadline=$12,revision=revision+1 WHERE id=$13 RETURNING *`,[...values,input.id])).rows[0]
      : (await client.query(`INSERT INTO classes(name,slug,is_default,auto_daily,latitude,longitude,radius,max_accuracy,morning_open,morning_deadline,afternoon_open,afternoon_deadline)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,values)).rows[0];
    if (input.apply_current === true) await client.query(`UPDATE sessions SET latitude=$2,longitude=$3,radius=$4,max_accuracy=$5,config_revision=$6
      WHERE class_id=$1 AND accepts_until>now() AND state='active'`,[c.id,cfg.latitude,cfg.longitude,cfg.radius,cfg.max_accuracy,c.revision]);
    await audit(client,actor,'save_class',c.id,{before,after:c,apply_current:input.apply_current === true});
    return c;
  });
}
async function saveSchedule(db,input,actor) {
  const allowed=new Set(['class_id','day','morning_open','morning_deadline','afternoon_open','afternoon_deadline','cancelled','confirm_changes']);
  if(Object.keys(input).some(k=>!allowed.has(k)))throw new AppError('Lịch ngày chỉ cho phép thay đổi khung giờ và trạng thái ngày.');
  for(const flag of ['cancelled','confirm_changes'])if(input[flag]!=null&&typeof input[flag]!=='boolean')throw new AppError('Trạng thái ngày và xác nhận phải là giá trị bật/tắt.');
  const day = dateOnly(input.day), classId = uuid(input.class_id), times = scheduleTimes(day,input);
  return transaction(db,async client => {
    const editor=await requireClassAccess(client,actor,classId,'can_edit_schedule',{lock:true});
    const c = (await client.query('SELECT * FROM classes WHERE id=$1 FOR UPDATE',[classId])).rows[0];
    if (!c) throw new AppError('Không tìm thấy nhóm.',404);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`day:${classId}:${day}`]);
    const old = (await client.query('SELECT * FROM sessions WHERE class_id=$1 AND day=$2 FOR UPDATE',[classId,day])).rows;
    if(roleOf(editor)!=='admin'&&(input.cancelled===true)!==old.some(s=>s.state==='cancelled'))throw new AppError('Chỉ admin được hủy hoặc mở lại ngày không tổ chức điểm danh.',403);
    const count = Number((await client.query('SELECT count(*) FROM attendance_attempts WHERE session_id=ANY($1::uuid[])',[old.map(s=>s.id)])).rows[0].count);
    if (count && input.confirm_changes!==true) throw new AppError(`Ngày này đã có ${count} lượt gửi. Cần xác nhận trước khi đổi lịch và tính lại phiên.`,409);
    const states = input.cancelled === true ? 'cancelled' : 'active';
    const sessions = [];
    for (const t of times) {
      const s = (await client.query(`INSERT INTO sessions(class_id,day,name,opens_at,deadline_at,accepts_until,state,latitude,longitude,radius,max_accuracy,config_revision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(class_id,day,name) DO UPDATE SET
        opens_at=excluded.opens_at,deadline_at=excluded.deadline_at,accepts_until=excluded.accepts_until,state=excluded.state RETURNING *`,
        [classId,day,t.name,t.opens_at,t.deadline_at,t.accepts_until,states,c.latitude,c.longitude,c.radius,c.max_accuracy,c.revision])).rows[0];
      if (!old.some(o=>o.id === s.id)) await copyRoster(client,s.id,classId);
      sessions.push(s);
    }
    if (count) {
      const records = (await client.query('SELECT * FROM attendance_attempts WHERE session_id=ANY($1::uuid[]) FOR UPDATE',[old.map(s=>s.id)])).rows;
      for (const r of records) {
        const target = selectSession(sessions,r.received_at);
        // Keep cancelled-session history assigned, but excluded from attendance totals.
        if (input.cancelled || target?.id === r.session_id) continue;
        const known = target && r.student_id ? (await client.query('SELECT student_id FROM session_roster WHERE session_id=$1 AND student_id=$2',[target.id,r.student_id])).rows : [];
        const matches = known.length ? known : target ? (await client.query('SELECT student_id FROM session_roster WHERE session_id=$1 AND normalized_name=$2',[target.id,r.normalized_name])).rows : [];
        const match = !target ? 'outside_session' : matches.length === 1 ? 'matched' : matches.length ? 'ambiguous' : 'unmatched';
        await client.query('UPDATE attendance_attempts SET session_id=$2,student_id=$3,match_state=$4 WHERE id=$1',[r.id,target?.id || null,match==='matched' ? matches[0].student_id : null,match]);
      }
    }
    await audit(client,actor,'save_schedule',classId,{day,before:old,after:sessions,reclassified:count});
    return sessions;
  });
}
async function saveDefaultSchedule(db,input,actor){
  const fields=['morning_open','morning_deadline','afternoon_open','afternoon_deadline'];
  if(Object.keys(input).some(k=>!['class_id',...fields].includes(k)))throw new AppError('Khung giờ mặc định chỉ cho phép thay đổi bốn mốc giờ.');
  const classId=uuid(input.class_id);scheduleTimes(vnDate(),input);
  return transaction(db,async client=>{
    await requireClassAccess(client,actor,classId,'can_edit_schedule',{lock:true});
    const before=(await client.query('SELECT * FROM classes WHERE id=$1 FOR UPDATE',[classId])).rows[0];
    if(!before)throw new AppError('Không tìm thấy nhóm.',404);
    const saved=(await client.query(`UPDATE classes SET morning_open=$2,morning_deadline=$3,afternoon_open=$4,afternoon_deadline=$5 WHERE id=$1 RETURNING *`,[classId,...fields.map(k=>input[k])])).rows[0];
    await audit(client,actor,'save_default_schedule',classId,{before:Object.fromEntries(fields.map(k=>[k,before[k]])),after:Object.fromEntries(fields.map(k=>[k,saved[k]]))});
    return {saved:true,...Object.fromEntries(fields.map(k=>[k,saved[k]]))};
  });
}
async function reconcile(db,input,actor) {
  const note = text(input.note,'Lý do điều chỉnh',2000);
  return transaction(db,async client => {
    let record = (await client.query('SELECT * FROM attendance_attempts WHERE id=$1',[uuid(input.attempt_id)])).rows[0];
    if (!record) throw new AppError('Không tìm thấy lượt gửi.',404);
    // Match the class -> session -> attendance lock order used by schedule changes.
    await client.query('SELECT id FROM classes WHERE id=$1 FOR SHARE',[record.class_id]);
    const sessionId = uuid(input.session_id || record.session_id);
    const session = (await client.query('SELECT * FROM sessions WHERE id=$1 AND class_id=$2 FOR SHARE',[sessionId,record.class_id])).rows[0];
    if (!session) throw new AppError('Phiên không thuộc nhóm này.');
    record=(await client.query('SELECT * FROM attendance_attempts WHERE id=$1 FOR UPDATE',[record.id])).rows[0];
    const studentId = input.student_id ? uuid(input.student_id) : null;
    if (studentId && !(await client.query('SELECT 1 FROM session_roster WHERE session_id=$1 AND student_id=$2',[sessionId,studentId])).rows.length) throw new AppError('Người tham gia không có trong danh sách phiên.');
    await client.query('UPDATE attendance_attempts SET session_id=$2,student_id=$3,match_state=$4 WHERE id=$1',[record.id,sessionId,studentId,studentId ? 'matched':'unmatched']);
    await audit(client,actor,'reconcile',record.class_id,{before:record,session_id:sessionId,student_id:studentId,note});
    return {updated:true};
  });
}
async function reviewReason(db,input,actor) {
  if (!['approved','rejected'].includes(input.status)) throw new AppError('Trạng thái duyệt không hợp lệ.');
  return transaction(db,async client => {
    const record = (await client.query('SELECT * FROM attendance_attempts WHERE id=$1 FOR UPDATE',[uuid(input.id)])).rows[0];
    if (!record?.reason) throw new AppError('Không tìm thấy lý do.',404);
    await client.query('UPDATE attendance_attempts SET reason_status=$2 WHERE id=$1',[record.id,input.status]);
    await audit(client,actor,'review_reason',record.class_id,{id:record.id,before:record.reason_status,after:input.status,note:String(input.note || '').slice(0,2000)});
    return {updated:true};
  });
}
async function resolveDevice(db,input,actor) {
  const session = (await db.query('SELECT class_id FROM sessions WHERE id=$1',[uuid(input.session_id)])).rows[0];
  if (!session) throw new AppError('Không tìm thấy phiên.',404);
  const device = text(input.device_id,'Thiết bị',150), note = text(input.note,'Ghi chú xử lý',2000);
  return transaction(db,async client => {
    await client.query(`INSERT INTO device_resolutions(session_id,device_id,note,actor_id) VALUES($1,$2,$3,$4)
      ON CONFLICT(session_id,device_id) DO UPDATE SET note=excluded.note,actor_id=excluded.actor_id,created_at=now()`,[input.session_id,device,note,actor]);
    await audit(client,actor,'resolve_device',session.class_id,{session_id:input.session_id,device_id:device,note});
    return {updated:true};
  });
}
async function rateLimit(db,key,max,seconds=60) {
  const r = await db.query(`INSERT INTO rate_limits(key,window_start,hits) VALUES($1,clock_timestamp(),1)
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.window_start < clock_timestamp()-($2 * interval '1 second') THEN 1 ELSE rate_limits.hits+1 END,
    window_start=CASE WHEN rate_limits.window_start < clock_timestamp()-($2 * interval '1 second') THEN clock_timestamp() ELSE rate_limits.window_start END RETURNING hits`,[key,seconds]);
  if (r.rows[0].hits > max) throw new AppError('Bạn gửi quá nhiều lần. Hãy thử lại sau một phút.',429);
}
async function saveStudent(db,input,actor) {
  const classId=uuid(input.class_id),name=text(input.name,'Họ tên'),unit=text(input.unit||'','Đơn vị',500,false);
  const dob=input.birth_date?dateOnly(input.birth_date):null;
  const ordinal=input.ordinal?finite(input.ordinal,'TT',1,1000000):null;
  return transaction(db,async client=>{
    await client.query('SELECT id FROM classes WHERE id=$1 FOR UPDATE',[classId]);
    let before=null;
    if(input.id){before=(await client.query('SELECT * FROM students WHERE id=$1 AND class_id=$2 FOR UPDATE',[uuid(input.id),classId])).rows[0];if(!before)throw new AppError('Không tìm thấy người tham gia.',404);}
    const result=input.id?(await client.query('UPDATE students SET name=$2,normalized_name=$3,unit=$4,birth_date=$5,ordinal=$6,active=$7 WHERE id=$1 RETURNING *',[input.id,name,normalizeName(name),unit,dob,ordinal,input.active!==false])).rows[0]
      :(await client.query('INSERT INTO students(class_id,name,normalized_name,unit,birth_date,ordinal) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[classId,name,normalizeName(name),unit,dob,ordinal])).rows[0];
    await audit(client,actor,'save_student',classId,{before,after:result});return result;
  });
}
async function syncRoster(db,input,actor){
  const sessionId=uuid(input.session_id),note=text(input.note,'Ghi chú đồng bộ',2000);
  return transaction(db,async client=>{
    const owner=(await client.query('SELECT class_id FROM sessions WHERE id=$1',[sessionId])).rows[0];
    if(!owner)throw new AppError('Không tìm thấy phiên.',404);
    await requireClassAccess(client,actor,owner.class_id,'can_import_roster',{lock:true});
    const session=(await client.query('SELECT * FROM sessions WHERE id=$1 FOR UPDATE',[sessionId])).rows[0];
    if(!session)throw new AppError('Không tìm thấy phiên.',404);
    const before=(await client.query('SELECT * FROM session_roster WHERE session_id=$1',[sessionId])).rows;
    await client.query(`DELETE FROM session_roster r WHERE r.session_id=$1 AND NOT EXISTS(SELECT 1 FROM students s WHERE s.id=r.student_id AND s.active)
      AND NOT EXISTS(SELECT 1 FROM attendance_attempts a WHERE a.session_id=r.session_id AND a.student_id=r.student_id)`,[sessionId]);
    await client.query(`UPDATE session_roster r SET name=s.name,normalized_name=s.normalized_name,unit=s.unit,ordinal=s.ordinal
      FROM students s WHERE r.student_id=s.id AND r.session_id=$1 AND s.active`,[sessionId]);
    await copyRoster(client,sessionId,session.class_id);
    // This explicit operation also matches only exact, unique names that were previously unmatched.
    await matchUnlinkedAttempts(client,sessionId);
    await audit(client,actor,'sync_roster',session.class_id,{session_id:sessionId,before,note});return {updated:true};
  });
}
async function manualAttendance(db,input,actor){
  const sessionId=uuid(input.session_id),studentId=uuid(input.student_id),note=text(input.note,'Lý do ghi nhận thủ công',2000);
  if(!['present','reason'].includes(input.kind))throw new AppError('Loại ghi nhận không hợp lệ.');
  const at=new Date(input.received_at);if(Number.isNaN(at.getTime()))throw new AppError('Giờ ghi nhận không hợp lệ.');
  const {randomUUID}=require('node:crypto');
  return transaction(db,async client=>{
    const session=(await client.query('SELECT * FROM sessions WHERE id=$1 FOR SHARE',[sessionId])).rows[0];
    const student=(await client.query('SELECT * FROM session_roster WHERE session_id=$1 AND student_id=$2',[sessionId,studentId])).rows[0];
    if(!session||!student)throw new AppError('Không tìm thấy người tham gia trong phiên.');
    if(at<new Date(session.opens_at)||at>=new Date(session.accepts_until))throw new AppError('Giờ ghi nhận cần nằm trong khoảng nhận của phiên.');
    const record=(await client.query(`INSERT INTO attendance_attempts(class_id,request_id,payload_hash,session_id,student_id,entered_name,normalized_name,entered_unit,received_at,kind,match_state,reason,reason_status,device_id,config_snapshot)
      VALUES($1,$2,'manual',$3,$4,$5,$6,$7,$8,$9,'matched',$10,$11,$12,$13) RETURNING id`,[session.class_id,randomUUID(),sessionId,studentId,student.name,student.normalized_name,student.unit,at,input.kind,note,input.kind==='reason'?'approved':'pending',`MANUAL:${studentId}`,JSON.stringify({manual:true,actor_id:actor})])).rows[0];
    await audit(client,actor,'manual_attendance',session.class_id,{id:record.id,student_id:studentId,note,received_at:at});return {updated:true};
  });
}
module.exports = { uuid,classBy,ensureDay,publicConfig,submit,dashboard,listStudents,importStudents,saveClass,saveSchedule,reconcile,reviewReason,resolveDevice,rateLimit,saveStudent,syncRoster,manualAttendance,saveDefaultSchedule };
