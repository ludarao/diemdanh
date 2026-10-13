'use strict';
const { createClient }=require('@supabase/supabase-js');
const { AppError }=require('./domain');
function authClient(){
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY)throw new AppError('Chưa cấu hình đăng nhập admin.',503);
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(p=>{const i=p.indexOf('=');return i<0?[]:[p.slice(0,i).trim(),p.slice(i+1)];}).filter(x=>x.length));}
function setSession(res,session){
  const secure=process.env.NODE_ENV==='production'||String(process.env.APP_ORIGIN).startsWith('https:');
  const suffix=`; Path=/api; HttpOnly; SameSite=Strict${secure?'; Secure':''}`;
  res.setHeader('Set-Cookie',[
    `attendance_access=${session?.access_token||''}; Max-Age=${session?session.expires_in||3600:0}${suffix}`,
    `attendance_refresh=${session?.refresh_token||''}; Max-Age=${session?604800:0}${suffix}`
  ]);
}
async function requireAdmin(db,req){
  const token=cookies(req).attendance_access;
  if(!token)throw new AppError('Vui lòng đăng nhập admin.',401);
  const {data,error}=await authClient().auth.getUser(token);
  if(error||!data.user)throw new AppError('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.',401);
  const actor=(await db.query('SELECT * FROM admin_users WHERE user_id=$1 AND enabled',[data.user.id])).rows[0];
  if(!actor)throw new AppError('Tài khoản chưa được cấp quyền quản trị.',403);
  return {...actor,token};
}
async function login(db,req,res,input){
  if(typeof input.email!=='string'||input.email.length>320||typeof input.password!=='string'||input.password.length>1024)throw new AppError('Email hoặc mật khẩu không hợp lệ.');
  const {data,error}=await authClient().auth.signInWithPassword({email:input.email.trim(),password:input.password});
  if(error||!data.session)throw new AppError('Email hoặc mật khẩu không đúng.',401);
  const actor=(await db.query('SELECT * FROM admin_users WHERE user_id=$1 AND enabled',[data.user.id])).rows[0];
  if(!actor)throw new AppError('Tài khoản chưa được cấp quyền quản trị.',403);
  setSession(res,data.session);return {email:actor.email};
}
async function refresh(db,req,res){
  const token=cookies(req).attendance_refresh;
  if(!token)throw new AppError('Vui lòng đăng nhập lại.',401);
  const {data,error}=await authClient().auth.refreshSession({refresh_token:token});
  if(error||!data.session){setSession(res,null);throw new AppError('Vui lòng đăng nhập lại.',401);}
  const actor=(await db.query('SELECT * FROM admin_users WHERE user_id=$1 AND enabled',[data.user.id])).rows[0];
  if(!actor){setSession(res,null);throw new AppError('Tài khoản đã bị thu hồi quyền.',403);}
  setSession(res,data.session);return {email:actor.email};
}
async function logout(req,res){
  const token=cookies(req).attendance_access;setSession(res,null);
  if(token){const c=authClient();await c.auth.setSession({access_token:token,refresh_token:cookies(req).attendance_refresh||''});await c.auth.signOut({scope:'local'});}
  return {loggedOut:true};
}
function checkOrigin(req){
  if(['GET','HEAD','OPTIONS'].includes(req.method))return;
  const origin=req.headers.origin,expected=process.env.APP_ORIGIN;
  if(!expected)throw new AppError('Chưa cấu hình APP_ORIGIN.',503);
  if(origin!==new URL(expected).origin)throw new AppError('Yêu cầu không đến từ ứng dụng này.',403);
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new AppError('Yêu cầu cần định dạng JSON.',415);
}
module.exports={authClient,cookies,setSession,requireAdmin,login,refresh,logout,checkOrigin};
