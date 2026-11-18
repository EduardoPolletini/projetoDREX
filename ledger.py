"""Regras de tokenização e armazenamento local das réplicas."""
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone

UNIT_PRICE = 1250
INITIAL_BALANCE = 25000
ISSUED_UNITS = 100
GENESIS = "0" * 64
NODES = (1, 2, 3)


class PurchaseError(Exception):
    pass


# Ordena as chaves para obter o mesmo hash ao reler um bloco.
def serialize(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def digest(value):
    return hashlib.sha256(serialize(value).encode()).hexdigest()


def read_chain(db, node):
    rows = db.execute("SELECT block FROM blocks WHERE node = ? ORDER BY height", (node,))
    return [json.loads(row[0]) for row in rows]


# Adiciona o bloco encadeado às três réplicas.
def append(db, chain, transaction):
    block = {
        "height": len(chain),
        "previous": chain[-1]["hash"] if chain else GENESIS,
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        **transaction,
    }
    block["hash"] = digest(block)
    db.executemany(
        "INSERT INTO blocks (node, height, block) VALUES (?, ?, ?)",
        [(node, block["height"], serialize(block)) for node in NODES],
    )
    return block


# Calcula carteira e estoque a partir das compras registradas.
def account(chain, owner):
    purchases = [block for block in chain if block["event"] == "LIQUIDAÇÃO"]
    mine = [block for block in purchases if block["owner"] == owner]
    return {
        "balance": INITIAL_BALANCE - sum(block["amount"] for block in mine),
        "units": sum(block["units"] for block in mine),
        "available": chain[0]["units"] - sum(block["units"] for block in purchases),
        "unitPrice": UNIT_PRICE,
    }


# Valida saldo, estoque e repetição antes de liquidar.
def purchase(db, chain, owner, units, operation_id):
    if type(units) is not int or units < 1:
        raise PurchaseError("Quantidade inválida ou estoque insuficiente.")
    for block in chain:
        if block["owner"] == owner and block.get("operationId") == operation_id:
            if block["units"] != units:
                raise PurchaseError("Identificador já usado para outra quantidade.")
            return block

    wallet = account(chain, owner)
    if units > wallet["available"]:
        raise PurchaseError("Quantidade inválida ou estoque insuficiente.")
    amount = units * UNIT_PRICE
    if amount > wallet["balance"]:
        raise PurchaseError("Saldo DREX insuficiente.")

    return append(db, chain, {
        "event": "LIQUIDAÇÃO", "owner": owner, "units": units,
        "amount": amount, "operationId": operation_id,
    })


# Confere o hash de cada bloco e a ligação com o anterior.
def valid_chain(chain):
    previous = GENESIS
    for height, block in enumerate(chain):
        payload = {key: value for key, value in block.items() if key != "hash"}
        if block["height"] != height or block["previous"] != previous or block["hash"] != digest(payload):
            return False
        previous = block["hash"]
    return bool(chain)


def run(db, action, args):
    if action == "initialize":
        db.execute("""
            CREATE TABLE IF NOT EXISTS blocks (
                node INTEGER NOT NULL CHECK (node BETWEEN 1 AND 3),
                height INTEGER NOT NULL CHECK (height >= 0),
                block TEXT NOT NULL,
                PRIMARY KEY (node, height)
            )
        """)
        if db.execute("SELECT 1 FROM blocks LIMIT 1").fetchone() is None:
            append(db, [], {"event": "EMISSÃO", "units": ISSUED_UNITS, "owner": "EMISSOR-DEMO"})
        return None

    chain = read_chain(db, 1)
    if action == "account":
        return account(chain, args["owner"])
    if action == "purchase":
        return purchase(db, chain, args["owner"], args["units"], args["operationId"])
    if action == "audit":
        replicas = []
        for node in NODES:
            replica = read_chain(db, node)
            replicas.append({"node": node, "height": len(replica), "valid": replica == chain and valid_chain(replica)})
        return {"replicas": replicas, "blocks": chain}
    raise ValueError("Operação desconhecida")


def main():
    path, action, payload = sys.argv[1:]
    db = sqlite3.connect(path, timeout=5)
    try:
        with db:
            # Reserva a escrita antes de consultar saldo e estoque.
            db.execute("BEGIN IMMEDIATE" if action in ("initialize", "purchase") else "BEGIN")
            result = run(db, action, json.loads(payload))
        print(serialize({"data": result}))
    except PurchaseError as error:
        print(serialize({"error": str(error)}))
    finally:
        db.close()


if __name__ == "__main__":
    main()
