/**
 * Cria (ou recria) as coleções do MongoDB com:
 *  - validadores $jsonSchema (equivalentes a NOT NULL / CHECK / tipos do SQL);
 *  - índices únicos (equivalentes a UNIQUE) e índices de consulta.
 * Relacionamentos são referências ObjectId (usuarioId, categoriaId, fonteDestinoId),
 * validadas na API (o MongoDB não tem chave estrangeira).
 *
 * Uso: npm run db:criar      ATENÇÃO: apaga as coleções e todos os dados.
 */
const { client, db } = require('../src/config/db');

const DATA = { bsonType: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }; // 'AAAA-MM-DD'
const DIA = { bsonType: 'int', minimum: 1, maximum: 31 };

const COLECOES = {
  usuarios: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['nome', 'email', 'cpf', 'senhaHash', 'criadoEm'],
        properties: {
          nome: { bsonType: 'string', minLength: 1, maxLength: 120 },
          email: { bsonType: 'string', maxLength: 160 },
          cpf: { bsonType: 'string', pattern: '^[0-9]{11}$' }, // só dígitos
          senhaHash: { bsonType: 'string' },
          criadoEm: { bsonType: 'date' },
        },
      },
      $expr: { $eq: ['$email', { $toLower: '$email' }] }, // e-mail gravado em minúsculas
    },
    indices: [
      [{ email: 1 }, { unique: true, name: 'usuarios_email_uk' }],
      [{ cpf: 1 }, { unique: true, name: 'usuarios_cpf_uk' }],
    ],
  },

  categorias: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['usuarioId', 'nome', 'tipo'],
        properties: {
          usuarioId: { bsonType: 'objectId' },
          nome: { bsonType: 'string', minLength: 1, maxLength: 60 },
          tipo: { enum: ['entrada', 'saida'] },
        },
      },
    },
    indices: [[{ usuarioId: 1, nome: 1, tipo: 1 }, { unique: true, name: 'categorias_nome_uk' }]],
  },

  fontesDestinos: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['usuarioId', 'nome', 'tipo', 'reserva'],
        properties: {
          usuarioId: { bsonType: 'objectId' },
          nome: { bsonType: 'string', minLength: 1, maxLength: 60 },
          tipo: { enum: ['renda', 'conta', 'cartao_credito'] },
          diaFechamento: { bsonType: ['int', 'null'], minimum: 1, maximum: 31 },
          diaVencimento: { bsonType: ['int', 'null'], minimum: 1, maximum: 31 },
          limiteCentavos: { bsonType: ['int', 'null'], minimum: 0 },
          reserva: { bsonType: 'bool' },
        },
        // cartão de crédito exige dia de fechamento, dia de vencimento e limite
        anyOf: [
          { properties: { tipo: { enum: ['renda', 'conta'] } } },
          {
            properties: { tipo: { enum: ['cartao_credito'] }, diaFechamento: DIA, diaVencimento: DIA, limiteCentavos: { bsonType: 'int', minimum: 0 } },
            required: ['diaFechamento', 'diaVencimento', 'limiteCentavos'],
          },
        ],
      },
    },
    indices: [[{ usuarioId: 1, nome: 1 }, { unique: true, name: 'fontes_destinos_nome_uk' }]],
  },

  lancamentos: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: [
          'usuarioId', 'tipo', 'descricao', 'valorCentavos', 'data', 'dataCompra',
          'categoriaId', 'fonteDestinoId', 'parcelaAtual', 'totalParcelas',
        ],
        properties: {
          usuarioId: { bsonType: 'objectId' },
          tipo: { enum: ['entrada', 'saida'] },
          descricao: { bsonType: 'string', minLength: 1, maxLength: 120 },
          valorCentavos: { bsonType: 'int', minimum: 1 }, // dinheiro em centavos inteiros: nunca float
          data: DATA,
          dataCompra: DATA,
          categoriaId: { bsonType: 'objectId' },
          fonteDestinoId: { bsonType: 'objectId' },
          parcelaAtual: { bsonType: 'int', minimum: 1, maximum: 48 },
          totalParcelas: { bsonType: 'int', minimum: 1, maximum: 48 },
          grupoParcelamento: { bsonType: ['string', 'null'] },
          criadoEm: { bsonType: 'date' },
        },
      },
      $expr: { $lte: ['$parcelaAtual', '$totalParcelas'] },
    },
    indices: [
      [{ usuarioId: 1, data: 1 }, { name: 'lancamentos_usuario_data' }],
      [{ categoriaId: 1 }, { name: 'lancamentos_categoria' }],
      [{ fonteDestinoId: 1 }, { name: 'lancamentos_fonte_destino' }],
      [{ grupoParcelamento: 1 }, { name: 'lancamentos_grupo', sparse: true }],
    ],
  },
};

async function main() {
  const existentes = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const [nome, def] of Object.entries(COLECOES)) {
    if (existentes.has(nome)) await db.collection(nome).drop();
    await db.createCollection(nome, { validator: def.validator, validationLevel: 'strict', validationAction: 'error' });
    for (const [chaves, opcoes] of def.indices) await db.collection(nome).createIndex(chaves, opcoes);
    console.log(`coleção ${nome}: criada com validação e ${def.indices.length} índice(s)`);
  }
  console.log(`Banco "${db.databaseName}" criado com sucesso.`);
}

main()
  .catch((e) => {
    console.error('Falha ao criar o banco:', e.message);
    process.exitCode = 1;
  })
  .finally(() => client.close());
