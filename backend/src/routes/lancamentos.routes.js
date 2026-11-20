const express = require('express');
const Lancamento = require('../models/Lancamento');
const Categoria = require('../models/Categoria');
const FonteDestino = require('../models/FonteDestino');
const autenticar = require('../middlewares/autenticar');
const { validarLancamento, validarId, validarPeriodo, inteiroPositivo } = require('../middlewares/validacao');
const { paraId } = require('../config/db');
const { ErroHttp, ErroValidacao, rota } = require('../middlewares/erros');

const router = express.Router();
router.use(autenticar);

const naoEncontrado = () => new ErroHttp(404, 'Lançamento não encontrado.');
const NOME_TIPO = { entrada: 'entrada', saida: 'saída' };

/**
 * Regras que dependem do banco (RF3/RF6):
 *  - categoria e fonte/destino precisam existir E pertencer ao usuário do token;
 *  - o tipo da categoria deve ser igual ao tipo do lançamento;
 *  - fonte do tipo "renda" só recebe entradas; cartão de crédito só recebe saídas;
 *  - parcelamento (2 a 48) só em saídas no cartão de crédito.
 */
async function validarRelacionamentos(usuarioId, d, atual = null) {
  const [categoria, fonte] = await Promise.all([
    Categoria.buscar(usuarioId, d.categoriaId),
    FonteDestino.buscar(usuarioId, d.fonteDestinoId),
  ]);
  const erros = {};

  if (!categoria) erros.categoriaId = 'Categoria não encontrada.';
  else if (categoria.tipo !== d.tipo) {
    erros.categoriaId = `A categoria informada é de ${NOME_TIPO[categoria.tipo]}, mas o lançamento é de ${NOME_TIPO[d.tipo]}.`;
  }

  if (!fonte) erros.fonteDestinoId = 'Fonte/destino não encontrada.';
  else if (fonte.tipo === 'renda' && d.tipo === 'saida') {
    erros.fonteDestinoId = 'Uma fonte de renda só pode ser usada em entradas.';
  } else if (fonte.tipo === 'cartao_credito' && d.tipo === 'entrada') {
    erros.fonteDestinoId = 'Cartão de crédito só pode ser usado em saídas.';
  }

  const parcelado = atual ? atual.totalParcelas > 1 : d.parcelas > 1;
  if (parcelado && fonte && fonte.tipo !== 'cartao_credito' && !erros.fonteDestinoId) {
    erros[atual ? 'fonteDestinoId' : 'parcelas'] = atual
      ? 'Este lançamento é uma parcela: o destino precisa continuar sendo um cartão de crédito.'
      : 'Parcelamento só é permitido em saídas no cartão de crédito.';
  }

  if (Object.keys(erros).length) throw new ErroValidacao(erros);
}

// GET /api/lancamentos?inicio=&fim=&tipo=&categoriaId=&fonteDestinoId=&pagina=&porPagina=
router.get('/', validarPeriodo, rota(async (req, res) => {
  const q = req.query;
  const erros = {};
  const filtros = { ...req.periodo, pagina: 1, porPagina: 20 };

  if (q.tipo) {
    if (!['entrada', 'saida'].includes(q.tipo)) erros.tipo = 'O tipo deve ser "entrada" ou "saida".';
    else filtros.tipo = q.tipo;
  }
  for (const campo of ['categoriaId', 'fonteDestinoId']) {
    if (q[campo]) {
      filtros[campo] = paraId(q[campo]);
      if (!filtros[campo]) erros[campo] = 'Identificador inválido.';
    }
  }
  if (q.pagina) {
    filtros.pagina = inteiroPositivo(q.pagina);
    if (!filtros.pagina) erros.pagina = 'Página inválida.';
  }
  if (q.porPagina) {
    filtros.porPagina = inteiroPositivo(q.porPagina);
    if (!filtros.porPagina || filtros.porPagina > 100) erros.porPagina = 'Use de 1 a 100 itens por página.';
  }
  if (Object.keys(erros).length) throw new ErroValidacao(erros);

  res.json({ periodo: req.periodo, ...(await Lancamento.listar(req.usuarioId, filtros)) });
}));

router.get('/:id', validarId, rota(async (req, res) => {
  const lancamento = await Lancamento.buscar(req.usuarioId, req.params.id);
  if (!lancamento) throw naoEncontrado();
  res.json(lancamento);
}));

// POST: cria 1 lançamento ou N parcelas (transação). Responde com a lista criada.
router.post('/', validarLancamento, rota(async (req, res) => {
  await validarRelacionamentos(req.usuarioId, req.dados);
  const criados = await Lancamento.criar(req.usuarioId, req.dados);
  res.status(201).json({ lancamentos: criados });
}));

// PUT: atualiza UM lançamento (uma parcela, se for parcelado), com as mesmas validações da inserção.
// O número de parcelas não é alterado aqui: para re-parcelar, exclua a compra e lance de novo.
async function atualizar(req, res) {
  const atual = await Lancamento.buscar(req.usuarioId, req.params.id);
  if (!atual) throw naoEncontrado();
  const informado = req.body?.parcelas ?? req.body?.totalParcelas;
  if (informado !== undefined && Number(informado) !== atual.totalParcelas) {
    throw new ErroValidacao({ parcelas: 'O número de parcelas não pode ser alterado. Exclua a compra e lance novamente.' });
  }
  await validarRelacionamentos(req.usuarioId, req.dados, atual);
  res.json(await Lancamento.atualizar(req.usuarioId, req.params.id, atual, req.dados));
}
router.put('/:id', validarId, validarLancamento, rota(atualizar));

// DELETE /api/lancamentos/:id?todasParcelas=true → exclui todas as parcelas da compra
router.delete('/:id', validarId, rota(async (req, res) => {
  const todas = req.query.todasParcelas === 'true' || req.query.todasParcelas === '1';
  const excluidos = await Lancamento.excluir(req.usuarioId, req.params.id, todas);
  if (!excluidos) throw naoEncontrado();
  res.status(204).end();
}));

module.exports = router;
