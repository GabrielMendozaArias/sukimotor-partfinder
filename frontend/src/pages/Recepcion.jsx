import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';

const estiloInput = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' };
const estiloBtn = (color = '#e63946') => ({ padding: '10px 20px', background: color, color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' });

export default function Recepcion() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Paso 1: datos de la recepción
  const [recepcionActiva, setRecepcionActiva] = useState(null);
  const [factura, setFactura] = useState('');
  const [proveedor, setProveedor] = useState('');

  // Paso 2: agregar items
  const [codigo, setCodigo] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [ubicacion, setUbicacion] = useState('');

  const { data: itemsData, refetch: refetchItems } = useQuery({
    queryKey: ['recepcion-items', recepcionActiva?.id],
    queryFn: () => api.get(`/api/recepciones/${recepcionActiva.id}/items`).then(r => r.data.items),
    enabled: !!recepcionActiva,
  });

  const crearRecepcion = useMutation({
    mutationFn: () => api.post('/api/recepciones', { factura, proveedor }),
    onSuccess: ({ data }) => {
      setRecepcionActiva(data.recepcion);
      toast.success(`Recepción ${data.recepcion.id_recepcion} creada`);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Error al crear recepción'),
  });

  const agregarItem = useMutation({
    mutationFn: () => api.post(`/api/recepciones/${recepcionActiva.id}/items`, {
      codigo, cantidad: parseInt(cantidad), ubicacion
    }),
    onSuccess: () => {
      toast.success(`${codigo} agregado`);
      setCodigo(''); setCantidad(''); setUbicacion('');
      refetchItems();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Error al agregar item'),
  });

  const completar = useMutation({
    mutationFn: () => api.patch(`/api/recepciones/${recepcionActiva.id}/completar`),
    onSuccess: () => {
      toast.success('Recepción completada');
      qc.invalidateQueries(['recepciones']);
      navigate('/');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Error al completar'),
  });

  const items = itemsData || [];

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <header style={{ background: '#1a1a2e', color: '#fff', padding: '1rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '18px' }}>Recepción de Mercancía</h1>
        {recepcionActiva && (
          <span style={{ marginLeft: 'auto', fontSize: '13px', background: '#2a2a4e', padding: '4px 12px', borderRadius: '6px' }}>
            {recepcionActiva.id_recepcion}
          </span>
        )}
      </header>

      <main style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>

        {/* PASO 1: Crear recepción */}
        {!recepcionActiva && (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <h2 style={{ marginTop: 0, fontSize: '16px' }}>Nueva Recepción</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>N° Factura</label>
                <input value={factura} onChange={e => setFactura(e.target.value)} placeholder="FAC-001" style={estiloInput} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Proveedor</label>
                <input value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="Suzuki de Panama" style={estiloInput} />
              </div>
              <button
                onClick={() => crearRecepcion.mutate()}
                disabled={!factura || crearRecepcion.isPending}
                style={{ ...estiloBtn(), opacity: !factura ? 0.5 : 1 }}
              >
                {crearRecepcion.isPending ? 'Creando...' : 'Iniciar Recepción'}
              </button>
            </div>
          </div>
        )}

        {/* PASO 2: Agregar items */}
        {recepcionActiva && (
          <>
            <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '1rem' }}>
              <h2 style={{ marginTop: 0, fontSize: '16px' }}>Agregar Parte</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Código</label>
                  <input value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} placeholder="18137-93J01-000" style={estiloInput} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Cantidad</label>
                  <input type="number" min="1" value={cantidad} onChange={e => setCantidad(e.target.value)} style={estiloInput} />
                </div>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Ubicación</label>
                <input value={ubicacion} onChange={e => setUbicacion(e.target.value.toUpperCase())} placeholder="A-01-B-02-1" style={estiloInput} />
              </div>
              <button
                onClick={() => agregarItem.mutate()}
                disabled={!codigo || !cantidad || agregarItem.isPending}
                style={{ ...estiloBtn('#2a7a4f'), opacity: (!codigo || !cantidad) ? 0.5 : 1 }}
              >
                {agregarItem.isPending ? 'Agregando...' : '+ Agregar'}
              </button>
            </div>

            {/* Lista de items */}
            {items.length > 0 && (
              <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '1rem' }}>
                <h2 style={{ marginTop: 0, fontSize: '16px' }}>Items ({items.length})</h2>
                {items.map((item, i) => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < items.length - 1 ? '1px solid #f0f2f5' : 'none' }}>
                    <div>
                      <strong style={{ fontSize: '14px' }}>{item.codigo}</strong>
                      {item.ubicacion && <span style={{ marginLeft: '8px', fontSize: '12px', color: '#888' }}>{item.ubicacion}</span>}
                    </div>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#2a7a4f' }}>{item.cantidad} uds</span>
                  </div>
                ))}
              </div>
            )}

            {/* Completar */}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => { if (confirm('¿Cancelar esta recepción?')) navigate('/'); }}
                style={{ ...estiloBtn('#888'), flex: 1 }}
              >
                Cancelar
              </button>
              <button
                onClick={() => { if (items.length === 0) return toast.error('Agrega al menos un item'); completar.mutate(); }}
                disabled={completar.isPending}
                style={{ ...estiloBtn(), flex: 2 }}
              >
                {completar.isPending ? 'Completando...' : `Completar Recepción (${items.length} items)`}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
