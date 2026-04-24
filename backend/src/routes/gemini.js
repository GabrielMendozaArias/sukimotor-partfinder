const express = require('express');
const supabase = require('../config/supabase');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

const CACHE_HORAS = 24;

// POST /api/gemini/identificar — proxy seguro hacia Gemini con caché en BD
router.post('/identificar', verificarToken, async (req, res) => {
  const { codigo } = req.body;

  if (!codigo) return res.status(400).json({ error: 'Código requerido' });

  const codigoLimpio = codigo.replace(/[^A-Z0-9]/gi, '').toUpperCase();

  // 1. Verificar caché en BD
  const { data: parte } = await supabase
    .from('partes')
    .select('gemini_descripcion, gemini_cached_at')
    .eq('codigo_limpio', codigoLimpio)
    .single();

  if (parte?.gemini_descripcion && parte?.gemini_cached_at) {
    const cachedAt = new Date(parte.gemini_cached_at);
    const horasTranscurridas = (Date.now() - cachedAt.getTime()) / 3600000;
    if (horasTranscurridas < CACHE_HORAS) {
      return res.json({ descripcion: parte.gemini_descripcion, fuente: 'cache' });
    }
  }

  // 2. Llamar a Gemini
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Gemini no configurado' });

  const prompt = `Eres un experto en repuestos de motos y motores marinos.
Identifica el siguiente código de repuesto: "${codigo}".
Responde SOLO con una descripción corta en español (máximo 10 palabras).
Si no es un código de repuesto de moto o motor marino, responde exactamente: NO_APLICA`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 100, temperature: 0.1 }
        })
      }
    );

    const json = await response.json();
    const descripcion = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!descripcion || descripcion === 'NO_APLICA') {
      return res.status(422).json({ error: 'Código no corresponde a repuesto de moto/marino' });
    }

    // 3. Guardar en caché
    await supabase
      .from('partes')
      .upsert({ codigo: codigo.toUpperCase(), codigo_limpio: codigoLimpio, gemini_descripcion: descripcion, gemini_cached_at: new Date().toISOString() }, { onConflict: 'codigo' });

    res.json({ descripcion, fuente: 'gemini' });
  } catch (err) {
    res.status(500).json({ error: 'Error consultando Gemini: ' + err.message });
  }
});

module.exports = router;
