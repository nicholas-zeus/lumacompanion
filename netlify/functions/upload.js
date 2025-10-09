// netlify/functions/upload.js
// Upload a file to Google Drive under: Cases/{caseId}/{batchNo}/{filename}
// Returns: { fileId, fileName, size, mimeType, md5, uploadedAt }

const { google } = require("googleapis");
const Busboy = require("busboy");
const crypto = require("crypto");
const { Readable } = require("stream");

// ====== EDIT THESE (NOT SECRETS) ======
const CLIENT_ID = "144226656515-9td0urugivgr355c5h3daur76rsu8eev.apps.googleusercontent.com";
const REDIRECT_URI = "https://lumacompanion.netlify.app/oauth2callback";
// =====================================

// ====== LIMITS & CORS ======
/**
 * IMPORTANT: Netlify Functions (AWS API Gateway) cap request bodies to ~10 MB.
 * Your product target is 50 MB. This function returns 413 if the file is too big.
 * For true 50 MB uploads, move to resumable uploads via Cloud Run or a direct signed upload.
 */
const MAX_LAMBDA_BYTES = 9.5 * 1024 * 1024; // ~9.5MB safety margin under API GW cap
const MAX_PRODUCT_BYTES = 50 * 1024 * 1024; // your logical product cap

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

// ====== OAUTH DRIVE CLIENT ======
function getDrive() {
  const { GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_SECRET) throw new Error("Missing env GOOGLE_CLIENT_SECRET");
  if (!GOOGLE_REFRESH_TOKEN) throw new Error("Missing env GOOGLE_REFRESH_TOKEN (generate via /oauth2callback)");
  const oauth2 = new google.auth.OAuth2(CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: "v3", auth: oauth2 });
  return drive;
}

// ====== HELPERS ======
function parseMultipart(event) {
  const contentType = event.headers["content-type"] || event.headers["Content-Type"];
  if (!contentType || !contentType.startsWith("multipart/form-data")) {
    throw new Error("Content-Type must be multipart/form-data");
  }

  const bb = Busboy({ headers: { "content-type": contentType } });

  const fields = {};
  let fileInfo = null;
  let totalBytes = 0;
  const hash = crypto.createHash("md5");

  return new Promise((resolve, reject) => {
    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("file", (name, file, info) => {
      // info: { filename, encoding, mimeType }
      const chunks = [];
      file.on("data", (d) => {
        totalBytes += d.length;
        if (totalBytes > MAX_PRODUCT_BYTES) {
          file.resume();
          reject(Object.assign(new Error("File exceeds product limit of 50 MB"), { code: 413 }));
          return;
        }
        hash.update(d);
        chunks.push(d);
      });
      file.on("limit", () => {
        reject(Object.assign(new Error("Payload exceeded body size limit"), { code: 413 }));
      });
      file.on("end", () => {
        const buffer = Buffer.concat(chunks);
        fileInfo = {
          fieldName: name,
          fileName: info.filename || "upload.bin",
          mimeType: info.mimeType || "application/octet-stream",
          size: buffer.length,
          md5: hash.digest("hex"),
          buffer,
        };
      });
    });

    bb.on("error", reject);
    bb.on("finish", () => {
      if (!fileInfo) return reject(new Error("No file found in form-data"));
      resolve({ fields, file: fileInfo, totalBytes });
    });

    // Body can be base64-encoded (Netlify default)
    const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : Buffer.from(event.body || "");
    if (body.length > MAX_LAMBDA_BYTES) {
      reject(Object.assign(new Error("Payload too large for Netlify Function"), { code: 413 }));
      return;
    }
    bb.end(body);
  });
}

// Find (or create) a folder named `name` inside `parentId`. Returns folderId.
async function ensureFolder(drive, name, parentId) {
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    `'${parentId}' in parents`,
    `name='${String(name).replace(/'/g, "\\'")}'`,
  ].join(" and ");

  const res = await drive.files.list({
    q,
    fields: "files(id,name)",
    pageSize: 1,
    // Using My Drive, not Shared Drives:
    supportsAllDrives: false,
  });

  if (res.data.files && res.data.files[0]) return res.data.files[0].id;

  const create = await drive.files.create({
    requestBody: {
      name: String(name),
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: false,
  });

  return create.data.id;
}

async function ensurePath(drive, names, rootId) {
  let parent = rootId;
  for (const n of names) {
    parent = await ensureFolder(drive, n, parent);
  }
  return parent; // deepest folder id
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ====== HANDLER ======
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  try {
    const drive = getDrive();
    // Inside exports.handler, after you build `drive = getDrive()` and before Busboy handling:
if (event.httpMethod === "POST") {
  const q = event.queryStringParameters || {};

  // === ADD: resumable init endpoint (no file data in this request) ===
  if (q.initResumable === "1") {
    // Expect metadata via JSON body: { caseId, batchNo, name, mimeType }
    const meta = JSON.parse(event.body || "{}");
    const { caseId, batchNo, name, mimeType } = meta;

    if (!caseId || !batchNo || !name) {
      return { statusCode: 400, headers: CORS, body: "Missing caseId, batchNo or name" };
    }

    // Ensure folder path Cases/{caseId}/{batchNo} using your existing helpers
const ROOT = process.env.GOOGLE_ROOT_FOLDER_ID || "root";
// BEFORE: ensurePath(drive, ROOT, ["Cases", caseId, batchNo])
const parentId = await ensurePath(drive, ["Cases", caseId, batchNo], ROOT);

const sessionUrl = await startResumableSession(drive, {
  name,
  mimeType,
  parents: [parentId],
});

return {
  statusCode: 200,
  headers: { ...CORS, "Content-Type": "application/json" },
  body: JSON.stringify({ sessionUrl }),
};

  }

  // ... existing multipart upload code remains unchanged ...
}


    // Parse multipart/form-data (expects fields: caseId, batchNo; file field named "file")
    const { fields, file, totalBytes } = await parseMultipart(event);

    const caseId = (fields.caseId || "").trim();
    const batchNo = (fields.batchNo || "").trim();

    if (!caseId) return json(400, { error: "Missing caseId" });
    if (!batchNo) return json(400, { error: "Missing batchNo" });

    if (totalBytes > MAX_LAMBDA_BYTES) {
      return {
        statusCode: 413,
        headers: CORS,
        body: "Payload too large for Netlify Function. Use a smaller file or switch to resumable uploads.",
      };
    }

    // Root folder in *your My Drive* (not Shared Drive)
    const ROOT = process.env.GOOGLE_ROOT_FOLDER_ID || "root";

    // Ensure path: Cases/{caseId}/{batchNo}
    const parentId = await ensurePath(drive, ["Cases", caseId, batchNo], ROOT);

    // Upload the file (multipart upload)
    const resp = await drive.files.create({
      requestBody: {
        name: file.fileName,
        parents: [parentId],
        mimeType: file.mimeType,
      },
      media: {
        mimeType: file.mimeType,
        body: Readable.from(file.buffer),
      },
      fields: "id,name,mimeType,size,md5Checksum,createdTime",
      supportsAllDrives: false,
    });

    const d = resp.data;
    // If Drive didn't return md5Checksum for Google Docs formats, fall back to our own hash
    const md5 = d.md5Checksum || file.md5;

    return json(200, {
      fileId: d.id,
      fileName: d.name,
      size: Number(d.size || file.size),
      mimeType: d.mimeType,
      md5,
      uploadedAt: d.createdTime,
    });
  } catch (err) {
    const status = err && (err.code === 413 || /too large/i.test(err.message)) ? 413 : 500;
    console.error("upload error:", err);
    return {
      statusCode: status,
      headers: CORS,
      body:
        status === 413
          ? "Payload too large for Netlify Function. Use a smaller file or switch to resumable uploads."
          : `Upload error: ${err.message || err}`,
    };
  }
};
// === ADD: Start a Drive resumable upload session; returns the session URL
// === FIXED: Start a Drive resumable upload session; returns the session URL
async function startResumableSession(drive, { name, mimeType, parents = [] }) {
  const tokenResp = await drive._options.auth.getAccessToken();
  const accessToken =
    typeof tokenResp === "string"
      ? tokenResp
      : (tokenResp && (tokenResp.token || tokenResp.access_token));

  if (!accessToken) throw new Error("Failed to obtain access token for resumable init");

  const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
  const headers = {
    "X-Upload-Content-Type": mimeType || "application/octet-stream",
    "Content-Type": "application/json; charset=UTF-8",
    Authorization: `Bearer ${accessToken}`,
  };

  const body = JSON.stringify({ name, parents, mimeType });

  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resumable init failed: ${res.status} ${text}`);
  }

  const sessionUrl = res.headers.get("location");
  if (!sessionUrl) throw new Error("No resumable session URL returned by Drive");
  return sessionUrl;
}

