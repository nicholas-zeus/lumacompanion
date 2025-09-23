// netlify/functions/upload.js
// Upload a file to Google Drive under: Cases/{caseId}/{batchNo}/{filename}
// Returns: { fileId, fileName, size, mimeType, md5, uploadedAt }

const { google } = require("googleapis");
const Busboy = require("busboy");
const crypto = require("crypto");
const { Readable } = require("stream");

/**
 * IMPORTANT: Netlify Functions (AWS API Gateway) cap request bodies to ~10 MB.
 * Your product target is 50 MB. This function returns 413 if the file is too big.
 * For true 50 MB uploads, move to resumable uploads via Cloud Run or a direct signed upload.
 */
const MAX_LAMBDA_BYTES = 9.5 * 1024 * 1024; // ~9.5MB safety margin under API GW cap
const MAX_PRODUCT_BYTES = 50 * 1024 * 1024; // your logical product cap

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function pickHeader(headers, name) {
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
}

function getDrive() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");
  const sa = JSON.parse(raw);
  const jwt = new google.auth.JWT(sa.client_email, null, sa.private_key, [
    "https://www.googleapis.com/auth/drive",
  ]);
  const drive = google.drive({ version: "v3", auth: jwt });
  return { jwt, drive };
}

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

async function ensurePath(drive, rootId, caseId, batchNo) {
  const casesId = await ensureFolder(drive, "Cases", rootId);
  const caseIdFolder = await ensureFolder(drive, String(caseId), casesId);
  const batchId = await ensureFolder(drive, String(batchNo), caseIdFolder);
  return batchId;
}

/** Parse multipart/form-data from Netlify (base64 body) with busboy */
function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType = pickHeader(event.headers || {}, "content-type");
    if (!contentType || !contentType.includes("multipart/form-data")) {
      return reject(new Error("Invalid content-type (expected multipart/form-data)"));
    }

    const bb = Busboy({ headers: { "content-type": contentType } });

    const state = { fields: {}, file: null }; // { buffer, fileName, mimeType, size, md5 }
    let total = 0;
    const chunks = [];
    const hash = crypto.createHash("md5");

    bb.on("file", (_name, file, info) => {
      const { filename, mimeType } = info || {};
      file.on("data", (d) => {
        total += d.length;

        // Guard API GW body size
        if (total > MAX_LAMBDA_BYTES) {
          bb.emit("error", Object.assign(new Error("Payload too large for Netlify Function"), { code: 413 }));
          file.resume();
          return;
        }
        // Also guard product cap (50 MB)
        if (total > MAX_PRODUCT_BYTES) {
          bb.emit("error", Object.assign(new Error("File exceeds 50 MB limit"), { code: 413 }));
          file.resume();
          return;
        }

        chunks.push(d);
        hash.update(d);
      });
      file.on("end", () => {
        state.file = {
          buffer: Buffer.concat(chunks),
          fileName: filename || "unnamed",
          mimeType: mimeType || "application/octet-stream",
          size: total,
          md5: hash.digest("hex"),
        };
      });
    });

    bb.on("field", (name, val) => { state.fields[name] = val; });
    bb.on("error", reject);
    bb.on("finish", () => resolve(state));

    // Body may be base64-encoded
    const body = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "", "utf8");
    bb.end(body);
  });
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  }

  try {
    // Read query params (support both Netlify shapes)
    const url = event.rawUrl ? new URL(event.rawUrl) : null;
    const qs = event.queryStringParameters || {};
    const caseId = (url && url.searchParams.get("caseId")) || qs.caseId;
    const batchNo = (url && url.searchParams.get("batchNo")) || qs.batchNo || "1";
    if (!caseId) {
      return { statusCode: 400, headers: CORS, body: "Missing caseId" };
    }

    const rootId = process.env.GOOGLE_ROOT_FOLDER_ID;
    if (!rootId) {
      return { statusCode: 500, headers: CORS, body: "Missing GOOGLE_ROOT_FOLDER_ID" };
    }

    const { jwt, drive } = getDrive();
    await jwt.authorize();

    // Parse multipart form
    const { file } = await parseMultipart(event);
    if (!file) {
      return { statusCode: 400, headers: CORS, body: "No file part found" };
    }

    // Create folder path
    const parentId = await ensurePath(drive, rootId, caseId, batchNo);

    // Upload to Drive
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

    const meta = resp.data || {};
    const payload = {
      fileId: meta.id,
      fileName: meta.name || file.fileName,
      size: Number(meta.size || file.size || 0),
      mimeType: meta.mimeType || file.mimeType || "application/octet-stream",
      md5: meta.md5Checksum || file.md5 || null,
      uploadedAt: new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify(payload),
    };
  } catch (err) {
    // Give an informative status for size errors
    const status = err && (err.code === 413 || /too large/i.test(err.message)) ? 413 : 500;
    console.error("upload error:", err);
    return {
      statusCode: status,
      headers: CORS,
      body: status === 413
        ? "Payload too large for Netlify Function. Use a smaller file or switch to resumable uploads."
        : `Upload error: ${err.message || err}`,
    };
  }
};
