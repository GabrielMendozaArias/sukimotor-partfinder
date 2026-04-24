import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

const TIPO_COLOR = {
  RECEPCION:    { bg: '#e8f4fd', color: '#1a6fa8', label: 'Recepción' },
  DESPACHO:     { bg: '#f0f8f0', color: '#2a7a4f', label: 'Despacho'  },
  VERIFICACION: { bg: '#fdf5e8', color: '#b07d10', label: 'Verificación' },
  CONTEO:       { bg: '#f5e8fd', color: '#7a2a9a', label: 'Conteo'    },
};

const ESTADO_COLOR = {
  COMPLETADO:  '#2a7a4f',
  EN_PROCESO:  '#e6a817',
  BORRADOR:    '#888',
  CANCELADO:   '#e63946',
  ANULADO:     '#e63946',
};

function formatFecha(iso) {
  return new Date(iso).toLocaleString('es-PA', { dateStyle: 'short', timeStyle: 'short' });
}

export default function Auditoria() {
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState('TODOS');

  const { data: resumenData, isLoading: resumenLoading } = useQuery({
    queryKey: ['auditoria-resumen'],
    queryFn: () => api.get('/api/auditorias/resumen').then(r => r.data),
    refetchInterval: 60000,
  });

  const { data: actividadData, isLoading: actLoading } = useQuery({
    queryKey: ['auditoria-actividad'],
    queryFn: () => api.get('/api/auditorias/actividad?limit=50').then(r => r.data.actividad),
    refetchInterval: 30000,
  });

  const actividad = actividadData || [];
  const filtrada = filtro === 'TODOS' ? actividad : actividad.filter(a => a.tipo === filtro);

  function imprimir() {
    window.print();
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <header className="no-print" style={{ background: '#1a1a2e', color: '#fff', padding: '1rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '18px' }}>Auditoría</h1>
        <button onClick={imprimir} style={{ marginLeft: 'auto', padding: '6px 16px', background: '#2a2a4e', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '13px' }}>
          Imprimir reporte
        </button>
      </header>

      <main style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>

        {/* Resumen del día */}
        <h2 style={{ fontSize: '15px', color: '#555', marginBottom: '1rem' }}>
          Actividad de hoy — {new Date().toLocaleDateString('es-PA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </h2>

        {resumenLoading ? (
          <p style={{ color: '#888' }}>Cargando resumen...</p>
        ) : resumenData && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Recepciones',    valor: resumenData.recepciones_hoy,    color: '#1a6fa8' },
              { label: 'Despachos',      valor: resumenData.despachos_hoy,      color: '#2a7a4f' },
              { label: 'Verificaciones', valor: resumenData.verificaciones_hoy, color: '#b07d10' },
              { label: 'Tasa promedio',  valor: resumenData.tasa_verificacion_promedio !== null ? `${resumenData.tasa_verificacion_promedio}%` : '—', color: '#7a2a9a' },
              { label: 'Conteos',        valor: resumenData.conteos_hoy,        color: '#555'    },
              { label: 'Logins',         valor: resumenData.logins_hoy,         color: '#888'    },
            ].map(({ label, valor, color }) => (
              <div key={label} style={{ background: '#fff', borderRadius: '10px', padding: '1rem', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
                <div style={{ fontSize: '26px', fontWeight: 700, color }}>{valor}</div>
                <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filtros */}
        <div className="no-print" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {['TODOS', 'RECEPCION', 'DESPACHO', 'VERIFICACION', 'CONTEO'].map(t => (
            <button
              key={t}
              onClick={() => setFiltro(t)}
              style={{
                padding: '6px 14px', border: 'none', borderRadius: '20px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                background: filtro === t ? '#1a1a2e' : '#e8e8e8',
                color: filtro === t ? '#fff' : '#555',
              }}
            >
              {t === 'TODOS' ? 'Todos' : TIPO_COLOR[t]?.label || t}
            </button>
          ))}
        </div>

        {/* Lista de actividad */}
        <div style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #f0f2f5' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>
              Actividad reciente {filtro !== 'TODOS' && `— ${TIPO_COLOR[filtro]?.label}`} ({filtrada.length})
            </h2>
          </div>

          {actLoading && <p style={{ padding: '1.5rem', color: '#888' }}>Cargando actividad...</p>}

          {!actLoading && filtrada.length === 0 && (
            <p style={{ padding: '1.5rem', color: '#888' }}>No hay actividad registrada.</p>
          )}

          {filtrada.map((item, i) => {
            const tipo = TIPO_COLOR[item.tipo] || { bg: '#f0f2f5', color: '#555', label: item.tipo };
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', padding: '12px 1.5rem', borderBottom: i < filtrada.length - 1 ? '1px solid #f0f2f5' : 'none' }}>
                <span style={{ background: tipo.bg, color: tipo.color, padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap', marginTop: '2px' }}>
                  {tipo.label}
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: '13px', color: '#1a1a2e' }}>{item.descripcion}</p>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#888' }}>
                    {item.usuario?.nombre || item.usuario?.email || 'Sistema'} · {formatFecha(item.fecha)}
                  </p>
                </div>
                {item.estado && (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: ESTADO_COLOR[item.estado] || '#888', whiteSpace: 'nowrap' }}>
                    {item.estado}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </main>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          header { display: none; }
        }
      `}</style>
    </div>
  );
}
