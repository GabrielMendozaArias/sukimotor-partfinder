-- ============================================================
-- SUKIMOTOR PartFinder - Esquema de base de datos
-- Migración desde Google Sheets a PostgreSQL (Supabase)
-- ============================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USUARIOS Y AUTENTICACIÓN
-- ============================================================
CREATE TABLE usuarios (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT UNIQUE NOT NULL,
  pin_hash    TEXT NOT NULL,
  pin_salt    TEXT NOT NULL,
  nombre      TEXT,
  rol         TEXT NOT NULL CHECK (rol IN ('Jefe', 'Operario')) DEFAULT 'Operario',
  activo      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE log_sesiones (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  email       TEXT,
  accion      TEXT NOT NULL, -- 'LOGIN', 'LOGOUT', 'TIMEOUT'
  session_id  TEXT,
  device_key  TEXT,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INVENTARIO Y UBICACIONES
-- ============================================================
CREATE TABLE marcas (
  id     SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL  -- Suzuki, Haojue, SYM, Loncin, Fuego, etc.
);

INSERT INTO marcas (nombre) VALUES
  ('Suzuki'), ('Haojue'), ('SYM'), ('Loncin'), ('Fuego'),
  ('Suzuki Marine'), ('Club Car'), ('Genérico');

CREATE TABLE ubicaciones (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_ubicacion TEXT UNIQUE NOT NULL,  -- ej: "A-01-B-02-1"
  zona             TEXT,
  pasillo          TEXT,
  anaquel          TEXT,
  rack             TEXT,
  nivel            TEXT,
  estado           TEXT DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'INACTIVO', 'BLOQUEADO')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE partes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo           TEXT UNIQUE NOT NULL,
  codigo_limpio    TEXT,                  -- código normalizado sin guiones extra
  descripcion      TEXT,
  marca_id         INTEGER REFERENCES marcas(id) ON DELETE SET NULL,
  activo           BOOLEAN DEFAULT true,
  -- Caché de la respuesta Gemini para evitar llamadas repetidas
  gemini_descripcion TEXT,
  gemini_cached_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Una parte puede estar en hasta 5 ubicaciones
CREATE TABLE parte_ubicaciones (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parte_id      UUID NOT NULL REFERENCES partes(id) ON DELETE CASCADE,
  ubicacion_id  UUID NOT NULL REFERENCES ubicaciones(id) ON DELETE CASCADE,
  orden         INTEGER NOT NULL CHECK (orden BETWEEN 1 AND 5),
  cantidad      INTEGER DEFAULT 0 CHECK (cantidad >= 0),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (parte_id, orden)
);

-- ============================================================
-- RECEPCIONES
-- ============================================================
CREATE TABLE recepciones (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_recepcion TEXT UNIQUE NOT NULL,   -- ej: "REC-20240115-001"
  factura      TEXT,
  proveedor    TEXT,
  usuario_id   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  estado       TEXT DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR', 'COMPLETADO', 'ANULADO')),
  observaciones TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE detalles_recepcion (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recepcion_id   UUID NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
  parte_id       UUID REFERENCES partes(id) ON DELETE SET NULL,
  codigo         TEXT NOT NULL,
  cantidad       INTEGER NOT NULL CHECK (cantidad > 0),
  descripcion    TEXT,
  ubicacion      TEXT,
  observaciones  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DESPACHOS
-- ============================================================
CREATE TABLE despachos (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_despacho  TEXT UNIQUE NOT NULL,   -- ej: "DSP-20240115-001"
  cliente      TEXT,
  orden_ref    TEXT,
  usuario_id   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  estado       TEXT DEFAULT 'EN_PROCESO' CHECK (estado IN ('EN_PROCESO', 'COMPLETADO', 'CANCELADO')),
  observaciones TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE detalles_despacho (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  despacho_id   UUID NOT NULL REFERENCES despachos(id) ON DELETE CASCADE,
  parte_id      UUID REFERENCES partes(id) ON DELETE SET NULL,
  codigo        TEXT NOT NULL,
  cantidad      INTEGER NOT NULL CHECK (cantidad > 0),
  descripcion   TEXT,
  ubicacion     TEXT,
  encontrado    BOOLEAN DEFAULT false,
  recogido      BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VERIFICACIONES DE UBICACIÓN
-- ============================================================
CREATE TABLE verificaciones (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ubicacion_id  UUID REFERENCES ubicaciones(id) ON DELETE SET NULL,
  ubicacion     TEXT NOT NULL,
  usuario_id    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  tasa_exito    NUMERIC(5,2),            -- porcentaje 0-100
  total_esperados INTEGER DEFAULT 0,
  total_validados INTEGER DEFAULT 0,
  total_intrusos  INTEGER DEFAULT 0,
  total_ausentes  INTEGER DEFAULT 0,
  pdf_url       TEXT,                    -- URL del PDF generado
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE verificacion_detalles (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  verificacion_id  UUID NOT NULL REFERENCES verificaciones(id) ON DELETE CASCADE,
  codigo           TEXT NOT NULL,
  resultado        TEXT NOT NULL CHECK (resultado IN ('VALIDO', 'INTRUSO', 'AUSENTE')),
  accion_tomada    TEXT,                 -- 'AGREGAR', 'MARCAR_VALIDO', 'IGNORAR', 'ELIMINAR'
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDITORÍAS
-- ============================================================
CREATE TABLE auditorias (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_auditoria    TEXT UNIQUE NOT NULL,
  usuario_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo            TEXT NOT NULL,
  descripcion     TEXT,
  datos           JSONB,                 -- datos extra flexibles
  pdf_url         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONTEOS FÍSICOS
-- ============================================================
CREATE TABLE conteos (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_conteo    TEXT UNIQUE NOT NULL,
  usuario_id   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  ubicacion    TEXT,
  estado       TEXT DEFAULT 'EN_PROCESO' CHECK (estado IN ('EN_PROCESO', 'COMPLETADO')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE detalles_conteo (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conteo_id   UUID NOT NULL REFERENCES conteos(id) ON DELETE CASCADE,
  codigo      TEXT NOT NULL,
  cantidad_sistema   INTEGER,
  cantidad_fisica    INTEGER,
  diferencia         INTEGER GENERATED ALWAYS AS (cantidad_fisica - cantidad_sistema) STORED,
  observaciones TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES PARA PERFORMANCE
-- ============================================================
CREATE INDEX idx_partes_codigo       ON partes(codigo);
CREATE INDEX idx_partes_codigo_limpio ON partes(codigo_limpio);
CREATE INDEX idx_partes_marca        ON partes(marca_id);
CREATE INDEX idx_parte_ubicaciones_parte ON parte_ubicaciones(parte_id);
CREATE INDEX idx_parte_ubicaciones_ubic  ON parte_ubicaciones(ubicacion_id);
CREATE INDEX idx_log_sesiones_usuario    ON log_sesiones(usuario_id);
CREATE INDEX idx_log_sesiones_created    ON log_sesiones(created_at DESC);
CREATE INDEX idx_recepciones_estado      ON recepciones(estado);
CREATE INDEX idx_despachos_estado        ON despachos(estado);
CREATE INDEX idx_auditorias_tipo         ON auditorias(tipo);
CREATE INDEX idx_conteos_estado          ON conteos(estado);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE marcas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE log_sesiones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE partes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ubicaciones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE parte_ubicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE recepciones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalles_recepcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalles_despacho ENABLE ROW LEVEL SECURITY;
ALTER TABLE verificaciones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE verificacion_detalles ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditorias        ENABLE ROW LEVEL SECURITY;
ALTER TABLE conteos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalles_conteo   ENABLE ROW LEVEL SECURITY;

-- Política: marcas son de solo lectura para todos los autenticados
CREATE POLICY "autenticados_leen_marcas"
  ON marcas FOR SELECT
  USING (auth.role() = 'authenticated');

-- Política: usuarios autenticados pueden leer inventario y ubicaciones
CREATE POLICY "autenticados_leen_partes"
  ON partes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "autenticados_leen_ubicaciones"
  ON ubicaciones FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "autenticados_leen_parte_ubicaciones"
  ON parte_ubicaciones FOR SELECT
  USING (auth.role() = 'authenticated');

-- Política: solo Jefe puede ver todos los logs
-- Los operarios solo ven sus propios registros
CREATE POLICY "logs_propios_o_jefe"
  ON log_sesiones FOR SELECT
  USING (
    auth.uid()::text = usuario_id::text
    OR EXISTS (
      SELECT 1 FROM usuarios
      WHERE id::text = auth.uid()::text AND rol = 'Jefe'
    )
  );

-- ============================================================
-- FUNCIÓN: actualizar updated_at automáticamente
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_partes_updated_at
  BEFORE UPDATE ON partes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_parte_ubicaciones_updated_at
  BEFORE UPDATE ON parte_ubicaciones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
