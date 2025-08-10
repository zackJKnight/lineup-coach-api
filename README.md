# Token & Player Service API

This repository implements a minimal JSON Web Token (JWT) service
written in [TypeScript](https://www.typescriptlang.org/) for the
[Deno](https://deno.com/) runtime **and** a simple CRUD API for
managing player data.  Originally the project exposed only a `/token`
endpoint for generating tokens and a `/protected` endpoint that
required a valid token to access.  It has since been extended with a
`/players` resource backed by the built‑in [Deno KV
database](https://docs.deno.com/deploy/kv/manual/on_deploy) which
persists JSON objects in a globally replicated key‑value store.

The service uses the [Oak](https://deno.land/x/oak) web framework
for routing, [djwt](https://deno.land/x/djwt) for signing and
verifying JWTs, and the native `Deno.openKv()` API for persistence.

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
is set one hour in the future.  The `makeJwt` function builds the
token from a header and payload, while `setExpiration` converts a
timestamp into a numeric date suitable for the `exp` claim【660786321715216†L115-L130】.
When a client calls the `/token` endpoint with a JSON body containing
a `username`, the server responds with a signed JWT.  To protect a
route, the server checks the `Authorization` header and uses
`validateJwt` to verify the token’s signature and expiration【660786321715216†L133-L150】.
If the token is valid, the request proceeds; otherwise the server
returns a 401 error.

The OpenAPI specification describing these endpoints can be found in
[`openapi.yaml`](./openapi.yaml).  This file can be imported into API
development tools such as Swagger UI or Postman.

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
  `/players` using Deno KV.
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
before running the server.

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

This project is provided for demonstration purposes and does not
include any authentication or persistence beyond token generation.  It
is licensed under the MIT License.