require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DATA_DIR = path.join(__dirname, 'data');
const CHUNK = 500; // registros por lote

function leerCSV(archivo) {
  const ruta = path.join(DATA_DIR, archivo);
  if (!fs.existsSync(ruta)) {
    console.warn(`  ⚠️  ${archivo} no encontrado — omitiendo`);
    return [];
  }
  return parse(fs.readFileSync(ruta, 'utf8'), { columns: true, skip_empty_lines: true, trim: true });
}

function chunks(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function limpiarCodigo(c) { return (c || '').replace(/[^A-Z0-9]/gi, '').toUpperCase(); }

// ──────────────────────────────────────────────
// 1. UBICACIONES — lote completo
// ──────────────────────────────────────────────
async function migrarUbicaciones() {
  console.log('\n📦 Migrando Ubicaciones...');
  const filas = leerCSV('Ubicaciones.csv');
  if (!filas.length) return {};

  // Deduplicar por código de ubicación
  const ubicMap = new Map();
  filas.forEach(f => {
    const codigo = (f['Ubicación'] || f['Ubicacion'] || '').trim().toUpperCase();
    if (!codigo) return;
    ubicMap.set(codigo, {
      codigo_ubicacion: codigo,
      zona:    (f['Zona']    || '').trim() || null,
      pasillo: (f['Pasillo'] || '').trim() || null,
      anaquel: (f['Anaquel'] || '').trim() || null,
      rack:    (f['Rack']    || '').trim() || null,
      nivel:   (f['Nivel']   || '').trim() || null,
      estado:  ['ACTIVO','INACTIVO','BLOQUEADO'].includes((f['Estado']||'').trim().toUpperCase())
               ? f['Estado'].trim().toUpperCase() : 'ACTIVO'
    });
  });
  const registros = [...ubicMap.values()];

  let insertadas = 0;
  for (const lote of chunks(registros, CHUNK)) {
    const { error } = await supabase.from('ubicaciones').upsert(lote, { onConflict: 'codigo_ubicacion' });
    if (error) { console.error('  ✗ Lote ubicaciones:', error.message); continue; }
    insertadas += lote.length;
    process.stdout.write(`\r  → ${insertadas}/${registros.length} ubicaciones...`);
  }

  // Construir mapa codigo → id
  const { data } = await supabase.from('ubicaciones').select('id, codigo_ubicacion');
  const mapa = {};
  (data || []).forEach(u => { mapa[u.codigo_ubicacion] = u.id; });
  console.log(`\n  ✓ ${insertadas} ubicaciones migradas`);
  return mapa;
}

// ──────────────────────────────────────────────
// 2. INVENTARIO — lote de partes + lote de relaciones
// ──────────────────────────────────────────────
async function migrarInventario(mapaUbicaciones, mapaMarcas) {
  console.log('\n🔧 Migrando Inventario...');
  const filas = leerCSV('Inventario.csv');
  if (!filas.length) return;

  // Preparar partes
  // Deduplicar por código (mantener el último en caso de duplicados)
  const partesMap = new Map();
  filas.forEach(f => {
    const codigo = (f['Código'] || f['Codigo'] || '').trim().toUpperCase();
    if (!codigo) return;
    partesMap.set(codigo, {
      codigo,
      codigo_limpio: limpiarCodigo(codigo),
      descripcion:  (f['Descripción'] || f['Descripcion'] || '').trim() || null,
      marca_id:     mapaMarcas[(f['Marca'] || '').trim().toLowerCase()] || null,
    });
  });
  const partes = [...partesMap.values()];
  console.log(`  → ${filas.length - partes.length} duplicados eliminados del CSV`);

  console.log(`  → ${partes.length} partes a migrar en lotes de ${CHUNK}...`);

  let insertadas = 0;
  for (const lote of chunks(partes, CHUNK)) {
    const { error } = await supabase.from('partes').upsert(lote, { onConflict: 'codigo' });
    if (error) { console.error('\n  ✗ Lote partes:', error.message); continue; }
    insertadas += lote.length;
    process.stdout.write(`\r  → Partes: ${insertadas}/${partes.length}`);
  }
  console.log(`\n  ✓ ${insertadas} partes insertadas`);

  // Construir mapa codigo → id
  console.log('  → Obteniendo IDs de partes...');
  const { data: partesDB } = await supabase.from('partes').select('id, codigo');
  const mapaPartes = {};
  (partesDB || []).forEach(p => { mapaPartes[p.codigo] = p.id; });

  // Preparar relaciones parte_ubicaciones
  const colsUbic = [
    'Ubicación Principal','Ubicación 2','Ubicación 3','Ubicación 4','Ubicación 5',
    'Ubicacion Principal','Ubicacion 2','Ubicacion 3','Ubicacion 4','Ubicacion 5',
  ];

  const relaciones = [];
  const relSet = new Set();
  for (const fila of filas) {
    const codigo = (fila['Código'] || fila['Codigo'] || '').trim().toUpperCase();
    const parteId = mapaPartes[codigo];
    if (!parteId) continue;

    const ubicaciones = colsUbic
      .map(col => (fila[col] || '').trim().toUpperCase())
      .filter((u, i, arr) => u && arr.indexOf(u) === i)
      .slice(0, 5);

    ubicaciones.forEach((codUbic, i) => {
      if (!mapaUbicaciones[codUbic]) return;
      const key = `${parteId}_${i + 1}`;
      if (!relSet.has(key)) {
        relSet.add(key);
        relaciones.push({ parte_id: parteId, ubicacion_id: mapaUbicaciones[codUbic], orden: i + 1, cantidad: 0 });
      }
    });
  }

  console.log(`  → ${relaciones.length} relaciones parte-ubicación a insertar...`);
  let relInsertadas = 0;
  for (const lote of chunks(relaciones, CHUNK)) {
    const { error } = await supabase
      .from('parte_ubicaciones')
      .upsert(lote, { onConflict: 'parte_id,orden' });
    if (error) { console.error('\n  ✗ Lote relaciones:', error.message); continue; }
    relInsertadas += lote.length;
    process.stdout.write(`\r  → Relaciones: ${relInsertadas}/${relaciones.length}`);
  }
  console.log(`\n  ✓ ${relInsertadas} relaciones insertadas`);
}

// ──────────────────────────────────────────────
// 3. USUARIOS
// ──────────────────────────────────────────────
async function migrarUsuarios() {
  console.log('\n👤 Migrando Usuarios...');
  const filas = leerCSV('Usuarios.csv');
  if (!filas.length) return;

  let ok = 0;
  for (const fila of filas) {
    const email = (fila['Email'] || '').trim().toLowerCase();
    const pin   = (fila['PIN']   || '').trim();
    if (!email || !pin) continue;

    const salt    = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(pin + salt, salt);
    const rol     = ['Jefe','Operario'].includes(fila['Rol']) ? fila['Rol'] : 'Operario';

    const { error } = await supabase.from('usuarios').upsert({
      email,
      pin_hash: pinHash,
      pin_salt: salt,
      nombre:   (fila['Nombre'] || email.split('@')[0]).trim(),
      rol,
      activo:   (fila['Activo'] || 'TRUE').toString().toUpperCase() !== 'FALSE',
    }, { onConflict: 'email' });

    if (error) { console.error(`  ✗ ${email}:`, error.message); continue; }
    console.log(`  ✓ ${email} (${rol})`);
    ok++;
  }
  console.log(`  Total: ${ok} usuarios migrados`);
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────
async function main() {
  const inicio = Date.now();
  console.log('🚀 Migración Google Sheets → Supabase (modo lote)');
  console.log(`   URL: ${process.env.SUPABASE_URL}`);

  const archivos = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'));
  if (!archivos.length) {
    console.error('❌ No hay archivos CSV en migration/data/'); process.exit(1);
  }
  console.log(`   Archivos: ${archivos.join(', ')}\n`);

  const mapaUbicaciones = await migrarUbicaciones();
  const { data: marcasDB } = await supabase.from('marcas').select('id, nombre');
  const mapaMarcas = {};
  (marcasDB || []).forEach(m => { mapaMarcas[m.nombre.toLowerCase()] = m.id; });

  await migrarInventario(mapaUbicaciones, mapaMarcas);
  await migrarUsuarios();

  const mins = ((Date.now() - inicio) / 60000).toFixed(1);
  console.log(`\n✅ Migración completada en ${mins} minutos\n`);
}

main().catch(err => { console.error('\n❌ Error fatal:', err.message); process.exit(1); });
