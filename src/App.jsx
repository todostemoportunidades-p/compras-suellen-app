import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  ShoppingCart, Search, Plus, Trash2, Check, MapPin,
  TrendingDown, TrendingUp, Download, History, Calendar,
  Save, X, CheckCircle2, RefreshCw, FileText, ArrowLeft,
  ShoppingBag, Clock, ChevronRight, LayoutGrid, List, PlusCircle, Share2, Copy
} from 'lucide-react';
import { Share } from '@capacitor/share';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import baseProducts from './data/products.json';

// ─── Storage Keys ───
const KEYS = {
  PRODUCTS: 'mercado_products_v5',
  LISTS: 'mercado_lists_v5',
  CURRENT: 'mercado_current_v5',
  LAST_REFRESH: 'mercado_last_refresh_v5',
};

// ─── UTILS ───
const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const normalizeStr = (str) => {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

function refreshPrices(products) {
  return products.map(p => ({
    ...p,
    nagumoPrice: +(p.nagumoPrice * (0.98 + Math.random() * 0.04)).toFixed(2),
    higasPrice: +(p.higasPrice * (0.98 + Math.random() * 0.04)).toFixed(2),
  }));
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
    doc.text(listName || 'Lista de Compras Suellen', 14, 20);
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
  const [currentList, setCurrentList] = useState([]);
  const [historyList, setHistoryList] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  // UI State
  const [view, setView] = useState('home'); // 'home', 'shopping', 'history'
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('Todas');
  const [toast, setToast] = useState(null);
  
  // Selection/Naming Flow State
  const [selectedProduct, setSelectedProduct] = useState(null); // The one being 'configured' to add
  const [config, setConfig] = useState({ qty: 1, unit: 'un', priceN: 0, priceH: 0 });
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [listName, setListName] = useState('');
  const [activeShoppingId, setActiveShoppingId] = useState(null);

  // Persistence
  useEffect(() => {
    const p = localStorage.getItem(KEYS.PRODUCTS);
    const l = localStorage.getItem(KEYS.LISTS);
    const c = localStorage.getItem(KEYS.CURRENT);
    const r = localStorage.getItem(KEYS.LAST_REFRESH);

    let base = p ? JSON.parse(p) : baseProducts;
    if (isNewDay(r)) {
      base = refreshPrices(base);
      localStorage.setItem(KEYS.LAST_REFRESH, new Date().toISOString());
      localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(base));
    }
    setProducts(base);
    if (l) setHistoryList(JSON.parse(l));
    if (c) setCurrentList(JSON.parse(c));
  }, []);

  useEffect(() => { localStorage.setItem(KEYS.CURRENT, JSON.stringify(currentList)); }, [currentList]);
  useEffect(() => { localStorage.setItem(KEYS.LISTS, JSON.stringify(historyList)); }, [historyList]);
  useEffect(() => { localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(products)); }, [products]);

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
    setConfig({ qty: 1, unit: p.unit || 'un', priceN: p.nagumoPrice, priceH: p.higasPrice });
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
    setCurrentList(prev => [...prev, item]);
    setSelectedProduct(null);
    setSearchTerm('');
    showToast(`Adicionado: ${item.name} pelo preço do ${market}`);
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
    showToast(`Lista "${name}" iniciada!`);
  };

  const shareAsText = async (list) => {
    if (!list) return;
    const itemsText = list.items.map(i => 
      `${i.checked ? '[X]' : '[ ]'} ${i.name} (${i.qty} ${i.unit}) - ${i.selectedMarket}: ${fmt.format(i.selectedPrice * i.qty)}`
    ).join('\n');
    
    const text = `🛒 *${list.name || 'Lista de Compras'}*\nData: ${list.date}\n\n${itemsText}\n\n*Total Estimado: ${fmt.format(list.total)}*\n\nGerado por Compras Suellen`;
    
    await Share.share({
      title: list.name || 'Minha Lista de Compras',
      text: text,
      dialogTitle: 'Exportar para Notas/WhatsApp'
    });
  };

  const shareApp = async () => {
    await Share.share({
      title: 'Baixe o Compras Suellen',
      text: 'Olá! Estou usando o Compras Suellen para organizar minhas compras e economizar nos mercados Nagumo e Higas. Baixe o app aqui!',
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
    <div className="flex flex-col h-screen max-h-screen bg-sand-200 text-neutral-900 overflow-hidden select-none">
      
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] bg-neutral-900 text-white px-6 py-2.5 rounded-full text-xs font-bold shadow-premium animate-slide-up flex items-center gap-2">
          <CheckCircle2 size={14} className="text-pastel-green-500" /> {toast}
        </div>
      )}

      {/* Header */}
      <header className="shrink-0 bg-white border-b border-sand-400 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-pastel-green-500 rounded-lg flex items-center justify-center text-white shadow-sm">
            <ShoppingCart size={18} />
          </div>
          <h1 className="text-lg font-black tracking-tight">Compras<span className="text-pastel-green-600">Suellen</span></h1>
        </div>
        <div className="flex gap-2">
          <button onClick={shareApp} className="p-2 rounded-lg transition-all text-neutral-400 hover:text-pastel-green-600">
            <Share2 size={20} />
          </button>
          <button onClick={() => setView('home')} className={`p-2 rounded-lg transition-all ${view === 'home' ? 'bg-pastel-green-100 text-pastel-green-700' : 'text-neutral-400'}`}>
            <LayoutGrid size={20} />
          </button>
          <button onClick={() => setView('history')} className={`p-2 rounded-lg transition-all ${view === 'history' ? 'bg-pastel-green-100 text-pastel-green-700' : 'text-neutral-400'}`}>
            <History size={20} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar">
        <div className="max-w-xl mx-auto p-5 pb-40 space-y-6">

          {view === 'home' && (
            <>
              {/* Search Section */}
              <section className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-300" size={18} />
                  <input 
                    type="text" placeholder="Buscar produtos (carne, fruta...)"
                    className="w-full bg-white border border-sand-400 rounded-xl py-3.5 pl-11 pr-4 text-sm font-medium focus:ring-1 ring-pastel-green-400 outline-none transition-all placeholder:text-neutral-300 shadow-premium"
                    value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>

                {/* Categories */}
                <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
                  {categories.map(c => (
                    <button key={c} onClick={() => setActiveCategory(c)}
                      className={`whitespace-nowrap px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition-all ${
                        activeCategory === c ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-400 border-sand-400'
                      }`}
                    >{c}</button>
                  ))}
                </div>
              </section>

              {/* Catalog Results */}
              {searchTerm && (
                <div className="space-y-2 animate-slide-up">
                  <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest px-1">Resultados Catalogados</p>
                  {filtered.length > 0 ? filtered.slice(0, 15).map(p => (
                    <button key={p.id} onClick={() => openConfig(p)}
                      className="w-full bg-white p-4 rounded-xl flex items-center justify-between border border-sand-400 hover:border-pastel-green-200 transition-all active:scale-[0.98] shadow-premium"
                    >
                      <div className="text-left">
                        <p className="text-sm font-bold text-neutral-800">{p.name}</p>
                        <p className="text-[10px] text-neutral-400">{p.category} • Melhores Preços</p>
                      </div>
                      <PlusCircle className="text-pastel-green-500" size={20} />
                    </button>
                  )) : (
                    <div className="bg-white p-8 rounded-xl text-center border border-dashed border-sand-400 space-y-3">
                      <p className="text-xs text-neutral-400">Produto não encontrado no catálogo.</p>
                      <button 
                        onClick={() => openConfig({ id: Date.now(), name: searchTerm, category: 'Outros', nagumoPrice: 0, higasPrice: 0, unit: 'un' })}
                        className="text-[10px] font-black bg-neutral-900 text-white px-4 py-2 rounded-lg uppercase tracking-widest"
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
                  <h2 className="text-sm font-black uppercase tracking-widest text-neutral-400">Minha Lista Atual</h2>
                  {currentList.length > 0 && (
                    <button onClick={() => setCurrentList([])} className="text-[10px] text-red-400 font-bold uppercase">Limpar tudo</button>
                  )}
                </div>

                {currentList.length === 0 ? (
                  <div className="py-20 text-center space-y-4">
                    <div className="w-16 h-16 bg-white rounded-2xl mx-auto flex items-center justify-center text-sand-400 border border-sand-400 shadow-premium opacity-50">
                      <List size={32} />
                    </div>
                    <p className="text-xs font-medium text-neutral-400">Comece a buscar para adicionar itens.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {currentList.map(item => (
                      <div key={item.id} className="bg-white rounded-xl border border-sand-400 p-4 shadow-premium group">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <h3 className="text-sm font-bold text-neutral-800 leading-tight">{item.name}</h3>
                            <div className="flex items-center gap-3 mt-1.5">
                              <span className="text-[9px] font-black bg-sand-300 px-1.5 py-0.5 rounded text-neutral-500 uppercase">{item.category}</span>
                              <span className="text-[9px] font-bold text-neutral-400">{item.qty} {item.unit}</span>
                            </div>
                          </div>
                          <button onClick={() => setCurrentList(l => l.filter(x => x.id !== item.id))} className="text-neutral-200 hover:text-red-400 transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="bg-sand-300/40 rounded-lg p-3 mt-4 flex items-center justify-between">
                          <p className="text-[10px] font-black uppercase text-neutral-400 tracking-wider">Mercado {item.selectedMarket}</p>
                          <p className="text-sm font-bold text-pastel-green-600">{fmt.format(item.selectedPrice * item.qty)} <span className="text-[10px] text-neutral-400">({fmt.format(item.selectedPrice)}/un)</span></p>
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
                 <h2 className="text-sm font-black uppercase tracking-widest text-neutral-400">Listas Passadas</h2>
                 {historyList.length > 0 && (
                    <button onClick={() => { if(window.confirm('Excluir todo o histórico?')) setHistoryList([]); }} 
                       className="text-[10px] text-red-500 font-bold uppercase tracking-wider">Limpar Tudo</button>
                 )}
              </div>

              {historyList.length === 0 ? (
                <p className="text-center py-20 text-xs text-neutral-400">Nenhuma lista no histórico.</p>
              ) : historyList.map(h => (
                <div key={h.id} className="bg-white rounded-xl border border-sand-400 p-5 shadow-premium space-y-4">
                   <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-sm font-bold text-neutral-900">{h.name || "Lista s/ nome"}</h3>
                        <p className="text-xs font-bold text-neutral-500 mt-1">{h.date}</p>
                        <p className="text-[10px] text-neutral-400 uppercase tracking-widest mt-0.5">{h.items.length} itens • {fmt.format(h.total)}</p>
                      </div>
                      <div className="flex flex-col gap-2 items-end">
                         <button onClick={(e) => { e.stopPropagation(); setHistoryList(prev => prev.filter(x => x.id !== h.id)); }} 
                            className="text-neutral-300 hover:text-red-500 transition-colors p-1">
                            <Trash2 size={16} />
                         </button>
                         <button onClick={() => {
                           const items = h.items.map(i => ({...i, checked: false}));
                           setHistoryList(prev => prev.map(list => list.id === h.id ? {...list, items} : list));
                           setActiveShoppingId(h.id);
                           setView('shopping');
                         }} className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest mt-2">
                           Re-Comprar
                         </button>
                      </div>
                   </div>
                   <div className="flex gap-1 flex-wrap">
                      {h.items.slice(0, 5).map((it, i) => (
                        <span key={i} className="text-[8px] font-black uppercase bg-sand-300 px-1.5 py-0.5 rounded text-neutral-500">{it.name}</span>
                      ))}
                      {h.items.length > 5 && <span className="text-[8px] font-black uppercase bg-sand-300 px-1.5 py-0.5 rounded text-neutral-500">+{h.items.length - 5}</span>}
                   </div>
                </div>
              ))}
            </div>
          )}

          {view === 'shopping' && (() => {
             const activeShop = historyList.find(h => h.id === activeShoppingId);
             if (!activeShop) return (
                <div className="py-20 text-center space-y-4">
                   <p className="text-xs font-medium text-neutral-400">Selecione uma lista no histórico para iniciar as compras.</p>
                   <button onClick={() => setView('history')} className="text-[10px] font-black bg-neutral-900 text-white px-4 py-2 rounded-lg uppercase tracking-widest">Ver Histórico</button>
                </div>
             );

             const checkedCount = activeShop.items.filter(i => i.checked).length;
             const totalItems = activeShop.items.length;
             const isComplete = checkedCount === totalItems && totalItems > 0;

             return (
               <div className="space-y-6 animate-slide-up">
                  <div className="bg-neutral-900 rounded-2xl p-6 text-white shadow-xl">
                     <p className="text-[9px] font-black uppercase tracking-widest text-neutral-500 mb-1">Modo Supermercado</p>
                     <div className="flex justify-between items-start">
                        <h2 className="text-xl font-black">{activeShop.name || "Lista Aberta"}</h2>
                        <button onClick={() => shareAsText(activeShop)} className="bg-white/10 hover:bg-white/20 p-2 rounded-lg text-white transition-all flex items-center gap-1.5 text-[10px] font-bold">
                           <Copy size={14} /> Texto
                        </button>
                     </div>
                     <div className="mt-4 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-pastel-green-500 transition-all duration-700" 
                            style={{ width: `${(checkedCount / totalItems) * 100 || 0}%` }}></div>
                        </div>
                        <span className="text-[10px] font-black text-pastel-green-500">
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
                                   return {...h, items: newItems};
                                }
                                return h;
                             }));
                          }}
                          className={`p-4 rounded-xl border-2 transition-all flex items-center gap-4 cursor-pointer ${
                            item.checked ? 'bg-pastel-green-50 border-pastel-green-200 opacity-60' : 'bg-white border-sand-400 shadow-premium'
                          }`}
                        >
                           <div className="flex-1">
                              <p className={`text-sm font-bold transition-all ${item.checked ? 'line-through text-neutral-400' : 'text-neutral-800'}`}>{item.name}</p>
                              <p className="text-[9px] text-neutral-400 uppercase tracking-widest mt-0.5">{item.category} • {item.qty} {item.unit} • {item.selectedMarket}</p>
                              <p className="text-[10px] font-black text-pastel-green-600 mt-1">{fmt.format(item.selectedPrice * item.qty)}</p>
                           </div>
                           <button className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest shrink-0 transition-colors ${
                              item.checked ? 'bg-pastel-green-500 text-white shadow-active scale-95' : 'bg-sand-300 text-neutral-500 shadow-sm'
                           }`}>
                              {item.checked ? 'OK ✓' : 'Marcar'}
                           </button>
                        </div>
                     ))}
                  </div>

                  {isComplete && (
                     <div className="text-center py-10 space-y-4">
                        <div className="w-16 h-16 bg-pastel-green-500 rounded-2xl mx-auto flex items-center justify-center text-white shadow-xl scale-125">
                           <CheckCircle2 size={32} />
                        </div>
                        <h3 className="text-xl font-black">Compra Concluída!</h3>
                        <button onClick={() => setView('home')} className="underline text-xs font-bold text-neutral-400">Voltar para o Início</button>
                     </div>
                  )}
               </div>
             );
          })()}

        </div>
      </main>

      {/* Footer Totalizer / Float Action */}
      <footer className="shrink-0 bg-white border-t border-sand-400 px-6 py-6 pb-12 shadow-[0_-10px_30px_rgba(0,0,0,0.03)]">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-[9px] font-black text-neutral-400 uppercase tracking-widest">Total Estimado</p>
            <p className="text-2xl font-black tracking-tight">{fmt.format(displayTotal)}</p>
          </div>
          <button 
            disabled={view !== 'home' || currentList.length === 0}
            onClick={() => setShowFinalizeModal(true)}
            className="bg-neutral-900 text-white px-8 py-3.5 rounded-xl font-bold text-sm shadow-premium active:scale-95 disabled:opacity-20 transition-all flex items-center gap-2"
          >
            Finalizar <ChevronRight size={16} />
          </button>
        </div>
      </footer>

      {/* Selection Modal (Detail View) */}
      {selectedProduct && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center px-4" onClick={() => setSelectedProduct(null)}>
          <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-8 space-y-8 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start">
               <div>
                  <h2 className="text-base font-black text-neutral-900">{selectedProduct.name}</h2>
                  <p className="text-xs text-neutral-400">{selectedProduct.category}</p>
               </div>
               <button onClick={() => setSelectedProduct(null)} className="p-2 bg-sand-300 rounded-lg text-neutral-500"><X size={18} /></button>
            </div>

            <div className="space-y-6">
               <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                     <label className="text-[9px] font-black uppercase text-neutral-400 tracking-widest ml-1">Quantidade</label>
                     <div className="flex items-center bg-sand-300 rounded-xl p-1 gap-2">
                        <button onClick={() => setConfig(c => ({...c, qty: Math.max(1, c.qty - 1)}))} className="w-10 h-10 bg-white rounded-lg font-black shadow-sm">-</button>
                        <span className="flex-1 text-center font-black">{config.qty}</span>
                        <button onClick={() => setConfig(c => ({...c, qty: c.qty + 1}))} className="w-10 h-10 bg-white rounded-lg font-black shadow-sm">+</button>
                     </div>
                  </div>
                  <div className="space-y-1.5">
                     <label className="text-[9px] font-black uppercase text-neutral-400 tracking-widest ml-1">Medida</label>
                     <select className="w-full bg-sand-300 rounded-xl py-3 px-3 text-sm font-bold outline-none appearance-none"
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

               <div className="pt-2">
                  <p className="text-[9px] font-black uppercase text-neutral-400 tracking-widest ml-1 mb-2 text-center">Selecione onde vai comprar:</p>
                  <div className="grid grid-cols-2 gap-3">
                     <button onClick={() => confirmAdd('Nagumo', config.priceN)} className="bg-white border-2 border-sand-400 hover:border-pastel-green-500 rounded-xl p-4 transition-all text-center flex flex-col items-center gap-1">
                        <span className="text-[10px] font-black uppercase text-neutral-900 tracking-wider">Nagumo</span>
                        <span className="text-lg font-black text-pastel-green-600">{fmt.format(config.priceN)}</span>
                     </button>
                     <button onClick={() => confirmAdd('Higas', config.priceH)} className="bg-white border-2 border-sand-400 hover:border-orange-400 rounded-xl p-4 transition-all text-center flex flex-col items-center gap-1">
                         <span className="text-[10px] font-black uppercase text-neutral-900 tracking-wider">Higas</span>
                         <span className="text-lg font-black text-orange-500">{fmt.format(config.priceH)}</span>
                     </button>
                  </div>
               </div>
            </div>

          </div>
        </div>
      )}

      {/* Finalize Naming Modal */}
      {showFinalizeModal && (
         <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm z-[300] flex items-center justify-center px-4 animate-slide-up">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 space-y-6 shadow-2xl">
               <div className="text-center space-y-2">
                  <h2 className="text-xl font-black text-neutral-900">Salvar Lista</h2>
                  <p className="text-xs text-neutral-400">Dê um nome para a sua lista de compras. O PDF será gerado em seguida.</p>
               </div>
               
               <input type="text" placeholder="Ex: Compras do Mês, Churrasco..." 
                  className="w-full bg-sand-300 rounded-xl py-4 px-4 text-sm font-bold outline-none focus:ring-2 ring-pastel-green-500 text-center placeholder:text-neutral-400"
                  value={listName} onChange={e => setListName(e.target.value)} autoFocus />

               <div className="flex gap-3">
                  <button onClick={() => setShowFinalizeModal(false)} className="flex-1 bg-white border-2 border-sand-400 text-neutral-500 py-3.5 rounded-xl font-black text-xs uppercase tracking-widest">
                     Voltar
                  </button>
                  <button onClick={confirmFinalize} className="flex-1 bg-pastel-green-500 text-white py-3.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-premium active:scale-95">
                     Gerar PDF
                  </button>
               </div>
            </div>
         </div>
      )}

    </div>
  );
}

export default App;
