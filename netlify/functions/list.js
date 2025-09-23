// netlify/functions/list.js
// GET /.netlify/functions/list?caseId=...  → list Drive files under Cases/{caseId}/*
const { google } = require("googleapis");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

async function ensureFolderByName(drive, name, parentId) {
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    `'${parentId}' in parents`,
    `name='${name.replace(/'/g, "\\'")}'`,
  ].join(" and ");
  const found = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1 });
  return found.data.files && found.data.files[0] ? found.data.files[0].id : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  }

  try {
    const url = new URL(event.rawUrl);
    const caseId = url.searchParams.get("caseId");
    if (!caseId) return { statusCode: 400, headers: CORS, body: "Missing caseId" };

    const { jwt, drive } = getDrive();
    await jwt.authorize();

    const rootId = process.env.GOOGLE_ROOT_FOLDER_ID;
    if (!rootId) throw new Error("Missing GOOGLE_ROOT_FOLDER_ID");

    const casesId = await ensureFolderByName(drive, "Cases", rootId);
    if (!casesId) {
      return { statusCode: 200, headers: { ...CORS, "content-type": "application/json" }, body: "[]" };
    }
    const caseFolderId = await ensureFolderByName(drive, String(caseId), casesId);
    if (!caseFolderId) {
      return { statusCode: 200, headers: { ...CORS, "content-type": "application/json" }, body: "[]" };
    }

    // List all files in all batch subfolders
    const batchFolders = await drive.files.list({
      q: [
        "mimeType='application/vnd.google-apps.folder'",
        "trashed=false",
        `'${caseFolderId}' in parents`,
      ].join(" and "),
      fields: "files(id,name)",
      pageSize: 100,
    });

    let files = [];
    for (const bf of batchFolders.data.files || []) {
      const res = await drive.files.list({
        q: [
          "trashed=false",
          `'${bf.id}' in parents`,
        ].join(" and "),
        fields: "files(id,name,mimeType,size,md5Checksum,createdTime)",
        pageSize: 1000,
      });
      files = files.concat(
        (res.data.files || []).map(f => ({
          id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size || 0), md5: f.md5Checksum, createdTime: f.createdTime, batch: bf.name
        }))
      );
    }

    return {
      statusCode: 200,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify(files),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: CORS, body: `List error: ${err.message || err}` };
  }
};
