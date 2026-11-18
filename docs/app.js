import { api, isPages } from './api.js';

// Obtém os campos da interface e formata valores em reais.
const byId = (id) => document.getElementById(id);
const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// Lê os parâmetros do retorno bancário e limpa a URL.
const params = new URLSearchParams(location.search);
let callback = params.has('state') && params.has('code') ? Object.fromEntries(params) : null;
if (location.search) history.replaceState(null, '', location.pathname + (callback ? '#open-finance' : location.hash));
let account;
if (isPages) byId('environment').textContent = 'Demonstração no navegador';
else {
  byId('technicalLink').hidden = false;
  byId('technical').hidden = false;
}

function notice(message, error = false) {
  byId('feedback').textContent = message;
  byId('feedback').dataset.error = error;
  byId('feedback').hidden = !message;
}

// Exibe a tela correspondente ao link e mantém o histórico do navegador.
const screens = [...document.querySelectorAll('.screen')];
function showScreen(moveFocus = false) {
  const hash = location.hash.slice(1);
  const target = byId(hash);
  const screen = target?.closest('.screen') ?? byId('open-finance');
  const changed = screen.hidden;
  for (const item of screens) item.hidden = item !== screen;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === screen.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (moveFocus && changed) {
    notice('');
    screen.querySelector('h1').focus({ preventScroll: true });
  }
  if (hash && !target?.hidden) target?.scrollIntoView();
  else if (moveFocus && changed) window.scrollTo(0, 0);
}
showScreen();
window.addEventListener('hashchange', () => showScreen(true));

// Atualiza os botões e limpa o saldo compartilhado quando o acesso termina.
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

// Consulta a carteira e o livro-razão e atualiza a tela.
async function refresh() {
  let ledger;
  [account, ledger] = await Promise.all([api('account'), api('ledger')]);
  byId('balance').textContent = money(account.balance);
  byId('units').textContent = account.units;
  byId('available').textContent = account.available;
  byId('price').textContent = money(account.unitPrice);
  byId('replicas').replaceChildren(...ledger.replicas.map((replica) => {
    const item = document.createElement('span');
    item.dataset.valid = replica.valid;
    item.textContent = 'Nó ' + replica.node + ' · ' + (replica.valid ? 'íntegro' : 'divergente') + ' · ' + replica.height + ' bloco(s)';
    return item;
  }));
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

// Desabilita o botão durante a operação e exibe erros.
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

// Mostra o retorno da última compra e omite identificadores internos e credenciais.
function showTrace(request, { receipt, error } = {}) {
  if (isPages) return;
  const title = byId('traceTitle');
  const summary = byId('traceSummary');
  const response = byId('traceResponse');
  byId('traceRequest').textContent = JSON.stringify(request, null, 2);
  byId('traceLink').hidden = false;
  byId('traceData').hidden = false;
  summary.hidden = !receipt;

  if (receipt) {
    const { height, event, units, amount, previous, hash } = receipt;
    title.textContent = 'Liquidação confirmada · Bloco ' + height;
    summary.textContent = money(amount) + ' debitados da carteira DREX · ' + units + ' fração(ões) transferida(s).';
    byId('traceResponseTitle').textContent = 'HTTP 200 · Recorte do recibo';
    response.textContent = JSON.stringify({ height, event, units, amount, previous, hash }, null, 2);
  } else if (error) {
    title.textContent = error.status === 409 ? 'Compra recusada' : 'Compra sem confirmação';
    byId('traceResponseTitle').textContent = error.status ? 'HTTP ' + error.status : 'Falha na comunicação';
    response.textContent = JSON.stringify({ error: error.message }, null, 2);
  } else {
    title.textContent = 'Enviando compra…';
    byId('traceResponseTitle').textContent = 'Retorno';
    response.textContent = 'Aguardando resposta da API.';
  }
}

// Reutiliza o identificador ao repetir uma tentativa de compra.
let purchaseAttempt;
action(byId('purchase'), 'submit', async () => {
  const units = Number(byId('quantity').value);
  if (purchaseAttempt?.units !== units) purchaseAttempt = { units, operationId: crypto.randomUUID() };
  showTrace(purchaseAttempt);
  let receipt;
  try {
    receipt = await api('purchases', 'POST', purchaseAttempt);
  } catch (error) {
    showTrace(purchaseAttempt, { error });
    throw error;
  }
  showTrace(purchaseAttempt, { receipt });
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
