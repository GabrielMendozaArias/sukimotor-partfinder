// En local carga .env desde la raíz del proyecto; en Railway las vars vienen del entorno
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes         = require('./routes/auth');
const partesRoutes       = require('./routes/partes');
const geminiRoutes       = require('./routes/gemini');
const recepcionesRoutes  = require('./routes/recepciones');
const despachosRoutes    = require('./routes/despachos');
const verificacionesRoutes = require('./routes/verificaciones');
const conteosRoutes      = require('./routes/conteos');
const auditoriasRoutes   = require('./routes/auditorias');
const compatRoutes       = require('./routes/compat');

const app = express();

// Seguridad: headers HTTP (relajado para servir el HTML original con scripts inline)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS: permitir cualquier origen (el frontend se sirve desde el mismo servidor)
app.use(cors({ origin: '*', credentials: false }));

// Parseo JSON (límite aumentado para fotos en auditoría)
app.use(express.json({ limit: '10mb' }));

// Logs de peticiones
app.use(morgan('dev'));

// Rate limiting general
app.use(rateLimit({ windowMs: 60 * 1000, max: 200, message: { error: 'Demasiadas peticiones' } }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Demasiados intentos de login' } }));
app.use('/api/gemini', rateLimit({ windowMs: 60 * 60 * 1000, max: 100, message: { error: 'Límite de consultas IA alcanzado' } }));

// API routes
app.use('/api/auth',          authRoutes);
app.use('/api/partes',        partesRoutes);
app.use('/api/gemini',        geminiRoutes);
app.use('/api/recepciones',   recepcionesRoutes);
app.use('/api/despachos',     despachosRoutes);
app.use('/api/verificaciones',verificacionesRoutes);
app.use('/api/conteos',       conteosRoutes);
app.use('/api/auditorias',    auditoriasRoutes);
app.use('/api/compat',        compatRoutes);

// Servir archivos estáticos (gasCompat.js y otros assets)
app.use(express.static(path.join(__dirname, '../public')));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

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
