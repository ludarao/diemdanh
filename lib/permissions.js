'use strict';
const {AppError}=require('./domain');
const uuid=value=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value||''))throw new AppError('Mã bản ghi không hợp lệ.');return value;};
const viewerActions=new Set(['me','classes','dashboard','realtime-config']);
const capabilities={students:'can_import_roster',template:'can_import_roster','preview-import':'can_import_roster',import:'can_import_roster','sync-roster':'can_import_roster','save-schedule':'can_edit_schedule','save-default-schedule':'can_edit_schedule'};
function roleOf(actor){return actor.role||'admin';}
function requireManager(actor){if(roleOf(actor)!=='admin')throw new AppError('Thao tác này chỉ dành cho admin.',403);}
async function requireClassAccess(db,actor,classId,capability=null,{lock=false}={}){
  uuid(classId);
  let user=actor;
  if(lock){user=(await db.query('SELECT * FROM admin_users WHERE user_id=$1 AND enabled FOR SHARE',[typeof actor==='string'?actor:actor.user_id])).rows[0];if(!user)throw new AppError('Tài khoản đã bị thu hồi quyền.',403);}
  if(roleOf(user)==='admin')return user;
  if(roleOf(user)!=='class_viewer')throw new AppError('Tài khoản không được cấp quyền.',403);
  const grant=(await db.query(`SELECT * FROM class_viewers WHERE user_id=$1 AND class_id=$2${lock?' FOR SHARE':''}`,[user.user_id,classId])).rows[0];
  if(!grant||capability&&!grant[capability])throw new AppError('Bạn chưa được cấp quyền thao tác này trong nhóm đang chọn.',403);
  return user;
}
async function authorize(db,actor,action,url,input={}){
  if(roleOf(actor)==='admin')return;
  if(roleOf(actor)!=='class_viewer'||!viewerActions.has(action)&&!capabilities[action])throw new AppError('Bạn chưa được cấp quyền thực hiện thao tác này.',403);
  if(action==='dashboard'||capabilities[action]){
    let id=input.class_id||url.searchParams.get('class_id');
    if(action==='sync-roster'){
      if(!(await db.query('SELECT 1 FROM class_viewers WHERE user_id=$1 AND can_import_roster',[actor.user_id])).rows.length)throw new AppError('Bạn chưa được cấp quyền nhập danh sách.',403);
      const session=(await db.query('SELECT class_id FROM sessions WHERE id=$1',[uuid(input.session_id)])).rows[0];
      if(!session)throw new AppError('Không tìm thấy phiên.',404);id=session.class_id;
    }
    await requireClassAccess(db,actor,id,capabilities[action]||null);
  }
}
async function visibleClasses(db,actor){
  if(roleOf(actor)==='admin')return (await db.query('SELECT * FROM classes ORDER BY is_default DESC,name')).rows;
  return (await db.query(`SELECT c.id,c.name,c.slug,c.morning_open,c.morning_deadline,c.afternoon_open,c.afternoon_deadline,
    v.can_import_roster,v.can_edit_schedule FROM classes c JOIN class_viewers v ON v.class_id=c.id WHERE v.user_id=$1 ORDER BY c.name`,[actor.user_id])).rows;
}
module.exports={roleOf,requireManager,authorize,visibleClasses,requireClassAccess};
