const { colecao, paraId } = require('../config/db');
const FonteDestino = require('./FonteDestino');
const Lancamento = require('./Lancamento');
const { calcularFatura, periodoAnterior, hojeIso, mesDe, adicionarMeses, deCentavos } = require('./regras');

const lancamentos = () => colecao('lancamentos');

const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 10000) / 100 : 0);
// soma condicional em centavos: { $sum: { $cond: [condição, '$valorCentavos', 0] } }
const somaSe = (condicao) => ({ $sum: { $cond: [condicao, '$valorCentavos', 0] } });
const entre = (inicio, fim) => ({ $and: [{ $gte: ['$data', inicio] }, { $lte: ['$data', fim] }] });

/** Variação percentual do período anterior para o atual (null quando não havia base de comparação). */
function variacao(atual, anterior) {
  if (anterior === 0) return atual === 0 ? 0 : null;
  return Math.round(((atual - anterior) / anterior) * 10000) / 100;
}
function tendencia(atual, anterior) {
  if (anterior === 0 && atual > 0) return 'novo';
  if (atual > anterior) return 'aumento';
  if (atual < anterior) return 'reducao';
  return 'estavel';
}

const Relatorio = {
  /**
   * RF7 — Totais por categoria no período, com percentual e comparação com o período anterior
   * de mesmo tamanho. Agregação feita no banco ($group / $sum).
   */
  async porCategoria(usuarioId, inicio, fim) {
    const anterior = periodoAnterior(inicio, fim);
    const rows = await lancamentos()
      .aggregate([
        { $match: { usuarioId, data: { $gte: anterior.inicio, $lte: fim } } },
        {
          $group: {
            _id: '$categoriaId',
            total: somaSe(entre(inicio, fim)),
            totalAnterior: somaSe(entre(anterior.inicio, anterior.fim)),
          },
        },
        { $lookup: { from: 'categorias', localField: '_id', foreignField: '_id', as: 'categoria' } },
        { $unwind: '$categoria' },
      ])
      .toArray();

    const montar = (tipo) => {
      const linhas = rows.filter((r) => r.categoria.tipo === tipo);
      const total = linhas.reduce((a, r) => a + r.total, 0); // centavos
      const totalAnterior = linhas.reduce((a, r) => a + r.totalAnterior, 0);
      const categorias = linhas
        .map((r) => ({
          id: r._id.toHexString(),
          nome: r.categoria.nome,
          total: deCentavos(r.total),
          totalAnterior: deCentavos(r.totalAnterior),
          percentual: pct(r.total, total),
          variacao: variacao(r.total, r.totalAnterior),
          tendencia: tendencia(r.total, r.totalAnterior),
        }))
        .sort((a, b) => b.total - a.total || b.totalAnterior - a.totalAnterior);
      return {
        total: deCentavos(total),
        totalAnterior: deCentavos(totalAnterior),
        variacao: variacao(total, totalAnterior),
        categorias,
      };
    };

    const saidas = montar('saida');
    const entradas = montar('entrada');
    return {
      periodo: { inicio, fim },
      periodoAnterior: anterior,
      totalSaidas: saidas.total,
      totalEntradas: entradas.total,
      categorias: saidas.categorias, // saídas por categoria (gráfico)
      saidas,
      entradas,
    };
  },

  /** RF8 — Entradas por fonte, saídas por destino e saldo (entradas − saídas) das contas no período. */
  async porFonteDestino(usuarioId, inicio, fim) {
    const [todas, somas] = await Promise.all([
      FonteDestino.listar(usuarioId),
      lancamentos()
        .aggregate([
          { $match: { usuarioId, data: { $gte: inicio, $lte: fim } } },
          {
            $group: {
              _id: '$fonteDestinoId',
              entradas: somaSe({ $eq: ['$tipo', 'entrada'] }),
              saidas: somaSe({ $eq: ['$tipo', 'saida'] }),
            },
          },
        ])
        .toArray(),
    ]);
    const porFonte = new Map(somas.map((s) => [s._id.toHexString(), s]));
    const itens = todas
      .map((f) => {
        const s = porFonte.get(f.id) ?? { entradas: 0, saidas: 0 };
        return {
          id: f.id,
          nome: f.nome,
          tipo: f.tipo,
          entradas: deCentavos(s.entradas),
          saidas: deCentavos(s.saidas),
          saldo: deCentavos(s.entradas - s.saidas),
          _e: s.entradas,
          _s: s.saidas,
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    const totalE = itens.reduce((a, i) => a + i._e, 0);
    const totalS = itens.reduce((a, i) => a + i._s, 0);
    const limpar = ({ _e, _s, ...resto }) => resto;

    return {
      periodo: { inicio, fim },
      totalEntradas: deCentavos(totalE),
      totalSaidas: deCentavos(totalS),
      saldo: deCentavos(totalE - totalS),
      entradasPorFonte: itens
        .filter((i) => i._e > 0)
        .sort((a, b) => b._e - a._e)
        .map((i) => ({ id: i.id, nome: i.nome, tipo: i.tipo, total: i.entradas, percentual: pct(i._e, totalE) })),
      saidasPorDestino: itens
        .filter((i) => i._s > 0)
        .sort((a, b) => b._s - a._s)
        .map((i) => ({ id: i.id, nome: i.nome, tipo: i.tipo, total: i.saidas, percentual: pct(i._s, totalS) })),
      saldoContas: itens.filter((i) => i.tipo === 'conta').map(limpar),
      itens: itens.map(limpar),
    };
  },

  /** Entradas, saídas e saldo por mês (AAAA-MM) no intervalo, pela data de cada lançamento/parcela. */
  async mensal(usuarioId, inicio, fim) {
    const rows = await lancamentos()
      .aggregate([
        { $match: { usuarioId, data: { $gte: inicio, $lte: fim } } },
        {
          $group: {
            _id: { $substrCP: ['$data', 0, 7] }, // 'AAAA-MM'
            entradas: somaSe({ $eq: ['$tipo', 'entrada'] }),
            saidas: somaSe({ $eq: ['$tipo', 'saida'] }),
            parcelas: somaSe({ $and: [{ $eq: ['$tipo', 'saida'] }, { $gt: ['$totalParcelas', 1] }] }),
          },
        },
      ])
      .toArray();
    const porMes = new Map(rows.map((r) => [r._id, r]));
    // devolve todos os meses do intervalo, inclusive os sem movimento
    const meses = [];
    for (let d = mesDe(inicio).inicio; d <= fim; d = adicionarMeses(d, 1)) {
      const mes = d.slice(0, 7);
      const r = porMes.get(mes) ?? { entradas: 0, saidas: 0, parcelas: 0 };
      meses.push({
        mes,
        entradas: deCentavos(r.entradas),
        saidas: deCentavos(r.saidas),
        parcelas: deCentavos(r.parcelas),
        saldo: deCentavos(r.entradas - r.saidas),
      });
    }
    return meses;
  },

  /**
   * RF9 — Para cada cartão: fatura fechada ainda não vencida (se houver), fatura aberta e as
   * próximas `meses` faturas, com os lançamentos de cada uma e o limite utilizado/disponível.
   * A fatura de cada parcela é calculada por calcularFatura(dataCompra, cartao, parcelaAtual).
   */
  async faturas(usuarioId, meses = 3, hoje = hojeIso()) {
    const cartoes = await FonteDestino.listarCartoes(usuarioId);
    if (!cartoes.length) return { hoje, cartoes: [] };

    // a fatura de uma parcela vence no máximo ~2 meses após a sua `data`
    const doscartoes = await Lancamento.listarDosCartoes(
      usuarioId,
      cartoes.map((c) => paraId(c.id)),
      adicionarMeses(mesDe(hoje).inicio, -2)
    );
    const centavos = (v) => Math.round(v * 100);

    return {
      hoje,
      cartoes: cartoes.map((cartao) => {
        const doCartao = doscartoes
          .filter((l) => l.fonteDestino.id === cartao.id)
          .map((l) => ({ ...l, fatura: calcularFatura(l.dataCompra, cartao, l.parcelaAtual) }));

        // limite comprometido por todas as parcelas cuja fatura ainda não venceu
        const utilizado = doCartao.filter((l) => l.fatura.vencimento >= hoje).reduce((a, l) => a + centavos(l.valor), 0);

        // offset −1 = fatura anterior (já fechada), 0 = aberta, 1..meses = futuras
        const faturas = [];
        for (let offset = -1; offset <= meses; offset++) {
          const f = calcularFatura(hoje, cartao, offset + 1);
          const itens = doCartao
            .filter((l) => l.fatura.referencia === f.referencia)
            .map(({ id, descricao, rotulo, valor, dataCompra, parcelaAtual, totalParcelas, categoria }) => ({
              id, descricao, rotulo, valor, dataCompra, parcelaAtual, totalParcelas, categoria,
            }));
          if (offset === -1 && (f.vencimento < hoje || !itens.length)) continue; // já paga ou vazia
          faturas.push({
            ...f,
            status: offset === -1 ? 'fechada' : offset === 0 ? 'aberta' : 'futura',
            total: deCentavos(itens.reduce((a, i) => a + centavos(i.valor), 0)),
            lancamentos: itens,
          });
        }

        return {
          id: cartao.id,
          nome: cartao.nome,
          diaFechamento: cartao.diaFechamento,
          diaVencimento: cartao.diaVencimento,
          limite: cartao.limite,
          limiteUtilizado: deCentavos(utilizado),
          limiteDisponivel: deCentavos(centavos(cartao.limite) - utilizado),
          faturas,
        };
      }),
    };
  },
};

module.exports = Relatorio;
