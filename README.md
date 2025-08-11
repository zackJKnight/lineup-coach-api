# Token & Player Service API

This repository implements a minimal JSON Web Token (JWT) service
written in [TypeScript](https://www.typescriptlang.org/) for the
[Deno](https://deno.com/) runtime.  Beyond token issuance, the
project now includes a full CRUD API for managing **players**, **teams**,
**positions**, **games**, **periods**, and **lineups**, along with
Google sign‑in via OAuth.  Originally the project exposed only
a `/token` endpoint for generating tokens and a `/protected` endpoint
that required a valid token to access.  It has since been extended
with:

* a `/players` resource backed by the built‑in [Deno KV
  database](https://docs.deno.com/deploy/kv/manual/on_deploy) which
  persists JSON objects in a globally replicated key‑value store;
* additional resources `/teams`, `/positions`, `/games`, `/periods` and
  `/lineups`, each following the same pattern as players with list,
  create, retrieve, update and delete operations;
* OAuth endpoints for Google sign‑in that use the
  [`@deno/kv‑oauth`](https://deno.land/x/kv_oauth) library to store
  session state in Deno KV and manage the OAuth2 authorization code
  flow; and
* an interactive Swagger UI at `/docs` that lets you explore and test
  all of the API endpoints.

The service uses the [Oak](https://deno.land/x/oak) web framework
for routing, [djwt](https://deno.land/x/djwt) for signing and
verifying JWTs, the native `Deno.openKv()` API for persistence, and
[`@deno/kv‑oauth`](https://deno.land/x/kv_oauth) for handling OAuth2
flows (Google in this example).

## Why version‑pinned imports?

Deno allows modules to be imported directly from remote URLs.  The
[Deno dependency management guide](https://www.kevincunningham.co.uk/posts/intro-to-jsr)
recommends importing third‑party modules from `deno.land/x` or the
standard library with explicit version numbers to ensure stability and
reproducibility【926774900134672†L152-L200】.  This project follows that
advice by defining an `import_map.json` that pins the versions of
`oak` and `djwt`.  Using versioned URLs prevents unexpected
breakages caused by upstream changes【926774900134672†L185-L199】.

## How the token service works

The service uses the `djwt` library to create and validate tokens.
Tokens are signed using the HS256 algorithm, and an expiration claim
is set one hour in the future.  The `create` function builds the
token from a header and payload, while `getNumericDate` converts a
timestamp into a numeric date suitable for the `exp` claim.  When a
client calls the `/token` endpoint with a JSON body containing a
`username`, the server responds with a signed JWT.  To protect a
route, the server checks the `Authorization` header and uses
`verify` to validate the token’s signature and expiration.  If the
token is valid, the request proceeds; otherwise the server
returns a 401 error.

The OpenAPI specification describing these endpoints can be found in
[`openapi.yaml`](./openapi.yaml).  This file defines all routes,
parameters and schemas for the service.  When running the server it is
exposed at `/openapi.yaml` so you can download it directly.  For
convenience the project also serves a live Swagger UI at `/docs` that
loads the specification from `/openapi.yaml` and lets you interact
with the API right in the browser.  You can still import the spec into
other tools like Postman if you prefer.

## Project layout

- **`import_map.json`** – defines aliases for third‑party modules.  Deno
  automatically reads this file when you pass `--import-map` to
  commands.
- **`deps.ts`** – centralises imports of Oak and djwt.  Importing
  dependencies through a single file makes it easy to upgrade
  versions in one place.
- **`utils/auth.ts`** – helper functions for generating and verifying
  tokens.  It demonstrates how to create a CryptoKey from a secret
  and how to call `makeJwt` and `validateJwt`【660786321715216†L115-L130】【660786321715216†L133-L150】.
 - **`main.ts`** – the entrypoint that configures the router.  It
  defines the `/token` and `/protected` endpoints for token
  generation and verification **and** implements CRUD handlers for
  `/players`, `/teams`, `/positions`, `/games`, `/periods` and `/lineups`
  using Deno KV.  It also integrates Google OAuth and exposes the
  OpenAPI spec and Swagger UI endpoints.
- **`openapi.yaml`** – the OpenAPI 3.1 specification for the
  service.
- **`.github/workflows/deploy.yml`** – a GitHub Actions workflow that
  deploys the service to Deno Deploy on pushes to `main`【509367563234816†L166-L201】.

## Running locally

Ensure that [Deno](https://deno.com/) is installed (version 2 or
higher).  To start the server locally, run:

```sh
deno run -A --import-map=import_map.json openapi-token-service/main.ts
```

This will start an HTTP server on port `8000` (or the value of the
`PORT` environment variable).  The `-A` flag grants all necessary
permissions (network and environment).  You can override the secret
used to sign tokens by setting the `JWT_SECRET` environment variable
before running the server.  To enable Google sign‑in locally you must
also set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as described in
the [Google sign‑in](#google-sign‑in-oauth) section.

### Example: obtain and use a token

1. **Generate a token**

   Send a POST request to `/token` with a JSON body containing a
   `username`:

   ```sh
   curl -X POST http://localhost:8000/token \
     -H "Content-Type: application/json" \
     -d '{"username": "alice"}'
   ```

   The response will contain a JWT:

   ```json
   { "token": "<your-jwt>" }
   ```

2. **Call the protected endpoint**

   Use the token returned above in the `Authorization` header when
   calling `/protected`:

   ```sh
   curl http://localhost:8000/protected \
     -H "Authorization: Bearer <your-jwt>"
   ```

   If the token is valid you will receive a message:

   ```json
   { "message": "Access granted: you are authorized" }
   ```

   If the token is missing or invalid the service responds with a
   401 error and an explanatory message.

### Managing players

This project also exposes a simple REST API for managing player
records.  Players correspond to the `Player` interface used in the
LineupCoach Angular client.  Each player has an `id`, `firstName`,
`lastName`, optional `isPresent` flag, a `positionPreferenceRank`
object with an ordered list of preferred positions, a list of
`startingPositionIds`, an optional `placementScore`, an optional
`fitScore`, and a list of `benchIds`.  Data is persisted in Deno KV
under the key space `['players', id]`.

#### Create a player

Send a POST request to `/players` with a JSON body containing the
player fields (excluding `id`).  The server generates a unique
identifier if one is not provided:

```sh
curl -X POST http://localhost:8000/players \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Alex",
    "lastName": "Morgan",
    "positionPreferenceRank": { "ranking": ["forward", "mid"] },
    "startingPositionIds": [1, 2],
    "benchIds": []
  }'
```

#### List players

Retrieve all players by sending a GET request to `/players`:

```sh
curl http://localhost:8000/players
```

#### Get, update and delete a player

Use the player’s `id` in the path:

```sh
# Get a player
curl http://localhost:8000/players/<player-id>

# Update a player
curl -X PUT http://localhost:8000/players/<player-id> \
  -H "Content-Type: application/json" \
  -d '{ "firstName": "Alexandra", "lastName": "Morgan", "positionPreferenceRank": { "ranking": ["forward"] }, "startingPositionIds": [1], "benchIds": [] }'

# Delete a player
curl -X DELETE http://localhost:8000/players/<player-id>
```

These endpoints do not require authentication.  In a real
application you would typically protect them with JWTs by adding
middleware similar to the `/protected` route.

### Managing teams, positions, games, periods and lineups

Beyond players, the API exposes additional resources reflecting the
LineupCoach domain model.  Each resource follows the same CRUD
pattern and is persisted in Deno KV under its own namespace.  The
table below summarises the resources and their prefixes:

| Resource      | Namespace prefix      | Description                                   |
|---------------|-----------------------|-----------------------------------------------|
| `/teams`      | `['teams', id]`       | Teams group players together and have a name. |
| `/positions`  | `['positions', id]`   | Positions represent spots on the field.        |
| `/games`      | `['games', id]`       | Games correspond to matches in a season.       |
| `/periods`    | `['periods', id]`     | Periods subdivide games into segments.         |
| `/lineups`    | `['lineups', id]`     | Lineups map positions to players for a game.   |

Each of these endpoints supports:

* `GET /resource` – list all records;
* `POST /resource` – create a new record (omit `id` to auto‑generate one);
* `GET /resource/{id}` – fetch a record by ID;
* `PUT /resource/{id}` – replace an existing record; and
* `DELETE /resource/{id}` – remove a record.

For example, to create a new team:

```sh
curl -X POST http://localhost:8000/teams \
  -H "Content-Type: application/json" \
  -d '{ "name": "U12 Blue Tigers" }'
```

And to create a lineup that assigns players to positions for a game:

```sh
curl -X POST http://localhost:8000/lineups \
  -H "Content-Type: application/json" \
  -d '{
    "teamId": "<team-id>",
    "gameId": "<game-id>",
    "periodId": null,
    "assignments": {
      "<position-id>": "<player-id>",
      "<another-position-id>": "<another-player-id>"
    }
  }'
```

All management endpoints are unauthenticated by default for simplicity,
but you can add middleware to protect them using JWTs if needed.

#### Generate a lineup automatically

Sometimes you want the server to pick which players should occupy each position.
The `POST /lineups/generate` endpoint does exactly that.  It examines all
positions and all players currently stored in Deno KV, filters out any players
whose `isPresent` flag is explicitly `false`, and then uses a **genetic
algorithm** to find a fair assignment.  The algorithm, adapted from the
LineupCoach client, evolves a population of random lineups and selects the
candidate with the best fairness ratio—meaning players are generally placed
into positions they prefer and the distribution of scores across players is
even.  Because the algorithm uses randomness and evolution, successive calls
to this endpoint may produce different assignments even with the same inputs.
You can include optional `teamId`, `gameId` and `periodId` fields in the
request body to associate the generated lineup with a particular team, game or
period.  Any positions without an available player will be left unassigned
(`null`).

Example:

```sh
curl -X POST http://localhost:8000/lineups/generate \
  -H "Content-Type: application/json" \
  -d '{ "teamId": "<team-id>", "gameId": "<game-id>", "periodId": null }'
```

The response will include a newly created lineup with an `id` and an
`assignments` object mapping each position ID to a player ID or `null`.  Use the
regular `/lineups` endpoints to view, update or delete the generated lineup.

### Google sign‑in (OAuth)

In addition to JWT‑based authentication, this project supports
federated login with Google.  The OAuth endpoints are built using
the [@deno/kv‑oauth](https://deno.land/x/kv_oauth) library, which
stores session state in Deno KV and implements the secure
authorization‑code flow.  To enable Google sign‑in you must set the
following environment variables when running the server:

```
export GOOGLE_CLIENT_ID=<your-google-client-id>
export GOOGLE_CLIENT_SECRET=<your-google-client-secret>
export GOOGLE_REDIRECT_URI=<https://your-project.deno.dev/oauth/callback>
```

The client ID and secret can be obtained by registering an OAuth
application at <https://console.cloud.google.com/apis/credentials>.  In
addition you must set `GOOGLE_REDIRECT_URI` to the exact callback
URL configured in your Google credentials.  A typical value for
Deno Deploy is `https://<your-project>.deno.dev/oauth/callback`.
When these variables are present the server exposes the following routes:

* `GET /oauth/signin` – Redirects the client to Google’s authorisation
  page.  Calling this endpoint initiates the OAuth flow.  The URL is
  generated for you; no parameters are needed.
* `GET /oauth/callback` – Handles the redirect from Google after the
  user grants permission.  This endpoint should be configured as the
  redirect URI in your Google API console.  After exchanging the
  authorisation code for tokens, the session is stored in Deno KV and
  the helper returns a response to the browser.  In a real
  application you would typically redirect or set a session cookie
  here.
* `GET /session` – Returns the current session identifier as JSON.  If
  no user is logged in it returns `{ sessionId: null }`.
* `GET /oauth/signout` – Clears the session from Deno KV and
  effectively logs the user out.

The `/session` and `/oauth/signout` endpoints are useful for checking
the user’s login status and implementing a sign‑out button in your
frontend.  These routes do not currently protect any resources; they
only demonstrate integration with Google.  For a production
application you would typically use the session ID to look up user
details and authorise access to other endpoints.

## Deploying to Deno Deploy

This project can be deployed to [Deno Deploy](https://deno.com/deploy)
either manually via the Deploy UI or automatically via GitHub
integration.  The provided GitHub Actions workflow is based on the
official example.  It checks out the repository, installs Deno, and
uploads the project using the `deployctl` action【509367563234816†L166-L201】.  You
will need to replace the `project` field in
`.github/workflows/deploy.yml` with the name of your Deploy project.

To deploy manually:

1. Create a new project in Deno Deploy and choose “Import from
   GitHub.”
2. Select your repository and branch.  Deno Deploy will detect the
   entrypoint (`main.ts`) and automatically deploy it.  Commits to
   the `main` branch will trigger new deployments.

To deploy using GitHub Actions:

1. Ensure the `project` name in `deploy.yml` matches your Deploy
   project.
2. Commit and push to the `main` branch.  The action will run and
   upload your code to Deno Deploy.  The workflow uses the
   `id‑token` and `contents` permissions required by Deno Deploy【509367563234816†L166-L201】.

For more details about automatic and GitHub Actions deployment modes,
see the [Deno Deploy documentation](https://docs.deno.com/deploy/manual/ci_github).

## License

This project is provided for educational and demonstration purposes.  It
shows how to build a small API with token issuance, persistent
storage via Deno KV, and federated login via Google OAuth.  It is
licensed under the MIT License..