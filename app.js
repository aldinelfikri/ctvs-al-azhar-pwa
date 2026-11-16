// ============================================================
// CTVS AL-AZHAR FESTIVAL 2026
// Offline Ticket Validation
// SUPERUSER, TICKETING, GATE
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbwCXKRCUjwPbE8DrRc0ZjLzZhNsAjnmXSYxAuyI-ajFZk5irFkL_mvOKZmRZvjsXmC4rA/exec";

const $ = id => document.getElementById(id);

let db = null;
let mode = null;
let syncing = false;

const DB = "ctvs_2650_v2";

// ============================================================
// DATABASE LOKAL - INDEXEDDB
// ============================================================

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);

    r.onupgradeneeded = () => {
      const d = r.result;

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

    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function get(store, key) {
  return new Promise((resolve, reject) => {
    const r = db.transaction(store)
      .objectStore(store).get(key);

    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function put(store, val) {
  return new Promise((resolve, reject) => {
    const r = db.transaction(store, "readwrite")
      .objectStore(store).put(val);

    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

function all(store) {
  return new Promise((resolve, reject) => {
    const r = db.transaction(store)
      .objectStore(store).getAll();

    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function show(id) {
  ["register", "home", "scan", "admin"].forEach(x => {
    $(x).classList.toggle("hidden", x !== id);
  });
}

function deviceId() {
  let x = localStorage.getItem("ctvs-device-id");

  if (!x) {
    x = crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now() + "-" + Math.random().toString(36).slice(2);

    localStorage.setItem("ctvs-device-id", x);
  }

  return x;
}

function msg(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

// ============================================================
// INISIALISASI APLIKASI
// ============================================================

async function init() {
  db = await openDB();

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (e) {
      console.warn("Service Worker gagal:", e);
    }
  }

  $("deviceIdText").textContent = "ID perangkat: " + deviceId();

  const d = await get("meta", "device");

  if (d) {
    await renderHome(d);
  } else {
    show("register");
  }

  const params = new URLSearchParams(location.search);
  const token = params.get("t") || params.get("token");

  if (token) {
    $("tokenInput").value = token;

    if (d) {
      show("home");
      await renderHome(d);
    }
  }

  $("enrollBtn").onclick = enroll;
  $("downloadDb").onclick = downloadDB;
  $("exportBundle").onclick = exportBundle;
  $("importBundle").onchange = importBundle;
  $("syncBtn").onclick = syncEvents;
  $("resetBtn").onclick = resetDevice;
  $("backBtn").onclick = () => show("home");
  $("processBtn").onclick = processTicket;
  $("importCsvBtn").onclick = importCSV;
  $("adminBack").onclick = () => show("home");

  window.addEventListener("online", () => {
    msg("homeMsg", "Internet terhubung. Sinkronisasi dapat dilakukan.");
  });

  window.addEventListener("offline", () => {
    msg("homeMsg", "Koneksi terputus. Transaksi akan disimpan sementara.");
  });
}

// ============================================================
// REGISTRASI PERANGKAT
// ============================================================

async function enroll() {
  if (!navigator.onLine) {
    msg("registerMsg", "Registrasi memerlukan koneksi internet.");
    return;
  }

  const name = $("deviceName").value.trim();
  const code = $("enrollCode").value.trim();

  if (!name || !code) {
    msg("registerMsg", "Nama perangkat dan kode registrasi wajib diisi.");
    return;
  }

  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        action: "enroll",
        deviceId: deviceId(),
        deviceName: name,
        enrollCode: code
      })
    });

    const j = await r.json();

    if (!j.ok) {
      throw Error(j.message || "Registrasi ditolak");
    }

    const d = {
      key: "device",
      deviceId: deviceId(),
      name: name,
      role: j.role,
      deviceToken: j.deviceToken,
      registeredAt: new Date().toISOString()
    };

    await put("meta", d);

    $("enrollCode").value = "";

    await renderHome(d);

    msg("homeMsg", "Registrasi berhasil. Hak akses: " + d.role);

  } catch (e) {
    msg("registerMsg", "Registrasi gagal: " + e.message);
  }
}

// ============================================================
// TAMPILAN BERDASARKAN PERAN
// ============================================================

async function renderHome(d) {
  show("home");

  const stats = document.querySelector(".stats");

  if (stats) {
    stats.classList.toggle("hidden", d.role !== "SUPERUSER");
  }

  if (d.role === "SUPERUSER") {
    $("deviceTitle").textContent = "SUPERUSER - " + d.name;
    $("deviceBadge").textContent = "SUPERUSER / " + d.name;

  } else if (d.role === "GATE") {
    $("deviceTitle").textContent = "Gate Entry - " + d.name;
    $("deviceBadge").textContent = "GATE / " + d.name;

  } else {
    $("deviceTitle").textContent = "Ticketing - " + d.name;
    $("deviceBadge").textContent = "TICKETING / " + d.name;
  }

  $("deviceDetail").textContent =
    "ID: " + d.deviceId + " • Hak akses: " + d.role;

  const actions = $("actions");
  actions.innerHTML = "";

  if (d.role === "TICKETING" || d.role === "SUPERUSER") {
    addAction(actions, "ACTIVATION", () => openMode("ACTIVATION"));
  }

  if (d.role === "GATE") {
    addAction(actions, "GATE ENTRY", () => openMode("GATE"));
  }

  if (d.role === "SUPERUSER") {
    addAction(actions, "SUPERUSER: Impor CSV", () => show("admin"));
  }

  await updateStats();
}

function addAction(parent, label, fn) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = fn;
  parent.appendChild(b);
}

// ============================================================
// MEMBUKA MODE VALIDASI
// ============================================================

async function openMode(m) {
  const d = await get("meta", "device");

  if (!d) {
    alert("Perangkat belum terdaftar.");
    return;
  }

  if (
    m === "ACTIVATION" &&
    d.role !== "TICKETING" &&
    d.role !== "SUPERUSER"
  ) {
    alert("Perangkat ini tidak memiliki hak Ticketing.");
    return;
  }

  if (m === "GATE" && d.role !== "GATE") {
    alert("Perangkat ini tidak memiliki hak Gate.");
    return;
  }

  mode = m;

  $("modeBadge").textContent = m;
  $("scanHeading").textContent =
    m === "GATE" ? "Gate Entry" : "Aktivasi Tiket";

  $("scanResult").className = "result hidden";

  show("scan");

  const params = new URLSearchParams(location.search);
  const token = params.get("t") || params.get("token");

  if (token) {
    $("tokenInput").value = token;
  }
}

function result(text, type) {
  $("scanResult").textContent = text;
  $("scanResult").className = "result " + type;
}

// ============================================================
// PEMERIKSAAN ANTREAN PER TIKET
// ============================================================

async function pendingEventForToken(token) {
  const events = await all("events");

  return events.find(e =>
    String(e.token) === String(token) &&
    e.syncStatus === "PENDING"
  );
}

// ============================================================
// PROSES TIKET
// ============================================================

async function processTicket() {
  const token = $("tokenInput").value.trim();

  if (!token) {
    result("QR / TOKEN TIDAK VALID", "bad");
    return;
  }

  const t = await get("tickets", token);
  const d = await get("meta", "device");

  if (!d || !t) {
    result(
      "TIKET TIDAK DITEMUKAN DI DATABASE PERANGKAT\nENTRY NOT PERMITTED",
      "bad"
    );
    return;
  }

  if (
    mode === "ACTIVATION" &&
    d.role !== "TICKETING" &&
    d.role !== "SUPERUSER"
  ) {
    result("AKSES DITOLAK", "bad");
    return;
  }

  if (mode === "GATE" && d.role !== "GATE") {
    result("AKSES DITOLAK", "bad");
    return;
  }

  if (mode !== "ACTIVATION" && mode !== "GATE") {
    result("PILIH MODE VALIDASI TERLEBIH DAHULU", "warn");
    return;
  }

  // Cegah pemindaian ulang selama transaksi pertama
  // masih menunggu sinkronisasi pada perangkat ini.
  const pending = await pendingEventForToken(token);

  if (pending) {
    result(
      "TIKET SUDAH DIPROSES DI PERANGKAT INI\n" +
      "STATUS: MENUNGGU SINKRONISASI SERVER PUSAT",
      "warn"
    );
    return;
  }

  const now = new Date().toISOString();
  let eventType = null;

  if (mode === "ACTIVATION") {
    if (t.status === "UNACTIVATED") {
      eventType = "ACTIVATE";

    } else if (t.status === "ACTIVATED") {
      result("TIKET SUDAH DIAKTIFKAN", "warn");
      return;

    } else {
      result("TIKET SUDAH DIGUNAKAN\nENTRY NOT PERMITTED", "bad");
      return;
    }

  } else if (mode === "GATE") {
    if (t.status === "ACTIVATED") {
      eventType = "GATE_USE";

    } else if (t.status === "UNACTIVATED") {
      result("TIKET BELUM DIAKTIFKAN\nENTRY NOT PERMITTED", "bad");
      return;

    } else {
      result("TIKET SUDAH DIGUNAKAN\nENTRY NOT PERMITTED", "bad");
      return;
    }
  }

  const event = {
    eventId: crypto.randomUUID(),
    token: token,
    eventType: eventType,
    deviceId: d.deviceId,
    deviceName: d.name,
    createdAt: now,
    syncStatus: "PENDING"
  };

  // Catat event sebelum melakukan komunikasi jaringan.
  // Jika koneksi gagal, antrean tetap tersedia.
  await put("events", event);

  // Status pusat tidak ditimpa.
  // pendingStatus hanya penanda lokal sementara.
  await put("tickets", {
    ...t,
    pendingStatus: eventType === "ACTIVATE"
      ? "ACTIVATED"
      : "USED",
    pendingEventId: event.eventId
  });

  if (!navigator.onLine) {
    result(
      mode === "GATE"
        ? "VALIDASI SEMENTARA - OFFLINE\n" +
          "BELUM DIKONFIRMASI SERVER PUSAT\n" +
          "JANGAN ANGGAP INI IZIN MASUK FINAL"
        : "AKTIVASI SEMENTARA - OFFLINE\n" +
          "MENUNGGU KONFIRMASI SERVER PUSAT",
      "warn"
    );

    await updateStats();
    return;
  }

  result("MENGIRIM VALIDASI KE SERVER PUSAT...", "warn");

  await syncEvents();

  const finalEvent = await get("events", event.eventId);

  if (finalEvent?.syncStatus === "SYNCED") {
    result(
      mode === "GATE"
        ? "TIKET DIKONFIRMASI SERVER PUSAT\n" +
          "IZIN MASUK DITERIMA\n\n" +
          "BERI TANDA FLUORESEN DAN PASANG GELANG SEKARANG."
        : "AKTIVASI TIKET DIKONFIRMASI SERVER PUSAT",
      "ok"
    );

  } else if (finalEvent?.syncStatus === "CONFLICT") {
    result(
      "VALIDASI DITOLAK SERVER PUSAT\n" +
      "ENTRY NOT PERMITTED\n" +
      "ALASAN: " + (finalEvent.conflictReason || "KONFLIK"),
      "bad"
    );

  } else {
    result(
      "VALIDASI BELUM TERKONFIRMASI\n" +
      "TRANSAKSI TERSIMPAN DI ANTREAN",
      "warn"
    );
  }

  await updateStats();
}

// ============================================================
// STATISTIK LOKAL - SUPERUSER
// ============================================================

async function updateStats() {
  const d = await get("meta", "device");
  const stats = document.querySelector(".stats");

  if (!d || d.role !== "SUPERUSER") {
    if (stats) stats.classList.add("hidden");
    return;
  }

  if (stats) stats.classList.remove("hidden");

  const ts = await all("tickets");
  const es = await all("events");

  $("nTickets").textContent = ts.length;

  $("nActivated").textContent = ts.filter(
    x => x.status === "ACTIVATED" || x.status === "USED"
  ).length;

  $("nUsed").textContent = ts.filter(
    x => x.status === "USED"
  ).length;

  $("nPending").textContent = es.filter(
    x => x.syncStatus === "PENDING" || x.syncStatus === "CONFLICT"
  ).length;
}

// ============================================================
// UNDUH DATABASE PUSAT
// ============================================================

async function downloadDB(options = {}) {
  if (!navigator.onLine) {
    if (!options.silent) {
      msg("homeMsg", "Tidak ada internet. Database lokal tetap tersedia.");
    }
    return false;
  }

  try {
    const d = await get("meta", "device");

    if (!d) {
      throw Error("Perangkat belum terdaftar.");
    }

    const url = API_URL +
      "?action=download&deviceId=" +
      encodeURIComponent(d.deviceId) +
      "&deviceToken=" +
      encodeURIComponent(d.deviceToken);

    const r = await fetch(url);
    const j = await r.json();

    if (!j.ok) {
      throw Error(j.message || "Gagal mengunduh database pusat.");
    }

    const localEvents = await all("events");

    for (const t of j.tickets) {
      const old = await get("tickets", t.token);

      const hasPending = localEvents.some(e =>
        String(e.token) === String(t.token) &&
        e.syncStatus === "PENDING"
      );

      await put("tickets", {
        ...(old || {}),
        token: t.token,
        status: t.status,
        pendingStatus: hasPending
          ? old?.pendingStatus || null
          : null,
        pendingEventId: hasPending
          ? old?.pendingEventId || null
          : null
      });
    }

    if (!options.silent) {
      msg(
        "homeMsg",
        "Database pusat berhasil diperbarui: " +
        j.tickets.length + " tiket."
      );
    }

    await updateStats();
    return true;

  } catch (e) {
    if (!options.silent) {
      msg("homeMsg", "Gagal mengunduh database: " + e.message);
    }

    return false;
  }
}

// ============================================================
// EKSPOR DATA PERANGKAT
// ============================================================

async function exportBundle() {
  const d = await get("meta", "device");

  if (!d) {
    msg("homeMsg", "Perangkat belum terdaftar.");
    return;
  }

  const tickets = await all("tickets");
  const events = await all("events");

  const bundle = {
    format: "CTVS_OFFLINE_BUNDLE_V2",
    exportedAt: new Date().toISOString(),
    device: {
      deviceId: d.deviceId,
      name: d.name,
      role: d.role
    },
    tickets,
    events
  };

  const blob = new Blob(
    [JSON.stringify(bundle)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "CTVS_" + d.deviceId + "_" + Date.now() + ".json";
  a.click();

  URL.revokeObjectURL(url);

  msg(
    "homeMsg",
    "Paket data perangkat diekspor. " +
    "Pastikan transaksi yang belum sinkron ikut dipindahkan."
  );
}

// ============================================================
// IMPOR DATA PERANGKAT LAIN
// ============================================================

async function importBundle(ev) {
  const file = ev.target.files[0];

  if (!file) return;

  try {
    const b = JSON.parse(await file.text());

    if (b.format !== "CTVS_OFFLINE_BUNDLE_V2") {
      throw Error("Format paket tidak dikenali.");
    }

    for (const incoming of b.tickets || []) {
      if (!incoming.token) continue;

      const old = await get("tickets", incoming.token);

      if (!old) {
        await put("tickets", incoming);
      }
    }

    for (const incoming of b.events || []) {
      if (!incoming.eventId) continue;

      const old = await get("events", incoming.eventId);

      if (!old) {
        await put("events", incoming);
      }
    }

    msg(
      "homeMsg",
      "Impor berhasil dari " +
      (b.device?.name || "perangkat lain") +
      ". Data dan antrean transaksi digabungkan."
    );

    await updateStats();

  } catch (e) {
    msg("homeMsg", "Impor gagal: " + e.message);
  }

  ev.target.value = "";
}

// ============================================================
// SINKRONISASI TRANSAKSI
// ============================================================

async function syncEvents() {
  if (syncing) {
    msg("homeMsg", "Sinkronisasi sedang berlangsung.");
    return;
  }

  if (!navigator.onLine) {
    msg("homeMsg", "Offline. Transaksi tetap tersimpan di perangkat.");
    return;
  }

  const d = await get("meta", "device");

  if (!d) {
    msg("homeMsg", "Perangkat belum terdaftar.");
    return;
  }

  const events = (await all("events")).filter(
    e => e.syncStatus === "PENDING"
  );

  if (!events.length) {
    msg("homeMsg", "Tidak ada transaksi yang menunggu sinkronisasi.");
    return;
  }

  syncing = true;

  msg("homeMsg", "Mengirim " + events.length + " transaksi ke server...");

  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        action: "sync",
        deviceId: d.deviceId,
        deviceToken: d.deviceToken,
        events: events
      })
    });

    const j = await r.json();

    if (!j.ok) {
      throw Error(j.message || "Sinkronisasi ditolak server.");
    }

    const accepted = new Set(
      (j.acceptedEventIds || []).map(String)
    );

    const conflicts = new Map(
      (j.conflicts || []).map(x => [
        String(x.eventId),
        x
      ])
    );

    for (const ev of events) {
      const saved = await get("events", ev.eventId);

      if (!saved) continue;

      if (accepted.has(String(ev.eventId))) {
        saved.syncStatus = "SYNCED";
        saved.syncedAt = new Date().toISOString();
        saved.conflictReason = null;

        await put("events", saved);

      } else if (conflicts.has(String(ev.eventId))) {
        saved.syncStatus = "CONFLICT";
        saved.conflictReason =
          conflicts.get(String(ev.eventId)).reason || "UNKNOWN";
        saved.conflictAt = new Date().toISOString();

        await put("events", saved);
      }
    }

    // Status pusat menjadi acuan setelah sinkronisasi.
    const refreshed = await downloadDB({ silent: true });

    const acceptedCount = (j.acceptedEventIds || []).length;
    const conflictCount = (j.conflicts || []).length;

    msg(
      "homeMsg",
      "Sinkronisasi selesai. Diterima: " +
      acceptedCount +
      "; konflik: " +
      conflictCount +
      ". " +
      (refreshed
        ? "Database pusat telah diperbarui."
        : "Pembaruan database pusat belum berhasil.")
    );

  } catch (e) {
    msg("homeMsg", "Sinkronisasi gagal: " + e.message);

  } finally {
    syncing = false;
    await updateStats();
  }
}

// ============================================================
// HAPUS REGISTRASI LOKAL
// ============================================================

async function resetDevice() {
  if (!confirm(
    "Hapus registrasi lokal? Database tiket dan log tidak ikut dihapus."
  )) {
    return;
  }

  const t = db.transaction("meta", "readwrite");
  t.objectStore("meta").delete("device");

  location.reload();
}

// ============================================================
// IMPOR CSV KHUSUS SUPERUSER
// ============================================================

function parseCSV(line) {
  const a = [];
  let s = "";
  let q = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"') {
      if (q && line[i + 1] === '"') {
        s += '"';
        i++;
      } else {
        q = !q;
      }

    } else if (c === "," && !q) {
      a.push(s);
      s = "";

    } else {
      s += c;
    }
  }

  a.push(s);
  return a;
}

async function importCSV() {
  const d = await get("meta", "device");

  if (!d || d.role !== "SUPERUSER") {
    msg("adminMsg", "Akses ditolak. Khusus SUPERUSER.");
    return;
  }

  const f = $("csvFile").files[0];

  if (!f) {
    return msg("adminMsg", "Pilih CSV terlebih dahulu.");
  }

  const lines = (await f.text())
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean);

  if (!lines.length) {
    return msg("adminMsg", "File CSV kosong.");
  }

  const h = parseCSV(lines.shift())
    .map(x => x.trim().toUpperCase());

  const ti = h.indexOf("QR_TOKEN");
  const si = h.indexOf("STATUS");

  if (ti < 0) {
    return msg("adminMsg", "Header QR_TOKEN wajib ada.");
  }

  let n = 0;

  for (const line of lines) {
    const c = parseCSV(line);
    const token = (c[ti] || "").trim();

    if (!token) continue;

    const status = (
      si >= 0 ? (c[si] || "UNACTIVATED") : "UNACTIVATED"
    ).trim().toUpperCase();

    if (!["UNACTIVATED", "ACTIVATED", "USED"].includes(status)) {
      continue;
    }

    await put("tickets", {
      token: token,
      status: status
    });

    n++;
  }

  msg("adminMsg", n + " tiket diimpor.");
  await updateStats();
}

// ============================================================
// JALANKAN APLIKASI
// ============================================================

window.addEventListener("load", () => {
  init().catch(e => {
    console.error(e);
    alert("Gagal memulai aplikasi: " + e.message);
  });
});
