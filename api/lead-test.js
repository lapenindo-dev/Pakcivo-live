// api/lead-test.js
// Temporary browser-test endpoint for /api/lead.
// Delete this file after testing is complete.

module.exports = async function handler(req, res) {
  try {
    const baseUrl = `https://${req.headers.host}`;

    const response = await fetch(`${baseUrl}/api/lead`, {
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
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
};
