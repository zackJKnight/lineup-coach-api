/**
 * Centralised dependency imports for the application.
 *
 * Importing third‑party modules through an import map (see
 * `import_map.json`) allows us to pin exact versions and avoid
 * inadvertently pulling the latest changes. According to Deno
 * dependency management best practices, version‑pinned imports from
 * `deno.land/x` or the standard library are the most stable and
 * reproducible way to include external modules【926774900134672†L152-L200】.
 */

export { Application, Router, type Context } from "oak";

// The `makeJwt` and `setExpiration` functions create signed JSON Web
// Tokens (JWTs) for our users. The `validateJwt` function checks
// whether a supplied token is valid.  These functions are part of
// the `djwt` module. See the tutorial on generating and validating
// JWTs for example usage【660786321715216†L115-L130】【660786321715216†L133-L150】.
export {
  makeJwt,
  setExpiration,
  type Jose,
  type Payload,
} from "djwt/create";
export { validateJwt } from "djwt/validate";