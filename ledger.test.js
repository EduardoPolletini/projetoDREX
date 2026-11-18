import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Ledger } from './ledger.js';

async function openLedger(context) {
  const directory = await mkdtemp(join(tmpdir(), 'drex-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const ledger = new Ledger(join(directory, 'drex.sqlite3'));
  await ledger.initialize();
  return ledger;
}

test('persiste a liquidação e replica um único bloco íntegro', async (context) => {
  const ledger = await openLedger(context);
  const receipt = await ledger.purchase('alice', 2, 'operation');
  const reopened = new Ledger(ledger.path);
  await reopened.initialize();
  assert.deepEqual(await reopened.account('alice'), { balance: 22500, units: 2, available: 98, unitPrice: 1250 });
  assert.equal((await reopened.account('bob')).units, 0);
  const { replicas, blocks } = await reopened.audit();
  assert.equal(blocks[1].previous, blocks[0].hash);
  assert.equal(blocks[1].hash, receipt.hash);
  assert.equal(replicas.length, 3);
  assert.ok(replicas.every(({ valid, height }) => valid && height === 2));
});

test('requisições concorrentes com a mesma chave não duplicam o débito', async (context) => {
  const ledger = await openLedger(context);
  const [first, second] = await Promise.all([
    ledger.purchase('alice', 2, 'operation'), ledger.purchase('alice', 2, 'operation'),
  ]);
  assert.deepEqual(first, second);
  await assert.rejects(ledger.purchase('alice', 3, 'operation'), /Identificador/);
  assert.equal((await ledger.audit()).blocks.length, 2);
});

test('rejeita quantidade, saldo e estoque inválidos sem registrar compra', async (context) => {
  const ledger = await openLedger(context);
  await assert.rejects(ledger.purchase('alice', 0, 'zero'), /Quantidade/);
  await assert.rejects(ledger.purchase('alice', 1.5, 'decimal'), /Quantidade/);
  await assert.rejects(ledger.purchase('alice', 21, 'balance'), /Saldo/);
  await Promise.all(Array.from({ length: 5 }, (_, buyer) => ledger.purchase('buyer-' + buyer, 20, 'initial')));
  await assert.rejects(ledger.purchase('alice', 1, 'stock'), /estoque/);
  assert.equal((await ledger.audit()).blocks.length, 6);
  assert.equal((await ledger.account('alice')).balance, 25000);
});
