// netlify/functions/my-role.js
const admin = require("firebase-admin");

let app;
function initAdmin() {
  if (admin.apps.length) return admin.apps[0];
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON); // set in Netlify env
  app = admin.initializeApp({ credential: admin.credential.cert(sa) });
  return app;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors };
  }

  try {
    initAdmin();
    const authHeader = event.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "Missing token" }) };
    }
    const idToken = authHeader.slice(7);
    const decoded = await admin.auth().verifyIdToken(idToken);
    const email = decoded.email;
    if (!email) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "No email in token" }) };
    }

    const db = admin.firestore();
    const snap = await db.collection("allowlist").doc(email).get();
    if (!snap.exists) {
      return { statusCode: 403, headers: cors, body: JSON.stringify({ error: "Not allowlisted" }) };
    }

    const role = snap.data().role || null;
    return { statusCode: 200, headers: cors, body: JSON.stringify({ role }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "Server error" }) };
  }
};
