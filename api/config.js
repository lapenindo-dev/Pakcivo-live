// api/config.js — exposes only safe public frontend config.
function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    captchaEnabled: process.env.CAPTCHA_ENABLED === "true" && Boolean(process.env.TURNSTILE_SITE_KEY),
    turnstileSiteKey: process.env.CAPTCHA_ENABLED === "true" ? (process.env.TURNSTILE_SITE_KEY || "") : "",
    clarityProjectId: process.env.CLARITY_PROJECT_ID || "",
  });
}


module.exports = handler;
