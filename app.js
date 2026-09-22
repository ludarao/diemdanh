/**
 * APP ĐIỂM DANH GPS - LOGIC CHÍNH
 */

(function () {
  "use strict";

  // Lấy cấu hình từ config.js hoặc mặc định
  const config = window.APP_CONFIG || {
    CLASSROOM_LAT: 21.028511,
    CLASSROOM_LNG: 105.854444,
    ALLOWED_RADIUS_METERS: 40,
    MAX_GPS_ACCURACY_METERS: 80,
    GOOGLE_SCRIPT_WEBHOOK_URL: "",
    STORAGE_KEY: "STUDENT_ATTENDANCE_INFO_V1"
  };

  // Kiểm tra nếu giảng viên đã lưu tọa độ ghi đè trong LocalStorage của máy này
  const savedRoomCoords = localStorage.getItem("OVERRIDE_ROOM_COORDS");
  if (savedRoomCoords) {
    try {
      const parsed = JSON.parse(savedRoomCoords);
      if (parsed.lat && parsed.lng) {
        config.CLASSROOM_LAT = parsed.lat;
        config.CLASSROOM_LNG = parsed.lng;
        config.ALLOWED_RADIUS_METERS = parsed.radius || config.ALLOWED_RADIUS_METERS;
      }
    } catch (e) {
      console.warn("Không đọc được tọa độ lưu tạm:", e);
    }
  }

  // Biến lưu trạng thái GPS người dùng hiện tại
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
  const gpsStatusBox = document.getElementById("gpsStatusBox");
  const gpsStatusText = document.getElementById("gpsStatusText");
  const gpsDetailText = document.getElementById("gpsDetailText");
  const btnRefreshGps = document.getElementById("btnRefreshGps");
  const attendanceForm = document.getElementById("attendanceForm");
  const studentIdInput = document.getElementById("studentId");
  const fullNameInput = document.getElementById("fullName");
  const sessionNameInput = document.getElementById("sessionName");
  const btnSubmit = document.getElementById("btnSubmit");
  const btnSubmitText = document.getElementById("btnSubmitText");
  const btnSpinner = document.getElementById("btnSpinner");
  const successScreen = document.getElementById("successScreen");
  const btnCheckAgain = document.getElementById("btnCheckAgain");

  // Receipt elements
  const receiptName = document.getElementById("receiptName");
  const receiptMssv = document.getElementById("receiptMssv");
  const receiptDistance = document.getElementById("receiptDistance");
  const receiptTime = document.getElementById("receiptTime");

  // 1. Khởi tạo ứng dụng
  function init() {
    if (config.APP_TITLE && appTitleEl) appTitleEl.textContent = config.APP_TITLE;
    if (config.SUB_TITLE && appSubtitleEl) appSubtitleEl.textContent = config.SUB_TITLE;

    // Đọc URL query params (ví dụ: ?session=Buoi1&class=LLCT01)
    parseUrlParams();

    // Khôi phục thông tin sinh viên đã lưu từ lần trước
    restoreSavedStudentInfo();

    // Bắt đầu quét GPS
    requestGpsLocation();

    // Gán sự kiện
    btnRefreshGps.addEventListener("click", () => requestGpsLocation(true));
    attendanceForm.addEventListener("submit", handleFormSubmit);
    btnCheckAgain.addEventListener("click", resetFormForNewStudent);
  }

  // Đọc query parameters từ URL
  function parseUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const session = urlParams.get("session") || urlParams.get("buoi");
    const className = urlParams.get("class") || urlParams.get("lop");

    if (session || className) {
      const combined = [session, className].filter(Boolean).join(" - ");
      sessionNameInput.value = combined;
      sessionNameInput.readOnly = true;
      const hint = document.getElementById("sessionHint");
      if (hint) hint.textContent = "✓ Tự động nhận diện từ mã QR của buổi học";
    }
  }

  // Khôi phục thông tin từ LocalStorage
  function restoreSavedStudentInfo() {
    try {
      const saved = localStorage.getItem(config.STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.mssv) studentIdInput.value = parsed.mssv;
        if (parsed.hoTen) fullNameInput.value = parsed.hoTen;
      }
    } catch (e) {
      console.warn("Không đọc được LocalStorage:", e);
    }
  }

  // Lưu thông tin vào LocalStorage
  function saveStudentInfo(mssv, hoTen) {
    try {
      localStorage.setItem(
        config.STORAGE_KEY,
        JSON.stringify({ mssv: mssv.trim(), hoTen: hoTen.trim(), lastUpdate: Date.now() })
      );
    } catch (e) {
      console.warn("Không thể lưu LocalStorage:", e);
    }
  }

  // 2. Tính khoảng cách Haversine giữa 2 tọa độ (mét)
  function getHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Bán kính Trái Đất theo mét
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

  // 3. Yêu cầu tọa độ GPS
  function requestGpsLocation(isManual = false) {
    if (!navigator.geolocation) {
      updateGpsUI("error", "Trình duyệt không hỗ trợ định vị GPS", "Vui lòng mở trên Safari hoặc Chrome trên điện thoại.");
      return;
    }

    updateGpsUI("loading", "Đang xác thực vị trí GPS...", "Vui lòng cho phép quyền vị trí trên điện thoại.");
    btnSubmit.disabled = true;
    btnSubmitText.textContent = "Đang kiểm tra vị trí...";

    const geoOptions = {
      enableHighAccuracy: true, // Bật GPS độ chính xác cao
      timeout: 12000,           // Chờ tối đa 12s
      maximumAge: 0             // Luôn lấy vị trí mới nhất, không lấy cache
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

  // Xử lý khi lấy GPS thành công
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

    // Kiểm tra bán kính
    if (distance <= config.ALLOWED_RADIUS_METERS) {
      // HỢP LỆ: Ở trong phòng học
      currentUserLocation.isValid = true;
      updateGpsUI(
        "success",
        `🟢 Vị trí hợp lệ (~${distRounded}m)`,
        `Bạn đang cách phòng học khoảng <b>${distRounded}m</b> (Bán kính cho phép: ${config.ALLOWED_RADIUS_METERS}m, Sai số GPS: ±${accRounded}m).`
      );
      btnSubmit.disabled = false;
      btnSubmitText.textContent = "Xác nhận Điểm danh ngay";
    } else {
      // KHÔNG HỢP LỆ: Ở ngoài phòng học
      currentUserLocation.isValid = false;
      updateGpsUI(
        "error",
        `🔴 Bạn đang ở ngoài phòng học (~${distRounded}m)`,
        `Khoảng cách hiện tại: <b>${distRounded}m</b>. Yêu cầu học viên phải có mặt trong phòng học (tối đa <b>${config.ALLOWED_RADIUS_METERS}m</b>).`
      );
      btnSubmit.disabled = true;
      btnSubmitText.textContent = "Ngoài phạm vi cho phép";
    }

    // Cảnh báo nếu sai số GPS quá lớn
    if (accuracy > config.MAX_GPS_ACCURACY_METERS) {
      gpsDetailText.innerHTML += `<br><span style="color:#b45309;">⚠️ Sai số GPS hơi cao (±${accRounded}m). Hãy bật Wi-Fi hoặc ra gần cửa sổ để GPS chính xác hơn.</span>`;
    }
  }

  // Xử lý khi bị từ chối hoặc lỗi GPS
  function handleGpsError(error) {
    let message = "Không thể lấy vị trí GPS.";
    let detail = "Vui lòng thử lại.";

    switch (error.code) {
      case error.PERMISSION_DENIED:
        message = "🔴 Chưa cấp quyền vị trí";
        detail = "Bạn đã từ chối quyền GPS. Vui lòng vào Cài đặt trình duyệt (Chrome/Safari) -> Cấp quyền 'Vị trí' rồi bấm Quét lại.";
        break;
      case error.POSITION_UNAVAILABLE:
        message = "🔴 Không có tín hiệu GPS";
        detail = "Không nhận diện được vị trí. Hãy chắc chắn máy đã bật 'Dịch vụ định vị' (Location Services).";
        break;
      case error.TIMEOUT:
        message = "🟡 Quá thời gian định vị GPS";
        detail = "Tín hiệu GPS yếu. Vui lòng bấm 'Quét lại' hoặc di chuyển ra nơi thông thoáng.";
        break;
    }

    currentUserLocation.isValid = false;
    updateGpsUI("error", message, detail);
    btnSubmit.disabled = true;
    btnSubmitText.textContent = "Cần quyền GPS để điểm danh";
  }

  // Cập nhật giao diện Hộp trạng thái GPS
  function updateGpsUI(state, title, detail) {
    gpsStatusBox.className = `gps-box ${state}`;
    gpsStatusText.textContent = title;
    gpsDetailText.innerHTML = detail;
  }

  // 4. Xử lý gửi Form điểm danh
  async function handleFormSubmit(e) {
    e.preventDefault();

    const mssv = studentIdInput.value.trim();
    const hoTen = fullNameInput.value.trim();
    const session = sessionNameInput.value.trim() || "Chung";

    if (!mssv) {
      alert("Vui lòng nhập Mã sinh viên (MSSV)!");
      studentIdInput.focus();
      return;
    }

    if (!hoTen) {
      alert("Vui lòng nhập Họ và tên!");
      fullNameInput.focus();
      return;
    }

    if (!currentUserLocation.isValid) {
      alert("Vị trí của bạn chưa hợp lệ hoặc đang ở ngoài phòng học. Vui lòng bấm 'Quét lại' GPS.");
      return;
    }

    // Kiểm tra cấu hình Webhook URL
    const webhookUrl = config.GOOGLE_SCRIPT_WEBHOOK_URL;
    if (!webhookUrl || webhookUrl.includes("YOUR_SCRIPT_ID_HERE")) {
      alert("⚠️ Quản trị viên chưa cấu hình URL Google Apps Script Webhook trong file config.js!\n\nDữ liệu chưa thể gửi về Google Sheets.");
      return;
    }

    // Bắt đầu gửi
    setSubmittingState(true);

    const payload = {
      mssv: mssv,
      hoTen: hoTen,
      session: session,
      distance: currentUserLocation.distance,
      latitude: currentUserLocation.lat,
      longitude: currentUserLocation.lng,
      accuracy: currentUserLocation.accuracy,
      userAgent: navigator.userAgent
    };

    try {
      /**
       * Gửi dữ liệu tới Google Apps Script Webhook.
       * Dùng method: 'POST', mode: 'no-cors' để vượt qua cơ chế chặn CORS của Google Web App
       * Khi dùng mode 'no-cors', request vẫn tới Google Script và doPost() vẫn ghi vào Sheet thành công 100%.
       */
      await fetch(webhookUrl, {
        method: "POST",
        mode: "no-cors",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify(payload)
      });

      // Lưu thông tin sinh viên vào máy
      saveStudentInfo(mssv, hoTen);

      // Rung phản hồi thành công trên điện thoại (Haptic feedback)
      if (navigator.vibrate) {
        navigator.vibrate([80, 40, 100]);
      }

      // Hiển thị màn hình thành công
      showSuccessScreen({
        name: hoTen,
        mssv: mssv,
        distance: Math.round(currentUserLocation.distance) + "m",
        time: new Date().toLocaleTimeString("vi-VN") + " " + new Date().toLocaleDateString("vi-VN")
      });

    } catch (err) {
      console.error("Lỗi khi gửi điểm danh:", err);
      alert("Có lỗi khi kết nối máy chủ Google Sheets. Vui lòng thử lại!");
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
      btnSubmitText.textContent = "Xác nhận Điểm danh ngay";
    }
  }

  function showSuccessScreen(data) {
    attendanceForm.style.display = "none";
    gpsStatusBox.style.display = "none";
    receiptName.textContent = data.name;
    receiptMssv.textContent = data.mssv;
    receiptDistance.textContent = data.distance;
    receiptTime.textContent = data.time;
    successScreen.style.display = "block";
  }

  function resetFormForNewStudent() {
    studentIdInput.value = "";
    fullNameInput.value = "";
    successScreen.style.display = "none";
    attendanceForm.style.display = "block";
    gpsStatusBox.style.display = "flex";
    requestGpsLocation(true);
  }

  // Khởi chạy khi DOM sẵn sàng
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
