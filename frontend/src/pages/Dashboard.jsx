import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const modulos = [
  { id: 'busqueda',      label: 'Búsqueda',      emoji: '🔍', ruta: '/busqueda',      roles: ['Jefe', 'Operario'] },
  { id: 'recepcion',     label: 'Recepción',     emoji: '📦', ruta: '/recepcion',     roles: ['Jefe', 'Operario'] },
  { id: 'despacho',      label: 'Despacho',      emoji: '🚚', ruta: '/despacho',      roles: ['Jefe', 'Operario'] },
  { id: 'verificacion',  label: 'Verificación',  emoji: '✅', ruta: '/verificacion',  roles: ['Jefe', 'Operario'] },
  { id: 'conteo',        label: 'Conteo Físico', emoji: '🔢', ruta: '/conteo',        roles: ['Jefe', 'Operario'] },
  { id: 'auditoria',     label: 'Auditoría',     emoji: '📋', ruta: '/auditoria',     roles: ['Jefe'] },
];

export default function Dashboard() {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
    toast.success('Sesión cerrada');
  }

  const modulosVisibles = modulos.filter(m => m.roles.includes(usuario?.rol));

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <header style={{ background: '#1a1a2e', color: '#fff', padding: '1rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '20px' }}>PartFinder SukiMotor</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '14px' }}>{usuario?.nombre || usuario?.email} · <strong>{usuario?.rol}</strong></span>
          <button onClick={handleLogout} style={{ padding: '6px 14px', background: '#e63946', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '13px' }}>
            Cerrar sesión
          </button>
        </div>
      </header>

      <main style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
        <h2 style={{ marginBottom: '1.5rem', color: '#1a1a2e' }}>Módulos</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
          {modulosVisibles.map(m => (
            <button
              key={m.id}
              onClick={() => navigate(m.ruta)}
              style={{ padding: '2rem 1rem', background: '#fff', border: '2px solid #e8e8e8', borderRadius: '12px', cursor: 'pointer', fontSize: '15px', fontWeight: 600, color: '#1a1a2e', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', transition: 'border-color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#e63946'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#e8e8e8'}
            >
              <span style={{ fontSize: '2rem' }}>{m.emoji}</span>
              {m.label}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
