/**
 * Entry point for the token service.
 *
 * This file sets up an HTTP server using the Oak framework.  Two
 * endpoints are exposed: `/token` issues new JWTs and `/protected`
 * requires a valid token to access.  The server uses helper
 * functions defined in `utils/auth.ts` to generate and verify
 * tokens.
 */

import { Application, Router, type Context } from "./deps.ts";
import { generateToken, verifyToken } from "./utils/auth.ts";

/**
 * Extract the bearer token from an HTTP Authorization header.
 *
 * The header should be in the form `Bearer <token>`.  If the
 * header is missing or malformed the function returns `undefined`.
 */
function extractBearerToken(authHeader: string | null): string | undefined {
  if (!authHeader) return undefined;
  const parts = authHeader.split(" ");
  if (parts.length !== 2) return undefined;
  const [scheme, token] = parts;
  return scheme.toLowerCase() === "bearer" ? token : undefined;
}

const router = new Router();

// POST /token
// Accepts JSON containing a username and returns a JWT.  A password
// field may also be supplied to illustrate a login flow, but it is
// ignored in this simple example.  If the username is missing the
// server responds with a 400 error.
router.post("/token", async (ctx: Context) => {
  const body = ctx.request.body({ type: "json" });
  const value = await body.value;
  const username = value?.username;
  if (!username || typeof username !== "string") {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing or invalid username" };
    return;
  }
  const token = await generateToken(username);
  ctx.response.body = { token };
});

// GET /protected
// Requires a valid bearer token.  If the token is valid, the server
// responds with a greeting; otherwise it returns 401.
router.get("/protected", async (ctx: Context) => {
  const authHeader = ctx.request.headers.get("Authorization");
  const token = extractBearerToken(authHeader);
  if (!token) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Authorization header missing or malformed" };
    return;
  }
  const valid = await verifyToken(token);
  if (!valid) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Invalid or expired token" };
    return;
  }
  ctx.response.body = { message: "Access granted: you are authorized" };
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

// Start the HTTP server.  When running on Deno Deploy the `port`
// option is ignored; Deno Deploy automatically sets up the listener.
const port = Number(Deno.env.get("PORT")) || 8000;
console.log(`Server listening on port ${port}...`);
await app.listen({ port });