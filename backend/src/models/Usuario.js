const { colecao } = require('../config/db');

const usuarios = () => colecao('usuarios');

// senhaHash NUNCA sai daqui: nenhuma resposta da API devolve o hash
const publico = (d) => d && { id: d._id.toHexString(), nome: d.nome, email: d.email, cpf: d.cpf, criadoEm: d.criadoEm };

const Usuario = {
  /**
   * Insere o usuário. Duplicidade de e-mail/CPF é barrada pelos índices únicos
   * do banco (erro 11000 → 409 no middleware de erros).
   * @param session sessão da transação do cadastro
   */
  async criar(session, { nome, email, cpf, senhaHash }) {
    const doc = { nome, email, cpf, senhaHash, criadoEm: new Date() };
    const { insertedId } = await usuarios().insertOne(doc, { session });
    return publico({ ...doc, _id: insertedId });
  },

  /** Uso exclusivo do login: é a única consulta que lê o hash. */
  async buscarCredenciais(email) {
    const d = await usuarios().findOne({ email });
    return d ? { usuario: publico(d), senhaHash: d.senhaHash } : null;
  },

  async buscarPorId(id) {
    return publico(await usuarios().findOne({ _id: id }, { projection: { senhaHash: 0 } })) || null;
  },
};

module.exports = Usuario;
