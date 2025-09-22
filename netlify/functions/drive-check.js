const { google } = require("googleapis");

exports.handler = async () => {
  try {
    // 1) Auth with service account
    const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
    if (!sa.client_email || !sa.private_key) {
      throw new Error("Service account JSON missing client_email/private_key");
    }
    const auth = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"]
    });
    const drive = google.drive({ version: "v3", auth });

    // 2) Check root folder access
    const folderId = process.env.GOOGLE_ROOT_FOLDER_ID;
    if (!folderId) throw new Error("GOOGLE_ROOT_FOLDER_ID is missing");

    const folderMeta = await drive.files.get({
      fileId: folderId,
      fields: "id,name,mimeType",
      supportsAllDrives: true
    });

    // 3) List first 20 children
    const list = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 20,
      fields: "files(id,name,mimeType,modifiedTime,size)",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        { ok: true, folder: folderMeta.data, items: list.data.files },
        null,
        2
      )
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: e.message })
    };
  }
};
