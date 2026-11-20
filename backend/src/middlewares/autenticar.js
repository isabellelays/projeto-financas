const jwt = require('jsonwebtoken');
const { jwtSegredo } = require('../config/env');
const { paraId } = require('../config/db');

/**
 * Exige "Authorization: Bearer <token>".
 * Sucesso: req.usuarioId = id do dono do token (única fonte do id do usuário na API).
 * Token ausente, inválido ou expirado → 401.
 */
function autenticar(req, res, next) {
  const [esquema, token] = (req.headers.authorization ?? '').split(' ');
  if (esquema !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Token não informado.' });
  }

  try {
    const payload = jwt.verify(token, jwtSegredo);
    const id = paraId(payload.sub);
    if (!id) throw new Error('sub inválido');
    req.usuarioId = id; // ObjectId do usuário
    return next();
  } catch {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

module.exports = autenticar;
