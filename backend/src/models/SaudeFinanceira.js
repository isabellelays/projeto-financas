/**
 * Desafio — Saúde financeira. Todos os números são calculados aqui (back-end);
 * as dicas são geradas por regras com os limites abaixo (documentados no README).
 */
const { colecao } = require('../config/db');
const Relatorio = require('./Relatorio');
const { hojeIso, mesDe, adicionarMeses, dinheiro, deCentavos } = require('./regras');

const LIMITES = {
  poupancaMeta: 10, //            % da renda guardada por mês (mínimo recomendado)
  poupancaBoa: 20, //             % considerado ótimo
  comprometimentoCartaoMax: 30, // % da renda (média mensal) comprometida com faturas
  comprometimentoCartaoCritico: 50,
  foraDaCurvaPct: 30, //          % acima da média dos 3 meses anteriores
  foraDaCurvaMinimo: 50, //       R$ de diferença mínima para alertar
  reservaMesesMin: 3, //          meses de despesas cobertos pela reserva
  reservaMesesIdeal: 6,
  mesesBase: 3, //                meses completos usados nas médias
  mesesProjecao: 6,
};

const AVISO =
  'As informações desta página são educativas, calculadas a partir dos seus próprios lançamentos, ' +
  'e não constituem recomendação financeira profissional.';

const media = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nomeMes = (aaaamm) => {
  const [a, m] = aaaamm.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, 1)).toLocaleString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

function status(valor, bom, ruim, maiorMelhor = true) {
  if (valor === null) return 'sem_dados';
  if (maiorMelhor) return valor >= bom ? 'bom' : valor >= ruim ? 'atencao' : 'critico';
  return valor <= bom ? 'bom' : valor <= ruim ? 'atencao' : 'critico';
}

const SaudeFinanceira = {
  async calcular(usuarioId, hoje = hojeIso()) {
    const L = LIMITES;
    const mesAtual = mesDe(hoje);
    const inicioBase = adicionarMeses(mesAtual.inicio, -L.mesesBase);
    const fimBase = mesDe(adicionarMeses(mesAtual.inicio, -1)).fim;
    const fimProjecao = mesDe(adicionarMeses(mesAtual.inicio, L.mesesProjecao)).fim;

    const lancamentos = colecao('lancamentos');
    const comSinal = { $cond: [{ $eq: ['$tipo', 'entrada'] }, '$valorCentavos', { $multiply: ['$valorCentavos', -1] }] };
    const contasReserva = await colecao('fontesDestinos').find({ usuarioId, reserva: true }, { projection: { _id: 1 } }).toArray();

    const [serie, faturas, catRows, parcelasRows, reservaRows, saldoRows] = await Promise.all([
      Relatorio.mensal(usuarioId, inicioBase, mesAtual.fim),
      Relatorio.faturas(usuarioId, 3, hoje),
      // gasto por categoria: mês atual × soma dos 3 meses anteriores
      lancamentos
        .aggregate([
          { $match: { usuarioId, tipo: 'saida', data: { $gte: inicioBase, $lte: mesAtual.fim } } },
          {
            $group: {
              _id: '$categoriaId',
              atual: { $sum: { $cond: [{ $gte: ['$data', mesAtual.inicio] }, '$valorCentavos', 0] } },
              base: { $sum: { $cond: [{ $lte: ['$data', fimBase] }, '$valorCentavos', 0] } },
            },
          },
          { $lookup: { from: 'categorias', localField: '_id', foreignField: '_id', as: 'categoria' } },
          { $unwind: '$categoria' },
        ])
        .toArray(),
      // parcelas já conhecidas que caem nos próximos meses
      lancamentos
        .aggregate([
          { $match: { usuarioId, tipo: 'saida', totalParcelas: { $gt: 1 }, data: { $gt: mesAtual.fim, $lte: fimProjecao } } },
          { $group: { _id: { $substrCP: ['$data', 0, 7] }, total: { $sum: '$valorCentavos' } } },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      // saldo acumulado das contas marcadas como reserva
      lancamentos
        .aggregate([
          { $match: { usuarioId, fonteDestinoId: { $in: contasReserva.map((c) => c._id) }, data: { $lte: hoje } } },
          { $group: { _id: null, saldo: { $sum: comSinal } } },
        ])
        .toArray(),
      // saldo acumulado (entradas − saídas) até o fim do mês atual: ponto de partida da projeção
      lancamentos
        .aggregate([{ $match: { usuarioId, data: { $lte: mesAtual.fim } } }, { $group: { _id: null, saldo: { $sum: comSinal } } }])
        .toArray(),
    ]);

    const base = serie.filter((m) => m.mes < mesAtual.inicio.slice(0, 7));
    const atual = serie[serie.length - 1];
    const temBase = base.some((m) => m.entradas > 0 || m.saidas > 0);
    const rendaMedia = media(base.map((m) => m.entradas));
    const saidaMedia = media(base.map((m) => m.saidas));
    const saidaMediaSemParcelas = media(base.map((m) => m.saidas - m.parcelas));
    const indicadores = [];
    const dicas = [];

    // 1. Taxa de poupança --------------------------------------------------------------
    const taxas = base.map((m) => ({ mes: m.mes, taxa: pct(m.entradas - m.saidas, m.entradas) }));
    const ultimo = taxas[taxas.length - 1];
    const taxaMedia = pct(rendaMedia - saidaMedia, rendaMedia);
    indicadores.push({
      id: 'taxa_poupanca',
      nome: 'Taxa de poupança',
      valor: taxaMedia,
      unidade: '%',
      referencia: `≥ ${L.poupancaMeta}%`,
      status: status(taxaMedia, L.poupancaBoa, L.poupancaMeta),
      detalhe: taxas,
    });
    if (ultimo?.taxa !== null && ultimo) {
      if (ultimo.taxa < 0) {
        dicas.push({ nivel: 'critico', texto: `Em ${nomeMes(ultimo.mes)} você gastou mais do que recebeu (taxa de poupança de ${ultimo.taxa}%).` });
      } else if (ultimo.taxa < L.poupancaMeta) {
        dicas.push({ nivel: 'atencao', texto: `Você guardou ${ultimo.taxa}% da sua renda em ${nomeMes(ultimo.mes)}. Uma meta comum é guardar pelo menos ${L.poupancaMeta}%.` });
      } else {
        dicas.push({ nivel: 'bom', texto: `Você guardou ${ultimo.taxa}% da sua renda em ${nomeMes(ultimo.mes)}. Continue assim!` });
      }
    }

    // 2. Comprometimento com cartões ----------------------------------------------------
    const proximasFaturas = faturas.cartoes.flatMap((c) => c.faturas.filter((f) => f.status !== 'fechada').slice(0, 3));
    const totalFaturas = dinheiro(proximasFaturas.reduce((a, f) => a + f.total, 0));
    const comprometimento = pct(totalFaturas, rendaMedia * 3);
    indicadores.push({
      id: 'comprometimento_cartoes',
      nome: 'Comprometimento da renda com cartões (próximas 3 faturas)',
      valor: comprometimento,
      unidade: '%',
      referencia: `≤ ${L.comprometimentoCartaoMax}%`,
      status: status(comprometimento, L.comprometimentoCartaoMax, L.comprometimentoCartaoCritico, false),
      detalhe: { totalFaturas, rendaMediaMensal: dinheiro(rendaMedia) },
    });
    if (comprometimento !== null && comprometimento > L.comprometimentoCartaoMax) {
      dicas.push({
        nivel: comprometimento > L.comprometimentoCartaoCritico ? 'critico' : 'atencao',
        texto: `Suas faturas dos próximos 3 meses (${brl(totalFaturas)}) comprometem ${comprometimento}% da sua renda. Referência: até ${L.comprometimentoCartaoMax}%.`,
      });
    }

    // 3. Parcelas futuras ---------------------------------------------------------------
    const parcelasPorMes = new Map(parcelasRows.map((r) => [r._id, deCentavos(r.total)]));
    const totalParcelas = dinheiro([...parcelasPorMes.values()].reduce((a, v) => a + v, 0));
    const ultimoMesParcela = parcelasRows.length ? parcelasRows[parcelasRows.length - 1]._id : null;
    indicadores.push({
      id: 'parcelas_futuras',
      nome: `Parcelas a vencer (próximos ${L.mesesProjecao} meses)`,
      valor: totalParcelas,
      unidade: 'R$',
      status: totalParcelas === 0 ? 'bom' : status(pct(totalParcelas / L.mesesProjecao, rendaMedia), 15, 30, false),
      detalhe: [...parcelasPorMes].map(([mes, total]) => ({ mes, total })),
    });
    if (totalParcelas > 0) {
      dicas.push({ nivel: 'info', texto: `Você tem ${brl(totalParcelas)} em parcelas até ${nomeMes(ultimoMesParcela)}.` });
    }

    // 4. Categorias fora da curva -------------------------------------------------------
    const foraDaCurva = catRows
      .map((r) => {
        const gasto = deCentavos(r.atual);
        const mediaCat = dinheiro(r.base / L.mesesBase / 100);
        return { id: r._id.toHexString(), nome: r.categoria.nome, gastoMes: gasto, media: mediaCat, acimaPct: pct(gasto - mediaCat, mediaCat) };
      })
      .filter((c) => c.media > 0 && c.acimaPct > L.foraDaCurvaPct && c.gastoMes - c.media >= L.foraDaCurvaMinimo)
      .sort((a, b) => b.acimaPct - a.acimaPct);
    indicadores.push({
      id: 'categorias_fora_da_curva',
      nome: 'Categorias acima da média',
      valor: foraDaCurva.length,
      unidade: 'categorias',
      status: foraDaCurva.length === 0 ? 'bom' : foraDaCurva.length <= 1 ? 'atencao' : 'critico',
      detalhe: foraDaCurva,
    });
    foraDaCurva.slice(0, 3).forEach((c) =>
      dicas.push({ nivel: 'atencao', texto: `Seus gastos com ${c.nome} estão ${c.acimaPct}% acima da sua média dos últimos ${L.mesesBase} meses.` })
    );

    // 5. Reserva de emergência ----------------------------------------------------------
    const reserva = { contas: contasReserva.length };
    const saldoReserva = deCentavos(reservaRows[0]?.saldo ?? 0);
    const mesesCobertos = saidaMedia > 0 ? Math.round((saldoReserva / saidaMedia) * 10) / 10 : null;
    indicadores.push({
      id: 'reserva_emergencia',
      nome: 'Reserva de emergência',
      valor: reserva.contas ? mesesCobertos : null,
      unidade: 'meses de despesas',
      referencia: `${L.reservaMesesMin} a ${L.reservaMesesIdeal} meses`,
      status: reserva.contas ? status(mesesCobertos, L.reservaMesesMin, 1) : 'sem_dados',
      detalhe: { saldoReserva, despesaMediaMensal: dinheiro(saidaMedia), contasReserva: reserva.contas },
    });
    if (!reserva.contas) {
      dicas.push({ nivel: 'info', texto: 'Marque uma conta (ex.: Poupança) como reserva para acompanhar sua reserva de emergência.' });
    } else if (mesesCobertos !== null && mesesCobertos < L.reservaMesesMin) {
      dicas.push({ nivel: 'atencao', texto: `Sua reserva cobre ${String(mesesCobertos).replace('.', ',')} mês(es) de despesas. Uma referência comum é de ${L.reservaMesesMin} a ${L.reservaMesesIdeal} meses.` });
    }

    // Projeção de saldo -----------------------------------------------------------------
    // entradas = média dos 3 meses; saídas = média sem parcelas + parcelas já conhecidas do mês
    const saldoInicial = deCentavos(saldoRows[0]?.saldo ?? 0);
    let acumulado = saldoInicial;
    const projecao = [];
    for (let i = 1; i <= L.mesesProjecao; i++) {
      const mes = adicionarMeses(mesAtual.inicio, i).slice(0, 7);
      const entradas = dinheiro(rendaMedia);
      const parcelas = parcelasPorMes.get(mes) ?? 0;
      const saidas = dinheiro(saidaMediaSemParcelas + parcelas);
      const saldo = dinheiro(entradas - saidas);
      acumulado = dinheiro(acumulado + saldo);
      projecao.push({ mes, entradas, saidas, parcelas, saldo, saldoAcumulado: acumulado, negativo: acumulado < 0 });
    }
    const primeiroNegativo = projecao.find((p) => p.negativo);
    if (primeiroNegativo) {
      dicas.push({ nivel: 'critico', texto: `Mantido o ritmo atual, seu saldo acumulado fica negativo em ${nomeMes(primeiroNegativo.mes)}.` });
    }
    if (!temBase) {
      dicas.unshift({ nivel: 'info', texto: `Ainda há poucos dados: os indicadores usam os ${L.mesesBase} meses completos anteriores ao atual.` });
    }

    return {
      aviso: AVISO,
      referencia: { hoje, mesesBase: base.map((m) => m.mes), mesAtual: atual },
      medias: { entradas: dinheiro(rendaMedia), saidas: dinheiro(saidaMedia) },
      indicadores,
      projecao: { saldoInicial, meses: projecao, alertaNegativo: Boolean(primeiroNegativo) },
      dicas,
      limites: LIMITES,
    };
  },
};

module.exports = SaudeFinanceira;
