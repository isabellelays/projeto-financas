import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { registrarAoDeslogar, tokenStore } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.clear();
    setUsuario(null);
  }, []);

  // 401 vindo de qualquer chamada → desloga
  useEffect(() => registrarAoDeslogar(logout), [logout]);

  // Restaura a sessão ao recarregar a página
  useEffect(() => {
    if (!tokenStore.get()) return;
    api.get('/auth/me')
      .then(({ usuario: u }) => setUsuario(u))
      .catch(() => logout())
      .finally(() => setCarregando(false));
  }, [logout]);

  const login = useCallback(async (email, senha) => {
    const { usuario: u, token } = await api.post('/auth/login', { email, senha });
    tokenStore.set(token);
    setUsuario(u);
    return u;
  }, []);

  const registrar = useCallback(async (dados) => {
    const { usuario: u, token } = await api.post('/auth/registro', dados);
    tokenStore.set(token);
    setUsuario(u);
    return u;
  }, []);

  const valor = useMemo(
    () => ({ usuario, autenticado: Boolean(usuario), carregando, login, registrar, logout }),
    [usuario, carregando, login, registrar, logout]
  );

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
