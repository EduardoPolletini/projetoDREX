import { createHash } from 'node:crypto';

export const unitPrice = 1250;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class Ledger {
  #nodes = [[], [], []];

  constructor() {
    this.#append({ event: 'EMISSÃO', units: 100, owner: 'EMISSOR-DEMO' });
  }

  #append(transaction) {
    const chain = this.#nodes[0];
    const block = {
      height: chain.length,
      previous: chain.at(-1)?.hash ?? '0'.repeat(64),
      timestamp: new Date().toISOString(),
      ...transaction,
    };
    block.hash = digest(block);
    for (const node of this.#nodes) node.push(structuredClone(block));
    return structuredClone(block);
  }

  account(owner) {
    const purchases = this.#nodes[0].filter((block) => block.event === 'LIQUIDAÇÃO');
    const mine = purchases.filter((block) => block.owner === owner);
    return {
      balance: 25000 - mine.reduce((total, block) => total + block.amount, 0),
      units: mine.reduce((total, block) => total + block.units, 0),
      available: 100 - purchases.reduce((total, block) => total + block.units, 0),
      unitPrice,
    };
  }

  purchase(owner, units, operationId) {
    const previous = this.#nodes[0].find((block) => block.owner === owner && block.operationId === operationId);
    if (previous) {
      if (previous.units !== units) throw new Error('Identificador já usado para outra quantidade.');
      return structuredClone(previous);
    }
    const account = this.account(owner);
    if (!Number.isSafeInteger(units) || units < 1 || units > account.available) {
      throw new Error('Quantidade inválida ou estoque insuficiente.');
    }
    const amount = units * unitPrice;
    if (amount > account.balance) throw new Error('Saldo DREX insuficiente.');
    // Um evento representa as duas pernas da liquidação.
    return this.#append({ event: 'LIQUIDAÇÃO', owner, units, amount, operationId });
  }

  audit() {
    const reference = digest(this.#nodes[0]);
    const replicas = this.#nodes.map((chain, index) => ({
      node: index + 1,
      height: chain.length,
      valid: digest(chain) === reference && chain.every(({ hash, ...block }, position) =>
        hash === digest(block) && block.previous === (chain[position - 1]?.hash ?? '0'.repeat(64))),
    }));
    return { replicas, blocks: structuredClone(this.#nodes[0]) };
  }
}
