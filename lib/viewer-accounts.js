'use strict';
const {AppError}=require('./domain');const {uuid}=require('./store');const {transaction,audit}=require('./db');
const {requireManager}=require('./permissions');const {adminAuthClient}=require('./auth');
function password(value){if(typeof value!=='string'||value.length<12||value.length>1024)throw new AppError('Mật khẩu cần từ 12 đến 1024 ký tự.');return value;}
async function ready(db){
  if(!(await db.query("SELECT 1 FROM schema_migrations WHERE version='004_class_viewers_security'")).rows.length)throw new AppError('Cần chạy migration 003 và 004 trước khi cấp tài khoản lớp trưởng.',503);
}
async function listViewers(db,actor){
  requireManager(actor);await ready(db);
  return (await db.query(`SELECT u.user_id,u.email,u.enabled,u.created_at,coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)) FILTER(WHERE c.id IS NOT NULL),'[]') AS classes
    FROM admin_users u LEFT JOIN class_viewers v ON v.user_id=u.user_id LEFT JOIN classes c ON c.id=v.class_id
    WHERE u.role='class_viewer' GROUP BY u.user_id ORDER BY u.created_at DESC`)).rows;
}
async function saveViewer(db,input,actor,providedAuth){
  requireManager(actor);await ready(db);
  const operation=input.operation;
  if(!['create','assign','set-enabled','reset-password'].includes(operation))throw new AppError('Thao tác tài khoản không hợp lệ.');
  let createdId=null,auth;
  try{return await transaction(db,async client=>{
    let target;
    if(operation==='create'){
      const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>320)throw new AppError('Email không hợp lệ.');
      password(input.password);
      const classId=uuid(input.class_id);
      if(!(await client.query('SELECT id FROM classes WHERE id=$1 FOR SHARE',[classId])).rows.length)throw new AppError('Lớp không tồn tại.',404);
      if((await client.query('SELECT 1 FROM admin_users WHERE lower(email)=$1',[email])).rows.length)throw new AppError('Email đã được cấp tài khoản.',409);
      auth=providedAuth||adminAuthClient();
      const {data,error}=await auth.createUser({email,password:input.password,email_confirm:true});
      if(error||!data?.user)throw new AppError('Không tạo được tài khoản. Kiểm tra email đã tồn tại, cấu hình Auth và chính sách mật khẩu.',409);
      createdId=data.user.id;
      target=(await client.query("INSERT INTO admin_users(user_id,email,role) VALUES($1,$2,'class_viewer') RETURNING *",[createdId,email])).rows[0];
      await client.query('INSERT INTO class_viewers(user_id,class_id) VALUES($1,$2)',[target.user_id,classId]);
    }else{
      target=(await client.query("SELECT * FROM admin_users WHERE user_id=$1 AND role='class_viewer' FOR UPDATE",[uuid(input.user_id)])).rows[0];
      if(!target)throw new AppError('Không tìm thấy tài khoản lớp trưởng.',404);
      if(operation==='assign'){
        const classId=input.class_id?uuid(input.class_id):null;
        if(classId&&!(await client.query('SELECT id FROM classes WHERE id=$1 FOR SHARE',[classId])).rows.length)throw new AppError('Lớp không tồn tại.',404);
        await client.query('DELETE FROM class_viewers WHERE user_id=$1',[target.user_id]);
        if(classId)await client.query('INSERT INTO class_viewers(user_id,class_id) VALUES($1,$2)',[target.user_id,classId]);
      }
      if(operation==='set-enabled'){
        if(typeof input.enabled!=='boolean')throw new AppError('Trạng thái tài khoản không hợp lệ.');
        await client.query('UPDATE admin_users SET enabled=$2 WHERE user_id=$1',[target.user_id,input.enabled]);
      }
      if(operation==='reset-password'){
        password(input.password);auth=providedAuth||adminAuthClient();
        const {error}=await auth.updateUserById(target.user_id,{password:input.password});
        if(error)throw new AppError('Không cấp lại được mật khẩu. Kiểm tra cấu hình Auth và chính sách mật khẩu.');
      }
    }
    await audit(client,actor.user_id,'viewer_'+operation,null,{user_id:target.user_id,email:target.email,...(['create','assign'].includes(operation)?{class_id:input.class_id||null}:{}),...(operation==='set-enabled'?{enabled:input.enabled}:{})});
    return {saved:true,user_id:target.user_id};
  });}catch(e){
    // Compensate only an Auth user created by this request. Never touch existing users.
    if(createdId){try{await auth.deleteUser(createdId);}catch{ /* orphan has no app permissions */ }}
    throw e;
  }
}
module.exports={listViewers,saveViewer};
