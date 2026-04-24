import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';

const estiloInput = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' };
const estiloBtn = (color = '#e63946') => ({ padding: '10px 20px', background: color, color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' });

const ETAPAS = { UBICACION: 'UBICACION', ESCANEO: 'ESCANEO', RESULTADO: 'RESULTADO' };

export default function Verificacion() {
  const navigate = useNavigate();

  const [etapa, setEtapa] = useState(ETAPAS.UBICACION);
  const [ubicacion, setUbicacion] = useState('');
  const [codigoInput, setCodigoInput] = useState('');
  const [escaneados, setEscaneados] = useState([]);
  const [resultado, setResultado] = useState(null);

  const verificar = useMutation({
    mutationFn: () => api.post('/api/verificaciones', {
      ubicacion: ubicacion.toUpperCase(),
      codigos_escaneados: escaneados
    }),
    onSuccess: ({ data }) => {
      setResultado(data);
      setEtapa(ETAPAS.RESULTADO);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Error al verificar'),
  });

  const tomarAccion = useMutation({
    mutationFn: ({ codigo, accion }) =>
      api.patch(`/api/verificaciones/${resultado.verificacion.id}/accion`, { codigo, accion }),
    onSuccess: (_, { codigo, accion }) => {
      toast.success(`${accion === 'AGREGAR' ? 'Parte agregada al inventario' : 'Ignorado'}: ${codigo}`);
      setResultado(prev => ({
        ...prev,
        intrusos: prev.intrusos.filter(c => c !== codigo)
      }));
    },
    onError: () => toast.error('Error al procesar acción'),
  });

  function agregarCodigo() {
    const c = codigoInput.trim().toUpperCase();
    if (!c) return;
    if (escaneados.includes(c)) return toast.error('Código ya agregado');
    setEscaneados(prev => [...prev, c]);
    setCodigoInput('');
  }

  function quitarCodigo(c) {
    setEscaneados(prev => prev.filter(x => x !== c));
  }

  const tasaColor = resultado?.tasa_exito >= 90 ? '#2a7a4f' : resultado?.tasa_exito >= 70 ? '#e6a817' : '#e63946';

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <header style={{ background: '#1a1a2e', color: '#fff', padding: '1rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '18px' }}>Verificación de Ubicación</h1>
        {ubicacion && etapa !== ETAPAS.UBICACION && (
          <span style={{ marginLeft: 'auto', fontSize: '13px', background: '#2a2a4e', padding: '4px 12px', borderRadius: '6px' }}>
            {ubicacion}
          </span>
        )}
      </header>

      <main style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>

        {/* ETAPA 1: Ingresar ubicación */}
        {etapa === ETAPAS.UBICACION && (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <h2 style={{ marginTop: 0, fontSize: '16px' }}>Seleccionar Ubicación</h2>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Código de Ubicación</label>
              <input
                value={ubicacion}
                onChange={e => setUbicacion(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && ubicacion && setEtapa(ETAPAS.ESCANEO)}
                placeholder="A-01-B-02-1"
                style={estiloInput}
                autoFocus
              />
            </div>
            <button
              onClick={() => setEtapa(ETAPAS.ESCANEO)}
              disabled={!ubicacion}
              style={{ ...estiloBtn(), opacity: !ubicacion ? 0.5 : 1 }}
            >
              Iniciar Verificación
            </button>
          </div>
        )}

        {/* ETAPA 2: Escanear códigos */}
        {etapa === ETAPAS.ESCANEO && (
          <>
            <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '1rem' }}>
              <h2 style={{ marginTop: 0, fontSize: '16px' }}>Escanear Códigos en {ubicacion}</h2>
              <p style={{ fontSize: '13px', color: '#888', margin: '0 0 1rem' }}>
                Ingresa cada código encontrado físicamente en esta ubicación.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  value={codigoInput}
                  onChange={e => setCodigoInput(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && agregarCodigo()}
                  placeholder="Escanea o digita el código"
                  style={{ ...estiloInput, flex: 1 }}
                  autoFocus
                />
                <button onClick={agregarCodigo} style={estiloBtn('#2a7a4f')}>+ Agregar</button>
              </div>
            </div>

            {escaneados.length > 0 && (
              <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '1rem' }}>
                <h2 style={{ marginTop: 0, fontSize: '16px' }}>Códigos escaneados ({escaneados.length})</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {escaneados.map(c => (
                    <span key={c} style={{ background: '#f0f2f5', padding: '4px 10px', borderRadius: '6px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {c}
                      <button onClick={() => quitarCodigo(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e63946', fontWeight: 700, fontSize: '14px', padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => setEtapa(ETAPAS.UBICACION)} style={{ ...estiloBtn('#888'), flex: 1 }}>← Atrás</button>
              <button
                onClick={() => verificar.mutate()}
                disabled={escaneados.length === 0 || verificar.isPending}
                style={{ ...estiloBtn(), flex: 2, opacity: escaneados.length === 0 ? 0.5 : 1 }}
              >
                {verificar.isPending ? 'Verificando...' : `Verificar (${escaneados.length} códigos)`}
              </button>
            </div>
          </>
        )}

        {/* ETAPA 3: Resultados */}
        {etapa === ETAPAS.RESULTADO && resultado && (
          <>
            {/* Resumen */}
            <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0, fontSize: '16px' }}>Resultado — {ubicacion}</h2>
                <span style={{ fontSize: '24px', fontWeight: 700, color: tasaColor }}>{resultado.tasa_exito}%</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', textAlign: 'center' }}>
                {[
                  { label: 'Válidos', valor: resultado.validados.length, color: '#2a7a4f', bg: '#e8f5ee' },
                  { label: 'Intrusos', valor: resultado.intrusos.length, color: '#e63946', bg: '#fde8ea' },
                  { label: 'Ausentes', valor: resultado.ausentes.length, color: '#e6a817', bg: '#fdf5e8' },
                ].map(({ label, valor, color, bg }) => (
                  <div key={label} style={{ background: bg, borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '22px', fontWeight: 700, color }}>{valor}</div>
                    <div style={{ fontSize: '12px', color: '#555' }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Intrusos — requieren acción */}
            {resultado.intrusos.length > 0 && (
              <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '1rem' }}>
                <h2 style={{ marginTop: 0, fontSize: '16px', color: '#e63946' }}>Intrusos — Tomar Acción</h2>
                {resultado.intrusos.map(codigo => (
                  <div key={codigo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f2f5' }}>
                    <strong style={{ fontSize: '14px' }}>{codigo}</strong>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => tomarAccion.mutate({ codigo, accion: 'AGREGAR' })}
                        style={{ ...estiloBtn('#2a7a4f'), padding: '6px 12px', fontSize: '12px' }}
                      >
                        Agregar a inventario
                      </button>
                      <button
                        onClick={() => tomarAccion.mutate({ codigo, accion: 'IGNORAR' })}
                        style={{ ...estiloBtn('#888'), padding: '6px 12px', fontSize: '12px' }}
                      >
                        Ignorar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Ausentes */}
            {resultado.ausentes.length > 0 && (
              <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '1rem' }}>
                <h2 style={{ marginTop: 0, fontSize: '16px', color: '#e6a817' }}>Ausentes</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {resultado.ausentes.map(c => (
                    <span key={c} style={{ background: '#fdf5e8', color: '#b07d10', padding: '4px 10px', borderRadius: '6px', fontSize: '13px' }}>{c}</span>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => navigate('/')} style={{ ...estiloBtn(), width: '100%' }}>
              Finalizar
            </button>
          </>
        )}
      </main>
    </div>
  );
}
