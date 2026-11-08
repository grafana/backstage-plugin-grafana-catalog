// HTTP statuses that mean the connection is unusable rather than that one entity
// is wrong: bad or revoked credentials, or a gateway that cannot reach the API.
//
// A 403 is counted on purpose. The credential is a Cloud Access Policy token, whose
// scopes apply to the whole stack rather than to individual entities, so a 403 on
// one request normally means the token lost its access for all of them. If a 403
// ever does come from a single resource, it still has to repeat, on requests at
// least CONNECTION_FAILURE_SPACING_MS apart, before uploads pause, and the next
// reconnect proves whether the connection is in fact fine.
const CONNECTION_STATUSES = new Set([401, 403, 502, 503, 504]);

// Transport and TLS failures. These come from node-fetch as the `code` of a
// FetchError, so no HTTP response was ever received.
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ETIMEDOUT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

/**
 * isConnectionError reports whether a failed ServiceModel API request says the
 * connection to Grafana Cloud is unusable, as opposed to something being wrong
 * with the one entity being uploaded.
 *
 * A 404 (an object that does not exist yet), a 409 (a stale resourceVersion), a
 * 422 (an invalid object) or a 429 (rate limited) all mean the API answered, so
 * they say nothing against the connection. A 401 or 403, a TLS failure, a refused
 * or reset socket, a gateway error and the request timeout do.
 * @param err - The error a ServiceModel API call rejected with
 * @returns - True if the error points at the connection rather than the entity
 */
export function isConnectionError(err: unknown): boolean {
  const e = err as
    | { code?: unknown; name?: unknown; cause?: { code?: unknown } }
    | undefined;
  if (e === null || typeof e !== 'object') {
    return false;
  }

  if (typeof e.code === 'number') {
    return CONNECTION_STATUSES.has(e.code);
  }
  if (typeof e.code === 'string' && CONNECTION_CODES.has(e.code)) {
    return true;
  }
  // Some clients wrap the system error instead of exposing its code directly
  if (typeof e.cause?.code === 'string' && CONNECTION_CODES.has(e.cause.code)) {
    return true;
  }
  // A request cut off by the per-request timeout carries no code at all
  return e.name === 'AbortError' || e.name === 'TimeoutError';
}

/**
 * isServerResponse reports whether an error carries an HTTP status, meaning the
 * API answered. Such an error is proof the connection works, even when the answer
 * was a failure.
 * @param err - The error a ServiceModel API call rejected with
 * @returns - True if the error came from an HTTP response
 */
export function isServerResponse(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    typeof (err as { code?: unknown }).code === 'number'
  );
}
