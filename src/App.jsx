import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  LayoutDashboard,
  Swords,
  Upload,
  Trophy,
  ShieldCheck,
  Bell,
  LogOut,
  RefreshCw,
  WifiOff,
  UserCheck
} from 'lucide-react';
import { api } from './lib/supabase.js';
import { formatRelativeTime } from './lib/format.js';
import { ToastProvider, useToast, Skeleton } from './components/ui.jsx';
import { AuthScreen, PinSetupModal } from './components/AuthScreen.jsx';
import VaultBanner from './components/VaultBanner.jsx';
import DashboardTab from './components/DashboardTab.jsx';
import SplitAndEscrowTab from './components/SplitAndEscrowTab.jsx';
import DepositAndCashoutTab from './components/DepositAndCashoutTab.jsx';
import LeaderboardTab from './components/LeaderboardTab.jsx';
import AdminPanelTab from './components/AdminPanelTab.jsx';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-rose-500/40 rounded-2xl p-6 space-y-4 text-center">
            <h2 className="text-lg font-bold text-rose-300">Something went wrong</h2>
            <p className="text-xs text-slate-400 font-mono break-all">
              {this.state.error?.message || 'Unexpected UI error'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-xl"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function VagacoinShell() {
  const { addToast } = useToast();
  const [session, setSession] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  // Central Data Store
  const [currentUser, setCurrentUser] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [balances, setBalances] = useState([]);
  const [summary, setSummary] = useState(null);
  const [depositStatuses, setDepositStatuses] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [depositClaims, setDepositClaims] = useState([]);
  const [burnRequests, setBurnRequests] = useState([]);
  const [splits, setSplits] = useState([]);
  const [escrowMatches, setEscrowMatches] = useState([]);
  const [paymentRequests, setPaymentRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [settings, setSettings] = useState(null);
  const [reconciliations, setReconciliations] = useState([]);
  const [auditLog, setAuditLog] = useState([]);

  const debounceTimerRef = useRef(null);

  const fetchAllData = useCallback(async () => {
    try {
      const [
        prof,
        allProfiles,
        bals,
        sum,
        depStat,
        led,
        claims,
        burns,
        sp,
        esc,
        reqs,
        notifs,
        cfg,
        recs,
        audit,
        pinInfo
      ] = await Promise.all([
        api.getProfile(),
        api.listProfiles(),
        api.getWalletBalances(),
        api.getVagafundSummary(),
        api.getMonthlyDepositStatus(),
        api.listLedger({ limit: 150 }),
        api.listDepositClaims(),
        api.listBurnRequests(),
        api.listSplits(),
        api.listEscrowMatches(),
        api.listPaymentRequests(),
        api.listNotifications(),
        api.getGroupSettings(),
        api.listReconciliations(),
        api.listAuditLog(),
        api.hasPinSet()
      ]);

      setCurrentUser(prof);
      setProfiles(allProfiles);
      setBalances(bals);
      setSummary(sum);
      setDepositStatuses(depStat);
      setLedger(led);
      setDepositClaims(claims);
      setBurnRequests(burns);
      setSplits(sp);
      setEscrowMatches(esc);
      setPaymentRequests(reqs);
      setNotifications(notifs);
      setSettings(cfg);
      setReconciliations(recs);
      setAuditLog(audit);
      setNeedsPinSetup(Boolean(prof && pinInfo && !pinInfo.has_pin));
    } catch (err) {
      console.error('Data refresh error:', err);
    }
  }, []);

  const debouncedRefresh = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      fetchAllData();
    }, 120);
  }, [fetchAllData]);

  useEffect(() => {
    let mounted = true;
    api.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data?.session || null);
      if (data?.session) {
        fetchAllData().finally(() => {
          if (mounted) setBootstrapping(false);
        });
      } else {
        setBootstrapping(false);
      }
    });

    const unsubAuth = api.onAuthChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        fetchAllData();
      } else {
        setCurrentUser(null);
      }
    });

    const unsubRealtime = api.subscribe(() => {
      debouncedRefresh();
    });

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      mounted = false;
      unsubAuth?.();
      unsubRealtime?.();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchAllData, debouncedRefresh]);

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!session || !currentUser) {
    return <AuthScreen onAuthenticated={fetchAllData} />;
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const adminPendingCount =
    depositClaims.filter((c) => c.status === 'PENDING').length +
    burnRequests.filter((b) => b.status === 'PENDING').length +
    escrowMatches.filter((m) => m.status === 'DISPUTED').length;

  const tabs = [
    { id: 'dashboard', label: 'Wallet', icon: LayoutDashboard },
    { id: 'splits', label: 'Split & Escrow', icon: Swords },
    { id: 'deposits', label: 'Deposit & Burn', icon: Upload },
    { id: 'leaderboard', label: 'Standings', icon: Trophy }
  ];

  if (currentUser.role === 'admin') {
    tabs.push({
      id: 'admin',
      label: 'Admin',
      icon: ShieldCheck,
      badge: adminPendingCount
    });
  }

  const handleOpenNotifications = async () => {
    setNotifOpen((o) => !o);
    if (!notifOpen && unreadCount > 0) {
      await api.markNotificationsRead();
      fetchAllData();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24 sm:pb-12">
      {/* DEMO MODE BANNER & TOOLBAR */}
      {api.mode === 'demo' && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-200">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>DEMO MODE — data stored in this browser only (PIN: 1234)</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5 text-amber-300" />
                <span className="text-[11px] text-amber-300">Switch User:</span>
                <select
                  value={currentUser.id}
                  onChange={async (e) => {
                    const res = await api.switchUser(e.target.value);
                    if (res.ok) {
                      addToast(`Switched active user to ${res.user.full_name}`, 'info');
                      fetchAllData();
                    }
                  }}
                  className="bg-slate-900 border border-amber-500/40 rounded-lg px-2 py-1 text-xs text-white outline-none"
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} ({p.role}{!p.is_active ? ' - exited' : ''})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={async () => {
                  const res = await api.resetDemo();
                  if (res.ok) {
                    setActiveTab('dashboard');
                    addToast(res.message, 'info');
                    fetchAllData();
                  }
                }}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-amber-500/40 rounded-lg text-xs text-amber-200 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Reset Demo Data</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OFFLINE BANNER */}
      {isOffline && (
        <div className="bg-rose-950 border-b border-rose-500/40 px-4 py-1.5 text-xs text-rose-200 text-center flex items-center justify-center gap-2">
          <WifiOff className="w-3.5 h-3.5" />
          <span>You are currently offline. Viewing cached state.</span>
        </div>
      )}

      {/* VAULT BANNER */}
      <VaultBanner summary={summary} peg={settings?.peg || 1} />

      {/* TOP HEADER BAR */}
      <header className="max-w-5xl mx-auto px-4 pt-4 pb-2 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <span>{settings?.group_name || 'Vagafund Committee'}</span>
          </h1>
          <div className="text-xs text-slate-400">
            Signed in as <strong className="text-slate-200">{currentUser.full_name}</strong> ({currentUser.role})
          </div>
        </div>

        {/* DESKTOP TABS */}
        <nav className="hidden md:flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-xl">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  active
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
                {t.badge > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-slate-950 font-bold">
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* NOTIFICATIONS & SIGN OUT */}
        <div className="flex items-center gap-2 relative">
          <button
            type="button"
            onClick={handleOpenNotifications}
            className="relative p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-bold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-11 w-80 max-h-96 overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-3 z-50 space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-white">In-App Notifications</span>
                <button
                  type="button"
                  onClick={() => setNotifOpen(false)}
                  className="text-[11px] text-slate-400 hover:text-white"
                >
                  Close
                </button>
              </div>
              {notifications.length === 0 ? (
                <div className="text-xs text-slate-500 text-center py-6">No notifications yet</div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs space-y-0.5"
                  >
                    <div className="font-semibold text-emerald-300">{n.title}</div>
                    <div className="text-slate-300">{n.body}</div>
                    <div className="text-[10px] text-slate-500">{formatRelativeTime(n.created_at)}</div>
                  </div>
                ))
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => api.signOut()}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-300"
            title="Sign Out"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* MAIN TAB VIEWPORT */}
      <main className="max-w-5xl mx-auto px-4 pt-3">
        {activeTab === 'dashboard' && (
          <DashboardTab
            currentUser={currentUser}
            profiles={profiles}
            balances={balances}
            ledger={ledger}
            paymentRequests={paymentRequests}
            settings={settings}
            onRefresh={fetchAllData}
          />
        )}

        {activeTab === 'splits' && (
          <SplitAndEscrowTab
            currentUser={currentUser}
            profiles={profiles}
            balances={balances}
            splits={splits}
            escrowMatches={escrowMatches}
            settings={settings}
            onRefresh={fetchAllData}
          />
        )}

        {activeTab === 'deposits' && (
          <DepositAndCashoutTab
            currentUser={currentUser}
            profiles={profiles}
            balances={balances}
            ledger={ledger}
            depositClaims={depositClaims}
            burnRequests={burnRequests}
            settings={settings}
            onRefresh={fetchAllData}
          />
        )}

        {activeTab === 'leaderboard' && (
          <LeaderboardTab
            currentUser={currentUser}
            profiles={profiles}
            balances={balances}
            depositStatuses={depositStatuses}
            summary={summary}
            ledger={ledger}
            settings={settings}
          />
        )}

        {activeTab === 'admin' && (
          <AdminPanelTab
            currentUser={currentUser}
            profiles={profiles}
            balances={balances}
            ledger={ledger}
            depositClaims={depositClaims}
            burnRequests={burnRequests}
            escrowMatches={escrowMatches}
            reconciliations={reconciliations}
            auditLog={auditLog}
            summary={summary}
            settings={settings}
            onRefresh={fetchAllData}
          />
        )}
      </main>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 px-2 py-1.5">
        <div className="flex items-center justify-around max-w-md mx-auto">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`relative flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-xl text-[11px] font-medium ${
                  active ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{t.label}</span>
                {t.badge > 0 && (
                  <span className="absolute top-0.5 right-1.5 w-4 h-4 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold flex items-center justify-center">
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* FORCED FIRST-TIME PIN SETUP MODAL */}
      <PinSetupModal isOpen={needsPinSetup} onComplete={fetchAllData} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <VagacoinShell />
      </ToastProvider>
    </ErrorBoundary>
  );
}
