import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = fileURLToPath(new URL('../fixtures/buggy-app/public/', import.meta.url));

/**
 * Fake secret key for planted bug #6. Built from parts at serve time so that no secret-looking
 * string is ever committed (GitHub's push protection would rightly block one).
 */
export const FAKE_SECRET_KEY = ['sk', 'live', 'FAKEshipcheckFIXTURE0000notreal1'].join('_');
/** Public-by-design key that ShipCheck must NOT flag. Committed literally in assets/app.js. */
export const FAKE_PUBLISHABLE_KEY = 'pk_test_FAKEshipcheckFIXTURE0000public1';
const SECRET_PLACEHOLDER = '__FAKE_STRIPE_SECRET_KEY__';

/** An account that already exists, for testing login with --email / --password. */
export const DEMO_ACCOUNT = { email: 'demo@example.com', password: 'CorrectHorse1!' } as const;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const MAX_BODY_BYTES = 1_000_000;

export interface FixtureHits {
  /** POSTs to /api/delete-account. Must stay 0 after any ShipCheck run (planted bug #9). */
  deleteAccount: number;
  /** POSTs to /api/checkout. Must stay 0 after any ShipCheck run (planted bug #10). */
  checkoutSubmit: number;
  /** Checkout POSTs that carried any digits in the card number field. Must stay 0. */
  cardDataReceived: number;
  signup: number;
  /** Tracking beacons received (/tracked-form.html). */
  track: number;
  login: number;
  loginFailed: number;
  contact: number;
  /** Accepted newsletter sign-ups. The form disables its button, so a double click gives 1. */
  newsletter: number;
}

export interface ContactSubmission {
  name: string;
  email: string;
  message: string;
}

export interface FixtureServer {
  /** Base URL without a trailing slash, e.g. http://127.0.0.1:54321 */
  url: string;
  port: number;
  hits: FixtureHits;
  /** Everything the contact form accepted, in order (to assert bad input got through). */
  contactSubmissions: ContactSubmission[];
  /** Every request as "METHOD /path", in order. */
  requests: string[];
  /** The User-Agent header of every request, in order. */
  userAgents: string[];
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, contentType: string, body: string | Buffer) {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return {};
    chunks.push(chunk);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Maps a URL path to a file inside the public folder, or null if it would escape it. */
export function resolvePublicPath(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
  const full = normalize(join(PUBLIC_DIR, relative));
  const root = PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep;
  return full.startsWith(root) ? full : null;
}

async function serveStatic(urlPath: string, res: ServerResponse): Promise<void> {
  const file = resolvePublicPath(urlPath);
  if (file) {
    try {
      let body: string | Buffer = await readFile(file);
      if (file.endsWith(`${sep}assets${sep}app.js`)) {
        body = body.toString('utf8').replace(SECRET_PLACEHOLDER, FAKE_SECRET_KEY);
      }
      send(res, 200, CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', body);
      return;
    } catch {
      // fall through to the 404 page
    }
  }
  const notFound = await readFile(join(PUBLIC_DIR, '404.html'));
  send(res, 404, CONTENT_TYPES['.html'] as string, notFound);
}

export interface FixtureOptions {
  /**
   * Breaks logging in: the server answers every log-in, even with the right password, with
   * 401. Used to prove that a refused log-in is still reported, although refused submissions
   * are not counted as failed background requests.
   */
  rejectAllLogins?: boolean;
  /** Sign-up is broken on the server: every attempt is answered with an error. */
  rejectAllSignups?: boolean;
}

/**
 * Starts the buggy fixture app on a random free port, bound to localhost only.
 * Each call gets its own counters and its own in-memory accounts.
 */
export async function startFixtureServer(options: FixtureOptions = {}): Promise<FixtureServer> {
  const hits: FixtureHits = {
    deleteAccount: 0,
    checkoutSubmit: 0,
    cardDataReceived: 0,
    signup: 0,
    login: 0,
    loginFailed: 0,
    contact: 0,
    newsletter: 0,
    track: 0,
  };
  const contactSubmissions: ContactSubmission[] = [];
  const requests: string[] = [];
  const userAgents: string[] = [];
  const accounts = new Map<string, string>([[DEMO_ACCOUNT.email, DEMO_ACCOUNT.password]]);

  async function handleApi(path: string, req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req);
    switch (path) {
      case '/api/signup': {
        hits.signup += 1;
        if (options.rejectAllSignups) {
          return sendJson(res, 500, {
            ok: false,
            error: 'Something went wrong. Please try again.',
          });
        }
        const email = text(body.email).trim().toLowerCase();
        const password = text(body.password);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return sendJson(res, 400, { ok: false, error: 'Please enter a valid email address.' });
        }
        if (password.length < 8) {
          return sendJson(res, 400, {
            ok: false,
            error: 'Your password needs at least 8 characters.',
          });
        }
        if (accounts.has(email)) {
          return sendJson(res, 409, {
            ok: false,
            error: 'An account with this email already exists.',
          });
        }
        accounts.set(email, password);
        return sendJson(res, 200, { ok: true });
      }
      case '/api/login': {
        hits.login += 1;
        const email = text(body.email).trim().toLowerCase();
        const valid = accounts.get(email) === text(body.password) && accounts.has(email);
        if (valid && !options.rejectAllLogins) {
          return sendJson(res, 200, { ok: true });
        }
        hits.loginFailed += 1;
        return sendJson(res, 401, { ok: false });
      }
      case '/api/contact': {
        // Planted bug #2: accepts anything.
        hits.contact += 1;
        contactSubmissions.push({
          name: text(body.name),
          email: text(body.email),
          message: text(body.message),
        });
        return sendJson(res, 200, { ok: true });
      }
      case '/api/newsletter': {
        // Works on purpose: the server validates too.
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text(body.email).trim())) {
          return sendJson(res, 400, { ok: false, error: 'Please enter a valid email address.' });
        }
        hits.newsletter += 1;
        return sendJson(res, 200, { ok: true });
      }
      case '/api/track': {
        // A tracking beacon, as on /tracked-form.html: always answered, means nothing.
        hits.track += 1;
        return sendJson(res, 202, { ok: true });
      }
      case '/api/delete-account': {
        hits.deleteAccount += 1;
        return sendJson(res, 200, { ok: true });
      }
      case '/api/checkout': {
        hits.checkoutSubmit += 1;
        if (/\d/.test(text(body.cardNumber))) hits.cardDataReceived += 1;
        return sendJson(res, 200, { ok: true });
      }
      default:
        return sendJson(res, 404, { ok: false });
    }
  }

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const method = req.method ?? 'GET';
    requests.push(`${method} ${path}`);
    userAgents.push(req.headers['user-agent'] ?? '');

    const work =
      path.startsWith('/api/') && method === 'POST'
        ? handleApi(path, req, res)
        : method === 'GET' || method === 'HEAD'
          ? serveStatic(path, res)
          : Promise.resolve(sendJson(res, 405, { ok: false }));

    work.catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    hits,
    contactSubmissions,
    requests,
    userAgents,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
