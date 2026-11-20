const express = require('express');
const Categoria = require('../models/Categoria');
const autenticar = require('../middlewares/autenticar');
const { validarCategoria, validarId } = require('../middlewares/validacao');
const { ErroHttp, ErroValidacao, rota } = require('../middlewares/erros');

const router = express.Router();
router.use(autenticar);

const naoEncontrada = () => new ErroHttp(404, 'Categoria não encontrada.');

// GET /api/categorias?tipo=entrada|saida
router.get('/', rota(async (req, res) => {
  const { tipo } = req.query;
  if (tipo !== undefined && !['entrada', 'saida'].includes(tipo)) {
    throw new ErroValidacao({ tipo: 'O tipo deve ser "entrada" ou "saida".' });
  }
  res.json(await Categoria.listar(req.usuarioId, tipo));
}));

router.get('/:id', validarId, rota(async (req, res) => {
  const categoria = await Categoria.buscar(req.usuarioId, req.params.id);
  if (!categoria) throw naoEncontrada();
  res.json(categoria);
}));

router.post('/', validarCategoria, rota(async (req, res) => {
  res.status(201).json(await Categoria.criar(req.usuarioId, req.dados));
}));

router.put('/:id', validarId, validarCategoria, rota(async (req, res) => {
  const atual = await Categoria.buscar(req.usuarioId, req.params.id);
  if (!atual) throw naoEncontrada();
  // trocar o tipo deixaria lançamentos com categoria de tipo diferente
  if (atual.tipo !== req.dados.tipo && (await Categoria.contarLancamentos(req.usuarioId, req.params.id)) > 0) {
    throw new ErroHttp(409, 'Não é possível alterar o tipo de uma categoria que já possui lançamentos.', {
      tipo: 'A categoria possui lançamentos; o tipo não pode ser alterado.',
    });
  }
  res.json(await Categoria.atualizar(req.usuarioId, req.params.id, req.dados));
}));

router.delete('/:id', validarId, rota(async (req, res) => {
  const categoria = await Categoria.buscar(req.usuarioId, req.params.id);
  if (!categoria) throw naoEncontrada();
  const n = await Categoria.contarLancamentos(req.usuarioId, req.params.id);
  if (n > 0) {
    throw new ErroHttp(409, `A categoria "${categoria.nome}" possui ${n} lançamento(s) e não pode ser excluída. Mova ou exclua os lançamentos antes.`);
  }
  await Categoria.excluir(req.usuarioId, req.params.id);
  res.status(204).end();
}));

module.exports = router;
