const { randomUUID } = require('crypto');
const { colecao, transacao } = require('../config/db');
const { adicionarMeses, dividirEmParcelas, deCentavos } = require('./regras');

const lancamentos = () => colecao('lancamentos');

// Junta o nome da categoria e da fonte/destino ($lookup = "JOIN" do MongoDB)
const COM_NOMES = [
  { $lookup: { from: 'categorias', localField: 'categoriaId', foreignField: '_id', as: 'categoria' } },
  { $lookup: { from: 'fontesDestinos', localField: 'fonteDestinoId', foreignField: '_id', as: 'fonteDestino' } },
];

const mapear = (d) => {
  if (!d) return d;
  const c = d.categoria?.[0];
  const f = d.fonteDestino?.[0];
  return {
    id: d._id.toHexString(),
    tipo: d.tipo,
    descricao: d.descricao,
    valor: deCentavos(d.valorCentavos),
    data: d.data,
    dataCompra: d.dataCompra,
    parcelaAtual: d.parcelaAtual,
    totalParcelas: d.totalParcelas,
    grupoParcelamento: d.grupoParcelamento,
    rotulo: d.totalParcelas > 1 ? `${d.descricao} — ${d.parcelaAtual}/${d.totalParcelas}` : d.descricao,
    categoria: { id: d.categoriaId.toHexString(), nome: c?.nome },
    fonteDestino: { id: d.fonteDestinoId.toHexString(), nome: f?.nome, tipo: f?.tipo },
  };
};

/** Filtro da listagem (sempre com usuarioId). Datas são texto 'AAAA-MM-DD', então comparam em ordem. */
function filtroListagem(usuarioId, f) {
  return {
    usuarioId,
    data: { $gte: f.inicio, $lte: f.fim },
    ...(f.tipo && { tipo: f.tipo }),
    ...(f.categoriaId && { categoriaId: f.categoriaId }),
    ...(f.fonteDestinoId && { fonteDestinoId: f.fonteDestinoId }),
  };
}

const Lancamento = {
  /** Listagem paginada + totais (entradas, saídas, saldo) do período filtrado, calculados no banco. */
  async listar(usuarioId, filtros) {
    const filtro = filtroListagem(usuarioId, filtros);
    const [itens, [totais]] = await Promise.all([
      lancamentos()
        .aggregate([
          { $match: filtro },
          { $sort: { data: -1, _id: -1 } },
          { $skip: (filtros.pagina - 1) * filtros.porPagina },
          { $limit: filtros.porPagina },
          ...COM_NOMES,
        ])
        .toArray(),
      lancamentos()
        .aggregate([
          { $match: filtro },
          {
            $group: {
              _id: null,
              quantidade: { $sum: 1 },
              entradas: { $sum: { $cond: [{ $eq: ['$tipo', 'entrada'] }, '$valorCentavos', 0] } },
              saidas: { $sum: { $cond: [{ $eq: ['$tipo', 'saida'] }, '$valorCentavos', 0] } },
            },
          },
        ])
        .toArray(),
    ]);

    const t = totais ?? { quantidade: 0, entradas: 0, saidas: 0 };
    return {
      itens: itens.map(mapear),
      paginacao: {
        pagina: filtros.pagina,
        porPagina: filtros.porPagina,
        totalItens: t.quantidade,
        totalPaginas: Math.max(1, Math.ceil(t.quantidade / filtros.porPagina)),
      },
      totais: { entradas: deCentavos(t.entradas), saidas: deCentavos(t.saidas), saldo: deCentavos(t.entradas - t.saidas) },
    };
  },

  async buscar(usuarioId, id) {
    const [d] = await lancamentos().aggregate([{ $match: { _id: id, usuarioId } }, ...COM_NOMES]).toArray();
    return mapear(d) || null;
  },

  /**
   * Cria o lançamento. Com N > 1 parcelas, grava N documentos dentro de UMA transação
   * (todas as parcelas ou nenhuma), com o mesmo grupoParcelamento e o valor dividido em
   * centavos (diferença na 1ª parcela). Cada parcela guarda:
   *   dataCompra = data da compra (usada no cálculo da fatura)
   *   data       = data da compra + (k − 1) meses (mês em que a parcela pesa no orçamento)
   */
  async criar(usuarioId, d) {
    const n = d.parcelas;
    const valores = dividirEmParcelas(d.valorCentavos, n);
    const grupo = n > 1 ? randomUUID() : null;
    const criadoEm = new Date();
    const docs = valores.map((valorCentavos, i) => ({
      usuarioId,
      tipo: d.tipo,
      descricao: d.descricao,
      valorCentavos,
      data: adicionarMeses(d.data, i),
      dataCompra: d.data,
      categoriaId: d.categoriaId,
      fonteDestinoId: d.fonteDestinoId,
      parcelaAtual: i + 1,
      totalParcelas: n,
      grupoParcelamento: grupo,
      criadoEm,
    }));

    const ids = await transacao(async (session) => {
      const { insertedIds } = await lancamentos().insertMany(docs, { session });
      return Object.values(insertedIds);
    });

    const criados = await lancamentos()
      .aggregate([{ $match: { _id: { $in: ids }, usuarioId } }, { $sort: { parcelaAtual: 1 } }, ...COM_NOMES])
      .toArray();
    return criados.map(mapear);
  },

  /**
   * Atualiza UM lançamento. Se ele for uma parcela, `data` é a data desta parcela e a
   * data da compra é recalculada a partir dela (data − (k − 1) meses).
   */
  async atualizar(usuarioId, id, atual, d) {
    const { matchedCount } = await lancamentos().updateOne(
      { _id: id, usuarioId },
      {
        $set: {
          tipo: d.tipo,
          descricao: d.descricao,
          valorCentavos: d.valorCentavos,
          data: d.data,
          dataCompra: adicionarMeses(d.data, -(atual.parcelaAtual - 1)),
          categoriaId: d.categoriaId,
          fonteDestinoId: d.fonteDestinoId,
        },
      }
    );
    return matchedCount ? this.buscar(usuarioId, id) : null;
  },

  /** Exclui o lançamento ou, com todasParcelas, todas as parcelas da mesma compra. Devolve quantos excluiu. */
  async excluir(usuarioId, id, todasParcelas) {
    if (todasParcelas) {
      const doc = await lancamentos().findOne({ _id: id, usuarioId }, { projection: { grupoParcelamento: 1 } });
      if (!doc) return 0;
      if (doc.grupoParcelamento) {
        const { deletedCount } = await lancamentos().deleteMany({ usuarioId, grupoParcelamento: doc.grupoParcelamento });
        return deletedCount;
      }
    }
    const { deletedCount } = await lancamentos().deleteOne({ _id: id, usuarioId });
    return deletedCount;
  },

  /** Saídas nos cartões informados que ainda podem cair em faturas a partir de `desde`. */
  async listarDosCartoes(usuarioId, cartaoIds, desde) {
    const docs = await lancamentos()
      .aggregate([
        { $match: { usuarioId, tipo: 'saida', fonteDestinoId: { $in: cartaoIds }, data: { $gte: desde } } },
        { $sort: { dataCompra: 1, _id: 1 } },
        ...COM_NOMES,
      ])
      .toArray();
    return docs.map(mapear);
  },
};

module.exports = Lancamento;
