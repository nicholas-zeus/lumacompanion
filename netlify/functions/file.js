// netlify/functions/file.js
// GET  /.netlify/functions/file/{fileId}  → stream bytes (base64)
// DELETE /.netlify/functions/file/{fileId} → delete Drive file
const { google } = require("googleapis");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, range",
};

function getDrive() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
  const jwt = new google.auth.JWT(sa.client_email, null, sa.private_key, [
    "https://www.googleapis.com/auth/drive",
  ]);
  const drive = google.drive({ version: "v3", auth: jwt });
  return { jwt, drive };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }

  try {
    const parts = (event.path || "").split("/");
    const fileId = decodeURIComponent(parts[parts.length - 1] || "");
    if (!fileId) {
      return { statusCode: 400, headers: CORS, body: "Missing fileId" };
    }

    const { jwt, drive } = getDrive();
    await jwt.authorize();

    if (event.httpMethod === "DELETE") {
      await drive.files.delete({ fileId });
      return { statusCode: 204, headers: CORS, body: "" };
    }

    if (event.httpMethod !== "GET") {
      return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
    }

    // Get metadata for content-type
    const meta = await drive.files.get({
      fileId,
      fields: "id, name, mimeType, size",
    });

    // Stream file (note: for large files, Netlify response limits may apply)
    const resp = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );

    const buf = Buffer.from(resp.data);
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        "content-type": meta.data.mimeType || "application/octet-stream",
        "content-length": String(buf.length),
        "content-disposition": `inline; filename="${meta.data.name || "file"}"`,
      },
      body: buf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: CORS,
      body: `File error: ${err.message || err}`,
    };
  }
};
