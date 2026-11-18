import { createServer as http } from 'node:http';
import { createServer as https } from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Ledger } from './ledger.js';

const ledger = new Ledger();
await ledger.initialize();

const keyPath = ledger.path + '.key';
try {
  writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
const secret = readFileSync(keyPath);
if (secret.length !== 32) throw new Error('Chave JWT local inválida.');
const dataKey = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
const bankData = Buffer.concat([cipher.update(JSON.stringify({ institution: 'Banco Horizonte (simulado)', balance: 50000 }), 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
const sessions = new Map();
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/banco', ['bank.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/bank.js', ['bank.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
].map(([url, [name, type]]) => [url, [readFileSync(new URL('./public/' + name, import.meta.url)), type]]));

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (input) => createHmac('sha256', secret).update(input).digest('base64url');
function login() {
  const now = Math.floor(Date.now() / 1000);
  for (const [id, session] of sessions) if (session.exp <= now) sessions.delete(id);
  const sub = randomUUID();
  const exp = now + 3600;
  sessions.set(sub, { exp, consent: null });
  const input = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub, exp, iss: 'drex-lab', aud: 'drex-api' });
  return input + '.' + sign(input);
}

function authenticate(request) {
  const token = request.headers.authorization?.match(/^Bearer ([\w.-]+)$/)?.[1];
  const parts = token?.split('.');
  if (parts?.length !== 3) throw failure(401, 'Inicie uma sessão de demonstração.');
  const [header, payload, signature] = parts;
  const expected = Buffer.from(sign(header + '.' + payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw failure(401, 'Sessão inválida.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  if (claims.exp <= Date.now() / 1000 || claims.iss !== 'drex-lab' || claims.aud !== 'drex-api') {
    throw failure(401, 'Sessão expirada. Inicie uma nova demonstração.');
  }
  let session = sessions.get(claims.sub);
  if (!session) {
    session = { exp: claims.exp, consent: null };
    sessions.set(claims.sub, session);
  }
  return { owner: claims.sub, session };
}

const failure = (status, message) => Object.assign(new Error(message), { status });
function reply(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw failure(415, 'Envie JSON.');
  let input = '';
  for await (const chunk of request) {
    input += chunk;
    if (input.length > 4096) throw failure(413, 'Requisição grande demais.');
  }
  try {
    const data = JSON.parse(input);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw failure(400, 'Objeto JSON inválido.');
  }
}

function activeConsent(session) {
  const consent = session.consent;
  if (!consent || consent.expiresAt <= Date.now() || consent.status === 'REVOGADO') {
    throw failure(403, 'Solicite um novo consentimento.');
  }
  return consent;
}
const consentView = (consent) => consent && ({
  status: consent.expiresAt <= Date.now() && consent.status !== 'REVOGADO' ? 'EXPIRADO' : consent.status,
  expiresAt: consent.expiresAt,
});

async function handle(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const { pathname } = new URL(request.url, 'http://localhost');
    const route = request.method + ' ' + pathname;
    if (request.method === 'GET' && files.has(pathname)) {
      const [content, type] = files.get(pathname);
      response.writeHead(200, { 'Content-Type': type });
      return response.end(content);
    }
    if (route === 'POST /api/session') return reply(response, 201, { token: login() });
    if (!pathname.startsWith('/api/')) throw failure(404, 'Página indisponível.');
    const { owner, session } = authenticate(request);
    const data = request.method === 'POST' ? await body(request) : {};
    switch (route) {
      case 'GET /api/account':
        return reply(response, 200, { ...await ledger.account(owner), consent: consentView(session.consent) });
      case 'POST /api/consent': {
        if (![5, 15, 30].includes(data.minutes)) throw failure(400, 'Escolha um prazo disponível.');
        session.consent = { status: 'SOLICITADO', expiresAt: Date.now() + data.minutes * 60000, state: randomUUID() };
        return reply(response, 201, { bankUrl: '/banco?state=' + session.consent.state });
      }
      case 'POST /api/bank/authorize': {
        const consent = activeConsent(session);
        if (consent.status !== 'SOLICITADO' || consent.state !== data.state) throw failure(409, 'Redirecionamento inválido ou já utilizado.');
        if (data.pin !== '246810') throw failure(400, 'Código de demonstração incorreto.');
        consent.status = 'AUTENTICADO';
        consent.code = randomUUID();
        return reply(response, 200, { returnUrl: '/?state=' + consent.state + '&code=' + consent.code });
      }
      case 'POST /api/consent/confirm': {
        const consent = activeConsent(session);
        if (consent.status !== 'AUTENTICADO' || data.state !== consent.state || data.code !== consent.code) {
          throw failure(409, 'Confirmação inválida ou já utilizada.');
        }
        session.consent = { status: 'CONFIRMADO', expiresAt: consent.expiresAt };
        return reply(response, 200, consentView(session.consent));
      }
      case 'DELETE /api/consent':
        if (!session.consent) throw failure(404, 'Consentimento inexistente.');
        session.consent = { status: 'REVOGADO', expiresAt: session.consent.expiresAt };
        return reply(response, 200, consentView(session.consent));
      case 'GET /api/bank/data': {
        if (activeConsent(session).status !== 'CONFIRMADO') throw failure(403, 'Confirme o consentimento para consultar os dados.');
        const decipher = createDecipheriv('aes-256-gcm', dataKey, iv);
        decipher.setAuthTag(tag);
        return reply(response, 200, JSON.parse(Buffer.concat([decipher.update(bankData), decipher.final()])));
      }
      case 'POST /api/purchases': {
        if (typeof data.operationId !== 'string' || !/^[a-z0-9-]{36}$/i.test(data.operationId)) throw failure(400, 'Identificador de operação inválido.');
        const transaction = await ledger.purchase(owner, data.units, data.operationId);
        return reply(response, 200, transaction);
      }
      case 'GET /api/ledger': {
        const { replicas, blocks } = await ledger.audit();
        return reply(response, 200, {
          replicas,
          blocks: blocks.map(({ owner: holder, operationId, ...block }) => ({
            ...block, owner: holder === owner ? 'Sua carteira' : holder === 'EMISSOR-DEMO' ? 'Emissor' : 'Carteira de demonstração',
          })),
        });
      }
      default: throw failure(404, 'Recurso indisponível.');
    }
  } catch (error) {
    if (!error.status) console.error(error);
    reply(response, error.status ?? 500, { error: error.status ? error.message : 'Falha interna.' });
  }
}

const { TLS_KEY, TLS_CERT, PORT = 3000, HOST = '127.0.0.1' } = process.env;
if (Boolean(TLS_KEY) !== Boolean(TLS_CERT)) throw new Error('Configure TLS_KEY e TLS_CERT juntos.');
const server = TLS_KEY ? https({ key: readFileSync(TLS_KEY), cert: readFileSync(TLS_CERT) }, handle) : http(handle);
server.listen(Number(PORT), HOST, () => console.log(`DREX Lab disponível em ${TLS_KEY ? 'https' : 'http'}://${HOST}:${server.address().port}`));
