# 📍 HỆ THỐNG ĐIỂM DANH GPS KẾT NỐI GOOGLE SHEETS & DEPLOY VERCEL

Hệ thống cho phép học viên quét mã QR tại lớp để mở trang Web điểm danh, trình duyệt tự động kiểm tra tọa độ GPS xem học viên có thực sự đang ngồi trong phòng học (bán kính <= 30-40m) hay không. Nếu hợp lệ, thông tin sẽ được gửi tức thì về Google Sheets của giảng viên.

---

## 🚀 QUY TRÌNH TRIỂN KHAI (4 BƯỚC ĐƠN GIẢN)

### BƯỚC 1: Cài đặt Google Apps Script trên Google Sheets

1. Tạo một bảng tính mới trên [Google Sheets](https://sheets.google.com).
2. Trên thanh menu, chọn: **Tiện ích mở rộng** (*Extensions*) ➔ **Apps Script**.
3. Xóa hết mã hiện có trong file `Code.gs`, mở file `google_apps_script.js` trong thư mục này và sao chép toàn bộ nội dung dán vào.
4. Bấm nút **Triển khai** (*Deploy*) ở góc trên bên phải ➔ chọn **Tùy chọn triển khai mới** (*New deployment*).
5. Bấm vào biểu tượng bánh răng ⚙️ bên cạnh "Chọn loại", chọn **Ứng dụng web** (*Web app*):
   - **Mô tả**: `Webhook Điểm danh GPS`
   - **Thực thi dưới dạng** (*Execute as*): `Tôi (tài khoản email của bạn / Me)`
   - **Ai có quyền truy cập** (*Who has access*): **`Bất kỳ ai (Anyone)`** *(Lưu ý: Bắt buộc chọn dòng này để học viên gửi được điểm danh không cần đăng nhập).*
6. Bấm **Triển khai** (*Deploy*) và tiến hành cấp quyền truy cập tài khoản Google khi xuất hiện bảng thông báo.
7. Sau khi triển khai xong, Google sẽ cung cấp cho bạn một **URL Ứng dụng web** (có dạng `https://script.google.com/macros/s/AKfycb.../exec`). **Sao chép URL này**.

---

### BƯỚC 2: Cấu hình tọa độ phòng học & Link Webhook vào `config.js`

Mở file `config.js` trong thư mục này và cập nhật 3 thông số:

```javascript
const CONFIG = {
  // 1. Tọa độ phòng học (Vĩ độ & Kinh độ)
  CLASSROOM_LAT: 21.028511, // Thay bằng vĩ độ phòng học thực tế
  CLASSROOM_LNG: 105.854444, // Thay bằng kinh độ phòng học thực tế

  // 2. Bán kính cho phép (mét) - thường đặt 30m - 50m
  ALLOWED_RADIUS_METERS: 40,

  // 3. Dán URL Webhook bạn vừa sao chép ở Bước 1 vào đây:
  GOOGLE_SCRIPT_WEBHOOK_URL: "https://script.google.com/macros/s/AKfycb.../exec"
};
```

> 💡 **Mẹo lấy tọa độ phòng học cực nhanh:**
> - Bạn chỉ cần đứng tại phòng học, mở trang web trên điện thoại của bạn, bấm vào dòng **"⚙️ Cài đặt tọa độ phòng học"** ở dưới chân trang rồi bấm nút **"📍 Lấy tọa độ vị trí bạn đang đứng"**. Trang web sẽ hiển thị ngay số vĩ độ/kinh độ chính xác để bạn copy vào `config.js`!

---

### BƯỚC 3: Deploy lên Vercel (Miễn phí 100%)

Bạn có thể chọn 1 trong 2 cách sau:

#### Cách 1: Deploy trực tiếp qua giao diện Web Vercel (Khuyên dùng - Đơn giản nhất)
1. Đẩy thư mục này lên một kho lưu trữ GitHub cá nhân của bạn (private hoặc public đều được).
2. Truy cập [vercel.com](https://vercel.com) và đăng nhập bằng tài khoản GitHub.
3. Bấm nút **"Add New..."** ➔ **"Project"**.
4. Chọn repository bạn vừa tạo và bấm **"Import"**.
5. Giữ nguyên toàn bộ cấu hình mặc định và bấm nút **"Deploy"**.
6. Sau khoảng 10 giây, Vercel sẽ cấp cho bạn một đường link chính thức (Ví dụ: `https://diem-danh-gps.vercel.app`).

#### Cách 2: Deploy bằng dòng lệnh Terminal (Vercel CLI)
Chạy lệnh sau ngay tại thư mục dự án:
```bash
npx vercel
```
- Làm theo hướng dẫn trên màn hình:
  - `Set up and deploy?` ➔ Nhập `y` (Enter)
  - `Which scope do you want to deploy to?` ➔ Chọn tài khoản của bạn (Enter)
  - `Link to existing project?` ➔ Nhập `n` (Enter)
  - `What's your project's name?` ➔ Đặt tên (hoặc Enter lấy mặc định)
  - `In which directory is your code located?` ➔ Nhập `./` (Enter)
- Khi muốn deploy bản chính thức (Production):
```bash
npx vercel --prod
```

---

### BƯỚC 4: Tạo mã QR cho lớp học quét

1. Lấy đường link Vercel đã deploy ở Bước 3.
2. Bạn có thể gắn thêm tên buổi học hoặc tên lớp vào link để phân loại dữ liệu trong Google Sheets, ví dụ:
   - `https://diem-danh-gps.vercel.app/?session=Buoi-1&class=LLCT-K12`
   - `https://diem-danh-gps.vercel.app/?session=Buoi-2`
3. Truy cập các trang tạo QR miễn phí như [me-qr.com](https://me-qr.com) hoặc [qr-code-generator.com](https://www.qr-code-generator.com/) để tạo mã QR từ đường link trên.
4. Trình chiếu mã QR lên máy chiếu trên bục giảng để học viên quét bằng camera điện thoại.

---

## 📊 DỮ LIỆU ĐƯỢC GHI VÀO GOOGLE SHEETS
Mỗi khi có học viên bấm điểm danh hợp lệ, Google Sheets sẽ tự động thêm 1 dòng:
- **Thời gian**: Ngày giờ chính xác theo múi giờ Việt Nam (`dd/MM/yyyy HH:mm:ss`)
- **Mã sinh viên**: MSSV của người điểm danh
- **Họ và tên**: Tên học viên
- **Lớp / Buổi học**: Tên buổi được truyền qua URL hoặc học viên nhập
- **Khoảng cách (m)**: Khoảng cách từ vị trí học viên tới tâm phòng học (ví dụ: `12.4`)
- **Vĩ độ & Kinh độ**: Tọa độ GPS thực tế của máy học viên lúc bấm nút
- **Sai số GPS (m)**: Độ chính xác của thiết bị (thường từ 5m - 20m)
- **Thiết bị / Trình duyệt**: Thông tin dòng máy học viên sử dụng (User-Agent)

---

## 🛡️ CÁC TÍNH NĂNG BẢO MẬT & CHỐNG GIAN LẬN
1. **Chống điểm danh hộ từ xa**: Trình duyệt dùng GPS phần cứng của điện thoại kết hợp công thức khoảng cách Haversine. Nếu học viên ở nhà hoặc ngoài khuôn viên, nút điểm danh sẽ bị khóa hoàn toàn.
2. **Kiểm tra độ chính xác GPS**: Hệ thống cảnh báo và từ chối nếu thiết bị cố tình fake GPS kém hoặc tín hiệu sai số quá lớn (> 80m).
3. **Chống spam**: Google Apps Script tích hợp `LockService` chống nghẽn hàng đợi khi toàn bộ lớp 100+ học viên bấm điểm danh cùng một giây.
4. **Tiện lợi cho học viên**: Tự động lưu MSSV & Họ tên vào điện thoại sau lần đầu tiên, các buổi học sau học viên chỉ cần quét mã và bấm 1 chạm là xong.
