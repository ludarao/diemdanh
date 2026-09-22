/**
 * GOOGLE APPS SCRIPT WEBHOOK NHẬN DỮ LIỆU ĐIỂM DANH (CẬP NHẬT MỚI)
 * ================================================================
 * TÍNH NĂNG MỚI:
 * 1. Chống điểm danh hộ qua Device Fingerprint (Mã thiết bị).
 * 2. Tự động phát hiện và cảnh báo đỏ nếu 1 điện thoại điểm danh cho 2 người khác nhau trong cùng ngày.
 * 3. Hỗ trợ điểm danh "Có mặt" hoặc "Vắng có lý do" (kèm nội dung lý do).
 * 4. Trường thông tin: Họ và tên, Đơn vị, Ngày điểm danh.
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000); // Khóa chống nghẽn khi nhiều người gửi cùng lúc

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

    var formattedSubmitTime = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
    var hoTen = (data.hoTen || "").trim();
    var donVi = (data.donVi || "").trim();
    var attendanceDate = (data.attendanceDate || Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy")).trim();
    var status = data.status || "Có mặt"; // "Có mặt" hoặc "Vắng có lý do"
    var absentReason = (data.absentReason || "").trim();
    var deviceId = (data.deviceId || "").trim();
    var distance = data.distance ? parseFloat(data.distance).toFixed(1) : (status === "Vắng có lý do" ? "N/A" : "");
    var latitude = data.latitude || "";
    var longitude = data.longitude || "";
    var accuracy = data.accuracy ? parseFloat(data.accuracy).toFixed(1) : "";
    var userAgent = data.userAgent || "";

    // KIỂM TRA CHỐNG ĐIỂM DANH HỘ (DEVICE FINGERPRINT CHECK)
    var fraudWarning = "Hợp lệ (1 máy/1 người)";
    var isDuplicateDevice = false;

    if (deviceId && sheet.getLastRow() > 1) {
      var allData = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
      for (var i = 0; i < allData.length; i++) {
        var rowDate = String(allData[i][3]); // Cột 4: Ngày điểm danh
        var rowName = String(allData[i][1]); // Cột 2: Họ và tên
        var rowDeviceId = String(allData[i][7]); // Cột 8: Mã thiết bị

        // Nếu trùng DeviceId và cùng Ngày, nhưng tên người khác nhau
        if (rowDeviceId === deviceId && rowDate === attendanceDate && rowName.toLowerCase() !== hoTen.toLowerCase()) {
          fraudWarning = "⚠️ CẢNH BÁO: Trùng thiết bị với " + rowName;
          isDuplicateDevice = true;
          break;
        }
      }
    }

    // Ghi dữ liệu vào hàng mới
    sheet.appendRow([
      formattedSubmitTime, // Cột 1
      hoTen,               // Cột 2
      donVi,               // Cột 3
      attendanceDate,      // Cột 4
      status,              // Cột 5
      absentReason,        // Cột 6
      distance,            // Cột 7
      deviceId,            // Cột 8
      fraudWarning,        // Cột 9
      latitude ? (latitude + ", " + longitude) : "", // Cột 10
      accuracy,            // Cột 11
      userAgent            // Cột 12
    ]);

    var lastRow = sheet.getLastRow();
    
    // Căn giữa các cột thông tin chính
    sheet.getRange(lastRow, 1).setHorizontalAlignment("center");
    sheet.getRange(lastRow, 3).setHorizontalAlignment("center");
    sheet.getRange(lastRow, 4).setHorizontalAlignment("center");
    sheet.getRange(lastRow, 5).setHorizontalAlignment("center");
    sheet.getRange(lastRow, 7).setHorizontalAlignment("center");
    sheet.getRange(lastRow, 8).setHorizontalAlignment("center");

    // Định dạng màu cho Trạng thái
    var statusCell = sheet.getRange(lastRow, 5);
    if (status === "Có mặt") {
      statusCell.setFontColor("#15803d").setFontWeight("bold");
    } else {
      statusCell.setFontColor("#b45309").setFontWeight("bold");
    }

    // Nếu phát hiện trùng lặp thiết bị -> Tô đỏ cảnh báo hàng đó
    var warningCell = sheet.getRange(lastRow, 9);
    if (isDuplicateDevice) {
      warningCell.setBackground("#fee2e2").setFontColor("#b91c1c").setFontWeight("bold");
    } else {
      warningCell.setFontColor("#15803d");
    }

    var response = {
      status: "success",
      message: "Điểm danh thành công!",
      timestamp: formattedSubmitTime,
      isDuplicateDevice: isDuplicateDevice
    };

    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  if (e && e.parameter && (e.parameter.hoTen || e.parameter.donVi)) {
    return doPost(e);
  }
  return ContentService.createTextOutput(JSON.stringify({
    status: "online",
    message: "Google Apps Script Điểm Danh đang chạy bình thường!"
  })).setMimeType(ContentService.MimeType.JSON);
}

// Khởi tạo hàng tiêu đề bảng tính
function initHeader(sheet) {
  var headers = [
    "Thời gian gửi",
    "Họ và tên",
    "Đơn vị",
    "Ngày điểm danh",
    "Trạng thái",
    "Lý do vắng mặt (nếu có)",
    "Khoảng cách (m)",
    "Mã thiết bị (Device ID)",
    "Cảnh báo trùng lặp thiết bị",
    "Tọa độ GPS (Lat, Lng)",
    "Sai số GPS (m)",
    "Thiết bị / Trình duyệt"
  ];
  sheet.appendRow(headers);

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#047857");
  headerRange.setFontColor("#ffffff");
  headerRange.setHorizontalAlignment("center");
  headerRange.setVerticalAlignment("middle");
  sheet.setRowHeight(1, 38);
  sheet.setFrozenRows(1);
}
