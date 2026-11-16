"use strict";

// ======================================================
// CTVS AL-AZHAR
// ======================================================

const API_URL =
  "https://script.google.com/macros/s/AKfycbwCXKRCUjwPbE8DrRc0ZjLzZhNsAjnmXSYxAuyI-ajFZk5irFkL_mvOKZmRZvjsXmC4rA/exec";

const DB_NAME = "ctvs_2650_v2";
const BATCH_LIMIT = 50;

const $ = id => document.getElementById(id);

let db = null;
let mode = null;
let batchMode = false;
let batchFinished = false;

let cameraStream = null;
let cameraTimer = null;
let detector = null;
let cameraRunning = false;
let scanLocked = false;
let detectionBusy = false;

let batchResults = {
  success: 0,
  failed: 0
};

// ======================================================
// DATABASE INDEXEDDB
// ======================================================

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains("tickets")) {
        database.createObjectStore("tickets", { keyPath: "token" });
      }

      if (!database.objectStoreNames.contains("events")) {
        database.createObjectStore("events", { keyPath: "eventId" });
      }

      if (!database.objectStoreNames.contains("meta")) {
        database.createObjectStore("meta", { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function get(store, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store)
      .objectStore(store).get(key);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function put(store, value) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readwrite")
      .objectStore(store).put(value);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function all(store) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store)
      .objectStore(store).getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteItem(store, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readwrite")
      .objectStore(store).delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ======================================================
// UTILITAS
// ======================================================

function show(id) {
  ["register", "home", "scan", "admin"].forEach(name => {
    $(name)?.classList.toggle("hidden", name !== id);
  });
}

function msg(id, text) {
  if ($(id)) $(id).textContent = text;
}

function deviceId() {
  let id = localStorage.getItem("ctvs-device-id");

  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now() + "-" + Math.random().toString(36).slice(2);

    localStorage.setItem("ctvs-device-id", id);
  }

  return id;
}

function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now() + "-" + Math.random().toString(36).slice(2);
}

function setLoading(button, active, label) {
  if (!button) return;

  if (active) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }

    button.disabled = true;
    button.classList.add("loading");
    if (label) button.textContent = label;
  } else {
    button.disabled = false;
    button.classList.remove("loading");

    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

async function withLoading(button, label, callback) {
  setLoading(button, true, label);

  try {
    return await callback();
  } finally {
    setLoading(button, false);
  }
}

function bindClick(id, callback) {
  const element = $(id);

  if (!element) {
    console.error("Elemen HTML tidak ditemukan:", id);
    return;
  }

  element.addEventListener("click", callback);
}

// ======================================================
// EVENT LISTENER
// ======================================================

function bindEvents() {
  bindClick("enrollBtn", () =>
    withLoading($("enrollBtn"), "Mendaftarkan...", enroll)
  );

  bindClick("downloadDb", () =>
    withLoading($("downloadDb"), "Mengunduh...", downloadDB)
  );

  bindClick("exportBundle", () =>
    withLoading($("exportBundle"), "Mengekspor...", exportBundle)
  );

  bindClick("syncBtn", () =>
    withLoading($("syncBtn"), "Sinkronisasi...", syncEvents)
  );

  bindClick("resetBtn", resetDevice);

  bindClick("backBtn", async () => {
    stopCamera();
    const device = await get("meta", "device");
    if (device) await renderHome(device);
  });

  bindClick("processBtn", () =>
    withLoading($("processBtn"), "Memproses...", processTicket)
  );

  bindClick("importCsvBtn", () =>
    withLoading($("importCsvBtn"), "Mengimpor...", importCSV)
  );

  bindClick("adminBack", async () => {
    const device = await get("meta", "device");
    if (device) await renderHome(device);
  });

  bindClick("startCameraBtn", () =>
    withLoading($("startCameraBtn"), "Membuka kamera...", startCamera)
  );

  bindClick("stopCameraBtn", stopCamera);
  bindClick("nextScanBtn", nextScan);
  bindClick("finishBatchBtn", finishBatch);

  $("importBundle")?.addEventListener("change", importBundle);
}

// ======================================================
// INISIALISASI APLIKASI
// ======================================================

async function init() {
  db = await openDB();

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (error) {
      console.warn("Service Worker:", error);
    }
  }

  msg("deviceIdText", "ID perangkat: " + deviceId());

  const device = await get("meta", "device");

  if (device) {
    await renderHome(device);
  } else {
    show("register");
  }

  const params = new URLSearchParams(location.search);
  const token = params.get("t") || params.get("token");

  if (token && $("tokenInput")) {
    $("tokenInput").value = token;
  }

  bindEvents();
}

// ======================================================
// REGISTRASI PERANGKAT
// ======================================================

async function enroll() {
  if (!navigator.onLine) {
    msg("registerMsg", "Registrasi memerlukan koneksi internet.");
    return;
  }

  const name = $("deviceName")?.value.trim() || "";
  const code = $("enrollCode")?.value.trim() || "";

  if (!name || !code) {
    msg("registerMsg", "Nama perangkat dan kode registrasi wajib diisi.");
    return;
  }

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "enroll",
        deviceId: deviceId(),
        deviceName: name,
        enrollCode: code
      })
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.message || "Registrasi ditolak.");
    }

    const device = {
      key: "device",
      deviceId: deviceId(),
      name,
      role: data.role,
      deviceToken: data.deviceToken,
      registeredAt: new Date().toISOString()
    };

    await put("meta", device);

    $("enrollCode").value = "";

    await renderHome(device);
    msg("homeMsg", "Registrasi berhasil. Hak akses: " + device.role);

  } catch (error) {
    msg("registerMsg", "Registrasi gagal: " + error.message);
  }
}

// ======================================================
// BERANDA DAN HAK AKSES
// ======================================================

async function renderHome(device) {
  show("home");

  const stats = document.querySelector(".stats-panel");
  stats?.classList.toggle("hidden", device.role !== "SUPERUSER");

  $("deviceTitle").textContent =
    device.role === "SUPERUSER"
      ? "SUPERUSER - " + device.name
      : device.role === "GATE"
        ? "Gate Entry - " + device.name
        : "Ticketing - " + device.name;

  $("deviceBadge").textContent =
    device.role + " / " + device.name;

  $("deviceDetail").textContent =
    "ID: " + device.deviceId + " • Hak akses: " + device.role;

  const actions = $("actions");
  actions.innerHTML = "";

  if (["TICKETING", "SUPERUSER"].includes(device.role)) {
    addAction(actions, "ACTIVATION", "Aktivasi satu tiket", "single",
      () => openMode("ACTIVATION", false));

    addAction(actions, "BATCH ACTIVATION", "Maksimal 50 tiket per sesi", "batch",
      () => openMode("ACTIVATION", true));
  }

  if (device.role === "GATE") {
    addAction(actions, "GATE ENTRY", "Validasi tiket masuk", "gate",
      () => openMode("GATE", false));
  }

  if (device.role === "SUPERUSER") {
    addAction(actions, "IMPOR DATABASE CSV", "Pengelolaan database", "admin",
      () => show("admin"));
  }

  await updateStats();
}

function addAction(parent, title, description, type, callback) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-card action-" + type;

  const heading = document.createElement("strong");
  heading.textContent = title;

  const detail = document.createElement("span");
  detail.textContent = description;

  const arrow = document.createElement("span");
  arrow.className = "action-arrow";
  arrow.textContent = "→";

  button.append(heading, detail, arrow);

  button.addEventListener("click", () => {
    withLoading(button, "Membuka...", callback);
  });

  parent.appendChild(button);
}

// ======================================================
// MODE AKTIVASI / GATE
// ======================================================

async function openMode(selectedMode, isBatch) {
  const device = await get("meta", "device");

  if (!device) {
    show("register");
    return;
  }

  if (
    selectedMode === "ACTIVATION" &&
    !["TICKETING", "SUPERUSER"].includes(device.role)
  ) {
    alert("Perangkat tidak memiliki hak Ticketing.");
    return;
  }

  if (selectedMode === "GATE" && device.role !== "GATE") {
    alert("Perangkat tidak memiliki hak Gate.");
    return;
  }

  stopCamera();

  mode = selectedMode;
  batchMode = Boolean(isBatch);
  batchFinished = false;

  batchResults = { success: 0, failed: 0 };

  $("modeBadge").textContent =
    batchMode ? "BATCH ACTIVATION" : selectedMode;

  $("scanHeading").textContent =
    selectedMode === "GATE"
      ? "Gate Entry"
      : batchMode
        ? "Batch Activation"
        : "Aktivasi Tiket";

  $("scanDescription").textContent =
    batchMode
      ? "Pindai tiket satu per satu. Maksimal 50 tiket per sesi."
      : "Pindai satu tiket. Kamera akan berhenti setelah satu QR terbaca.";

  $("scanResult").className = "result hidden";
  $("batchPanel").classList.toggle("hidden", !batchMode);
  $("nextScanBtn").classList.add("hidden");
  $("tokenInput").value = "";

  const params = new URLSearchParams(location.search);
  const token = params.get("t") || params.get("token");

  if (token) $("tokenInput").value = token;

  show("scan");
  updateBatchSummary();
}

// ======================================================
// HASIL VALIDASI
// ======================================================

function result(text, type) {
  $("scanResult").textContent = text;
  $("scanResult").className = "result " + type;
}

function updateBatchSummary() {
  $("batchSummary").textContent =
    "Berhasil: " + batchResults.success +
    "\nGagal / tidak memenuhi syarat: " + batchResults.failed +
    "\nTotal diproses: " +
    (batchResults.success + batchResults.failed) +
    "\nSisa kuota: " +
    Math.max(0, BATCH_LIMIT - batchResults.success - batchResults.failed);
}

function finishBatch() {
  batchFinished = true;
  stopCamera();
  $("nextScanBtn").classList.add("hidden");

  $("batchSummary").textContent +=
    "\n\nSesi aktivasi batch telah diakhiri.";
}

// ======================================================
// VALIDASI TIKET
// ======================================================

async function processTicket() {
  if (batchMode && batchFinished) {
    result("SESI BATCH SUDAH DIAKHIRI.", "warn");
    return;
  }

  const token = $("tokenInput").value.trim();

  if (!token) {
    result("QR / TOKEN TIDAK VALID", "bad");
    return;
  }

  const totalBatch = batchResults.success + batchResults.failed;

  if (batchMode && totalBatch >= BATCH_LIMIT) {
    result("BATAS 50 TIKET TELAH TERCAPAI.", "warn");
    stopDetectionOnly();
    $("nextScanBtn").classList.add("hidden");
    return;
  }

  const device = await get("meta", "device");
  const ticket = await get("tickets", token);

  if (!device || !ticket) {
    result(
      "TICKET INVALID\n(ENTRY NOT PERMITTED)\nToken tidak ditemukan pada database lokal.",
      "bad"
    );
    recordBatch(false);
    pauseAfterScan();
    return;
  }

  if (
    mode === "ACTIVATION" &&
    !["TICKETING", "SUPERUSER"].includes(device.role)
  ) {
    result("AKSES DITOLAK", "bad");
    return;
  }

  if (mode === "GATE" && device.role !== "GATE") {
    result("AKSES DITOLAK", "bad");
    return;
  }

  const now = new Date().toISOString();
  let eventType = null;
  let successful = false;

  if (mode === "ACTIVATION") {
    if (ticket.status === "UNACTIVATED") {
      ticket.status = "ACTIVATED";
      ticket.activatedAt = now;
      eventType = "ACTIVATE";
      successful = true;

      result(
        "TICKET HAS BEEN VALIDATED\n(GATE ENTRY PERMITTED)",
        "ok"
      );

    } else if (ticket.status === "ACTIVATED") {
      result("TICKET ALREADY ACTIVATED", "warn");

    } else {
      result("TICKET HAS BEEN USED\n(ENTRY NOT PERMITTED)", "bad");
    }

  } else if (mode === "GATE") {
    if (ticket.status === "ACTIVATED") {
      ticket.status = "USED";
      ticket.usedAt = now;
      eventType = "GATE_USE";
      successful = true;

      result(
        "TICKET VALID\n(ENTRY PERMITTED)\n\nBERI TANDA FLUORESEN DAN PASANG GELANG SEKARANG.",
        "ok"
      );

    } else if (ticket.status === "UNACTIVATED") {
      result("TICKET INVALID\n(ENTRY NOT PERMITTED)", "bad");

    } else {
      result("TICKET HAS BEEN USED\n(ENTRY NOT PERMITTED)", "bad");
    }
  }

  if (eventType) {
    await put("tickets", ticket);

    await put("events", {
      eventId: newId(),
      token,
      eventType,
      deviceId: device.deviceId,
      deviceName: device.name,
      createdAt: now,
      syncStatus: "PENDING"
    });
  }

  recordBatch(successful);
  await updateStats();
  pauseAfterScan();
}

function recordBatch(success) {
  if (!batchMode) return;

  if (success) batchResults.success++;
  else batchResults.failed++;

  updateBatchSummary();
}

// ======================================================
// PEMINDAIAN BERIKUTNYA
// ======================================================

function pauseAfterScan() {
  stopDetectionOnly();

  $("nextScanBtn").classList.remove("hidden");

  $("cameraStatus").textContent =
    "QR selesai diproses. Kamera dijeda.";
}

async function nextScan() {
  if (batchFinished) {
    result("Sesi batch sudah diakhiri.", "warn");
    return;
  }

  if (
    batchMode &&
    batchResults.success + batchResults.failed >= BATCH_LIMIT
  ) {
    result("Batas 50 tiket tercapai. Akhiri sesi batch.", "warn");
    $("nextScanBtn").classList.add("hidden");
    return;
  }

  $("tokenInput").value = "";
  $("scanResult").className = "result hidden";
  $("nextScanBtn").classList.add("hidden");

  if (cameraStream) {
    startDetectionOnly();
  } else {
    $("cameraStatus").textContent =
      "Tekan Buka Kamera untuk pemindaian berikutnya.";
  }
}

// ======================================================
// KAMERA INTERNAL
// ======================================================

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    result("Browser tidak mendukung akses kamera. Masukkan token manual.", "warn");
    return;
  }

  if (!("BarcodeDetector" in window)) {
    result(
      "Browser belum mendukung pemindai QR internal. Gunakan browser yang kompatibel atau masukkan token manual.",
      "warn"
    );
    return;
  }

  try {
    detector = new BarcodeDetector({ formats: ["qr_code"] });

    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } }
    });

    $("cameraVideo").srcObject = cameraStream;
    await $("cameraVideo").play();

    $("cameraPanel").classList.remove("hidden");
    $("startCameraBtn").classList.add("hidden");
    $("stopCameraBtn").classList.remove("hidden");

    startDetectionOnly();

  } catch (error) {
    stopCamera();
    result("Kamera tidak dapat dibuka: " + error.message, "bad");
  }
}

function startDetectionOnly() {
  if (!cameraStream || !detector) return;

  cameraRunning = true;
  scanLocked = false;
  detectionBusy = false;

  $("cameraStatus").textContent =
    "Kamera aktif. Arahkan ke QR tiket.";

  if (cameraTimer) clearInterval(cameraTimer);
  cameraTimer = setInterval(detectQR, 250);
}

function stopDetectionOnly() {
  cameraRunning = false;

  if (cameraTimer) {
    clearInterval(cameraTimer);
    cameraTimer = null;
  }
}

async function detectQR() {
  if (!cameraRunning || scanLocked || detectionBusy) return;

  const video = $("cameraVideo");

  if (!video || video.readyState < 2 || !detector) return;

  detectionBusy = true;

  try {
    const codes = await detector.detect(video);
    if (!codes?.length) return;

    const raw = String(codes[0].rawValue || "").trim();
    if (!raw) return;

    const token = extractToken(raw);

    if (!token) {
      $("cameraStatus").textContent = "QR terbaca tetapi token tidak dikenali.";
      return;
    }

    scanLocked = true;
    stopDetectionOnly();

    $("tokenInput").value = token;
    $("cameraStatus").textContent = "QR terbaca: " + token;

    await processTicket();

  } catch (error) {
    console.warn("QR detector:", error);
  } finally {
    detectionBusy = false;
  }
}

function extractToken(value) {
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      return (
        url.searchParams.get("t") ||
        url.searchParams.get("token") ||
        ""
      ).trim();
    }
  } catch (_) {}

  return value.trim();
}

function stopCamera() {
  stopDetectionOnly();

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  const video = $("cameraVideo");

  if (video) {
    video.pause();
    video.srcObject = null;
  }

  $("cameraPanel")?.classList.add("hidden");
  $("startCameraBtn")?.classList.remove("hidden");
  $("stopCameraBtn")?.classList.add("hidden");

  if ($("cameraStatus")) {
    $("cameraStatus").textContent = "Kamera belum aktif";
  }
}

// ======================================================
// STATISTIK SUPERUSER
// ======================================================

async function updateStats() {
  const device = await get("meta", "device");

  if (!device || device.role !== "SUPERUSER") {
    document.querySelector(".stats-panel")?.classList.add("hidden");
    return;
  }

  document.querySelector(".stats-panel")?.classList.remove("hidden");

  const tickets = await all("tickets");
  const events = await all("events");

  $("nTickets").textContent = tickets.length;

  $("nActivated").textContent = tickets.filter(ticket =>
    ticket.status === "ACTIVATED" || ticket.status === "USED"
  ).length;

  $("nUsed").textContent =
    tickets.filter(ticket => ticket.status === "USED").length;

  $("nPending").textContent =
    events.filter(event => event.syncStatus !== "SYNCED").length;
}

// ======================================================
// UNDUH DATABASE PUSAT
// ======================================================

async function downloadDB() {
  if (!navigator.onLine) {
    msg("homeMsg", "Tidak ada internet. Database lokal tetap tersedia.");
    return;
  }

  try {
    const device = await get("meta", "device");
    if (!device) throw new Error("Perangkat belum terdaftar.");

    const url = API_URL +
      "?action=download" +
      "&deviceId=" + encodeURIComponent(device.deviceId) +
      "&deviceToken=" + encodeURIComponent(device.deviceToken);

    const response = await fetch(url);
    const data = await response.json();

    if (!data.ok) throw new Error(data.message || "Unduhan ditolak.");

    // Jangan menurunkan status lokal yang sudah lebih maju.
    const rank = { UNACTIVATED: 0, ACTIVATED: 1, USED: 2 };

    for (const incoming of data.tickets || []) {
      if (!incoming.token || !(incoming.status in rank)) continue;

      const local = await get("tickets", incoming.token);

      if (
        !local ||
        rank[incoming.status] > rank[local.status] ||
        rank[incoming.status] === rank[local.status]
      ) {
        await put("tickets", {
          ...(local || {}),
          token: incoming.token,
          status: rank[local?.status] > rank[incoming.status]
            ? local.status
            : incoming.status
        });
      }
    }

    msg(
      "homeMsg",
      device.role === "SUPERUSER"
        ? "Database pusat berhasil diunduh seluruhnya. Total: " +
          (data.tickets || []).length + " tiket."
        : "Database pusat berhasil diunduh seluruhnya"
    );

    await updateStats();

  } catch (error) {
    msg("homeMsg", "Gagal mengunduh database: " + error.message);
  }
}

// ======================================================
// EKSPOR DATA PERANGKAT
// ======================================================

async function exportBundle() {
  const device = await get("meta", "device");

  if (!device) {
    msg("homeMsg", "Perangkat belum terdaftar.");
    return;
  }

  const bundle = {
    format: "CTVS_OFFLINE_BUNDLE_V2",
    exportedAt: new Date().toISOString(),
    device: {
      deviceId: device.deviceId,
      name: device.name,
      role: device.role
    },
    tickets: await all("tickets"),
    events: await all("events")
  };

  const blob = new Blob([JSON.stringify(bundle)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = "CTVS_" + device.deviceId + "_" + Date.now() + ".json";
  anchor.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  msg("homeMsg", "Paket data perangkat berhasil diekspor.");
}

// ======================================================
// IMPOR DATA PERANGKAT
// ======================================================

async function importBundle(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const bundle = JSON.parse(await file.text());

    if (bundle.format !== "CTVS_OFFLINE_BUNDLE_V2") {
      throw new Error("Format paket tidak dikenali.");
    }

    const rank = { UNACTIVATED: 0, ACTIVATED: 1, USED: 2 };

    for (const incoming of bundle.tickets || []) {
      if (!incoming.token || !(incoming.status in rank)) continue;

      const old = await get("tickets", incoming.token);

      if (!old || rank[incoming.status] > rank[old.status]) {
        await put("tickets", incoming);
      }
    }

    for (const incoming of bundle.events || []) {
      if (!incoming.eventId) continue;

      const old = await get("events", incoming.eventId);
      if (!old) await put("events", incoming);
    }

    msg(
      "homeMsg",
      "Impor berhasil dari " +
      (bundle.device?.name || "perangkat lain") +
      ". Data tiket dan log telah digabungkan."
    );

    await updateStats();

  } catch (error) {
    msg("homeMsg", "Impor gagal: " + error.message);
  } finally {
    event.target.value = "";
  }
}

// ======================================================
// SINKRONISASI TRANSAKSI
// ======================================================

async function syncEvents() {
  if (!navigator.onLine) {
    msg("homeMsg", "Offline. Transaksi tetap tersimpan secara lokal.");
    return;
  }

  try {
    const device = await get("meta", "device");
    if (!device) throw new Error("Perangkat belum terdaftar.");

    const events = (await all("events")).filter(
      event => event.syncStatus !== "SYNCED"
    );

    if (!events.length) {
      msg("homeMsg", "Tidak ada transaksi yang menunggu sinkronisasi.");
      return;
    }

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "sync",
        deviceId: device.deviceId,
        deviceToken: device.deviceToken,
        events
      })
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.message || "Sinkronisasi ditolak.");
    }

    for (const id of data.acceptedEventIds || []) {
      const event = await get("events", id);

      if (event) {
        event.syncStatus = "SYNCED";
        await put("events", event);
      }
    }

    msg(
      "homeMsg",
      "Sinkronisasi selesai. Diterima: " +
      (data.acceptedEventIds || []).length +
      "; konflik: " +
      (data.conflicts || []).length +
      ". Konflik harus diperiksa di laporan pusat."
    );

  } catch (error) {
    msg("homeMsg", "Sinkronisasi gagal: " + error.message);
  }

  await updateStats();
}

// ======================================================
// RESET REGISTRASI
// ======================================================

async function resetDevice() {
  const confirmed = confirm(
    "Hapus registrasi perangkat ini?\n\n" +
    "Database tiket dan log transaksi tidak ikut dihapus."
  );

  if (!confirmed) return;

  await deleteItem("meta", "device");
  location.reload();
}

// ======================================================
// IMPOR CSV
// ======================================================

function parseCSV(line) {
  const values = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }

  values.push(value);
  return values;
}

async function importCSV() {
  const device = await get("meta", "device");

  if (!device || device.role !== "SUPERUSER") {
    msg("adminMsg", "Akses ditolak. Khusus SUPERUSER.");
    return;
  }

  const file = $("csvFile").files?.[0];

  if (!file) {
    msg("adminMsg", "Pilih file CSV terlebih dahulu.");
    return;
  }

  try {
    const lines = (await file.text())
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(line => line.trim());

    if (!lines.length) throw new Error("File CSV kosong.");

    const headers = parseCSV(lines.shift())
      .map(value => value.trim().toUpperCase());

    const tokenIndex = headers.indexOf("QR_TOKEN");
    const statusIndex = headers.indexOf("STATUS");

    if (tokenIndex < 0) {
      throw new Error("Header QR_TOKEN wajib tersedia.");
    }

    const rank = { UNACTIVATED: 0, ACTIVATED: 1, USED: 2 };
    let imported = 0;
    let skipped = 0;

    for (const line of lines) {
      const columns = parseCSV(line);
      const token = (columns[tokenIndex] || "").trim();

      if (!token) {
        skipped++;
        continue;
      }

      const status = (
        statusIndex >= 0
          ? columns[statusIndex] || "UNACTIVATED"
          : "UNACTIVATED"
      ).trim().toUpperCase();

      if (!(status in rank)) {
        skipped++;
        continue;
      }

      const old = await get("tickets", token);

      if (!old || rank[status] >= rank[old.status]) {
        await put("tickets", {
          ...(old || {}),
          token,
          status
        });
        imported++;
      } else {
        skipped++;
      }
    }

    msg(
      "adminMsg",
      "Impor CSV selesai.\nDiproses: " + imported +
      "\nDilewati: " + skipped
    );

    await updateStats();

  } catch (error) {
    msg("adminMsg", "Impor CSV gagal: " + error.message);
  }
}

// ======================================================
// STATUS JARINGAN DAN KAMERA
// ======================================================

window.addEventListener("online", () => {
  if ($("home") && !$("home").classList.contains("hidden")) {
    msg("homeMsg", "Koneksi internet tersedia kembali.");
  }
});

window.addEventListener("offline", () => {
  if ($("home") && !$("home").classList.contains("hidden")) {
    msg("homeMsg", "Koneksi internet terputus. Aplikasi berjalan dengan database lokal.");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCamera();
});

window.addEventListener("pagehide", stopCamera);

// ======================================================
// MULAI
// ======================================================

window.addEventListener("load", () => {
  init().catch(error => {
    console.error("CTVS initialization error:", error);
    alert("Gagal memulai aplikasi: " + error.message);
  });
});
