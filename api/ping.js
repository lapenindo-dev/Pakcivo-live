export default function handler(req, res) {
  return res.status(200).json({
    ok: true,
    message: "API Vercel jalan",
    time: new Date().toISOString()
  });
}
