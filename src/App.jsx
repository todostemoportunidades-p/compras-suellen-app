import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  ShoppingCart, Search, Plus, Trash2, Check, MapPin,
  TrendingDown, TrendingUp, Download, History, Calendar,
  Save, X, CheckCircle2, RefreshCw, FileText, ArrowLeft,
  ShoppingBag, Clock, ChevronRight, LayoutGrid, List, PlusCircle, Share2, Copy,
  Zap, ShieldCheck, Navigation
} from 'lucide-react';
import { Share } from '@capacitor/share';
import { Geolocation } from '@capacitor/geolocation';
import confetti from 'canvas-confetti';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Contacts } from '@capacitor-community/contacts';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { motion, AnimatePresence } from 'framer-motion';
import baseProducts from './data/products.json';
import { scanAllMarkets, applyPriceUpdates, shouldAutoScan } from './services/priceScanner';

// ─── Storage Keys ───
const KEYS = {
  PRODUCTS: 'mercado_products_v6',
  LISTS: 'mercado_lists_v6',
  CURRENT: 'mercado_current_v6',
  HISTORY: 'mercado_history_v6',
  MARKETS: 'mercado_settings_v6',
  LOCATIONS: 'mercado_locations_v6',
  LAST_SCAN: 'mercado_last_scan',
  THEME: 'mercado_theme'
};

// ─── UTILS ───
const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const normalizeStr = (str) => {
  return str ? str.normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
};

const getProductImage = (name) => {
  return `https://loremflickr.com/200/200/grocery,${encodeURIComponent(name.split(' ')[0])}?lock=${name.length}`;
};

const MARKET_SEARCH_URLS = {
  'Nagumo': (q) => `https://www.nagumo.com.br/pesquisa?q=${encodeURIComponent(q)}`,
  'Higas': (q) => `https://www.higas.com.br/pesquisa?q=${encodeURIComponent(q)}`,
  'Sonda': (q) => `https://www.sondadelivery.com.br/delivery/busca/${encodeURIComponent(q)}`,
  'Carrefour': (q) => `https://www.carrefour.com.br/busca/?termo=${encodeURIComponent(q)}`,
  'Pão de Açúcar': (q) => `https://www.paodeacucar.com/busca?qt=${encodeURIComponent(q)}`,
  'Default': (q) => `https://www.google.com/search?q=preço+${encodeURIComponent(q)}`
};

function refreshPrices(products) {
  return products.map(p => {
    const prices = { ...p.prices };
    Object.keys(prices).forEach(m => {
      prices[m] = +(prices[m] * (0.98 + Math.random() * 0.04)).toFixed(2);
    });
    return { ...p, prices };
  });
}

function isNewDay(lastRefresh) {
  if (!lastRefresh) return true;
  return new Date(lastRefresh).toDateString() !== new Date().toDateString();
}

// ─── PDF Generator ───
async function generatePDF(items, dateStr, total, listName) {
  try {
    const doc = new jsPDF();
    doc.setFillColor(255, 255, 255);
    doc.setTextColor(26, 26, 26);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(listName || 'Lista de Mercado', 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Data: ${dateStr}`, 14, 28);

    const rows = items.map(item => [
      item.name,
      item.category,
      `${item.qty} ${item.unit || 'un'}`,
      item.selectedMarket,
      fmt.format(item.selectedPrice),
      fmt.format(item.selectedPrice * item.qty),
    ]);

    doc.autoTable({
      startY: 35,
      head: [['Produto', 'Sessão', 'Qtd', 'Mercado', 'Preço.Un', 'Total']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [249, 249, 247], textColor: [26, 26, 26], fontStyle: 'bold' },
      styles: { fontSize: 8 },
    });

    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.text(`Total Estimado: ${fmt.format(total)}`, 14, finalY);

    const fileName = `Compras_${dateStr.replace(/[\/:]/g, '-')}.pdf`;

    try {
       const { Filesystem, Directory } = await import('@capacitor/filesystem');
       const pdfBase64 = doc.output('datauristring').split(',')[1];
       const savedFile = await Filesystem.writeFile({
          path: fileName,
          data: pdfBase64,
          directory: Directory.Documents,
          recursive: true
       });
       await Share.share({
          title: listName || 'Lista de Compras',
          url: savedFile.uri,
          dialogTitle: 'Compartilhar ou Salvar PDF'
       });
    } catch (capErr) {
       console.warn('Capacitor write failed, using web download', capErr);
       doc.save(fileName);
    }
  } catch (err) {
    console.error('Critical error generating PDF', err);
  }
}

// ══════════════════════════════════════════
// ══════════════ MAIN APP ═════════════════
// ══════════════════════════════════════════
function App() {
  // Core State
  const [products, setProducts] = useState([]);
  const [markets, setMarkets] = useState(['Nagumo', 'Higas']);
  const [currentList, setCurrentList] = useState([]);
  const [historyList, setHistoryList] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  // UI State
  const [view, setView] = useState('home'); // 'home', 'shopping', 'history', 'settings'
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('Todas');
  const [toast, setToast] = useState(null);
  const [scanLog, setScanLog] = useState([]);
  
  // Selection/Naming Flow State
  const [selectedProduct, setSelectedProduct] = useState(null); // The one being 'configured' to add
  const [config, setConfig] = useState({ qty: 1, unit: 'un', marketPrices: {} });
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [listName, setListName] = useState('');
  const [activeShoppingId, setActiveShoppingId] = useState(null);

  // GPS State
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsStatus, setGpsStatus] = useState('');
  const [nearbyMarkets, setNearbyMarkets] = useState([]);
  const [showCongratsModal, setShowCongratsModal] = useState(false);

  // Best Price Hint State
  const [bestPriceHint, setBestPriceHint] = useState(null);

  // Contacts State
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [contactsList, setContactsList] = useState([]);
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearchTerm, setContactSearchTerm] = useState('');

  // Scanner State
  const [isScanning, setIsScanning] = useState(false);

  // Auto-finish and confetti logic
  useEffect(() => {
    if (view === 'shopping' && activeShoppingId) {
       const list = historyList.find(l => l.id === activeShoppingId);
       if (list && list.items.length > 0 && list.items.every(i => i.checked)) {
          if (!showCongratsModal) {
             setShowCongratsModal(true);
             Haptics.notification({ style: ImpactStyle.Heavy });
             confetti({
               particleCount: 150,
               spread: 70,
               origin: { y: 0.6 },
               colors: ['#77dd77', '#fdfd96', '#84b6f4', '#ffb7ce']
             });
          }
       }
    }
  }, [historyList, view, activeShoppingId, showCongratsModal]);

  // Persistence
  useEffect(() => {
    const p = localStorage.getItem(KEYS.PRODUCTS);
    const l = localStorage.getItem(KEYS.LISTS);
    const c = localStorage.getItem(KEYS.CURRENT);
    const m = localStorage.getItem(KEYS.MARKETS);
    const r = localStorage.getItem(KEYS.LAST_REFRESH);
    const s = localStorage.getItem(KEYS.LAST_SCAN);

    let baseMarkets = m ? JSON.parse(m) : ['Nagumo', 'Higas'];
    setMarkets(baseMarkets);

    let base = p ? JSON.parse(p) : baseProducts.map(prod => ({
      ...prod,
      prices: {
        'Nagumo': prod.nagumoPrice || 0,
        'Higas': prod.higasPrice || 0
      }
    }));

    if (isNewDay(r)) {
      base = refreshPrices(base);
      localStorage.setItem(KEYS.LAST_REFRESH, new Date().toISOString());
      localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(base));
    }
    
    setProducts(base);
    if (l) setHistoryList(JSON.parse(l));
    if (c) setCurrentList(JSON.parse(c));

    // Auto-scan for real prices in background
    if (shouldAutoScan(s)) {
      runSilentScan(baseMarkets, base);
    }
  }, []);

  const runSilentScan = async (currentMarkets, currentProducts) => {
    if (isScanning) return;
    setIsScanning(true);
    try {
      // We only scan markets that have scrapers implemented (Nagumo, Higas)
      const scanMarkets = currentMarkets.filter(m => m === 'Nagumo' || m === 'Higas');
      if (scanMarkets.length === 0) return;

      const updates = await scanAllMarkets(scanMarkets, currentProducts);
      setProducts(prev => {
        const updated = applyPriceUpdates(prev, updates);
        localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(updated));
        localStorage.setItem(KEYS.LAST_SCAN, new Date().toISOString());
        return updated;
      });
      // Silent success
      console.log('Daily price scan completed successfully.');
    } catch (err) {
      console.error('Silent scan failed:', err);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => { localStorage.setItem(KEYS.CURRENT, JSON.stringify(currentList)); }, [currentList]);
  useEffect(() => { localStorage.setItem(KEYS.LISTS, JSON.stringify(historyList)); }, [historyList]);
  useEffect(() => { localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(products)); }, [products]);
  useEffect(() => { localStorage.setItem(KEYS.MARKETS, JSON.stringify(markets)); }, [markets]);

  // Auto-scan prices daily (every 12 hours)
  useEffect(() => {
    if (products.length === 0 || markets.length === 0) return;
    const lastScan = localStorage.getItem(KEYS.LAST_SCAN);
    if (shouldAutoScan(lastScan, 12)) {
      // Delay auto-scan by 3 seconds after app load so UI is ready
      const timer = setTimeout(() => {
        syncPriceCards();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [products.length > 0, markets.length > 0]); // Only run when products/markets first load

  // Toast Helper
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Computed
  const categories = useMemo(() => ['Todas', ...new Set(products.map(p => p.category))], [products]);
  const filtered = useMemo(() => {
    let r = products;
    if (activeCategory !== 'Todas') r = r.filter(p => p.category === activeCategory);
    if (searchTerm) r = r.filter(p => normalizeStr(p.name).includes(normalizeStr(searchTerm)));
    return r;
  }, [products, searchTerm, activeCategory]);

  const total = useMemo(() => currentList.reduce((acc, i) => acc + (i.selectedPrice * i.qty), 0), [currentList]);

  // Actions
  const openConfig = (p) => {
    setSelectedProduct(p);
    
    const currentPrices = {};
    let lowestP = Infinity;
    let bestM = null;

    markets.forEach(m => {
      const price = p.prices?.[m] || 0;
      currentPrices[m] = price;
      if (price > 0 && price < lowestP) {
        lowestP = price;
        bestM = m;
      }
    });

    if (bestM && Object.keys(currentPrices).length > 1) {
      setBestPriceHint(`🔥 O melhor preço atual é no ${bestM} (${fmt.format(lowestP)})`);
    } else {
      setBestPriceHint(null);
    }

    setConfig({ qty: 1, unit: p.unit || 'un', marketPrices: currentPrices });
  };

  const confirmAdd = (market, price) => {
    const item = {
      ...selectedProduct,
      qty: config.qty,
      unit: config.unit,
      selectedMarket: market,
      selectedPrice: price,
      id: Date.now(), // New instance
      checked: false
    };

    // Update product price in catalog if changed
    setProducts(prev => prev.map(p => {
      if (p.id === selectedProduct.id) {
        return { ...p, prices: { ...p.prices, [market]: price } };
      }
      return p;
    }));

    setCurrentList(prev => [...prev, item]);
    setSelectedProduct(null);
    setSearchTerm('');
    showToast(`Adicionado: ${item.name} pelo preço do ${market}`);
  };

  const syncPriceCards = async () => {
    setRefreshing(true);
    // setScanLog(['🚀 Iniciando varredura automática de preços...']); // Removed as scanLog state is not defined

    try {
      const allUpdates = await scanAllMarkets(markets, products, (msg) => {
        setScanLog(prev => [...prev.slice(-15), msg]); // Keep last 15 messages
      });
      
      if (Object.keys(allUpdates).length > 0) {
        const updatedProducts = applyPriceUpdates(products, allUpdates);
        setProducts(updatedProducts);
        
        const totalUpdated = Object.values(allUpdates).reduce((sum, m) => sum + Object.keys(m).length, 0);
        showToast(`✅ ${totalUpdated} preços atualizados com sucesso!`);
        setScanLog(prev => [...prev, `✅ ${totalUpdated} preços do catálogo foram atualizados!`]);
      } else {
        showToast('ℹ️ Nenhum preço novo encontrado nesta varredura.');
        setScanLog(prev => [...prev, '⚠️ Nenhum preço novo encontrado.']);
      }
      
      localStorage.setItem(KEYS.LAST_SCAN, new Date().toISOString());
      
    } catch (err) {
      console.error('Scan error:', err);
      // setScanLog(prev => [...prev, `❌ Erro: ${err.message}`]); // Removed as scanLog state is not defined
      showToast('Erro na varredura de preços.');
    }
    
    setRefreshing(false);
  };

  const findNearbyMarkets = async () => {
    setGpsLoading(true);
    setGpsStatus('Solicitando permissão de localização...');
    setNearbyMarkets([]);
    
    try {
      // Request permission first
      const permResult = await Geolocation.requestPermissions();
      const isGranted = permResult.location === 'granted' || permResult.coarseLocation === 'granted';
      
      if (!isGranted) {
        setGpsStatus('❌ Permissão de localização negada. Vá em Configurações > Apps > Lista de Mercado > Permissões e ative Localização.');
        setGpsLoading(false);
        return;
      }
      
      setGpsStatus('📡 Obtendo posição GPS...');
      
      let position;
      try {
        position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000
        });
      } catch (e) {
        console.warn('High accuracy failed, trying low accuracy...', e);
        setGpsStatus('📡 GPS de alta precisão falhou, tentando modo econômico...');
        position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 10000
        });
      }
      
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      
      setGpsStatus(`📍 Posição: ${lat.toFixed(4)}, ${lng.toFixed(4)} — Buscando endereço...`);

      // Reverse geocoding to get street name
      let streetName = '';
      try {
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
          headers: { 'Accept-Language': 'pt-BR' }
        });
        const geoData = await geoRes.json();
        const addr = geoData.address || {};
        streetName = [addr.road, addr.neighbourhood, addr.suburb, addr.city].filter(Boolean).join(', ');
        setGpsStatus(`📍 ${streetName || geoData.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`} — Buscando mercados...`);
      } catch (geoErr) {
        console.warn('Geocoding failed:', geoErr);
        setGpsStatus(`📍 Posição: ${lat.toFixed(6)}, ${lng.toFixed(6)} — Buscando mercados...`);
      }
      
      // ── Search for REAL nearby supermarkets via Overpass API (OpenStreetMap) ──
      setGpsStatus(`📍 ${streetName || `${lat.toFixed(4)}, ${lng.toFixed(4)}`} — Buscando mercados REAIS...`);
      
      const toRad = (v) => (v * Math.PI) / 180;
      const haversine = (lat1, lng1, lat2, lng2) => {
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      };

      let realMarkets = [];
      
      try {
        // Overpass query: find all supermarkets within 5km radius
        const overpassQuery = `[out:json][timeout:10];(node["shop"="supermarket"](around:5000,${lat},${lng});way["shop"="supermarket"](around:5000,${lat},${lng}););out center;`;
        const overpassRes = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`);
        const overpassData = await overpassRes.json();
        
        realMarkets = (overpassData.elements || [])
          .map(el => {
            const mLat = el.lat || (el.center && el.center.lat);
            const mLng = el.lon || (el.center && el.center.lon);
            const name = (el.tags && el.tags.name) || 'Mercado';
            if (!mLat || !mLng) return null;
            return { name, lat: mLat, lng: mLng, dist: haversine(lat, lng, mLat, mLng) };
          })
          .filter(Boolean)
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 10);
      } catch (overpassErr) {
        console.warn('Overpass API failed:', overpassErr);
      }

      // Also include user-saved locations
      const savedLocations = JSON.parse(localStorage.getItem(KEYS.LOCATIONS)) || [];
      for (const sl of savedLocations) {
        if (!realMarkets.find(m => m.name.toLowerCase() === sl.name.toLowerCase())) {
          realMarkets.push({ ...sl, dist: haversine(lat, lng, sl.lat, sl.lng) });
        }
      }

      // Sort again after merging
      realMarkets.sort((a, b) => a.dist - b.dist);
      
      const nearby = realMarkets.slice(0, 10).map(c => ({
        name: c.name,
        distance: c.dist < 1 ? `${(c.dist * 1000).toFixed(0)}m` : `${c.dist.toFixed(1)}km`,
        lat: c.lat,
        lng: c.lng
      }));
      
      setNearbyMarkets(nearby);
      setGpsStatus(`✅ ${streetName || `${lat.toFixed(4)}, ${lng.toFixed(4)}`} — ${nearby.length} mercados reais encontrados!`);

      // Add "Current Location" as a pseudo-market for registration
      setNearbyMarkets(prev => [
        { name: `📍 ${streetName || 'Minha Localização Atual'}`, distance: "0m", lat, lng, isCurrent: true },
        ...prev
      ]);
      
    } catch (err) {
      console.error('GPS Error:', err);
      // Fallback to browser geolocation
      try {
        setGpsStatus('📡 Tentando geolocalização alternativa...');
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
        });
        
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setGpsStatus(`📍 Posição: ${lat.toFixed(4)}, ${lng.toFixed(4)} — Procure no mapa por supermercados.`);
      } catch (fallbackErr) {
        setGpsStatus('❌ Não foi possível obter a localização. Verifique se o GPS está ativado.');
      }
    }
    
    setGpsLoading(false);
  };

  const confirmFinalize = () => {
    if (currentList.length === 0) return;
    const date = new Date().toLocaleString('pt-BR');
    const name = listName.trim() || `Lista ${date.split(' ')[0]}`;
    const id = Date.now();
    const entry = { id, name, date, items: currentList, total };
    
    setHistoryList(prev => [entry, ...prev]);
    generatePDF(currentList, date, total, name);
    
    setCurrentList([]);
    setActiveShoppingId(id);
    setView('shopping');
    setShowFinalizeModal(false);
    setListName('');
    showToast(`Lista "${name}" criada! Marque os itens durante as compras.`);
  };

  const shareAsText = async (list) => {
    if (!list) return;
    const text = formatListForText(list);
    
    await Share.share({
      title: list.name || 'Minha Lista de Compras',
      text: text,
      dialogTitle: 'Exportar para Notas/WhatsApp'
    });
  };

  const formatListForText = (list) => {
    const itemsText = list.items.map(i => 
      `${i.checked ? '[X]' : '[ ]'} ${i.name} (${i.qty} ${i.unit}) - ${i.selectedMarket}: ${fmt.format(i.selectedPrice * i.qty)}`
    ).join('\n');
    return `🛒 *${list.name || 'Lista de Compras'}*\nData: ${list.date}\n\n${itemsText}\n\n*Total Estimado: ${fmt.format(list.total)}*\n\nGerado por Lista de Mercado`;
  };

  const loadContacts = async () => {
    setContactsLoading(true);
    setShowContactsModal(true);
    try {
      const perm = await Contacts.requestPermissions();
      if (perm.contacts === 'granted') {
        const result = await Contacts.getContacts({
          projection: {
            name: true,
            phones: true
          }
        });
        
        if (!result || !result.contacts) {
          throw new Error('Plugin retornou dados inválidos.');
        }

        const validContacts = result.contacts
          .filter(c => c && c.phones && c.phones.length > 0)
          .map(c => ({
            id: c.contactId || c.id || Math.random().toString(),
            name: c.name?.display || c.displayName || 'Sem Nome',
            phone: c.phones[0]?.number 
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
          
        if (validContacts.length === 0) {
          showToast('Nenhum contato com telefone encontrado.');
        }

        setContactsList(validContacts);
      } else {
        showToast('Permissão de contatos negada.');
        setShowContactsModal(false);
      }
    } catch (e) {
      console.error('Error fetching contacts', e);
      showToast(`Erro ao ler contatos: ${e.message || 'Desconhecido'}`);
      setShowContactsModal(false);
    }
    setContactsLoading(false);
  };

  const toggleContact = (contact) => {
    setSelectedContacts(prev => {
      if (prev.find(c => c.id === contact.id)) {
        return prev.filter(c => c.id !== contact.id);
      }
      if (prev.length >= 3) {
        showToast('Você só pode selecionar até 3 contatos.');
        return prev;
      }
      return [...prev, contact];
    });
  };

  const sendToWhatsApp = (list) => {
    if (!list) return;
    if (selectedContacts.length === 0) return;

    const text = encodeURIComponent(formatListForText(list));
    
    // In Capacitor/Mobile, we should avoid multiple window.open calls in a loop
    // because they get blocked or cancel each other.
    // If multiple contacts are selected, we'll suggest sending to each one but
    // since we can't easily automate sequence without user re-interaction in many cases,
    // we will prioritize the first one or open the first one directly.
    
    if (selectedContacts.length > 1) {
      showToast('Atenção: Enviando para o primeiro contato selecionado.');
    }

    const contact = selectedContacts[0];
    let cleanPhone = contact.phone ? contact.phone.replace(/[^0-9]/g, '') : '';
    
    if (!cleanPhone) {
      showToast(`O contato ${contact.name} não possui um número válido.`);
      return;
    }

    // Auto-prepend 55 for Brazil if not present but number has DDD (10-11 digits)
    if (cleanPhone.length >= 10 && cleanPhone.length <= 11 && !cleanPhone.startsWith('55')) {
      cleanPhone = '55' + cleanPhone;
    }

    const url = `https://wa.me/${cleanPhone}?text=${text}`;
    
    try {
      // Use window.location.href for more reliable redirect in Capacitor/WebView
      // or window.open if needed, but location.href is better for single intent.
      window.location.href = url;
      
      showToast('Redirecionando para o WhatsApp...');
    } catch (err) {
      console.error('WhatsApp redirect failed:', err);
      showToast('Erro ao abrir o WhatsApp.');
    }
    
    setShowContactsModal(false);
    setSelectedContacts([]);
  };



  const shareApp = async () => {
    await Share.share({
      title: 'Baixe o Lista de Mercado',
      text: 'Olá! Estou usando o Lista de Mercado para organizar minhas compras e economizar. Baixe o app aqui!',
      url: 'https://drive.google.com/drive/folders/1_PLACEHOLDER_LINK', // User should update this
      dialogTitle: 'Compartilhar Aplicativo'
    });
  };

  const activeShop = historyList.find(h => h.id === activeShoppingId);
  const displayTotal = view === 'shopping' ? (activeShop?.total || 0) : total;

  // ══════════════════════════════════════════
  // ════════════ RENDERING ═══════════════════
  // ══════════════════════════════════════════
  
  return (
    <div className="flex flex-col h-screen max-h-screen bg-sand-100 text-black overflow-hidden select-none transition-colors duration-500">
      
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] bg-black text-white px-6 py-2.5 rounded-full text-xs font-bold shadow-premium animate-slide-up flex items-center gap-2">
          <CheckCircle2 size={14} className="text-accent-green-500" /> {toast}
        </div>
      )}

      {/* Header */}
      <header className="shrink-0 glass border-b border-sand-400 px-6 py-4 flex items-center justify-between z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white shadow-sm">
            <ShoppingCart size={18} />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-black tracking-tight text-black">Lista de Mercado</h1>
            {isScanning && (
              <div className="flex items-center gap-1 bg-sand-100 px-2 py-0.5 rounded-full border border-sand-200">
                <Zap size={10} className="text-brand-500 animate-pulse" />
                <span className="text-[8px] font-black uppercase tracking-tighter text-black">Sync...</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={shareApp} title="Compartilhar App" className="p-2 rounded-lg transition-all text-black hover:text-brand-600">
            <Share2 size={20} />
          </button>
          <button onClick={() => setView('home')} title="Início" className={`p-2 rounded-lg transition-all ${view === 'home' ? 'bg-brand-100 text-brand-600' : 'text-black'}`}>
            <LayoutGrid size={20} />
          </button>
          <button onClick={() => setView('history')} title="Histórico" className={`p-2 rounded-lg transition-all ${view === 'history' ? 'bg-brand-100 text-brand-600' : 'text-black'}`}>
            <History size={20} />
          </button>
          <button onClick={() => setView('settings')} title="Configurações" className={`p-2 rounded-lg transition-all ${view === 'settings' ? 'bg-brand-100 text-brand-600' : 'text-black'}`}>
            <MapPin size={20} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-6 relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="pb-20"
          >
            {view === 'home' && (
            <>
              {/* Search Section */}
              <section className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-sand-500" size={18} />
                  <input 
                    type="text" placeholder="Buscar produtos (carne, fruta...)"
                    className="w-full bg-white border border-sand-400 rounded-xl py-3.5 pl-11 pr-4 text-sm font-medium focus:ring-1 ring-brand-500 outline-none transition-all placeholder:text-sand-500 shadow-premium"
                    value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>

                {/* Categories */}
                <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
                  {categories.map(c => (
                    <button key={c} onClick={() => setActiveCategory(c)}
                      className={`whitespace-nowrap px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition-all ${
                        activeCategory === c ? 'bg-black text-white border-neutral-900' : 'bg-white text-black border-sand-400'
                      }`}
                    >{c}</button>
                  ))}
                </div>
              </section>

              {/* Catalog Results */}
              {(searchTerm || activeCategory !== 'Todas') && (
                <div className="space-y-2 animate-slide-up">
                  <p className="text-[10px] font-black text-black uppercase tracking-widest px-1">Resultados Catalogados</p>
                  {filtered.length > 0 ? filtered.slice(0, 30).map(p => (
                    <button key={p.id} onClick={() => openConfig(p)}
                      className="w-full bg-white p-3 rounded-xl flex items-center gap-4 border border-sand-400 hover:border-brand-100 transition-all active:scale-[0.98] shadow-premium"
                    >
                      <div className="w-12 h-12 bg-sand-100 rounded-lg overflow-hidden shrink-0">
                         <img src={getProductImage(p.name)} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                      </div>
                      <div className="text-left flex-1">
                        <p className="text-sm font-bold text-black">{p.name}</p>
                        <p className="text-[10px] text-black">{p.category} • Preços</p>
                      </div>
                      <PlusCircle className="text-brand-500" size={20} />
                    </button>
                  )) : (
                    <div className="bg-white p-8 rounded-xl text-center border border-dashed border-sand-400 space-y-3">
                      <p className="text-xs text-black">Produto não encontrado no catálogo.</p>
                      <button 
                        onClick={() => openConfig({ id: Date.now(), name: searchTerm, category: 'Outros', nagumoPrice: 0, higasPrice: 0, unit: 'un' })}
                        className="text-[10px] font-black bg-black text-white px-4 py-2 rounded-lg uppercase tracking-widest"
                      >
                        Criar Novo "{searchTerm}"
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* My List Section */}
              <section className="space-y-4">
                <div className="flex items-center justify-between px-1 pt-4 border-t border-sand-400">
                  <h2 className="text-sm font-black uppercase tracking-widest text-black">Minha Lista Atual</h2>
                  {currentList.length > 0 && (
                    <button onClick={() => setCurrentList([])} className="text-[10px] text-red-400 font-bold uppercase">Limpar tudo</button>
                  )}
                </div>

                {currentList.length === 0 ? (
                  <div className="py-20 text-center space-y-4">
                    <div className="w-16 h-16 bg-white rounded-2xl mx-auto flex items-center justify-center text-black border border-sand-400 shadow-premium opacity-50">
                      <List size={32} />
                    </div>
                    <p className="text-xs font-medium text-black">Comece a buscar para adicionar itens.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {currentList.map(item => (
                      <div key={item.id} className="bg-white rounded-xl border border-sand-400 p-4 shadow-premium group">
                        <div className="flex items-start gap-4">
                          <div className="w-14 h-14 bg-sand-100 rounded-xl overflow-hidden shrink-0 border border-sand-300">
                             <img src={getProductImage(item.name)} alt={item.name} className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-sm font-bold text-black leading-tight">{item.name}</h3>
                            <div className="flex items-center gap-3 mt-1.5">
                              <span className="text-[9px] font-black bg-sand-300 px-1.5 py-0.5 rounded text-sand-500 uppercase">{item.category}</span>
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] font-bold text-black">Qtd:</span>
                                <input 
                                  type="number" min="1" step="any"
                                  className="w-12 bg-sand-100 border border-sand-400 rounded px-1 py-0.5 text-xs font-bold outline-none text-center"
                                  value={item.qty}
                                  onChange={e => {
                                    const val = Math.max(0.1, parseFloat(e.target.value) || 1);
                                    setCurrentList(l => l.map(x => x.id === item.id ? { ...x, qty: val } : x));
                                  }}
                                />
                                <span className="text-[9px] font-bold text-black">{item.unit}</span>
                              </div>
                            </div>
                          </div>
                          <button onClick={() => setCurrentList(l => l.filter(x => x.id !== item.id))} className="text-sand-200 hover:text-red-400 transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="bg-sand-300/40 rounded-lg p-3 mt-4 flex items-center justify-between gap-2">
                          <p className="text-[10px] font-black uppercase text-black tracking-wider">Mercado {item.selectedMarket}</p>
                          <div className="flex items-center gap-2">
                             <div className="relative">
                               <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-black">R$</span>
                               <input 
                                 type="number" step="0.01"
                                 className="w-20 bg-white border border-sand-400 rounded px-1 pl-5 py-0.5 text-xs font-bold outline-none ring-brand-500 focus:ring-1"
                                 value={item.selectedPrice || ''}
                                 onChange={e => {
                                   const val = parseFloat(e.target.value) || 0;
                                   setCurrentList(l => l.map(x => x.id === item.id ? { ...x, selectedPrice: val } : x));
                                 }}
                               />
                             </div>
                             <p className="text-sm font-bold text-brand-600 w-20 text-right">{fmt.format(item.selectedPrice * item.qty)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {view === 'history' && (
            <div className="space-y-4 animate-slide-up">
              <div className="flex items-center justify-between">
                 <h2 className="text-sm font-black uppercase tracking-widest text-black">Listas Passadas</h2>
                 {historyList.length > 0 && (
                    <button onClick={() => { if(window.confirm('Excluir todo o histórico?')) setHistoryList([]); }} 
                       className="text-[10px] text-red-500 font-bold uppercase tracking-wider">Limpar Tudo</button>
                 )}
              </div>

              {historyList.length === 0 ? (
                <p className="text-center py-20 text-xs text-black">Nenhuma lista no histórico.</p>
              ) : historyList.map(h => (
                <div key={h.id} className="bg-white rounded-xl border border-sand-400 p-5 shadow-premium space-y-4">
                   <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-sm font-bold text-black">{h.name || "Lista s/ nome"}</h3>
                        <p className="text-xs font-bold text-sand-500 mt-1">{h.date}</p>
                        <p className="text-[10px] text-black uppercase tracking-widest mt-0.5">{h.items.length} itens • {fmt.format(h.total)}</p>
                      </div>
                      <div className="flex flex-col gap-2 items-end">
                         <button onClick={(e) => { e.stopPropagation(); setHistoryList(prev => prev.filter(x => x.id !== h.id)); }} 
                            className="text-sand-500 hover:text-red-500 transition-colors p-1">
                            <Trash2 size={16} />
                         </button>
                         <button onClick={() => {
                           const items = h.items.map(i => ({...i, checked: false}));
                           setHistoryList(prev => prev.map(list => list.id === h.id ? {...list, items} : list));
                           setActiveShoppingId(h.id);
                           setView('shopping');
                         }} className="bg-black text-white px-4 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest mt-2">
                           Re-Comprar
                         </button>
                      </div>
                   </div>
                   <div className="flex gap-1 flex-wrap">
                      {h.items.slice(0, 5).map((it, i) => (
                        <span key={i} className="text-[8px] font-black uppercase bg-sand-300 px-1.5 py-0.5 rounded text-sand-500">{it.name}</span>
                      ))}
                      {h.items.length > 5 && <span className="text-[8px] font-black uppercase bg-sand-300 px-1.5 py-0.5 rounded text-sand-500">+{h.items.length - 5}</span>}
                   </div>
                </div>
              ))}
            </div>
          )}

          {view === 'shopping' && (() => {
             const activeShop = historyList.find(h => h.id === activeShoppingId);
             if (!activeShop) return (
                <div className="py-20 text-center space-y-4">
                   <p className="text-xs font-medium text-black">Selecione uma lista no histórico para iniciar as compras.</p>
                   <button onClick={() => setView('history')} className="text-[10px] font-black bg-black text-white px-4 py-2 rounded-lg uppercase tracking-widest">Ver Histórico</button>
                </div>
             );

             const checkedCount = activeShop.items.filter(i => i.checked).length;
             const totalItems = activeShop.items.length;
             const isComplete = checkedCount === totalItems && totalItems > 0;

             return (
               <div className="space-y-6 animate-slide-up">
                  <div className="bg-black rounded-2xl p-6 text-white shadow-xl">
                     <p className="text-[9px] font-black uppercase tracking-widest text-sand-500 mb-1">Modo Supermercado</p>
                     <div className="flex justify-between items-start">
                        <h2 className="text-xl font-black">{activeShop.name || "Lista Aberta"}</h2>
                        <div className="flex gap-1">
                          <button onClick={loadContacts} className="bg-green-500/20 hover:bg-green-500/40 p-2 rounded-lg text-green-400 transition-all flex items-center gap-1 text-[10px] font-bold border border-green-500/30">
                             WhatsApp
                          </button>
                          <button onClick={() => shareAsText(activeShop)} className="bg-white/10 hover:bg-white/20 p-2 rounded-lg text-white transition-all flex items-center gap-1.5 text-[10px] font-bold">
                             <Copy size={14} /> Texto
                          </button>
                        </div>
                     </div>
                     <div className="mt-4 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 transition-all duration-700" 
                            style={{ width: `${(checkedCount / totalItems) * 100 || 0}%` }}></div>
                        </div>
                        <span className="text-[10px] font-black text-brand-500">
                          {checkedCount} / {totalItems}
                        </span>
                     </div>
                  </div>

                  <div className="space-y-3">
                     {activeShop.items.map((item, idx) => (
                        <div key={item.id} 
                          onClick={() => {
                             setHistoryList(prev => prev.map(h => {
                                if (h.id === activeShop.id) {
                                   const newItems = [...h.items];
                                   newItems[idx].checked = !newItems[idx].checked;
                                   if (newItems[idx].checked) {
                                     Haptics.impact({ style: ImpactStyle.Medium });
                                   }
                                   return {...h, items: newItems};
                                }
                                return h;
                             }));
                          }}
                          className={`p-4 rounded-xl border-2 transition-all flex items-center gap-4 cursor-pointer ${
                            item.checked ? 'bg-brand-50 border-brand-100 opacity-60' : 'bg-white border-sand-400 shadow-premium'
                          }`}
                        >
                           <div className="flex-1">
                              <p className={`text-sm font-bold transition-all ${item.checked ? 'line-through text-black' : 'text-black'}`}>{item.name}</p>
                              <p className="text-[9px] text-black uppercase tracking-widest mt-0.5">{item.category} • {item.qty} {item.unit} • {item.selectedMarket}</p>
                              <p className="text-[10px] font-black text-brand-600 mt-1">{fmt.format(item.selectedPrice * item.qty)}</p>
                           </div>
                           <button className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest shrink-0 transition-colors ${
                              item.checked ? 'bg-brand-500 text-white shadow-active scale-95' : 'bg-sand-300 text-sand-500 shadow-sm'
                           }`}>
                              {item.checked ? 'OK ✓' : 'Marcar'}
                           </button>
                        </div>
                     ))}
                  </div>
               </div>
             );
           })()}

           {/* Shopping Finished Modal */}
           {showCongratsModal && (
             <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[300] flex items-center justify-center p-6 animate-fade-in">
               <div className="bg-white w-full max-w-[320px] rounded-3xl p-8 py-10 text-center space-y-6 shadow-2xl relative overflow-hidden">
                 <div className="absolute -top-10 -right-10 w-32 h-32 bg-brand-50 rounded-full blur-2xl"></div>
                 <div className="absolute bottom-0 -left-10 w-24 h-24 bg-yellow-50 rounded-full blur-xl"></div>
                 <div className="relative z-10 w-24 h-24 bg-gradient-to-br from-brand-500 to-brand-600 rounded-full mx-auto flex items-center justify-center text-white shadow-lg shadow-brand-500/30 transform transition-transform hover:scale-110">
                   <CheckCircle2 size={48} className="animate-pulse" />
                 </div>
                 <div className="relative z-10 space-y-2">
                   <h3 className="text-2xl font-black text-black tracking-tight">Compra<br/>Finalizada!</h3>
                   <p className="text-[13px] text-sand-500 font-medium leading-relaxed px-2">Você marcou todos os itens. Parabéns pela organização e economia!</p>
                 </div>
                 <button 
                   onClick={() => {
                     setShowCongratsModal(false);
                     setView('home');
                   }}
                   className="relative z-10 w-full bg-black text-white py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-premium active:scale-95 transition-all outline-none"
                 >
                   Voltar ao Início
                 </button>
               </div>
             </div>
           )}

           {view === 'completed' && (
             <div className="space-y-8 animate-slide-up py-10 text-center flex flex-col items-center justify-center">
                <div className="w-24 h-24 bg-brand-100 rounded-full flex items-center justify-center shadow-lg mb-6">
                  <CheckCircle2 size={48} className="text-brand-600" />
                </div>
                <h1 className="text-3xl font-black text-black tracking-tighter">Parabéns!</h1>
                <p className="text-sm text-sand-500 max-w-xs mx-auto">Sua lista foi fechada com sucesso! O PDF foi gerado. Boas compras ou bom planejamento!</p>
                <div className="pt-8 w-full max-w-xs">
                  <button 
                    onClick={() => setView('home')}
                    className="bg-black text-white px-8 py-4 rounded-xl font-bold text-sm shadow-premium active:scale-95 transition-all w-full"
                  >
                    Fazer Nova Lista
                  </button>
                  <button 
                    onClick={() => setView('history')}
                    className="mt-6 text-xs font-bold text-black hover:text-black transition-colors w-full"
                  >
                    Ver Histórico de Compras
                  </button>
                </div>
             </div>
           )}

           {view === 'settings' && (
             <div className="space-y-6 animate-slide-up pb-20">
               <div className="flex items-center justify-between">
                  <h2 className="text-sm font-black uppercase tracking-widest text-black">Meus Supermercados</h2>
               </div>

               <div className="bg-white rounded-xl border border-sand-400 p-6 shadow-premium space-y-4">
                  <p className="text-xs text-black font-medium leading-relaxed">Adicione os mercados que você costuma visitar. O app permitirá comparar preços e abrir a busca de cada um.</p>
                  
                  <div className="space-y-2">
                    {markets.map(m => (
                      <div key={m} className="flex items-center justify-between bg-sand-100 p-3 rounded-xl border border-sand-400">
                        <span className="text-sm font-bold text-black">{m}</span>
                        <button 
                          onClick={() => {
                            if (markets.length <= 1) return showToast("Mantenha ao menos um mercado.");
                            setMarkets(prev => prev.filter(x => x !== m));
                          }}
                          className="text-red-400 hover:text-red-600 p-2"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="pt-4 border-t border-sand-400">
                    <p className="text-[10px] font-black uppercase text-black tracking-widest mb-2 ml-1">Adicionar Novo Mercado</p>
                    <div className="flex gap-2">
                      <input 
                        type="text" id="newStoreInput" placeholder="Ex: Sonda, Carrefour..."
                        className="flex-1 bg-sand-300 rounded-xl py-2.5 px-4 text-sm font-bold outline-none border border-sand-400 focus:ring-1 ring-brand-500"
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const val = e.target.value.trim();
                            if (!val) return;
                            if (markets.includes(val)) return showToast("Mercado já existe.");
                            setMarkets(prev => [...prev, val]);
                            e.target.value = '';
                            showToast(`${val} adicionado!`);
                          }
                        }}
                      />
                      <button 
                        onClick={() => {
                          const el = document.getElementById('newStoreInput');
                          const val = el.value.trim();
                          if (!val) return;
                          if (markets.includes(val)) return showToast("Mercado já existe.");
                          setMarkets(prev => [...prev, val]);
                          el.value = '';
                          showToast(`${val} adicionado!`);
                        }}
                        className="bg-black text-white px-5 rounded-xl font-black text-xs uppercase tracking-widest shadow-premium active:scale-95"
                      >
                        Add
                      </button>
                    </div>
                  </div>
               </div>

               <div className="bg-white rounded-xl border border-sand-400 p-6 shadow-premium space-y-4">
                  <div className="flex items-center gap-2">
                    <Zap size={18} className="text-brand-500" />
                    <h3 className="text-sm font-bold">Automação de Encartes</h3>
                  </div>
                  <p className="text-xs text-black leading-relaxed">Busca automática nos sites e PDFs de encartes dos mercados. Lê cartazes de preços, promoções e atualiza o catálogo.</p>
                  
                  {scanLog.length > 0 && (
                    <div className="bg-black rounded-xl p-4 max-h-48 overflow-y-auto">
                      {scanLog.map((log, i) => (
                        <p key={i} className="text-[10px] text-green-400 font-mono leading-relaxed">{log}</p>
                      ))}
                    </div>
                  )}
                  
                  <button 
                    disabled={refreshing}
                    onClick={syncPriceCards}
                    className="w-full bg-brand-600 text-white py-3.5 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-premium active:scale-95 transition-all disabled:opacity-50"
                  >
                    {refreshing ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />} 
                    {refreshing ? 'Escaneando...' : 'Escanear Todos os Mercados'}
                  </button>
                  <p className="text-[9px] text-center text-black">
                    Última varredura: {localStorage.getItem(KEYS.LAST_SCAN) 
                      ? new Date(localStorage.getItem(KEYS.LAST_SCAN)).toLocaleString('pt-BR') 
                      : 'Nunca'} • Auto: a cada 12h
                  </p>
               </div>

               <div className="bg-white rounded-xl border border-sand-400 p-6 shadow-premium space-y-4">
                  <div className="flex items-center gap-2">
                    <Navigation size={18} className="text-brand-500" />
                    <h3 className="text-sm font-bold">Localização GPS</h3>
                  </div>
                  <p className="text-xs text-black leading-relaxed">Use o GPS do aparelho para localizar supermercados próximos e adicioná-los automaticamente à sua lista.</p>
                  {gpsStatus && (
                    <div className="bg-sand-100 border border-sand-400 rounded-lg p-3">
                      <p className="text-[10px] text-sand-500 font-bold">{gpsStatus}</p>
                    </div>
                  )}
                  {nearbyMarkets.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[9px] font-black uppercase text-black tracking-widest ml-1">Mercados Próximos Encontrados:</p>
                      {nearbyMarkets.map((nm, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-brand-50 border border-brand-100 p-3 rounded-xl">
                          <div>
                            <span className="text-xs font-bold text-black block">{nm.name}</span>
                            <span className="text-[9px] text-black">{nm.distance}</span>
                          </div>
                          <button 
                            onClick={() => {
                              if (nm.isCurrent) {
                                const newName = prompt("Nome do mercado nesta localização (ex: Higas):", "Meu Mercado");
                                if (newName) {
                                  // Add to markets list
                                  if (!markets.includes(newName)) {
                                    setMarkets(prev => [...prev, newName]);
                                  }
                                  
                                  // Save coordinates locally so GPS calculates correct distance next time
                                  const savedLocs = JSON.parse(localStorage.getItem(KEYS.LOCATIONS)) || [];
                                  const updatedLocs = savedLocs.filter(l => l.name !== newName);
                                  updatedLocs.push({ name: newName, lat: nm.lat, lng: nm.lng });
                                  localStorage.setItem(KEYS.LOCATIONS, JSON.stringify(updatedLocs));
                                  
                                  showToast(`${newName} atualizado com sua localização EXATA!`);
                                }
                              } else {
                                if (!markets.includes(nm.name)) {
                                  setMarkets(prev => [...prev, nm.name]);
                                  showToast(`${nm.name} adicionado!`);
                                } else {
                                  showToast(`${nm.name} já está na lista.`);
                                }
                              }
                              Haptics.impact({ style: ImpactStyle.Medium });
                            }}
                            className="bg-brand-600 text-white px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest active:scale-95"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button 
                    disabled={gpsLoading}
                    onClick={findNearbyMarkets}
                    className="w-full bg-brand-50 text-brand-600 border border-brand-100 py-3.5 rounded-xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
                  >
                    {gpsLoading ? <RefreshCw size={14} className="animate-spin" /> : <MapPin size={14} />} 
                    {gpsLoading ? 'Buscando...' : 'Buscar Mercados Próximos'}
                  </button>
               </div>
             </div>
           )}

          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer Totalizer / Float Action */}
      <footer className="shrink-0 glass border-t border-sand-400 px-6 py-6 pb-12 shadow-[0_-10px_30px_rgba(0,0,0,0.03)] z-50">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-[9px] font-black text-black uppercase tracking-widest">Total Estimado</p>
            <p className="text-2xl font-black tracking-tight">{fmt.format(displayTotal)}</p>
          </div>
          <button 
            disabled={view !== 'home' || currentList.length === 0}
            onClick={() => setShowFinalizeModal(true)}
            className="bg-black text-white px-8 py-3.5 rounded-xl font-bold text-sm shadow-premium active:scale-95 disabled:opacity-20 transition-all flex items-center gap-2"
          >
            Criar Lista <ChevronRight size={16} />
          </button>
        </div>
      </footer>

      {/* Selection Modal (Detail View) */}
      {selectedProduct && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center px-4" onClick={() => setSelectedProduct(null)}>
          <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-8 space-y-6 shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col items-center text-center gap-4">
               <div className="w-32 h-32 bg-sand-100 rounded-3xl overflow-hidden shadow-lg border-4 border-white">
                  <img src={getProductImage(selectedProduct.name)} alt={selectedProduct.name} className="w-full h-full object-cover" />
               </div>
               <div className="w-full flex justify-between items-start">
                  <div className="text-left">
                     <h2 className="text-base font-black text-black">{selectedProduct.name}</h2>
                     <p className="text-xs text-black">{selectedProduct.category}</p>
                  </div>
                  <button onClick={() => setSelectedProduct(null)} className="p-2 bg-sand-300 rounded-lg text-sand-500"><X size={18} /></button>
               </div>
            </div>

            <div className="space-y-4">
               <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                     <label className="text-[9px] font-black uppercase text-black tracking-widest ml-1">Quantidade</label>
                     <div className="flex items-center bg-sand-300 rounded-xl p-1 gap-2">
                        <button onClick={() => setConfig(c => ({...c, qty: Math.max(1, c.qty - 1)}))} className="w-8 h-8 bg-white rounded-lg font-black shadow-sm">-</button>
                        <span className="flex-1 text-center font-black text-sm">{config.qty}</span>
                        <button onClick={() => setConfig(c => ({...c, qty: c.qty + 1}))} className="w-8 h-8 bg-white rounded-lg font-black shadow-sm">+</button>
                     </div>
                  </div>
                  <div className="space-y-1.5">
                     <label className="text-[9px] font-black uppercase text-black tracking-widest ml-1">Medida</label>
                     <select className="w-full bg-sand-300 rounded-xl py-2 px-3 text-xs font-bold outline-none appearance-none"
                        value={config.unit} onChange={e => setConfig({...config, unit: e.target.value})}>
                        <option value="un">Unidade</option>
                        <option value="kg">Quilo (kg)</option>
                        <option value="L">Litro (L)</option>
                        <option value="pacote">Pacote</option>
                        <option value="ml">ML</option>
                        <option value="g">Gramas</option>
                     </select>
                  </div>
               </div>

               <div className="pt-2 space-y-3">
                  {bestPriceHint && (
                     <div className="bg-brand-100 border border-brand-100 text-pastel-green-800 p-2 rounded-lg text-xs font-bold text-center animate-pulse">
                       {bestPriceHint}
                     </div>
                  )}
                  <p className="text-[9px] font-black uppercase text-black tracking-widest ml-1 mb-1">Preços por Mercado:</p>
                  <div className="space-y-3">
                     {markets.map(m => (
                       <div key={m} className="bg-sand-100 p-3 rounded-xl border border-sand-400 space-y-2">
                         <div className="flex items-center justify-between">
                           <span className="text-[10px] font-black uppercase text-black tracking-wider font-sans">{m}</span>
                           <button 
                             onClick={() => window.open((MARKET_SEARCH_URLS[m] || MARKET_SEARCH_URLS.Default)(selectedProduct.name), '_blank')}
                             className="text-[9px] font-black bg-white border border-sand-400 px-2 py-1 rounded text-sand-500 uppercase flex items-center gap-1 hover:bg-brand-50 transition-colors"
                           >
                             <Search size={10} /> Buscar Preço
                           </button>
                         </div>
                         <div className="flex items-center gap-2">
                           <div className="relative flex-1">
                             <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-black">R$</span>
                             <input 
                               type="number" step="0.01"
                               className="w-full bg-white border border-sand-400 rounded-lg py-2 pl-8 pr-3 text-sm font-bold outline-none focus:ring-1 ring-brand-500"
                               value={config.marketPrices[m] || ''}
                               onChange={e => setConfig({
                                 ...config, 
                                 marketPrices: { ...config.marketPrices, [m]: parseFloat(e.target.value) || 0 }
                               })}
                             />
                           </div>
                           <button 
                             onClick={() => confirmAdd(m, config.marketPrices[m] || 0)}
                             className="bg-black text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                           >
                             Adicionar
                           </button>
                         </div>
                       </div>
                     ))}
                  </div>
               </div>
            </div>

          </div>
        </div>
      )}

      {/* WhatsApp Contacts Picker Modal */}
      {showContactsModal && (
         <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[300] flex flex-col justify-end sm:justify-center px-4 animate-slide-up">
            <div className="bg-sand-100 w-full max-w-sm mx-auto sm:rounded-3xl rounded-t-3xl pt-6 pb-8 space-y-4 shadow-2xl h-[85vh] flex flex-col">
               <div className="px-6 flex justify-between items-center shrink-0">
                  <div>
                    <h2 className="text-xl font-black text-black">Enviar Lista</h2>
                    <p className="text-[10px] text-sand-500 font-bold uppercase tracking-widest mt-1">
                      Selecione até 3 contatos ({selectedContacts.length}/3)
                    </p>
                  </div>
                  <button onClick={() => setShowContactsModal(false)} className="p-2 bg-white rounded-xl text-black"><X size={20} /></button>
               </div>
               
               <div className="px-6 shrink-0">
                 <div className="relative">
                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-black" size={14} />
                   <input type="text" placeholder="Buscar contato..." 
                      className="w-full bg-white rounded-xl py-3 pl-9 pr-4 text-xs font-bold outline-none focus:ring-2 ring-brand-500/50 shadow-sm"
                      value={contactSearchTerm} onChange={e => setContactSearchTerm(e.target.value)} />
                 </div>
               </div>

               <div className="flex-1 overflow-y-auto px-6 space-y-2 no-scrollbar">
                 {contactsLoading ? (
                   <div className="flex flex-col items-center justify-center h-full text-black gap-3">
                     <RefreshCw size={24} className="animate-spin" />
                     <p className="text-xs font-bold uppercase">Carregando Contatos...</p>
                   </div>
                 ) : (
                   contactsList
                     .filter(c => c.name.toLowerCase().includes(contactSearchTerm.toLowerCase()))
                     .map(contact => {
                       const isSelected = !!selectedContacts.find(sc => sc.id === contact.id);
                       return (
                         <button 
                           key={contact.id} 
                           onClick={() => toggleContact(contact)}
                           className={`w-full text-left p-3 rounded-xl flex items-center justify-between border-2 transition-all ${isSelected ? 'bg-brand-50 border-brand-500' : 'bg-white border-transparent'}`}
                         >
                           <div>
                             <p className={`text-xs font-bold ${isSelected ? 'text-pastel-green-800' : 'text-black'}`}>{contact.name}</p>
                             <p className="text-[10px] text-black mt-0.5">{contact.phone}</p>
                           </div>
                           <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${isSelected ? 'bg-brand-500 text-white' : 'bg-sand-300'}`}>
                             {isSelected && <Check size={12} strokeWidth={4} />}
                           </div>
                         </button>
                       )
                     })
                 )}
               </div>

               <div className="px-6 pt-2 shrink-0">
                  <button 
                     disabled={selectedContacts.length === 0}
                     onClick={() => sendToWhatsApp(historyList.find(h => h.id === activeShoppingId) || { name: "Lista Atual", date: new Date().toLocaleDateString(), items: currentList, total })} 
                     className="w-full bg-[#25D366] text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest shadow-premium active:scale-95 disabled:opacity-30 flex items-center justify-center gap-2 transition-all"
                  >
                     Enviar para WhatsApp
                  </button>
               </div>
            </div>
         </div>
      )}

      {/* Finalize Naming Modal */}
      {showFinalizeModal && (
         <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[300] flex items-center justify-center px-4 animate-slide-up">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 space-y-6 shadow-2xl">
               <div className="text-center space-y-2">
                  <h2 className="text-xl font-black text-black">Salvar Lista</h2>
                  <p className="text-xs text-black">Dê um nome para a sua lista de compras. O PDF será gerado em seguida.</p>
               </div>
               
               <input type="text" placeholder="Ex: Compras do Mês, Churrasco..." 
                  className="w-full bg-sand-300 rounded-xl py-4 px-4 text-sm font-bold outline-none focus:ring-2 ring-brand-500 text-center placeholder:text-black"
                  value={listName} onChange={e => setListName(e.target.value)} autoFocus />

               <div className="flex gap-3">
                  <button onClick={() => setShowFinalizeModal(false)} className="flex-1 bg-white border-2 border-sand-400 text-sand-500 py-3.5 rounded-xl font-black text-xs uppercase tracking-widest">
                     Voltar
                  </button>
                  <button onClick={confirmFinalize} className="flex-1 bg-brand-500 text-white py-3.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-premium active:scale-95">
                     Criar Lista
                  </button>
               </div>
            </div>
         </div>
      )}

    </div>
  );
}

export default App;
