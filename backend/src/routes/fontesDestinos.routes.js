const express = require('express');
const FonteDestino = require('../models/FonteDestino');
const autenticar = require('../middlewares/autenticar');
const { validarFonteDestino, validarId } = require('../middlewares/validacao');
const { ErroHttp, ErroValidacao, rota } = require('../middlewares/erros');

const router = express.Router();
router.use(autenticar);

const TIPOS = ['renda', 'conta', 'cartao_credito'];
const naoEncontrada = () => new ErroHttp(404, 'Fonte/destino não encontrada.');

// GET /api/fontes-destinos?tipo=renda|conta|cartao_credito
router.get('/', rota(async (req, res) => {
  const { tipo } = req.query;
  if (tipo !== undefined && !TIPOS.includes(tipo)) {
    throw new ErroValidacao({ tipo: 'O tipo deve ser "renda", "conta" ou "cartao_credito".' });
  }
  res.json(await FonteDestino.listar(req.usuarioId, tipo));
}));

router.get('/:id', validarId, rota(async (req, res) => {
  const fd = await FonteDestino.buscar(req.usuarioId, req.params.id);
  if (!fd) throw naoEncontrada();
  res.json(fd);
}));

router.post('/', validarFonteDestino, rota(async (req, res) => {
  res.status(201).json(await FonteDestino.criar(req.usuarioId, req.dados));
}));

router.put('/:id', validarId, validarFonteDestino, rota(async (req, res) => {
  const atual = await FonteDestino.buscar(req.usuarioId, req.params.id);
  if (!atual) throw naoEncontrada();

  // A troca de tipo não pode deixar lançamentos existentes incoerentes
  if (atual.tipo !== req.dados.tipo) {
    const uso = await FonteDestino.resumoLancamentos(req.usuarioId, req.params.id);
    const novo = req.dados.tipo;
    const conflito =
      (novo === 'renda' && uso.saidas > 0) ||
      (novo === 'cartao_credito' && uso.entradas > 0) ||
      (atual.tipo === 'cartao_credito' && uso.parcelados > 0);
    if (conflito) {
      throw new ErroHttp(409, 'O tipo não pode ser alterado: há lançamentos incompatíveis com o novo tipo.', {
        tipo: 'Há lançamentos incompatíveis com o novo tipo.',
      });
    }
  }
  res.json(await FonteDestino.atualizar(req.usuarioId, req.params.id, req.dados));
}));

router.delete('/:id', validarId, rota(async (req, res) => {
  const fd = await FonteDestino.buscar(req.usuarioId, req.params.id);
  if (!fd) throw naoEncontrada();
  const { total } = await FonteDestino.resumoLancamentos(req.usuarioId, req.params.id);
  if (total > 0) {
    throw new ErroHttp(409, `"${fd.nome}" possui ${total} lançamento(s) vinculado(s) e não pode ser excluída.`);
  }
  await FonteDestino.excluir(req.usuarioId, req.params.id);
  res.status(204).end();
}));

module.exports = router;
