const { MongoClient, ObjectId } = require('mongodb');
require('./env');

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI não definido. Copie .env.example para .env e preencha.');
  process.exit(1);
}

// O MongoClient mantém um pool de conexões (maxPoolSize) reaproveitado por toda a API
const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 10 });
const db = client.db(process.env.MONGODB_DB || 'financas');

/** Atalho para uma coleção do banco. */
const colecao = (nome) => db.collection(nome);

/**
 * Executa `fn(session)` dentro de uma transação: tudo é gravado ou nada é.
 * Toda operação dentro de `fn` precisa receber `{ session }`.
 */
async function transacao(fn) {
  const session = client.startSession();
  try {
    let resultado;
    await session.withTransaction(async () => {
      resultado = await fn(session);
    });
    return resultado;
  } finally {
    await session.endSession();
  }
}

/** Converte texto em ObjectId; devolve null se não for um id válido (24 caracteres hexadecimais). */
function paraId(valor) {
  if (valor instanceof ObjectId) return valor;
  return typeof valor === 'string' && /^[0-9a-f]{24}$/i.test(valor) ? new ObjectId(valor) : null;
}

module.exports = { client, db, colecao, transacao, paraId, ObjectId };
