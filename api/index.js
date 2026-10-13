'use strict';
const {createHash}=require('node:crypto');
const {getPool}=require('../lib/db');
const {AppError,vnDate}=require('../lib/domain');
const store=require('../lib/store');
const auth=require('../lib/auth');
const {previewImport,csv}=require('../lib/import');
const {previewDeletion,deleteData}=require('../lib/delete-data');
const {authorize,visibleClasses,roleOf}=require('../lib/permissions');
const {listViewers,saveViewer,checkViewerAuth}=require('../lib/viewer-accounts');
const mutationActions=new Set(['login','refresh','logout','attendance','preview-import','import','save-class','save-schedule','reconcile','review-reason','resolve-device','change-password','save-student','sync-roster','manual-attendance','delete-data','save-viewer']);
function createHandler(dependencies={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try{
      const url=new URL(req.url,'http://localhost'),action=url.searchParams.get('action')||'config';
      if(!['GET','POST'].includes(req.method))throw new AppError('Phương thức không hỗ trợ.',405);
      if(mutationActions.has(action)&&req.method!=='POST')throw new AppError('Thao tác này cần POST.',405);
      if(!mutationActions.has(action)&&req.method!=='GET')throw new AppError('Thao tác này cần GET.',405);
      auth.checkOrigin(req);
      const db=dependencies.db||getPool();
      const input=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
      if(action==='config')return json(res,await store.publicConfig(db,url.searchParams.get('class')));
      const ipHash=createHash('sha256').update(String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown')).digest('hex');
      if(action==='login'){
        await store.rateLimit(db,`login:${ipHash}`,20);
        return json(res,await auth.login(db,req,res,input));
      }
      if(action==='refresh')return json(res,await auth.refresh(db,req,res));
      if(action==='logout')return json(res,await auth.logout(req,res));
      if(action==='attendance'){
        await store.rateLimit(db,`attendance:${ipHash}`,600);
        await store.rateLimit(db,`device:${String(input.deviceId).slice(0,150)}`,30);
        return json(res,await store.submit(db,input.classId||url.searchParams.get('class'),input));
      }
      const actor=dependencies.requireAdmin?await dependencies.requireAdmin(db,req):await auth.requireAdmin(db,req);
      await authorize(db,actor,action,url);
      switch(action){
        case 'me':return json(res,{email:actor.email,role:roleOf(actor)});
        case 'classes':return json(res,await visibleClasses(db,actor));
        case 'viewer-auth-status':return json(res,await checkViewerAuth(db,actor,dependencies.adminAuth));
        case 'viewers':return json(res,await listViewers(db,actor));
        case 'save-viewer':return json(res,await saveViewer(db,input,actor,dependencies.adminAuth));
        case 'students':return json(res,await store.listStudents(db,store.uuid(url.searchParams.get('class_id'))));
        case 'dashboard':return json(res,await store.dashboard(db,url.searchParams.get('class_id'),url.searchParams.get('day')||vnDate(),url.searchParams.get('session_id')));
        case 'preview-import':return json(res,await previewImport(input));
        case 'import':return json(res,await store.importStudents(db,store.uuid(input.class_id),input.rows,input.mode,actor.user_id));
        case 'save-class':return json(res,await store.saveClass(db,input,actor.user_id));
        case 'save-schedule':return json(res,await store.saveSchedule(db,input,actor.user_id));
        case 'reconcile':return json(res,await store.reconcile(db,input,actor.user_id));
        case 'review-reason':return json(res,await store.reviewReason(db,input,actor.user_id));
        case 'resolve-device':return json(res,await store.resolveDevice(db,input,actor.user_id));
        case 'save-student':return json(res,await store.saveStudent(db,input,actor.user_id));
        case 'sync-roster':return json(res,await store.syncRoster(db,input,actor.user_id));
        case 'manual-attendance':return json(res,await store.manualAttendance(db,input,actor.user_id));
        case 'deletion-preview':return json(res,await previewDeletion(db,url.searchParams.get('operation'),url.searchParams.get('class_id')));
        case 'delete-data':return json(res,await deleteData(db,input,actor.user_id));
        case 'audit':return json(res,(await db.query('SELECT a.*,u.email FROM audit_logs a LEFT JOIN admin_users u ON u.user_id=a.actor_id WHERE a.class_id=$1 OR a.class_id IS NULL ORDER BY a.created_at DESC LIMIT 100',[url.searchParams.get('class_id')?store.uuid(url.searchParams.get('class_id')):null])).rows);
        case 'realtime-config':if(roleOf(actor)==='class_viewer')return json(res,{mode:'polling'});return json(res,{url:process.env.SUPABASE_URL,key:process.env.SUPABASE_ANON_KEY,token:actor.token});
        case 'change-password':{
          if(typeof input.password!=='string'||input.password.length<12||input.password.length>1024)throw new AppError('Mật khẩu mới cần ít nhất 12 ký tự.');
          const client=auth.authClient();const {error:sessionError}=await client.auth.setSession({access_token:actor.token,refresh_token:auth.cookies(req).attendance_refresh});
          if(sessionError)throw new AppError('Vui lòng đăng nhập lại.',401);
          const {error}=await client.auth.updateUser({password:input.password});if(error)throw new AppError('Không đổi được mật khẩu. Hãy thử lại hoặc kiểm tra chính sách Supabase.');
          auth.setSession(res,null);return json(res,{updated:true});
        }
        case 'template':res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="MAU_DS_LOP.csv"');return res.end(csv([['TT','Họ và tên','Ngày sinh','Đơn vị'],[1,'','','']]));
        case 'export':{
          const d=await store.dashboard(db,url.searchParams.get('class_id'),url.searchParams.get('day')||vnDate(),url.searchParams.get('session_id'));
          res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="diem-danh.csv"');
          const labels={present:'Đúng giờ',late:'Đi muộn',pending:'Chưa điểm danh',excused:'Vắng có phép',absent:'Vắng không phép',cancelled:'Phiên hủy'};
          return res.end(csv([['TT','Họ và tên gốc','Tên đã nhập','Đơn vị','Trạng thái','Giờ nhận (Việt Nam)','Phút muộn','Lý do','Tình trạng duyệt','Trùng thiết bị'],
            ...d.rows.map(r=>[r.ordinal,r.name,r.entered_name,r.unit,labels[r.status],r.received_at?new Date(r.received_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'',r.late_minutes,r.reason,r.reason_status,r.duplicate_device?'Có':'']),
            ...d.unmatched.map(r=>['','',r.entered_name,r.entered_unit,'Không khớp / cần kiểm tra',new Date(r.received_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}),'',r.reason,r.reason_status,r.duplicate_device?'Có':''])]));
        }
        default:throw new AppError('Không tìm thấy thao tác.',404);
      }
    }catch(e){
      const expected=e instanceof AppError;
      // Do not log payloads, passwords, tokens or database URLs.
      if(!expected)console.error('API error',{name:e.name,code:e.code||'internal'});
      const status=expected?e.status:e instanceof SyntaxError?400:500;
      return json(res,{status:'error',message:expected?e.message:status===400?'Dữ liệu JSON không hợp lệ.':'Không xử lý được yêu cầu. Vui lòng thử lại hoặc liên hệ quản trị.'},status);
    }
  };
}
function json(res,data,status=200){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));}
module.exports=createHandler();module.exports.createHandler=createHandler;
