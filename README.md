# Điểm danh GPS · PostgreSQL & trang admin

Bản nâng cấp từ repo `ludarao/diemdanh` (mốc `44b1ade`). Giao diện học viên dùng nguyên `index.html` và `style.css` gốc; chỉ phần JavaScript gửi/lưu dữ liệu được thay bằng API cùng tên miền. Dashboard quản trị ở `/admin`.

## Chức năng

- PostgreSQL trên Supabase; Vercel phục vụ trang web và API Node.js.
- Admin đăng nhập bằng email/mật khẩu Supabase Auth, cookie HttpOnly, có đăng xuất/đổi mật khẩu.
- Nhập `.xlsx` hoặc CSV theo mẫu `TT | Họ và tên | Ngày sinh | Đơn vị`; xem trước lỗi và tên trùng; thêm/sửa/ngừng sử dụng học viên. Có mẫu CSV để tải và vùng dán bảng Excel.
- Dò tên có dấu, không phân biệt hoa/thường và khoảng trắng thừa. Không tự bỏ dấu, sửa chính tả hoặc ghép tên gần giống. Tên không khớp và tên trùng được lưu để đối chiếu thủ công.
- Sáng đúng giờ 07:00–08:00, muộn sau 08:00 đến trước 13:30. Chiều đúng giờ 13:30–14:00, muộn sau 14:00 đến hết ngày. Dùng giờ server tại Việt Nam.
- Lịch mặc định theo lớp, tự tạo hai phiên trong ngày khi có truy cập; chỉnh riêng từng ngày/ngày nghỉ trên admin. Phiên chỉ xuất hiện ở admin.
- Dashboard theo lớp/ngày/phiên: vắng, có lý do, chưa điểm danh, trùng thiết bị, tên không khớp, ngoài phiên. Có duyệt lý do, ghi nhận thủ công, đối chiếu tên, xuất CSV và nhật ký.
- Chỉnh tọa độ, lấy GPS hiện tại, bán kính cho phép, ngưỡng sai số GPS trong admin. Server tính lại khoảng cách; giữ cấu hình đã áp dụng ở từng lượt gửi.
- Supabase Realtime khi được cấu hình; tự làm mới 2,5 giây làm cơ chế dự phòng và để cập nhật khi hết giờ dù không có lượt gửi mới.

## Chạy và triển khai

Đọc [hướng dẫn cấu hình Supabase và Vercel](docs/HUONG_DAN_TRIEN_KHAI.md). Cần Node.js 22 hoặc mới hơn.

```bash
npm ci
cp .env.example .env.local
# Điền các biến vào .env.local, không commit file này.
npm run migrate
npm run dev
```

Trang học viên: `http://localhost:3000/`. Trang quản trị: `http://localhost:3000/admin`.

```bash
npm test
npm run build
```

`npm run dev` tạo lại `dist/` khi khởi động. Sau khi sửa mã nguồn, khởi động lại để xem bản mới.

## Dữ liệu và quy tắc

- File danh sách thật không được nhúng vào mã nguồn hoặc bản web công khai. Nhập từ admin sau khi đăng nhập. File nguồn của người dùng chỉ được dùng để kiểm tra bộ đọc Excel tại máy làm việc.
- Ngày sinh chỉ nằm trong danh sách quản trị; không trả về API công khai. Học viên không cần mã hay tài khoản.
- Trước hạn đúng giờ: chưa điểm danh. Sau hạn: vắng, và chuyển sang đi muộn nếu nhận được lượt có mặt tiếp theo trong khoảng nhận muộn.
- Báo vắng/đi muộn bằng form cũ tạo yêu cầu có lý do, chưa được coi là có mặt. Admin duyệt phép; nếu sau đó có lượt có mặt thì thời điểm có mặt quyết định đúng giờ/muộn.
- Tên không khớp không làm tăng sĩ số hoặc số có mặt của danh sách gốc. Tên trùng nhiều học viên không tự liên kết; đơn vị/ngày sinh hỗ trợ quản trị đối chiếu.
- Một học viên có thể gửi nhiều lượt; lịch sử được giữ, bảng tổng hợp lấy lần có mặt đầu tiên trong phiên. Retry cùng request ID trả lại cùng biên nhận.
- Cảnh báo trùng thiết bị là cờ đối chiếu, không tự kết luận gian lận. Device ID là dấu hiệu của trình duyệt, không phải định danh phần cứng chắc chắn.
- Ngày do học viên chọn được giữ như thông tin khai báo. Giờ server quyết định phiên, đúng giờ và muộn.
- Lượt ngoài lịch vẫn được lưu sau kiểm tra đầu vào/GPS tương ứng, admin có thể gán lại phiên. Lượt có mặt ngoài bán kính hoặc GPS vượt ngưỡng sẽ bị từ chối như luồng điểm danh gốc.
- Thay danh sách lớp không âm thầm xóa lịch sử phiên đã điểm danh. Admin chọn “Đồng bộ danh sách vào phiên đang chọn” để áp dụng rõ ràng; thao tác có nhật ký.
- Tài khoản trong `admin_users` là quản trị toàn bộ ứng dụng. Phiên bản này chưa có vai trò giảng viên giới hạn theo từng lớp.

## Cấu trúc

- `app.js`, `config.js`: kết nối API, nhận cấu hình lớp và biên nhận server.
- `admin/`: trang quản trị riêng.
- `api/index.js`: API chung; mọi thao tác quản trị cần xác thực.
- `lib/`: luật nghiệp vụ, truy cập database, đăng nhập, đọc Excel.
- `migrations/`: tạo bảng, index, RLS và đăng ký Realtime.
- `tests/`: kiểm thử luật nghiệp vụ/API/PostgreSQL bằng PGlite, gồm giữ nguyên HTML/CSS.
- `google_apps_script.js`: mã cũ chỉ để đối chiếu; không còn được gọi và không đưa vào `dist/`.

## Phạm vi kiểm chứng

Đã kiểm thử cục bộ nghiệp vụ trên PostgreSQL nhúng PGlite, đọc file mẫu 80 học viên, kiểm tra API từ chối truy cập ẩn danh và thao tác admin qua trình duyệt với dữ liệu giả. Các bài kiểm thử đồng thời cục bộ kiểm tra tính idempotent nhưng không thay thế đo tải nhiều kết nối PostgreSQL thật.

Cần kiểm tra Supabase Auth, TLS/pooler, Realtime và Vercel trên project thật sau khi cấu hình; chưa có tài khoản/project nên chưa triển khai cloud. Bản kiểm thử giao diện dùng dữ liệu giả tại máy, không phải database production.
