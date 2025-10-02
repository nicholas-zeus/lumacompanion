// /js/hospitals.js
// Usage: import from hospitals.html with <script type="module" src="/js/hospitals.js"></script>
// This module:
// 1) Auth-gates the page (requires sign-in)
// 2) Role check via 'allowlist' collection (doc id = user.email); allows only role === 'nurse'
// 3) Validates CSV headers === ["Hosp_ID", "HospName", "Country"]
// 4) On "Replace hospitals": deletes ALL docs in 'hospitals' (batched), then writes CSV rows (batched)
// 5) Shows progress & errors in a simple log area and preview table

// ---- Firebase (ESM via CDN) ----
import { firebaseConfig } from "/js/config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  writeBatch,
  doc,
  setDoc,
  deleteDoc,
  query,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---- Firestore collection names (hardcoded for isolation) ----
const ALLOWLIST = "allowlist";
const HOSPITALS = "hospitals";

// ---- DOM hooks (expected in hospitals.html) ----
const fileInput   = document.getElementById("fileInput");     // <input type="file" accept=".csv">
const validateBtn = document.getElementById("validateBtn");   // Validate CSV (no writes)
const replaceBtn  = document.getElementById("replaceBtn");    // Destructive replace (delete all + insert)
const logArea     = document.getElementById("logArea");       // <pre> or <div> for logs
const previewTbl  = document.getElementById("previewTable");  // <table> for preview

// ---- Runtime state ----
let app, auth, db;
let currentUser = null;
let currentRole = null;
let parsedRows = [];         // validated, sanitized rows from CSV
let headerOk = false;
let dedupedCount = 0;

// ---- Utils: logging & UI helpers ----
function log(msg) {
  if (!logArea) return;
  const time = new Date().toLocaleTimeString();
  logArea.textContent += `[${time}] ${msg}\n`;
  logArea.scrollTop = logArea.scrollHeight;
}
function clearLog() {
  if (logArea) logArea.textContent = "";
}
function setBusy(isBusy) {
  [validateBtn, replaceBtn, fileInput].forEach((el) => {
    if (el) el.disabled = !!isBusy;
  });
}
function gateButtons(enabled) {
  if (validateBtn) validateBtn.disabled = !enabled;
  if (replaceBtn)  replaceBtn.disabled  = !enabled || !headerOk || parsedRows.length === 0;
}
function renderPreview(rows, maxRows = 10) {
  if (!previewTbl) return;
  previewTbl.innerHTML = "";
  if (!rows || rows.length === 0) return;

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  ["Hosp_ID", "HospName", "Country"].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  const tbody = document.createElement("tbody");
  rows.slice(0, maxRows).forEach((r) => {
    const tr = document.createElement("tr");
    ["Hosp_ID", "HospName", "Country"].forEach((k) => {
      const td = document.createElement("td");
      td.textContent = r[k] ?? "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  previewTbl.appendChild(thead);
  previewTbl.appendChild(tbody);

  const foot = document.createElement("caption");
  foot.style.captionSide = "bottom";
  foot.textContent = `Showing ${Math.min(maxRows, rows.length)} of ${rows.length} row(s). ${dedupedCount > 0 ? `(${dedupedCount} duplicate Hosp_ID removed)` : ""}`;
  previewTbl.appendChild(foot);
}

// ---- CSV parsing (handles quotes, commas, CRLF, and BOM) ----
function stripBOM(text) {
  if (text.charCodeAt(0) === 0xFEFF) return text.slice(1);
  return text;
}
function parseCSV(text) {
  // Simple robust CSV parser (no external lib)
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;
  const s = stripBOM(text);

  while (i < s.length) {
    const c = s[i];

    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
    } else {
      if (c === '"') {
        inQuotes = true; i++;
      } else if (c === ",") {
        row.push(field); field = ""; i++;
      } else if (c === "\n") {
        row.push(field); field = ""; rows.push(row); row = []; i++;
      } else if (c === "\r") {
        // handle CRLF or lone CR
        if (s[i + 1] === "\n") i += 2; else i++;
        row.push(field); field = ""; rows.push(row); row = [];
      } else {
        field += c; i++;
      }
    }
  }
  // last field
  row.push(field);
  rows.push(row);

  // Trim trailing empty last line (common when file ends with newline)
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  return rows;
}

// ---- Validation ----
function validateHeader(header) {
  if (!header || header.length !== 3) return false;
  const cleaned = header.map(h => (h ?? "").trim());
  const expected = ["Hosp_ID", "HospName", "Country"];
  return expected.every((x, idx) => cleaned[idx] === x);
}

function sanitizeRow(obj) {
  // trim all fields and normalize spaces
  const out = {
    Hosp_ID: (obj.Hosp_ID ?? "").trim(),
    HospName: (obj.HospName ?? "").trim(),
    Country: (obj.Country ?? "").trim(),
  };
  return out;
}

function validateRows(rows) {
  const errors = [];
  const map = new Map();
  let duplicates = 0;

  rows.forEach((r, idx) => {
    const line = idx + 2; // +2 because header is line 1
    if (!r.Hosp_ID) errors.push(`Line ${line}: Hosp_ID is empty`);
    if (!r.HospName) errors.push(`Line ${line}: HospName is empty`);

    // simple pattern check (optional): H followed by digits
    if (r.Hosp_ID && !/^H?\d+$/i.test(r.Hosp_ID)) {
      // not fatal, warn only
      errors.push(`Line ${line}: Hosp_ID "${r.Hosp_ID}" looks unusual (expected e.g., H1234).`);
    }

    const key = r.Hosp_ID.toLowerCase();
    if (map.has(key)) {
      duplicates++;
      // keep the first occurrence, ignore subsequent
      return;
    }
    map.set(key, r);
  });

  const uniqueRows = Array.from(map.values());
  dedupedCount = duplicates;
  return { uniqueRows, errors };
}

// ---- Firestore helpers ----
async function fetchUserRoleByEmail(email) {
  try {
    const emailId = (email || "").toLowerCase();
    const ref = doc(db, ALLOWLIST, emailId);
    const snap = await getDocs(query(collection(db, ALLOWLIST), limit(1))); // quick read to ensure rules/collection exist
    // Prefer direct doc read (faster), fall back above was just to warm permissions
    const direct = await (await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")).getDoc(ref);
    if (direct.exists()) {
      const data = direct.data() || {};
      return data.role || null;
    }
    return null;
  } catch (e) {
    log(`Role check failed: ${e.message || e}`);
    return null;
  }
}

async function deleteAllHospitals() {
  log("Fetching existing hospitals...");
  const col = collection(db, HOSPITALS);
  const snap = await getDocs(col);
  const docs = snap.docs;
  log(`Found ${docs.length} existing document(s). Deleting...`);

  let deleted = 0;
  for (let i = 0; i < docs.length; i += 500) {
    const batch = writeBatch(db);
    const slice = docs.slice(i, i + 500);
    slice.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += slice.length;
    log(`Deleted ${deleted}/${docs.length}`);
  }
  log("Delete complete.");
}

async function writeHospitals(rows) {
  log(`Writing ${rows.length} hospital(s)...`);
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = writeBatch(db);
    const slice = rows.slice(i, i + 500);
    slice.forEach(r => {
      const id = r.Hosp_ID; // document id
      const ref = doc(db, HOSPITALS, id);
      batch.set(ref, {
        Hosp_ID: r.Hosp_ID,
        HospName: r.HospName,
        Country: r.Country,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, { merge: true });
    });
    await batch.commit();
    written += slice.length;
    log(`Wrote ${written}/${rows.length}`);
  }
  log("Write complete.");
}

// ---- Event handlers ----
async function handleValidate() {
  clearLog();
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    log("Please choose a CSV file first.");
    return;
  }
  setBusy(true);
  try {
    const file = fileInput.files[0];
    const text = await file.text();
    const matrix = parseCSV(text);
    if (!matrix || matrix.length === 0) {
      log("CSV appears empty.");
      return;
    }

    const header = (matrix[0] || []).map(x => (x ?? "").trim());
    headerOk = validateHeader(header);
    if (!headerOk) {
      log(`Invalid header: [${header.join(", ")}]. Expected exactly: Hosp_ID,HospName,Country`);
      parsedRows = [];
      gateButtons(true);
      return;
    }

    // Map to objects & sanitize
    const objs = matrix.slice(1).map((row) => {
      return sanitizeRow({
        Hosp_ID: row[0],
        HospName: row[1],
        Country: row[2],
      });
    });

    // Validate rows
    const { uniqueRows, errors } = validateRows(objs);
    errors.forEach(e => log(`⚠️ ${e}`));

    if (uniqueRows.length === 0) {
      log("No valid rows to import.");
      parsedRows = [];
      renderPreview([], 0);
      gateButtons(true);
      return;
    }

    parsedRows = uniqueRows;
    log(`Header OK. Parsed ${objs.length} row(s); ${uniqueRows.length} unique by Hosp_ID.`);
    renderPreview(parsedRows);
    gateButtons(true);
  } catch (e) {
    log(`Validate error: ${e.message || e}`);
  } finally {
    setBusy(false);
  }
}

async function handleReplace() {
  if (!currentUser || currentRole !== "nurse") {
    log("You do not have permission to replace hospitals. (Requires role: nurse)");
    return;
  }
  if (!headerOk || parsedRows.length === 0) {
    log("Nothing to import. Please validate a CSV first.");
    return;
  }

  const ok = confirm("This will DELETE ALL existing documents in 'hospitals' and replace them with the CSV content. Continue?");
  if (!ok) return;

  setBusy(true);
  clearLog();
  try {
    await deleteAllHospitals();
    await writeHospitals(parsedRows);
    log("✅ Hospitals collection replaced successfully.");
  } catch (e) {
    log(`Replace failed: ${e.message || e}`);
  } finally {
    setBusy(false);
  }
}

// ---- Bootstrap ----
(function init() {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db   = getFirestore(app);
  } catch (e) {
    log(`Firebase init failed: ${e.message || e}`);
    throw e;
  }

  if (validateBtn) validateBtn.addEventListener("click", handleValidate);
  if (replaceBtn)  replaceBtn.addEventListener("click", handleReplace);

  setBusy(true);
  clearLog();
  log("Waiting for authentication...");

  onAuthStateChanged(auth, async (user) => {
    currentUser = user || null;
    if (!currentUser) {
      log("Not signed in. Please sign in to continue.");
      gateButtons(false);
      setBusy(false);
      return;
    }

    log(`Signed in as ${currentUser.email}`);
    // Fetch role from allowlist (doc id = email)
    currentRole = await fetchUserRoleByEmail(currentUser.email);
    if (!currentRole) {
      log("No role found in allowlist. Access denied.");
      gateButtons(false);
      setBusy(false);
      return;
    }

    if (currentRole !== "nurse") {
      log(`Role = ${currentRole}. Only 'nurse' is allowed to replace hospitals.`);
      gateButtons(false);
      setBusy(false);
      return;
    }

    log("Role OK (nurse). You can validate and replace hospitals.");
    gateButtons(true);
    setBusy(false);
  });
})();
