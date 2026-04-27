-- ============================================================
-- Políticas para GAS con anon key (sb_publishable_*)
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Función segura de autenticación (bypasea RLS)
CREATE OR REPLACE FUNCTION get_user_for_auth(p_email TEXT)
RETURNS TABLE(
  id UUID, email TEXT, nombre TEXT, rol TEXT,
  pin_hash TEXT, pin_salt TEXT, activo BOOLEAN, permisos JSONB
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email, u.nombre, u.rol, u.pin_hash, u.pin_salt, u.activo, u.permisos
  FROM usuarios u WHERE u.email = lower(p_email);
END;
$$;

-- 2. Función para actualizar PIN desde GAS (bypasea RLS)
CREATE OR REPLACE FUNCTION update_user_pin(p_email TEXT, p_pin_hash TEXT, p_pin_salt TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE usuarios SET pin_hash = p_pin_hash, pin_salt = p_pin_salt WHERE email = lower(p_email);
  RETURN FOUND;
END;
$$;

-- 3. Función para crear/actualizar usuario desde GAS
CREATE OR REPLACE FUNCTION upsert_usuario(
  p_email TEXT, p_nombre TEXT, p_rol TEXT,
  p_pin_hash TEXT, p_pin_salt TEXT, p_activo BOOLEAN, p_permisos JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO usuarios(email, nombre, rol, pin_hash, pin_salt, activo, permisos)
  VALUES(lower(p_email), p_nombre, p_rol, p_pin_hash, p_pin_salt, p_activo, p_permisos)
  ON CONFLICT(email) DO UPDATE SET
    nombre=p_nombre, rol=p_rol, pin_hash=p_pin_hash,
    pin_salt=p_pin_salt, activo=p_activo, permisos=p_permisos;
  RETURN TRUE;
END;
$$;

-- 4. Políticas RLS para anon key en tablas operativas
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'partes','ubicaciones','parte_ubicaciones','marcas',
    'verificaciones','verificacion_detalles',
    'recepciones','detalles_recepcion',
    'despachos','detalles_despacho',
    'auditorias','conteos','detalles_conteo',
    'conteo_lotes','conteo_referencia','config_emails','log_sesiones'
  ] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS anon_all ON %I;
       CREATE POLICY anon_all ON %I FOR ALL TO anon USING (true) WITH CHECK (true);',
      t, t
    );
  END LOOP;
END $$;
