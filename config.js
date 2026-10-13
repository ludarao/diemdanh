/**
 * CẤU HÌNH HỆ THỐNG ĐIỂM DANH GPS
 * =================================
 * Bạn có thể chỉnh sửa các thông số này phù hợp với lớp học của mình.
 */

const CONFIG = {
  // Tên trường / Lớp / Khóa học hiển thị trên trang
  APP_TITLE: "HỆ THỐNG ĐIỂM DANH LỚP HỌC",
  SUB_TITLE: "Xác thực vị trí GPS thời gian thực",

  // Tọa độ phòng học mục tiêu (Latitude & Longitude)
  // Bạn có thể chỉnh sửa trực tiếp ở đây, hoặc dùng nút "Cài đặt phòng học" trên giao diện web
  CLASSROOM_LAT: 13.993095, // Vĩ độ phòng học (Ví dụ Hà Nội)
  CLASSROOM_LNG: 107.997195, // Kinh độ phòng học (Ví dụ Hà Nội)

  // Bán kính cho phép điểm danh quanh phòng học (tính bằng mét)
  // Khuyên dùng từ 30m - 50m (tùy theo kích thước phòng học và sai số GPS điện thoại)
  ALLOWED_RADIUS_METERS: 100,

  // Ngưỡng sai số GPS tối đa được chấp nhận (mét). Nếu GPS thiết bị quá mờ (sai số > 80m) sẽz báo bật GPS độ chính xác cao
  MAX_GPS_ACCURACY_METERS: 150,

  // Same-origin API. Classroom position/radius are loaded from the database.
  API_URL: "/api",

  // Khóa lưu trữ LocalStorage để tự nhớ MSSV & Họ tên học viên
  STORAGE_KEY: "STUDENT_ATTENDANCE_INFO_V1",
  LOCK_STORAGE_KEY: "ATTENDANCE_DEVICE_LOCK_V2"
};

if (typeof window !== "undefined") {
  window.APP_CONFIG = CONFIG;
}
