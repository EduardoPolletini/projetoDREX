import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ledger } from './ledger.js';

test('liquida as duas pernas e replica um único bloco íntegro', () => {
  const ledger = new Ledger();
  const receipt = ledger.purchase('alice', 2, 'operation');
  assert.deepEqual(ledger.account('alice'), { balance: 22500, units: 2, available: 98, unitPrice: 1250 });
  assert.equal(ledger.account('bob').units, 0);
  const { replicas, blocks } = ledger.audit();
  assert.equal(blocks[1].previous, blocks[0].hash);
  assert.equal(blocks[1].hash, receipt.hash);
  assert.equal(replicas.length, 3);
  assert.ok(replicas.every(({ valid, height }) => valid && height === 2));
});

test('repetição da operação não duplica o débito', () => {
  const ledger = new Ledger();
  const receipt = ledger.purchase('alice', 2, 'operation');
  assert.deepEqual(ledger.purchase('alice', 2, 'operation'), receipt);
  assert.throws(() => ledger.purchase('alice', 3, 'operation'), /Identificador/);
  assert.equal(ledger.audit().blocks.length, 2);
});

test('rejeita quantidade, saldo e estoque inválidos sem registrar compra', () => {
  const ledger = new Ledger();
  assert.throws(() => ledger.purchase('alice', 0, 'zero'), /Quantidade/);
  assert.throws(() => ledger.purchase('alice', 1.5, 'decimal'), /Quantidade/);
  assert.throws(() => ledger.purchase('alice', 21, 'balance'), /Saldo/);
  for (let buyer = 0; buyer < 5; buyer++) ledger.purchase('buyer-' + buyer, 20, 'initial');
  assert.throws(() => ledger.purchase('alice', 1, 'stock'), /estoque/);
  assert.equal(ledger.audit().blocks.length, 6);
  assert.equal(ledger.account('alice').balance, 25000);
});
