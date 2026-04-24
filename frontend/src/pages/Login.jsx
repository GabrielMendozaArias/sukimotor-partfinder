import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setCargando(true);
    try {
      const usuario = await login(email, pin);
      toast.success(`Bienvenido, ${usuario.nombre || usuario.email}`);
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Credenciales inválidas');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <div style={{ background: '#fff', padding: '2rem', borderRadius: '12px', boxShadow: '0 2px 16px rgba(0,0,0,0.1)', width: '100%', maxWidth: '360px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '1.5rem', color: '#1a1a2e' }}>
          PartFinder SukiMotor
        </h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 600 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }}
              placeholder="usuario@suz.com.pa"
            />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 600 }}>PIN</label>
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              required
              maxLength={6}
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }}
              placeholder="••••"
            />
          </div>
          <button
            type="submit"
            disabled={cargando}
            style={{ width: '100%', padding: '12px', background: '#e63946', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: cargando ? 'not-allowed' : 'pointer', opacity: cargando ? 0.7 : 1 }}
          >
            {cargando ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
