import React, { useState, useEffect, useMemo } from 'react';
import { 
  Lock, 
  Unlock, 
  Plus, 
  Trash2, 
  Edit2, 
  CheckCircle2, 
  AlertCircle, 
  Bell, 
  BellOff,
  X,
  Wallet,
  Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface RepaymentItem {
  id: string;
  name: string;
  totalAmount: number;
  dueDay: number; // 1-31
  paydayPeriod: '5' | '20'; // Split by payday
  paidThisMonth: boolean;
  lastPaidMonth: string; // YYYY-MM
  isInstallment: boolean;
  totalInstallments?: number;
  remainingInstallments?: number;
}

// --- Constants ---
const STORAGE_KEY = 'repayment_data_v2'; // Versioned key for new schema
const AUTH_KEY = 'repayment_auth_registered';

export default function App() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [repayments, setRepayments] = useState<RepaymentItem[]>([]);
  const [isAuthSupported, setIsAuthSupported] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<RepaymentItem | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    totalAmount: '',
    dueDay: '1',
    isInstallment: false,
    totalInstallments: '12',
    paidInstallments: '0'
  });

  // --- Initialization ---
  useEffect(() => {
    if (window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(available => setIsAuthSupported(available))
        .catch(() => setIsAuthSupported(false));
    }

    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData) as RepaymentItem[];
        const currentMonth = new Date().toISOString().slice(0, 7);
        const updated = parsed.map(item => {
          if (item.lastPaidMonth !== currentMonth) {
            return { ...item, paidThisMonth: false };
          }
          return item;
        });
        setRepayments(updated);
      } catch (e) {
        console.error("Failed to parse saved data", e);
      }
    } else {
      // Migration from v1 if exists
      const oldData = localStorage.getItem('repayment_data');
      if (oldData) {
        try {
          const parsed = JSON.parse(oldData);
          const migrated = parsed.map((item: any) => ({
            ...item,
            paydayPeriod: item.dueDay <= 15 ? '5' : '20'
          }));
          setRepayments(migrated);
        } catch (e) {}
      }
    }

    if ('Notification' in window) {
      setNotificationsEnabled(Notification.permission === 'granted');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js');
    }
  }, []);

  useEffect(() => {
    if (isUnlocked) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(repayments));
    }
  }, [repayments, isUnlocked]);

  // --- Auth Logic ---
  const handleUnlock = async () => {
    setAuthError(null);
    if (!isAuthSupported || window.self !== window.top) {
      setIsUnlocked(true);
      return;
    }

    try {
      const isRegistered = localStorage.getItem(AUTH_KEY);
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      if (!isRegistered) {
        const createOptions: PublicKeyCredentialCreationOptions = {
          challenge,
          rp: { name: "記帳管家", id: window.location.hostname },
          user: {
            id: Uint8Array.from("user123", c => c.charCodeAt(0)),
            name: "user@example.com",
            displayName: "User"
          },
          pubKeyCredParams: [{ alg: -7, type: "public-key" }],
          authenticatorSelection: { userVerification: "preferred" },
          timeout: 60000
        };
        await navigator.credentials.create({ publicKey: createOptions });
        localStorage.setItem(AUTH_KEY, 'true');
        setIsUnlocked(true);
      } else {
        const getOptions: PublicKeyCredentialRequestOptions = {
          challenge,
          rpId: window.location.hostname,
          userVerification: "required",
          timeout: 60000
        };
        await navigator.credentials.get({ publicKey: getOptions });
        setIsUnlocked(true);
      }
    } catch (err) {
      console.error("Auth failed:", err);
      setAuthError("生物辨識失敗。請再次點擊以進入。");
      setTimeout(() => setIsUnlocked(true), 1000);
    }
  };

  // --- Notification Logic ---
  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    setNotificationsEnabled(permission === 'granted');
    if (permission === 'granted') checkAndNotify();
  };

  const checkAndNotify = () => {
    if (Notification.permission !== 'granted') return;
    const today = new Date();
    const currentDay = today.getDate();
    repayments.forEach(item => {
      if (item.paidThisMonth) return;
      if (item.dueDay === currentDay) {
        new Notification("記帳提醒", {
          body: `今天是 ${item.name} 的記帳日，金額：$${item.totalAmount}`,
          icon: "https://picsum.photos/seed/money/192/192"
        });
      } else if (item.dueDay === currentDay + 1) {
        new Notification("記帳提醒", {
          body: `明天是 ${item.name} 的記帳日，金額：$${item.totalAmount}`,
          icon: "https://picsum.photos/seed/money/192/192"
        });
      }
    });
  };

  // --- CRUD Logic ---
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Auto-determine payday period based on due day
    // 5th to 19th -> 5th Salary
    // 20th to 4th -> 20th Salary
    const day = parseInt(formData.dueDay);
    const autoPaydayPeriod = (day >= 5 && day <= 19) ? '5' : '20';

    const totalInst = parseInt(formData.totalInstallments);
    const paidInst = parseInt(formData.paidInstallments);
    const remainingInst = Math.max(0, totalInst - paidInst);

    const newItem: RepaymentItem = {
      id: editingItem?.id || (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11)),
      name: formData.name,
      totalAmount: parseFloat(formData.totalAmount),
      dueDay: day,
      paydayPeriod: autoPaydayPeriod,
      paidThisMonth: editingItem?.paidThisMonth || false,
      lastPaidMonth: editingItem?.lastPaidMonth || '',
      isInstallment: formData.isInstallment,
      totalInstallments: formData.isInstallment ? totalInst : undefined,
      remainingInstallments: formData.isInstallment ? remainingInst : undefined
    };
    if (editingItem) {
      setRepayments(prev => prev.map(item => item.id === editingItem.id ? newItem : item));
    } else {
      setRepayments(prev => [...prev, newItem]);
    }
    setShowAddModal(false);
    setEditingItem(null);
    setFormData({ 
      name: '', 
      totalAmount: '', 
      dueDay: '1', 
      isInstallment: false,
      totalInstallments: '12',
      paidInstallments: '0'
    });
  };

  const togglePaid = (id: string) => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    setRepayments(prev => prev.map(item => {
      if (item.id === id) {
        const isPaid = !item.paidThisMonth;
        let newRemaining = item.remainingInstallments;
        
        // If marking as paid and it's an installment, decrement remaining
        if (isPaid && item.isInstallment && typeof item.remainingInstallments === 'number') {
          newRemaining = Math.max(0, item.remainingInstallments - 1);
        } 
        // If unmarking as paid, increment back (optional logic, but safer for user error)
        else if (!isPaid && item.isInstallment && typeof item.remainingInstallments === 'number') {
          newRemaining = Math.min(item.totalInstallments || 999, item.remainingInstallments + 1);
        }

        return { 
          ...item, 
          paidThisMonth: isPaid, 
          lastPaidMonth: isPaid ? currentMonth : '',
          remainingInstallments: newRemaining
        };
      }
      return item;
    }));
  };

  const deleteItem = (id: string) => {
    setRepayments(prev => prev.filter(item => item.id !== id));
  };

  const editItem = (item: RepaymentItem) => {
    setEditingItem(item);
    const paid = item.isInstallment ? (item.totalInstallments || 0) - (item.remainingInstallments || 0) : 0;
    setFormData({ 
      name: item.name, 
      totalAmount: item.totalAmount.toString(), 
      dueDay: item.dueDay.toString(),
      isInstallment: item.isInstallment || false,
      totalInstallments: (item.totalInstallments || 12).toString(),
      paidInstallments: paid.toString()
    });
    setShowAddModal(true);
  };

  // --- Calculations ---
  const totalDue5th = useMemo(() => {
    return repayments.filter(item => item.paydayPeriod === '5' && !item.paidThisMonth).reduce((sum, item) => sum + item.totalAmount, 0);
  }, [repayments]);

  const totalDue20th = useMemo(() => {
    return repayments.filter(item => item.paydayPeriod === '20' && !item.paidThisMonth).reduce((sum, item) => sum + item.totalAmount, 0);
  }, [repayments]);

  const totalMonthly = useMemo(() => {
    return repayments.filter(item => !item.paidThisMonth).reduce((sum, item) => sum + item.totalAmount, 0);
  }, [repayments]);

  const currentPeriod = useMemo(() => {
    const day = new Date().getDate();
    // 5th to 19th -> 5th Salary
    // 20th to 4th -> 20th Salary
    return (day >= 5 && day <= 19) ? '5' : '20';
  }, []);

  const getDaysRemaining = (dueDay: number) => {
    const today = new Date();
    const currentDay = today.getDate();
    if (dueDay >= currentDay) return dueDay - currentDay;
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return (lastDayOfMonth - currentDay) + dueDay;
  };

  // --- Render ---
  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-app-bg text-app-text flex flex-col items-center justify-center p-6 font-sans">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center space-y-8">
          <div className="w-24 h-24 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto border border-emerald-500/20">
            <Lock className="w-10 h-10 text-emerald-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">記帳管家</h1>
            <p className="text-app-muted">您的隱私記帳管理助手</p>
          </div>
          <div className="space-y-4">
            <button onClick={handleUnlock} className="w-full max-w-xs h-14 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-semibold text-lg shadow-lg shadow-emerald-900/20 transition-all active:scale-95 flex items-center justify-center gap-2">
              <Unlock className="w-5 h-5" />
              解鎖並進入
            </button>
            {authError && <p className="text-xs text-red-500 font-medium">{authError}</p>}
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg text-app-text font-sans pb-24 transition-colors duration-300">
      <header className="p-6 pt-12 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">記帳概覽</h2>
          <button onClick={requestNotificationPermission} className={`p-3 rounded-xl border transition-colors ${notificationsEnabled ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-app-card border-app-border text-app-muted'}`}>
            {notificationsEnabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
          </button>
        </div>

        {/* Summary Cards */}
        <div className="space-y-4">
          <div className="bg-app-card border border-app-border p-5 rounded-3xl shadow-sm">
            <p className="text-app-muted text-[10px] font-bold uppercase tracking-widest mb-1">本月待繳總額</p>
            <p className="text-4xl font-bold text-app-text tracking-tight">${totalMonthly.toLocaleString()}</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className={`p-4 rounded-3xl transition-all border ${currentPeriod === '5' ? 'bg-emerald-600 border-emerald-500 shadow-lg shadow-emerald-900/20' : 'bg-app-card border-app-border opacity-80'}`}>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-[10px] font-bold uppercase tracking-wider ${currentPeriod === '5' ? 'text-emerald-100' : 'text-app-muted'}`}>5號發薪期</p>
                {currentPeriod === '5' && <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />}
              </div>
              <p className={`text-2xl font-bold ${currentPeriod === '5' ? 'text-white' : 'text-app-text'}`}>${totalDue5th.toLocaleString()}</p>
            </div>
            <div className={`p-4 rounded-3xl transition-all border ${currentPeriod === '20' ? 'bg-blue-600 border-blue-500 shadow-lg shadow-blue-900/20' : 'bg-app-card border-app-border opacity-80'}`}>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-[10px] font-bold uppercase tracking-wider ${currentPeriod === '20' ? 'text-blue-100' : 'text-app-muted'}`}>20號發薪期</p>
                {currentPeriod === '20' && <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />}
              </div>
              <p className={`text-2xl font-bold ${currentPeriod === '20' ? 'text-white' : 'text-app-text'}`}>${totalDue20th.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="px-6 space-y-8">
        {/* Period Sections */}
        {['5', '20'].map(period => (
          <section key={period} className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-1 h-4 rounded-full ${period === '5' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
              <h3 className="text-app-muted text-xs font-bold uppercase tracking-widest">{period}號發薪期項目</h3>
            </div>

            <div className="space-y-3">
              {repayments
                .filter(item => item.paydayPeriod === period && (!item.isInstallment || (item.remainingInstallments ?? 0) > 0))
                .length === 0 ? (
                <div className="py-8 text-center border border-dashed border-app-border rounded-2xl">
                  <p className="text-app-muted text-xs italic">尚無此期間項目</p>
                </div>
              ) : (
                repayments
                  .filter(item => item.paydayPeriod === period && (!item.isInstallment || (item.remainingInstallments ?? 0) > 0))
                  .sort((a, b) => a.dueDay - b.dueDay)
                  .map(item => {
                    const daysLeft = getDaysRemaining(item.dueDay);
                    return (
                      <motion.div layout key={item.id} className={`p-4 rounded-2xl border transition-all ${item.paidThisMonth ? 'bg-app-card/50 border-app-border/50 opacity-60' : 'bg-app-card border-app-border shadow-sm'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <button onClick={() => togglePaid(item.id)} className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all active:scale-90 ${item.paidThisMonth ? 'bg-emerald-500 text-white' : 'bg-app-bg border border-app-border text-app-muted'}`}>
                              <CheckCircle2 className="w-6 h-6" />
                            </button>
                            <div>
                              <h4 className={`font-bold ${item.paidThisMonth ? 'text-app-muted line-through' : 'text-app-text'}`}>{item.name}</h4>
                              <div className="flex items-center gap-2">
                                <p className={`text-lg font-mono font-bold ${period === '5' ? 'text-emerald-500' : 'text-blue-500'}`}>${item.totalAmount.toLocaleString()}</p>
                                {item.isInstallment && (
                                  <span className="text-[10px] bg-app-bg px-1.5 py-0.5 rounded border border-app-border text-app-muted font-bold">
                                    剩餘 {item.remainingInstallments}/{item.totalInstallments} 期
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            {!item.paidThisMonth && (
                              <div className={`text-[10px] font-black px-2 py-0.5 rounded-full mb-1 inline-block ${daysLeft <= 3 ? 'bg-red-500 text-white' : 'bg-app-bg text-app-muted border border-app-border'}`}>
                                剩餘 {daysLeft} 天
                              </div>
                            )}
                            <p className="text-[10px] text-app-muted font-bold">每月 {item.dueDay} 日</p>
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-app-border/30 flex items-center justify-end gap-6">
                          <button onClick={() => editItem(item)} className="text-app-muted hover:text-app-text transition-colors"><Edit2 className="w-4 h-4" /></button>
                          <button onClick={() => deleteItem(item)} className="text-app-muted hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </motion.div>
                    );
                  })
              )}
            </div>
          </section>
        ))}
      </main>

      <button onClick={() => setShowAddModal(true)} className="fixed bottom-8 right-8 w-16 h-16 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full shadow-2xl shadow-emerald-900/40 flex items-center justify-center transition-transform active:scale-90 z-40">
        <Plus className="w-8 h-8" />
      </button>

      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="fixed inset-0 bg-black/60 backdrop-blur-md z-50" />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }} className="fixed bottom-0 inset-x-0 bg-app-bg rounded-t-[40px] p-8 z-50 border-t border-app-border shadow-2xl">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold">{editingItem ? '編輯項目' : '新增項目'}</h3>
                <button onClick={() => setShowAddModal(false)} className="p-2 bg-app-card rounded-full"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSave} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs text-app-muted font-bold uppercase tracking-wider">項目名稱</label>
                  <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="例如：房租、信用卡" className="w-full h-14 bg-app-card border-none rounded-2xl px-4 focus:ring-2 focus:ring-emerald-500 text-lg text-app-text" />
                </div>

                <div className="space-y-4 p-4 bg-app-card rounded-2xl border border-app-border">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-bold">分期付款</p>
                      <p className="text-[10px] text-app-muted">開啟後可設定總期數</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, isInstallment: !formData.isInstallment })}
                      className={`w-12 h-6 rounded-full transition-colors relative ${formData.isInstallment ? 'bg-emerald-500' : 'bg-app-bg border border-app-border'}`}
                    >
                      <motion.div
                        animate={{ x: formData.isInstallment ? 24 : 2 }}
                        className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-sm"
                      />
                    </button>
                  </div>
                  
                  <AnimatePresence>
                    {formData.isInstallment && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="pt-2 grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-[10px] text-app-muted font-bold uppercase">總期數</label>
                            <input
                              type="number"
                              value={formData.totalInstallments}
                              onChange={e => setFormData({ ...formData, totalInstallments: e.target.value })}
                              className="w-full h-12 bg-app-bg border border-app-border rounded-xl px-4 focus:ring-2 focus:ring-emerald-500 text-app-text"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] text-app-muted font-bold uppercase">已繳期數</label>
                            <input
                              type="number"
                              value={formData.paidInstallments}
                              onChange={e => setFormData({ ...formData, paidInstallments: e.target.value })}
                              className="w-full h-12 bg-app-bg border border-app-border rounded-xl px-4 focus:ring-2 focus:ring-emerald-500 text-app-text"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-app-muted font-bold uppercase tracking-wider">金額</label>
                    <input required type="number" value={formData.totalAmount} onChange={e => setFormData({ ...formData, totalAmount: e.target.value })} placeholder="0" className="w-full h-14 bg-app-card border-none rounded-2xl px-4 focus:ring-2 focus:ring-emerald-500 text-lg font-mono text-app-text" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-app-muted font-bold uppercase tracking-wider">每月日期</label>
                    <select value={formData.dueDay} onChange={e => setFormData({ ...formData, dueDay: e.target.value })} className="w-full h-14 bg-app-card border-none rounded-2xl px-4 focus:ring-2 focus:ring-emerald-500 text-lg text-app-text">
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (<option key={day} value={day}>{day} 日</option>))}
                    </select>
                  </div>
                </div>
                <button type="submit" className="w-full h-16 bg-emerald-600 text-white rounded-2xl font-bold text-xl mt-4 shadow-xl shadow-emerald-900/20 active:scale-95 transition-transform">儲存項目</button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
