'use strict';
const {createHash}=require('node:crypto');
const {AppError}=require('./domain');const {uuid}=require('./store');
const {transaction,audit}=require('./db');
const operations=new Set(['clear-all','clear-class-attendance','delete-class']);
function validateOperation(operation){if(!operations.has(operation))throw new AppError('Thao tác xóa không hợp lệ.');}
async function summary(client,operation,classId){
  validateOperation(operation);
  const classes=(await client.query(operation==='clear-all'?'SELECT * FROM classes ORDER BY id':'SELECT * FROM classes WHERE id=$1',[...(operation==='clear-all'?[]:[uuid(classId)])])).rows;
  if(operation!=='clear-all'&&!classes.length)throw new AppError('Nhóm đã bị xóa hoặc không tồn tại.',404);
  const ids=classes.map(c=>c.id),clearAll=operation==='clear-all',eraseStructure=operation!=='clear-class-attendance';
  const a=(await client.query(`SELECT count(*)::integer AS total,count(*) FILTER(WHERE reason<>'')::integer AS reasons,
    md5(coalesce(string_agg(id::text,',' ORDER BY id),'')) AS fingerprint FROM attendance_attempts WHERE class_id=ANY($1::uuid[])`,[ids])).rows[0];
  const st=(await client.query(`SELECT count(*)::integer AS total,md5(coalesce(string_agg(id::text,',' ORDER BY id),'')) AS fingerprint FROM students WHERE class_id=ANY($1::uuid[])`,[ids])).rows[0];
  const s=(await client.query(`SELECT count(*)::integer AS total,md5(coalesce(string_agg(id::text,',' ORDER BY id),'')) AS fingerprint FROM sessions WHERE class_id=ANY($1::uuid[])`,[ids])).rows[0];
  const r=(await client.query(`SELECT count(*)::integer AS total,md5(coalesce(string_agg(r.session_id::text||':'||r.student_id::text,',' ORDER BY r.session_id,r.student_id),'')) AS fingerprint
    FROM session_roster r JOIN sessions s ON s.id=r.session_id WHERE s.class_id=ANY($1::uuid[])`,[ids])).rows[0];
  const d=(await client.query(`SELECT count(*)::integer AS total,md5(coalesce(string_agg(d.session_id::text||':'||d.device_id,',' ORDER BY d.session_id,d.device_id),'')) AS fingerprint
    FROM device_resolutions d JOIN sessions s ON s.id=d.session_id WHERE s.class_id=ANY($1::uuid[])`,[ids])).rows[0];
  const logs=(await client.query(`SELECT count(*)::integer AS total,md5(coalesce(string_agg(id::text,',' ORDER BY id),'')) AS fingerprint FROM audit_logs WHERE $2 OR class_id=ANY($1::uuid[])`,[ids,clearAll])).rows[0];
  const grants=(await client.query(`SELECT count(*)::integer AS total,md5(coalesce(string_agg(user_id::text||':'||class_id::text||':'||can_import_roster::text||':'||can_edit_schedule::text,',' ORDER BY user_id,class_id),'')) AS fingerprint FROM class_viewers WHERE class_id=ANY($1::uuid[])`,[ids])).rows[0];
  const previewHash=createHash('sha256').update(JSON.stringify({operation,classes,a,st,s,r,d,logs,grants})).digest('hex');
  const target=classes[0]||null;
  const confirmationPhrase=clearAll?'XÓA TOÀN BỘ DỮ LIỆU':operation==='delete-class'?`XÓA NHÓM ${target.slug}`:`XÓA ĐIỂM DANH ${target.slug}`;
  return {operation,class_id:clearAll?null:target.id,class_name:clearAll?null:target.name,classes_affected:classes.length,
    title:clearAll?'Xóa toàn bộ dữ liệu ứng dụng':operation==='delete-class'?`Xóa nhóm ${target.name}`:`Xóa kết quả điểm danh của ${target.name}`,
    will_delete:{classes:eraseStructure?classes.length:0,students:eraseStructure?st.total:0,sessions:eraseStructure?s.total:0,
      roster_entries:eraseStructure?r.total:0,attendance_attempts:a.total,attempts_with_reason:a.reasons,device_notes:d.total,audit_logs:logs.total,class_permissions:eraseStructure?grants.total:0},
    retained:eraseStructure?(clearAll?'Giữ tài khoản đăng nhập và cấu trúc hệ thống để đăng nhập, tạo nhóm lại. Người quản lý nhóm cần được giao nhóm mới.':'Giữ các nhóm khác và tài khoản admin.'):'Giữ nhóm điểm danh, danh sách người tham gia, lịch phiên, tọa độ và bán kính của nhóm.',
    preview_hash:previewHash,confirmation_phrase:confirmationPhrase,
    _class_ids:ids};
}
async function previewDeletion(db,operation,classId){
  return transaction(db,async client=>{const data=await summary(client,operation,classId);delete data._class_ids;return data;},{isolation:'repeatable read'});
}
async function deleteData(db,input,actor){
  validateOperation(input.operation);
  if(input.acknowledged!==true)throw new AppError('Cần xác nhận đã hiểu phạm vi xóa.');
  return transaction(db,async client=>{
    const p=await summary(client,input.operation,input.class_id);
    if(input.confirmation!==p.confirmation_phrase)throw new AppError('Nội dung xác nhận xóa chưa đúng.');
    if(input.preview_hash!==p.preview_hash)throw new AppError('Dữ liệu đã thay đổi từ lúc xem trước. Hãy xem lại phạm vi xóa và xác nhận lại.',409);
    const ids=p._class_ids,clearAll=input.operation==='clear-all',eraseStructure=input.operation!=='clear-class-attendance';
    await client.query('DELETE FROM device_resolutions WHERE session_id IN (SELECT id FROM sessions WHERE class_id=ANY($1::uuid[]))',[ids]);
    await client.query('DELETE FROM attendance_attempts WHERE class_id=ANY($1::uuid[])',[ids]);
    if(eraseStructure){
      await client.query('DELETE FROM session_roster WHERE session_id IN (SELECT id FROM sessions WHERE class_id=ANY($1::uuid[]))',[ids]);
      await client.query('DELETE FROM sessions WHERE class_id=ANY($1::uuid[])',[ids]);
      await client.query('DELETE FROM students WHERE class_id=ANY($1::uuid[])',[ids]);
    }
    await client.query('DELETE FROM audit_logs WHERE $2 OR class_id=ANY($1::uuid[])',[ids,clearAll]);
    if(eraseStructure)await client.query('DELETE FROM classes WHERE id=ANY($1::uuid[])',[ids]);
    if(clearAll)await client.query('DELETE FROM rate_limits');
    const remaining=(await client.query('SELECT id,is_default FROM classes ORDER BY created_at,id')).rows;
    if(remaining.length&&!remaining.some(c=>c.is_default)){
      await client.query('UPDATE classes SET is_default=true WHERE id=$1',[remaining[0].id]);remaining[0].is_default=true;
    }
    const defaultId=remaining.find(c=>c.is_default)?.id||null;
    await audit(client,actor,input.operation,eraseStructure?null:input.class_id,{class_id:p.class_id,class_name:p.class_name,deleted:p.will_delete});
    return {deleted:p.will_delete,remaining_classes:remaining.length,default_class_id:defaultId};
  },{exclusive:true});
}
module.exports={previewDeletion,deleteData};
