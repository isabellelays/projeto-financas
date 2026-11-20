// Carrega backend/.env independentemente da pasta de onde o processo foi iniciado
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

module.exports = {
  porta: Number(process.env.PORT) || 3001,
  origemCors: process.env.CORS_ORIGIN || 'http://localhost:5173',
  jwtSegredo: process.env.JWT_SECRET,
  jwtExpiracao: process.env.JWT_EXPIRES_IN || '1h',
  limiteTentativasAuth: Number(process.env.RATE_LIMIT_AUTH) || 20,
};
