import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';

export default function Busqueda() {
  const navigate = useNavigate();
  const [termino, setTermino] = useState('');
  const [buscar, setBuscar] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['partes', buscar],
    queryFn: () => api.get(`/api/partes?q=${buscar}&limit=30`).then(r => r.data.partes),
    enabled: buscar.length >= 3,
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (termino.trim().length < 3) return toast.error('Ingresa al menos 3 caracteres');
    setBuscar(termino.trim().toUpperCase());
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <header style={{ background: '#1a1a2e', color: '#fff', padding: '1rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '18px' }}>Búsqueda de Partes</h1>
      </header>

      <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <input
            value={termino}
            onChange={e => setTermino(e.target.value)}
            placeholder="Código o descripción (ej: 18137-93J01)"
            style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}
          />
          <button type="submit" style={{ padding: '10px 20px', background: '#e63946', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
            Buscar
          </button>
        </form>

        {isFetching && <p style={{ color: '#888' }}>Buscando...</p>}

        {data?.length === 0 && <p style={{ color: '#888' }}>No se encontraron partes para "{buscar}"</p>}

        {data?.map(parte => (
          <div key={parte.id} style={{ background: '#fff', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '0.75rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <strong style={{ fontSize: '16px', color: '#1a1a2e' }}>{parte.codigo}</strong>
                {parte.marca && <span style={{ marginLeft: '8px', fontSize: '12px', background: '#f0f2f5', padding: '2px 8px', borderRadius: '4px', color: '#555' }}>{parte.marca.nombre}</span>}
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#555' }}>{parte.gemini_descripcion || parte.descripcion || '—'}</p>
              </div>
            </div>
            {parte.ubicaciones?.length > 0 && (
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {parte.ubicaciones.map(u => (
                  <span key={u.orden} style={{ fontSize: '12px', background: '#e8f4fd', color: '#1a6fa8', padding: '3px 8px', borderRadius: '4px' }}>
                    {u.ubicacion?.codigo_ubicacion} · {u.cantidad} uds
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </main>
    </div>
  );
}
