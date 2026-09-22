/**
 * GOOGLE APPS SCRIPT WEBHOOK NHẬN DỮ LIỆU ĐIỂM DANH
 * =================================================
 * Hướng dẫn cài đặt vào Google Sheets:
 * 1. Mở trang tính Google Sheets của bạn.
 * 2. Trên thanh menu, chọn: Tiện ích mở rộng (Extensions) -> Apps Script.
 * 3. Xóa hết mã mặc định trong tệp Code.gs, dán toàn bộ nội dung file này vào.
 * 4. Nhấn nút "Triển khai" (Deploy) góc trên bên phải -> "Tùy chọn triển khai mới" (New deployment).
 * 5. Chọn loại: "Ứng dụng web" (Web app).
 *    - Mô tả: Webhook Điểm Danh GPS
 *    - Thực thi dưới dạng (Execute as): Tôi (tài khoản của bạn / Me)
 *    - Ai có quyền truy cập (Who has access): BẤT KỲ AI (Anyone)  <--- Cực kỳ quan trọng!
 * 6. Nhấn "Triển khai" (Deploy), cấp quyền truy cập tài khoản Google khi được hỏi.
 * 7. Sao chép URL Ứng dụng web (kết thúc bằng /exec) và dán vào file config.js (GOOGLE_SCRIPT_WEBHOOK_URL).
 */

// Xử lý yêu cầu POST từ trình duyệt web
function doPost(e) {
  var lock = LockService.getScriptLock();
  // Khóa script tối đa 10 giây để tránh xung đột dữ liệu khi nhiều học viên bấm cùng lúc
  lock.tryLock(10000);

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // Tự động khởi tạo hàng tiêu đề nếu bảng tính còn trống
    if (sheet.getLastRow() === 0) {
      initHeader(sheet);
    }

    var data = {};
    if (e && e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (jsonErr) {
        data = e.parameter || {};
      }
    } else if (e && e.parameter) {
      data = e.parameter;
    }

    // Thời gian điểm danh định dạng theo giờ Việt Nam
    var formattedDate = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");

    var mssv = data.mssv || "";
    var hoTen = data.hoTen || "";
    var lop = data.lop || data.session || "Mặc định";
    var distance = data.distance ? parseFloat(data.distance).toFixed(1) : "";
    var latitude = data.latitude || "";
    var longitude = data.longitude || "";
    var accuracy = data.accuracy ? parseFloat(data.accuracy).toFixed(1) : "";
    var userAgent = data.userAgent || "";

    // Ghi dữ liệu vào hàng tiếp theo
    sheet.appendRow([
      formattedDate,
      mssv,
      hoTen,
      lop,
      distance,
      latitude,
      longitude,
      accuracy,
      userAgent
    ]);

    // Định dạng lại các ô vừa thêm (căn giữa cột thời gian & MSSV)
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, 9).setVerticalAlignment("middle");
    sheet.getRange(lastRow, 1).setHorizontalAlignment("center");
    sheet.getRange(lastRow, 2).setHorizontalAlignment("center");
    sheet.getRange(lastRow, 4).setHorizontalAlignment("center");
    sheet.getRange(lastRow, 5).setHorizontalAlignment("center");

    var response = {
      status: "success",
      message: "Điểm danh thành công!",
      timestamp: formattedDate,
      data: { mssv: mssv, hoTen: hoTen }
    };

    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    var errorResponse = {
      status: "error",
      message: error.toString()
    };
    return ContentService.createTextOutput(JSON.stringify(errorResponse))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// Xử lý yêu cầu GET (dùng để test webhook hoặc fallback)
function doGet(e) {
  if (e && e.parameter && e.parameter.mssv) {
    return doPost(e);
  }
  return ContentService.createTextOutput(JSON.stringify({
    status: "online",
    message: "Google Apps Script Điểm Danh đang hoạt động bình thường!"
  })).setMimeType(ContentService.MimeType.JSON);
}

// Hàm khởi tạo tiêu đề cột
function initHeader(sheet) {
  var headers = [
    "Thời gian",
    "Mã sinh viên",
    "Họ và tên",
    "Lớp / Buổi học",
    "Khoảng cách (m)",
    "Vĩ độ (Lat)",
    "Kinh độ (Lng)",
    "Sai số GPS (m)",
    "Thiết bị / Trình duyệt"
  ];
  sheet.appendRow(headers);

  // Định dạng hàng tiêu đề: In đậm, nền xanh lá đậm, chữ trắng
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#1e7e34");
  headerRange.setFontColor("#ffffff");
  headerRange.setHorizontalAlignment("center");
  headerRange.setVerticalAlignment("middle");
  sheet.setRowHeight(1, 35);
  
  // Cố định hàng đầu tiên
  sheet.setFrozenRows(1);
}
