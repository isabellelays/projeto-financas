import { useEffect, useState } from 'react';
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';
import api from '../services/api';

const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const COR = { bom: '#16a34a', atencao: '#f59e0b', critico: '#dc2626', indefinido: '#9ca3af' };
const ROTULO = { bom: 'Ótimo', atencao: 'Atenção', critico: 'Crítico', indefinido: 'Sem dados' };

function mesAtual() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
}

export default function SaudeFinanceira() {
  const [mes, setMes] = useState(mesAtual);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;
    setErro('');
    api.get('/relatorios/saude-financeira', { mes })
      .then((d) => ativo && setDados(d))
      .catch((e) => ativo && setErro(e.message));
    return () => { ativo = false; };
  }, [mes]);

  const corScore = dados?.score == null ? COR.indefinido : dados.score >= 80 ? COR.bom : dados.score >= 50 ? COR.atencao : COR.critico;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1>Saúde financeira</h1>
      <label>Mês<br /><input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></label>

      {erro && <p role="alert" style={{ color: '#dc2626' }}>{erro}</p>}
      {!dados && !erro && <p>Carregando...</p>}

      {dados && (
        <>
          <section style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', margin: '24px 0' }}>
            <div style={{ width: 220, height: 220, position: 'relative' }}>
              <ResponsiveContainer>
                <RadialBarChart innerRadius="75%" outerRadius="100%" data={[{ nome: 'Score', valor: dados.score ?? 0 }]} startAngle={90} endAngle={-270}>
                  <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                  <RadialBar dataKey="valor" background cornerRadius={10} fill={corScore} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: 40, fontWeight: 700, color: corScore }}>{dados.score ?? '—'}</div>
                  <div style={{ textTransform: 'capitalize' }}>{dados.classificacao}</div>
                </div>
              </div>
            </div>

            <div>
              <p>Receitas: <strong>{brl(dados.receitas)}</strong></p>
              <p>Despesas: <strong>{brl(dados.despesas)}</strong></p>
              <p>Saldo do mês: <strong style={{ color: dados.saldo >= 0 ? COR.bom : COR.critico }}>{brl(dados.saldo)}</strong></p>
            </div>
          </section>

          <section>
            <h2>Indicadores</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              {dados.indicadores.map((i) => (
                <article key={i.id} style={{ border: `2px solid ${COR[i.status]}`, borderRadius: 8, padding: 16 }}>
                  <h3 style={{ margin: 0 }}>{i.nome}</h3>
                  <p style={{ fontSize: 28, margin: '8px 0', fontWeight: 700 }}>{i.valor === null ? '—' : `${i.valor}%`}</p>
                  <p style={{ margin: 0 }}>
                    <span style={{ color: COR[i.status], fontWeight: 600 }}>{ROTULO[i.status]}</span>
                    {' · meta '}{i.sentido === 'min' ? '≥' : '≤'} {i.meta}%
                  </p>
                  <p style={{ color: '#6b7280', fontSize: 14 }}>{i.dica}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
