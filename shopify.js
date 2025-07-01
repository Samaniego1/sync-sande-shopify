// shopify.js con corrección del error "options: expected Array to be a Hash"
import axios from 'axios';
//import dotenv from 'dotenv';
//dotenv.config();

const {
  SHOPIFY_STORE_DOMAIN,
  SHOPIFY_API_VERSION,
  SHOPIFY_API_PASSWORD
} = process.env;

if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_API_VERSION || !SHOPIFY_API_PASSWORD) {
  throw new Error('🔴 Faltan variables de entorno Shopify (STORE_DOMAIN/API_VERSION/API_PASSWORD)');
}

const shopifyAPI = axios.create({
  baseURL: `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}`,
  headers: {
    'X-Shopify-Access-Token': SHOPIFY_API_PASSWORD,
    'Content-Type': 'application/json'
  }
});

export async function obtenerProductosDesdeAPI() {
  throw new Error('⚠️ Esta función debe implementarse en sync.js, no aquí.');
}

export async function productosShopifyPorSKU() {
  let productos = [];
  let since_id = 0;

  do {
    const res = await shopifyAPI.get('/products.json', {
      params: { limit: 250, since_id }
    });
    const batch = res.data.products;
    if (batch.length === 0) break;

    productos = productos.concat(batch);
    since_id = batch[batch.length - 1].id;
  } while (true);

  const dict = {};
  productos.forEach(p => {
    const sku = p.variants[0]?.sku;
    if (sku) {
      dict[sku] = {
        id: p.id,
        fuente: {
          title: p.title,
          body_html: p.body_html,
          vendor: p.vendor,
          tags: p.tags,
          variants: p.variants.map(v => ({
            price: v.price,
            sku: v.sku,
            inventory_quantity: v.inventory_quantity
          })),
          images: p.images,
          options: p.options
        }
      };
    }
  });

  return dict;
}

export async function crearProducto(producto) {
  const payload = {
    product: {
      title: producto.title,
      body_html: producto.body_html,
      vendor: producto.vendor,
      tags: producto.tags,
      variants: producto.variants.map(v => ({
        ...v,
        inventory_policy: 'deny',
        fulfillment_service: 'manual'
      })),
      ...(producto.images ? { images: producto.images } : {}),
      ...(producto.options && producto.options.length > 1 ? { options: producto.options } : {})
    }
  };

  console.log('➡️ Intentando crear:', JSON.stringify(payload, null, 2));

  try {
    const res = await shopifyAPI.post('/products.json', payload);
    return res.data.product;
  } catch (err) {
    console.error('❌ Error al crear producto:', err.response?.data?.errors || err.message);
    throw err;
  }
}

export async function actualizarProducto(id, producto) {
  const payload = {
    product: {
      id,
      title: producto.title,
      body_html: producto.body_html,
      vendor: producto.vendor,
      tags: producto.tags,
      variants: producto.variants.map(v => ({
        ...v,
        inventory_policy: 'deny',
        fulfillment_service: 'manual'
      })),
      ...(producto.images ? { images: producto.images } : {}),
      ...(producto.options && producto.options.length > 1 ? { options: producto.options } : {})
    }
  };

  try {
    const res = await shopifyAPI.put(`/products/${id}.json`, payload);
    return res.data.product;
  } catch (err) {
    console.error(`❌ Error al actualizar producto ${id}:`, err.response?.data?.errors || err.message);
    throw err;
  }
}

export async function eliminarProducto(id) {
  await shopifyAPI.delete(`/products/${id}.json`);
}
