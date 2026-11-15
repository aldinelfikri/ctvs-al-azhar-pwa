
// CTVS Offline v3 - Super User, Ticketing, dan Gate
const API_URL = "https://script.google.com/macros/s/AKfycbwCXKRCUjwPbE8DrRc0ZjLzZhNsAjnmXSYxAuyI-ajFZk5irFkL_mvOKZmRZvjsXmC4rA/exec";

const $ = id => document.getElementById(id);

let db = null;
let mode = null;
let currentScannedToken = "";

const DB = "ctvs_2650_v2";

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);

    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("tickets", { keyPath: "token" });
      d.createObjectStore("events", { keyPath: "eventId" });
      d.createObjectStore("meta", { keyPath: "key" });
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
  $(id).textContent = text;
}

async function init() {
  const params = new URLSearchParams(location.search);
  currentScannedToken = (params.get("t") || params.get("token") || "").trim();
  db = await openDB();

  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("./sw.js");
  }

  $("deviceIdText").textContent = "ID perangkat: " + deviceId();

  const d = await get("meta", "device");

  if (d) {
    await renderHome(d);
  } else {
    show("register");
  }

  if (d && currentScannedToken && localStorage.getItem("ctvs-batch-active") === "1" &&
      (d.role === "TICKETING" || d.role === "SUPERUSER")) {
    await addScannedTokenToBatch(currentScannedToken);
    currentScannedToken = "";
    history.replaceState({}, "", location.pathname);
    await renderHome(d);
  }

  if (currentScannedToken) {
    $("tokenInput").value = currentScannedToken;

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
  $("batchActivateBtn").onclick = activateBatch;
  $("batchClearBtn").onclick = clearBatch;
  $("batchExitBtn").onclick = exitBatchMode;
  $("importCsvBtn").onclick = importCSV;
  $("adminBack").onclick = () => show("home");
}

/* REGISTRASI PERANGKAT */
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

/* TAMPILAN BERDASARKAN PERAN */
async function renderHome(d) {
  show("home");

  const stats = document.querySelector(".stats");

  // Hanya SUPERUSER yang dapat melihat statistik.
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

  // Konfirmasi pemindaian QR pada halaman utama.
  const scanNotice = $("scanNotice");
  if (scanNotice) {
    if (currentScannedToken) {
      $("scannedTokenText").textContent = currentScannedToken;
      scanNotice.classList.remove("hidden");
    } else {
      scanNotice.classList.add("hidden");
      $("scannedTokenText").textContent = "";
    }
  }

  const batchPanel = $("batchPanel");
  if (batchPanel) {
    batchPanel.classList.toggle("hidden", localStorage.getItem("ctvs-batch-active") !== "1" ||
      (d.role !== "TICKETING" && d.role !== "SUPERUSER"));
    if (localStorage.getItem("ctvs-batch-active") === "1") await renderBatchQueue();
  }

  const actions = $("actions");
  actions.innerHTML = "";

  if (d.role === "TICKETING" || d.role === "SUPERUSER") {
    addAction(actions, "ACTIVATION", () => openMode("ACTIVATION"));
    addAction(actions, "BATCH ACTIVATION (MAKS. 50 TIKET)", () => startBatchMode());
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

/* MEMBUKA MODE VALIDASI */
async function openMode(m) {
  const d = await get("meta", "device");

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

  if (currentScannedToken) {
    $("tokenInput").value = currentScannedToken;
  }
}

/* BATCH ACTIVATION - MAKSIMAL 50 TIKET */
const BATCH_LIMIT = 50;
const BATCH_QUEUE_KEY = "ctvs-batch-queue-v1";
function readBatchQueue(){try{const q=JSON.parse(localStorage.getItem(BATCH_QUEUE_KEY)||"[]");return Array.isArray(q)?q:[]}catch(e){return []}}
function writeBatchQueue(q){localStorage.setItem(BATCH_QUEUE_KEY,JSON.stringify(q))}
async function startBatchMode(){
 const d=await get("meta","device");
 if(!d||(d.role!=="TICKETING"&&d.role!=="SUPERUSER")){alert("BATCH ACTIVATION hanya tersedia untuk perangkat Ticketing.");return}
 localStorage.setItem("ctvs-batch-active","1");writeBatchQueue([]);await renderHome(d);
 msg("batchMsg","Mode batch aktif. Pindai QR satu per satu menggunakan kamera bawaan smartphone. Setiap tautan QR yang dibuka akan otomatis menambahkan token ke daftar.");
 $("batchPanel").scrollIntoView({behavior:"smooth",block:"start"});
}
async function addScannedTokenToBatch(token){
 token=String(token||"").trim();if(!token)return;
 const q=readBatchQueue();
 if(q.some(x=>x.token===token)){msg("batchMsg","QR ini sudah tercatat. Pemindaian ulang tidak menambah jumlah tiket.");return}
 if(q.length>=BATCH_LIMIT){msg("batchMsg","Batas 50 tiket tercapai. Proses aktivasi massal sebelum batch berikutnya.");return}
 q.push({token,scannedAt:new Date().toISOString()});writeBatchQueue(q);await renderBatchQueue();
 msg("batchMsg","QR "+token+" berhasil ditambahkan. Total: "+q.length+"/"+BATCH_LIMIT+".");
}
async function renderBatchQueue(){
 if(!$("batchPanel"))return;const q=readBatchQueue();$("batchCount").textContent=q.length;const list=$("batchList");list.innerHTML="";
 q.forEach((x,i)=>{const row=document.createElement("div");row.className="batch-item";const t=document.createElement("span");t.textContent=(i+1)+". "+x.token;const s=document.createElement("small");s.textContent="Menunggu";row.append(t,s);list.appendChild(row)});
 $("batchActivateBtn").disabled=q.length===0;
}
async function clearBatch(){if(!confirm("Kosongkan daftar batch? Status tiket belum berubah."))return;writeBatchQueue([]);await renderBatchQueue();msg("batchMsg","Daftar batch dikosongkan. Tidak ada status tiket yang diubah.")}
async function exitBatchMode(){if(!confirm("Keluar dari mode batch dan hapus daftar yang belum diproses?"))return;localStorage.removeItem("ctvs-batch-active");writeBatchQueue([]);const d=await get("meta","device");await renderHome(d);msg("homeMsg","Mode Batch Activation ditutup.")}
async function activateBatch(){
 const d=await get("meta","device");if(!d||(d.role!=="TICKETING"&&d.role!=="SUPERUSER")){msg("batchMsg","Akses ditolak.");return}
 const q=readBatchQueue();if(!q.length){msg("batchMsg","Belum ada tiket dalam daftar batch.");return}
 if(!confirm("Aktivasi "+q.length+" tiket yang memenuhi syarat? Tiket tidak dikenal atau yang statusnya bukan UNACTIVATED akan ditolak."))return;
 const eligible=[],rejected=[],now=new Date().toISOString();
 for(const x of q){const t=await get("tickets",x.token);if(!t)rejected.push({token:x.token,reason:"Token tidak ditemukan di database lokal"});else if(t.status!=="UNACTIVATED")rejected.push({token:x.token,reason:"Status saat ini: "+t.status});else eligible.push({ticket:{...t,status:"ACTIVATED",activatedAt:now},event:{eventId:crypto.randomUUID(),token:x.token,eventType:"ACTIVATE",deviceId:d.deviceId,deviceName:d.name,createdAt:now,syncStatus:"PENDING"}})}
 if(eligible.length){await new Promise((resolve,reject)=>{const tx=db.transaction(["tickets","events"],"readwrite");const ts=tx.objectStore("tickets"),es=tx.objectStore("events");eligible.forEach(x=>{ts.put(x.ticket);es.put(x.event)});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error("Transaksi batch gagal"));tx.onabort=()=>reject(tx.error||new Error("Transaksi batch dibatalkan"))})}
 writeBatchQueue([]);await renderBatchQueue();await updateStats();
 const text="BATCH ACTIVATION SELESAI\nBerhasil: "+eligible.length+"\nDitolak: "+rejected.length+(rejected.length?"\n\nRincian penolakan:\n"+rejected.map(x=>x.token+" — "+x.reason).join("\n"):"");
 msg("batchMsg",text);
}

function result(text, type) {
  $("scanResult").textContent = text;
  $("scanResult").className = "result " + type;
}

/* PROSES TIKET */
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
      "TICKET INVALID\n(ENTRY NOT PERMITTED)\nToken tidak ditemukan pada database lokal.",
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

  let eventType = null;
  const now = new Date().toISOString();

  if (mode === "ACTIVATION") {
    if (t.status === "UNACTIVATED") {
      t.status = "ACTIVATED";
      t.activatedAt = now;

      eventType = "ACTIVATE";

      result(
        "TICKET HAS BEEN VALIDATED\n(GATE ENTRY PERMITTED)",
        "ok"
      );

    } else if (t.status === "ACTIVATED") {
      result("TICKET ALREADY ACTIVATED", "warn");

    } else {
      result(
        "TICKET HAS BEEN USED\n(ENTRY NOT PERMITTED)",
        "bad"
      );
    }

  } else if (mode === "GATE") {
    if (t.status === "ACTIVATED") {
      t.status = "USED";
      t.usedAt = now;

      eventType = "GATE_USE";

      result(
        "TICKET VALID\n(ENTRY PERMITTED)\n\nBERI TANDA FLUORESEN DAN PASANG GELANG SEKARANG.",
        "ok"
      );

    } else if (t.status === "UNACTIVATED") {
      result(
        "TICKET INVALID\n(ENTRY NOT PERMITTED)",
        "bad"
      );

    } else {
      result(
        "TICKET HAS BEEN USED\n(ENTRY NOT PERMITTED)",
        "bad"
      );
    }

  } else {
    result("Pilih fungsi validasi terlebih dahulu.", "warn");
    return;
  }

  if (eventType) {
    await put("tickets", t);

    await put("events", {
      eventId: crypto.randomUUID(),
      token: token,
      eventType: eventType,
      deviceId: d.deviceId,
      deviceName: d.name,
      createdAt: now,
      syncStatus: "PENDING"
    });
  }

  await updateStats();
}

/* STATISTIK LOKAL: KHUSUS SUPERUSER */
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
    x => x.syncStatus !== "SYNCED"
  ).length;
}

/* UNDUH DATABASE PUSAT */
async function downloadDB() {
  if (!navigator.onLine) {
    msg("homeMsg", "Tidak ada internet. Database lokal tetap tersedia.");
    return;
  }

  try {
    const d = await get("meta", "device");

    const url = API_URL +
      "?action=download&deviceId=" +
      encodeURIComponent(d.deviceId) +
      "&deviceToken=" +
      encodeURIComponent(d.deviceToken);

    const r = await fetch(url);
    const j = await r.json();

    if (!j.ok) throw Error(j.message);

    for (const t of j.tickets) {
      await put("tickets", {
        token: t.token,
        status: t.status
      });
    }

    // Informasi jumlah tiket hanya ditampilkan kepada SUPERUSER.
    // Petugas TICKETING dan GATE menerima notifikasi umum.
    if (d.role === "SUPERUSER") {
      msg(
        "homeMsg",
        "Database pusat berhasil diunduh: " + j.tickets.length + " tiket."
      );
    } else {
      msg(
        "homeMsg",
        "Database pusat berhasil diunduh seluruhnya"
      );
    }

    await updateStats();

  } catch (e) {
    msg("homeMsg", "Gagal mengunduh database: " + e.message);
  }
}

/* EKSPOR DATA PERANGKAT */
async function exportBundle() {
  const d = await get("meta", "device");
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
    "Paket data perangkat diekspor. Transfer file ini ke perangkat tujuan sebelum Gate dibuka."
  );
}

/* IMPOR DATA PERANGKAT LAIN */
async function importBundle(ev) {
  const file = ev.target.files[0];
  if (!file) return;

  try {
    const b = JSON.parse(await file.text());

    if (b.format !== "CTVS_OFFLINE_BUNDLE_V2") {
      throw Error("Format paket tidak dikenali");
    }

    const rank = {
      UNACTIVATED: 0,
      ACTIVATED: 1,
      USED: 2
    };

    for (const incoming of b.tickets || []) {
      const old = await get("tickets", incoming.token);

      if (
        !old ||
        rank[incoming.status] > rank[old.status]
      ) {
        await put("tickets", incoming);
      }
    }

    for (const incoming of b.events || []) {
      if (!(await get("events", incoming.eventId))) {
        await put("events", incoming);
      }
    }

    msg(
      "homeMsg",
      "Impor berhasil dari " +
      (b.device?.name || "perangkat lain") +
      ". Tiket dan log digabungkan. Periksa jumlah database sebelum Gate dibuka."
    );

    await updateStats();

  } catch (e) {
    msg("homeMsg", "Impor gagal: " + e.message);
  }

  ev.target.value = "";
}

/* SINKRONISASI */
async function syncEvents() {
  if (!navigator.onLine) {
    msg("homeMsg", "Offline. Transaksi tetap tersimpan di perangkat.");
    return;
  }

  const d = await get("meta", "device");

  const events = (await all("events")).filter(
    e => e.syncStatus !== "SYNCED"
  );

  if (!events.length) {
    msg("homeMsg", "Tidak ada transaksi yang menunggu sinkronisasi.");
    return;
  }

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
      throw Error(j.message || "Ditolak");
    }

    for (const id of j.acceptedEventIds || []) {
      const e = await get("events", id);

      if (e) {
        e.syncStatus = "SYNCED";
        await put("events", e);
      }
    }

    msg(
      "homeMsg",
      "Sinkronisasi selesai. Diterima: " +
      (j.acceptedEventIds || []).length +
      "; konflik: " +
      (j.conflicts || []).length +
      ". Konflik harus diperiksa di laporan pusat."
    );

  } catch (e) {
    msg("homeMsg", "Sinkronisasi gagal: " + e.message);
  }

  await updateStats();
}

/* HAPUS REGISTRASI LOKAL */
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

/* IMPOR CSV KHUSUS SUPERUSER */
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
    return msg("adminMsg", "Pilih CSV terlebih dahulu");
  }

  const lines = (await f.text())
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean);

  const h = parseCSV(lines.shift())
    .map(x => x.trim().toUpperCase());

  const ti = h.indexOf("QR_TOKEN");
  const si = h.indexOf("STATUS");

  if (ti < 0) {
    return msg("adminMsg", "Header QR_TOKEN wajib ada");
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

window.addEventListener("load", () => {
  init().catch(e => {
    alert("Gagal memulai aplikasi: " + e.message);
  });
});
