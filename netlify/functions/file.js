// netlify/functions/file.js
// GET     /.netlify/functions/file/{fileId}           → stream file bytes (base64) with correct content-type
// DELETE  /.netlify/functions/file/{fileId}           → delete file
// GET     /.netlify/functions/file/{fileId}?meta=1    → return metadata JSON
// Optional: add ?download=1 to force attachment; default is inline

const { google } = require("googleapis");

// ====== EDIT THESE (NOT SECRETS) ======
const CLIENT_ID = "144226656515-9td0urugivgr355c5h3daur76rsu8eev.apps.googleusercontent.com";
const REDIRECT_URI = "https://lumacompanion.netlify.app/.netlify/functions/oauth2callback";
// ======================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, range",
};

function getDrive() {
  const { GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_SECRET) throw new Error("Missing env GOOGLE_CLIENT_SECRET");
  if (!GOOGLE_REFRESH_TOKEN) throw new Error("Missing env GOOGLE_REFRESH_TOKEN");
  const oauth2 = new google.auth.OAuth2(CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth: oauth2 });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  try {
    // fileId from the tail of the path: /.netlify/functions/file/{fileId}
    const parts = (event.path || "").split("/");
    const fileId = decodeURIComponent(parts[parts.length - 1] || "");
    if (!fileId) {
      return { statusCode: 400, headers: CORS, body: "Missing fileId" };
    }

    const drive = getDrive();

    if (event.httpMethod === "DELETE") {
      await drive.files.delete({ fileId, supportsAllDrives: false });
      return { statusCode: 204, headers: CORS, body: "" };
    }

    // GET
    const url = new URL(event.rawUrl);
    const wantMeta = url.searchParams.get("meta");
    const forceDownload = url.searchParams.get("download");

    // Get metadata first so we can set headers correctly
    const meta = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size,md5Checksum,createdTime",
      supportsAllDrives: false,
    });

    if (wantMeta) {
      return {
        statusCode: 200,
        headers: { ...CORS, "content-type": "application/json" },
        body: JSON.stringify(meta.data),
      };
    }

    // Fetch file bytes
    const resp = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: false },
      { responseType: "arraybuffer" }
    );

    const buf = Buffer.from(resp.data);
    const name = meta.data.name || "file";
    const mime = meta.data.mimeType || "application/octet-stream";
    const disposition = forceDownload ? `attachment; filename="${name}"` : `inline; filename="${name}"`;

    return {
      statusCode: 200,
      headers: {
        ...CORS,
        "content-type": mime,
        "content-length": String(buf.length),
        "content-disposition": disposition,
        // allow range headers if you later add partial content handling
        "accept-ranges": "none",
      },
      body: buf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("file.js error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: `File error: ${err.message || err}`,
    };
  }
};
