const { google } = require("googleapis");

const CLIENT_ID = "144226656515-9td0urugivgr355c5h3daur76rsu8eev.apps.googleusercontent.com";
const REDIRECT_URI = "https://lumacompanion.netlify.app/.netlify/functions/oauth2callback";

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
    const parts = (event.path || "").split("/");
    const fileId = decodeURIComponent(parts[parts.length - 1] || "");
    if (!fileId) return { statusCode: 400, headers: CORS, body: "Missing fileId" };

    const q = event.queryStringParameters || {};

    // === 1. Redirect to Drive (for <a> or <img>)
    if (event.httpMethod === "GET" && q.redirect === "1") {
      const oauth2 = new google.auth.OAuth2(CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, REDIRECT_URI);
      oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

      const tokenResp = await oauth2.getAccessToken();
      const accessToken = typeof tokenResp === "string" ? tokenResp : (tokenResp?.token || tokenResp?.access_token);
      if (!accessToken) throw new Error("Failed to get access token");

      const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
      const qs = new URLSearchParams({
        alt: "media",
        supportsAllDrives: q.supportsAllDrives ? "true" : "false",
        access_token: accessToken,
      });

      if (q.download === "1") {
        qs.set("download", "1");
        if (q.filename) {
          qs.set("response-content-disposition", `attachment; filename="${q.filename}"`);
        }
      }

      return {
        statusCode: 302,
        headers: {
          Location: `${base}?${qs.toString()}`,
          "Cache-Control": "no-store",
        },
        body: "",
      };
    }

    // === 2. Proxy content server-side (for fetch, PDF.js)
    if (event.httpMethod === "GET" && q.proxy === "1") {
      const oauth2 = new google.auth.OAuth2(CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, REDIRECT_URI);
      oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
      const drive = google.drive({ version: "v3", auth: oauth2 });

      // Optional: override name for Content-Disposition
      const meta = await drive.files.get({
        fileId,
        fields: "id,name,mimeType",
        supportsAllDrives: false,
      });

      const name = meta.data.name || "file";
      const mime = meta.data.mimeType || "application/octet-stream";
      const disposition = q.download === "1"
        ? `attachment; filename="${name}"`
        : `inline; filename="${name}"`;

      const resp = await drive.files.get(
        { fileId, alt: "media", supportsAllDrives: false },
        { responseType: "arraybuffer" }
      );

      const buf = Buffer.from(resp.data);
      return {
        statusCode: 200,
        headers: {
          ...CORS,
          "Content-Type": mime,
          "Content-Length": String(buf.length),
          "Content-Disposition": disposition,
          "Cache-Control": "no-store",
          "Accept-Ranges": "none",
        },
        body: buf.toString("base64"),
        isBase64Encoded: true,
      };
    }

    // === 3. Metadata only
    if (event.httpMethod === "GET" && q.meta === "1") {
      const drive = getDrive();
      const meta = await drive.files.get({
        fileId,
        fields: "id,name,mimeType,size,md5Checksum,createdTime",
        supportsAllDrives: false,
      });
      return {
        statusCode: 200,
        headers: { ...CORS, "content-type": "application/json" },
        body: JSON.stringify(meta.data),
      };
    }

    // === 4. Legacy streaming (unsafe for >10MB)
    if (event.httpMethod === "GET") {
      const drive = getDrive();
      const url = new URL(event.rawUrl);
      const forceDownload = url.searchParams.get("download");

      const meta = await drive.files.get({
        fileId,
        fields: "id,name,mimeType",
        supportsAllDrives: false,
      });

      const name = meta.data.name || "file";
      const mime = meta.data.mimeType || "application/octet-stream";
      const disposition = forceDownload
        ? `attachment; filename="${name}"`
        : `inline; filename="${name}"`;

      const resp = await drive.files.get(
        { fileId, alt: "media", supportsAllDrives: false },
        { responseType: "arraybuffer" }
      );

      const buf = Buffer.from(resp.data);
      return {
        statusCode: 200,
        headers: {
          ...CORS,
          "content-type": mime,
          "content-length": String(buf.length),
          "content-disposition": disposition,
          "accept-ranges": "none",
        },
        body: buf.toString("base64"),
        isBase64Encoded: true,
      };
    }

    // === 5. Delete
    if (event.httpMethod === "DELETE") {
      const drive = getDrive();
      await drive.files.delete({ fileId, supportsAllDrives: false });
      return { statusCode: 204, headers: CORS, body: "" };
    }

    return { statusCode: 400, headers: CORS, body: "Unsupported operation" };
  } catch (err) {
    console.error("file.js error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: `File error: ${err.message || err}`,
    };
  }
};
