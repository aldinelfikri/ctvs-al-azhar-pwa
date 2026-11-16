/* =========================================================
   CTVS AL-AZHAR FESTIVAL 2026
   APP.JS TERINTEGRASI - BACKEND v5
   Offline-first | IndexedDB | Login | Role | Gate | Sync
   ========================================================= */

"use strict";

/* =========================
   KONFIGURASI
========================= */

const API_URL = "https://script.google.com/macros/s/AKfycbwCXKRCUjwPbE8DrRc0ZjLzZhNsAjnmXSYxAuyI-ajFZk5irFkL_mvOKZmRZvjsXmC4rA/exec";

const DB = "ctvs_2650_v2";
const DB_VERSION = 1;

const $ = id => document.getElementById(id);

let db = null;
let mode = null;
let cameraStream = null;
let barcodeDetector = null;
let cameraRunning = false;
let batchCount = 0;

/* =========================
   UTILITAS
========================= */

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now() + "-" + Math.random().toString(36).slice(2);
}

function deviceId() {
  let id = localStorage.getItem("ctvs-device-id");

  if (!id) {
    id = uid();
    localStorage.setItem("ctvs-device-id", id);
  }

  return id;
}

function msg(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function escapeHTML(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function show(id) {
  ["register", "home", "scan", "admin"].forEach(name => {
    const el = $(name);
    if (el) el.classList.toggle("hidden", name !== id);
  });
}

function setButton(id, text, fn) {
  const el = $(id);
  if (el) {
    el.textContent = text;
    el.onclick = fn;
  }
}

function notify(message) {
  alert(message);
}

/* =========================
   DATABASE INDEXEDDB
   Tidak menghapus data lama.
========================= */

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, DB_VERSION);

    request.onupgradeneeded = () => {
      const d = request.result;

      if (!d.objectStoreNames.contains("tickets")) {
        d.createObjectStore("tickets", { keyPath: "token" });
      }

      if (!d.objectStoreNames.contains("events")) {
        d.createObjectStore("events", { keyPath: "eventId" });
      }

      if (!d.objectStoreNames.contains("meta")) {
        d.createObjectStore("meta", { keyPath: "key" });
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
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
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

function remove(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/* =========================
   KOMUNIKASI BACKEND
========================= */

async function api(action, payload = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      action,
      ...payload
    })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error("HTTP " + response.status);
  }

  if (!result.ok) {
    throw new Error(result.message || "Permintaan ditolak backend.");
  }

  return result;
}

async function getDevice() {
  return get("meta", "device");
}

async function getSession() {
  return get("meta", "session");
}

function sessionValid(session) {
  return !!(
    session &&
    session.sessionToken &&
    session.expiresAt &&
    new Date(session.expiresAt).getTime() > Date.now()
  );
}

async function authPayload() {
  const device = await getDevice();
  const session = await getSession();

  if (!device) throw new Error("Perangkat belum terdaftar.");
  if (!sessionValid(session)) {
    throw new Error("Sesi login berakhir. Silakan login kembali.");
  }

  return {
    deviceId: device.deviceId,
    deviceToken: device.deviceToken,
    sessionToken: session.sessionToken,
    activeRole: session.user.activeRole
  };
}

async function requireLogin() {
  const session = await getSession();

  if (!sessionValid(session)) {
    await remove("meta", "session");
    showLogin();
    throw new Error("Sesi login berakhir. Silakan login kembali.");
  }

  return session;
}

/* =========================
   PANEL LOGIN DINAMIS
========================= */

function ensureLoginPanel() {
  if ($("loginPanel")) return;

  const panel = document.createElement("section");
  panel.id = "loginPanel";
  panel.className = "panel auth-panel hidden";

  panel.innerHTML = `
    <h2>Login Petugas</h2>
    <p>Masukkan akun yang telah dibuat oleh administrator.</p>

    <label>Username</label>
    <input id="loginUsername" autocomplete="username"
      placeholder="Username">

    <label>Password</label>
    <input id="loginPassword" type="password"
      autocomplete="current-password" placeholder="Password">

    <div id="loginRoleArea"></div>

    <button id="loginBtn">LOGIN</button>
    <p id="loginMsg"></p>
  `;

  const home = $("home");
  const register = $("register");

  if (home) home.prepend(panel);
  else if (register) register.after(panel);
  else document.body.prepend(panel);

  $("loginBtn").onclick = login;
}

function showLogin() {
  ensureLoginPanel();

  show("home");
  $("loginPanel").classList.remove("hidden");

  const actions = $("actions");
  if (actions) actions.innerHTML = "";

  const roleArea = $("loginRoleArea");
  if (roleArea) roleArea.innerHTML = "";

  msg("loginMsg", "");
}

async function login() {
  const username = $("loginUsername").value.trim();
  const password = $("loginPassword").value;

  if (!username || !password) {
    msg("loginMsg", "Username dan password wajib diisi.");
    return;
  }

  try {
    const device = await getDevice();

    if (!device) throw new Error("Perangkat belum terdaftar.");

    const result = await api("login", {
      deviceId: device.deviceId,
      deviceToken: device.deviceToken,
      username,
      password
    });

    const session = {
      key: "session",
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      user: result.user,
      roles: result.roles,
      deviceRole: result.deviceRole
    };

    await put("meta", session);

    $("loginPassword").value = "";

    await renderHome(device);

    msg("homeMsg", "Login berhasil. Selamat bertugas.");

  } catch (error) {
    msg("loginMsg", "Login gagal: " + error.message);
  }
}

/* =========================
   LOGOUT DAN GANTI ROLE
========================= */

async function logout() {
  const session = await getSession();

  if (!confirm("Apakah Anda yakin ingin logout?")) return;

  if (session && sessionValid(session) && navigator.onLine) {
    try {
      const auth = await authPayload();
      await api("logout", auth);
    } catch (error) {
      console.warn("Logout server:", error.message);
    }
  }

  await remove("meta", "session");

  stopCamera();
  showLogin();
}

async function switchRole() {
  const session = await getSession();
  const device = await getDevice();

  if (!session || !device) return;

  if (session.roles.length < 2) {
    notify("Akun ini hanya memiliki satu role pada perangkat ini.");
    return;
  }

  const selected = prompt(
    "Role tersedia:\n" +
    session.roles.join("\n") +
    "\n\nMasukkan role yang ingin digunakan:"
  );

  if (!selected) return;

  const role = selected.trim().toUpperCase();

  if (!session.roles.includes(role)) {
    notify("Role tidak tersedia.");
    return;
  }

  const password = prompt("Masukkan password untuk mengaktifkan role:");

  if (password === null || password === "") return;

  try {
    const result = await api("login", {
      deviceId: device.deviceId,
      deviceToken: device.deviceToken,
      username: session.user.username,
      password,
      role
    });

    await put("meta", {
      key: "session",
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      user: result.user,
      roles: result.roles,
      deviceRole: result.deviceRole
    });

    await renderHome(device);
    msg("homeMsg", "Role aktif sekarang: " + role);

  } catch (error) {
    notify("Gagal mengganti role: " + error.message);
  }
}

/* =========================
   REGISTRASI PERANGKAT
========================= */

async function enroll() {
  if (!navigator.onLine) {
    msg("registerMsg", "Registrasi memerlukan internet.");
    return;
  }

  const name = $("deviceName").value.trim();
  const code = $("enrollCode").value.trim();

  if (!name || !code) {
    msg("registerMsg", "Nama perangkat dan kode registrasi wajib diisi.");
    return;
  }

  try {
    const result = await api("enroll", {
      deviceId: deviceId(),
      deviceName: name,
      enrollCode: code
    });

    const device = {
      key: "device",
      deviceId: deviceId(),
      name,
      role: result.role,
      deviceToken: result.deviceToken,
      registeredAt: new Date().toISOString()
    };

    await put("meta", device);

    $("enrollCode").value = "";

    await renderHome(device);
    showLogin();

    msg("loginMsg", "Perangkat terdaftar. Silakan login.");

  } catch (error) {
    msg("registerMsg", "Registrasi gagal: " + error.message);
  }
}

/* =========================
   TAMPILAN UTAMA
========================= */

async function renderHome(device) {
  show("home");
  ensureLoginPanel();

  const session = await getSession();
  const panel = $("loginPanel");

  if (!sessionValid(session)) {
    panel.classList.remove("hidden");
    const actions = $("actions");
    if (actions) actions.innerHTML = "";
    return;
  }

  panel.classList.add("hidden");

  const role = session.user.activeRole;
  const deviceRole = device.role;

  $("deviceTitle").textContent =
    session.user.displayName || session.user.username;

  $("deviceDetail").textContent =
    "Perangkat: " + device.name +
    " | Role perangkat: " + deviceRole +
    " | Role aktif: " + role;

  const badge = $("deviceBadge");
  if (badge) badge.classList.add("hidden");

  const stats = document.querySelector(".stats-panel");
  if (stats) {
    stats.classList.toggle("hidden", deviceRole !== "SUPERUSER");
  }

  const actions = $("actions");
  actions.innerHTML = "";

  if (deviceRole === "TICKETING" || deviceRole === "SUPERUSER") {
    addAction(actions, "ACTIVATION / AKTIVASI TIKET",
      () => openMode("ACTIVATION"));
  }

  if (deviceRole === "GATE") {
    addAction(actions, "GATE ENTRY / PEMERIKSAAN MASUK",
      () => openMode("GATE"));
  }

  addAction(actions, "GANTI ROLE", switchRole);
  addAction(actions, "LOGOUT", logout);

  if (role === "SUPERUSER") {
    addAction(actions, "CONTROL PANEL ADMINISTRATOR",
      openAdmin);
  }

  await updateStats();
}

function addAction(parent, label, callback) {
  const button = document.createElement("button");
  button.textContent = label;
  button.onclick = callback;
  parent.appendChild(button);
}

/* =========================
   MODE VALIDASI
========================= */

async function openMode(selectedMode) {
  const device = await getDevice();
  const session = await getSession();

  if (!sessionValid(session)) {
    showLogin();
    return;
  }

  if (
    selectedMode === "ACTIVATION" &&
    !["TICKETING", "SUPERUSER"].includes(device.role)
  ) {
    notify("Perangkat ini tidak memiliki akses aktivasi.");
    return;
  }

  if (selectedMode === "GATE" && device.role !== "GATE") {
    notify("Perangkat ini bukan perangkat Gate.");
    return;
  }

  mode = selectedMode;

  $("modeBadge").textContent = selectedMode;
  $("scanHeading").textContent =
    selectedMode === "GATE" ? "Gate Entry" : "Aktivasi Tiket";

  $("scanResult").className = "result hidden";
  $("tokenInput").value = "";

  show("scan");

  const params = new URLSearchParams(location.search);
  const token = params.get("t") || params.get("token");

  if (token) {
    $("tokenInput").value = token;
    await processTicket();
  }
}

function result(text, type) {
  const el = $("scanResult");
  el.textContent = text;
  el.className = "result " + type;
}

/* =========================
   PEMROSESAN TIKET
========================= */

async function processTicket() {
  try {
    await requireLogin();

    const token = $("tokenInput").value.trim();

    if (!token) {
      result("QR / TOKEN TIDAK VALID", "bad");
      return;
    }

    const device = await getDevice();
    const session = await getSession();

    if (!device || !sessionValid(session)) {
      result("SESI TIDAK VALID. SILAKAN LOGIN KEMBALI.", "bad");
      return;
    }

    if (
      mode === "ACTIVATION" &&
      !["TICKETING", "SUPERUSER"].includes(device.role)
    ) {
      result("AKSES AKTIVASI DITOLAK", "bad");
      return;
    }

    if (mode === "GATE" && device.role !== "GATE") {
      result("AKSES GATE DITOLAK", "bad");
      return;
    }

    const ticket = await get("tickets", token);

    if (!ticket) {
      result(
        "TICKET INVALID\nENTRY NOT PERMITTED\nToken tidak ditemukan di database lokal.",
        "bad"
      );
      return;
    }

    const now = new Date().toISOString();
    let eventType = null;

    if (mode === "ACTIVATION") {
      if (ticket.status === "UNACTIVATED") {
        ticket.status = "ACTIVATED";
        ticket.activatedAt = now;
        eventType = "ACTIVATE";

        result(
          "TICKET HAS BEEN VALIDATED\nGATE ENTRY PERMITTED",
          "ok"
        );

      } else if (ticket.status === "ACTIVATED") {
        result("TICKET ALREADY ACTIVATED", "warn");

      } else {
        result(
          "TICKET HAS BEEN USED\nENTRY NOT PERMITTED",
          "bad"
        );
      }

    } else if (mode === "GATE") {
      if (ticket.status === "ACTIVATED") {
        ticket.status = "USED";
        ticket.usedAt = now;
        eventType = "GATE_USE";

        result(
          "TICKET VALID\nENTRY PERMITTED\n\nBERI TANDA FLUORESEN DAN PASANG GELANG SEKARANG.",
          "ok"
        );

      } else if (ticket.status === "UNACTIVATED") {
        result(
          "TICKET INVALID\nENTRY NOT PERMITTED\nTiket belum diaktivasi.",
          "bad"
        );

      } else {
        result(
          "TICKET HAS BEEN USED\nENTRY NOT PERMITTED",
          "bad"
        );
      }

    } else {
      result("Pilih mode validasi terlebih dahulu.", "warn");
      return;
    }

    if (eventType) {
      await put("tickets", ticket);

      await put("events", {
        eventId: uid(),
        token,
        eventType,
        deviceId: device.deviceId,
        deviceName: device.name,
        createdAt: now,
        syncStatus: "PENDING",
        username: session.user.username,
        activeRole: session.user.activeRole
      });

      batchCount++;
      updateBatchSummary();
    }

    await updateStats();

  } catch (error) {
    result("TRANSAKSI GAGAL: " + error.message, "bad");
  }
}

/* =========================
   BATCH SCAN
========================= */

function updateBatchSummary() {
  const summary = $("batchSummary");
  if (summary) {
    summary.textContent =
      "Transaksi berhasil pada sesi ini: " + batchCount;
  }
}

function nextScan() {
  if ($("tokenInput")) $("tokenInput").value = "";
  if ($("scanResult")) $("scanResult").className = "result hidden";
  if ($("tokenInput")) $("tokenInput").focus();
}

function finishBatch() {
  stopCamera();
  batchCount = 0;
  updateBatchSummary();
  show("home");
}

/* =========================
   KAMERA DAN QR SCANNER
========================= */

async function startCamera() {
  try {
    if (!("BarcodeDetector" in window)) {
      msg(
        "cameraStatus",
        "Browser tidak mendukung pembacaan QR otomatis. Gunakan input token manual."
      );
      return;
    }

    barcodeDetector = new BarcodeDetector({
      formats: ["qr_code"]
    });

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }
      },
      audio: false
    });

    const video = $("cameraVideo");
    video.srcObject = cameraStream;
    await video.play();

    cameraRunning = true;
    msg("cameraStatus", "Kamera aktif. Arahkan ke QR tiket.");

    scanCameraLoop();

  } catch (error) {
    msg("cameraStatus", "Kamera gagal dibuka: " + error.message);
  }
}

async function scanCameraLoop() {
  if (!cameraRunning || !barcodeDetector) return;

  const video = $("cameraVideo");

  try {
    if (video && video.readyState >= 2) {
      const codes = await barcodeDetector.detect(video);

      if (codes.length) {
        const token = codes[0].rawValue.trim();

        if (token && $("tokenInput").value !== token) {
          $("tokenInput").value = token;
          await processTicket();
          nextScan();
        }
      }
    }
  } catch (error) {
    console.warn("QR scan:", error);
  }

  if (cameraRunning) {
    requestAnimationFrame(scanCameraLoop);
  }
}

function stopCamera() {
  cameraRunning = false;

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  const video = $("cameraVideo");
  if (video) video.srcObject = null;

  msg("cameraStatus", "Kamera tidak aktif.");
}

/* =========================
   STATISTIK LOKAL
========================= */

async function updateStats() {
  const device = await getDevice();

  if (!device || device.role !== "SUPERUSER") return;

  const tickets = await all("tickets");
  const events = await all("events");

  if ($("nTickets")) {
    $("nTickets").textContent = tickets.length;
  }

  if ($("nActivated")) {
    $("nActivated").textContent = tickets.filter(t =>
      ["ACTIVATED", "USED"].includes(t.status)
    ).length;
  }

  if ($("nUsed")) {
    $("nUsed").textContent =
      tickets.filter(t => t.status === "USED").length;
  }

  if ($("nPending")) {
    $("nPending").textContent =
      events.filter(e => e.syncStatus !== "SYNCED").length;
  }
}

/* =========================
   DOWNLOAD DATABASE PUSAT
========================= */

function statusRank(status) {
  return {
    UNACTIVATED: 0,
    ACTIVATED: 1,
    USED: 2
  }[status] ?? -1;
}

async function downloadDB() {
  try {
    if (!navigator.onLine) {
      msg("homeMsg", "Offline. Database lokal tetap tersedia.");
      return;
    }

    const auth = await authPayload();
    const result = await api("download", auth);

    let imported = 0;

    for (const incoming of result.tickets || []) {
      if (!incoming.token) continue;

      const existing = await get("tickets", incoming.token);

      if (
        !existing ||
        statusRank(incoming.status) > statusRank(existing.status)
      ) {
        await put("tickets", {
          ...existing,
          ...incoming
        });
        imported++;
      }
    }

    msg(
      "homeMsg",
      "Download database selesai. Data tiket dari pusat: " +
      (result.tickets || []).length +
      ". Data lokal diperbarui: " + imported + "."
    );

    await updateStats();

  } catch (error) {
    msg("homeMsg", "Download gagal: " + error.message);
  }
}

/* =========================
   EKSPOR BUNDLE
========================= */

async function exportBundle() {
  try {
    const device = await getDevice();
    const tickets = await all("tickets");
    const events = await all("events");

    const bundle = {
      format: "CTVS_OFFLINE_BUNDLE_V2",
      exportedAt: new Date().toISOString(),
      device: {
        deviceId: device.deviceId,
        name: device.name,
        role: device.role
      },
      tickets,
      events
    };

    const blob = new Blob(
      [JSON.stringify(bundle, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download =
      "CTVS_" + device.deviceId + "_" + Date.now() + ".json";

    anchor.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    msg(
      "homeMsg",
      "Bundle berhasil diekspor. Pindahkan file ke perangkat tujuan."
    );

  } catch (error) {
    msg("homeMsg", "Ekspor gagal: " + error.message);
  }
}

/* =========================
   IMPOR BUNDLE
========================= */

async function importBundle(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const bundle = JSON.parse(await file.text());

    if (bundle.format !== "CTVS_OFFLINE_BUNDLE_V2") {
      throw new Error("Format bundle tidak dikenali.");
    }

    let ticketCount = 0;
    let eventCount = 0;

    for (const incoming of bundle.tickets || []) {
      if (!incoming.token) continue;

      const existing = await get("tickets", incoming.token);

      if (
        !existing ||
        statusRank(incoming.status) > statusRank(existing.status)
      ) {
        await put("tickets", {
          ...existing,
          ...incoming
        });
        ticketCount++;
      }
    }

    for (const incoming of bundle.events || []) {
      if (!incoming.eventId) continue;

      const existing = await get("events", incoming.eventId);

      if (!existing) {
        await put("events", incoming);
        eventCount++;
      }
    }

    msg(
      "homeMsg",
      "Impor berhasil. Tiket diperbarui: " +
      ticketCount + ". Log baru: " + eventCount +
      ". Periksa database sebelum Gate dibuka."
    );

    await updateStats();

  } catch (error) {
    msg("homeMsg", "Impor gagal: " + error.message);
  }

  event.target.value = "";
}

/* =========================
   SINKRONISASI EVENT
========================= */

async function syncEvents() {
  try {
    if (!navigator.onLine) {
      msg("homeMsg", "Offline. Transaksi tetap tersimpan di perangkat.");
      return;
    }

    const auth = await authPayload();

    const pending = (await all("events")).filter(
      event => event.syncStatus !== "SYNCED"
    );

    if (!pending.length) {
      msg("homeMsg", "Tidak ada transaksi yang menunggu sinkronisasi.");
      return;
    }

    const result = await api("sync", {
      ...auth,
      events: pending.map(event => ({
        eventId: event.eventId,
        token: event.token,
        eventType: event.eventType,
        deviceId: event.deviceId,
        deviceName: event.deviceName,
        createdAt: event.createdAt
      }))
    });

    const accepted = result.acceptedEventIds || [];

    for (const id of accepted) {
      const event = await get("events", id);

      if (event) {
        event.syncStatus = "SYNCED";
        event.syncedAt = new Date().toISOString();
        await put("events", event);
      }
    }

    msg(
      "homeMsg",
      "Sinkronisasi selesai. Diterima: " +
      accepted.length +
      ". Konflik: " +
      (result.conflicts || []).length +
      ". Periksa konflik melalui Control Panel."
    );

    await updateStats();

  } catch (error) {
    msg("homeMsg", "Sinkronisasi gagal: " + error.message);
  }
}

/* =========================
   RESET REGISTRASI PERANGKAT
   Data tiket dan event dipertahankan.
========================= */

async function resetDevice() {
  if (!confirm(
    "Hapus registrasi perangkat dari browser ini? " +
    "Data tiket dan log transaksi tidak akan dihapus."
  )) return;

  await remove("meta", "session");
  await remove("meta", "device");

  location.reload();
}

/* =========================
   CSV LOKAL
========================= */

function parseCSV(line) {
  const result = [];
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
      result.push(value);
      value = "";
    } else {
      value += char;
    }
  }

  result.push(value);
  return result;
}

async function importCSV() {
  try {
    const session = await requireLogin();

    if (session.user.activeRole !== "SUPERUSER") {
      throw new Error("Impor CSV hanya untuk SUPERUSER.");
    }

    const file = $("csvFile").files[0];

    if (!file) {
      msg("adminMsg", "Pilih file CSV terlebih dahulu.");
      return;
    }

    const lines = (await file.text())
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(line => line.trim());

    if (!lines.length) {
      throw new Error("File CSV kosong.");
    }

    const headers = parseCSV(lines.shift())
      .map(value => value.trim().toUpperCase());

    const tokenIndex = headers.indexOf("QR_TOKEN");
    const statusIndex = headers.indexOf("STATUS");

    if (tokenIndex < 0) {
      throw new Error("Kolom QR_TOKEN wajib tersedia.");
    }

    let count = 0;

    for (const line of lines) {
      const columns = parseCSV(line);
      const token = (columns[tokenIndex] || "").trim();

      if (!token) continue;

      const status = (
        statusIndex >= 0
          ? columns[statusIndex] || "UNACTIVATED"
          : "UNACTIVATED"
      ).trim().toUpperCase();

      if (!["UNACTIVATED", "ACTIVATED", "USED"].includes(status)) {
        continue;
      }

      const existing = await get("tickets", token);

      if (
        !existing ||
        statusRank(status) >= statusRank(existing.status)
      ) {
        await put("tickets", {
          ...existing,
          token,
          status
        });
      }

      count++;
    }

    msg(
      "adminMsg",
      count + " tiket diproses ke database lokal. Impor CSV ini tidak mengubah Google Sheets."
    );

    await updateStats();

  } catch (error) {
    msg("adminMsg", "Impor CSV gagal: " + error.message);
  }
}

/* =========================================================
   CONTROL PANEL SUPERUSER
========================================================= */

function ensureAdminTools() {
  if ($("adminTools")) return;

  const panel = document.createElement("section");
  panel.id = "adminTools";
  panel.className = "panel";

  panel.innerHTML = `
    <h2>Control Panel Administrator</h2>
    <p id="adminIdentity"></p>

    <div class="admin-section">
      <h3>Ringkasan Sistem</h3>
      <button id="refreshSummaryBtn">Muat Ringkasan</button>
      <pre id="adminSummary"></pre>
    </div>

    <hr>

    <div class="admin-section">
      <h3>Manajemen Akun</h3>

      <input id="newUsername" placeholder="Username (4-32 karakter)">
      <input id="newDisplayName" placeholder="Nama petugas">
      <input id="newPassword" type="password"
        placeholder="Password minimal 12 karakter">
      <input id="newRoles" placeholder="Role, pisahkan koma">

      <button id="createUserBtn">BUAT AKUN</button>

      <button id="loadUsersBtn">MUAT DAFTAR AKUN</button>
      <div id="usersList"></div>
    </div>

    <hr>

    <div class="admin-section">
      <h3>Manajemen Role</h3>

      <input id="newRoleName" placeholder="Nama role baru">
      <input id="newRoleDescription" placeholder="Deskripsi role">
      <input id="newRolePermissions"
        placeholder="ticket.download,ticket.sync,ticket.activate atau ticket.use">

      <button id="createRoleBtn">BUAT ROLE</button>
      <button id="loadRolesBtn">MUAT DAFTAR ROLE</button>
      <div id="rolesList"></div>
    </div>

    <hr>

    <div class="admin-section">
      <h3>Manajemen Sesi</h3>
      <button id="loadSessionsBtn">MUAT SESI AKTIF</button>
      <div id="sessionsList"></div>
    </div>

    <hr>

    <div class="admin-section">
      <h3>Audit Log</h3>
      <button id="loadAuditBtn">MUAT AUDIT LOG</button>
      <div id="auditList"></div>
    </div>

    <p id="adminToolsMsg"></p>
  `;

  const admin = $("admin");
  if (admin) admin.appendChild(panel);

  $("refreshSummaryBtn").onclick = loadAdminSummary;
  $("createUserBtn").onclick = createUser;
  $("loadUsersBtn").onclick = loadUsers;
  $("createRoleBtn").onclick = createRole;
  $("loadRolesBtn").onclick = loadRoles;
  $("loadSessionsBtn").onclick = loadSessions;
  $("loadAuditBtn").onclick = loadAudit;
}

async function adminAPI(action, payload = {}) {
  const session = await requireLogin();

  if (session.user.activeRole !== "SUPERUSER") {
    throw new Error("Akses hanya untuk SUPERUSER.");
  }

  const auth = await authPayload();

  return api(action, {
    ...auth,
    ...payload
  });
}

async function openAdmin() {
  try {
    const session = await requireLogin();

    if (session.user.activeRole !== "SUPERUSER") {
      throw new Error("Role SUPERUSER diperlukan.");
    }

    ensureAdminTools();

    $("adminIdentity").textContent =
      "Login: " + session.user.username +
      " | Role aktif: " + session.user.activeRole;

    show("admin");
    await loadAdminSummary();

  } catch (error) {
    notify(error.message);
  }
}

/* =========================
   RINGKASAN ADMIN
========================= */

async function loadAdminSummary() {
  try {
    const result = await adminAPI("adminSummary");

    $("adminSummary").textContent =
      JSON.stringify(result, null, 2);

    msg("adminToolsMsg", "Ringkasan berhasil dimuat.");

  } catch (error) {
    msg("adminToolsMsg", error.message);
  }
}

/* =========================
   MANAJEMEN AKUN
========================= */

async function createUser() {
  try {
    const username = $("newUsername").value.trim();
    const displayName = $("newDisplayName").value.trim();
    const password = $("newPassword").value;

    const roles = $("newRoles").value
      .split(",")
      .map(x => x.trim().toUpperCase())
      .filter(Boolean);

    if (!username || !displayName || !password || !roles.length) {
      throw new Error("Lengkapi seluruh data akun dan role.");
    }

    const result = await adminAPI("createUser", {
      username,
      displayName,
      password,
      roles
    });

    $("newUsername").value = "";
    $("newDisplayName").value = "";
    $("newPassword").value = "";
    $("newRoles").value = "";

    msg("adminToolsMsg", result.message);
    await loadUsers();

  } catch (error) {
    msg("adminToolsMsg", "Gagal membuat akun: " + error.message);
  }
}

async function loadUsers() {
  try {
    const result = await adminAPI("listUsers");
    const target = $("usersList");

    target.innerHTML = "";

    (result.users || []).forEach(user => {
      const item = document.createElement("div");
      item.className = "admin-item";

      item.innerHTML = `
        <strong>${escapeHTML(user.username)}</strong>
        <div>${escapeHTML(user.displayName)}</div>
        <div>Role: ${escapeHTML((user.roles || []).join(", "))}</div>
        <div>Status: ${user.enabled ? "AKTIF" : "NONAKTIF"}</div>

        <button data-action="edit">UBAH NAMA / PASSWORD</button>
        <button data-action="toggle">
          ${user.enabled ? "NONAKTIFKAN" : "AKTIFKAN"}
        </button>
      `;

      item.querySelector('[data-action="edit"]').onclick =
        () => editUser(user);

      item.querySelector('[data-action="toggle"]').onclick =
        () => toggleUser(user);

      target.appendChild(item);
    });

    msg("adminToolsMsg", "Daftar akun dimuat.");

  } catch (error) {
    msg("adminToolsMsg", error.message);
  }
}

async function editUser(user) {
  const displayName = prompt(
    "Nama petugas:",
    user.displayName
  );

  if (displayName === null) return;

  const password = prompt(
    "Password baru (kosongkan jika tidak diubah):"
  );

  if (password === null) return;

  try {
    const payload = {
      username: user.username,
      displayName
    };

    if (password) payload.password = password;

    const result = await adminAPI("updateUser", payload);

    msg("adminToolsMsg", result.message);
    await loadUsers();

  } catch (error) {
    msg("adminToolsMsg", error.message);
  }
}

async function toggleUser(user) {
  const enabled = !user.enabled;

  if (!confirm(
    (enabled ? "Aktifkan" : "Nonaktifkan") +
    " akun " + user.username + "?"
  )) return;

  try {
    const result = await adminAPI("updateUser", {
      username: user.username,
      enabled
    });

    msg("adminToolsMsg", result.message);
    await loadUsers();

  } catch (error) {
    msg("adminToolsMsg", error.message);
  }
}

/* =========================
   MANAJEMEN ROLE
========================= */

async function createRole() {
  try {
    const role = $("newRoleName").value.trim().toUpperCase();
    const description = $("newRoleDescription").value.trim();

    const permissions = $("newRolePermissions").value
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);

    if (!role || !description || !permissions.length) {
      throw new Error("Lengkapi nama, deskripsi, dan izin role.");
    }

    const result = await adminAPI("createRole", {
      role,
      description,
      permissions
    });

    $("newRoleName").value = "";
    $("newRoleDescription").value = "";
    $("newRolePermissions").value = "";

    msg("adminToolsMsg", result.message);
    await loadRoles();

  } catch (error) {
    msg("adminToolsMsg", "Gagal membuat role: " + error.message);
  }
}

async function loadRoles() {
  try {
    const result = await adminAPI("listRoles");
    const target = $("rolesList");

    target.innerHTML = "";

    (result.roles || []).forEach(role => {
      const item = document.createElement("div");
      item.className = "admin-item";

      item.innerHTML = `
        <strong>${escapeHTML(role.role)}</strong>
        <div>${escapeHTML(role.description)}</div>
        <div>Izin: ${escapeHTML((role.permissions || []).join(", "))}</div>
        <div>Status: ${role.enabled ? "AKTIF" : "NONAKTIF"}</div>
        <div>${role.isCore ? "ROLE INTI" : "ROLE KUSTOM"}</div>
      `;

      if (!role.isCore) {
        const edit = document.createElement("button");
        edit.textContent = "UBAH ROLE";
        edit.onclick = () => editRole(role);

        const del = document.createElement("button");
        del.textContent = "HAPUS ROLE";
        del.onclick = () => deleteRole(role);

        item.append(edit, del);
      }

      target.appendChild(item);
    });

    msg("adminToolsMsg", "Daftar role dimuat.");

  } catch (error) {
    msg("adminToolsMsg", error.message);
  }
}

async function editRole(role) {
  const description = prompt(
    "Deskripsi role:",
    role.description
  );

  if (description === null) return;

  const permissions = prompt(
    "Permissions, pisahkan koma:",
    (role.permissions || []).join(",")
  );

  if (permissions === null) return;

  const enabledAnswer = prompt(
    "Role aktif? Ketik TRUE atau FALSE:",
    role.enabled ? "TRUE" : "FALSE"
  );

  if (enabledAnswer === null) return;

  try {
    const result = await adminAPI("updateRole", {
      role: role.role,
      description,
      permissions: permissions.split(",")
        .map(x => x.trim())
        .filter(Boolean),
      enabled: enabledAnswer.trim().toUpperCase() === "TRUE"
    });

    msg("adminToolsMsg", result.message);
    await loadRoles();

  } catch (error) {
    msg("adminToolsMsg", error.message);
  }
}

async function deleteRole(role) {
  if (!confirm("Hapus role kustom " + role.role + "?")) return;

  try {
    const result = await adminAPI("deleteRole", {
      role: role.role
    });

    msg("adminToolsMsg", result.message);
    await loadRoles();

  } catch (error) {
    msg("adminToolsMsg", error.message);
  }
}

/* =========================
   SESI AKTIF
========================= */

async function loadSessions() {
  try {
    const result = await adminAPI("listSessions");
    const target = $("sessionsList");

    target.innerHTML = "";

    (result.sessions || []).forEach(session => {
      const item = document.createElement("div");
      item.className = "admin-item";

      item.innerHTML = `
        <strong>${escapeHTML(session.username)}</strong>
        <div>Perangkat: ${escapeHTML(session.deviceId)}</div>
        <div>Kedaluwarsa: ${escapeHTML(session.expiresAt)}</div>
        <div>Status: ${session.revoked ? "DICABUT" : "AKTIF"}</div>
      `;

      if (!session.revoked) {
        const button = document.createElement("button");
        button.textContent = "CABUT SESI";

        button.onclick = async () => {
          if (!confirm("Cabut sesi ini?")) return;

          try {
            const response = await adminAPI("revokeSession", {
              sessionId: session.sessionId
            });

            msg("adminToolsMsg", response.message);
            await loadSessions();

          } catch (error) {
            msg("adminToolsMsg", error.message);
          }
        };

        item.appendChild(button);
      }

      target.appendChild(item);
    });

  } catch (error) {
    msg("adminToolsMsg", error.message);
  }
}

/* =========================
   AUDIT LOG
========================= */

async function loadAudit() {
  try {
    const result = await adminAPI("activityLog", {
      limit: 100
    });

    const target = $("auditList");
    target.innerHTML = "";

    (result.logs || result.activities || []).forEach(log => {
      const item = document.createElement("div");
      item.className = "admin-item";

      item.textContent = [
        log.timestamp || "",
        log.username || "",
        log.action || "",
        log.detail || "",
        log.result || ""
      ].join(" | ");

      target.appendChild(item);
    });

    if (!target.children.length) {
      target.textContent = JSON.stringify(result, null, 2);
    }

  } catch (error) {
    msg("adminToolsMsg", error.message);
  }
}

/* =========================
   EVENT HANDLERS
========================= */

function bindEvents() {
  setButton("enrollBtn", "Daftarkan Perangkat", enroll);
  setButton("downloadDb", "Download Database", downloadDB);
  setButton("exportBundle", "Ekspor Bundle", exportBundle);
  setButton("syncBtn", "Sinkronisasi", syncEvents);
  setButton("resetBtn", "Reset Registrasi", resetDevice);
  setButton("processBtn", "VALIDASI TIKET", processTicket);
  setButton("importCsvBtn", "Impor CSV", importCSV);

  setButton("backBtn", "Kembali", () => {
    stopCamera();
    show("home");
  });

  setButton("adminBack", "Kembali", () => show("home"));

  setButton("startCameraBtn", "Mulai Kamera", startCamera);
  setButton("stopCameraBtn", "Matikan Kamera", stopCamera);
  setButton("nextScanBtn", "Scan Berikutnya", nextScan);
  setButton("finishBatchBtn", "Selesaikan Sesi", finishBatch);

  const bundleInput = $("importBundle");
  if (bundleInput) bundleInput.onchange = importBundle;

  const tokenInput = $("tokenInput");
  if (tokenInput) {
    tokenInput.addEventListener("keydown", event => {
      if (event.key === "Enter") processTicket();
    });
  }
}

/* =========================
   INISIALISASI APLIKASI
========================= */

async function init() {
  db = await openDB();

  ensureLoginPanel();
  bindEvents();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .catch(error => console.warn("Service Worker:", error));
  }

  if ($("deviceIdText")) {
    $("deviceIdText").textContent =
      "ID perangkat: " + deviceId();
  }

  const device = await getDevice();

  if (!device) {
    show("register");
    return;
  }

  const session = await getSession();

  if (sessionValid(session)) {
    await renderHome(device);
  } else {
    await remove("meta", "session");
    await renderHome(device);
    showLogin();
  }

  const params = new URLSearchParams(location.search);
  const token = params.get("t") || params.get("token");

  if (token && $("tokenInput")) {
    $("tokenInput").value = token;
  }

  window.addEventListener("online", () => {
    msg("homeMsg", "Koneksi internet tersedia. Sinkronisasi dapat dilakukan.");
  });

  window.addEventListener("offline", () => {
    msg("homeMsg", "Perangkat offline. Transaksi tersimpan secara lokal.");
  });
}

/* =========================
   START
========================= */

window.addEventListener("load", () => {
  init().catch(error => {
    console.error(error);
    alert("Aplikasi gagal dimulai: " + error.message);
  });
});
