// /api/sync.js

import { runSync } from '../sync.js';

export default async function handler(req, res) {
  try {
    const resultado = await runSync();
    res.status(200).json({ status: 'ok', ...resultado });
  } catch (err) {
    console.error('❌ Error desde cron:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
}
