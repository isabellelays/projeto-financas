import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import api from '../services/api';

const CORES = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pad = (n) => String(n).padStart(2, '0');

function mesAtualIntervalo() {
  const h = new Date();
  const ultimo = new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate();
  return { inicio: `${h.getFullYear()}-${pad(h.getMonth() + 1)}-01`, fim: `${h.getFullYear()}-${pad(h.getMonth() + 1)}-${pad(ultimo)}` };
}

function Variacao({ valor, inverso = false }) {
  if (valor === null || valor === undefined) return <span>—</span>;
  const subiu = valor > 0;
  const ruim = inverso ? subiu : !subiu;
  const cor = valor === 0 ? '#6b7280' : ruim ? '#dc2626' : '#16a34a';
  return <span style={{ color: cor, fontWeight: 600 }}>{subiu ? '▲' : valor < 0 ? '▼' : '='} {Math.abs(valor).toFixed(1)}%</span>;
}

export default function Relatorios() {
  const [periodo, setPeriodo] = useState(mesAtualIntervalo);
  const [categorias, setCategorias] = useState([]);
  const [mensal, setMensal] = useState([]);
  const [comp, setComp] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro('');
    Promise.all([
      api.get('/relatorios/categorias', periodo),
      api.get('/relatorios/mensal', { meses: 6 }),
      api.get('/relatorios/comparativo', periodo),
    ])
      .then(([c, m, cmp]) => { if (ativo) { setCategorias(c.itens); setMensal(m.itens); setComp(cmp); } })
      .catch((e) => ativo && setErro(e.message))
      .finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, [periodo]);

  const totalDespesas = useMemo(() => categorias.reduce((a, c) => a + c.total, 0), [categorias]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1>Relatórios</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'end', marginBottom: 24 }}>
        <label>De<br />
          <input type="date" value={periodo.inicio} onChange={(e) => setPeriodo((p) => ({ ...p, inicio: e.target.value }))} />
        </label>
        <label>Até<br />
          <input type="date" value={periodo.fim} onChange={(e) => setPeriodo((p) => ({ ...p, fim: e.target.value }))} />
        </label>
      </div>

      {erro && <p role="alert" style={{ color: '#dc2626' }}>{erro}</p>}
      {carregando && <p>Carregando...</p>}

      {!carregando && !erro && (
        <>
          <section style={{ marginBottom: 32 }}>
            <h2>Despesas por categoria</h2>
            {categorias.length === 0 ? <p>Nenhuma despesa no período.</p> : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
                <div style={{ flex: '1 1 320px', height: 300 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={categorias} dataKey="total" nameKey="categoria" outerRadius={110} label={({ percentual }) => `${percentual}%`}>
                        {categorias.map((c, i) => <Cell key={c.categoria_id} fill={CORES[i % CORES.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => brl(v)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <table style={{ flex: '1 1 320px', borderCollapse: 'collapse' }}>
                  <thead><tr><th align="left">Categoria</th><th align="right">Total</th><th align="right">%</th></tr></thead>
                  <tbody>
                    {categorias.map((c) => (
                      <tr key={c.categoria_id}><td>{c.categoria}</td><td align="right">{brl(c.total)}</td><td align="right">{c.percentual}%</td></tr>
                    ))}
                    <tr style={{ fontWeight: 700 }}><td>Total</td><td align="right">{brl(totalDespesas)}</td><td /></tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={{ marginBottom: 32 }}>
            <h2>Receitas x despesas (últimos 6 meses)</h2>
            <div style={{ height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={mensal}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" />
                  <YAxis tickFormatter={(v) => `R$ ${v}`} width={80} />
                  <Tooltip formatter={(v) => brl(v)} />
                  <Legend />
                  <Bar dataKey="receitas" name="Receitas" fill="#16a34a" />
                  <Bar dataKey="despesas" name="Despesas" fill="#dc2626" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {comp && (
            <section>
              <h2>Comparativo com o período anterior</h2>
              <p style={{ color: '#6b7280' }}>
                {comp.periodo.inicio} a {comp.periodo.fim} vs {comp.periodoAnterior.inicio} a {comp.periodoAnterior.fim}
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr><th align="left"></th><th align="right">Atual</th><th align="right">Anterior</th><th align="right">Variação</th></tr>
                </thead>
                <tbody>
                  <tr><td>Receitas</td><td align="right">{brl(comp.atual.receitas)}</td><td align="right">{brl(comp.anterior.receitas)}</td><td align="right"><Variacao valor={comp.variacao.receitas} /></td></tr>
                  <tr><td>Despesas</td><td align="right">{brl(comp.atual.despesas)}</td><td align="right">{brl(comp.anterior.despesas)}</td><td align="right"><Variacao valor={comp.variacao.despesas} inverso /></td></tr>
                  <tr><td colSpan={4}><hr /></td></tr>
                  {comp.categorias.map((c) => (
                    <tr key={c.categoria_id}>
                      <td>{c.categoria}</td><td align="right">{brl(c.atual)}</td><td align="right">{brl(c.anterior)}</td>
                      <td align="right"><Variacao valor={c.variacao_pct} inverso /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
