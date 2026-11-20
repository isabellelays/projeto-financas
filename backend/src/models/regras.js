/**
 * Regras de negócio puras (sem acesso ao banco): CPF, datas, dinheiro e faturas.
 * Ficam em models/ porque são regras de domínio (decisão documentada no README).
 * Todas as datas são strings 'AAAA-MM-DD' e os cálculos são feitos em UTC.
 */

// ---------------------------------------------------------------- CPF
/** Valida os dois dígitos verificadores do CPF (aceita com ou sem máscara). */
function cpfValido(cpf) {
  const d = String(cpf ?? '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false; // rejeita 111.111.111-11
  const digito = (tamanho) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

// ---------------------------------------------------------------- Datas
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.toISOString().slice(0, 10);

/** mes: 0 a 11 */
function ultimoDiaDoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
}

/** Aceita mes fora de 0–11 e ajusta o dia ao último dia do mês (31/fev → 28 ou 29/fev). */
function dataSegura(ano, mes, dia) {
  const a = ano + Math.floor(mes / 12);
  const m = ((mes % 12) + 12) % 12;
  return new Date(Date.UTC(a, m, Math.min(dia, ultimoDiaDoMes(a, m))));
}

/** true se a string é uma data real no formato AAAA-MM-DD (rejeita 2026-02-30). */
function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= ultimoDiaDoMes(a, m - 1);
}

/** Soma n meses a uma data, ajustando dias inexistentes. */
function adicionarMeses(dataIso, n) {
  const [a, m, d] = dataIso.split('-').map(Number);
  return iso(dataSegura(a, m - 1 + n, d));
}

function adicionarDias(dataIso, n) {
  const dt = new Date(`${dataIso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return iso(dt);
}

/** Data de hoje no fuso do servidor, como 'AAAA-MM-DD'. */
function hojeIso(agora = new Date()) {
  return `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;
}

/** Primeiro e último dia do mês da data informada. */
function mesDe(dataIso) {
  const [a, m] = dataIso.split('-').map(Number);
  return { inicio: `${a}-${pad(m)}-01`, fim: `${a}-${pad(m)}-${pad(ultimoDiaDoMes(a, m - 1))}` };
}

/**
 * Período anterior de mesmo tamanho.
 * Se o período for de meses inteiros (ex.: 01/10 a 31/10), devolve os meses anteriores
 * inteiros (01/09 a 30/09); caso contrário, o mesmo número de dias imediatamente antes.
 */
function periodoAnterior(inicio, fim) {
  const [ai, mi, di] = inicio.split('-').map(Number);
  const [af, mf, df] = fim.split('-').map(Number);
  if (di === 1 && df === ultimoDiaDoMes(af, mf - 1)) {
    const meses = (af - ai) * 12 + (mf - mi) + 1;
    const ini = adicionarMeses(inicio, -meses);
    return { inicio: ini, fim: adicionarDias(inicio, -1) };
  }
  const dias = Math.round((Date.parse(fim) - Date.parse(inicio)) / 86400000) + 1;
  return { inicio: adicionarDias(inicio, -dias), fim: adicionarDias(inicio, -1) };
}

// ---------------------------------------------------------------- Dinheiro
/**
 * Converte o valor recebido (número ou texto "1234.56" / "1234,56") para centavos inteiros.
 * Devolve null se não for um valor válido com no máximo 2 casas decimais.
 */
function paraCentavos(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = typeof valor === 'number' ? String(valor) : String(valor).trim().replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(texto)) return null;
  const [inteiro, frac = ''] = texto.replace('-', '').split('.');
  const centavos = Number(inteiro) * 100 + Number(frac.padEnd(2, '0'));
  return texto.startsWith('-') ? -centavos : centavos;
}

const deCentavos = (c) => c / 100;

/** Valor NUMERIC vindo do banco (texto) → número em reais com 2 casas. */
const dinheiro = (v) => (v === null || v === undefined ? 0 : Math.round(Number(v) * 100) / 100);

/**
 * Divide um total (em centavos) em n parcelas; a diferença de arredondamento
 * vai para a PRIMEIRA parcela. Ex.: 10000 em 3 → [3334, 3333, 3333].
 */
function dividirEmParcelas(totalCentavos, n) {
  const base = Math.floor(totalCentavos / n);
  const resto = totalCentavos - base * n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + resto : base));
}

// ---------------------------------------------------------------- Faturas
/**
 * Fatura em que cai a parcela `numeroParcela` de uma compra feita em `dataCompra`.
 * - Compra ANTES do dia de fechamento → fatura que fecha no mesmo mês;
 *   no dia do fechamento ou depois → fatura do mês seguinte.
 * - A parcela k cai k − 1 meses depois da fatura da 1ª parcela.
 * - Vencimento no mesmo mês do fechamento se diaVencimento > diaFechamento; senão, no mês seguinte.
 * - Dias inexistentes (31 em fevereiro) são ajustados para o último dia do mês.
 *
 * @param {string} dataCompra 'AAAA-MM-DD'
 * @param {{diaFechamento:number, diaVencimento:number}} cartao
 */
function calcularFatura(dataCompra, cartao, numeroParcela = 1) {
  const [ano, mes, dia] = dataCompra.split('-').map(Number);
  const m = mes - 1;
  const fechamentoDoMes = Math.min(cartao.diaFechamento, ultimoDiaDoMes(ano, m));

  let mesFechamento = dia < fechamentoDoMes ? m : m + 1;
  mesFechamento += numeroParcela - 1;

  const fechamento = dataSegura(ano, mesFechamento, cartao.diaFechamento);
  const mesVencimento = cartao.diaVencimento > cartao.diaFechamento ? mesFechamento : mesFechamento + 1;
  const vencimento = dataSegura(ano, mesVencimento, cartao.diaVencimento);

  return { referencia: iso(vencimento).slice(0, 7), fechamento: iso(fechamento), vencimento: iso(vencimento) };
}

module.exports = {
  cpfValido,
  dataValida,
  adicionarMeses,
  adicionarDias,
  hojeIso,
  mesDe,
  periodoAnterior,
  paraCentavos,
  deCentavos,
  dinheiro,
  dividirEmParcelas,
  calcularFatura,
};
