// Ponto único de acesso à API: injeta Authorization: Bearer e desloga em 401.
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const TOKEN_KEY = 'financas_token';

let aoDeslogar = () => {};

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// O AuthContext registra aqui o que fazer quando a API responde 401
export function registrarAoDeslogar(fn) {
  aoDeslogar = fn;
}

export class ErroApi extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

async function requisicao(metodo, caminho, { corpo, params } = {}) {
  const url = new URL(BASE_URL + caminho, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));

  const headers = { 'Content-Type': 'application/json' };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let resp;
  try {
    resp = await fetch(url, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
  } catch {
    throw new ErroApi(0, 'Não foi possível conectar ao servidor.');
  }

  const dados = await resp.json().catch(() => ({}));

  if (resp.status === 401 && token) {
    tokenStore.clear();
    aoDeslogar();
  }
  if (!resp.ok) throw new ErroApi(resp.status, dados.erro || 'Erro inesperado.');
  return dados;
}

const api = {
  get: (c, params) => requisicao('GET', c, { params }),
  post: (c, corpo) => requisicao('POST', c, { corpo }),
  put: (c, corpo) => requisicao('PUT', c, { corpo }),
  delete: (c) => requisicao('DELETE', c),
};

export default api;
