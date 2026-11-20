/**
 * Carga inicial para a demonstração: 2 usuários e 3 meses de lançamentos
 * (mês atual + 2 anteriores), incluindo compras parceladas no cartão.
 * Usa os próprios models da API (mesmas regras de cadastro e de parcelamento).
 *
 * Uso: npm run seed          (rode antes: npm run db:criar)
 * Apaga os dados existentes antes de inserir.
 * Senha dos dois usuários: Senha123
 */
const bcrypt = require('bcrypt');
const { client, colecao, transacao, paraId } = require('../src/config/db');
const Usuario = require('../src/models/Usuario');
const Categoria = require('../src/models/Categoria');
const FonteDestino = require('../src/models/FonteDestino');
const Lancamento = require('../src/models/Lancamento');
const { cpfValido, hojeIso, adicionarMeses, mesDe } = require('../src/models/regras');

const SENHA = 'Senha123';
const USUARIOS = [
  { nome: 'Ana Souza', email: 'ana@exemplo.com', cpf: '52998224725', fator: 1 },
  { nome: 'Bruno Lima', email: 'bruno@exemplo.com', cpf: '11144477735', fator: 1.3 },
];

// [descrição, categoria, valor, dia, destino]
const SAIDAS_MENSAIS = [
  ['Aluguel', 'Moradia', 1500, 5, 'Conta corrente'],
  ['Conta de luz', 'Moradia', 182.4, 9, 'Conta corrente'],
  ['Supermercado', 'Alimentação', 620.35, 7, 'Nubank'],
  ['Restaurante', 'Alimentação', 135.9, 15, 'Visa crédito'],
  ['Feira', 'Alimentação', 95.5, 21, 'Dinheiro'],
  ['Combustível', 'Mobilidade', 240, 10, 'Visa crédito'],
  ['Aplicativo de transporte', 'Mobilidade', 68.4, 18, 'Nubank'],
  ['Cinema', 'Lazer', 72, 12, 'Nubank'],
  ['Streaming', 'Lazer', 39.9, 3, 'Nubank'], // dia do fechamento do Nubank → fatura do mês seguinte
  ['Farmácia', 'Saúde', 118.7, 20, 'Conta corrente'],
  ['Curso online', 'Educação', 150, 25, 'Visa crédito'], // dia do fechamento do Visa
];

const centavos = (v) => Math.round(v * 100);

async function main() {
  USUARIOS.forEach((u) => {
    if (!cpfValido(u.cpf)) throw new Error(`CPF inválido no seed: ${u.cpf}`);
  });

  for (const nome of ['lancamentos', 'fontesDestinos', 'categorias', 'usuarios']) await colecao(nome).deleteMany({});
  const senhaHash = await bcrypt.hash(SENHA, 10);
  const hoje = hojeIso();
  const inicioMesAtual = mesDe(hoje).inicio;

  for (const u of USUARIOS) {
    const usuario = await transacao(async (session) => {
      const novo = await Usuario.criar(session, { nome: u.nome, email: u.email, cpf: u.cpf, senhaHash });
      await Categoria.criarPadrao(session, paraId(novo.id));
      await FonteDestino.criarPadrao(session, paraId(novo.id));
      return novo;
    });
    const uid = paraId(usuario.id);

    await FonteDestino.criar(uid, { nome: 'Poupança', tipo: 'conta', diaFechamento: null, diaVencimento: null, limiteCentavos: null, reserva: true });
    await FonteDestino.criar(uid, { nome: 'Freelances', tipo: 'renda', diaFechamento: null, diaVencimento: null, limiteCentavos: null, reserva: false });
    await FonteDestino.criar(uid, { nome: 'Nubank', tipo: 'cartao_credito', diaFechamento: 3, diaVencimento: 10, limiteCentavos: 500000, reserva: false });
    await FonteDestino.criar(uid, { nome: 'Visa crédito', tipo: 'cartao_credito', diaFechamento: 25, diaVencimento: 5, limiteCentavos: 800000, reserva: false });

    const cat = Object.fromEntries((await Categoria.listar(uid)).map((c) => [c.nome, paraId(c.id)]));
    const fd = Object.fromEntries((await FonteDestino.listar(uid)).map((f) => [f.nome, paraId(f.id)]));

    const lancar = (tipo, descricao, valor, data, categoria, fonte, parcelas = 1) =>
      Lancamento.criar(uid, {
        tipo, descricao, valorCentavos: centavos(valor), data,
        categoriaId: cat[categoria], fonteDestinoId: fd[fonte], parcelas,
      });

    for (let m = 2; m >= 0; m--) {
      const base = adicionarMeses(inicioMesAtual, -m);
      const dia = (d) => {
        const data = `${base.slice(0, 8)}${String(d).padStart(2, '0')}`;
        return m === 0 && data > hoje ? null : data; // mês atual: só até hoje
      };
      const variacao = (d) => 1 + (((m * 7 + d) % 5) - 2) * 0.05;

      if (dia(5)) await lancar('entrada', 'Salário', 5200 * u.fator, dia(5), 'Salário', 'Salário');
      if (m !== 1 && dia(14)) await lancar('entrada', 'Projeto freelance', 800 * u.fator, dia(14), 'Outras receitas', 'Freelances');
      if (dia(6)) await lancar('saida', 'Aplicação na poupança', 300 * u.fator, dia(6), 'Outros', 'Conta corrente');
      if (dia(6)) await lancar('entrada', 'Aplicação na poupança', 300 * u.fator, dia(6), 'Outras receitas', 'Poupança');

      for (const [descricao, categoria, valor, d, destino] of SAIDAS_MENSAIS) {
        if (!dia(d)) continue;
        const v = Math.round(valor * u.fator * variacao(d) * 100) / 100;
        await lancar('saida', descricao, v, dia(d), categoria, destino);
      }
    }

    // Compras parceladas no cartão
    await lancar('saida', 'Notebook', 4500 * u.fator, adicionarMeses(inicioMesAtual, -2).slice(0, 8) + '18', 'Educação', 'Nubank', 10);
    await lancar('saida', 'Celular', 100, adicionarMeses(inicioMesAtual, -1).slice(0, 8) + '20', 'Outros', 'Visa crédito', 3); // 33,34 + 33,33 + 33,33
    await lancar('saida', 'Geladeira', 3200 * u.fator, adicionarMeses(inicioMesAtual, -1).slice(0, 8) + '27', 'Moradia', 'Visa crédito', 8);
  }

  console.log('Seed concluído. Usuários de teste (senha: %s):', SENHA);
  USUARIOS.forEach((u) => console.log(` - ${u.email}  (CPF ${u.cpf})`));
}

main()
  .catch((e) => {
    console.error('Falha no seed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => client.close());
