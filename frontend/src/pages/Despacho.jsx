import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';

const estiloInput = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' };
const estiloBtn = (color = '#e63946') => ({ padding: '10px 20px', background: color, color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' });

export default function Despacho() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [despachoActivo, setDespachoActivo] = useState(null);
  const [cliente, setCliente] = useState('');
  const [ordenRef, setOrdenRef] = useState('');
  const [codigo, setCodigo] = useState('');
  const [cantidad, setCantidad] = useState('1');

  const { data: itemsData, refetch: refetchItems } = useQuery({
    queryKey: ['despacho-items', despachoActivo?.id],
    queryFn: () => api.get(`/api/despachos/${despachoActivo.id}/items`).then(r => r.data.items),
    enabled: !!despachoActivo,
    refetchInterval: 5000,
  });

  const crearDespacho = useMutation({
    mutationFn: () => api.post('/api/despachos', { cliente, orden_ref: ordenRef }),
    onSuccess: ({ data }) => {
      setDespachoActivo(data.despacho);
      toast.success(`Despacho ${data.despacho.id_despacho} creado`);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Error al crear despacho'),
  });

  const agregarItem = useMutation({
    mutationFn: () => api.post(`/api/despachos/${despachoActivo.id}/items`, {
      codigo, cantidad: parseInt(cantidad)
    }),
    onSuccess: () => {
      toast.success(`${codigo} agregado`);
      setCodigo(''); setCantidad('1');
      refetchItems();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Error al agregar item'),
  });

  const toggleItem = useMutation({
    mutationFn: ({ itemId, encontrado, recogido }) =>
      api.patch(`/api/despachos/${despachoActivo.id}/items/${itemId}`, { encontrado, recogido }),
    onSuccess: () => refetchItems(),
    onError: () => toast.error('Error al actualizar item'),
  });

  const completar = useMutation({
    mutationFn: () => api.patch(`/api/despachos/${despachoActivo.id}/completar`),
    onSuccess: () => {
      toast.success('Despacho completado');
      qc.invalidateQueries(['despachos']);
      navigate('/');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Error al completar'),
  });

  const items = itemsData || [];
  const recogidos = items.filter(i => i.recogido).length;

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <header style={{ background: '#1a1a2e', color: '#fff', padding: '1rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '18px' }}>Despacho</h1>
        {despachoActivo && (
          <span style={{ marginLeft: 'auto', fontSize: '13px', background: '#2a2a4e', padding: '4px 12px', borderRadius: '6px' }}>
            {despachoActivo.id_despacho}
          </span>
        )}
      </header>

      <main style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>

        {/* PASO 1: Crear despacho */}
        {!despachoActivo && (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <h2 style={{ marginTop: 0, fontSize: '16px' }}>Nuevo Despacho</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Cliente</label>
                <input value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Nombre del cliente" style={estiloInput} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>N° Orden / Referencia</label>
                <input value={ordenRef} onChange={e => setOrdenRef(e.target.value)} placeholder="ORD-001" style={estiloInput} />
              </div>
              <button
                onClick={() => crearDespacho.mutate()}
                disabled={!cliente || crearDespacho.isPending}
                style={{ ...estiloBtn(), opacity: !cliente ? 0.5 : 1 }}
              >
                {crearDespacho.isPending ? 'Creando...' : 'Iniciar Despacho'}
              </button>
            </div>
          </div>
        )}

        {/* PASO 2: Agregar y gestionar items */}
        {despachoActivo && (
          <>
            {/* Agregar item */}
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
              <button
                onClick={() => agregarItem.mutate()}
                disabled={!codigo || !cantidad || agregarItem.isPending}
                style={{ ...estiloBtn('#1a6fa8'), opacity: (!codigo || !cantidad) ? 0.5 : 1 }}
              >
                {agregarItem.isPending ? 'Agregando...' : '+ Agregar a despacho'}
              </button>
            </div>

            {/* Lista de items con control de recolección */}
            {items.length > 0 && (
              <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h2 style={{ margin: 0, fontSize: '16px' }}>Lista de Picking ({items.length})</h2>
                  <span style={{ fontSize: '13px', color: recogidos === items.length ? '#2a7a4f' : '#888' }}>
                    {recogidos}/{items.length} recogidos
                  </span>
                </div>
                {items.map((item, i) => (
                  <div key={item.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '10px 0', borderBottom: i < items.length - 1 ? '1px solid #f0f2f5' : 'none',
                    opacity: item.recogido ? 0.5 : 1
                  }}>
                    <input
                      type="checkbox"
                      checked={item.recogido}
                      onChange={() => toggleItem.mutate({ itemId: item.id, encontrado: true, recogido: !item.recogido })}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontSize: '14px', textDecoration: item.recogido ? 'line-through' : 'none' }}>
                        {item.codigo}
                      </strong>
                      {item.ubicacion && (
                        <span style={{ marginLeft: '8px', fontSize: '12px', background: '#e8f4fd', color: '#1a6fa8', padding: '2px 6px', borderRadius: '4px' }}>
                          {item.ubicacion}
                        </span>
                      )}
                      {item.descripcion && <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#888' }}>{item.descripcion}</p>}
                    </div>
                    <span style={{ fontSize: '14px', fontWeight: 600 }}>{item.cantidad} uds</span>
                  </div>
                ))}
              </div>
            )}

            {/* Acciones */}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => { if (confirm('¿Cancelar este despacho?')) navigate('/'); }}
                style={{ ...estiloBtn('#888'), flex: 1 }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (items.length === 0) return toast.error('Agrega al menos un item');
                  if (recogidos < items.length) return toast.error(`Faltan ${items.length - recogidos} items por recoger`);
                  completar.mutate();
                }}
                disabled={completar.isPending}
                style={{ ...estiloBtn(), flex: 2 }}
              >
                {completar.isPending ? 'Completando...' : `Completar Despacho (${recogidos}/${items.length})`}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
