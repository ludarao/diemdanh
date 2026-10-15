/**
 * APP ĐIỂM DANH GPS & NHẬN DIỆN THIẾT BỊ (ANTI-PROXY)
 */

(function () {
  "use strict";

  const config = window.APP_CONFIG || {
    CLASSROOM_LAT: 13.993109,
    CLASSROOM_LNG: 107.997314,
    ALLOWED_RADIUS_METERS: 100,
    MAX_GPS_ACCURACY_METERS: 150,
    API_URL: "/api",
    STORAGE_KEY: "STUDENT_ATTENDANCE_INFO_V2",
    LOCK_STORAGE_KEY: "ATTENDANCE_DEVICE_LOCK_V2"
  };

  // Trạng thái hiện tại
  let currentStatus = "Có mặt"; // "Có mặt" hoặc "Vắng có lý do"
  let currentDeviceId = "";
  let settingsReady = false;
  let activeClassId = null;
  const apiUrl = config.API_URL || "/api";
  const classHint = new URLSearchParams(window.location.search).get("class");

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
  // 1. Khởi tạo ứng dụng
  async function init() {
    const footerLabel = document.querySelector(".app-footer > div");
    if (footerLabel) footerLabel.textContent = "Hệ thống Điểm danh GPS";
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

    // Load the admin-managed classroom settings without changing the original form.
    try {
      await loadClassSettings();
      settingsReady = true;
      requestGpsLocation();
    } catch (error) {
      updateGpsUI("error", "Chưa tải được cài đặt nhóm", error.message);
      btnSubmit.disabled = true;
      btnSubmitText.textContent = "Bấm Quét lại để kết nối";
    }

    // Gán sự kiện cho form & nút quét lại GPS
    if (btnRefreshGps) btnRefreshGps.addEventListener("click", async () => {
      try { await loadClassSettings(); settingsReady = true; requestGpsLocation(true); }
      catch (error) { settingsReady = false; updateGpsUI("error", "Chưa tải được cài đặt nhóm", error.message); updateSubmitButtonState(); }
    });
    if (attendanceForm) attendanceForm.addEventListener("submit", handleFormSubmit);

    // 👉 THÊM DÒNG NÀY ĐỂ KÍCH HOẠT POPUP HƯỚNG DẪN GPS:
    setupGpsGuideModal();
  }

  async function loadClassSettings() {
    const response = await fetch(`${apiUrl}?action=config${classHint ? "&class=" + encodeURIComponent(classHint) : ""}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Không kết nối được hệ thống.");
    Object.assign(config, data);
    activeClassId = data.classId;
  }

  // 2. Định nghĩa hàm setupGpsGuideModal() (ĐẶT NẰM NGOÀI HÀM init)
  function setupGpsGuideModal() {
    const linkGpsGuide = document.getElementById("linkGpsGuide");
    const gpsGuideModal = document.getElementById("gpsGuideModal");
    const btnCloseGpsGuide = document.getElementById("btnCloseGpsGuide");
    const tabIosBtn = document.getElementById("tabIosBtn");
    const tabAndroidBtn = document.getElementById("tabAndroidBtn");
    const guideIosContent = document.getElementById("guideIosContent");
    const guideAndroidContent = document.getElementById("guideAndroidContent");

    if (!linkGpsGuide || !gpsGuideModal) {
      console.warn("Không tìm thấy id linkGpsGuide hoặc gpsGuideModal trong HTML");
      return;
    }

    // Tự nhận diện thiết bị để chọn sẵn Tab phù hợp khi mở
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    // Mở Modal khi bấm vào link
    linkGpsGuide.addEventListener("click", (e) => {
      e.preventDefault(); // Chặn hành vi nhảy trang của href="#"
      gpsGuideModal.style.display = "flex";

      if (isIos) {
        switchTab("ios");
      } else {
        switchTab("android");
      }
    });

    // Đóng Modal khi bấm nút Đóng
    if (btnCloseGpsGuide) {
      btnCloseGpsGuide.addEventListener("click", () => {
        gpsGuideModal.style.display = "none";
      });
    }

    // Đóng khi click ra ngoài hộp thoại
    gpsGuideModal.addEventListener("click", (e) => {
      if (e.target === gpsGuideModal) {
        gpsGuideModal.style.display = "none";
      }
    });

    // Chuyển Tab iOS / Android
    if (tabIosBtn && tabAndroidBtn) {
      tabIosBtn.addEventListener("click", () => switchTab("ios"));
      tabAndroidBtn.addEventListener("click", () => switchTab("android"));
    }

    function switchTab(platform) {
      if (platform === "ios") {
        tabIosBtn.classList.add("active");
        tabAndroidBtn.classList.remove("active");
        guideIosContent.style.display = "block";
        guideAndroidContent.style.display = "none";
      } else {
        tabAndroidBtn.classList.add("active");
        tabIosBtn.classList.remove("active");
        guideAndroidContent.style.display = "block";
        guideIosContent.style.display = "none";
      }
    }
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
  // Tạo Device ID độc bản (Kết hợp Fingerprint + Random UUID ngầm)
  async function getOrCreateDeviceFingerprint() {
    const storageKey = "DEVICE_PERMANENT_ID_V3";
    let savedId = null;
    try { savedId = localStorage.getItem(storageKey); } catch (_) { /* Storage can be unavailable in private browsers. */ }
    
    // Nếu thiết bị này đã từng lưu mã trước đó -> Lấy lại mã cũ
    if (savedId) {
      return savedId;
    }

    // 1. Thu thập thông số phần cứng cơ bản
    const hardwareInfo = [
      navigator.userAgent,
      screen.width + "x" + screen.height,
      navigator.hardwareConcurrency || 2,
      getCanvasHash()
    ].join("|");

    // 2. Tạo một chuỗi ngẫu nhiên cực lớn (Random Token) dành riêng cho thiết bị này
    const randomSeed = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    
    // 3. Kết hợp để tạo ra mã duy nhất (Ví dụ: DEV-A8F2K912)
    const rawString = hardwareInfo + "###" + randomSeed;
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
    // try {
    //   const lockDataStr = localStorage.getItem(config.LOCK_STORAGE_KEY);
    //   if (lockDataStr) {
    //     const lockData = JSON.parse(lockDataStr);
    //     const todayStr = attendanceDateInput.value;
    //     if (lockData.date === todayStr) {
    //       // Đã điểm danh hôm nay -> Hiện luôn màn hình biên nhận
    //       showSuccessScreen(lockData, true);
    //     }
    //   }
    // } catch (e) {
    //   console.warn("Lỗi kiểm tra khóa máy:", e);
    // }
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

          // Báo vắng không bắt buộc GPS vị trí điểm danh
          btnSubmit.disabled = false;
          btnSubmitText.textContent = "Gửi Báo Vắng Có Lý Do";

          updateGpsUI(
            "info",
            "ℹ️ Chế độ Báo vắng có lý do",
            "Không yêu cầu bạn phải có mặt tại vị trí điểm danh. Vị trí hiện tại vẫn được ghi nhận để lưu vết."
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

    if (accuracy > config.MAX_GPS_ACCURACY_METERS) {
      if (currentStatus === "Có mặt") updateGpsUI("error", "Sai số GPS quá lớn", `Vui lòng quét lại. Sai số hiện tại ±${accRounded}m, tối đa ${config.MAX_GPS_ACCURACY_METERS}m.`);
    } else if (distance <= config.ALLOWED_RADIUS_METERS) {
      currentUserLocation.isValid = true;
      if (currentStatus === "Có mặt") {
        updateGpsUI(
          "success",
          `🟢 Vị trí hợp lệ (~${distRounded}m)`,
          `Bạn đang cách vị trí điểm danh khoảng <b>${distRounded}m</b> (Bán kính cho phép: ${config.ALLOWED_RADIUS_METERS}m, Sai số GPS: ±${accRounded}m).`
        );
      }
    } else {
      currentUserLocation.isValid = false;
      if (currentStatus === "Có mặt") {
        updateGpsUI(
          "error",
          `🔴 Ngoài phạm vi vị trí điểm danh (~${distRounded}m)`,
          `Khoảng cách hiện tại: <b>${distRounded}m</b>. Yêu cầu có mặt trong vị trí điểm danh (tối đa <b>${config.ALLOWED_RADIUS_METERS}m</b>).`
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
    if (!settingsReady) { btnSubmit.disabled = true; btnSubmitText.textContent = "Bấm Quét lại để kết nối"; return; }
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
      alert("Vị trí của bạn đang ở ngoài vị trí điểm danh. Không thể điểm danh 'Có mặt'!");
      return;
    }

    if (currentStatus === "Vắng có lý do" && !absentReason) {
      alert("Vui lòng nhập cụ thể nội dung lý do vắng mặt!");
      absentReasonInput.focus();
      return;
    }

    if (!settingsReady || !activeClassId) {
      alert("Chưa tải được cài đặt nhóm. Vui lòng bấm Quét lại.");
      return;
    }

    setSubmittingState(true);

    let payload = {
      classId: activeClassId,
      requestId: crypto.randomUUID(),
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

    // Keep the same request and payload if a connection fails after the server saved it.
    const pendingKey = `ATTENDANCE_PENDING_${activeClassId}`;
    const signature = JSON.stringify([payload.hoTen, payload.donVi, payload.status, payload.absentReason, payload.attendanceDate]);
    try {
      const pending = JSON.parse(sessionStorage.getItem(pendingKey) || "null");
      if (pending && pending.signature === signature) payload = pending.payload;
      sessionStorage.setItem(pendingKey, JSON.stringify({ signature, payload }));
    } catch (_) { /* Retry still works within this page even when storage is unavailable. */ }

    try {
      const response = await fetch(`${apiUrl}?action=attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok || result.status !== "success") {
        try { sessionStorage.removeItem(pendingKey); } catch (_) {}
        throw new Error(result.message || "Chưa lưu được dữ liệu. Vui lòng thử lại.");
      }
      try { sessionStorage.removeItem(pendingKey); } catch (_) {}

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
        time: new Date(result.receivedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
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
      alert(err.message || "Có lỗi kết nối đến hệ thống. Vui lòng thử lại!");
    } finally {
      setSubmittingState(false);
    }
  }

  function setSubmittingState(isSubmitting) {
    btnSubmit.disabled = isSubmitting;
    if (isSubmitting) {
      btnSpinner.style.display = "inline-block";
      btnSubmitText.textContent = "Đang lưu điểm danh...";
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

    if (successSubtitle) successSubtitle.textContent = "Dữ liệu đã được ghi nhận vào hệ thống.";
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
