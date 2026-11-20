/**
 * Tratamento de erros centralizado. Toda resposta de erro segue o formato:
 *   { "erro": "mensagem", "campos": { "campo": "mensagem do campo" } }   (campos é opcional)
 */
class ErroHttp extends Error {
  constructor(status, mensagem, campos) {
    super(mensagem);
    this.status = status;
    this.campos = campos;
  }
}

/** 400 com mensagens por campo. */
class ErroValidacao extends ErroHttp {
  constructor(campos, mensagem = 'Dados inválidos.') {
    super(400, mensagem, campos);
  }
}

// Constraint UNIQUE violada → campo e mensagem devolvidos ao front-end (409)
const UNICIDADE = {
  usuarios_email_uk: ['email', 'Já existe um usuário com este e-mail.'],
  usuarios_cpf_uk: ['cpf', 'Já existe um usuário com este CPF.'],
  categorias_nome_uk: ['nome', 'Você já tem uma categoria com este nome e tipo.'],
  fontes_destinos_nome_uk: ['nome', 'Você já tem uma fonte/destino com este nome.'],
};

/** Envolve handlers async do Express 4 para que erros cheguem ao middleware de erro. */
const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function naoEncontrado(req, res) {
  res.status(404).json({ erro: 'Rota não encontrada.' });
}

// eslint-disable-next-line no-unused-vars
function tratarErros(err, req, res, next) {
  if (err instanceof ErroHttp) {
    const corpo = { erro: err.message };
    if (err.campos) corpo.campos = err.campos;
    return res.status(err.status).json(corpo);
  }

  // MongoDB 11000: violação de índice único. A mensagem traz o nome do índice:
  // "E11000 duplicate key error collection: financas.usuarios index: usuarios_email_uk dup key: ..."
  if (err.code === 11000) {
    const indice = /index: (\S+)/.exec(err.message ?? '')?.[1];
    const [campo, msg] = UNICIDADE[indice] || [];
    return res.status(409).json(campo ? { erro: msg, campos: { [campo]: msg } } : { erro: 'Registro já existe.' });
  }
  // MongoDB 121: documento rejeitado pelo validador $jsonSchema da coleção
  if (err.code === 121) {
    return res.status(400).json({ erro: 'Dados inválidos.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON malformado.' });
  }

  console.error(err);
  return res.status(500).json({ erro: 'Erro interno do servidor.' });
}

module.exports = { ErroHttp, ErroValidacao, rota, naoEncontrado, tratarErros };
