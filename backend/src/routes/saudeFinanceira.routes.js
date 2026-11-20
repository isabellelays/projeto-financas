const express = require('express');
const SaudeFinanceira = require('../models/SaudeFinanceira');
const autenticar = require('../middlewares/autenticar');
const { rota } = require('../middlewares/erros');

const router = express.Router();
router.use(autenticar);

// Desafio — GET /api/saude-financeira
router.get('/', rota(async (req, res) => {
  res.json(await SaudeFinanceira.calcular(req.usuarioId));
}));

module.exports = router;
