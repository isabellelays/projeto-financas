/**
 * Middlewares de validação e sanitização do corpo das requisições.
 * Cada um valida o formato dos dados, normaliza os valores e os coloca em `req.dados`.
 * Se houver erro, responde 400 no padrão { erro, campos } via ErroValidacao.
 * (Regras que dependem do banco — posse da categoria, tipo da categoria etc. — ficam nas rotas/models.)
 */
const { ErroValidacao } = require('./erros');
const { cpfValido, dataValida, paraCentavos, mesDe, hojeIso } = require('../models/regras');
const { paraId } = require('../config/db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIPOS_LANCAMENTO = ['entrada', 'saida'];
const TIPOS_FONTE = ['renda', 'conta', 'cartao_credito'];
const MAX_CENTAVOS = 2147483647; // valores guardados como inteiro de 32 bits em centavos (≈ R$ 21,4 milhões)

const texto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const inteiroPositivo = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function concluir(req, next, erros, dados) {
  if (Object.keys(erros).length) return next(new ErroValidacao(erros));
  req.dados = dados;
  return next();
}

// ---------------------------------------------------------------- Auth
function validarCadastro(req, res, next) {
  const b = req.body ?? {};
  const erros = {};
  const nome = texto(b.nome);
  const email = texto(b.email).toLowerCase();
  const cpf = String(b.cpf ?? '').replace(/\D/g, '');
  const senha = typeof b.senha === 'string' ? b.senha : '';
  const confirmacao = b.confirmacaoSenha ?? b.confirmarSenha;

  if (!nome) erros.nome = 'Informe o nome.';
  else if (nome.length > 120) erros.nome = 'O nome deve ter no máximo 120 caracteres.';

  if (!email) erros.email = 'Informe o e-mail.';
  else if (!EMAIL_RE.test(email) || email.length > 160) erros.email = 'E-mail inválido.';

  if (!b.cpf) erros.cpf = 'Informe o CPF.';
  else if (!cpfValido(cpf)) erros.cpf = 'CPF inválido.';

  if (!senha) erros.senha = 'Informe a senha.';
  else if (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) {
    erros.senha = 'A senha deve ter no mínimo 8 caracteres, com letras e números.';
  } else if (senha.length > 72) erros.senha = 'A senha deve ter no máximo 72 caracteres.'; // limite do bcrypt

  if (confirmacao === undefined || confirmacao === '') erros.confirmacaoSenha = 'Confirme a senha.';
  else if (confirmacao !== senha) erros.confirmacaoSenha = 'As senhas não conferem.';

  return concluir(req, next, erros, { nome, email, cpf, senha });
}

function validarLogin(req, res, next) {
  const b = req.body ?? {};
  const erros = {};
  const email = texto(b.email).toLowerCase();
  const senha = typeof b.senha === 'string' ? b.senha : '';
  if (!email) erros.email = 'Informe o e-mail.';
  if (!senha) erros.senha = 'Informe a senha.';
  return concluir(req, next, erros, { email, senha });
}

// ---------------------------------------------------------------- Categorias
function validarCategoria(req, res, next) {
  const b = req.body ?? {};
  const erros = {};
  const nome = texto(b.nome);
  const tipo = b.tipo;
  if (!nome) erros.nome = 'Informe o nome.';
  else if (nome.length > 60) erros.nome = 'O nome deve ter no máximo 60 caracteres.';
  if (!TIPOS_LANCAMENTO.includes(tipo)) erros.tipo = 'O tipo deve ser "entrada" ou "saida".';
  return concluir(req, next, erros, { nome, tipo });
}

// ---------------------------------------------------------------- Fontes/destinos
function validarFonteDestino(req, res, next) {
  const b = req.body ?? {};
  const erros = {};
  const nome = texto(b.nome);
  const tipo = b.tipo;
  const dados = { nome, tipo, diaFechamento: null, diaVencimento: null, limiteCentavos: null, reserva: false };

  if (!nome) erros.nome = 'Informe o nome.';
  else if (nome.length > 60) erros.nome = 'O nome deve ter no máximo 60 caracteres.';
  if (!TIPOS_FONTE.includes(tipo)) erros.tipo = 'O tipo deve ser "renda", "conta" ou "cartao_credito".';

  if (tipo === 'cartao_credito') {
    const dia = (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
    };
    const fech = b.diaFechamento ?? b.dia_fechamento;
    const venc = b.diaVencimento ?? b.dia_vencimento;
    dados.diaFechamento = dia(fech);
    dados.diaVencimento = dia(venc);
    const limiteCent = paraCentavos(b.limite);

    if (fech === undefined || fech === null || fech === '') erros.diaFechamento = 'Informe o dia de fechamento.';
    else if (dados.diaFechamento === null) erros.diaFechamento = 'O dia de fechamento deve estar entre 1 e 31.';
    if (venc === undefined || venc === null || venc === '') erros.diaVencimento = 'Informe o dia de vencimento.';
    else if (dados.diaVencimento === null) erros.diaVencimento = 'O dia de vencimento deve estar entre 1 e 31.';
    if (b.limite === undefined || b.limite === null || b.limite === '') erros.limite = 'Informe o limite do cartão.';
    else if (limiteCent === null || limiteCent < 0 || limiteCent > MAX_CENTAVOS) erros.limite = 'O limite deve ser um valor entre zero e R$ 21 milhões.';
    else dados.limiteCentavos = limiteCent;
  }

  if (tipo === 'conta') dados.reserva = b.reserva === true || b.reserva === 'true';

  return concluir(req, next, erros, dados);
}

// ---------------------------------------------------------------- Lançamentos
function validarLancamento(req, res, next) {
  const b = req.body ?? {};
  const erros = {};
  const tipo = b.tipo;
  const descricao = texto(b.descricao);
  const valorCentavos = paraCentavos(b.valor);
  const data = typeof b.data === 'string' ? b.data.slice(0, 10) : '';
  const categoriaBruta = b.categoriaId ?? b.categoria_id;
  const fonteBruta = b.fonteDestinoId ?? b.fonte_destino_id;
  const categoriaId = paraId(categoriaBruta);
  const fonteDestinoId = paraId(fonteBruta);
  const parcelasBrutas = b.parcelas ?? b.totalParcelas ?? 1;
  const parcelas = Number(parcelasBrutas);

  if (!TIPOS_LANCAMENTO.includes(tipo)) erros.tipo = 'O tipo deve ser "entrada" ou "saida".';
  if (!descricao) erros.descricao = 'Informe a descrição.';
  else if (descricao.length > 120) erros.descricao = 'A descrição deve ter no máximo 120 caracteres.';
  if (b.valor === undefined || b.valor === null || b.valor === '') erros.valor = 'Informe o valor.';
  else if (valorCentavos === null) erros.valor = 'Valor inválido (use no máximo 2 casas decimais).';
  else if (valorCentavos <= 0) erros.valor = 'O valor deve ser maior que zero.';
  else if (valorCentavos > MAX_CENTAVOS) erros.valor = 'Valor muito alto.';
  if (!b.data) erros.data = 'Informe a data.';
  else if (!dataValida(data)) erros.data = 'Data inválida (use AAAA-MM-DD).';
  if (!categoriaBruta) erros.categoriaId = 'Informe a categoria.';
  else if (!categoriaId) erros.categoriaId = 'Categoria não encontrada.';
  if (!fonteBruta) erros.fonteDestinoId = 'Informe a fonte/destino.';
  else if (!fonteDestinoId) erros.fonteDestinoId = 'Fonte/destino não encontrada.';
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 48) {
    erros.parcelas = 'O número de parcelas deve estar entre 1 e 48.';
  }

  return concluir(req, next, erros, { tipo, descricao, valorCentavos, data, categoriaId, fonteDestinoId, parcelas });
}

// ---------------------------------------------------------------- Parâmetros
/**
 * Lê ?inicio=AAAA-MM-DD&fim=AAAA-MM-DD (padrão: mês corrente) e coloca em req.periodo.
 */
function validarPeriodo(req, res, next) {
  const mes = mesDe(hojeIso());
  const inicio = req.query.inicio || mes.inicio;
  const fim = req.query.fim || mes.fim;
  const erros = {};
  if (!dataValida(inicio)) erros.inicio = 'Data inicial inválida (use AAAA-MM-DD).';
  if (!dataValida(fim)) erros.fim = 'Data final inválida (use AAAA-MM-DD).';
  if (!Object.keys(erros).length && inicio > fim) erros.fim = 'A data final deve ser igual ou posterior à inicial.';
  if (Object.keys(erros).length) return next(new ErroValidacao(erros));
  req.periodo = { inicio, fim };
  return next();
}

/** Valida :id (ObjectId); id inválido é tratado como "não existe" (404). */
function validarId(req, res, next) {
  const id = paraId(req.params.id);
  if (!id) return res.status(404).json({ erro: 'Registro não encontrado.' });
  req.params.id = id;
  return next();
}

module.exports = {
  validarCadastro,
  validarLogin,
  validarCategoria,
  validarFonteDestino,
  validarLancamento,
  validarId,
  validarPeriodo,
  inteiroPositivo,
};
