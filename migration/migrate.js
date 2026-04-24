require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const DATA_DIR = path.join(__dirname, 'data');

function leerCSV(archivo) {
  const ruta = path.join(DATA_DIR, archivo);
  if (!fs.existsSync(ruta)) {
    console.warn(`  ⚠️  Archivo no encontrado: ${archivo} — omitiendo`);
    return [];
  }
  const contenido = fs.readFileSync(ruta, 'utf8');
  return parse(contenido, { columns: true, skip_empty_lines: true, trim: true });
}

function limpiarCodigo(codigo) {
  return (codigo || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

// ──────────────────────────────────────────────
// 1. UBICACIONES
// ──────────────────────────────────────────────
async function migrarUbicaciones() {
  console.log('\n📦 Migrando Ubicaciones...');
  const filas = leerCSV('Ubicaciones.csv');
  if (!filas.length) return {};

  const mapa = {}; // codigo_ubicacion → id

  for (const fila of filas) {
    const codigo = (fila['Ubicación'] || fila['Ubicacion'] || '').trim().toUpperCase();
    if (!codigo) continue;

    const { data, error } = await supabase
      .from('ubicaciones')
      .upsert({
        codigo_ubicacion: codigo,
        zona:    (fila['Zona']    || '').trim() || null,
        pasillo: (fila['Pasillo'] || '').trim() || null,
        anaquel: (fila['Anaquel'] || '').trim() || null,
        rack:    (fila['Rack']    || '').trim() || null,
        nivel:   (fila['Nivel']   || '').trim() || null,
        estado:  ['ACTIVO', 'INACTIVO', 'BLOQUEADO'].includes((fila['Estado'] || '').trim().toUpperCase())
                   ? fila['Estado'].trim().toUpperCase() : 'ACTIVO'
      }, { onConflict: 'codigo_ubicacion' })
      .select('id, codigo_ubicacion')
      .single();

    if (error) { console.error(`  ✗ Ubicación ${codigo}:`, error.message); continue; }
    mapa[codigo] = data.id;
    process.stdout.write('.');
  }

  console.log(`\n  ✓ ${Object.keys(mapa).length} ubicaciones migradas`);
  return mapa;
}

// ──────────────────────────────────────────────
// 2. MARCAS (obtener IDs existentes)
// ──────────────────────────────────────────────
async function obtenerMarcas() {
  const { data } = await supabase.from('marcas').select('id, nombre');
  const mapa = {};
  (data || []).forEach(m => { mapa[m.nombre.toLowerCase()] = m.id; });
  return mapa;
}

// ──────────────────────────────────────────────
// 3. INVENTARIO
// ──────────────────────────────────────────────
async function migrarInventario(mapaUbicaciones, mapaMarcas) {
  console.log('\n🔧 Migrando Inventario...');
  const filas = leerCSV('Inventario.csv');
  if (!filas.length) return;

  let ok = 0, errores = 0;

  for (const fila of filas) {
    const codigo = (fila['Código'] || fila['Codigo'] || '').trim().toUpperCase();
    if (!codigo) continue;

    // Detectar marca
    const marcaNombre = (fila['Marca'] || '').trim().toLowerCase();
    const marcaId = mapaMarcas[marcaNombre] || null;

    // Insertar/actualizar parte
    const { data: parte, error } = await supabase
      .from('partes')
      .upsert({
        codigo,
        codigo_limpio: limpiarCodigo(codigo),
        descripcion: (fila['Descripción'] || fila['Descripcion'] || '').trim() || null,
        marca_id: marcaId,
      }, { onConflict: 'codigo' })
      .select('id')
      .single();

    if (error) { errores++; console.error(`\n  ✗ Parte ${codigo}:`, error.message); continue; }

    // Ubicaciones (hasta 5 columnas)
    const colsUbicacion = [
      'Ubicación Principal', 'Ubicación 2', 'Ubicación 3', 'Ubicación 4', 'Ubicación 5',
      'Ubicacion Principal', 'Ubicacion 2', 'Ubicacion 3', 'Ubicacion 4', 'Ubicacion 5',
    ];

    const ubicaciones = colsUbicacion
      .map(col => (fila[col] || '').trim().toUpperCase())
      .filter((u, i, arr) => u && arr.indexOf(u) === i) // únicas y no vacías
      .slice(0, 5);

    for (let i = 0; i < ubicaciones.length; i++) {
      const codigoUbic = ubicaciones[i];
      let ubicId = mapaUbicaciones[codigoUbic];

      // Crear ubicación si no existe
      if (!ubicId) {
        const { data: nueva } = await supabase
          .from('ubicaciones')
          .upsert({ codigo_ubicacion: codigoUbic }, { onConflict: 'codigo_ubicacion' })
          .select('id')
          .single();
        if (nueva) {
          mapaUbicaciones[codigoUbic] = nueva.id;
          ubicId = nueva.id;
        }
      }

      if (ubicId) {
        await supabase.from('parte_ubicaciones').upsert({
          parte_id: parte.id,
          ubicacion_id: ubicId,
          orden: i + 1,
          cantidad: 0
        }, { onConflict: 'parte_id,orden' });
      }
    }

    ok++;
    process.stdout.write('.');
  }

  console.log(`\n  ✓ ${ok} partes migradas, ${errores} errores`);
}

// ──────────────────────────────────────────────
// 4. USUARIOS
// ──────────────────────────────────────────────
async function migrarUsuarios() {
  console.log('\n👤 Migrando Usuarios...');
  const filas = leerCSV('Usuarios.csv');
  if (!filas.length) return;

  let ok = 0;

  for (const fila of filas) {
    const email = (fila['Email'] || '').trim().toLowerCase();
    const pin   = (fila['PIN']   || '').trim();
    const rol   = ['Jefe', 'Operario'].includes(fila['Rol']) ? fila['Rol'] : 'Operario';
    const activo = (fila['Activo'] || 'TRUE').toString().toUpperCase() !== 'FALSE';

    if (!email || !pin) continue;

    // Re-hashear PIN con bcrypt para la nueva arquitectura
    const salt    = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(pin + salt, salt);

    const { error } = await supabase.from('usuarios').upsert({
      email,
      pin_hash: pinHash,
      pin_salt: salt,
      nombre: (fila['Nombre'] || email.split('@')[0]).trim(),
      rol,
      activo,
    }, { onConflict: 'email' });

    if (error) { console.error(`  ✗ Usuario ${email}:`, error.message); continue; }
    ok++;
    console.log(`  ✓ ${email} (${rol})`);
  }

  console.log(`  Total: ${ok} usuarios migrados`);
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────
async function main() {
  console.log('🚀 Iniciando migración Google Sheets → Supabase');
  console.log(`   URL: ${process.env.SUPABASE_URL}`);
  console.log(`   Data: ${DATA_DIR}\n`);

  const archivos = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'));
  if (archivos.length === 0) {
    console.error('❌ No se encontraron archivos CSV en migration/data/');
    console.log('\nPor favor exporta desde Google Sheets:');
    console.log('  → Inventario.csv');
    console.log('  → Ubicaciones.csv');
    console.log('  → Usuarios.csv');
    process.exit(1);
  }

  console.log(`   Archivos encontrados: ${archivos.join(', ')}`);

  const mapaUbicaciones = await migrarUbicaciones();
  const mapaMarcas      = await obtenerMarcas();
  await migrarInventario(mapaUbicaciones, mapaMarcas);
  await migrarUsuarios();

  console.log('\n✅ Migración completada\n');
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
