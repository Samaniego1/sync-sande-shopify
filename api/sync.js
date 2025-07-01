import { runSync } from '../sync.js';

export default async function handler(req, res) {
  try {
    const result = await runSync();
    res.status(200).json({ status: 'ok', result });
  } catch (e) {
    console.error('❌ Error en handler:', e);
    res.status(500).json({ error: e.message || 'Error desconocido' });
  }
}
