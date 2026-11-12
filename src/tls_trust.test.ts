import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import https from 'https';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';

import { buildCluster } from './kube_config';

// Real TLS handshakes against a local HTTPS server. Certificates are generated
// at test time with the openssl CLI, so no key material is checked in. The
// suite is skipped when openssl is not available, except in CI, where a missing
// openssl fails the run so the handshake proof cannot vanish unnoticed.
//
// Scope: the handshakes use the Cluster the plugin builds and feed its caData to
// Node the way @kubernetes/client-node does (caData decoded into the `ca`
// option, none when absent). They check the plugin's output plus Node's trust
// semantics; they do not load the client itself, which jest cannot import.
const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// The error codes Node reports when a chain does not verify.
const VERIFY_FAILURE =
  /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED|CERT_/;

const describeTls = hasOpenssl ? describe : describe.skip;

if (!hasOpenssl && process.env.CI) {
  it('needs the openssl CLI on PATH in CI', () => {
    // openssl was not found, so the TLS handshake tests cannot run.
    expect(hasOpenssl).toBe(true);
  });
}

const CA_CONFIG = `[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no
[dn]
CN = test-ca
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
`;

const SERVER_CONFIG = `[req]
distinguished_name = dn
prompt = no
[dn]
CN = localhost
`;

const SERVER_EXTENSIONS = `subjectAltName = DNS:localhost,IP:127.0.0.1
basicConstraints = CA:FALSE
`;

function openssl(cwd: string, ...args: string[]) {
  execFileSync('openssl', args, { cwd, stdio: 'ignore' });
}

function makeCa(dir: string, name: string) {
  fs.writeFileSync(path.join(dir, 'ca.cnf'), CA_CONFIG);
  openssl(
    dir,
    ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes'],
    ...['-keyout', `${name}.key`, '-out', `${name}.pem`],
    ...['-days', '2', '-config', 'ca.cnf'],
  );
}

function makeServerCert(dir: string, signedBy: string) {
  fs.writeFileSync(path.join(dir, 'srv.cnf'), SERVER_CONFIG);
  fs.writeFileSync(path.join(dir, 'ext.cnf'), SERVER_EXTENSIONS);
  openssl(
    dir,
    ...['req', '-newkey', 'rsa:2048', '-nodes'],
    ...['-keyout', 'srv.key', '-out', 'srv.csr', '-config', 'srv.cnf'],
  );
  openssl(
    dir,
    ...['x509', '-req', '-in', 'srv.csr'],
    ...['-CA', `${signedBy}.pem`, '-CAkey', `${signedBy}.key`],
    ...['-CAcreateserial', '-out', 'srv.pem', '-days', '2'],
    ...['-extfile', 'ext.cnf'],
  );
}

// Build the Cluster the plugin would hand to the client, then do what the
// client does with its caData: decode it into the only trust root, or use none.
const caFor = (caData: string | undefined, mode: 'cluster-ca' | 'public') => {
  const cluster = buildCluster(
    'stack',
    { caData: caData as string, url: '' },
    mode,
  );
  return cluster.caData ? Buffer.from(cluster.caData, 'base64') : undefined;
};

describeTls('tls_trust against a real TLS server', () => {
  let dir = '';
  let server: https.Server | undefined;
  let port: number;
  let privateCa: string;
  let otherCa: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-trust-'));
    makeCa(dir, 'private');
    makeCa(dir, 'other');
    makeServerCert(dir, 'private');
    privateCa = fs.readFileSync(path.join(dir, 'private.pem'), 'utf8');
    otherCa = fs.readFileSync(path.join(dir, 'other.pem'), 'utf8');

    const created = https.createServer(
      {
        key: fs.readFileSync(path.join(dir, 'srv.key')),
        cert: fs.readFileSync(path.join(dir, 'srv.pem')),
      },
      (_req, res) => res.end('ok'),
    );
    server = created;
    await new Promise<void>(resolve => created.listen(0, '127.0.0.1', resolve));
    port = (created.address() as AddressInfo).port;
  }, 60_000);

  afterAll(async () => {
    try {
      await new Promise<void>(resolve =>
        server ? server.close(() => resolve()) : resolve(),
      );
    } finally {
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  const encode = (pem: string) => Buffer.from(pem, 'utf8').toString('base64');

  // Resolves 'ok' on a verified handshake, else the TLS error code.
  const handshake = (ca?: Buffer) =>
    new Promise<string>(resolve => {
      const req = https.get(
        { host: '127.0.0.1', port, path: '/', agent: false, ca },
        res => {
          res.resume();
          resolve('ok');
        },
      );
      req.on('error', (error: NodeJS.ErrnoException) =>
        resolve(error.code ?? error.message),
      );
    });

  // Same handshake in a fresh Node whose default trust store gains a CA through
  // NODE_EXTRA_CA_CERTS. That stands in for a public root, which a test cannot
  // otherwise obtain a certificate from.
  const handshakeWithStoreCa = (storeCa: string, ca?: Buffer) => {
    const script = `
      const https = require('https');
      const fs = require('fs');
      const ca = process.env.CA_FILE ? fs.readFileSync(process.env.CA_FILE) : undefined;
      https.get({ host: '127.0.0.1', port: ${port}, path: '/', agent: false, ca, timeout: 10000 }, res => {
        res.resume();
        console.log('ok');
      }).on('timeout', function () { this.destroy(new Error('timeout')); })
        .on('error', e => console.log(e.code || e.message));
    `;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_EXTRA_CA_CERTS: path.join(dir, storeCa),
    };
    delete env.CA_FILE;
    if (ca) {
      fs.writeFileSync(path.join(dir, 'explicit-ca.pem'), ca);
      env.CA_FILE = path.join(dir, 'explicit-ca.pem');
    }
    // Async on purpose: this process serves the TLS server the child dials.
    return new Promise<string>(resolve => {
      const child = spawn(process.execPath, ['-e', script], {
        env,
        timeout: 15_000,
      });
      let out = '';
      let err = '';
      child.stdout.on('data', chunk => {
        out += chunk;
      });
      child.stderr.on('data', chunk => {
        err += chunk;
      });
      child.on('close', () =>
        resolve(out.trim() || `no output from child: ${err.trim()}`),
      );
    });
  };

  describe('server signed by the private (cluster) CA', () => {
    it('cluster-ca with the matching CA verifies', async () => {
      const ca = caFor(encode(privateCa), 'cluster-ca');

      await expect(handshake(ca)).resolves.toBe('ok');
    });

    it('cluster-ca with a different CA is rejected', async () => {
      const ca = caFor(encode(otherCa), 'cluster-ca');

      await expect(handshake(ca)).resolves.toMatch(VERIFY_FAILURE);
    });

    it('public cannot verify a server only the private CA signed', async () => {
      const ca = caFor(encode(privateCa), 'public');

      await expect(handshake(ca)).resolves.toMatch(VERIFY_FAILURE);
    });
  });

  describe('server signed by a CA in the trust store (stand-in for public)', () => {
    it('public verifies it', async () => {
      const ca = caFor(encode(otherCa), 'public');

      await expect(handshakeWithStoreCa('private.pem', ca)).resolves.toBe('ok');
    });

    it('cluster-ca with no CA data falls back to the trust store', async () => {
      const ca = caFor(undefined, 'cluster-ca');

      await expect(handshakeWithStoreCa('private.pem', ca)).resolves.toBe('ok');
    });

    it('cluster-ca with an unrelated CA does not, so the sets are not merged', async () => {
      const ca = caFor(encode(otherCa), 'cluster-ca');

      await expect(handshakeWithStoreCa('private.pem', ca)).resolves.toMatch(
        VERIFY_FAILURE,
      );
    });
  });
});
