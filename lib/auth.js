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
  if(!token)throw new AppError('Vui lòng đăng nhập.',401);
  const {data,error}=await authClient().auth.getUser(token);
  if(error||!data.user)throw new AppError('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.',401);
  const actor=(await db.query('SELECT * FROM admin_users WHERE user_id=$1 AND enabled',[data.user.id])).rows[0];
  if(!actor)throw new AppError('Tài khoản chưa được cấp quyền truy cập.',403);
  return {...actor,token};
}
async function login(db,req,res,input){
  if(typeof input.email!=='string'||input.email.length>320||typeof input.password!=='string'||input.password.length>1024)throw new AppError('Email hoặc mật khẩu không hợp lệ.');
  const {data,error}=await authClient().auth.signInWithPassword({email:input.email.trim(),password:input.password});
  if(error||!data.session)throw new AppError('Email hoặc mật khẩu không đúng.',401);
  const actor=(await db.query('SELECT * FROM admin_users WHERE user_id=$1 AND enabled',[data.user.id])).rows[0];
  if(!actor)throw new AppError('Tài khoản chưa được cấp quyền truy cập.',403);
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
function validateAdminAuthConfig(env=process.env){
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
  if(!key)throw new AppError('Cần cấu hình SUPABASE_SERVICE_ROLE_KEY trên server để cấp tài khoản/mật khẩu.',503);
  if(/[^\x21-\x7e]/.test(key))throw new AppError('SUPABASE_SERVICE_ROLE_KEY chứa khoảng trắng, xuống dòng hoặc ký tự không hợp lệ. Dán lại nguyên khóa bằng nút Copy của Supabase, rồi redeploy.',503);
  if(!key.startsWith('sb_secret_')&&!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key))throw new AppError('SUPABASE_SERVICE_ROLE_KEY không đúng định dạng khóa server. Dùng nguyên service_role JWT hoặc secret key sb_secret_, không dùng nhãn hay giá trị bị rút gọn.',503);
  let url;try{url=new URL(env.SUPABASE_URL);}catch{throw new AppError('SUPABASE_URL trên server không hợp lệ.',503);}
  if(url.protocol!=='https:')throw new AppError('SUPABASE_URL phải dùng HTTPS.',503);
  if(key.startsWith('sb_publishable_')||key===env.SUPABASE_ANON_KEY)throw new AppError('SUPABASE_SERVICE_ROLE_KEY đang dùng khóa anon/publishable. Cần khóa service_role hoặc secret key server.',503);
  if(key.split('.').length===3){
    let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());}catch{throw new AppError('SUPABASE_SERVICE_ROLE_KEY có định dạng JWT không hợp lệ.',503);}
    if(claims.role!=='service_role')throw new AppError('Khóa JWT trong SUPABASE_SERVICE_ROLE_KEY không có vai trò service_role.',503);
    const project=url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1];
    if(project&&claims.ref&&project!==claims.ref)throw new AppError('SUPABASE_SERVICE_ROLE_KEY thuộc project khác với SUPABASE_URL. Chọn khóa của đúng project rồi redeploy.',503);
  }
  // This is configuration validation only. Supabase verifies the key remotely.
  return {url:url.origin,key};
}
function adminAuthClient(){
  const {url,key}=validateAdminAuthConfig();
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}).auth.admin;
}
module.exports={validateAdminAuthConfig,adminAuthClient,authClient,cookies,setSession,requireAdmin,login,refresh,logout,checkOrigin};
