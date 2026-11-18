const byId = (id) => document.getElementById(id);
const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const params = new URLSearchParams(location.search);
let callback = params.has('state') && params.has('code') ? Object.fromEntries(params) : null;
if (location.search) history.replaceState(null, '', '/');
let account;

async function api(path, method = 'GET', data) {
  const response = await fetch('/api/' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + (sessionStorage.getItem('drexToken') ?? ''),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function notice(message, error = false) {
  byId('feedback').textContent = message;
  byId('feedback').dataset.error = error;
  byId('feedback').hidden = !message;
}

function showConsent() {
  const consent = account.consent;
  const status = consent && consent.status !== 'REVOGADO' && Date.now() >= consent.expiresAt ? 'EXPIRADO' : consent?.status;
  const labels = {
    SOLICITADO: 'Aguardando autenticação no banco.',
    AUTENTICADO: 'Identidade validada. Falta confirmar o compartilhamento.',
    CONFIRMADO: 'Compartilhamento confirmado.',
    REVOGADO: 'Acesso revogado.',
    EXPIRADO: 'Consentimento expirado.',
  };
  byId('consentStatus').textContent = (labels[status] ?? 'Nenhum consentimento ativo.') +
    (status === 'CONFIRMADO' ? ' Válido até ' + new Date(consent.expiresAt).toLocaleTimeString('pt-BR') + '.' : '');
  const canConfirm = callback && status === 'AUTENTICADO';
  byId('confirmActions').hidden = !canConfirm;
  byId('consent').hidden = canConfirm || status === 'CONFIRMADO';
  byId('consentActions').hidden = status !== 'CONFIRMADO';
  if (status !== 'CONFIRMADO') {
    byId('bankData').hidden = true;
    byId('bankData').textContent = '';
  }
}

function total() {
  if (!account) return;
  byId('total').textContent = 'Total da compra: ' + money(Number(byId('quantity').value) * account.unitPrice);
}

async function refresh() {
  let ledger;
  [account, ledger] = await Promise.all([api('account'), api('ledger')]);
  byId('balance').textContent = money(account.balance);
  byId('units').textContent = account.units;
  byId('available').textContent = account.available;
  byId('price').textContent = money(account.unitPrice);
  byId('replicas').textContent = ledger.replicas.map((replica) =>
    'Nó ' + replica.node + ' · ' + (replica.valid ? 'íntegro' : 'divergente') + ' · ' + replica.height + ' bloco(s)').join('  |  ');
  byId('blocks').replaceChildren(...ledger.blocks.toReversed().map((block) => {
    const row = document.createElement('tr');
    for (const value of [block.height, block.event, block.owner, block.units, block.amount ? money(block.amount) : '—']) {
      row.insertCell().textContent = value;
    }
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = block.hash.slice(0, 10);
    const previous = document.createElement('div');
    previous.textContent = 'Anterior: ' + block.previous;
    details.append(summary, block.hash, previous);
    row.insertCell().append(details);
    return row;
  }));
  showConsent();
  total();
}

function action(element, event, run) {
  element.addEventListener(event, async (e) => {
    e.preventDefault();
    const button = event === 'submit' ? element.querySelector('button') : element;
    button.disabled = true;
    notice('');
    try { await run(); }
    catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  });
}

let purchaseAttempt;
action(byId('purchase'), 'submit', async () => {
  const units = Number(byId('quantity').value);
  if (purchaseAttempt?.units !== units) purchaseAttempt = { units, operationId: crypto.randomUUID() };
  const receipt = await api('purchases', 'POST', purchaseAttempt);
  purchaseAttempt = undefined;
  notice('Compra liquidada no bloco ' + receipt.height + '.');
  await refresh();
});
byId('quantity').addEventListener('input', total);
action(byId('consent'), 'submit', async () => {
  const result = await api('consent', 'POST', { minutes: Number(byId('minutes').value) });
  location.assign(result.bankUrl);
});
action(byId('confirm'), 'click', async () => {
  await api('consent/confirm', 'POST', callback);
  callback = null;
  await refresh();
  notice('Compartilhamento confirmado.');
});
async function revoke() {
  await api('consent', 'DELETE');
  callback = null;
  await refresh();
  notice('Acesso aos dados encerrado.');
}
action(byId('cancel'), 'click', revoke);
action(byId('revoke'), 'click', revoke);
action(byId('query'), 'click', async () => {
  const data = await api('bank/data');
  byId('bankData').textContent = data.institution + ' · Saldo: ' + money(data.balance);
  byId('bankData').hidden = false;
});

try {
  try { await refresh(); }
  catch (error) {
    if (error.status !== 401) throw error;
    callback = null;
    const { token } = await api('session', 'POST');
    sessionStorage.setItem('drexToken', token);
    await refresh();
  }
  document.querySelectorAll('main form button').forEach((button) => { button.disabled = false; });
  setInterval(() => showConsent(), 1000);
} catch (error) {
  notice(error.message, true);
}
