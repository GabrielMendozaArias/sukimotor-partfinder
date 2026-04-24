require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const partesRoutes = require('./routes/partes');
const geminiRoutes = require('./routes/gemini');

const app = express();

// Seguridad: headers HTTP
app.use(helmet());

// CORS: solo permitir el frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Parseo JSON
app.use(express.json());

// Logs de peticiones
app.use(morgan('dev'));

// Rate limiting general: 100 req/min por IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas peticiones, espera un momento' }
}));

// Rate limiting estricto para login: 10 intentos/15min
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos de login, espera 15 minutos' }
}));

// Rate limiting para Gemini: 50 req/hora por IP
app.use('/api/gemini', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: { error: 'Límite de consultas IA alcanzado, espera 1 hora' }
}));

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/partes', partesRoutes);
app.use('/api/gemini', geminiRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Manejo de rutas no encontradas
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Manejo de errores globales
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PartFinder API corriendo en puerto ${PORT}`);
  console.log(`Supabase: ${process.env.SUPABASE_URL}`);
});
