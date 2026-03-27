import { CapacitorHttp } from '@capacitor/core';

const MARKET_CONFIGS = {
  'Nagumo': {
    searchUrl: (q) => `https://www.nagumo.com.br/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}`,
    parse: (data) => {
      if (!data || !data.length) return null;
      const item = data[0];
      const seller = item.items[0]?.sellers[0];
      return seller?.commertialOffer?.Price || null;
    }
  },
  'Higas': {
    searchUrl: (q) => `https://www.higas.com.br/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}`,
    parse: (data) => {
      if (!data || !data.length) return null;
      const item = data[0];
      const seller = item.items[0]?.sellers[0];
      return seller?.commertialOffer?.Price || null;
    }
  }
};

/**
 * Scans a specific market for all products in the list
 */
export async function scanMarket(marketName, products) {
  const config = MARKET_CONFIGS[marketName];
  if (!config) return {};

  const updates = {};
  
  // To avoid hammering the API too fast, we could batch or delay, 
  // but for a few hundred items, a sequential or small-batch approach is fine.
  for (const product of products) {
    try {
      const options = {
        url: config.searchUrl(product.name),
        headers: { 'Content-Type': 'application/json' }
      };

      const response = await CapacitorHttp.get(options);
      const price = config.parse(response.data);
      
      if (price) {
        updates[product.id] = price;
      }
    } catch (err) {
      console.error(`Error scanning ${marketName} for ${product.name}:`, err);
    }
    // Small delay between requests to be polite
    await new Promise(r => setTimeout(r, 200));
  }

  return updates;
}

/**
 * Scans all active markets for latest prices
 */
export async function scanAllMarkets(markets, products) {
  const allUpdates = {}; // { marketName: { productId: price } }

  for (const market of markets) {
    if (MARKET_CONFIGS[market]) {
      const updates = await scanMarket(market, products);
      allUpdates[market] = updates;
    }
  }

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
 * Checks if we should run an automatic scan (e.g. once per day)
 */
export function shouldAutoScan(lastScanDate) {
  if (!lastScanDate) return true;
  const last = new Date(lastScanDate);
  const now = new Date();
  return last.toDateString() !== now.toDateString();
}
