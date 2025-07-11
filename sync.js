// sync.js - script principal que se puede ejecutar o importar
import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import pLimit from 'p-limit';
import fs from 'fs';
import path from 'path';
import {
  productosShopifyPorSKU,
  crearProducto,
  actualizarProducto,
  eliminarProducto
} from './shopify.js';

const { EXTERNAL_API_URL } = process.env;
const CONCURRENCY = 1;
const SHOPIFY_DELAY_MS = 1100;
const MAX_RETRIES = 5;
const BACKOFF_BASE = 3000;
const LOG_DIR = './logs';

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const parsePrecio = (precioRaw) => {
  if (!precioRaw) return null;

  const candidatos = precioRaw
    .split(/[,;]/)
    .map(p => p.trim().replace(/[^\d]/g, ''))
    .map(p => parseInt(p, 10))
    .filter(p => !isNaN(p) && p > 0);

  if (candidatos.length === 0) return null;
  return Math.ceil(Math.min(...candidatos)).toFixed(2);
};

const guardarLogRotativo = (nombreBase, objeto, maxArchivos = 5) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivo = path.join(LOG_DIR, `${nombreBase}_${timestamp}.json`);
  fs.writeFileSync(archivo, JSON.stringify(objeto, null, 2));

  const archivos = fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith(nombreBase))
    .map(f => ({ f, t: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  for (const extra of archivos.slice(maxArchivos)) {
    fs.unlinkSync(path.join(LOG_DIR, extra.f));
  }
};

const normalizarProductos = (lista) => {
  const productosUnicos = {};
  for (const data of lista) {
    const sku = data.codigos?.trim();
    if (!sku || productosUnicos[sku]) continue;

    const precio = parsePrecio(data.precio);
    const stock = parseInt(data.stock || '0', 10);
    const inventory_quantity = isNaN(stock) || stock < 0 ? 0 : stock;

    productosUnicos[sku] = {
      sku,
      title: data.descripProd?.trim() || '',
      body_html: `<p>${data.descripProd?.trim() || ''}</p>`,
      vendor: data.marca?.trim() || '',
      tags: [data.categoria, data.seccion, data.marca, data.unidad]
        .filter(Boolean)
        .map(s => s.trim().toUpperCase())
        .join(', '),
      images: data.foto && data.foto.trim() !== ''
        ? [{ src: encodeURI(data.foto.replace(/\\/g, '/')) }]
        : undefined,
      variants: [{
        option1: 'Default Title',
        sku,
        price: precio || '0.00',
        inventory_quantity,
        inventory_management: 'shopify'
      }],
      options: ['Title']
    };
  }
  return Object.values(productosUnicos);
};

const callWithRetry = async (fn, args, sku, attempt = 1) => {
  try {
    await delay(SHOPIFY_DELAY_MS);
    const result = await fn(...args);
    await delay(SHOPIFY_DELAY_MS);
    return result;
  } catch (err) {
    const status = err.response?.status;

    if ((status === 429 || status === 502) && attempt <= MAX_RETRIES) {
      const wait = BACKOFF_BASE * Math.pow(2, attempt - 1);
      console.warn(`⏱️ Retry SKU=${sku} | status=${status} | intento ${attempt} | espera ${wait}ms`);
      await delay(wait + 700);
      return callWithRetry(fn, args, sku, attempt + 1);
    }

    throw err; // esta excepción será atrapada donde se use callWithRetry
  }
};


const obtenerProductosDesdeAPI = async () => {
  const res = await axios.get(EXTERNAL_API_URL);
  const list = res.data.listarProductos;
  if (!Array.isArray(list)) throw new Error('Formato inesperado de API externa');
  return normalizarProductos(list);
};

const procesar = async (producto, shopifyDict, descartes) => {
  const sku = producto.sku;
  const existente = shopifyDict[sku];
  try {
    if (producto.variants[0].price === '0.00') {
      throw new Error('Precio no válido para creación');
    }
    if (existente) {
      const igual = JSON.stringify(producto) === JSON.stringify(existente.fuente);
      if (!igual) {
        await callWithRetry(actualizarProducto, [existente.id, producto], sku);
        return { action: 'actualizado', sku };
      }
      return { action: 'sinCambios', sku };
    } else {
      await callWithRetry(crearProducto, [producto], sku);
      return { action: 'creado', sku };
    }
  } catch (err) {
    descartes.push({ sku, motivo: err.message, producto });
    return { action: 'descartado', sku };
  }
};

export async function runSync() {
  const apiList = await obtenerProductosDesdeAPI();
  console.log(`Inicio sync: ${apiList.length} productos API`);

  const shopifyDict = await productosShopifyPorSKU();
  console.log(`Shopify tiene ${Object.keys(shopifyDict).length} SKUs`);

  const resultados = { creado: 0, actualizado: 0, sinCambios: 0, error: 0, descartado: 0 };
  const logs = [];
  const descartes = [];
  const limit = pLimit(CONCURRENCY);

  const tasks = apiList.map((p, i) => limit(async () => {
    try {
      const r = await procesar(p, shopifyDict, descartes);
      resultados[r.action]++;
      logs.push({ sku: p.sku, action: r.action });
    } catch (err) {
      console.error(`❌ SKU=${p.sku} ->`, err.message);
      resultados.error++;
      logs.push({ sku: p.sku, action: 'error', error: err.message });
    }
    if ((i + 1) % 10 === 0) console.log(`📦 ${i + 1}/${apiList.length}`);
  }));

  await Promise.all(tasks);

  const skusAPI = new Set(apiList.map(p => p.sku));
  const eliminarIds = Object.entries(shopifyDict)
    .filter(([sku]) => !skusAPI.has(sku))
    .map(([, v]) => v.id);

  for (const id of eliminarIds) {
  try {
    await callWithRetry(eliminarProducto, [id], 'eliminado');
    logs.push({ sku: 'desconocido', id, action: 'eliminado' });
  } catch (err) {
    console.error(`❌ Error al eliminar producto ID=${id}:`, err.message);
    logs.push({ sku: 'desconocido', id, action: 'error', error: err.message });
  }
}


  console.log('📊 Resumen:', resultados);
  console.log(`Eliminados: ${eliminarIds.length}`);

  guardarLogRotativo('sync_log', {
    timestamp: new Date().toISOString(),
    resultados,
    eliminados: eliminarIds.length,
    logs
  });

  guardarLogRotativo('descartados', {
    total: descartes.length,
    productos: descartes
  });

  if (descartes.length > 0) {
    console.log('🟠 Productos descartados:');
    descartes.forEach(d => {
      console.log(`🔸 SKU=${d.sku} | Motivo=${d.motivo}`);
    });
  }

  return { resultados, eliminados: eliminarIds.length };
}

if (
  process.argv[1] === new URL(import.meta.url).pathname &&
  process.env.RAILWAY_ENVIRONMENT_NAME
) {
  console.log('🚀 Ejecutando sincronización en Railway...');
  runSync()
    .then(() => {
      console.log('✅ Sync finalizado correctamente');
      process.exit(0);
    })
    .catch(e => {
      console.error('❌ Error en Railway:', e);
      process.exit(1);
    });
} else {
  console.log('⛔ Sync bloqueado: no estás en Railway');
}
