import express from 'express';
import { runSync } from './sync.js';

const app = express();
const port = process.env.PORT || 3000;

app.get('/api/sync', async (req, res) => {
  try {
    const result = await runSync();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('❌ Error en /api/sync:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor corriendo en puerto ${port}`);
});
