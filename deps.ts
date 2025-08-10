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

// Import helper functions and types from djwt.  Starting with v2.x,
// the djwt API exposes `create`, `verify`, and `getNumericDate` from
// its `mod.ts` entrypoint.  These functions replace the older
// `makeJwt`, `setExpiration`, and `validateJwt` helpers and provide
// equivalent functionality for signing and verifying JWTs.  See the
// djwt documentation for details.
export {
  create,
  verify,
  getNumericDate,
  type Header,
  type Payload,
} from "djwt/mod";