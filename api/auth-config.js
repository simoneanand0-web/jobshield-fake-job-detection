// Only the Clerk publishable key is returned to the browser. The secret key
// remains server-side and is used by api/analyze.js to verify signed sessions.
module.exports = (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!publishableKey || !secretKey) return res.status(503).json({configured:false});
  return res.status(200).json({configured:true, publishableKey});
};
