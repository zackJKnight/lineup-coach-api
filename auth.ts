/**
 * Authentication utilities for creating and verifying JWTs.
 *
 * This module exports helper functions that encapsulate the
 * underlying JWT library (`djwt`). It exposes a `generateToken`
 * function for signing new tokens and a `verifyToken` function
 * for validating incoming tokens.
 */

import {
  create,
  verify,
  getNumericDate,
  type Header,
  type Payload,
} from "./deps.ts";

// HS256 is used for signing tokens.  In a production application
// you should provide a strong secret via an environment variable.  For
// demonstration purposes, we fall back to a hard‑coded string when
// `JWT_SECRET` is undefined.
const secret = Deno.env.get("JWT_SECRET") ?? "super‑secret‑key";

// Tokens are signed using a CryptoKey created from the secret.  Deno
// exposes the Web Crypto API, which we use here.  Each call to
// `importKey` returns a promise because key generation happens
// asynchronously.
async function getKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Generate a signed JWT for a given user identifier.
 *
 * The returned token uses the HS256 algorithm and includes an
 * expiration claim set one hour in the future.  The djwt
 * `create` function takes a header, payload and signing key and
 * returns the encoded JWT.  The helper `getNumericDate` converts
 * a relative time offset (in seconds) into the numeric `exp` claim.
 *
 * @param username – the subject for whom the token is issued
 * @returns a promise that resolves to the JWT string
 */
export async function generateToken(username: string): Promise<string> {
  const header: Header = { alg: "HS256", typ: "JWT" };
  const payload: Payload = {
    iss: username,
    // expire one hour from now
    exp: getNumericDate(60 * 60),
  };
  const key = await getKey();
  // `create` returns a signed JWT given a header, payload and key
  const jwt = await create(header, payload, key);
  return jwt;
}

/**
 * Verify a JWT's signature and expiry.
 *
 * On success the promise resolves to `true`; otherwise it resolves
 * to `false`.  The `verify` function throws an error if signature
 * verification fails or the token has expired.  We catch any errors
 * and return `false` in that case.
 *
 * @param token – the JWT to verify
 * @returns a promise that resolves to a boolean indicating validity
 */
export async function verifyToken(token: string): Promise<boolean> {
  const key = await getKey();
  try {
    // `verify` throws an error if the signature is invalid or the token
    // has expired.  It returns the payload of the token on success.
    await verify(token, key);
    return true;
  } catch (_err) {
    return false;
  }
}