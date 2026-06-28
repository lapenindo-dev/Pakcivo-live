// api/lead-test.js
// Opens a browser GET endpoint to test api/lead.js via internal POST.

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  try {
    const host = req.headers.host;
    const protocol = host && host.includes("localhost") ? "http" : "https";

    const response = await fetch(`${protocol}://${host}/api/lead`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Test Pakcivo",
        whatsapp: "081280799493",
        source: "lead-test"
      })
    });

    const data = await response.json();
    return json(res, response.status, data);
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error?.message || String(error)
    });
  }
};
