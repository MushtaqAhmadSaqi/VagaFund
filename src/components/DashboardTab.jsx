import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Send,
  HandCoins,
  QrCode,
  Camera,
  ArrowUpRight,
  ArrowDownLeft,
  Flame,
  Sparkles,
  RotateCcw,
  Lock,
  Clock,
  Wallet,
  History,
  Check,
  X,
  Search,
  Eye,
  EyeOff,
  Copy,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Shield,
  Layers,
  Sparkle
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import confetti from 'canvas-confetti';
import { api } from '../lib/supabase.js';
import {
  formatVGC,
  formatPKR,
  sanitizeIntegerInput,
  parsePositiveInt,
  formatRelativeTime,
  formatMonthLabel,
  computeMonthlyRolloverForUser,
  PEG_PKR_PER_VGC
} from '../lib/format.js';
import {
  Modal,
  Badge,
  PinInput,
  EmptyState,
  Spinner,
  useToast,
  Avatar,
  AmountPresets,
  StatCard
} from './ui.jsx';

const QUICK_NOTES = ['Chai & snacks ☕', 'Lunch share 🍕', 'Split share', 'Match stake ⚔️', 'Reimbursement'];

export default function DashboardTab({
  currentUser,
  profiles,
  balances,
  ledger,
  paymentRequests,
  settings,
  onRefresh
}) {
  const { addToast } = useToast();
  const peg = Number(settings?.peg || PEG_PKR_PER_VGC);
  const reversalWindowHours = Number(settings?.reversal_window_hours || 48);

  // Privacy: Toggle balance visibility
  const [hideBalance, setHideBalance] = useState(false);

  // Expandable rollover table toggle
  const [showFullRolloverTable, setShowFullRolloverTable] = useState(false);

  // Feed search and filter
  const [feedSearch, setFeedSearch] = useState('');
  const [feedFilter, setFeedFilter] = useState('ALL'); // 'ALL' | 'TRADES' | 'INCOMING' | 'OUTGOING' | 'MINT' | 'BURN'
  const [feedLimit, setFeedLimit] = useState(15);

  const myBalance = useMemo(
    () =>
      balances.find((b) => b.user_id === currentUser?.id) || {
        ledger_balance: 0,
        locked_in_escrow: 0,
        reserved_for_burn: 0,
        available_vgc_balance: 0
      },
    [balances, currentUser]
  );

  const profilesById = useMemo(() => {
    const map = {};
    profiles.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [profiles]);

  const activeFriends = useMemo(
    () => profiles.filter((p) => p.is_active && p.id !== currentUser?.id),
    [profiles, currentUser]
  );

  const rolloverRows = useMemo(
    () => computeMonthlyRolloverForUser(currentUser?.id, ledger),
    [currentUser, ledger]
  );

  // Selected month for financial overview (defaults to latest month)
  const [selectedMonthTag, setSelectedMonthTag] = useState(rolloverRows[0]?.monthTag || '');
  useEffect(() => {
    if (rolloverRows.length > 0 && !selectedMonthTag) {
      setSelectedMonthTag(rolloverRows[0].monthTag);
    }
  }, [rolloverRows, selectedMonthTag]);

  const currentMonthStats = useMemo(() => {
    return (
      rolloverRows.find((r) => r.monthTag === selectedMonthTag) ||
      rolloverRows[0] || {
        monthTag: '',
        opening: 0,
        minted: 0,
        received: 0,
        sent: 0,
        burned: 0,
        closing: 0
      }
    );
  }, [rolloverRows, selectedMonthTag]);

  // Send VGC modal state
  const [sendOpen, setSendOpen] = useState(false);
  const [receiverId, setReceiverId] = useState('');
  const [friendSearch, setFriendSearch] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendNote, setSendNote] = useState('');
  const [sendPin, setSendPin] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [sending, setSending] = useState(false);

  // Request VGC modal state
  const [reqOpen, setReqOpen] = useState(false);
  const [reqPayerId, setReqPayerId] = useState('');
  const [reqAmount, setReqAmount] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [requesting, setRequesting] = useState(false);

  // Respond to incoming payment request modal state
  const [respondTarget, setRespondTarget] = useState(null);
  const [respondPin, setRespondPin] = useState('');
  const [responding, setResponding] = useState(false);

  // Reversal modal state
  const [reversalTargetTx, setReversalTargetTx] = useState(null);
  const [reversalNote, setReversalNote] = useState('Wrong amount/recipient – please return');
  const [reversing, setReversing] = useState(false);

  // QR Modals
  const [myQrOpen, setMyQrOpen] = useState(false);
  const [scanQrOpen, setScanQrOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const scannerRef = useRef(null);

  const openSendModal = (preselectedUid = '') => {
    setReceiverId(preselectedUid || (activeFriends[0]?.id ?? ''));
    setFriendSearch('');
    setSendAmount('');
    setSendNote('');
    setSendPin('');
    const key =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `idem-${Date.now()}-${Math.random()}`;
    setIdempotencyKey(key);
    setSendOpen(true);
  };

  // Stop & release QR camera stream cleanly on close or unmount
  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch (e) {
        console.warn('QR cleanup notice:', e);
      }
      scannerRef.current = null;
    }
  };

  useEffect(() => {
    if (!scanQrOpen) {
      stopScanner();
      return undefined;
    }

    setCameraError('');
    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost') {
      setCameraError('Camera access requires HTTPS or localhost. Please select your friend from the list below.');
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const html5Qr = new Html5Qrcode('vagacoin-qr-reader');
        scannerRef.current = html5Qr;
        await html5Qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          async (decodedText) => {
            if (cancelled) return;
            try {
              const payload = JSON.parse(decodedText);
              if (payload?.app !== 'vagacoin' || payload?.v !== 1 || !payload?.uid) {
                addToast('Invalid QR code: not a Vagacoin member QR.', 'error');
                return;
              }
              if (payload.uid === currentUser?.id) {
                addToast('That is your own QR code!', 'error');
                return;
              }
              const targetFriend = activeFriends.find((f) => f.id === payload.uid);
              if (!targetFriend) {
                addToast('Scanned member is not an active member of this group.', 'error');
                return;
              }
              await stopScanner();
              setScanQrOpen(false);
              addToast(`Scanned ${targetFriend.full_name}`, 'success');
              openSendModal(targetFriend.id);
            } catch {
              addToast('Unrecognized QR code format.', 'error');
            }
          },
          () => {}
        );
      } catch (err) {
        if (!cancelled) {
          setCameraError(
            err?.message || 'Camera unavailable or permission denied. Choose a friend manually instead.'
          );
        }
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopScanner();
    };
  }, [scanQrOpen]);

  const handleSendSubmit = async (e) => {
    e.preventDefault();
    const amt = parsePositiveInt(sendAmount);
    if (!receiverId || receiverId === currentUser?.id) {
      addToast('Please select a friend to send VGC to.', 'error');
      return;
    }
    if (!amt) {
      addToast('Enter a positive integer VGC amount.', 'error');
      return;
    }
    if (amt > myBalance.available_vgc_balance) {
      addToast(`Amount exceeds your available balance (${formatVGC(myBalance.available_vgc_balance)}).`, 'error');
      return;
    }
    if (sendPin.length !== 4) {
      addToast('Enter your 4-digit security PIN.', 'error');
      return;
    }

    setSending(true);
    try {
      const res = await api.tradeVagacoin(receiverId, amt, sendNote, sendPin, idempotencyKey);
      if (!res.ok) {
        addToast(res.message || 'Transfer failed', 'error');
        setSendPin('');
      } else {
        try {
          confetti({ particleCount: 75, spread: 70, origin: { y: 0.6 } });
        } catch {
          // ignore in headless
        }
        addToast(res.message || 'VGC sent successfully!', 'success');
        setSendOpen(false);
        onRefresh?.();
      }
    } finally {
      setSending(false);
    }
  };

  const handleCreateRequest = async (e) => {
    e.preventDefault();
    const amt = parsePositiveInt(reqAmount);
    if (!reqPayerId || reqPayerId === currentUser?.id) {
      addToast('Choose a friend to request VGC from.', 'error');
      return;
    }
    if (!amt) {
      addToast('Enter a valid positive integer amount.', 'error');
      return;
    }
    setRequesting(true);
    try {
      const res = await api.createPaymentRequest(reqPayerId, amt, reqNote);
      if (!res.ok) {
        addToast(res.message || 'Failed to create request', 'error');
      } else {
        addToast(res.message || 'Payment request sent!', 'success');
        setReqOpen(false);
        onRefresh?.();
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleAcceptRequest = async (e) => {
    e.preventDefault();
    if (!respondTarget) return;
    if (respondPin.length !== 4) {
      addToast('Enter your 4-digit PIN to authorize payment.', 'error');
      return;
    }
    setResponding(true);
    try {
      const res = await api.respondPaymentRequest(respondTarget.id, true, respondPin);
      if (!res.ok) {
        addToast(res.message || 'Payment failed', 'error');
        setRespondPin('');
      } else {
        addToast(res.message || 'Request paid successfully!', 'success');
        setRespondTarget(null);
        setRespondPin('');
        onRefresh?.();
      }
    } finally {
      setResponding(false);
    }
  };

  const handleDeclineRequest = async (reqId) => {
    setResponding(true);
    try {
      const res = await api.respondPaymentRequest(reqId, false, null);
      if (!res.ok) addToast(res.message || 'Failed to decline', 'error');
      else {
        addToast('Request declined.', 'info');
        onRefresh?.();
      }
    } finally {
      setResponding(false);
    }
  };

  const handleCancelRequest = async (reqId) => {
    const res = await api.cancelPaymentRequest(reqId);
    if (!res.ok) addToast(res.message || 'Could not cancel request', 'error');
    else {
      addToast('Request cancelled.', 'info');
      onRefresh?.();
    }
  };

  const handleSubmitReversal = async (e) => {
    e.preventDefault();
    if (!reversalTargetTx) return;
    setReversing(true);
    try {
      const res = await api.requestReversal(reversalTargetTx.id, reversalNote);
      if (!res.ok) {
        addToast(res.message || 'Could not request reversal', 'error');
      } else {
        addToast(res.message || 'Compensating reversal requested!', 'success');
        setReversalTargetTx(null);
        onRefresh?.();
      }
    } finally {
      setReversing(false);
    }
  };

  const incomingPendingRequests = useMemo(
    () =>
      (paymentRequests || []).filter(
        (r) => r.payer_id === currentUser?.id && r.status === 'PENDING'
      ),
    [paymentRequests, currentUser]
  );

  const outgoingPendingRequests = useMemo(
    () =>
      (paymentRequests || []).filter(
        (r) => r.requester_id === currentUser?.id && r.status === 'PENDING'
      ),
    [paymentRequests, currentUser]
  );

  const filteredFriends = useMemo(() => {
    const q = friendSearch.trim().toLowerCase();
    if (!q) return activeFriends;
    return activeFriends.filter((f) => f.full_name.toLowerCase().includes(q));
  }, [activeFriends, friendSearch]);

  // Feed search and filter logic
  const filteredFeed = useMemo(() => {
    return (ledger || []).filter((tx) => {
      const isMint = tx.tx_kind === 'MINT';
      const isBurn = tx.tx_kind === 'BURN';
      const isTrade = tx.tx_kind === 'TRADE';
      const isSenderMe = tx.sender_id === currentUser?.id;
      const isReceiverMe = tx.receiver_id === currentUser?.id;

      if (feedFilter === 'TRADES' && !isTrade) return false;
      if (feedFilter === 'INCOMING' && !isReceiverMe && !isMint) return false;
      if (feedFilter === 'OUTGOING' && !isSenderMe && !isBurn) return false;
      if (feedFilter === 'MINT' && !isMint) return false;
      if (feedFilter === 'BURN' && !isBurn) return false;

      if (feedSearch.trim()) {
        const query = feedSearch.trim().toLowerCase();
        const senderName = profilesById[tx.sender_id]?.full_name?.toLowerCase() || '';
        const receiverName = profilesById[tx.receiver_id]?.full_name?.toLowerCase() || '';
        const note = (tx.note || '').toLowerCase();
        const kind = (tx.tx_kind || '').toLowerCase();
        const matches =
          senderName.includes(query) ||
          receiverName.includes(query) ||
          note.includes(query) ||
          kind.includes(query) ||
          String(tx.amount).includes(query);
        if (!matches) return false;
      }
      return true;
    });
  }, [ledger, feedFilter, feedSearch, currentUser, profilesById]);

  const myQrPayload = JSON.stringify({
    app: 'vagacoin',
    v: 1,
    uid: currentUser?.id || '',
    name: currentUser?.full_name || ''
  });

  const remainingAfterSend = useMemo(() => {
    const amt = parsePositiveInt(sendAmount) || 0;
    return Math.max(0, (myBalance.available_vgc_balance || 0) - amt);
  }, [sendAmount, myBalance.available_vgc_balance]);

  return (
    <div className="space-y-6">
      {/* 1. LUXURY FINTECH WALLET HERO CARD */}
      <div className="relative rounded-3xl p-6 sm:p-7 wallet-card-gradient text-white overflow-hidden border border-emerald-500/30 shadow-2xl">
        {/* Ambient subtle glow background */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-64 h-64 bg-teal-500/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          {/* Main Balance */}
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold uppercase tracking-wider border border-emerald-400/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-glow" />
                Available to Spend
              </span>

              <button
                type="button"
                onClick={() => setHideBalance((h) => !h)}
                className="p-1 rounded-lg text-emerald-300/70 hover:text-white hover:bg-white/10 transition-colors"
                title={hideBalance ? 'Show balance' : 'Hide balance'}
              >
                {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div className="text-4xl sm:text-5xl font-extrabold font-mono tracking-tight text-white flex items-baseline gap-2">
              {hideBalance ? (
                <span className="tracking-widest text-emerald-200">••••••</span>
              ) : (
                <span>{formatVGC(myBalance.available_vgc_balance)}</span>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs sm:text-sm font-mono text-emerald-300/90">
              <span>≈ {hideBalance ? 'PKR •••••' : formatPKR(myBalance.available_vgc_balance, peg)}</span>
              <span className="text-white/30">•</span>
              <span className="text-emerald-400/80">1 VGC = {peg} PKR</span>
            </div>
          </div>

          {/* Sub-balances Pill Container */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 bg-slate-950/60 backdrop-blur-md border border-white/10 rounded-2xl p-3.5 sm:p-4 text-xs">
            <div className="space-y-0.5">
              <div className="text-slate-400 flex items-center gap-1 text-[11px]">
                <Shield className="w-3 h-3 text-slate-300" /> Total Ledger
              </div>
              <div className="font-mono font-bold text-slate-100 sm:text-sm">
                {hideBalance ? '••••' : formatVGC(myBalance.ledger_balance, false)}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {hideBalance ? '••••' : formatPKR(myBalance.ledger_balance, peg)}
              </div>
            </div>

            <div className="space-y-0.5 border-l border-white/10 pl-2.5 sm:pl-3">
              <div className="text-amber-300/90 flex items-center gap-1 text-[11px]">
                <Lock className="w-3 h-3 text-amber-400" /> In Escrow
              </div>
              <div className="font-mono font-bold text-amber-300 sm:text-sm">
                {hideBalance ? '••••' : formatVGC(myBalance.locked_in_escrow, false)}
              </div>
              <div className="text-[10px] text-amber-200/60 font-mono">1v1 Stakes</div>
            </div>

            <div className="space-y-0.5 border-l border-white/10 pl-2.5 sm:pl-3">
              <div className="text-sky-300/90 flex items-center gap-1 text-[11px]">
                <Clock className="w-3 h-3 text-sky-400" /> Burn Queue
              </div>
              <div className="font-mono font-bold text-sky-300 sm:text-sm">
                {hideBalance ? '••••' : formatVGC(myBalance.reserved_for_burn, false)}
              </div>
              <div className="text-[10px] text-sky-200/60 font-mono">Pending</div>
            </div>
          </div>
        </div>

        {/* 2. PRIMARY QUICK ACTIONS BAR */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-white/10">
          <button
            type="button"
            onClick={() => openSendModal()}
            disabled={!currentUser?.is_active}
            className="flex items-center justify-center gap-2 py-3 px-4 bg-emerald-500 hover:bg-emerald-400 active:scale-95 disabled:opacity-40 text-slate-950 font-bold rounded-2xl text-xs sm:text-sm shadow-lg shadow-emerald-950/60 transition-all"
          >
            <Send className="w-4 h-4" />
            <span>Send VGC</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setReqPayerId(activeFriends[0]?.id || '');
              setReqAmount('');
              setReqNote('');
              setReqOpen(true);
            }}
            disabled={!currentUser?.is_active}
            className="flex items-center justify-center gap-2 py-3 px-4 bg-slate-900/80 hover:bg-slate-800 active:scale-95 disabled:opacity-40 text-slate-100 font-semibold rounded-2xl text-xs sm:text-sm border border-white/10 transition-all hover:border-emerald-500/40"
          >
            <HandCoins className="w-4 h-4 text-emerald-400" />
            <span>Request</span>
          </button>

          <button
            type="button"
            onClick={() => setMyQrOpen(true)}
            className="flex items-center justify-center gap-2 py-3 px-4 bg-slate-900/80 hover:bg-slate-800 active:scale-95 text-slate-100 font-semibold rounded-2xl text-xs sm:text-sm border border-white/10 transition-all hover:border-teal-500/40"
          >
            <QrCode className="w-4 h-4 text-teal-300" />
            <span>My QR</span>
          </button>

          <button
            type="button"
            onClick={() => setScanQrOpen(true)}
            disabled={!currentUser?.is_active}
            className="flex items-center justify-center gap-2 py-3 px-4 bg-slate-900/80 hover:bg-slate-800 active:scale-95 disabled:opacity-40 text-slate-100 font-semibold rounded-2xl text-xs sm:text-sm border border-white/10 transition-all hover:border-sky-500/40"
          >
            <Camera className="w-4 h-4 text-sky-300" />
            <span>Scan QR</span>
          </button>
        </div>
      </div>

      {/* 3. QUICK FRIEND TRANSFER CAROUSEL (Instant 1-Click Send) */}
      {activeFriends.length > 0 && (
        <div className="bg-slate-900/80 border border-slate-800/90 rounded-3xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkle className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs sm:text-sm font-bold text-white tracking-tight">
                Quick Send to Friend
              </h3>
            </div>
            <span className="text-[11px] text-slate-400">Click avatar to send</span>
          </div>

          <div className="flex items-center gap-3 overflow-x-auto pb-2 pt-1 no-scrollbar">
            {activeFriends.map((friend) => (
              <button
                key={friend.id}
                type="button"
                onClick={() => openSendModal(friend.id)}
                className="group flex flex-col items-center gap-1.5 p-2 rounded-2xl hover:bg-slate-800/80 border border-transparent hover:border-emerald-500/30 transition-all shrink-0 active:scale-95 text-center min-w-[76px]"
              >
                <div className="relative">
                  <Avatar name={friend.full_name} id={friend.id} size="md" className="group-hover:scale-105 transition-transform" />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity">
                    <Send className="w-2.5 h-2.5" />
                  </div>
                </div>
                <span className="text-[11px] font-medium text-slate-300 group-hover:text-emerald-300 truncate max-w-[70px]">
                  {friend.full_name.split(' ')[0]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 4. PENDING PAYMENT & REVERSAL REQUESTS (Actionable alert banner) */}
      {(incomingPendingRequests.length > 0 || outgoingPendingRequests.length > 0) && (
        <div className="bg-slate-900/90 border border-amber-500/30 rounded-3xl p-4 sm:p-5 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <HandCoins className="w-4 h-4 text-amber-400" />
              <span>Pending Action Requests</span>
            </h3>
            <Badge variant="warning">
              {incomingPendingRequests.length} to pay • {outgoingPendingRequests.length} sent
            </Badge>
          </div>

          <div className="space-y-2.5">
            {incomingPendingRequests.map((req) => {
              const requester = profilesById[req.requester_id];
              const isReversal = req.kind === 'REVERSAL';
              return (
                <div
                  key={req.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition-all"
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={requester?.full_name} id={req.requester_id} size="md" />
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant={isReversal ? 'warning' : 'info'}>
                          {isReversal ? 'Reversal Request' : 'Payment Request'}
                        </Badge>
                        <span className="text-xs text-slate-400">{formatRelativeTime(req.created_at)}</span>
                      </div>
                      <div className="text-sm font-semibold text-white">
                        {requester?.full_name || 'Member'} requests{' '}
                        <span className="font-mono text-emerald-400 font-bold">{formatVGC(req.amount)}</span>{' '}
                        <span className="text-xs font-normal text-slate-400">
                          (≈ {formatPKR(req.amount, peg)})
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">“{req.note}”</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => {
                        setRespondTarget(req);
                        setRespondPin('');
                      }}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-md shadow-emerald-950/50 transition-all active:scale-95"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Accept & Pay</span>
                    </button>
                    <button
                      type="button"
                      disabled={responding}
                      onClick={() => handleDeclineRequest(req.id)}
                      className="px-3.5 py-2 bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-all"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Decline</span>
                    </button>
                  </div>
                </div>
              );
            })}

            {outgoingPendingRequests.map((req) => {
              const payer = profilesById[req.payer_id];
              return (
                <div
                  key={req.id}
                  className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-950/50 border border-slate-800/80 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar name={payer?.full_name} id={req.payer_id} size="sm" />
                    <div>
                      <span className="text-slate-300 font-medium">
                        Waiting for <strong className="text-white">{payer?.full_name || 'Member'}</strong> to pay{' '}
                        <span className="font-mono font-bold text-emerald-300">{formatVGC(req.amount)}</span>
                      </span>
                      <div className="text-slate-500 text-[11px]">Reason: {req.note}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCancelRequest(req.id)}
                    className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. VISUAL MONTHLY FINANCIAL SUMMARY (Clean Cards + Optional Audit Table) */}
      <div className="bg-slate-900/80 border border-slate-800/90 rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Monthly Financial Summary</h3>
              <p className="text-xs text-slate-400">Opening & closing balance verification</p>
            </div>
          </div>

          {/* Month selector chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {rolloverRows.slice(0, 4).map((r) => (
              <button
                key={r.monthTag}
                type="button"
                onClick={() => setSelectedMonthTag(r.monthTag)}
                className={`px-3 py-1 rounded-xl text-xs font-medium font-mono transition-all ${
                  selectedMonthTag === r.monthTag
                    ? 'bg-emerald-600 text-white shadow'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white'
                }`}
              >
                {formatMonthLabel(r.monthTag)}
              </button>
            ))}
          </div>
        </div>

        {/* 3 Visual Metric Cards for the Selected Month */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            icon={TrendingUp}
            variant="emerald"
            label={`Inflow (${formatMonthLabel(currentMonthStats.monthTag)})`}
            value={`+${formatVGC(currentMonthStats.minted + currentMonthStats.received)}`}
            subValue={`Minted: +${formatVGC(currentMonthStats.minted)} • Received: +${formatVGC(currentMonthStats.received)}`}
          />

          <StatCard
            icon={TrendingDown}
            variant="rose"
            label={`Outflow (${formatMonthLabel(currentMonthStats.monthTag)})`}
            value={`-${formatVGC(currentMonthStats.sent + currentMonthStats.burned)}`}
            subValue={`Sent: -${formatVGC(currentMonthStats.sent)} • Burned: -${formatVGC(currentMonthStats.burned)}`}
          />

          <StatCard
            icon={Wallet}
            variant="default"
            label={`Month Closing Balance`}
            value={formatVGC(currentMonthStats.closing)}
            subValue={`Opening: ${formatVGC(currentMonthStats.opening)}`}
          />
        </div>

        {/* Expandable Accounting Sheet Toggle */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowFullRolloverTable((v) => !v)}
            className="w-full py-2.5 rounded-xl bg-slate-950/60 hover:bg-slate-950 border border-slate-800/80 text-xs font-medium text-slate-300 hover:text-white flex items-center justify-center gap-1.5 transition-all"
          >
            <span>{showFullRolloverTable ? 'Hide Complete Ledger Audit Sheet' : 'View Full Accounting Math (Closing = Opening + Inflow - Outflow)'}</span>
            {showFullRolloverTable ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showFullRolloverTable && (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/80 p-3 animate-fadeIn">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 pr-3 font-semibold">Month</th>
                    <th className="py-2.5 px-2 font-semibold text-right">Opening</th>
                    <th className="py-2.5 px-2 font-semibold text-right text-emerald-400">+Minted</th>
                    <th className="py-2.5 px-2 font-semibold text-right text-teal-400">+Received</th>
                    <th className="py-2.5 px-2 font-semibold text-right text-rose-400">-Sent</th>
                    <th className="py-2.5 px-2 font-semibold text-right text-amber-400">-Burned</th>
                    <th className="py-2.5 pl-2 font-semibold text-right text-white">Closing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {rolloverRows.map((r) => (
                    <tr key={r.monthTag} className="hover:bg-slate-800/30">
                      <td className="py-2.5 pr-3 font-sans font-medium text-slate-200">
                        {formatMonthLabel(r.monthTag)}{' '}
                        <span className="text-[11px] font-mono text-slate-500">({r.monthTag})</span>
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-300">{formatVGC(r.opening, false)}</td>
                      <td className="py-2.5 px-2 text-right text-emerald-400">+{formatVGC(r.minted, false)}</td>
                      <td className="py-2.5 px-2 text-right text-teal-400">+{formatVGC(r.received, false)}</td>
                      <td className="py-2.5 px-2 text-right text-rose-400">-{formatVGC(r.sent, false)}</td>
                      <td className="py-2.5 px-2 text-right text-amber-400">-{formatVGC(r.burned, false)}</td>
                      <td className="py-2.5 pl-2 text-right font-bold text-white">
                        {formatVGC(r.closing)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 6. LIVE GROUP ACTIVITY FEED WITH SEARCH & FILTER */}
      <div className="bg-slate-900/80 border border-slate-800/90 rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Recent Activity Feed</h3>
            <p className="text-xs text-slate-400">
              Immutable committee ledger ({ledger.length} verified transactions)
            </p>
          </div>

          {/* Search Bar */}
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={feedSearch}
              onChange={(e) => setFeedSearch(e.target.value)}
              placeholder="Search member or note..."
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:border-emerald-500 outline-none transition-colors"
            />
            {feedSearch && (
              <button
                type="button"
                onClick={() => setFeedSearch('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {[
            { id: 'ALL', label: 'All' },
            { id: 'TRADES', label: 'Friend Trades' },
            { id: 'INCOMING', label: 'Incoming' },
            { id: 'OUTGOING', label: 'Outgoing' },
            { id: 'MINT', label: 'Minted' },
            { id: 'BURN', label: 'Burned' }
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFeedFilter(f.id)}
              className={`px-3 py-1 rounded-xl text-xs font-medium transition-all shrink-0 ${
                feedFilter === f.id
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-950 border border-slate-800/80 text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Feed List */}
        {filteredFeed.length === 0 ? (
          <EmptyState
            title="No matching transactions"
            description={feedSearch ? 'Try a different search term.' : 'Transactions will appear here in real time.'}
          />
        ) : (
          <div className="space-y-2.5">
            {filteredFeed.slice(0, feedLimit).map((tx) => {
              const isMint = tx.tx_kind === 'MINT';
              const isBurn = tx.tx_kind === 'BURN';
              const isSenderMe = tx.sender_id === currentUser?.id;
              const isReceiverMe = tx.receiver_id === currentUser?.id;

              const senderName = isSenderMe
                ? 'You'
                : profilesById[tx.sender_id]?.full_name || 'Member';
              const receiverName = isReceiverMe
                ? 'You'
                : profilesById[tx.receiver_id]?.full_name || 'Member';

              const ageHours = (Date.now() - new Date(tx.created_at).getTime()) / (3600 * 1000);
              const existingReversal = (paymentRequests || []).find(
                (r) =>
                  r.related_tx_id === tx.id &&
                  r.kind === 'REVERSAL' &&
                  ['PENDING', 'ACCEPTED'].includes(r.status)
              );
              const canRequestReversal =
                tx.tx_kind === 'TRADE' &&
                isSenderMe &&
                ageHours <= reversalWindowHours &&
                !existingReversal;

              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80 hover:border-slate-700 transition-all hover:bg-slate-950/90"
                >
                  <div className="flex items-center gap-3.5">
                    {/* Icon or Avatar */}
                    {isMint ? (
                      <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                        <Sparkles className="w-5 h-5" />
                      </div>
                    ) : isBurn ? (
                      <div className="w-11 h-11 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
                        <Flame className="w-5 h-5" />
                      </div>
                    ) : (
                      <Avatar
                        name={isSenderMe ? receiverName : senderName}
                        id={isSenderMe ? tx.receiver_id : tx.sender_id}
                        size="md"
                      />
                    )}

                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs sm:text-sm font-semibold text-white">
                        {isMint && (
                          <span>
                            Deposit Minted to <strong className="text-emerald-300">{receiverName}</strong>
                          </span>
                        )}
                        {isBurn && (
                          <span>
                            Burned Cashout from <strong className="text-amber-300">{senderName}</strong>
                          </span>
                        )}
                        {tx.tx_kind === 'TRADE' && (
                          <span>
                            {isSenderMe ? (
                              <>Sent to <strong className="text-emerald-300">{receiverName}</strong></>
                            ) : isReceiverMe ? (
                              <>Received from <strong className="text-emerald-300">{senderName}</strong></>
                            ) : (
                              <>{senderName} → {receiverName}</>
                            )}
                          </span>
                        )}

                        <Badge
                          variant={isMint ? 'success' : isBurn ? 'warning' : isReceiverMe ? 'success' : 'default'}
                          className="text-[10px] py-0 px-1.5"
                        >
                          {isMint ? 'Deposit' : isBurn ? 'Burn' : 'P2P'}
                        </Badge>
                      </div>

                      {tx.note && <div className="text-xs text-slate-400">“{tx.note}”</div>}

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <span className="text-[11px] text-slate-500 font-mono">
                          {formatRelativeTime(tx.created_at)}
                        </span>

                        {existingReversal && (
                          <Badge variant={existingReversal.status === 'ACCEPTED' ? 'success' : 'warning'} className="text-[10px]">
                            {existingReversal.status === 'ACCEPTED' ? 'Reversed' : 'Reversal pending'}
                          </Badge>
                        )}

                        {canRequestReversal && (
                          <button
                            type="button"
                            onClick={() => {
                              setReversalTargetTx(tx);
                              setReversalNote('Wrong amount/recipient – please return');
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full hover:bg-amber-500/20 transition-colors"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Request Reversal</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div
                      className={`text-sm sm:text-base font-extrabold font-mono ${
                        isMint || isReceiverMe
                          ? 'text-emerald-400'
                          : isBurn || isSenderMe
                          ? 'text-rose-400'
                          : 'text-slate-200'
                      }`}
                    >
                      {isMint || isReceiverMe ? '+' : isBurn || isSenderMe ? '-' : ''}
                      {formatVGC(tx.amount)}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      ≈ {formatPKR(tx.amount, peg)}
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredFeed.length > feedLimit && (
              <button
                type="button"
                onClick={() => setFeedLimit((n) => n + 15)}
                className="w-full py-3 text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-2xl border border-slate-800 transition-all shadow-sm"
              >
                Load More Transactions ({filteredFeed.length - feedLimit} remaining)
              </button>
            )}
          </div>
        )}
      </div>

      {/* =========================================================================
          MODALS
      ========================================================================= */}

      {/* SEND VGC MODAL */}
      <Modal
        isOpen={sendOpen}
        onClose={() => setSendOpen(false)}
        title="Send Vagacoin (P2P Trade)"
        subtitle="Transfer funds instantly to any group member"
      >
        <form onSubmit={handleSendSubmit} className="space-y-4">
          <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-400">Available to Spend:</span>
            <span className="font-mono font-bold text-emerald-400 text-sm">
              {formatVGC(myBalance.available_vgc_balance)} (≈ {formatPKR(myBalance.available_vgc_balance, peg)})
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Select Friend</label>
            <input
              type="text"
              value={friendSearch}
              onChange={(e) => setFriendSearch(e.target.value)}
              placeholder="Search by friend name..."
              className="w-full px-3.5 py-2 mb-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 outline-none focus:border-emerald-500"
            />
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
              {filteredFriends.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setReceiverId(f.id)}
                  className={`p-2.5 rounded-2xl border text-left text-xs font-medium transition-all flex items-center gap-2.5 ${
                    receiverId === f.id
                      ? 'bg-emerald-600/20 border-emerald-500 text-emerald-200 shadow-sm'
                      : 'bg-slate-950 border-slate-800/80 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <Avatar name={f.full_name} id={f.id} size="sm" />
                  <div className="truncate">
                    <div className="truncate font-semibold">{f.full_name}</div>
                    <div className="text-[10px] text-slate-400 capitalize">{f.role}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Amount (Whole VGC)</label>
            <input
              type="text"
              inputMode="numeric"
              required
              value={sendAmount}
              onChange={(e) => setSendAmount(sanitizeIntegerInput(e.target.value))}
              placeholder="e.g. 250"
              className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-xl font-mono font-bold text-white focus:border-emerald-500 outline-none"
            />
            <AmountPresets
              presets={[50, 100, 250, 500, 1000]}
              onSelect={(val) => setSendAmount(val)}
              maxAmount={myBalance.available_vgc_balance}
            />
            {sendAmount && (
              <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between pt-1">
                <span>≈ {formatPKR(sendAmount, peg)}</span>
                <span>Remaining: {formatVGC(remainingAfterSend)}</span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Reason / Note</label>
            <input
              type="text"
              required
              value={sendNote}
              onChange={(e) => setSendNote(e.target.value)}
              placeholder="e.g. Chai share or tournament stake"
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-2xl text-sm text-white focus:border-emerald-500 outline-none"
            />
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {QUICK_NOTES.map((note) => (
                <button
                  key={note}
                  type="button"
                  onClick={() => setSendNote(note)}
                  className="px-2 py-0.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-[10px] text-slate-300 hover:text-white transition-colors"
                >
                  {note}
                </button>
              ))}
            </div>
          </div>

          <PinInput value={sendPin} onChange={setSendPin} disabled={sending} />

          <button
            type="submit"
            disabled={
              sending ||
              !receiverId ||
              !parsePositiveInt(sendAmount) ||
              parsePositiveInt(sendAmount) > myBalance.available_vgc_balance ||
              sendPin.length !== 4
            }
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition-all active:scale-95"
          >
            {sending && <Spinner />}
            <span>Confirm & Send {sendAmount ? formatVGC(sendAmount) : 'VGC'}</span>
          </button>
        </form>
      </Modal>

      {/* REQUEST VGC MODAL */}
      <Modal
        isOpen={reqOpen}
        onClose={() => setReqOpen(false)}
        title="Request VGC from Friend"
        subtitle="Your friend will be notified to approve and send funds"
      >
        <form onSubmit={handleCreateRequest} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Request From</label>
            <select
              value={reqPayerId}
              onChange={(e) => setReqPayerId(e.target.value)}
              className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-sm text-white outline-none focus:border-emerald-500"
            >
              {activeFriends.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.full_name} ({f.role})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Amount (VGC)</label>
            <input
              type="text"
              inputMode="numeric"
              required
              value={reqAmount}
              onChange={(e) => setReqAmount(sanitizeIntegerInput(e.target.value))}
              placeholder="e.g. 500"
              className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-xl font-mono font-bold text-white outline-none focus:border-emerald-500"
            />
            <AmountPresets
              presets={[50, 100, 250, 500, 1000]}
              onSelect={(val) => setReqAmount(val)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Reason Note</label>
            <input
              type="text"
              required
              value={reqNote}
              onChange={(e) => setReqNote(e.target.value)}
              placeholder="e.g. Movie ticket reimbursement"
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-2xl text-sm text-white outline-none focus:border-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={requesting || !reqPayerId || !parsePositiveInt(reqAmount)}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95"
          >
            {requesting && <Spinner />}
            <span>Send Payment Request</span>
          </button>
        </form>
      </Modal>

      {/* ACCEPT PAYMENT / REVERSAL REQUEST PIN MODAL */}
      <Modal
        isOpen={Boolean(respondTarget)}
        onClose={() => setRespondTarget(null)}
        title={respondTarget?.kind === 'REVERSAL' ? 'Approve Compensating Reversal' : 'Pay VGC Request'}
        subtitle="Authorize the transfer with your security PIN"
      >
        {respondTarget && (
          <form onSubmit={handleAcceptRequest} className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-1.5">
              <div className="text-slate-400">
                Sending to:{' '}
                <strong className="text-white">
                  {profilesById[respondTarget.requester_id]?.full_name || 'Member'}
                </strong>
              </div>
              <div className="text-xl font-mono font-bold text-emerald-400">
                {formatVGC(respondTarget.amount)} (≈ {formatPKR(respondTarget.amount, peg)})
              </div>
              <div className="text-slate-400">Reason: “{respondTarget.note}”</div>
            </div>

            <PinInput value={respondPin} onChange={setRespondPin} disabled={responding} />

            <button
              type="submit"
              disabled={responding || respondPin.length !== 4}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95"
            >
              {responding && <Spinner />}
              <span>Authorize & Send {formatVGC(respondTarget.amount)}</span>
            </button>
          </form>
        )}
      </Modal>

      {/* REQUEST REVERSAL MODAL */}
      <Modal
        isOpen={Boolean(reversalTargetTx)}
        onClose={() => setReversalTargetTx(null)}
        title="Request Compensating Reversal"
        subtitle="In accordance with 48h immutable ledger protocol"
      >
        {reversalTargetTx && (
          <form onSubmit={handleSubmitReversal} className="space-y-4">
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                <span>Immutable Ledger Rule</span>
              </div>
              <p className="leading-relaxed">
                Ledger entries are never altered or deleted. Approving this creates a new compensating TRADE of{' '}
                <strong>{formatVGC(reversalTargetTx.amount)}</strong> back to your wallet.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Reversal Note</label>
              <input
                type="text"
                required
                value={reversalNote}
                onChange={(e) => setReversalNote(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-2xl text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={reversing}
              className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95"
            >
              {reversing && <Spinner />}
              <span>Send Reversal Request</span>
            </button>
          </form>
        )}
      </Modal>

      {/* MY QR MODAL */}
      <Modal
        isOpen={myQrOpen}
        onClose={() => setMyQrOpen(false)}
        title="My Quick-Pay QR Code"
        subtitle="Share with friends to receive VGC instantly"
      >
        <div className="flex flex-col items-center text-center space-y-4 py-2">
          <div className="p-4 bg-white rounded-3xl shadow-2xl ring-4 ring-emerald-500/30">
            <QRCodeSVG value={myQrPayload} size={220} level="M" includeMargin={false} />
          </div>

          <div className="space-y-1">
            <div className="text-base font-bold text-white flex items-center justify-center gap-2">
              <Avatar name={currentUser?.full_name} id={currentUser?.id} size="sm" />
              <span>{currentUser?.full_name}</span>
            </div>
            <p className="text-xs text-slate-400 max-w-xs">
              Friends can scan this QR with their device camera to pre-select you as the payment recipient.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(myQrPayload);
                addToast('Copied QR payload to clipboard!', 'info');
              }
            }}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition-all"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Member Code</span>
          </button>
        </div>
      </Modal>

      {/* SCAN FRIEND QR MODAL */}
      <Modal
        isOpen={scanQrOpen}
        onClose={() => setScanQrOpen(false)}
        title="Scan Friend QR Code"
        subtitle="Point your camera at a friend's Vagacoin QR"
      >
        <div className="space-y-4">
          <div
            id="vagacoin-qr-reader"
            className="w-full overflow-hidden rounded-2xl bg-slate-950 border border-slate-800 min-h-[240px] flex items-center justify-center shadow-inner"
          />

          {cameraError && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
              {cameraError}
            </div>
          )}

          <div className="pt-2 border-t border-slate-800/80">
            <div className="text-xs font-semibold text-slate-400 mb-2">
              Or pick a friend directly:
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
              {activeFriends.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={async () => {
                    await stopScanner();
                    setScanQrOpen(false);
                    openSendModal(f.id);
                  }}
                  className="p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800/80 text-xs font-semibold text-slate-200 text-left flex items-center gap-2 truncate transition-colors"
                >
                  <Avatar name={f.full_name} id={f.id} size="xs" />
                  <span className="truncate">{f.full_name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
