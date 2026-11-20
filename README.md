# Controle Financeiro — Projeto 2 (Full Stack)

API REST em **Node.js/Express + MongoDB** e SPA em **React (Vite)** para controle financeiro pessoal.

## Tecnologias

| Camada | Tecnologias |
|---|---|
| Back-end | Node.js ≥ 18, Express 4, driver oficial `mongodb` (pool de conexões), `bcrypt`, `jsonwebtoken`, `cors`, `express-rate-limit`, `dotenv` |
| Banco | MongoDB (MongoDB Atlas, plano gratuito M0) |
| Front-end | React 18, Vite, React Router, Recharts |

## Como rodar do zero

### 1. Banco de dados (MongoDB Atlas)

1. Peça ao grupo a *connection string* do cluster, ou crie um cluster gratuito no MongoDB Atlas.
2. No Atlas, em **Security → Network Access**, libere o IP do seu computador.

### 2. Back-end

```bash
cd backend
cp .env.example .env          # preencha MONGODB_URI e JWT_SECRET (openssl rand -hex 32)
npm install
npm run db:criar              # cria as coleções com validação e índices (APAGA os dados existentes)
npm run seed                  # 2 usuários + 3 meses de lançamentos (APAGA os dados existentes)
npm run dev                   # API em http://localhost:3001
npm test                      # testes das regras (CPF, faturas, parcelas)
```

Usuários do seed (senha `Senha123`): `ana@exemplo.com` e `bruno@exemplo.com`.

> Como o banco no Atlas é compartilhado pelo grupo, **`db:criar` e `seed` só devem ser rodados quando todos concordarem**, porque apagam os dados de todo mundo.

### 3. Front-end

```bash
cd frontend
cp .env.example .env          # VITE_API_URL=http://localhost:3001/api
npm install
npm run dev                   # http://localhost:5173
```

## Estrutura do back-end

```
backend/
├── .env.example
├── database/        criar.js (coleções, validadores e índices), seed.js
├── test/            testes das regras puras (node --test)
└── src/
    ├── server.js    app Express, middlewares, registro das rotas e conexão com o banco
    ├── routes/      rotas + controladores (não há pasta controllers)
    ├── models/      acesso ao banco e regras de negócio
    ├── middlewares/ autenticação JWT, validação/sanitização, erros centralizados
    └── config/      variáveis de ambiente e cliente/pool do MongoDB
```

As funções utilitárias puras (`cpfValido`, `calcularFatura`, `dividirEmParcelas`, datas e dinheiro) ficam em
`src/models/regras.js`, por serem regras de negócio do domínio.

## Modelo de dados (MongoDB)

| Coleção | Campos | Garantias no banco |
|---|---|---|
| `usuarios` | `nome, email, cpf, senhaHash, criadoEm` | índices **únicos** em `email` e `cpf`; e-mail em minúsculas e CPF só com dígitos (validador) |
| `categorias` | `usuarioId, nome, tipo` | `tipo ∈ {entrada, saida}`; índice único `(usuarioId, nome, tipo)` |
| `fontesDestinos` | `usuarioId, nome, tipo, diaFechamento, diaVencimento, limiteCentavos, reserva` | `tipo ∈ {renda, conta, cartao_credito}`; cartão **exige** fechamento, vencimento (1–31) e limite; índice único `(usuarioId, nome)` |
| `lancamentos` | `usuarioId, tipo, descricao, valorCentavos, data, dataCompra, categoriaId, fonteDestinoId, parcelaAtual, totalParcelas, grupoParcelamento` | `valorCentavos` inteiro ≥ 1; `totalParcelas` de 1 a 48; `parcelaAtual ≤ totalParcelas`; datas `AAAA-MM-DD` |

As regras ficam em validadores `$jsonSchema` criados por `database/criar.js`. Um documento inválido é recusado pelo próprio banco (erro 121), mesmo que passe pela API.

## Decisões de modelagem

- **Unicidade de e-mail e CPF** garantida pelo banco, com **índices únicos**. Antes de gravar, o e-mail é normalizado com `trim().toLowerCase()` e o CPF fica só com dígitos. Uma violação (erro `11000`) vira **409** com o campo duplicado em `campos`.
- **Dinheiro em centavos inteiros** (`valorCentavos`, `limiteCentavos`), uma das opções do enunciado. Nunca se usa `float`, e as somas dos relatórios são feitas em inteiros. O validador recusa valores não inteiros.
- **Relacionamentos** são referências `ObjectId` (`usuarioId`, `categoriaId`, `fonteDestinoId`). Como o MongoDB não tem chave estrangeira, **a API valida** em toda criação e edição que a categoria e a fonte/destino existem, pertencem ao usuário do token e são de tipo compatível. A exclusão de categoria ou fonte/destino com lançamentos é bloqueada (**409**).
- **Isolamento (RF3):** toda consulta filtra por `usuarioId`, que vem sempre do token (`req.usuarioId`). Um id de outro usuário resulta em **404**.
- **Datas** são guardadas como texto `AAAA-MM-DD`. Assim os filtros por período comparam em ordem, sem problemas de fuso horário.
- **Parcelamento:** o `POST` cria um documento por parcela, todos dentro de **uma transação** (`session.withTransaction`), com o mesmo `grupoParcelamento`. O valor é dividido em centavos e a diferença vai para a 1ª parcela (R$ 100,00 em 3× = 33,34 + 33,33 + 33,33). Cada parcela guarda:
  - `dataCompra`: a data da compra, igual em todas as parcelas. A fatura é calculada com `calcularFatura(dataCompra, cartão, parcelaAtual)`, a opção 1 do enunciado.
  - `data`: a data da compra + (k − 1) meses. Assim, listagens e relatórios mostram cada parcela no mês em que ela pesa no orçamento, e não a compra inteira no mês da compra.
- **Relatórios** são calculados no banco com *aggregation pipeline* (`$match`, `$group`, `$sum`, `$lookup`), e não somando listas no front-end.
- **Regras de fonte/destino:** uma fonte do tipo `renda` só aceita entradas. Um `cartao_credito` só aceita saídas e é o único que permite parcelas (2 a 48).
- **Faturas (RF9):** para cada cartão, a API mostra:
  - a fatura **fechada** ainda não vencida, se houver;
  - a fatura **aberta**;
  - as próximas `meses` faturas (padrão 3).

  O **limite utilizado** é a soma de todas as parcelas cujas faturas ainda não venceram.
- **Comparação com o período anterior (RF7):** quando o período é de meses inteiros, ele é comparado com os meses inteiros anteriores (outubro × setembro). Para outros períodos, a comparação usa o mesmo número de dias imediatamente antes.

## Rotas da API

Todas as rotas abaixo de `/api` exigem `Authorization: Bearer <token>`, exceto cadastro e login.
Os erros sempre seguem o formato `{ "erro": "...", "campos": { "campo": "mensagem" } }`.
Os ids são `ObjectId` do MongoDB, em texto com 24 caracteres hexadecimais.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/cadastro` | Cadastro: `nome, email, cpf, senha, confirmacaoSenha`. Cria as categorias e fontes padrão. Responde 201, 400 ou 409. |
| POST | `/api/auth/login` | Login: `email, senha`. Devolve `{ usuario, token }`; credenciais inválidas → 401 com mensagem genérica. |
| GET | `/api/auth/me` | Usuário logado. |
| GET / POST | `/api/categorias` | Lista (`?tipo=entrada\|saida`) / cria `{ nome, tipo }`. |
| GET / PUT / DELETE | `/api/categorias/:id` | Detalha / edita / exclui (409 se houver lançamentos). |
| GET / POST | `/api/fontes-destinos` | Lista (`?tipo=`) / cria `{ nome, tipo, diaFechamento, diaVencimento, limite, reserva }`. |
| GET / PUT / DELETE | `/api/fontes-destinos/:id` | Detalha / edita / exclui (409 se houver lançamentos). |
| GET | `/api/lancamentos?inicio=&fim=&tipo=&categoriaId=&fonteDestinoId=&pagina=&porPagina=` | Lista paginada com `totais` (entradas, saídas e saldo). O padrão é o mês corrente. |
| POST | `/api/lancamentos` | Cria `{ tipo, descricao, valor, data, categoriaId, fonteDestinoId, parcelas }` e devolve as parcelas criadas. |
| GET / PUT / DELETE | `/api/lancamentos/:id` | Detalha / edita (uma parcela) / exclui. Com `?todasParcelas=true`, exclui a compra inteira. |
| GET | `/api/relatorios/categorias?inicio=&fim=` | RF7: totais, percentuais e comparação com o período anterior. |
| GET | `/api/relatorios/fontes-destinos?inicio=&fim=` | RF8: entradas por fonte, saídas por destino e saldo das contas. |
| GET | `/api/relatorios/faturas?meses=3` | RF9: faturas e limites de todos os cartões. |
| GET | `/api/relatorios/mensal?meses=6` | Extra: entradas × saídas por mês (dashboard). |
| GET | `/api/saude-financeira` | Desafio: indicadores, projeção de 6 meses e dicas. |

## Saúde financeira: indicadores e limites das dicas

As médias usam os **3 meses completos** anteriores ao mês atual. Os limites estão em `src/models/SaudeFinanceira.js`, na constante `LIMITES`.

| Indicador | Cálculo | Limite para a dica |
|---|---|---|
| Taxa de poupança | (entradas − saídas) ÷ entradas | < 10% → atenção; < 0 → crítico; ≥ 20% → ótimo |
| Comprometimento com cartões | próximas 3 faturas ÷ (renda média × 3) | > 30% → atenção; > 50% → crítico |
| Parcelas futuras | soma das parcelas dos próximos 6 meses | sempre informa o total |
| Categoria fora da curva | gasto do mês × média dos 3 meses anteriores | > 30% acima **e** ≥ R$ 50 de diferença |
| Reserva de emergência | saldo das contas marcadas como `reserva` ÷ despesa média | < 3 meses → atenção (referência: 3 a 6 meses) |
| Projeção de saldo | entradas médias − (saídas médias sem parcelas + parcelas já conhecidas), acumulado por 6 meses | alerta se o saldo acumulado ficar negativo |

> As informações são educativas e não constituem recomendação financeira profissional.
