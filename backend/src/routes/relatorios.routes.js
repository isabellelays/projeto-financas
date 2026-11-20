const express = require('express');
const Relatorio = require('../models/Relatorio');
const autenticar = require('../middlewares/autenticar');
const { validarPeriodo } = require('../middlewares/validacao');
const { ErroValidacao, rota } = require('../middlewares/erros');
const { adicionarMeses, hojeIso, mesDe } = require('../models/regras');

const router = express.Router();
router.use(autenticar);

// RF7 — GET /api/relatorios/categorias?inicio=&fim=
router.get('/categorias', validarPeriodo, rota(async (req, res) => {
  const { inicio, fim } = req.periodo;
  res.json(await Relatorio.porCategoria(req.usuarioId, inicio, fim));
}));

// RF8 — GET /api/relatorios/fontes-destinos?inicio=&fim=
router.get('/fontes-destinos', validarPeriodo, rota(async (req, res) => {
  const { inicio, fim } = req.periodo;
  res.json(await Relatorio.porFonteDestino(req.usuarioId, inicio, fim));
}));

// RF9 — GET /api/relatorios/faturas?meses=3  (fatura aberta + próximas `meses`, mínimo 3)
router.get('/faturas', rota(async (req, res) => {
  const meses = req.query.meses === undefined ? 3 : Number(req.query.meses);
  if (!Number.isInteger(meses) || meses < 3 || meses > 12) {
    throw new ErroValidacao({ meses: 'Informe de 3 a 12 meses.' });
  }
  res.json(await Relatorio.faturas(req.usuarioId, meses));
}));

// Extra — GET /api/relatorios/mensal?meses=6  (evolução de entradas × saídas, para o dashboard)
router.get('/mensal', rota(async (req, res) => {
  const meses = req.query.meses === undefined ? 6 : Number(req.query.meses);
  if (!Number.isInteger(meses) || meses < 1 || meses > 24) {
    throw new ErroValidacao({ meses: 'Informe de 1 a 24 meses.' });
  }
  const atual = mesDe(hojeIso());
  const inicio = adicionarMeses(atual.inicio, -(meses - 1));
  res.json({ meses: await Relatorio.mensal(req.usuarioId, inicio, atual.fim) });
}));

module.exports = router;
