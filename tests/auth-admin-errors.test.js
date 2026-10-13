'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateAdminAuthConfig}=require('../lib/auth');const {authAdminError}=require('../lib/auth-admin-errors');
const {createTestDb,seed}=require('./helpers');const {saveViewer,checkViewerAuth}=require('../lib/viewer-accounts');
function jwt(role,ref='projecta'){return `header.${Buffer.from(JSON.stringify({role,ref})).toString('base64url')}.signature`;}
test('Phát hiện khóa publishable/anon, JWT sai vai trò và khóa khác project trước khi gọi Auth',()=>{
  const env={SUPABASE_URL:'https://projecta.supabase.co',SUPABASE_ANON_KEY:'public-key'};
  for(const key of ['', 'public-key','sb_publishable_test',jwt('anon'),jwt('service_role','projectb')]){
    assert.throws(()=>validateAdminAuthConfig({...env,SUPABASE_SERVICE_ROLE_KEY:key}),e=>e.status===503);
  }
  const key=jwt('service_role');assert.equal(validateAdminAuthConfig({...env,SUPABASE_SERVICE_ROLE_KEY:` ${key}\n`}).key,key);
  assert.equal(validateAdminAuthConfig({...env,SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fake'}).key,'sb_secret_fake');
  assert.throws(()=>validateAdminAuthConfig({...env,SUPABASE_URL:'invalid',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fake'}),e=>e.status===503);
});
test('Lỗi từ Supabase được phân biệt, không biến lỗi khóa server thành lỗi phiên đăng nhập',t=>{
  t.mock.method(console,'error',()=>{});
  for(const [error,status,pattern]of [
    [{code:'not_admin',status:403},503,/Khóa server/],
    [{code:'bad_jwt',status:401},503,/SUPABASE_SERVICE_ROLE_KEY/],
    [{status:401},503,/Khóa server/],
    [{code:'user_already_exists',status:422},409,/Email đã tồn tại/],
    [{code:'weak_password',status:422,reasons:['characters','pwned']},400,/rò rỉ/],
    [{code:'email_address_invalid',status:400},400,/email/],
    [{code:'email_provider_disabled',status:403},503,/đang tắt/],
    [{code:'over_request_rate_limit',status:429},429,/giới hạn/],
    [{code:'unexpected_failure',status:500},502,/Auth Logs/]
  ]){const result=authAdminError(error,'create');assert.equal(result.status,status);assert.match(result.message,pattern);}
});
test('Không đưa email, mật khẩu, khóa hoặc thông báo Auth thô vào API/logs',t=>{
  const calls=[];t.mock.method(console,'error',(...args)=>calls.push(args));
  const secret='fake-sensitive-value-for-leak-test';
  for(const error of [{code:'not_admin',status:403,message:secret},{code:`Bearer ${secret}`,status:500,message:secret,reasons:[secret]}]){
    assert.ok(!authAdminError(error,'create').message.includes(secret));
  }
  assert.ok(!JSON.stringify(calls).includes(secret));
});
async function fixture(){const db=await createTestDb();const {c,actor}=await seed(db);await db.query("INSERT INTO schema_migrations(version) VALUES('004_class_viewers_security')");return {db,c,admin:{user_id:actor,role:'admin'}};}
test('CreateUser bị từ chối trả đúng nguyên nhân và không ghi user/quyền lớp',async t=>{
  t.mock.method(console,'error',()=>{});const {db,c,admin}=await fixture();try{
    for(const error of [{code:'not_admin',status:403},{code:'weak_password',status:422,reasons:['characters']},{code:'unexpected_failure',status:500}]){
      await assert.rejects(()=>saveViewer(db,{operation:'create',class_id:c.id,email:'leader@example.test',password:'Fake-test-password-123!'},admin,{async createUser(){return {data:null,error};}}),e=>e.message.includes(error.code));
      assert.equal((await db.query("SELECT * FROM admin_users WHERE role='class_viewer'")).rows.length,0);
      assert.equal((await db.query('SELECT * FROM class_viewers')).rows.length,0);
    }
  }finally{await db.close();}
});
test('Kiểm tra kết nối chỉ đọc, không trả danh sách user và lớp trưởng không gọi được',async()=>{
  const {db,admin}=await fixture();try{
    let calls=0;const remote={async listUsers(input){calls++;assert.deepEqual(input,{page:1,perPage:1});return {data:{users:[{email:'private@example.test'}]},error:null};}};
    const before=(await db.query('SELECT count(*) FROM admin_users')).rows[0].count;
    const result=await checkViewerAuth(db,admin,remote);assert.equal(result.ready,true);assert.ok(!JSON.stringify(result).includes('private@example.test'));
    assert.equal((await db.query('SELECT count(*) FROM admin_users')).rows[0].count,before);
    await assert.rejects(()=>checkViewerAuth(db,{role:'class_viewer'},remote),e=>e.status===403);assert.equal(calls,1);
  }finally{await db.close();}
});
test('Cấp lại mật khẩu hoặc kiểm tra kết nối dùng cùng thông báo lỗi server chính xác',async t=>{
  t.mock.method(console,'error',()=>{});const {db,c,admin}=await fixture();try{
    const id='22222222-2222-4222-8222-222222222222';await db.query("INSERT INTO admin_users(user_id,email,role) VALUES($1,'leader@example.test','class_viewer')",[id]);
    const remote={async updateUserById(){return {error:{code:'bad_jwt',status:401}};},async listUsers(){return {error:{code:'not_admin',status:403}};}};
    await assert.rejects(()=>saveViewer(db,{operation:'reset-password',user_id:id,password:'Fake-password-123!'},admin,remote),e=>e.status===503&&e.message.includes('bad_jwt'));
    await assert.rejects(()=>checkViewerAuth(db,admin,remote),e=>e.status===503&&e.message.includes('not_admin'));
  }finally{await db.close();}
});
