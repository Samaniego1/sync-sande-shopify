// api/sync.js
export default async function handler(req, res) {
  try {
    const { runSync } = await import('../sync.js');
    const resultado = await runSync();
    res.status(200).json({ status: 'ok', resultado });
  } catch (err) {
    console.error('❌ Error en sync:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
}