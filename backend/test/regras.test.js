// Testes das regras de negócio puras. Uso: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cpfValido, calcularFatura, dividirEmParcelas, paraCentavos, dataValida, periodoAnterior, adicionarMeses,
} = require('../src/models/regras');

test('cpfValido confere os dígitos verificadores', () => {
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('52998224725'), true);
  assert.equal(cpfValido('529.982.247-24'), false);
  assert.equal(cpfValido('111.111.111-11'), false);
  assert.equal(cpfValido('1234567890'), false);
});

test('calcularFatura segue a tabela do enunciado', () => {
  const nubank = { diaFechamento: 3, diaVencimento: 10 };
  const visa = { diaFechamento: 25, diaVencimento: 5 };
  assert.deepEqual(calcularFatura('2026-11-02', nubank), { referencia: '2026-11', fechamento: '2026-11-03', vencimento: '2026-11-10' });
  // compra NO dia do fechamento → fatura do mês seguinte
  assert.deepEqual(calcularFatura('2026-11-03', nubank), { referencia: '2026-12', fechamento: '2026-12-03', vencimento: '2026-12-10' });
  assert.deepEqual(calcularFatura('2026-12-28', visa), { referencia: '2027-02', fechamento: '2027-01-25', vencimento: '2027-02-05' });
  assert.deepEqual(calcularFatura('2026-12-20', visa, 3), { referencia: '2027-03', fechamento: '2027-02-25', vencimento: '2027-03-05' });
});

test('calcularFatura ajusta dias inexistentes', () => {
  const cartao = { diaFechamento: 31, diaVencimento: 10 };
  assert.deepEqual(calcularFatura('2027-02-10', cartao), { referencia: '2027-03', fechamento: '2027-02-28', vencimento: '2027-03-10' });
  assert.equal(calcularFatura('2027-02-28', cartao).fechamento, '2027-03-31');
});

test('dividirEmParcelas: R$ 100,00 em 3x = 33,34 + 33,33 + 33,33', () => {
  const p = dividirEmParcelas(10000, 3);
  assert.deepEqual(p, [3334, 3333, 3333]);
  assert.equal(p.reduce((a, b) => a + b, 0), 10000);
  for (let n = 1; n <= 48; n++) assert.equal(dividirEmParcelas(123457, n).reduce((a, b) => a + b, 0), 123457);
});

test('paraCentavos não usa float', () => {
  assert.equal(paraCentavos('0.10'), 10);
  assert.equal(paraCentavos(33.33), 3333);
  assert.equal(paraCentavos('1234,5'), 123450);
  assert.equal(paraCentavos('1.234'), null);
  assert.equal(paraCentavos('abc'), null);
});

test('dataValida rejeita datas inexistentes', () => {
  assert.equal(dataValida('2026-02-28'), true);
  assert.equal(dataValida('2026-02-29'), false);
  assert.equal(dataValida('2028-02-29'), true);
  assert.equal(dataValida('2026-13-01'), false);
});

test('periodoAnterior: mês inteiro × mês anterior; senão mesmo nº de dias', () => {
  assert.deepEqual(periodoAnterior('2026-10-01', '2026-10-31'), { inicio: '2026-09-01', fim: '2026-09-30' });
  assert.deepEqual(periodoAnterior('2026-03-01', '2026-03-31'), { inicio: '2026-02-01', fim: '2026-02-28' });
  assert.deepEqual(periodoAnterior('2026-10-11', '2026-10-20'), { inicio: '2026-10-01', fim: '2026-10-10' });
  assert.equal(adicionarMeses('2026-01-31', 1), '2026-02-28');
});
