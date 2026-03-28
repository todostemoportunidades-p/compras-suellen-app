import { CapacitorHttp } from '@capacitor/core';

// ══════════════════════════════════════════════════════════
// REAL PRICE SCANNER — Uses public APIs to fetch actual prices
// ══════════════════════════════════════════════════════════

/**
 * Source 1: Open Food Facts (global product database with Brazilian prices)
 */
async function searchOpenFoodFacts(productName) {
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(productName)}&search_simple=1&action=process&json=1&page_size=3&cc=br&lc=pt`;
    const res = await CapacitorHttp.get({ url, headers: { 'User-Agent': 'ListaDeMercado/1.0' } });
    const data = res.data;
    
    if (data && data.products && data.products.length > 0) {
      for (const product of data.products) {
        // Look for price data in various fields
        const price = product.price || product.price_per_unit;
        if (price && price > 0) {
          return { price: parseFloat(price), source: 'Open Food Facts', productName: product.product_name || productName };
        }
      }
    }
  } catch (err) {
    console.warn('Open Food Facts error:', err);
  }
  return null;
}

/**
 * Source 2: Mercado Livre public search (Brazilian marketplace with real prices)
 */
async function searchMercadoLivre(productName) {
  try {
    const url = `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(productName)}&limit=5&category=MLB1403`;
    const res = await CapacitorHttp.get({ url });
    const data = res.data;
    
    if (data && data.results && data.results.length > 0) {
      // Get the median price from results to avoid outliers
      const prices = data.results
        .map(r => r.price)
        .filter(p => p > 0 && p < 500) // Filter unreasonable prices
        .sort((a, b) => a - b);
      
      if (prices.length > 0) {
        const medianIdx = Math.floor(prices.length / 2);
        return { 
          price: prices[medianIdx], 
          source: 'Mercado Livre', 
          productName: data.results[0].title 
        };
      }
    }
  } catch (err) {
    console.warn('Mercado Livre error:', err);
  }
  return null;
}

/**
 * Scans all sources for a single product and returns best price found
 */
async function findRealPrice(productName) {
  // Try Open Food Facts first (more accurate for grocery items)
  const offResult = await searchOpenFoodFacts(productName);
  if (offResult) return offResult;
  
  // Fallback to Mercado Livre
  const mlResult = await searchMercadoLivre(productName);
  if (mlResult) return mlResult;
  
  return null;
}

/**
 * Scans all products and returns price updates
 * @param {string[]} markets - List of market names
 * @param {object[]} products - Product catalog
 * @param {function} onLog - Callback for scan progress messages
 */
export async function scanAllMarkets(markets, products, onLog) {
  const allUpdates = {};
  
  onLog?.('🚀 Iniciando varredura REAL de preços...');
  onLog?.(`📦 ${products.length} produtos para verificar`);
  
  let found = 0;
  let checked = 0;
  
  for (const product of products) {
    checked++;
    onLog?.(`🔍 [${checked}/${products.length}] Buscando: ${product.name}...`);
    
    const result = await findRealPrice(product.name);
    
    if (result) {
      found++;
      onLog?.(`✅ ${product.name}: R$ ${result.price.toFixed(2)} (${result.source})`);
      
      // Assign price to the first market in the list as reference
      const targetMarket = markets[0] || 'Referência';
      if (!allUpdates[targetMarket]) allUpdates[targetMarket] = {};
      allUpdates[targetMarket][product.id] = result.price;
    } else {
      onLog?.(`⚠️ ${product.name}: Sem preço encontrado`);
    }
    
    // Polite delay between API calls (300ms)
    await new Promise(r => setTimeout(r, 300));
  }
  
  onLog?.(`\n📊 Resumo: ${found}/${checked} produtos com preços reais encontrados`);
  
  return allUpdates;
}

/**
 * Merges scan results into the product catalog
 */
export function applyPriceUpdates(currentProducts, allUpdates) {
  return currentProducts.map(p => {
    const newPrices = { ...p.prices };
    
    Object.keys(allUpdates).forEach(market => {
      if (allUpdates[market][p.id]) {
        newPrices[market] = allUpdates[market][p.id];
      }
    });

    return { ...p, prices: newPrices };
  });
}

/**
 * Checks if we should run an automatic scan (e.g. once per 12 hours)
 */
export function shouldAutoScan(lastScanDate) {
  if (!lastScanDate) return true;
  const last = new Date(lastScanDate);
  const now = new Date();
  const hoursDiff = (now - last) / (1000 * 60 * 60);
  return hoursDiff >= 12;
}
