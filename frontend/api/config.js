module.exports = (req, res) => {
  // Allow client requests to read the live configured WS_URL from Vercel's env variables panel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.status(200).json({
    WS_URL: process.env.WS_URL || null
  });
};
