import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TABLAS = [
  'empleados',
  'jornadas',
  'registros_trabajo',
  'registros_cnc',
  'proyectos_cache',
  'partidas_terceros',
  'recepciones_material',
  'despachos',
  'ordenes_compra',
  'config_global',
  'tarifas_horarias',
  'tipo_cambio',
  'costos_directos_proyecto',
];

export default async function handler(req, res) {
  // Permite llamada manual GET (con clave) o cron automático
  if (req.method === 'GET') {
    const auth = req.headers.authorization || req.query.key;
    const validKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (auth !== validKey && req.headers['x-vercel-cron'] !== '1') {
      return res.status(401).json({ error: 'No autorizado' });
    }
  }

  try {
    const ts = new Date().toISOString().slice(0, 10);
    const backup = { generado_en: new Date().toISOString(), tablas: {} };
    const stats = [];

    for (const tabla of TABLAS) {
      const { data, error } = await supabase.from(tabla).select('*');
      if (!error && data) {
        backup.tablas[tabla] = data;
        stats.push(`${tabla}: ${data.length} registros`);
      } else {
        stats.push(`${tabla}: ERROR`);
      }
    }

    // Subir a Supabase Storage
    const filename = `backup-${ts}.json`;
    const content = JSON.stringify(backup, null, 2);
    const { error: uploadError } = await supabase.storage
      .from('backups')
      .upload(filename, content, {
        contentType: 'application/json',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // Generar URL firmada (válida 7 días)
    const { data: urlData } = await supabase.storage
      .from('backups')
      .createSignedUrl(filename, 7 * 24 * 60 * 60);

    const downloadUrl = urlData?.signedUrl || '';

    // Enviar email de recordatorio
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_FROM,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    const totalRegistros = Object.values(backup.tablas)
      .reduce((acc, t) => acc + t.length, 0);

    await transporter.sendMail({
      from: `"MBLE Backup" <${process.env.GMAIL_FROM}>`,
      to: process.env.GMAIL_TO,
      subject: `MBLE — Backup semanal listo (${ts})`,
      html: `
        <div style="font-family:monospace;background:#0f0f0f;color:#fff;padding:24px;border-radius:8px;">
          <h2 style="color:#FFD600;margin-top:0;">MBLE ERP — Backup Semanal</h2>
          <p style="color:#aaa;">Fecha: ${ts}</p>
          <p style="color:#aaa;">Total registros exportados: <strong style="color:#fff;">${totalRegistros.toLocaleString()}</strong></p>
          <ul style="color:#aaa;">
            ${stats.map(s => `<li>${s}</li>`).join('')}
          </ul>
          <a href="${downloadUrl}"
             style="display:inline-block;margin-top:16px;background:#FFD600;color:#000;
                    padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:bold;">
            Descargar backup (válido 7 días)
          </a>
          <p style="color:#555;font-size:11px;margin-top:16px;">
            También podés descargarlo desde Ajustes → Backup en el ERP.
          </p>
        </div>
      `,
    });

    return res.json({ ok: true, archivo: filename, registros: totalRegistros });

  } catch (err) {
    console.error('Backup error:', err);
    return res.status(500).json({ error: err.message });
  }
}
