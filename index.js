// index.js
import dotenv from 'dotenv';
dotenv.config();

import { runSync } from './sync.js';

runSync().catch((err) => {
  console.error('❌ Error ejecutando sync:', err);
  process.exit(1);
});
