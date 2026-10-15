# Hướng dẫn cấu hình và đưa ứng dụng lên chạy

Thực hiện một lần cho bản PostgreSQL. Không cần Google Sheets trong luồng hoạt động mới. Trang điểm danh giữ cấu trúc và CSS gốc, cập nhật câu chữ chung, admin nằm ở `/admin`.

## 1. Tạo project Supabase

1. Mở https://supabase.com/dashboard và tạo project.
2. Chọn vùng gần nơi người tham gia sử dụng. Lưu mật khẩu database vào trình quản lý mật khẩu.
3. Trong **Connect**, lấy URL **Transaction pooler** (cổng thường là 6543). Dùng kết nối pooler cho API Vercel; URL có tên người dùng dạng `postgres.PROJECT_REF`.
4. Lấy **Project URL** và **publishable key / anon key** trong phần API Keys của project. Ứng dụng này không cần đưa service-role key vào trình duyệt.
5. Nếu chứng chỉ TLS cần CA riêng, tải chứng chỉ CA từ Supabase rồi cấu hình `DATABASE_CA_CERT`. Không tắt kiểm tra TLS để xử lý lỗi kết nối production.

Tài liệu: https://supabase.com/docs/guides/database/connecting-to-postgres ; https://supabase.com/docs/guides/auth/passwords

## 2. Tạo bảng và phân quyền

Có hai cách, chọn một:

**Qua SQL Editor của Supabase:** lần lượt chạy toàn bộ:

1. `migrations/001_core.sql` — bảng, index và nhóm mặc định.
2. `migrations/002_supabase_security.sql` — RLS và đăng ký Realtime.
3. `migrations/003_class_viewers.sql` — vai trò tài khoản và quyền xem theo nhóm; tài khoản cũ giữ vai trò admin.
4. `migrations/004_class_viewers_security.sql` — giới hạn đọc Supabase theo vai trò/nhóm được giao.
5. `migrations/005_group_permissions.sql` — quyền nhập danh sách/chỉnh lịch theo nhóm, mặc định tắt.

**Qua máy tính:**

```bash
npm ci
cp .env.example .env.local
```

Điền các biến trong `.env.local` bằng editor:

```dotenv
DATABASE_URL=postgresql://postgres.PROJECT_REF:MAT_KHAU_DA_URL_ENCODE@POOLER_HOST:6543/postgres
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=PUBLISHABLE_HOAC_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=SERVICE_ROLE_KEY_CHI_O_SERVER
APP_ORIGIN=http://localhost:3000
DATABASE_SSL=require
PORT=3000
```

Mật khẩu chứa ký tự như `@`, `#`, `/` cần URL-encode trong URL kết nối. Không thêm `sslmode=no-verify`, không dùng `DATABASE_SSL=disable` trên cloud. Nếu URL có tham số `sslmode`, bỏ tham số đó để cấu hình kiểm chứng TLS của ứng dụng được dùng đầy đủ.

Sau đó chạy:

```bash
npm run migrate
```

Script ghi phiên bản migration để tránh chạy lại phần đã áp dụng. Không commit `.env.local`; không gửi mật khẩu hoặc URL chứa mật khẩu vào chat/GitHub.

## 3. Tạo tài khoản admin bằng mật khẩu

1. Trong Supabase, mở **Authentication → Users**, tạo người dùng bằng email và mật khẩu riêng của bạn, xác nhận email theo luồng quản trị của Supabase.
2. Sao chép User UID của tài khoản vừa tạo.
3. Trong SQL Editor, thay đúng UID và email rồi chạy:

```sql
INSERT INTO public.admin_users (user_id, email)
VALUES ('USER_UID_CUA_BAN', 'EMAIL_CUA_BAN')
ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, enabled = true;
```

4. Tắt đăng ký người dùng công khai trong cấu hình Supabase Auth nếu bạn chỉ tạo tài khoản quản trị thủ công. Người dùng mới dù có tài khoản Auth cũng không được quyền admin nếu chưa có dòng enabled trong `admin_users`.
5. Mở `/admin`, đăng nhập bằng tài khoản trên. Có mục đổi mật khẩu trong trang Tài khoản. Nếu quên mật khẩu, quản trị project đặt lại qua Supabase Authentication.

Quyền hiện tại: tất cả tài khoản enabled trong `admin_users` quản trị toàn bộ các nhóm. Để thu hồi quyền:

```sql
UPDATE public.admin_users SET enabled = false WHERE user_id = 'USER_UID_CAN_THU_HOI';
```

Không dùng lại SQL ví dụ với UID chưa thay. Không có mật khẩu mặc định trong ứng dụng.

## 4. Kiểm tra trên máy

```bash
npm run dev
```

- Người tham gia: http://localhost:3000/
- Admin: http://localhost:3000/admin

Nếu chưa điền database/Auth, ứng dụng hiển thị lỗi chưa cấu hình; không tạo dữ liệu giả thay cho dữ liệu thật. Mật khẩu và khóa database được xử lý ở server.

## 5. Đưa lên Vercel

1. Đưa mã nguồn trong thư mục dự án này vào repo GitHub `ludarao/diemdanh`, giữ cả `package-lock.json`. Không đưa `.local/`, `.env.local` hoặc danh sách người tham gia thật vào repo.
2. Vào Vercel, import repo hoặc cập nhật project hiện tại.
3. Framework Preset: **Other**. Node.js: **22.x hoặc mới hơn**.
4. Build command: `npm run build`; Output directory: `dist`. File `vercel.json` đã đặt các giá trị này cùng route `/api` và `/admin`.
5. Thêm biến môi trường **Production**: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (để cấp tài khoản người quản lý nhóm), `DATABASE_SSL=require`, và `DATABASE_CA_CERT` nếu cần.
6. Đặt `APP_ORIGIN` bằng đúng origin website sẽ dùng, ví dụ `https://ten-project.vercel.app`, không thêm `/admin` hoặc dấu `/` cuối. API ghi dữ liệu chỉ nhận yêu cầu từ origin này.
7. Deploy. Nếu chỉ biết URL sau lần deploy đầu, cập nhật `APP_ORIGIN` rồi redeploy.
8. Nếu dùng domain riêng, dùng domain đó trong `APP_ORIGIN` và luôn truy cập bằng domain đó. Với Preview Deployment, dùng môi trường Supabase thử nghiệm riêng và `APP_ORIGIN` tương ứng để không ghi vào dữ liệu thật.

Không chỉ upload `dist/` lên hosting tĩnh: ứng dụng cần `api/`, `lib/`, `package.json` và database để chạy các chức năng.

## 6. Nhập danh sách và cài vị trí

1. Đăng nhập `/admin` → **Vị trí & cấu hình**.
2. Đặt tên nhóm, mã liên kết, tọa độ, bán kính và sai số GPS tối đa. Có nút lấy GPS tại vị trí hiện tại; kiểm tra tọa độ rồi lưu.
3. Nhóm mặc định dùng URL gốc. Nếu có nhiều nhóm, dùng liên kết hiện trong admin dạng `/?class=ma-lop` khi tạo QR; người tham gia không phải chọn nhóm/phiên trên form.
4. Vào **Danh sách người tham gia**, chọn `MAU_DS_LOP.xlsx` hoặc một file cùng cấu trúc. Bộ đọc tìm sheet chứa cột “Họ và tên”, bỏ qua sheet rỗng. Nhận đúng bốn cột **TT, Họ và tên, Ngày sinh, Đơn vị**.
5. Kiểm tra bản xem trước, tên trùng và lỗi ngày sinh. Chọn thay thế/thêm vào danh sách, đánh dấu xác nhận rồi nhập.
6. Phiên chưa có lượt gửi được đồng bộ khi nhập. Phiên bị rỗng do tạo trước lúc nhập danh sách được tự phục hồi, kể cả đã có lượt gửi; tên chính xác và duy nhất được khớp lại mà không đổi thời gian/lý do gốc. Với phiên đã có danh sách và có lượt gửi, chọn phiên ở Tổng quan rồi dùng **Đồng bộ danh sách vào phiên đang chọn** nếu cần áp dụng; nhập lý do để lưu nhật ký.
7. Vào **Lịch & phiên điểm danh** để chỉnh giờ một ngày hoặc đánh dấu ngày nghỉ. Mặc định tự tạo sáng/chiều theo mẫu khi có truy cập trong ngày; không tự dựng lịch sử những ngày hoàn toàn không có truy cập. Với ngày cần thống kê bắt buộc, tạo lịch trước trong admin.

Tọa độ/bán kính mặc định giữ từ repo: 13.993095, 107.997195, 100m; sai số GPS tối đa 150m. Hãy kiểm tra lại tại vị trí điểm danh trước sử dụng. Khi áp dụng vị trí mới cho phiên đang chạy, người tham gia bấm Quét lại nếu trang đang giữ cài đặt cũ; server luôn kiểm tra theo cấu hình đã lưu.

## 7. Cách đọc dashboard

- Chọn ngày, nhóm và phiên. Trong khung giờ: người chưa gửi là **Chưa điểm danh**. Hết hạn đúng giờ: chuyển thành **Vắng không phép** nếu chưa có mặt/chưa được duyệt phép.
- Nhận muộn sáng đến trước giờ mở chiều; chiều đến hết ngày. Ví dụ 08:00:00 đúng giờ, 08:00:01 muộn. Muộn được tính từ cuối khung giờ.
- Tab **Có lý do** gồm yêu cầu chờ duyệt/đã duyệt/từ chối. Vào Chi tiết để duyệt từng lý do. Báo đi muộn chưa đồng nghĩa có mặt; khi người đó đến và gửi có mặt, thời điểm nhận quyết định số phút muộn.
- Tab **Tên không khớp** lưu tên nhập sai/không tồn tại và tên trùng cần đối chiếu. Gán lại vào đúng người tham gia; tên nguyên bản và giờ gửi vẫn được giữ.
- Tab **Trùng thiết bị** hiện tất cả tên liên quan trong cùng phiên. Có ghi chú xử lý; cảnh báo không tự xóa kết quả có mặt.
- Tab **Ngoài phiên** giữ lượt nhận trước giờ mở, ngày nghỉ hoặc không có lịch phù hợp. Có thể gán thủ công vào phiên sau đối chiếu.
- **Ghi nhận** cho phép quản trị nhập có mặt/vắng có phép, thời điểm và lý do; có nhật ký. Cần nhập giờ thực tế trong khoảng nhận của phiên.
- Đổi lịch đã có dữ liệu yêu cầu xem thông báo số lượt chịu ảnh hưởng trước khi xác nhận. Giữ giờ nhận gốc, phân lại phiên và tính lại đúng giờ/muộn.

## 8. Kiểm tra trước khi chuyển chính thức

- Dùng một nhóm thử, tài khoản thử; gửi đúng tên, sai tên, hai người cùng thiết bị, thử sáng và chiều.
- Kiểm tra tên sai xuất hiện trong danh sách riêng và chưa làm người tham gia gốc thành có mặt.
- Kiểm tra đúng giờ/muộn ở ranh giới, báo vắng rồi đến nhóm, duyệt và từ chối lý do.
- Mở hai cửa sổ admin: lượt gửi mới được cập nhật trực tiếp, có gộp sự kiện để giảm request. Khi Realtime kết nối, đối chiếu mỗi 60 giây; nếu chưa bật/mất kết nối, dự phòng mỗi 15 giây. Hết giờ đúng giờ tự tải lại một lần dù không có lượt gửi mới. Tab ẩn và các mục quản trị khác ngừng tự gọi API dashboard; khi quay lại tải dữ liệu mới.
- Kiểm tra người chưa đăng nhập không đọc/sửa dữ liệu admin, thử GPS ngoài bán kính và sai số quá lớn.
- Đo độ trễ ghi và dashboard khi nhiều người tham gia gửi đồng thời với quy mô nhóm thực tế. Bộ test PGlite cục bộ không xác nhận giới hạn tải production.
- Xuất Sheet cũ ra CSV để sao lưu trước khi chuyển URL. Bản này hỗ trợ nhập danh sách gốc; lịch sử điểm danh Sheet cũ cần đối chiếu phiên/ngày riêng, không được tự suy diễn. Chưa có bộ nhập lịch sử Sheet cũ tự động.
- Chỉ bỏ webhook cũ khỏi triển khai đang dùng sau khi nhóm thử đạt yêu cầu. Giữ bản xuất lịch sử để đối chiếu.

## Tài khoản quản lý nhóm và quyền được cấp

Admin mở **Tài khoản quản lý nhóm → Cấp tài khoản người quản lý nhóm**, nhập email, mật khẩu ít nhất 12 ký tự và chọn nhóm. Bạn tự chuyển thông tin đăng nhập cho người quản lý nhóm; ứng dụng không gửi email và không lưu mật khẩu trong bảng/nhật ký. Người quản lý nhóm đăng nhập ở `/admin`, xem Tổng quan nhóm được giao, lọc ngày/phiên, tìm kiếm và xem chi tiết. Admin có thể cấp thêm quyền nhập danh sách và chỉnh lịch theo hướng dẫn dưới đây. Không có quyền xuất CSV, sửa/duyệt/gán kết quả, quản lý vị trí hoặc xóa dữ liệu. Nhập danh sách/chỉnh lịch chỉ mở khi được admin cấp quyền tương ứng. Không tự đổi mật khẩu; admin cấp lại khi cần.

**Cấu hình khóa để tạo/cấp lại mật khẩu:**

1. Mở Supabase project → Settings → API Keys. Lấy khóa server `service_role` trong phần Legacy API Keys (hoặc secret key server tương ứng). Không dùng anon/publishable key cho chức năng này. [Tài liệu tạo tài khoản của Supabase](https://supabase.com/docs/reference/javascript/auth-admin-createuser).
2. Mở Vercel project → Settings → Environment Variables, thêm tên `SUPABASE_SERVICE_ROLE_KEY` với giá trị khóa đó, chọn **Production** (và Preview nếu bạn dùng môi trường này).
3. Redeploy deployment mới nhất để server nhận biến. Không đưa khóa vào frontend, Git hoặc chat.
4. Trong **Tài khoản quản lý nhóm**, bấm **Kiểm tra kết nối Supabase** để kiểm tra quyền khóa server bằng yêu cầu chỉ đọc. Nút này không tạo tài khoản, không thay đổi dữ liệu và chỉ admin dùng được.
5. Chạy đủ migrations 003, 004 và 005 trước khi cấp tài khoản (`npm run migrate` tự bỏ qua phiên bản đã áp dụng). Nếu dùng SQL Editor thì chạy các file theo thứ tự. Thiếu migration sẽ bị chặn cấp tài khoản; thiếu khóa sẽ có thông báo cấu hình server.

Trong danh sách tài khoản, admin có **Giao / đổi nhóm**, **Khóa / mở khóa**, **Cấp lại mật khẩu**. Chọn “Không giao nhóm” để thu hồi quyền xem mà giữ tài khoản. Việc khóa/gỡ/chuyển nhóm được kiểm tra lại ở mỗi API; nếu đang xem nhóm vừa bị thu hồi, yêu cầu tiếp theo bị chặn và cần đăng nhập lại. Nội dung đã tải trước đó không thể thu hồi khỏi máy người dùng. Cấp lại mật khẩu không hứa hẹn hủy ngay access token cũ; nếu cần chặn ngay, khóa tài khoản trước.

Người quản lý nhóm dùng đối chiếu mỗi **15 giây**, dừng khi tab ẩn; nút Làm mới tải ngay. Không cấp token Realtime qua API cho người quản lý nhóm. Quyền RLS vẫn giới hạn truy vấn trực tiếp tới đúng nhóm. Admin giữ Realtime như trước. Chưa có nhóm được giao thì hiện thông báo và nút kiểm tra quyền; xóa nhóm tự gỡ liên kết quyền xem. Xóa toàn bộ dữ liệu giữ cả tài khoản admin/người quản lý nhóm, nhưng người quản lý nhóm cần được giao nhóm mới.

Kiểm thử bằng ít nhất hai nhóm: người quản lý nhóm A không thấy B qua API hoặc Supabase, không gọi được API ngoài quyền được cấp hoặc API xóa/export, và mất quyền sau khóa/gỡ nhóm; admin vẫn quản lý toàn hệ thống. Các thao tác cấp/giao/khóa/reset có nhật ký, không ghi mật khẩu.

## Bật quyền nhập danh sách và chỉnh lịch

Sau khi chạy migration 005, tài khoản cũ vẫn giữ quyền chỉ xem. Admin mở **Tài khoản quản lý nhóm → Cấp quyền**, chọn nhóm đã giao và bật riêng:

- **Cho nhập và đồng bộ danh sách**: mở Danh sách người tham gia, tải mẫu CSV, xem trước Excel/CSV/dán bảng, nhập thêm/thay thế và đồng bộ vào phiên của đúng nhóm. Không mở quyền sửa/thêm từng người bằng tay.
- **Cho chỉnh lịch ngày và khung giờ mặc định**: mở Lịch & phiên điểm danh, chỉnh giờ riêng ngày hoặc bốn mốc mặc định. Không mở quyền GPS/bán kính/tên/mã nhóm, hủy/mở lại ngày nghỉ hay sửa kết quả điểm danh.

Khi cấp mới/giao lại nhóm, admin cũng có hai ô quyền. Giao sang nhóm khác không tự mang quyền từ nhóm cũ; lựa chọn quyền mới mặc định tắt. Khóa/gỡ/bỏ quyền được kiểm tra lại ở API và trước ghi dữ liệu trong transaction.

Nhập danh sách: chọn đúng nhóm → chọn/dán file → xem trước tên nhóm, số người, phạm vi thêm/thay thế → xác nhận. Chuyển nhóm xóa bản xem trước cũ. Phiên đã có lượt gửi giữ danh sách lịch sử; đồng bộ là thao tác xác nhận riêng, cần chọn phiên trong Tổng quan trước.

Chỉnh lịch: phần trên lưu lịch riêng cho ngày, phần dưới lưu khung mặc định. Đổi mặc định không thay phiên đã tạo hoặc lịch riêng. Nếu ngày đã có lượt gửi, ứng dụng yêu cầu xác nhận trước khi phân lại phiên/tính lại đúng giờ hoặc muộn; giờ gửi gốc vẫn giữ.

URL cũ `?class=...`, tên/mã nhóm, danh sách và tài khoản được giữ. Mẫu tải mới là MAU_DS_DIEM_DANH.csv, vẫn đọc được mẫu bốn cột cũ. Thuật ngữ dùng cho nhóm tham gia họp/tập huấn/làm việc hoặc lớp học; ứng dụng hiện vẫn có hai phiên Sáng và Chiều.

## Xóa dữ liệu và nhóm điểm danh

Trong admin, mở **Quản lý dữ liệu**. Chọn đúng nhóm ở đầu trang trước khi dùng nút theo nhóm.

- **Xóa dữ liệu điểm danh của nhóm**: xóa mọi lượt điểm danh/báo lý do, ghi chú xử lý thiết bị và nhật ký cũ của nhóm; giữ danh sách người tham gia, phiên/lịch và cấu hình vị trí.
- **Xóa nhóm điểm danh này**: xóa nhóm, danh sách người tham gia, mọi phiên/lịch, kết quả và nhật ký của nhóm. Các nhóm khác được giữ.
- **Xóa toàn bộ dữ liệu**: xóa tất cả nhóm và dữ liệu liên quan, nhật ký cũ và bộ đếm giới hạn request. Giữ tài khoản đăng nhập, cấu trúc database và lịch sử migration để vẫn đăng nhập được.

Mỗi lần xóa có bảng số lượng xem trước, yêu cầu đánh dấu đồng ý và nhập chính xác câu xác nhận. Nếu có dữ liệu mới từ lúc xem trước, hệ thống yêu cầu xem lại và xác nhận lại. Xóa diễn ra trong một transaction; lỗi giữa chừng sẽ hoàn tác. Một nhật ký mới ghi nhận thao tác xóa được giữ để kiểm tra. Ứng dụng không có nút hoàn tác; xuất/sao lưu dữ liệu cần giữ trước khi xác nhận.

Nếu xóa nhóm cuối cùng/toàn bộ nhóm, admin chuyển sang màn hình tạo nhóm mới. Tạo nhóm rồi nhập lại danh sách; nhóm đầu tiên tự là nhóm mặc định. Không cần migration hoặc biến môi trường mới cho chức năng này.

## Lỗi khi cấp tài khoản người quản lý nhóm

Lỗi được hiển thị ngay trong hộp thoại, kèm mã lỗi Supabase và HTTP (nếu có). Không xuất thông báo thô chứa dữ liệu nhạy cảm. Server chỉ ghi loại thao tác, mã lỗi và HTTP; không ghi email, mật khẩu hoặc khóa.

- `not_admin`, `bad_jwt`, HTTP 401/403 không có mã: kiểm tra khóa server có quyền Auth, thuộc đúng project của SUPABASE_URL, áp dụng Production và đã redeploy. Ứng dụng phát hiện sớm khóa anon/publishable hoặc JWT sai vai trò/project.
- `weak_password`: mật khẩu chưa đạt chính sách Supabase, dù đủ 12 ký tự của ứng dụng; thêm các nhóm ký tự theo chính sách hoặc dùng mật khẩu khác nếu bị cảnh báo rò rỉ.
- `user_already_exists`, `email_exists`: email đã tồn tại trong Authentication → Users; không xóa tài khoản thật chỉ để thử lại.
- `email_provider_disabled`, `signup_disabled`: kiểm tra cấu hình tạo tài khoản Email.
- `unexpected_failure`, HTTP 5xx: kiểm tra Supabase Auth Logs và trigger trên auth.users; không suy đoán là email trùng.

Bấm **Kiểm tra kết nối Supabase** trước khi thử tạo lại. Kết nối thành công xác nhận quyền của khóa server, không kiểm tra chính sách mật khẩu của một lượt tạo cụ thể. [Danh mục lỗi Supabase](https://supabase.com/docs/guides/auth/debugging/error-codes).

## Xử lý lỗi thường gặp

| Biểu hiện | Kiểm tra |
| --- | --- |
| Chưa cấu hình database/Auth | Biến môi trường và redeploy |
| Yêu cầu không đến từ ứng dụng này | `APP_ORIGIN` có trùng origin URL đang mở không |
| Kết nối database lỗi | Transaction pooler, mật khẩu URL-encode, CA/TLS và network restrictions của Supabase |
| Tài khoản chưa có quyền quản trị | UID trong `admin_users` đúng với Authentication Users, `enabled=true` |
| Realtime không kết nối | Migration 002, publication `supabase_realtime`, cấu hình Realtime project; polling vẫn dự phòng |
| Import không thấy danh sách | File `.xlsx`/CSV, cột “Họ và tên”, tối đa 2 MB và 3000 người tham gia mỗi lượt |
| Tên có dấu nhưng không khớp | So lại dấu/thứ tự từ, tên danh sách phiên, mục tên trùng |
| Có tên trong nhóm nhưng Tổng quan hiện Tất cả (0) | Bản mới tự phục hồi danh sách phiên rỗng khi làm mới dashboard, không cần migration hoặc điểm danh lại. Kiểm tra nhóm đang chọn trùng nhóm đã nhập danh sách; nếu phiên đã có danh sách nhưng thiếu người tham gia mới, dùng Đồng bộ danh sách |
| Điểm danh bị GPS từ chối sau đổi vị trí | Bấm Quét lại để tải cấu hình mới và lấy vị trí mới |
