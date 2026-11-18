// Guarda apenas o estado fictício da aba, inclusive durante a ida ao banco.
const key = 'drex-pages-v1';
const price = 1250;
const genesis = '0'.repeat(64);
let pending = Promise.resolve();

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Encadeia cada bloco ao anterior e registra a operação nas três cópias.
async function append(replicas, fields) {
  const chain = replicas[0];
  const block = {
    height: chain.length,
    previous: chain.at(-1)?.hash ?? genesis,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  block.hash = await digest(block);
  for (const replica of replicas) replica.push({ ...block });
  return block;
}

function wallet(chain) {
  const purchases = chain.slice(1);
  const units = purchases.reduce((sum, block) => sum + block.units, 0);
  return {
    balance: 25000 - purchases.reduce((sum, block) => sum + block.amount, 0),
    units, available: chain[0].units - units, unitPrice: price,
  };
}

function consentView(consent) {
  if (!consent) return null;
  const { status, expiresAt } = consent;
  return { status: status !== 'REVOGADO' && expiresAt <= Date.now() ? 'EXPIRADO' : status, expiresAt };
}

function activeConsent(consent) {
  const status = consentView(consent)?.status;
  if (!status || status === 'EXPIRADO' || status === 'REVOGADO') fail(403, 'Solicite um novo consentimento.');
  return consent;
}

async function audit(replicas) {
  const reference = JSON.stringify(replicas[0]);
  return {
    replicas: await Promise.all(replicas.map(async (chain, index) => {
      let valid = JSON.stringify(chain) === reference && chain.length > 0;
      let previous = genesis;
      for (const [height, { hash, ...block }] of chain.entries()) {
        valid = valid && block.height === height && block.previous === previous && hash === await digest(block);
        previous = hash;
      }
      return { node: index + 1, height: chain.length, valid };
    })),
    blocks: replicas[0],
  };
}

async function handle(path, method, data) {
  const route = method + ' ' + path;
  if (route === 'POST session') {
    const session = { consent: null, replicas: [[], [], []] };
    await append(session.replicas, { event: 'EMISSÃO', owner: 'Emissor', units: 100 });
    sessionStorage.setItem(key, JSON.stringify(session));
    return { token: 'demonstracao-pages' };
  }

  const session = JSON.parse(sessionStorage.getItem(key));
  if (!session) fail(401, 'Inicie uma sessão de demonstração.');
  switch (route) {
    case 'GET account':
      return { ...wallet(session.replicas[0]), consent: consentView(session.consent) };
    case 'POST consent': {
      if (![5, 15, 30].includes(data.minutes)) fail(400, 'Escolha um prazo disponível.');
      const state = crypto.randomUUID();
      session.consent = { status: 'SOLICITADO', expiresAt: Date.now() + data.minutes * 60000, state };
      sessionStorage.setItem(key, JSON.stringify(session));
      return { bankUrl: './bank.html?state=' + state };
    }
    case 'POST bank/authorize': {
      const consent = activeConsent(session.consent);
      if (consent.status !== 'SOLICITADO' || consent.state !== data.state) fail(409, 'Redirecionamento inválido ou já utilizado.');
      if (data.pin !== '246810') fail(400, 'Código de demonstração incorreto.');
      consent.status = 'AUTENTICADO';
      consent.code = crypto.randomUUID();
      sessionStorage.setItem(key, JSON.stringify(session));
      return { returnUrl: './?state=' + consent.state + '&code=' + consent.code };
    }
    case 'POST consent/confirm': {
      const consent = activeConsent(session.consent);
      if (consent.status !== 'AUTENTICADO' || consent.state !== data.state || consent.code !== data.code) {
        fail(409, 'Confirmação inválida ou já utilizada.');
      }
      session.consent = { status: 'CONFIRMADO', expiresAt: consent.expiresAt };
      sessionStorage.setItem(key, JSON.stringify(session));
      return consentView(session.consent);
    }
    case 'DELETE consent':
      if (!session.consent) fail(404, 'Consentimento inexistente.');
      session.consent = { status: 'REVOGADO', expiresAt: session.consent.expiresAt };
      sessionStorage.setItem(key, JSON.stringify(session));
      return consentView(session.consent);
    case 'GET bank/data':
      if (activeConsent(session.consent).status !== 'CONFIRMADO') fail(403, 'Confirme o consentimento para consultar os dados.');
      return { institution: 'Banco Horizonte (simulado)', balance: 50000 };
    case 'POST purchases': {
      const { units, operationId } = data;
      const chain = session.replicas[0];
      const existing = chain.find((block) => block.operationId === operationId);
      if (existing) {
        if (existing.units !== units) fail(409, 'Identificador já usado para outra quantidade.');
        return existing;
      }
      const account = wallet(chain);
      if (!Number.isSafeInteger(units) || units < 1 || units > account.available) {
        fail(409, 'Quantidade inválida ou estoque insuficiente.');
      }
      if (units * price > account.balance) fail(409, 'Saldo DREX insuficiente.');
      const receipt = await append(session.replicas, {
        event: 'LIQUIDAÇÃO', owner: 'Sua carteira', units, amount: units * price, operationId,
      });
      sessionStorage.setItem(key, JSON.stringify(session));
      return receipt;
    }
    case 'GET ledger':
      return audit(session.replicas);
    default:
      fail(404, 'Recurso indisponível.');
  }
}

// Ordena operações na mesma aba para evitar gravar um estado antigo.
export function simulate(path, method, data) {
  const operation = pending.then(() => handle(path, method, data));
  pending = operation.catch(() => {});
  return operation;
}
