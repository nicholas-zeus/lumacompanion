// netlify/functions/oauth2callback.js
const { google } = require("googleapis");

// ✅ EDIT THESE TWO (they are NOT secret)
const CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID";
const REDIRECT_URI = "https://lumacompanion.netlify.app/.netlify/functions/oauth2callback";

// 🔒 Do NOT hardcode this — we read it from Netlify env (secret)
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Scope for full Drive access (adjust if you want narrower access)
const SCOPES = ["https://www.googleapis.com/auth/drive"];

exports.handler = async (event) => {
  try {
    // 1) If no `code`, show a link to start consent
    const url = new URL(event.rawUrl);
    const code = url.searchParams.get("code");

    const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

    if (!code) {
      const consentUrl = oauth2.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES,
        include_granted_scopes: true,
      });
      return {
        statusCode: 200,
        headers: { "content-type": "text/html" },
        body: `
          <h2>Google OAuth Setup</h2>
          <p>Click the button to authorize once with your Google account.</p>
          <p><strong>Only you</strong> should do this. End users will never see this.</p>
          <a href="${consentUrl}" style="display:inline-block;padding:10px 16px;border:1px solid #ccc;border-radius:6px;text-decoration:none;">Authorize with Google</a>
          <p>If you see redirect_uri_mismatch, double-check the redirect URI in your Google Cloud Console:</p>
          <code>${REDIRECT_URI}</code>
        `,
      };
    }

    // 2) If we have a `code`, exchange it for tokens (this is the one-time step)
    const { tokens } = await oauth2.getToken(code);

    const refresh = tokens.refresh_token;
    const access = tokens.access_token;

    if (!refresh) {
      return {
        statusCode: 500,
        headers: { "content-type": "text/html" },
        body: `
          <h3>No refresh_token received.</h3>
          <p>Make sure your OAuth consent screen is published (not testing), and that you used <code>prompt=consent</code> and <code>access_type=offline</code> (we already do).</p>
          <p>Try clicking "Authorize with Google" again and approve.</p>
        `,
      };
    }

    // 3) Show the refresh token so you can copy it into Netlify env vars
    return {
      statusCode: 200,
      headers: { "content-type": "text/html" },
      body: `
        <h2>✅ Success</h2>
        <p>Copy this <strong>refresh token</strong> into your Netlify Environment Variables as <code>GOOGLE_REFRESH_TOKEN</code>:</p>
        <pre style="white-space:pre-wrap;word-break:break-all;border:1px solid #ddd;padding:12px;border-radius:8px;">${refresh}</pre>
        <p><em>(FYI access token):</em></p>
        <pre style="white-space:pre-wrap;word-break:break-all;border:1px solid #eee;padding:12px;border-radius:8px;">${access || "(not shown)"}</pre>
        <p>Once saved and deployed, you can delete this function.</p>
      `,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "text/plain" },
      body: `OAuth error: ${err.message}\n\n${err.stack}`,
    };
  }
};
