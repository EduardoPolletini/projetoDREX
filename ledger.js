import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./ledger.py', import.meta.url));

export class Ledger {
  constructor(path = process.env.DREX_DB || 'data/drex.sqlite3') {
    this.path = resolve(path);
  }

  // Executa o Python sem bloquear o servidor e lê a resposta JSON.
  async #execute(action, args = {}) {
    const { stdout } = await run(process.env.PYTHON || 'python', [
      script, this.path, action, JSON.stringify(args),
    ], { timeout: 10000 });
    const result = JSON.parse(stdout);
    if (result.error) throw Object.assign(new Error(result.error), { status: 409 });
    return result.data;
  }

  // Cria a pasta de dados e prepara o SQLite.
  async initialize() {
    await mkdir(dirname(this.path), { recursive: true });
    await this.#execute('initialize');
  }

  account(owner) {
    return this.#execute('account', { owner });
  }

  purchase(owner, units, operationId) {
    return this.#execute('purchase', { owner, units: units ?? null, operationId });
  }

  audit() {
    return this.#execute('audit');
  }
}
