const {lookup} = require("node:dns/promises");
const net = require("node:net");
const {createClerkClient} = require("@clerk/backend");

const authorizedParties = [
  "https://jobshield-fake-job-detection.vercel.app",
  "https://jobshield-fake-job-detection-simoneanand0-web.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173"
];
const maxBytes = 1_500_000;

function isPrivateIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a,b,c] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113);
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    const hexMapped = normalized.match(/::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
    if (hexMapped) {
      const high = parseInt(hexMapped[1], 16);
      const low = parseInt(hexMapped[2], 16);
      return isPrivateIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:");
  }
  return true;
}

async function validatePublicHttps(url) {
  if (url.protocol !== "https:") throw Object.assign(new Error("For safety, listing import only accepts HTTPS links."), {status:400});
  if (url.username || url.password) throw Object.assign(new Error("Remove any username or password from the listing URL."), {status:400});
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw Object.assign(new Error("That host cannot be imported."), {status:400});
  }
  const addresses = net.isIP(hostname) ? [{address:hostname}] : await lookup(hostname, {all:true, verbatim:true});
  if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) {
    throw Object.assign(new Error("That host is not a public website."), {status:400});
  }
}

async function readLimited(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw Object.assign(new Error("This page is too large to import. Copy and paste the job description instead."), {status:413});
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw Object.assign(new Error("This page is too large to import. Copy and paste the job description instead."), {status:413});
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", {fatal:false}).decode(joined);
}

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
    const key = entity.toLowerCase();
    if (key === "amp") return "&";
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key === "quot") return '"';
    if (key === "apos") return "'";
    if (key === "nbsp") return " ";
    const code = key.startsWith("#x") ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
  });
}

function extractText(html) {
  const title = decodeEntities((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [,"Job listing"])[1]
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 180);
  const text = decodeEntities(html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|noscript|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(?:p|div|li|h[1-6]|br|tr|section|article)>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .replace(/[\t\f\v ]+/g, " ").replace(/ *\n+ */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return {title, text:text.slice(0, 12000)};
}

async function authenticate(req) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) throw Object.assign(new Error("Account sign-in is not configured yet."), {status:503});
  const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!bearer) throw Object.assign(new Error("Sign in to import a listing."), {status:401});
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const proto = String(req.headers["x-forwarded-proto"] || (host.startsWith("localhost") ? "http" : "https")).split(",")[0].trim();
  const headers = new Headers({authorization:`Bearer ${bearer[1]}`});
  if (req.headers.origin) headers.set("origin", String(req.headers.origin));
  const request = new Request(new URL(req.url || "/api/extract", `${proto}://${host}`), {method:"POST", headers});
  const clerk = createClerkClient({secretKey, publishableKey});
  const state = await clerk.authenticateRequest(request, {authorizedParties});
  if (!state.isAuthenticated) throw Object.assign(new Error("Your session expired. Sign in again to continue."), {status:401});
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({error:"Use POST"});
  try { await authenticate(req); }
  catch (error) { return res.status(error.status || 401).json({error:error.message || "Sign-in could not be verified."}); }

  let current;
  try { current = new URL(String((req.body || {}).url || "")); }
  catch { return res.status(400).json({error:"Enter a valid job listing URL."}); }

  try {
    for (let redirect = 0; redirect <= 3; redirect++) {
      await validatePublicHttps(current);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      let response;
      try {
        response = await fetch(current, {
          method:"GET", redirect:"manual", signal:controller.signal,
          headers:{"user-agent":"JobShieldListingImporter/1.0 (extracts visible job-post text)", accept:"text/html,application/xhtml+xml,text/plain;q=0.8"}
        });
      } finally { clearTimeout(timer); }

      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirect === 3) return res.status(422).json({error:"The listing redirected too many times. Paste the job description instead."});
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) return res.status(422).json({error:`The job site returned ${response.status}. It may block automatic importing; copy and paste the listing text instead.`});
      const type = String(response.headers.get("content-type") || "").toLowerCase();
      if (!(type.includes("text/html") || type.includes("application/xhtml+xml") || type.startsWith("text/plain"))) {
        return res.status(415).json({error:"That link does not return a readable webpage. Copy and paste the job description instead."});
      }
      const body = await readLimited(response);
      const extracted = extractText(body);
      if (extracted.text.length < 35) return res.status(422).json({error:"We could not find enough readable text. This site may block importing; copy and paste the listing instead."});
      return res.status(200).json({...extracted, url:current.href});
    }
  } catch (error) {
    if (error.name === "AbortError") return res.status(408).json({error:"The listing page took too long to respond. Copy and paste the job description instead."});
    return res.status(error.status || 422).json({error:error.message || "Could not import that listing."});
  }
  return res.status(422).json({error:"Could not import that listing. Copy and paste the job description instead."});
};
