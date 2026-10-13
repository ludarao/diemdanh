'use strict';
const {AppError}=require('./domain');
function authAdminError(error,operation){
  const code=typeof error?.code==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(error.code)?error.code:'auth_admin_error';
  const upstream=Number(error?.status)||0;
  const name=['AuthRetryableFetchError','AuthUnknownError','AuthApiError','AuthWeakPasswordError'].includes(error?.name)?error.name:'AuthError';
  const invalidHeader=/ByteString|invalid (?:character.*header|header)|header.*(?:invalid|character)|Headers.*invalid/i.test(String(error?.message||''));
  let message,status;
  if(['user_already_exists','email_exists'].includes(code)){
    message='Email đã tồn tại trong Supabase Auth. Kiểm tra Authentication → Users; không tạo lại bằng email này.';status=409;
  }else if(code==='weak_password'||error?.name==='AuthWeakPasswordError'){
    const reasons=new Set(Array.isArray(error.reasons)?error.reasons:[]);
    const hints=[];
    if(reasons.has('length')||reasons.has('min_length'))hints.push('Tăng độ dài theo chính sách mật khẩu của project.');
    if(reasons.has('characters'))hints.push('Bổ sung chữ hoa, chữ thường, số và ký tự đặc biệt.');
    if(reasons.has('pwned'))hints.push('Mật khẩu đã xuất hiện trong dữ liệu rò rỉ; dùng mật khẩu khác.');
    message=`Supabase từ chối mật khẩu vì chưa đạt chính sách của project.${hints.length?' '+hints.join(' '):' Hãy dùng mật khẩu mạnh hơn và kiểm tra Authentication → Security and Protection.'}`;status=400;
  }else if(['not_admin','bad_jwt','no_authorization','invalid_jwt','invalid_api_key'].includes(code)||(code==='auth_admin_error'&&(upstream===401||upstream===403))){
    message='Khóa server bị Supabase từ chối hoặc không có quyền quản trị Auth. Kiểm tra SUPABASE_SERVICE_ROLE_KEY đúng project của SUPABASE_URL, đúng môi trường Production, rồi redeploy.';status=503;
  }else if(code==='email_address_invalid'){
    message='Supabase không chấp nhận địa chỉ email này. Kiểm tra địa chỉ và dùng email thật.';status=400;
  }else if(['email_provider_disabled','signup_disabled','provider_disabled'].includes(code)){
    message='Supabase đang tắt tạo tài khoản bằng email. Kiểm tra cấu hình Email trong Authentication của project.';status=503;
  }else if(code==='user_not_found'){
    message='Tài khoản này không còn tồn tại trong Supabase Auth.';status=404;
  }else if(code==='same_password'){
    message='Mật khẩu mới phải khác mật khẩu đang dùng.';status=400;
  }else if(code==='over_request_rate_limit'||upstream===429){
    message='Supabase đang giới hạn số yêu cầu. Chờ một lúc rồi thử lại.';status=429;
  }else if(code==='unexpected_failure'||upstream>=500){
    message='Supabase Auth gặp lỗi phía server. Kiểm tra Auth Logs và trigger trên auth.users trong Supabase.';status=502;
  }else if(invalidHeader){
    message='Server không gửi được yêu cầu vì khóa chứa ký tự không hợp lệ trong HTTP header. Dán lại nguyên khóa server từ nút Copy của Supabase rồi redeploy.';status=503;
  }else if(name==='AuthRetryableFetchError'&&upstream===0){
    message='Server chưa gửi/đọc được yêu cầu tới Supabase Auth. Kiểm tra định dạng khóa server, kết nối mạng và SUPABASE_URL.';status=502;
  }else{
    message='Chưa thực hiện được thao tác tài khoản qua Supabase Auth. Kiểm tra Auth Logs của project.';status=502;
  }
  // Never return/log the upstream message, credentials, email or request payload.
  console.error('Supabase Auth admin failed',{operation,code,status:upstream,name});
  return new AppError(`${message} (Mã: ${code}${upstream?`; HTTP ${upstream}`:`; ${name}`})`,status);
}
module.exports={authAdminError};
