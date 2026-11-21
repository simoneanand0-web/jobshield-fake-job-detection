const {createClerkClient} = require("@clerk/backend");
const {classify, validateListingText, getModelInfo} = require("./model");

const authorizedParties = [
  "https://jobshield-fake-job-detection.vercel.app",
  "https://jobshield-fake-job-detection-simoneanand0-web.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173"
];

async function authenticate(req) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) throw Object.assign(new Error("Account sign-in is not configured yet."), {status:503});
  const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!bearer) throw Object.assign(new Error("Sign in to analyze a listing."), {status:401});
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const proto = String(req.headers["x-forwarded-proto"] || (host.startsWith("localhost") ? "http" : "https")).split(",")[0].trim();
  if (!host) throw Object.assign(new Error("Could not identify the application host."), {status:400});
  const headers = new Headers({authorization:`Bearer ${bearer[1]}`});
  if (req.headers.origin) headers.set("origin", String(req.headers.origin));
  const request = new Request(new URL(req.url || "/api/analyze", `${proto}://${host}`), {method:"POST", headers});
  const clerk = createClerkClient({secretKey, publishableKey});
  const state = await clerk.authenticateRequest(request, {authorizedParties});
  if (!state.isAuthenticated) throw Object.assign(new Error("Your session expired. Sign in again to continue."), {status:401});
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).json(getModelInfo());
  }
  if (req.method !== "POST") return res.status(405).json({error:"Use GET for model information or POST to analyze a listing."});

  try { await authenticate(req); }
  catch (error) { return res.status(error.status || 401).json({error:error.message || "Your session expired. Sign in again to continue."}); }

  const validation = validateListingText(req.body?.text);
  if (validation.error) return res.status(validation.status).json({error:validation.error});
  return res.status(200).json(classify(validation.text));
};
