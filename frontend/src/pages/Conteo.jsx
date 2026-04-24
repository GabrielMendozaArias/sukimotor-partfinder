import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';

const estiloInput = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' };
const estiloBtn = (color = '#e63946') => ({ padding: '10px 20px', background: color, color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' });

export default function Conteo() {
  const navigate = useNavigate();

  const [conteoActivo, setConteoActivo] = useState(null);
  const [ubicacion, setUbicacion] = useState('');
  const [codigo, setCodigo] = useState('');
  const [cantidad, setCantidad] = useState('');

  const { data: itemsData, refetch } = useQuery({
    queryKey: ['conteo-items', conteoActivo?.id],
    queryFn: () => api.get(`/api/conteos/${conteoActivo.id}/items`).then(r => r.data.items),
    enabled: !!conteoActivo,
  });

  const crearConteo = useMutation({
    mutationFn: () => api.post('/api/conteos', { ubicacion }),
    onSuccess: ({ data }) => {
      setConteoActivo(data.conteo);
      toast.success(`Conteo ${data.conteo.id_conteo} iniciado`);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Error al crear conteo'),
  });

  const registrarItem = useMutation({
    mutationFn: () => api.post(`/api/conteos/${conteoActivo.id}/items`, {
      codigo, cantidad_fisica: parseInt(cantidad)
    }),
    onSuccess: ({ data }) => {
      const item = data.item;
      const diff = item.diferencia;
      if (diff === null) toast.success(`${codigo} registrado (sin dato en sistema)`);
      else if (diff === 0) toast.success(`${codigo} — Sin diferencia`);
      else if (diff > 0) toast(`${codigo} — Sobrante: +${diff}`, { icon: '⚠️' });
      else toast(`${codigo} — Faltante: ${diff}`, { icon: '🔴' });
      setCodigo(''); setCantidad('');
      refetch();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Error al registrar'),
  });

  const completar = useMutation({
    mutationFn: () => api.patch(`/api/conteos/${conteoActivo.id}/completar`),
    onSuccess: () => {
      toast.success('Conteo completado');
      navigate('/');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Error al completar'),
  });

  const items = itemsData || [];
  const conDiferencia = items.filter(i => i.diferencia !== 0 && i.diferencia !== null);
  const sinDatos = items.filter(i => i.cantidad_sistema === null);

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <header style={{ background: '#1a1a2e', color: '#fff', padding: '1rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '18px' }}>Conteo Físico</h1>
        {conteoActivo && (
          <span style={{ marginLeft: 'auto', fontSize: '13px', background: '#2a2a4e', padding: '4px 12px', borderRadius: '6px' }}>
            {conteoActivo.id_conteo}
          </span>
        )}
      </header>

      <main style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>

        {/* Crear conteo */}
        {!conteoActivo && (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <h2 style={{ marginTop: 0, fontSize: '16px' }}>Nuevo Conteo Físico</h2>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>
                Ubicación <span style={{ fontWeight: 400, color: '#888' }}>(opcional — dejar vacío para conteo general)</span>
              </label>
              <input value={ubicacion} onChange={e => setUbicacion(e.target.value.toUpperCase())} placeholder="A-01-B-02-1" style={estiloInput} />
            </div>
            <button onClick={() => crearConteo.mutate()} disabled={crearConteo.isPending} style={estiloBtn()}>
              {crearConteo.isPending ? 'Iniciando...' : 'Iniciar Conteo'}
            </button>
          </div>
        )}

        {/* Registrar items */}
        {conteoActivo && (
          <>
            <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '1rem' }}>
              <h2 style={{ marginTop: 0, fontSize: '16px' }}>Registrar Cantidad</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Código</label>
                  <input
                    value={codigo}
                    onChange={e => setCodigo(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === 'Enter' && document.getElementById('cantidadInput')?.focus()}
                    placeholder="18137-93J01-000"
                    style={estiloInput}
                    autoFocus
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Cantidad</label>
                  <input
                    id="cantidadInput"
                    type="number"
                    min="0"
                    value={cantidad}
                    onChange={e => setCantidad(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && codigo && cantidad !== '' && registrarItem.mutate()}
                    style={estiloInput}
                  />
                </div>
              </div>
              <button
                onClick={() => registrarItem.mutate()}
                disabled={!codigo || cantidad === '' || registrarItem.isPending}
                style={{ ...estiloBtn('#1a6fa8'), opacity: (!codigo || cantidad === '') ? 0.5 : 1 }}
              >
                {registrarItem.isPending ? 'Registrando...' : '+ Registrar'}
              </button>
            </div>

            {/* Tabla de resultados */}
            {items.length > 0 && (
              <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h2 style={{ margin: 0, fontSize: '16px' }}>Resultados ({items.length})</h2>
                  {conDiferencia.length > 0 && (
                    <span style={{ fontSize: '13px', color: '#e63946', fontWeight: 600 }}>
                      {conDiferencia.length} diferencia{conDiferencia.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #f0f2f5' }}>
                        <th style={{ textAlign: 'left', padding: '6px 0', color: '#555' }}>Código</th>
                        <th style={{ textAlign: 'center', padding: '6px', color: '#555' }}>Sistema</th>
                        <th style={{ textAlign: 'center', padding: '6px', color: '#555' }}>Físico</th>
                        <th style={{ textAlign: 'center', padding: '6px', color: '#555' }}>Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => {
                        const diff = item.diferencia;
                        const diffColor = diff === null ? '#888' : diff === 0 ? '#2a7a4f' : diff > 0 ? '#e6a817' : '#e63946';
                        return (
                          <tr key={item.id} style={{ borderBottom: '1px solid #f0f2f5' }}>
                            <td style={{ padding: '8px 0', fontWeight: 600 }}>{item.codigo}</td>
                            <td style={{ textAlign: 'center', padding: '8px', color: '#555' }}>
                              {item.cantidad_sistema ?? '—'}
                            </td>
                            <td style={{ textAlign: 'center', padding: '8px' }}>{item.cantidad_fisica}</td>
                            <td style={{ textAlign: 'center', padding: '8px', fontWeight: 700, color: diffColor }}>
                              {diff === null ? '—' : diff === 0 ? '✓' : diff > 0 ? `+${diff}` : diff}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {sinDatos.length > 0 && (
                  <p style={{ margin: '0.75rem 0 0', fontSize: '12px', color: '#888' }}>
                    {sinDatos.length} código{sinDatos.length > 1 ? 's' : ''} sin datos en el sistema (nuevos o no registrados)
                  </p>
                )}
              </div>
            )}

            {/* Acciones */}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => { if (confirm('¿Cancelar este conteo?')) navigate('/'); }} style={{ ...estiloBtn('#888'), flex: 1 }}>
                Cancelar
              </button>
              <button
                onClick={() => { if (items.length === 0) return toast.error('Registra al menos una parte'); completar.mutate(); }}
                disabled={completar.isPending}
                style={{ ...estiloBtn(), flex: 2 }}
              >
                {completar.isPending ? 'Completando...' : `Completar Conteo (${items.length} partes)`}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
