const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const { naoEncontrado, tratarErros } = require('./middlewares/erros');
const { client } = require('./config/db');

if (!env.jwtSegredo) {
  console.error('JWT_SECRET não definido. Copie .env.example para .env e preencha.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: env.origemCors })); // CORS restrito à origem do front-end
app.use(express.json({ limit: '100kb' }));

app.get('/api/status', (req, res) => res.json({ ok: true }));

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/categorias', require('./routes/categorias.routes'));
app.use('/api/fontes-destinos', require('./routes/fontesDestinos.routes'));
app.use('/api/lancamentos', require('./routes/lancamentos.routes'));
app.use('/api/relatorios', require('./routes/relatorios.routes'));
app.use('/api/saude-financeira', require('./routes/saudeFinanceira.routes'));

app.use(naoEncontrado);
app.use(tratarErros); // tratamento de erros centralizado

if (require.main === module) {
  // conecta ao MongoDB antes de aceitar requisições (falha cedo se a URI/senha estiver errada)
  client
    .connect()
    .then(() => app.listen(env.porta, () => console.log(`API rodando em http://localhost:${env.porta}`)))
    .catch((e) => {
      console.error('Não foi possível conectar ao MongoDB:', e.message);
      process.exit(1);
    });
}

module.exports = app;
