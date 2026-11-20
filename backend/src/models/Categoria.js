const { colecao } = require('../config/db');

const categorias = () => colecao('categorias');
const lancamentos = () => colecao('lancamentos');

const PADRAO = [
  ['Salário', 'entrada'],
  ['Outras receitas', 'entrada'],
  ['Alimentação', 'saida'],
  ['Moradia', 'saida'],
  ['Saúde', 'saida'],
  ['Mobilidade', 'saida'],
  ['Lazer', 'saida'],
  ['Educação', 'saida'],
  ['Outros', 'saida'],
];

const mapear = (d) => d && { id: d._id.toHexString(), nome: d.nome, tipo: d.tipo };

// Todas as consultas filtram por usuarioId: um usuário nunca enxerga dados de outro (RF3)
const Categoria = {
  /** Cria as categorias padrão de um novo usuário (dentro da transação do cadastro). */
  async criarPadrao(session, usuarioId) {
    await categorias().insertMany(PADRAO.map(([nome, tipo]) => ({ usuarioId, nome, tipo })), { session });
  },

  async listar(usuarioId, tipo) {
    const filtro = { usuarioId, ...(tipo && { tipo }) };
    const [docs, contagens] = await Promise.all([
      categorias().find(filtro).sort({ tipo: 1, nome: 1 }).toArray(),
      lancamentos().aggregate([{ $match: { usuarioId } }, { $group: { _id: '$categoriaId', n: { $sum: 1 } } }]).toArray(),
    ]);
    const porCategoria = new Map(contagens.map((c) => [c._id.toHexString(), c.n]));
    return docs.map((d) => ({ ...mapear(d), totalLancamentos: porCategoria.get(d._id.toHexString()) ?? 0 }));
  },

  async buscar(usuarioId, id) {
    return mapear(await categorias().findOne({ _id: id, usuarioId })) || null;
  },

  async criar(usuarioId, { nome, tipo }) {
    const { insertedId } = await categorias().insertOne({ usuarioId, nome, tipo });
    return mapear({ _id: insertedId, nome, tipo });
  },

  /** Devolve null se a categoria não existir para este usuário. */
  async atualizar(usuarioId, id, { nome, tipo }) {
    const d = await categorias().findOneAndUpdate({ _id: id, usuarioId }, { $set: { nome, tipo } }, { returnDocument: 'after' });
    return mapear(d) || null;
  },

  async contarLancamentos(usuarioId, id) {
    return lancamentos().countDocuments({ usuarioId, categoriaId: id });
  },

  /** true se excluiu; false se não existe para este usuário. */
  async excluir(usuarioId, id) {
    const { deletedCount } = await categorias().deleteOne({ _id: id, usuarioId });
    return deletedCount > 0;
  },
};

module.exports = Categoria;
