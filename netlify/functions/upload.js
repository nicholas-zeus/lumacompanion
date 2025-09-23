// netlify/functions/upload.js
// Upload a file to Google Drive under: Cases/{caseId}/{batchNo}/{filename}
// Returns { fileId, fileName, size, mimeType, md5, uploadedAt }
const { google } = require("googleapis");
const Busboy = require("busboy");
const crypto = require("crypto");
const { Readable } = require("stream");

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function getDrive() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
  const jwt = new google.auth.JWT(sa.client_email, null, sa.private_key, [
    "https://www.googleapis.com/auth/drive",
  ]);
  const drive = google.drive({ version: "v3", auth: jwt });
  return { jwt, drive };
}

async function ensureFolder(drive, name, parentId) {
  // Find by name + parent
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    `'${parentId}' in parents`,
    `name='${name.replace(/'/g, "\\'")}'`,
  ].join(" and ");
  const found = await drive.files.list({
    q,
    fields: "files(id,name)",
    pageSize: 1,
  });
  if (found.data.files && found.data.files[0]) return found.data.files[0].id;

  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  return res.data.id;
}

async function ensurePath(drive, rootId, caseId, batchNo) {
  const casesId = await ensureFolder(drive, "Cases", rootId);
  const caseIdFolder = await ensureFolder(drive, String(caseId), casesId);
  const batchId = await ensureFolder(drive, String(batchNo), caseIdFolder);
  return batchId;
}

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType || !contentType.startsWith("multipart/form-data")) {
      return reject(new Error("Invalid content-type"));
    }
    const bb = Busboy({ headers: { "content-type": contentType } });

    const state = {
      fields: {},
      file: null, // { buffer, fileName, mimeType, size, md5 }
    };
    let total = 0;
    const chunks = [];
    const hash = crypto.createHash("md5");

    bb.on("file", (name, file, info) => {
      const { filename, mimeType } = info;
      file.on("data", (d) => {
        total += d.length;
        if (total > MAX_BYTES) {
          bb.emit("error", new Error("File too large"));
          file.resume();
          return;
        }
        chunks.push(d);
        hash.update(d);
      });
      file.on("end", () => {
        state.file = {
          buffer: Buffer.concat(chunks),
          fileName: filename,
          mimeType,
          size: total,
          md5: hash.digest("hex"),
        };
      });
    });

    bb.on("field", (name, val) => {
      state.fields[name] = val;
    });

    bb.on("error", reject);
    bb.on("finish", () => {
      resolve(state);
    });

    // Body may be base64-encoded
    const body = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "", "utf8");
    bb.end(body);
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  }

  try {
    const url = new URL(event.rawUrl);
    const caseId = url.searchParams.get("caseId");
    const batchNo = url.searchParams.get("batchNo") || "1";
    if (!caseId) {
      return { statusCode: 400, headers: CORS, body: "Missing caseId" };
    }

    const { jwt, drive } = getDrive();
    await jwt.authorize();

    // Parse multipart form
    const { file } = await parseMultipart(event);
    if (!file) {
      return { statusCode: 400, headers: CORS, body: "No file" };
    }

    // Ensure folders
    const rootId = process.env.GOOGLE_ROOT_FOLDER_ID;
    if (!rootId) throw new Error("Missing GOOGLE_ROOT_FOLDER_ID");
    const parentId = await ensurePath(drive, rootId, caseId, batchNo);

    // Upload to Drive
    const res = await drive.files.create({
      requestBody: {
        name: file.fileName,
        parents: [parentId],
        mimeType: file.mimeType || "application/octet-stream",
      },
      media: {
        mimeType: file.mimeType || "application/octet-stream",
        body: Readable.from(file.buffer),
      },
      fields: "id,name,mimeType,size,md5Checksum,createdTime",
    });

    const meta = res.data;
    const payload = {
      fileId: meta.id,
      fileName: meta.name,
      size: Number(meta.size || file.size || 0),
      mimeType: meta.mimeType || file.mimeType || "application/octet-stream",
      md5: meta.md5Checksum || file.md5,
      uploadedAt: new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify(payload),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: CORS,
      body: `Upload error: ${err.message || err}`,
    };
  }
};
