// netlify/functions/list.js
// GET /.netlify/functions/list?caseId=CASE123[&batchNo=1]
// Lists files under: <ROOT>/Cases/{caseId}/{batchNo or *}

const { google } = require("googleapis");

// ====== EDIT THESE (NOT SECRETS) ======
const CLIENT_ID = "144226656515-9td0urugivgr355c5h3daur76rsu8eev.apps.googleusercontent.com";
const REDIRECT_URI = "https://lumacompanion.netlify.app/.netlify/functions/oauth2callback";
// ======================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function getDrive() {
  const { GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_SECRET) throw new Error("Missing GOOGLE_CLIENT_SECRET");
  if (!GOOGLE_REFRESH_TOKEN) throw new Error("Missing GOOGLE_REFRESH_TOKEN");
  const oauth2 = new google.auth.OAuth2(CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth: oauth2 });
}

async function ensureFolderByName(drive, name, parentId) {
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    `'${parentId}' in parents`,
    `name='${String(name).replace(/'/g, "\\'")}'`,
  ].join(" and ");
  const found = await drive.files.list({
    q,
    fields: "files(id,name)",
    pageSize: 1,
    supportsAllDrives: false,
  });
  return found.data.files && found.data.files[0] ? found.data.files[0].id : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  try {
    const drive = getDrive();

    const url = new URL(event.rawUrl);
    const caseId = (url.searchParams.get("caseId") || "").trim();
    const batchNo = (url.searchParams.get("batchNo") || "").trim();

    if (!caseId) {
      return { statusCode: 400, headers: CORS, body: "Missing caseId" };
    }

    const ROOT = process.env.GOOGLE_ROOT_FOLDER_ID || "root";

    const casesFolderId =
      (await ensureFolderByName(drive, "Cases", ROOT)) ||
      null;
    if (!casesFolderId) return { statusCode: 200, headers: CORS, body: "[]" };

    const caseFolderId = await ensureFolderByName(drive, caseId, casesFolderId);
    if (!caseFolderId) return { statusCode: 200, headers: CORS, body: "[]" };

    const batches = [];

    if (batchNo) {
      const b = await ensureFolderByName(drive, batchNo, caseFolderId);
      if (b) batches.push({ id: b, name: batchNo });
    } else {
      const batchFolders = await drive.files.list({
        q: [
          "mimeType='application/vnd.google-apps.folder'",
          "trashed=false",
          `'${caseFolderId}' in parents`,
        ].join(" and "),
        fields: "files(id,name)",
        pageSize: 100,
        supportsAllDrives: false,
      });
      for (const f of batchFolders.data.files || []) {
        batches.push({ id: f.id, name: f.name });
      }
    }

    const out = [];
    for (const bf of batches) {
      const files = await drive.files.list({
        q: ["trashed=false", `'${bf.id}' in parents`].join(" and "),
        fields: "files(id,name,mimeType,size,md5Checksum,createdTime)",
        pageSize: 1000,
        supportsAllDrives: false,
      });
      for (const f of files.data.files || []) {
        out.push({
          batchNo: bf.name,
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: Number(f.size || 0),
          md5: f.md5Checksum || null,
          createdTime: f.createdTime,
          url: `/.netlify/functions/file/${encodeURIComponent(f.id)}`, // handy for UI
        });
      }
    }

    return {
      statusCode: 200,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify(out),
    };
  } catch (err) {
    console.error("list.js error:", err);
    return { statusCode: 500, headers: CORS, body: `List error: ${err.message || err}` };
  }
};
