'use strict';
const {AppError}=require('./domain');const {uuid}=require('./store');
const viewerActions=new Set(['me','classes','dashboard','realtime-config']);
function roleOf(actor){return actor.role||'admin';}
function requireManager(actor){if(roleOf(actor)!=='admin')throw new AppError('Tài khoản chỉ có quyền xem tổng quan lớp được giao.',403);}
async function authorize(db,actor,action,url){
  if(roleOf(actor)==='admin')return;
  if(roleOf(actor)!=='class_viewer'||!viewerActions.has(action))throw new AppError('Tài khoản chỉ có quyền xem tổng quan lớp được giao.',403);
  if(action==='dashboard'){
    const id=uuid(url.searchParams.get('class_id'));
    if(!(await db.query('SELECT 1 FROM class_viewers WHERE user_id=$1 AND class_id=$2',[actor.user_id,id])).rows.length)throw new AppError('Bạn không được cấp quyền xem lớp này.',403);
  }
}
async function visibleClasses(db,actor){
  if(roleOf(actor)==='admin')return (await db.query('SELECT * FROM classes ORDER BY is_default DESC,name')).rows;
  return (await db.query('SELECT c.id,c.name,c.slug FROM classes c JOIN class_viewers v ON v.class_id=c.id WHERE v.user_id=$1 ORDER BY c.name',[actor.user_id])).rows;
}
module.exports={roleOf,requireManager,authorize,visibleClasses};
