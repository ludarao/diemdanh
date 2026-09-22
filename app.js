/**
 * APP ĐIỂM DANH GPS & NHẬN DIỆN THIẾT BỊ (ANTI-PROXY)
 */

(function () {
  "use strict";

  const config = window.APP_CONFIG || {
    CLASSROOM_LAT: 21.028511,
    CLASSROOM_LNG: 105.854444,
    ALLOWED_RADIUS_METERS: 40,
    MAX_GPS_ACCURACY_METERS: 80,
    GOOGLE_SCRIPT_WEBHOOK_URL: "",
    STORAGE_KEY: "STUDENT_ATTENDANCE_INFO_V2",
    LOCK_STORAGE_KEY: "ATTENDANCE_DEVICE_LOCK_V2"
  };

  // Trạng thái hiện tại
  let currentStatus = "Có mặt"; // "Có mặt" hoặc "Vắng có lý do"
  let currentDeviceId = "";

  let currentUserLocation = {
    lat: null,
    lng: null,
    accuracy: null,
    distance: null,
    isValid: false
  };

  // DOM Elements
  const appTitleEl = document.getElementById("appTitle");
  const appSubtitleEl = document.getElementById("appSubtitle");
  const labelStatusPresent = document.getElementById("labelStatusPresent");
  const labelStatusAbsent = document.getElementById("labelStatusAbsent");
  const radioStatusInputs = document.querySelectorAll('input[name="attendanceStatus"]');
  const absentReasonGroup = document.getElementById("absentReasonGroup");
  const absentReasonInput = document.getElementById("absentReason");

  const gpsStatusBox = document.getElementById("gpsStatusBox");
  const gpsStatusText = document.getElementById("gpsStatusText");
  const gpsDetailText = document.getElementById("gpsDetailText");
  const btnRefreshGps = document.getElementById("btnRefreshGps");

  const attendanceForm = document.getElementById("attendanceForm");
  const fullNameInput = document.getElementById("fullName");
  const donViInput = document.getElementById("donVi");
  const attendanceDateInput = document.getElementById("attendanceDate");
  const displayDeviceId = document.getElementById("displayDeviceId");

  const btnSubmit = document.getElementById("btnSubmit");
  const btnSubmitText = document.getElementById("btnSubmitText");
  const btnSpinner = document.getElementById("btnSpinner");

  // Success Screen
  const successScreen = document.getElementById("successScreen");
  const successTitle = document.getElementById("successTitle");
  const successSubtitle = document.getElementById("successSubtitle");
  const successIconWrap = document.getElementById("successIconWrap");
  const receiptName = document.getElementById("receiptName");
  const receiptDonVi = document.getElementById("receiptDonVi");
  const receiptDate = document.getElementById("receiptDate");
  const receiptStatus = document.getElementById("receiptStatus");
  const receiptReasonRow = document.getElementById("receiptReasonRow");
  const receiptReason = document.getElementById("receiptReason");
  const receiptDeviceId = document.getElementById("receiptDeviceId");
  const receiptTime = document.getElementById("receiptTime");

  // 1. Khởi tạo ứng dụng
  async function init() {
    if (config.APP_TITLE && appTitleEl) appTitleEl.textContent = config.APP_TITLE;
    if (config.SUB_TITLE && appSubtitleEl) appSubtitleEl.textContent = config.SUB_TITLE;

    // Thiết lập ngày hôm nay làm mặc định (định dạng YYYY-MM-DD cho input date)
    initTodayDate();

    // Tạo mã nhận diện phần cứng thiết bị (Device Fingerprint)
    currentDeviceId = await getOrCreateDeviceFingerprint();
    if (displayDeviceId) {
      displayDeviceId.textContent = currentDeviceId;
    }

    // Khôi phục họ tên & đơn vị đã lưu từ lần trước
    restoreSavedInfo();

    // Kiểm tra xem máy này hôm nay đã điểm danh chưa
    checkDeviceLockToday();

    // Thiết lập sự kiện chuyển đổi Có mặt / Vắng
    setupStatusSwitcher();

    // Bắt đầu quét GPS
    requestGpsLocation();

    // Gán sự kiện
    btnRefreshGps.addEventListener("click", () => requestGpsLocation(true));
    attendanceForm.addEventListener("submit", handleFormSubmit);
  }

  // Khởi tạo ngày mặc định là hôm nay
  function initTodayDate() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    attendanceDateInput.value = `${yyyy}-${mm}-${dd}`;
  }

  // Định dạng ngày hiển thị dd/MM/yyyy
  function formatDateVN(dateStr) {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  }

  // 2. Tạo Device Fingerprint độc nhất cho từng thiết bị
  async function getOrCreateDeviceFingerprint() {
    const storageKey = "DEVICE_PERMANENT_ID_V2";
    let savedId = localStorage.getItem(storageKey);
    if (savedId) {
      return savedId;
    }

    // Thu thập các thông số phần cứng đặc trưng
    const components = [
      navigator.userAgent,
      screen.width + "x" + screen.height + "x" + screen.colorDepth,
      window.devicePixelRatio || 1,
      navigator.language || "",
      navigator.hardwareConcurrency || 2,
      Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      navigator.maxTouchPoints || 0,
      getCanvasHash()
    ];

    const rawString = components.join("###");
    const hash = simpleHash(rawString);
    const newId = "DEV-" + hash.toUpperCase();

    try {
      localStorage.setItem(storageKey, newId);
    } catch (e) {
      console.warn("Không thể lưu LocalStorage:", e);
    }

    return newId;
  }

  // Thuật toán băm Canvas Fingerprint
  function getCanvasHash() {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 40;
      const ctx = canvas.getContext("2d");
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = "#f60";
      ctx.fillRect(100, 1, 50, 18);
      ctx.fillStyle = "#069";
      ctx.fillText("ATTEND_GPS", 2, 12);
      return canvas.toDataURL().slice(-40);
    } catch (e) {
      return "no_canvas";
    }
  }

  // Hàm băm FNV-1a tạo chuỗi hash ngắn 8 ký tự
  function simpleHash(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  // Kiểm tra khóa thiết bị (chống dùng 1 máy điểm danh nhiều lần trong ngày)
  function checkDeviceLockToday() {
    try {
      const lockDataStr = localStorage.getItem(config.LOCK_STORAGE_KEY);
      if (lockDataStr) {
        const lockData = JSON.parse(lockDataStr);
        const todayStr = attendanceDateInput.value;
        if (lockData.date === todayStr) {
          // Đã điểm danh hôm nay -> Hiện luôn màn hình biên nhận
          showSuccessScreen(lockData, true);
        }
      }
    } catch (e) {
      console.warn("Lỗi kiểm tra khóa máy:", e);
    }
  }

  // 3. Xử lý chuyển đổi Có mặt / Vắng có lý do
  function setupStatusSwitcher() {
    radioStatusInputs.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        currentStatus = e.target.value;

        if (currentStatus === "Có mặt") {
          labelStatusPresent.classList.add("active");
          labelStatusAbsent.classList.remove("active");
          absentReasonGroup.style.display = "none";
          absentReasonInput.required = false;
          btnSubmit.classList.remove("btn-absent");

          // Cập nhật lại trạng thái nút theo GPS
          updateSubmitButtonState();
          gpsStatusBox.style.display = "flex";
        } else {
          labelStatusAbsent.classList.add("active");
          labelStatusPresent.classList.remove("active");
          absentReasonGroup.style.display = "block";
          absentReasonInput.required = true;
          btnSubmit.classList.add("btn-absent");

          // Báo vắng không bắt buộc GPS phòng học
          btnSubmit.disabled = false;
          btnSubmitText.textContent = "Gửi Báo Vắng Có Lý Do";

          updateGpsUI(
            "info",
            "ℹ️ Chế độ Báo vắng có lý do",
            "Không yêu cầu bạn phải có mặt tại phòng học. Vị trí hiện tại vẫn được ghi nhận để lưu vết."
          );
        }
      });
    });
  }

  // 4. Định vị GPS & Tính khoảng cách Haversine
  function getHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) *
      Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  function requestGpsLocation(isManual = false) {
    if (!navigator.geolocation) {
      updateGpsUI("error", "Trình duyệt không hỗ trợ GPS", "Vui lòng mở trên Safari hoặc Chrome trên điện thoại.");
      return;
    }

    if (currentStatus === "Có mặt") {
      updateGpsUI("loading", "Đang xác thực vị trí GPS...", "Vui lòng cho phép quyền vị trí trên điện thoại.");
      btnSubmit.disabled = true;
      btnSubmitText.textContent = "Đang kiểm tra vị trí...";
    }

    const geoOptions = {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        handleGpsSuccess(position);
      },
      (error) => {
        handleGpsError(error);
      },
      geoOptions
    );
  }

  function handleGpsSuccess(position) {
    const coords = position.coords;
    const userLat = coords.latitude;
    const userLng = coords.longitude;
    const accuracy = coords.accuracy;

    const distance = getHaversineDistanceMeters(
      userLat,
      userLng,
      config.CLASSROOM_LAT,
      config.CLASSROOM_LNG
    );

    currentUserLocation = {
      lat: userLat,
      lng: userLng,
      accuracy: accuracy,
      distance: distance,
      isValid: false
    };

    const distRounded = Math.round(distance);
    const accRounded = Math.round(accuracy);

    if (distance <= config.ALLOWED_RADIUS_METERS) {
      currentUserLocation.isValid = true;
      if (currentStatus === "Có mặt") {
        updateGpsUI(
          "success",
          `🟢 Vị trí hợp lệ (~${distRounded}m)`,
          `Bạn đang cách phòng học khoảng <b>${distRounded}m</b> (Bán kính cho phép: ${config.ALLOWED_RADIUS_METERS}m, Sai số GPS: ±${accRounded}m).`
        );
      }
    } else {
      currentUserLocation.isValid = false;
      if (currentStatus === "Có mặt") {
        updateGpsUI(
          "error",
          `🔴 Ngoài phạm vi phòng học (~${distRounded}m)`,
          `Khoảng cách hiện tại: <b>${distRounded}m</b>. Yêu cầu có mặt trong phòng học (tối đa <b>${config.ALLOWED_RADIUS_METERS}m</b>).`
        );
      }
    }

    updateSubmitButtonState();
  }

  function handleGpsError(error) {
    let message = "Không thể lấy vị trí GPS.";
    let detail = "Vui lòng kiểm tra quyền vị trí.";

    switch (error.code) {
      case error.PERMISSION_DENIED:
        message = "🔴 Chưa cấp quyền vị trí";
        detail = "Bạn đã từ chối quyền GPS. Vui lòng vào Cài đặt trình duyệt -> Cấp quyền 'Vị trí' rồi bấm Quét lại.";
        break;
      case error.POSITION_UNAVAILABLE:
        message = "🔴 Không có tín hiệu GPS";
        detail = "Hãy chắc chắn máy đã bật Định vị (Location Services).";
        break;
      case error.TIMEOUT:
        message = "🟡 Quá thời gian định vị";
        detail = "Tín hiệu GPS yếu. Vui lòng bấm 'Quét lại' hoặc di chuyển ra gần cửa sổ.";
        break;
    }

    currentUserLocation.isValid = false;
    if (currentStatus === "Có mặt") {
      updateGpsUI("error", message, detail);
    }
    updateSubmitButtonState();
  }

  function updateGpsUI(state, title, detail) {
    gpsStatusBox.className = `gps-box ${state}`;
    gpsStatusText.textContent = title;
    gpsDetailText.innerHTML = detail;
  }

  function updateSubmitButtonState() {
    if (currentStatus === "Vắng có lý do") {
      btnSubmit.disabled = false;
      btnSubmitText.textContent = "Gửi Báo Vắng Có Lý Do";
    } else {
      if (currentUserLocation.isValid) {
        btnSubmit.disabled = false;
        btnSubmitText.textContent = "Xác nhận Có mặt ngay";
      } else {
        btnSubmit.disabled = true;
        btnSubmitText.textContent = "Vị trí chưa hợp lệ";
      }
    }
  }

  // 5. Gửi Form Điểm Danh
  async function handleFormSubmit(e) {
    e.preventDefault();

    const fullName = fullNameInput.value.trim();
    const donVi = donViInput.value.trim();
    const attendanceDate = attendanceDateInput.value;
    const formattedDate = formatDateVN(attendanceDate);
    const absentReason = absentReasonInput.value.trim();

    if (!fullName) {
      alert("Vui lòng nhập Họ và tên!");
      fullNameInput.focus();
      return;
    }

    if (!donVi) {
      alert("Vui lòng nhập Đơn vị công tác!");
      donViInput.focus();
      return;
    }

    if (!attendanceDate) {
      alert("Vui lòng chọn Ngày điểm danh!");
      attendanceDateInput.focus();
      return;
    }

    if (currentStatus === "Có mặt" && !currentUserLocation.isValid) {
      alert("Vị trí của bạn đang ở ngoài phòng học. Không thể điểm danh 'Có mặt'!");
      return;
    }

    if (currentStatus === "Vắng có lý do" && !absentReason) {
      alert("Vui lòng nhập cụ thể nội dung lý do vắng mặt!");
      absentReasonInput.focus();
      return;
    }

    const webhookUrl = config.GOOGLE_SCRIPT_WEBHOOK_URL;
    if (!webhookUrl || webhookUrl.includes("YOUR_SCRIPT_ID_HERE")) {
      alert("⚠️ Quản trị viên chưa cấu hình URL Webhook Google Apps Script trong file config.js!");
      return;
    }

    setSubmittingState(true);

    const payload = {
      hoTen: fullName,
      donVi: donVi,
      attendanceDate: formattedDate,
      status: currentStatus,
      absentReason: absentReason,
      deviceId: currentDeviceId,
      distance: currentUserLocation.distance,
      latitude: currentUserLocation.lat,
      longitude: currentUserLocation.lng,
      accuracy: currentUserLocation.accuracy,
      userAgent: navigator.userAgent
    };

    try {
      await fetch(webhookUrl, {
        method: "POST",
        mode: "no-cors",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify(payload)
      });

      // Lưu thông tin người dùng vào máy
      saveUserInfo(fullName, donVi);

      // Khóa thiết bị cho ngày này
      const receiptData = {
        name: fullName,
        donVi: donVi,
        date: formattedDate,
        rawDate: attendanceDate,
        status: currentStatus,
        reason: absentReason,
        deviceId: currentDeviceId,
        time: new Date().toLocaleTimeString("vi-VN") + " " + new Date().toLocaleDateString("vi-VN")
      };

      try {
        localStorage.setItem(config.LOCK_STORAGE_KEY, JSON.stringify({
          date: attendanceDate,
          ...receiptData
        }));
      } catch (e) {
        console.warn("Không thể lưu khóa máy:", e);
      }

      // Rung phản hồi thành công trên điện thoại
      if (navigator.vibrate) {
        navigator.vibrate([80, 40, 100]);
      }

      // Hiển thị màn hình biên nhận
      showSuccessScreen(receiptData, false);

    } catch (err) {
      console.error("Lỗi khi gửi dữ liệu:", err);
      alert("Có lỗi kết nối đến máy chủ Google Sheets. Vui lòng thử lại!");
    } finally {
      setSubmittingState(false);
    }
  }

  function setSubmittingState(isSubmitting) {
    btnSubmit.disabled = isSubmitting;
    if (isSubmitting) {
      btnSpinner.style.display = "inline-block";
      btnSubmitText.textContent = "Đang lưu vào Google Sheets...";
    } else {
      btnSpinner.style.display = "none";
      updateSubmitButtonState();
    }
  }

  function showSuccessScreen(data, isLockedView = false) {
    attendanceForm.style.display = "none";
    gpsStatusBox.style.display = "none";
    document.querySelector(".status-switcher").style.display = "none";

    receiptName.textContent = data.name;
    receiptDonVi.textContent = data.donVi;
    receiptDate.textContent = data.date;
    receiptStatus.textContent = data.status;
    receiptDeviceId.textContent = data.deviceId;
    receiptTime.textContent = data.time;

    if (data.status === "Vắng có lý do" && data.reason) {
      receiptReasonRow.style.display = "flex";
      receiptReason.textContent = data.reason;
      successIconWrap.className = "success-icon-wrap absent";
      successTitle.textContent = "Đã gửi Báo vắng thành công!";
    } else {
      receiptReasonRow.style.display = "none";
      successIconWrap.className = "success-icon-wrap";
      successTitle.textContent = "Điểm danh Có mặt thành công!";
    }

    if (isLockedView) {
      successSubtitle.textContent = "Thiết bị này đã hoàn thành điểm danh cho ngày hôm nay.";
    }

    successScreen.style.display = "block";
  }

  // Khôi phục & lưu thông tin
  function restoreSavedInfo() {
    try {
      const saved = localStorage.getItem(config.STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.fullName) fullNameInput.value = parsed.fullName;
        if (parsed.donVi) donViInput.value = parsed.donVi;
      }
    } catch (e) {
      console.warn("Không đọc được LocalStorage:", e);
    }
  }

  function saveUserInfo(fullName, donVi) {
    try {
      localStorage.setItem(
        config.STORAGE_KEY,
        JSON.stringify({ fullName, donVi, lastUpdate: Date.now() })
      );
    } catch (e) {
      console.warn("Không thể lưu LocalStorage:", e);
    }
  }

  // Khởi chạy khi DOM sẵn sàng
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
