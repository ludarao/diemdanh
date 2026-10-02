/**
 * GOOGLE APPS SCRIPT WEBHOOK NHẬN DỮ LIỆU ĐIỂM DANH (ĐÃ SỬA LỖI GHI TRÙNG)
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (lockErr) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "busy",
      message: "Hệ thống đang quá tải, vui lòng gửi lại sau 3 giây!"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
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
    var hoTen = String(data.hoTen || "").trim();
    var donVi = String(data.donVi || "").trim();
    var attendanceDate = String(data.attendanceDate || Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy")).trim();
    var status = data.status || "Có mặt";
    var absentReason = String(data.absentReason || "").trim();
    var deviceId = String(data.deviceId || "").trim();
    var distance = data.distance ? parseFloat(data.distance).toFixed(1) : (status === "Vắng có lý do" ? "N/A" : "");
    var latitude = data.latitude || "";
    var longitude = data.longitude || "";
    var accuracy = data.accuracy ? parseFloat(data.accuracy).toFixed(1) : "";
    var userAgent = data.userAgent || "";

    var lastRowIndex = sheet.getLastRow();

    // =========================================================
    // 🛑 CHỐNG GHI TRÙNG DỮ LIỆU KHI BẤM NỘP ĐÚP LẦN
    // =========================================================
    if (lastRowIndex >= 2) {
      var lastRowValues = sheet.getRange(lastRowIndex, 1, 1, 8).getDisplayValues()[0];
      var lastSubmitTime = lastRowValues[0]; // Cột A: Thời gian gửi
      var lastName = String(lastRowValues[1]).trim().toLowerCase(); // Cột B: Họ tên
      var lastDeviceId = String(lastRowValues[7]).trim(); // Cột H: Device ID

      // Nếu cùng Họ tên + cùng Device ID + cùng Thời gian (hoặc vừa ghi xong)
      if (lastName === hoTen.toLowerCase() && lastDeviceId === deviceId && lastSubmitTime === formattedSubmitTime) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          message: "Điểm danh thành công (đã ghi nhận)!"
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // =========================================================
    // 1. KIỂM TRA TRÙNG THIẾT BỊ TRONG NGÀY
    // =========================================================
    var fraudWarning = "Hợp lệ (1 máy/1 người)";
    var isDuplicateDevice = false;

    if (deviceId && lastRowIndex >= 2) {
      var allData = sheet.getRange(2, 1, lastRowIndex - 1, 12).getDisplayValues();
      
      for (var i = 0; i < allData.length; i++) {
        var rowName = String(allData[i][1]).trim();       // Cột B: Họ và tên
        var rowDate = String(allData[i][3]).trim();       // Cột D: Ngày điểm danh
        var rowDeviceId = String(allData[i][7]).trim();   // Cột H: Mã thiết bị

        // Nếu CÙNG DeviceId + CÙNG Ngày điểm danh + KHÁC Tên người
        if (rowDeviceId === deviceId && rowDate === attendanceDate && rowName.toLowerCase() !== hoTen.toLowerCase()) {
          fraudWarning = "⚠️ CẢNH BÁO: Trùng thiết bị với " + rowName;
          isDuplicateDevice = true;
          break;
        }
      }
    }

    // =========================================================
    // 2. KIỂM TRA PHÁT HIỆN HỌC VIÊN ĐỔI THIẾT BỊ LIÊN TỤC
    // =========================================================
    var isFrequentDeviceChanger = false;
    var usedDevicesList = [];

    if (lastRowIndex >= 2) {
      var allHistory = sheet.getRange(2, 1, lastRowIndex - 1, 8).getDisplayValues();
      
      for (var k = 0; k < allHistory.length; k++) {
        var hName = String(allHistory[k][1]).trim().toLowerCase();
        var hDeviceId = String(allHistory[k][7]).trim();

        if (hName === hoTen.toLowerCase() && hDeviceId !== "") {
          if (usedDevicesList.indexOf(hDeviceId) === -1) {
            usedDevicesList.push(hDeviceId);
          }
        }
      }

      if (deviceId && usedDevicesList.indexOf(deviceId) === -1) {
        usedDevicesList.push(deviceId);
      }

      if (usedDevicesList.length >= 3) {
        isFrequentDeviceChanger = true;
        if (isDuplicateDevice) {
          fraudWarning += " | 🚨 NGHI VẤN: Đổi máy " + usedDevicesList.length + " lần!";
        } else {
          fraudWarning = "🚨 NGHI VẤN: Đổi máy " + usedDevicesList.length + " lần!";
        }
      }
    }

    // =========================================================
    // 3. GHI DỮ LIỆU DUY NHẤT 1 LẦN VÀO SHEET
    // =========================================================
    sheet.appendRow([
      formattedSubmitTime, // Cột 1 (A)
      hoTen,               // Cột 2 (B)
      donVi,               // Cột 3 (C)
      attendanceDate,      // Cột 4 (D)
      status,              // Cột 5 (E)
      absentReason,        // Cột 6 (F)
      distance,            // Cột 7 (G)
      deviceId,            // Cột 8 (H)
      fraudWarning,        // Cột 9 (I)
      latitude ? (latitude + ", " + longitude) : "", // Cột 10 (J)
      accuracy,            // Cột 11 (K)
      userAgent            // Cột 12 (L)
    ]);

    var newLastRow = sheet.getLastRow();

    // Căn giữa các cột thông tin
    sheet.getRange(newLastRow, 1).setHorizontalAlignment("center");
    sheet.getRange(newLastRow, 3, 1, 3).setHorizontalAlignment("center");
    sheet.getRange(newLastRow, 7, 1, 3).setHorizontalAlignment("center");

    // Định dạng màu Trạng thái
    var statusCell = sheet.getRange(newLastRow, 5);
    if (status === "Có mặt") {
      statusCell.setFontColor("#15803d").setFontWeight("bold");
    } else {
      statusCell.setFontColor("#b45309").setFontWeight("bold");
    }

    // Tô màu cảnh báo
    var warningCell = sheet.getRange(newLastRow, 9);
    if (isDuplicateDevice || isFrequentDeviceChanger) {
      warningCell.setBackground("#fee2e2").setFontColor("#b91c1c").setFontWeight("bold");
      sheet.getRange(newLastRow, 1, 1, 12).setBackground("#fff1f2"); // Tô màu đỏ nhạt nguyên hàng
    } else {
      warningCell.setFontColor("#15803d");
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Điểm danh thành công!",
      isDuplicateDevice: isDuplicateDevice
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
