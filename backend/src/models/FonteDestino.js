const { colecao } = require('../config/db');
const { deCentavos } = require('./regras');

const fontes = () => colecao('fontesDestinos');
const lancamentos = () => colecao('lancamentos');

const mapear = (d) =>
  d && {
    id: d._id.toHexString(),
    nome: d.nome,
    tipo: d.tipo,
    diaFechamento: d.diaFechamento,
    diaVencimento: d.diaVencimento,
    limite: d.limiteCentavos === null ? null : deCentavos(d.limiteCentavos),
    reserva: d.reserva,
  };

const documento = (usuarioId, d) => ({
  usuarioId,
  nome: d.nome,
  tipo: d.tipo,
  diaFechamento: d.diaFechamento,
  diaVencimento: d.diaVencimento,
  limiteCentavos: d.limiteCentavos,
  reserva: d.reserva,
});

const FonteDestino = {
  /** Fontes/destinos padrão de um novo usuário (dentro da transação do cadastro). */
  async criarPadrao(session, usuarioId) {
    const base = { diaFechamento: null, diaVencimento: null, limiteCentavos: null, reserva: false };
    await fontes().insertMany(
      [
        documento(usuarioId, { ...base, nome: 'Conta corrente', tipo: 'conta' }),
        documento(usuarioId, { ...base, nome: 'Salário', tipo: 'renda' }),
        documento(usuarioId, { ...base, nome: 'Dinheiro', tipo: 'conta' }),
      ],
      { session }
    );
  },

  async listar(usuarioId, tipo) {
    const [docs, contagens] = await Promise.all([
      fontes().find({ usuarioId, ...(tipo && { tipo }) }).sort({ tipo: 1, nome: 1 }).toArray(),
      lancamentos().aggregate([{ $match: { usuarioId } }, { $group: { _id: '$fonteDestinoId', n: { $sum: 1 } } }]).toArray(),
    ]);
    const porFonte = new Map(contagens.map((c) => [c._id.toHexString(), c.n]));
    return docs.map((d) => ({ ...mapear(d), totalLancamentos: porFonte.get(d._id.toHexString()) ?? 0 }));
  },

  async buscar(usuarioId, id) {
    return mapear(await fontes().findOne({ _id: id, usuarioId })) || null;
  },

  async listarCartoes(usuarioId) {
    return (await fontes().find({ usuarioId, tipo: 'cartao_credito' }).sort({ nome: 1 }).toArray()).map(mapear);
  },

  async criar(usuarioId, d) {
    const doc = documento(usuarioId, d);
    const { insertedId } = await fontes().insertOne(doc);
    return mapear({ ...doc, _id: insertedId });
  },

  async atualizar(usuarioId, id, d) {
    const { usuarioId: _, ...campos } = documento(usuarioId, d);
    const doc = await fontes().findOneAndUpdate({ _id: id, usuarioId }, { $set: campos }, { returnDocument: 'after' });
    return mapear(doc) || null;
  },

  /** Quantos lançamentos usam a fonte/destino, separados por tipo e se são parcelados. */
  async resumoLancamentos(usuarioId, id) {
    const [r] = await lancamentos()
      .aggregate([
        { $match: { usuarioId, fonteDestinoId: id } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            entradas: { $sum: { $cond: [{ $eq: ['$tipo', 'entrada'] }, 1, 0] } },
            saidas: { $sum: { $cond: [{ $eq: ['$tipo', 'saida'] }, 1, 0] } },
            parcelados: { $sum: { $cond: [{ $gt: ['$totalParcelas', 1] }, 1, 0] } },
          },
        },
      ])
      .toArray();
    return r ?? { total: 0, entradas: 0, saidas: 0, parcelados: 0 };
  },

  async excluir(usuarioId, id) {
    const { deletedCount } = await fontes().deleteOne({ _id: id, usuarioId });
    return deletedCount > 0;
  },
};

module.exports = FonteDestino;
