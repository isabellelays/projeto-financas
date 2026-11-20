const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const { transacao, paraId } = require('../config/db');
const env = require('../config/env');
const Usuario = require('../models/Usuario');
const Categoria = require('../models/Categoria');
const FonteDestino = require('../models/FonteDestino');
const autenticar = require('../middlewares/autenticar');
const { validarCadastro, validarLogin } = require('../middlewares/validacao');
const { ErroHttp, rota } = require('../middlewares/erros');

const router = express.Router();

// Rate limiting nas rotas públicas de autenticação (proteção contra força bruta)
const limitador = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.limiteTentativasAuth,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

const gerarToken = (usuario) =>
  jwt.sign({ sub: String(usuario.id) }, env.jwtSegredo, { expiresIn: env.jwtExpiracao });

// Hash usado quando o e-mail não existe, para o login levar o mesmo tempo nos dois casos
const HASH_FICTICIO = bcrypt.hashSync('senha-que-nao-existe-123', 10);

// RF1 — Cadastro: usuário + categorias e fontes/destinos padrão em uma única transação.
// E-mail/CPF duplicados: o índice único do banco lança 11000 → 409 com o campo (middleware de erros).
async function cadastrar(req, res) {
  const { nome, email, cpf, senha } = req.dados;
  const senhaHash = await bcrypt.hash(senha, 10);

  const usuario = await transacao(async (session) => {
    const u = await Usuario.criar(session, { nome, email, cpf, senhaHash });
    await Categoria.criarPadrao(session, paraId(u.id));
    await FonteDestino.criarPadrao(session, paraId(u.id));
    return u;
  });

  res.status(201).json({ usuario, token: gerarToken(usuario) });
}
router.post('/cadastro', limitador, validarCadastro, rota(cadastrar));
router.post('/registro', limitador, validarCadastro, rota(cadastrar)); // alias usado pelo front-end atual

// RF2 — Login: mensagem genérica, sem revelar se o e-mail existe
router.post('/login', limitador, validarLogin, rota(async (req, res) => {
  const { email, senha } = req.dados;
  const registro = await Usuario.buscarCredenciais(email);
  const confere = await bcrypt.compare(senha, registro?.senhaHash ?? HASH_FICTICIO);
  if (!registro || !confere) throw new ErroHttp(401, 'E-mail ou senha inválidos.');

  res.json({ usuario: registro.usuario, token: gerarToken(registro.usuario) });
}));

// Dados do usuário logado (usado pelo AuthContext ao recarregar a página)
router.get('/me', autenticar, rota(async (req, res) => {
  const usuario = await Usuario.buscarPorId(req.usuarioId);
  if (!usuario) throw new ErroHttp(401, 'Usuário não encontrado.');
  res.json({ usuario });
}));

module.exports = router;
