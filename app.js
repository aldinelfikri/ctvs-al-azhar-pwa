// CTVS Offline v2. QR gelang berisi URL aplikasi dengan parameter ?t=TOKEN.
// Kamera bawaan iOS/Android membuka URL; tidak memerlukan scanner library di dalam aplikasi.
const API_URL="https://script.google.com/macros/s/AKfycbwCXKRCUjwPbE8DrRc0ZjLzZhNsAjnmXSYxAuyI-ajFZk5irFkL_mvOKZmRZvjsXmC4rA/exec";
const $=id=>document.getElementById(id);
let db=null, mode=null;
const DB="ctvs_2650_v2";
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore("tickets",{keyPath:"token"});d.createObjectStore("events",{keyPath:"eventId"});d.createObjectStore("meta",{keyPath:"key"})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function get(store,key){return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function put(store,val){return new Promise((resolve,reject)=>{const r=db.transaction(store,"readwrite").objectStore(store).put(val);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)})}
function all(store){return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function show(id){["register","home","scan","admin"].forEach(x=>$(x).classList.toggle("hidden",x!==id))}
function deviceId(){let x=localStorage.getItem("ctvs-device-id");if(!x){x=(crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random().toString(36).slice(2));localStorage.setItem("ctvs-device-id",x)}return x}
function msg(id,text){$(id).textContent=text}
async function init(){
 db=await openDB();
 if("serviceWorker" in navigator) await navigator.serviceWorker.register("./sw.js");
 $("deviceIdText").textContent="ID perangkat: "+deviceId();
 const d=await get("meta","device");
 if(d){await renderHome(d)}else show("register");
 // Token dari QR URL tetap dapat dibaca setelah halaman dibuka melalui cache service worker.
 const token=new URLSearchParams(location.search).get("t")||new URLSearchParams(location.search).get("token");
 if(token){$("tokenInput").value=token;if(d){show("home");await renderHome(d);}}
 $("enrollBtn").onclick=enroll;
 $("downloadDb").onclick=downloadDB;
 $("exportBundle").onclick=exportBundle;
 $("importBundle").onchange=importBundle;
 $("syncBtn").onclick=syncEvents;
 $("resetBtn").onclick=resetDevice;
 $("backBtn").onclick=()=>show("home");
 $("processBtn").onclick=processTicket;
 $("importCsvBtn").onclick=importCSV;
 $("adminBack").onclick=()=>show("home");
}
async function enroll(){
 if(!navigator.onLine){msg("registerMsg","Registrasi/perubahan hak perangkat memerlukan internet.");return}
 const name=$("deviceName").value.trim(),code=$("enrollCode").value.trim();
 if(!name||!code){msg("registerMsg","Nama perangkat dan kode registrasi wajib diisi.");return}
 try{
  const r=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"enroll",deviceId:deviceId(),deviceName:name,enrollCode:code})});
  const j=await r.json();if(!j.ok)throw Error(j.message||"Registrasi ditolak");
  const d={key:"device",deviceId:deviceId(),name,role:j.role,deviceToken:j.deviceToken,registeredAt:new Date().toISOString()};
  await put("meta",d);await renderHome(d);msg("homeMsg","Registrasi berhasil. Hak akses: "+d.role);
 }catch(e){msg("registerMsg","Registrasi gagal: "+e.message)}
}
async function renderHome(d){
 show("home");$("deviceTitle").textContent=d.name;
 $("deviceDetail").textContent="ID: "+d.deviceId+" • Hak akses: "+d.role;
 $("deviceBadge").textContent=d.name+" / "+d.role;
 const actions=$("actions");actions.innerHTML="";
 if(d.role==="TICKETING"||d.role==="ADMIN")addAction(actions,"ACTIVATION",()=>openMode("ACTIVATION"));
 if(d.role==="GATE"||d.role==="ADMIN")addAction(actions,"GATE ENTRY",()=>openMode("GATE"));
 if(d.role==="ADMIN")addAction(actions,"ADMIN: Impor CSV",()=>show("admin"));
 await updateStats();
}
function addAction(parent,label,fn){const b=document.createElement("button");b.textContent=label;b.onclick=fn;parent.appendChild(b)}
async function openMode(m){
 const d=await get("meta","device");
 if(m==="GATE"&&d.role!=="GATE"&&d.role!=="ADMIN"){alert("Perangkat ini tidak memiliki hak Gate.");return}
 mode=m;$("modeBadge").textContent=m;$("scanHeading").textContent=m==="GATE"?"Gate Entry":"Aktivasi Tiket";
 $("scanResult").className="result hidden";show("scan");
 const token=new URLSearchParams(location.search).get("t")||new URLSearchParams(location.search).get("token");
 if(token)$("tokenInput").value=token;
}
function result(text,type){$("scanResult").textContent=text;$("scanResult").className="result "+type}
async function processTicket(){
 const token=$("tokenInput").value.trim();if(!token){result("QR / TOKEN TIDAK VALID","bad");return}
 const t=await get("tickets",token),d=await get("meta","device");
 if(!t){result("TICKET INVALID\n(ENTRY NOT PERMITTED)\nToken tidak ditemukan pada database lokal.","bad");return}
 let eventType=null;
 if(mode==="ACTIVATION"){
  if(t.status==="UNACTIVATED"){t.status="ACTIVATED";t.activatedAt=new Date().toISOString();eventType="ACTIVATE";result("TICKET HAS BEEN VALIDATED\n(GATE ENTRY PERMITTED)","ok")}
  else if(t.status==="ACTIVATED")result("TICKET ALREADY ACTIVATED","warn");
  else result("TICKET HAS BEEN USED\n(ENTRY NOT PERMITTED)","bad");
 }else if(mode==="GATE"){
  if(t.status==="ACTIVATED"){t.status="USED";t.usedAt=new Date().toISOString();eventType="GATE_USE";result("TICKET VALID\n(ENTRY PERMITTED)\n\nBERI TANDA FLUORESEN DAN PASANG GELANG SEKARANG.","ok")}
  else if(t.status==="UNACTIVATED")result("TICKET INVALID\n(ENTRY NOT PERMITTED)","bad");
  else result("TICKET HAS BEEN USED\n(ENTRY NOT PERMITTED)","bad");
 }else{result("Pilih fungsi validasi terlebih dahulu.","warn");return}
 if(eventType){
  await put("tickets",t);
  await put("events",{eventId:crypto.randomUUID(),token,eventType,deviceId:d.deviceId,deviceName:d.name,createdAt:new Date().toISOString(),syncStatus:"PENDING"});
 }
 await updateStats();
}
async function updateStats(){
 const ts=await all("tickets"),es=await all("events");
 $("nTickets").textContent=ts.length;
 $("nActivated").textContent=ts.filter(x=>x.status==="ACTIVATED"||x.status==="USED").length;
 $("nUsed").textContent=ts.filter(x=>x.status==="USED").length;
 $("nPending").textContent=es.filter(x=>x.syncStatus!=="SYNCED").length;
}
async function downloadDB(){
 if(!navigator.onLine){msg("homeMsg","Tidak ada internet. Database lokal tetap tersedia.");return}
 try{const r=await fetch(API_URL+"?action=download&deviceId="+encodeURIComponent((await get("meta","device")).deviceId)+"&deviceToken="+encodeURIComponent((await get("meta","device")).deviceToken)),j=await r.json();if(!j.ok)throw Error(j.message);
 for(const t of j.tickets)await put("tickets",{token:t.token,status:t.status});
 msg("homeMsg","Database pusat berhasil diunduh: "+j.tickets.length+" tiket.");await updateStats();
 }catch(e){msg("homeMsg","Gagal mengunduh database: "+e.message)}
}
async function exportBundle(){
 const d=await get("meta","device"),tickets=await all("tickets"),events=await all("events");
 const bundle={format:"CTVS_OFFLINE_BUNDLE_V2",exportedAt:new Date().toISOString(),device:{deviceId:d.deviceId,name:d.name,role:d.role},tickets,events};
 const blob=new Blob([JSON.stringify(bundle)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download="CTVS_"+d.deviceId+"_"+Date.now()+".json";a.click();URL.revokeObjectURL(url);
 msg("homeMsg","Paket data perangkat diekspor. Transfer file ini ke perangkat tujuan sebelum Gate dibuka.");
}
async function importBundle(ev){
 const file=ev.target.files[0];if(!file)return;
 try{
  const b=JSON.parse(await file.text());if(b.format!=="CTVS_OFFLINE_BUNDLE_V2")throw Error("Format paket tidak dikenali");
  // Status tidak pernah diturunkan: USED > ACTIVATED > UNACTIVATED.
  const rank={UNACTIVATED:0,ACTIVATED:1,USED:2};
  for(const incoming of b.tickets||[]){
   const old=await get("tickets",incoming.token);
   if(!old||rank[incoming.status]>rank[old.status])await put("tickets",incoming);
  }
  for(const incoming of b.events||[])if(!(await get("events",incoming.eventId)))await put("events",incoming);
  msg("homeMsg","Impor berhasil dari "+(b.device?.name||"perangkat lain")+". Tiket dan log digabungkan. Periksa jumlah database sebelum Gate dibuka.");
  await updateStats();
 }catch(e){msg("homeMsg","Impor gagal: "+e.message)}
 ev.target.value="";
}
async function syncEvents(){
 if(!navigator.onLine){msg("homeMsg","Offline. Transaksi tetap tersimpan di perangkat.");return}
 const d=await get("meta","device"),events=(await all("events")).filter(e=>e.syncStatus!=="SYNCED");
 if(!events.length){msg("homeMsg","Tidak ada transaksi yang menunggu sinkronisasi.");return}
 try{
  const r=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"sync",deviceId:d.deviceId,deviceToken:d.deviceToken,events})});
  const j=await r.json();if(!j.ok)throw Error(j.message||"Ditolak");
  for(const id of j.acceptedEventIds||[]){const e=await get("events",id);if(e){e.syncStatus="SYNCED";await put("events",e)}}
  msg("homeMsg","Sinkronisasi selesai. Diterima: "+(j.acceptedEventIds||[]).length+"; konflik: "+(j.conflicts||[]).length+". Konflik harus diperiksa di laporan pusat.");
 }catch(e){msg("homeMsg","Sinkronisasi gagal: "+e.message)}
 await updateStats();
}
async function resetDevice(){if(!confirm("Hapus registrasi lokal? Database tiket dan log tidak ikut dihapus."))return;const t=db.transaction("meta","readwrite");t.objectStore("meta").delete("device");location.reload()}
function parseCSV(line){const a=[];let s="",q=false;for(let i=0;i<line.length;i++){let c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){s+='"';i++}else q=!q}else if(c===","&&!q){a.push(s);s=""}else s+=c}a.push(s);return a}
async function importCSV(){
 const f=$("csvFile").files[0];if(!f)return msg("adminMsg","Pilih CSV terlebih dahulu");
 const lines=(await f.text()).replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean),h=parseCSV(lines.shift()).map(x=>x.trim().toUpperCase()),ti=h.indexOf("QR_TOKEN"),si=h.indexOf("STATUS");
 if(ti<0)return msg("adminMsg","Header QR_TOKEN wajib ada");
 let n=0;for(const line of lines){const c=parseCSV(line),token=(c[ti]||"").trim();if(!token)continue;const status=(si>=0?(c[si]||"UNACTIVATED"):"UNACTIVATED").trim().toUpperCase();if(!["UNACTIVATED","ACTIVATED","USED"].includes(status))continue;await put("tickets",{token,status});n++}
 msg("adminMsg",n+" tiket diimpor.");await updateStats();
}
window.addEventListener("load",()=>init().catch(e=>alert("Gagal memulai aplikasi: "+e.message)));
