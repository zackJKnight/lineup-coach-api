/**
 * Entry point for the token service.
 *
 * This file sets up an HTTP server using the Oak framework.  Two
 * endpoints are exposed: `/token` issues new JWTs and `/protected`
 * requires a valid token to access.  The server uses helper
 * functions defined in `utils/auth.ts` to generate and verify
 * tokens.
 */

import { Application, Router, type Context, createGoogleOAuthConfig, createHelpers } from "./deps.ts";
// Import the token helpers from the top‑level auth module instead of the utils
// directory.  The utils folder is not used in this simplified project structure.
import { generateToken, verifyToken } from "./auth.ts";

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

// ---------------------------------------------------------------------------
// Google OAuth integration
//
// The @deno/kv-oauth package provides helpers for performing OAuth 2.0
// authorization flows and storing session information in Deno KV.  Here we
// configure Google as our identity provider.  When users visit
// `/oauth/signin` they will be redirected to Google's consent page.  After
// authorizing the application Google redirects back to `/oauth/callback`
// which completes the handshake and stores an opaque session ID in a
// signed cookie.  The helper functions automatically read the
// `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` environment variables.
// See the Deno KV OAuth documentation for a list of supported providers
//【646283931785072†L323-L347】.
const googleOAuthConfig = createGoogleOAuthConfig();
const {
  signIn: googleSignIn,
  handleCallback: googleHandleCallback,
  getSessionId: googleGetSessionId,
  signOut: googleSignOut,
} = createHelpers(googleOAuthConfig);

// Open a connection to Deno KV.  When running on Deno Deploy this
// returns a handle to a globally distributed, strongly consistent
// key‑value store.  Locally it falls back to a SQLite database in
// the `.deno/kv` directory.  Using `await` at module scope is
// allowed in modern versions of Deno.
const kv = await Deno.openKv();

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

// ---------------------------------------------------------------------------
// Player management endpoints
//
// The LineupCoach Angular app defines a simple `Player` interface with
// properties such as `firstName`, `lastName`, optional boolean
// `isPresent`, a nested `positionPreferenceRank` object, an array of
// `startingPositionIds`, a `placementScore`, an optional `fitScore` and
// an array of `benchIds`.  These endpoints expose a basic CRUD API for
// players backed by Deno KV.  Each player is stored at the key
// `['players', <playerId>]`.  The player ID is either supplied by the
// client or generated using `crypto.randomUUID()`.

// GET /players
// List all players.  Iterates over all keys in the "players" namespace
// and returns an array of player objects including their IDs.
router.get("/players", async (ctx: Context) => {
  const players: unknown[] = [];
  for await (const entry of kv.list({ prefix: ["players"] })) {
    const [, id] = entry.key as [string, string];
    players.push({ id, ...(entry.value as Record<string, unknown>) });
  }
  ctx.response.body = players;
});

// POST /players
// Create a new player.  Accepts a JSON body matching the Player
// interface (except for the `id`).  Returns the created player with
// its assigned ID.
router.post("/players", async (ctx: Context) => {
  const body = ctx.request.body({ type: "json" });
  const data = await body.value;
  // If the client supplied an id, use it; otherwise generate a
  // version 4 UUID.  Deno Deploy supports the Web Crypto API.
  let playerId: string = data?.id;
  if (!playerId || typeof playerId !== "string") {
    playerId = crypto.randomUUID();
  }
  // Remove any id from the stored value
  const { id: _, ...player } = data ?? {};
  await kv.set(["players", playerId], player);
  ctx.response.status = 201;
  ctx.response.body = { id: playerId, ...player };
});

// GET /players/:id
// Fetch a single player by ID.  Returns 404 if the player does not
// exist.
router.get("/players/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing player id" };
    return;
  }
  const entry = await kv.get(["players", id]);
  if (!entry.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Player not found" };
    return;
  }
  ctx.response.body = { id, ...(entry.value as Record<string, unknown>) };
});

// PUT /players/:id
// Update an existing player.  Performs a simple replacement of the
// stored object.  If the player does not exist the response is 404.
router.put("/players/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing player id" };
    return;
  }
  const existing = await kv.get(["players", id]);
  if (!existing.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Player not found" };
    return;
  }
  const body = ctx.request.body({ type: "json" });
  const data = await body.value;
  // Remove any id field
  const { id: _, ...player } = data ?? {};
  await kv.set(["players", id], player);
  ctx.response.body = { id, ...player };
});

// DELETE /players/:id
// Remove a player from the database.  Returns 204 on success or 404
// if the player does not exist.
router.delete("/players/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing player id" };
    return;
  }
  const existing = await kv.get(["players", id]);
  if (!existing.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Player not found" };
    return;
  }
  await kv.delete(["players", id]);
  ctx.response.status = 204;
});

// ---------------------------------------------------------------------------
// OAuth routes
//
// Initiate a Google sign‑in by redirecting the client to Google.  The
// `googleSignIn` helper constructs an OAuth authorization request and
// returns a `Response` object containing a 302 redirect.  We convert the
// helper's response into Oak's response format by copying the status,
// headers and body.  No authentication is required to call this
// endpoint.
router.get("/oauth/signin", async (ctx: Context) => {
  const request = new Request(ctx.request.url.href, {
    method: ctx.request.method,
    headers: ctx.request.headers,
  });
  const response = await googleSignIn(request);
  ctx.response.status = response.status;
  // copy headers (e.g. Location) to redirect the browser
  response.headers.forEach((value, key) => ctx.response.headers.set(key, value));
  // forward the response body if present
  const text = await response.text();
  if (text) ctx.response.body = text;
});

// Handle the OAuth callback from Google.  After the user grants
// permission Google redirects back to this endpoint with a code.  The
// `googleHandleCallback` helper exchanges the code for tokens, stores
// the session information in Deno KV and returns a response (usually a
// 302 redirect to the root).  We again copy the status, headers and
// body to the Oak response.  Clients should preserve the cookies set
// by this response for subsequent requests.
router.get("/oauth/callback", async (ctx: Context) => {
  const request = new Request(ctx.request.url.href, {
    method: ctx.request.method,
    headers: ctx.request.headers,
  });
  const { response } = await googleHandleCallback(request);
  ctx.response.status = response.status;
  response.headers.forEach((value, key) => ctx.response.headers.set(key, value));
  const text = await response.text();
  if (text) ctx.response.body = text;
});

// Sign the user out by deleting the session from Deno KV and clearing
// the session cookie.  This endpoint always succeeds.
router.get("/oauth/signout", async (ctx: Context) => {
  const request = new Request(ctx.request.url.href, {
    method: ctx.request.method,
    headers: ctx.request.headers,
  });
  const response = await googleSignOut(request);
  ctx.response.status = response.status;
  response.headers.forEach((value, key) => ctx.response.headers.set(key, value));
  const text = await response.text();
  if (text) ctx.response.body = text;
});

// Retrieve the current session identifier.  The `googleGetSessionId`
// helper reads the session cookie and returns the associated session ID
// or `undefined` if no session is active.  This endpoint does not
// return any sensitive information; it simply exposes whether the
// client is authenticated.
router.get("/session", async (ctx: Context) => {
  const request = new Request(ctx.request.url.href, {
    method: ctx.request.method,
    headers: ctx.request.headers,
  });
  const sessionId = await googleGetSessionId(request);
  ctx.response.body = { sessionId };
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

// Start the HTTP server.  When running on Deno Deploy the `port`
// option is ignored; Deno Deploy automatically sets up the listener.
const port = Number(Deno.env.get("PORT")) || 8000;
console.log(`Server listening on port ${port}...`);
await app.listen({ port });