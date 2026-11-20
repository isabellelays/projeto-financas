import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Uso: <Route element={<RotaProtegida />}> ...rotas privadas... </Route>
export default function RotaProtegida() {
  const { autenticado, carregando } = useAuth();
  const local = useLocation();

  if (carregando) return <p style={{ padding: 24 }}>Carregando...</p>;
  if (!autenticado) return <Navigate to="/login" replace state={{ de: local }} />;
  return <Outlet />;
}
