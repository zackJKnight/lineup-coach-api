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
//
// NOTE: `createGoogleOAuthConfig` requires a `redirectUri` and `scope`.  We
// read the redirect URI from an environment variable `GOOGLE_REDIRECT_URI`
// so that it can be set per‑environment (e.g. your production domain vs
// local testing).  A typical value for production is
// `https://<your‑project>.deno.dev/oauth/callback`.  The scope
// determines which Google APIs are requested; `openid email profile`
// provides basic identity information.
const googleOAuthConfig = createGoogleOAuthConfig({
  redirectUri: Deno.env.get("GOOGLE_REDIRECT_URI") ?? "",
  scope: ["openid", "email", "profile"],
});
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
// Team management endpoints
//
// A team represents a collection of players.  For now the only
// attribute defined by the Angular client is a `name` field, but
// additional properties can be added over time.  Teams are stored
// under the `['teams', id]` prefix in Deno KV.  As with players, the
// client may provide an `id` when creating a team; otherwise a
// UUID is generated.

// GET /teams – list all teams
router.get("/teams", async (ctx: Context) => {
  const teams: unknown[] = [];
  for await (const entry of kv.list({ prefix: ["teams"] })) {
    const [, id] = entry.key as [string, string];
    teams.push({ id, ...(entry.value as Record<string, unknown>) });
  }
  ctx.response.body = teams;
});

// POST /teams – create a new team
router.post("/teams", async (ctx: Context) => {
  const body = ctx.request.body({ type: "json" });
  const data = await body.value;
  let teamId: string = data?.id;
  if (!teamId || typeof teamId !== "string") {
    teamId = crypto.randomUUID();
  }
  const { id: _, ...team } = data ?? {};
  await kv.set(["teams", teamId], team);
  ctx.response.status = 201;
  ctx.response.body = { id: teamId, ...team };
});

// GET /teams/:id – retrieve a team by ID
router.get("/teams/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing team id" };
    return;
  }
  const entry = await kv.get(["teams", id]);
  if (!entry.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Team not found" };
    return;
  }
  ctx.response.body = { id, ...(entry.value as Record<string, unknown>) };
});

// PUT /teams/:id – update an existing team
router.put("/teams/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing team id" };
    return;
  }
  const existing = await kv.get(["teams", id]);
  if (!existing.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Team not found" };
    return;
  }
  const body = ctx.request.body({ type: "json" });
  const data = await body.value;
  const { id: _, ...team } = data ?? {};
  await kv.set(["teams", id], team);
  ctx.response.body = { id, ...team };
});

// DELETE /teams/:id – delete a team
router.delete("/teams/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing team id" };
    return;
  }
  const existing = await kv.get(["teams", id]);
  if (!existing.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Team not found" };
    return;
  }
  await kv.delete(["teams", id]);
  ctx.response.status = 204;
});

// ---------------------------------------------------------------------------
// Position management endpoints
//
// Positions represent spots on the field (e.g. Goalkeeper, Defender).
// Each position may belong to a particular period via `periodId`
// and optionally track fit scores for each player.  We follow the
// same CRUD pattern used for players and teams.  Positions are
// stored under the `['positions', id]` prefix.

router.get("/positions", async (ctx: Context) => {
  const positions: unknown[] = [];
  for await (const entry of kv.list({ prefix: ["positions"] })) {
    const [, id] = entry.key as [string, string];
    positions.push({ id, ...(entry.value as Record<string, unknown>) });
  }
  ctx.response.body = positions;
});

router.post("/positions", async (ctx: Context) => {
  const body = ctx.request.body({ type: "json" });
  const data = await body.value;
  let posId: string = data?.id;
  if (!posId || typeof posId !== "string") {
    posId = crypto.randomUUID();
  }
  const { id: _, ...pos } = data ?? {};
  await kv.set(["positions", posId], pos);
  ctx.response.status = 201;
  ctx.response.body = { id: posId, ...pos };
});

router.get("/positions/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing position id" };
    return;
  }
  const entry = await kv.get(["positions", id]);
  if (!entry.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Position not found" };
    return;
  }
  ctx.response.body = { id, ...(entry.value as Record<string, unknown>) };
});

router.put("/positions/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing position id" };
    return;
  }
  const existing = await kv.get(["positions", id]);
  if (!existing.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Position not found" };
    return;
  }
  const body = ctx.request.body({ type: "json" });
  const data = await body.value;
  const { id: _, ...pos } = data ?? {};
  await kv.set(["positions", id], pos);
  ctx.response.body = { id, ...pos };
});

router.delete("/positions/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing position id" };
    return;
  }
  const existing = await kv.get(["positions", id]);
  if (!existing.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Position not found" };
    return;
  }
  await kv.delete(["positions", id]);
  ctx.response.status = 204;
});

// ---------------------------------------------------------------------------
// Game management endpoints
//
// Games represent individual matches.  Each game may include
// properties such as opponent, date/time, location and notes.  Games
// are stored under the `['games', id]` prefix.

router.get("/games", async (ctx: Context) => {
  const games: unknown[] = [];
  for await (const entry of kv.list({ prefix: ["games"] })) {
    const [, id] = entry.key as [string, string];
    games.push({ id, ...(entry.value as Record<string, unknown>) });
  }
  ctx.response.body = games;
});

router.post("/games", async (ctx: Context) => {
  const body = ctx.request.body({ type: "json" });
  const data = await body.value;
  let gameId: string = data?.id;
  if (!gameId || typeof gameId !== "string") {
    gameId = crypto.randomUUID();
  }
  const { id: _, ...game } = data ?? {};
  await kv.set(["games", gameId], game);
  ctx.response.status = 201;
  ctx.response.body = { id: gameId, ...game };
});

router.get("/games/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing game id" };
    return;
  }
  const entry = await kv.get(["games", id]);
  if (!entry.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Game not found" };
    return;
  }
  ctx.response.body = { id, ...(entry.value as Record<string, unknown>) };
});

router.put("/games/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing game id" };
    return;
  }
  const existing = await kv.get(["games", id]);
  if (!existing.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Game not found" };
    return;
  }
  const body = ctx.request.body({ type: "json" });
  const data = await body.value;
  const { id: _, ...game } = data ?? {};
  await kv.set(["games", id], game);
  ctx.response.body = { id, ...game };
});

router.delete("/games/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing game id" };
    return;
  }
  const existing = await kv.get(["games", id]);
  if (!existing.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Game not found" };
    return;
  }
  await kv.delete(["games", id]);
  ctx.response.status = 204;
});

// ---------------------------------------------------------------------------
// Period management endpoints
//
// Periods represent halves, quarters or innings within a game.  Each
// period must reference a parent game via `gameId` and may include a
// numerical `number` field.  Periods are stored under
// `['periods', id]`.

router.get("/periods", async (ctx: Context) => {
  const periods: unknown[] = [];
  for await (const entry of kv.list({ prefix: ["periods"] })) {
    const [, id] = entry.key as [string, string];
    periods.push({ id, ...(entry.value as Record<string, unknown>) });
  }
  ctx.response.body = periods;
});

router.post("/periods", async (ctx: Context) => {
  const body = ctx.request.body({ type: "json" });
  const data = await body.value;
  let periodId: string = data?.id;
  if (!periodId || typeof periodId !== "string") {
    periodId = crypto.randomUUID();
  }
  const { id: _, ...period } = data ?? {};
  await kv.set(["periods", periodId], period);
  ctx.response.status = 201;
  ctx.response.body = { id: periodId, ...period };
});

router.get("/periods/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing period id" };
    return;
  }
  const entry = await kv.get(["periods", id]);
  if (!entry.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Period not found" };
    return;
  }
  ctx.response.body = { id, ...(entry.value as Record<string, unknown>) };
});

router.put("/periods/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing period id" };
    return;
  }
  const existing = await kv.get(["periods", id]);
  if (!existing.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Period not found" };
    return;
  }
  const body = ctx.request.body({ type: "json" });
  const data = await body.value;
  const { id: _, ...period } = data ?? {};
  await kv.set(["periods", id], period);
  ctx.response.body = { id, ...period };
});

router.delete("/periods/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing period id" };
    return;
  }
  const existing = await kv.get(["periods", id]);
  if (!existing.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Period not found" };
    return;
  }
  await kv.delete(["periods", id]);
  ctx.response.status = 204;
});

// ---------------------------------------------------------------------------
// Lineup management endpoints
//
// A lineup represents the assignment of players to positions for a
// given team, game and optional period.  The `assignments` object
// maps `positionId` to `playerId`.  Lineups are stored under
// `['lineups', id]`.

router.get("/lineups", async (ctx: Context) => {
  const lineups: unknown[] = [];
  for await (const entry of kv.list({ prefix: ["lineups"] })) {
    const [, id] = entry.key as [string, string];
    lineups.push({ id, ...(entry.value as Record<string, unknown>) });
  }
  ctx.response.body = lineups;
});

router.post("/lineups", async (ctx: Context) => {
  const body = ctx.request.body({ type: "json" });
  const data = await body.value;
  let lineupId: string = data?.id;
  if (!lineupId || typeof lineupId !== "string") {
    lineupId = crypto.randomUUID();
  }
  const { id: _, ...lineup } = data ?? {};
  await kv.set(["lineups", lineupId], lineup);
  ctx.response.status = 201;
  ctx.response.body = { id: lineupId, ...lineup };
});

router.get("/lineups/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing lineup id" };
    return;
  }
  const entry = await kv.get(["lineups", id]);
  if (!entry.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Lineup not found" };
    return;
  }
  ctx.response.body = { id, ...(entry.value as Record<string, unknown>) };
});

router.put("/lineups/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing lineup id" };
    return;
  }
  const existing = await kv.get(["lineups", id]);
  if (!existing.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Lineup not found" };
    return;
  }
  const body = ctx.request.body({ type: "json" });
  const data = await body.value;
  const { id: _, ...lineup } = data ?? {};
  await kv.set(["lineups", id], lineup);
  ctx.response.body = { id, ...lineup };
});

router.delete("/lineups/:id", async (ctx: Context) => {
  const id = ctx.params.id;
  if (!id) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Missing lineup id" };
    return;
  }
  const existing = await kv.get(["lineups", id]);
  if (!existing.value) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Lineup not found" };
    return;
  }
  await kv.delete(["lineups", id]);
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

// ---------------------------------------------------------------------------
// OpenAPI specification and Swagger UI
//
// Expose the raw OpenAPI YAML file at `/openapi.yaml` so that clients
// can retrieve the specification directly.  The file is read from
// the filesystem at runtime.  When serving the spec we set a
// `Content-Type` of `text/yaml` to hint that the body contains YAML.
router.get("/openapi.yaml", async (ctx: Context) => {
  try {
    // Resolve the path relative to this file.  On Deno Deploy and
    // locally the working directory is the project root, so this
    // reads the `openapi.yaml` file packaged with the code.
    const spec = await Deno.readTextFile("./openapi.yaml");
    ctx.response.headers.set("Content-Type", "text/yaml");
    ctx.response.body = spec;
  } catch (err) {
    console.error("Failed to read openapi.yaml", err);
    ctx.response.status = 500;
    ctx.response.body = { error: "Unable to load OpenAPI specification" };
  }
});

// Serve an interactive Swagger UI at `/docs`.  This endpoint returns
// an HTML page that loads the Swagger UI assets from a public CDN
// and configures it to fetch the API definition from `/openapi.yaml`.
// Users can visit `/docs` in a browser to explore and test the API.
router.get("/docs", (ctx: Context) => {
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        SwaggerUIBundle({
          url: '/openapi.yaml',
          dom_id: '#swagger-ui',
          presets: [SwaggerUIBundle.presets.apis],
          layout: 'BaseLayout'
        });
      };
    </script>
  </body>
</html>`;
  ctx.response.headers.set("Content-Type", "text/html");
  ctx.response.body = html;
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

// Start the HTTP server.  When running on Deno Deploy the `port`
// option is ignored; Deno Deploy automatically sets up the listener.
const port = Number(Deno.env.get("PORT")) || 8000;
console.log(`Server listening on port ${port}...`);
await app.listen({ port });