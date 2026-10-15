# Điểm danh · PostgreSQL & trang quản trị

Phần mềm điểm danh chung cho lớp học, họp, tập huấn hoặc nhóm làm việc, nâng cấp từ repo `ludarao/diemdanh`. Đơn vị tổ chức là **nhóm điểm danh**, danh sách gồm **người tham gia**, mỗi khung thời gian là một **phiên điểm danh**. Trang điểm danh giữ cấu trúc và CSS gốc, cập nhật câu chữ chung; dashboard ở `/admin`.

## Chức năng

- PostgreSQL trên Supabase; Vercel phục vụ web và API Node.js. Luồng hoạt động mới không dùng Google Sheets.
- Admin đăng nhập Supabase Auth bằng email/mật khẩu, cookie HttpOnly. Cấp/giao/khóa tài khoản quản lý nhóm, cấp lại mật khẩu, quản lý toàn hệ thống.
- Người quản lý mặc định chỉ xem nhóm được giao. Admin cấp riêng **Nhập và đồng bộ danh sách** và **Chỉnh lịch ngày/khung giờ mặc định** cho từng nhóm. API kiểm tra quyền trước khi ghi; RLS giới hạn đọc theo nhóm và chặn ghi trực tiếp.
- Người quản lý không duyệt lý do, sửa/gán kết quả, ghi nhận thủ công, sửa từng người bằng tay, xuất CSV, sửa GPS/bán kính, quản lý tài khoản hoặc xóa nhóm/dữ liệu.
- Nhập Excel/CSV hoặc dán bảng theo mẫu `TT | Họ và tên | Ngày sinh | Đơn vị`; xem trước lỗi/tên trùng và phạm vi trước xác nhận nhập thêm/thay thế. Ngày sinh và Đơn vị trong danh sách có thể trống. Mẫu cũ vẫn được đọc.
- Dò tên có dấu, không phân biệt hoa/thường/khoảng trắng thừa; giữ tên sai/tên trùng để admin đối chiếu, không tự ghép gần giống.
- Mặc định sáng 07:00–08:00 và chiều 13:30–14:00 là đúng giờ. Sáng nhận muộn đến trước giờ mở chiều, chiều đến hết ngày; dùng giờ server Việt Nam.
- Lịch riêng từng ngày và bốn mốc giờ mặc định. Đổi mặc định chỉ ảnh hưởng phiên tự tạo sau đó; lịch riêng/phiên đã tạo được giữ. Đổi lịch có lượt gửi cần xác nhận và ghi nhật ký. Chỉ admin hủy/mở lại ngày không tổ chức điểm danh.
- Dashboard theo nhóm/ngày/phiên: vắng, có lý do, chưa điểm danh, trùng thiết bị, tên không khớp, ngoài phiên. Admin có xử lý/duyệt, xuất CSV và nhật ký.
- Admin chỉnh vị trí/bán kính/sai số GPS. Server kiểm tra lại GPS và giữ cấu hình đã áp dụng ở từng lượt gửi.
- Admin dùng Realtime khi được cấu hình, đối chiếu mỗi 60 giây hoặc dự phòng 15 giây. Quản lý nhóm dùng đối chiếu 15 giây. Dừng tự tải dashboard khi tab ẩn hoặc mở mục quản trị khác.
- **Quản lý dữ liệu**: xóa kết quả một nhóm, xóa nhóm hoặc toàn bộ dữ liệu; có xem trước, nhập câu xác nhận và transaction hoàn tác khi lỗi. Giữ tài khoản để tạo/giao nhóm lại.

## Chạy và triển khai

Đọc [hướng dẫn cấu hình và cấp quyền](docs/HUONG_DAN_TRIEN_KHAI.md). Cần Node.js 22+.

```bash
npm ci
cp .env.example .env.local
# Điền biến trong editor, không commit secrets.
npm run migrate
npm test
npm run build
npm run dev
```

Trang điểm danh: `http://localhost:3000/`. Admin/quản lý nhóm: `http://localhost:3000/admin`.

Cần migrations 001–005. Bản đang nâng cấp cần thêm `005_group_permissions.sql`; các quyền mới mặc định tắt. Admin mở **Tài khoản quản lý nhóm → Cấp quyền** để bật cho tài khoản hiện có. Không cần khóa mới cho việc cấp thêm quyền; `SUPABASE_SERVICE_ROLE_KEY` ở server dùng để tạo/cấp lại mật khẩu tài khoản.

## Dữ liệu và tương thích

- URL `?class=...`, mã/tên nhóm người dùng đã tạo, tài khoản và dữ liệu cũ được giữ. Không đổi tên bảng classes/students/class_viewers để đổi nhãn.
- Bảng tổng hợp lấy lần có mặt đầu tiên của từng người/phiên; giữ lịch sử lượt gửi. Retry cùng request ID không tạo thêm bản ghi.
- Nhập danh sách không âm thầm thay snapshot của phiên đã có lượt gửi. Người có quyền chọn đồng bộ để áp dụng cho đúng phiên. Snapshot rỗng được tự phục hồi; giữ tên nhập, giờ gửi, lý do và tình trạng duyệt.
- Ngày sinh không trả qua API công khai. File danh sách thật không nhúng vào mã nguồn/build; `.local/` bị loại khỏi Git.
- Cảnh báo thiết bị là dấu hiệu cần đối chiếu, không tự kết luận gian lận. GPS do trình duyệt cung cấp vẫn cần kiểm chứng theo quy trình thực tế.
- Chưa có bộ nhập tự động lịch sử Google Sheets cũ, thêm phiên thứ ba hoặc đo tải production. Kiểm thử PGlite/fixture cục bộ không thay thế đo tải PostgreSQL thật.
