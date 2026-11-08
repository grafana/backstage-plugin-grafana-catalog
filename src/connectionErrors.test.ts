import { isConnectionError, isServerResponse } from './connectionErrors';

const status = (code: number) =>
  Object.assign(new Error(`HTTP ${code}`), { code });
const system = (code: string) => Object.assign(new Error(code), { code });

describe('isConnectionError', () => {
  it.each([401, 403, 502, 503, 504])('treats HTTP %i as the connection', n => {
    expect(isConnectionError(status(n))).toBe(true);
  });

  it.each([400, 404, 409, 410, 422, 429, 500])(
    'treats HTTP %i as an answer about the entity, not the connection',
    n => {
      expect(isConnectionError(status(n))).toBe(false);
    },
  );

  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ])('treats the transport code %s as the connection', code => {
    expect(isConnectionError(system(code))).toBe(true);
  });

  it('finds the transport code on a wrapped error', () => {
    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });

    expect(isConnectionError(wrapped)).toBe(true);
  });

  it.each(['AbortError', 'TimeoutError'])(
    'treats a %s from the request timeout as the connection',
    name => {
      expect(isConnectionError(Object.assign(new Error('x'), { name }))).toBe(
        true,
      );
    },
  );

  it('does not treat an unknown error as the connection', () => {
    expect(isConnectionError(new TypeError('x is not a function'))).toBe(false);
    expect(isConnectionError(system('EACCES'))).toBe(false);
  });

  it('copes with values that are not errors', () => {
    expect(isConnectionError(undefined)).toBe(false);
    expect(isConnectionError(null)).toBe(false);
    expect(isConnectionError('ECONNREFUSED')).toBe(false);
    expect(isConnectionError(503)).toBe(false);
  });
});

describe('isServerResponse', () => {
  it('is true for an error that carries an HTTP status', () => {
    expect(isServerResponse(status(404))).toBe(true);
    expect(isServerResponse(status(503))).toBe(true);
  });

  it('is false for transport errors and everything else', () => {
    expect(isServerResponse(system('ECONNREFUSED'))).toBe(false);
    expect(isServerResponse(new Error('x'))).toBe(false);
    expect(isServerResponse(undefined)).toBe(false);
    expect(isServerResponse(null)).toBe(false);
  });
});
