import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';

const estiloInput = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' };
const estiloBtn = (color = '#e63946') => ({ padding: '10px 20px', background: color, color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' });

const ROL_COLOR = { Jefe: { bg: '#fde8ea', color: '#e63946' }, Operario: { bg: '#e8f4fd', color: '#1a6fa8' } };

export default function Usuarios() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ email: '', nombre: '', pin: '', rol: 'Operario' });
  const [pinEditar, setPinEditar] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => api.get('/api/auth/usuarios').then(r => r.data.usuarios),
  });

  const crear = useMutation({
    mutationFn: () => api.post('/api/auth/usuarios', form),
    onSuccess: () => {
      toast.success('Usuario creado');
      setForm({ email: '', nombre: '', pin: '', rol: 'Operario' });
      setMostrarForm(false);
      qc.invalidateQueries(['usuarios']);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Error al crear usuario'),
  });

  const actualizar = useMutation({
    mutationFn: ({ id, datos }) => api.patch(`/api/auth/usuarios/${id}`, datos),
    onSuccess: () => {
      toast.success('Usuario actualizado');
      setEditando(null);
      setPinEditar('');
      qc.invalidateQueries(['usuarios']);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Error al actualizar'),
  });

  const usuarios = data || [];

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <header style={{ background: '#1a1a2e', color: '#fff', padding: '1rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '18px' }}>Gestión de Usuarios</h1>
        <button
          onClick={() => { setMostrarForm(!mostrarForm); setEditando(null); }}
          style={{ ...estiloBtn('#2a7a4f'), marginLeft: 'auto', padding: '8px 16px', fontSize: '13px' }}
        >
          {mostrarForm ? 'Cancelar' : '+ Nuevo usuario'}
        </button>
      </header>

      <main style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>

        {/* Formulario nuevo usuario */}
        {mostrarForm && (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '1.5rem' }}>
            <h2 style={{ marginTop: 0, fontSize: '16px' }}>Nuevo Usuario</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Email</label>
                <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="usuario@empresa.com" style={estiloInput} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Nombre</label>
                <input value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Nombre completo" style={estiloInput} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>PIN</label>
                <input type="password" value={form.pin} onChange={e => setForm(p => ({ ...p, pin: e.target.value }))} placeholder="4-6 dígitos" maxLength={6} style={estiloInput} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Rol</label>
                <select value={form.rol} onChange={e => setForm(p => ({ ...p, rol: e.target.value }))} style={{ ...estiloInput }}>
                  <option value="Operario">Operario</option>
                  <option value="Jefe">Jefe</option>
                </select>
              </div>
            </div>
            <button
              onClick={() => crear.mutate()}
              disabled={!form.email || !form.pin || crear.isPending}
              style={{ ...estiloBtn(), opacity: (!form.email || !form.pin) ? 0.5 : 1 }}
            >
              {crear.isPending ? 'Creando...' : 'Crear usuario'}
            </button>
          </div>
        )}

        {/* Lista de usuarios */}
        {isLoading && <p style={{ color: '#888' }}>Cargando usuarios...</p>}

        {usuarios.map(u => (
          <div key={u.id} style={{ background: '#fff', borderRadius: '12px', padding: '1.25rem 1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '0.75rem' }}>
            {editando === u.id ? (
              // Modo edición
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Nombre</label>
                    <input
                      defaultValue={u.nombre}
                      id={`nombre-${u.id}`}
                      style={estiloInput}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Nuevo PIN (dejar vacío para no cambiar)</label>
                    <input type="password" value={pinEditar} onChange={e => setPinEditar(e.target.value)} placeholder="Nuevo PIN" maxLength={6} style={estiloInput} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Rol</label>
                    <select defaultValue={u.rol} id={`rol-${u.id}`} style={{ ...estiloInput }}>
                      <option value="Operario">Operario</option>
                      <option value="Jefe">Jefe</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Estado</label>
                    <select defaultValue={u.activo.toString()} id={`activo-${u.id}`} style={{ ...estiloInput }}>
                      <option value="true">Activo</option>
                      <option value="false">Inactivo</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={() => { setEditando(null); setPinEditar(''); }} style={{ ...estiloBtn('#888'), padding: '8px 16px', fontSize: '13px' }}>Cancelar</button>
                  <button
                    onClick={() => {
                      const datos = {
                        nombre: document.getElementById(`nombre-${u.id}`).value,
                        rol: document.getElementById(`rol-${u.id}`).value,
                        activo: document.getElementById(`activo-${u.id}`).value === 'true',
                      };
                      if (pinEditar) datos.pin = pinEditar;
                      actualizar.mutate({ id: u.id, datos });
                    }}
                    disabled={actualizar.isPending}
                    style={{ ...estiloBtn('#2a7a4f'), padding: '8px 16px', fontSize: '13px' }}
                  >
                    {actualizar.isPending ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </div>
              </div>
            ) : (
              // Vista normal
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '4px' }}>
                    <strong style={{ fontSize: '15px' }}>{u.nombre || u.email}</strong>
                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: ROL_COLOR[u.rol]?.bg, color: ROL_COLOR[u.rol]?.color }}>
                      {u.rol}
                    </span>
                    {!u.activo && <span style={{ fontSize: '11px', color: '#888', background: '#f0f2f5', padding: '2px 8px', borderRadius: '4px' }}>Inactivo</span>}
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: '#888' }}>{u.email}</p>
                </div>
                <button
                  onClick={() => { setEditando(u.id); setMostrarForm(false); }}
                  style={{ padding: '6px 14px', background: '#f0f2f5', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
                >
                  Editar
                </button>
              </div>
            )}
          </div>
        ))}

        {!isLoading && usuarios.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#888' }}>
            <p>No hay usuarios. Crea el primero con el botón de arriba.</p>
          </div>
        )}
      </main>
    </div>
  );
}
