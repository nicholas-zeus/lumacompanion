exports.handler = async () => {
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const sa = raw ? JSON.parse(raw) : {};
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: !!sa.client_email,
        client_email: sa.client_email || null,
        has_private_key: !!sa.private_key,
        rootFolderId: process.env.GOOGLE_ROOT_FOLDER_ID || null
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
