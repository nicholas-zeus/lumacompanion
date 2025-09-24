exports.handler = async () => {
  const hasSecret = !!process.env.GOOGLE_CLIENT_SECRET;
  const hasRefresh = !!process.env.GOOGLE_REFRESH_TOKEN;
  return {
    statusCode: 200,
    headers: { "content-type": "text/plain" },
    body: [
      `GOOGLE_CLIENT_SECRET: ${hasSecret ? "present" : "MISSING"}`,
      `GOOGLE_REFRESH_TOKEN: ${hasRefresh ? "present" : "MISSING"}`,
    ].join("\n"),
  };
};