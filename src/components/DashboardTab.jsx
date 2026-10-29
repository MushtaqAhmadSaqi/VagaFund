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
  X
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
import { Modal, Badge, PinInput, EmptyState, Spinner, useToast } from './ui.jsx';

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

  // Feed pagination
  const [feedLimit, setFeedLimit] = useState(15);

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
          confetti({ particleCount: 70, spread: 65, origin: { y: 0.6 } });
        } catch {
          // ignore confetti errors in headless environments
        }
        addToast(res.message || 'VGC sent!', 'success');
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
        addToast(res.message || 'Request sent!', 'success');
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
      addToast('Enter your 4-digit PIN to send VGC.', 'error');
      return;
    }
    setResponding(true);
    try {
      const res = await api.respondPaymentRequest(respondTarget.id, true, respondPin);
      if (!res.ok) {
        addToast(res.message || 'Payment failed', 'error');
        setRespondPin('');
      } else {
        addToast(res.message || 'Request paid!', 'success');
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
        addToast(res.message || 'Reversal requested!', 'success');
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

  const myQrPayload = JSON.stringify({
    app: 'vagacoin',
    v: 1,
    uid: currentUser?.id || '',
    name: currentUser?.full_name || ''
  });

  return (
    <div className="space-y-6">
      {/* WALLET HERO CARD */}
      <div className="bg-gradient-to-br from-emerald-950/90 via-slate-900 to-slate-900 border border-emerald-500/30 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-300 uppercase tracking-wider">
              <Wallet className="w-4 h-4" />
              <span>Available to Spend</span>
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold font-mono text-white mt-1">
              {formatVGC(myBalance.available_vgc_balance)}
            </div>
            <div className="text-xs text-emerald-300/90 font-mono mt-0.5">
              ≈ {formatPKR(myBalance.available_vgc_balance, peg)}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3 bg-slate-950/70 border border-slate-800/90 rounded-xl p-3 text-xs">
            <div>
              <div className="text-slate-400">Ledger Total</div>
              <div className="font-mono font-bold text-slate-100 mt-0.5">
                {formatVGC(myBalance.ledger_balance)}
              </div>
              <div className="text-[10px] text-slate-500">≈ {formatPKR(myBalance.ledger_balance, peg)}</div>
            </div>
            <div>
              <div className="text-slate-400 flex items-center gap-1">
                <Lock className="w-3 h-3 text-amber-400" /> Escrow
              </div>
              <div className="font-mono font-bold text-amber-300 mt-0.5">
                {formatVGC(myBalance.locked_in_escrow)}
              </div>
              <div className="text-[10px] text-slate-500">1v1 Stakes</div>
            </div>
            <div>
              <div className="text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3 text-sky-400" /> Reserved
              </div>
              <div className="font-mono font-bold text-sky-300 mt-0.5">
                {formatVGC(myBalance.reserved_for_burn)}
              </div>
              <div className="text-[10px] text-slate-500">Pending Burn</div>
            </div>
          </div>
        </div>

        {/* ACTION BAR */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5">
          <button
            type="button"
            onClick={() => openSendModal()}
            disabled={!currentUser?.is_active}
            className="flex items-center justify-center gap-2 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded-xl text-xs sm:text-sm shadow-lg shadow-emerald-950/50 transition-all"
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
            className="flex items-center justify-center gap-2 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 font-semibold rounded-xl text-xs sm:text-sm border border-slate-700 transition-all"
          >
            <HandCoins className="w-4 h-4 text-emerald-400" />
            <span>Request VGC</span>
          </button>

          <button
            type="button"
            onClick={() => setMyQrOpen(true)}
            className="flex items-center justify-center gap-2 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold rounded-xl text-xs sm:text-sm border border-slate-700 transition-all"
          >
            <QrCode className="w-4 h-4 text-teal-400" />
            <span>My QR</span>
          </button>

          <button
            type="button"
            onClick={() => setScanQrOpen(true)}
            disabled={!currentUser?.is_active}
            className="flex items-center justify-center gap-2 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 font-semibold rounded-xl text-xs sm:text-sm border border-slate-700 transition-all"
          >
            <Camera className="w-4 h-4 text-sky-400" />
            <span>Scan Friend QR</span>
          </button>
        </div>
      </div>

      {/* INCOMING & OUTGOING REQUESTS / REVERSALS */}
      {(incomingPendingRequests.length > 0 || outgoingPendingRequests.length > 0) && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <HandCoins className="w-4 h-4 text-emerald-400" />
            <span>Pending Payment & Reversal Requests</span>
          </h3>

          <div className="space-y-2.5">
            {incomingPendingRequests.map((req) => {
              const requester = profilesById[req.requester_id];
              const isReversal = req.kind === 'REVERSAL';
              return (
                <div
                  key={req.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-950/90 border border-slate-800"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={isReversal ? 'warning' : 'info'}>
                        {isReversal ? 'Reversal request' : 'Payment request'}
                      </Badge>
                      <span className="text-xs text-slate-400">{formatRelativeTime(req.created_at)}</span>
                    </div>
                    <div className="text-sm font-semibold text-white">
                      {requester?.full_name || 'Member'} asks for{' '}
                      <span className="font-mono text-emerald-400">{formatVGC(req.amount)}</span>{' '}
                      <span className="text-xs font-normal text-slate-400">
                        (≈ {formatPKR(req.amount, peg)})
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">Note: {req.note}</div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setRespondTarget(req);
                        setRespondPin('');
                      }}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Accept & Pay</span>
                    </button>
                    <button
                      type="button"
                      disabled={responding}
                      onClick={() => handleDeclineRequest(req.id)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-200 text-xs font-semibold rounded-lg border border-slate-700 flex items-center gap-1"
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
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 text-xs"
                >
                  <div>
                    <span className="text-slate-300 font-medium">
                      Sent {req.kind === 'REVERSAL' ? 'reversal' : 'payment'} request to{' '}
                      <strong className="text-white">{payer?.full_name || 'Member'}</strong> for{' '}
                      <span className="font-mono text-emerald-300">{formatVGC(req.amount)}</span>
                    </span>
                    <div className="text-slate-500 mt-0.5">{req.note}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCancelRequest(req.id)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MONTHLY ROLLOVER HISTORY */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-400" />
            <span>Monthly Rollover History (Closing(n) = Opening(n+1))</span>
          </h3>
          <Badge variant="success">{settings?.rollover_mode || 'CONTINUOUS'}</Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 pr-3 font-medium">Month</th>
                <th className="py-2 px-2 font-medium text-right">Opening</th>
                <th className="py-2 px-2 font-medium text-right text-emerald-400">+Minted</th>
                <th className="py-2 px-2 font-medium text-right text-teal-400">+Received</th>
                <th className="py-2 px-2 font-medium text-right text-rose-400">-Sent</th>
                <th className="py-2 px-2 font-medium text-right text-amber-400">-Burned</th>
                <th className="py-2 pl-2 font-medium text-right text-white">Closing</th>
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
      </div>

      {/* LIVE GROUP ACTIVITY FEED */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Live Group Ledger Feed</h3>
          <span className="text-xs text-slate-400">{ledger.length} immutable entries</span>
        </div>

        {ledger.length === 0 ? (
          <EmptyState title="No ledger transactions yet" description="Verified deposits and trades will appear here in real time." />
        ) : (
          <div className="space-y-2.5">
            {ledger.slice(0, feedLimit).map((tx) => {
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
                  className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 hover:border-slate-700/80 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        isMint
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : isBurn
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : isSenderMe
                          ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          : 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                      }`}
                    >
                      {isMint ? (
                        <Sparkles className="w-4 h-4" />
                      ) : isBurn ? (
                        <Flame className="w-4 h-4" />
                      ) : isSenderMe ? (
                        <ArrowUpRight className="w-4 h-4" />
                      ) : (
                        <ArrowDownLeft className="w-4 h-4" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-100">
                        <Badge
                          variant={isMint ? 'success' : isBurn ? 'warning' : 'info'}
                        >
                          {tx.tx_kind}
                        </Badge>
                        {isMint && (
                          <span>
                            Minted to <strong className="text-white">{receiverName}</strong> ({tx.month_tag})
                          </span>
                        )}
                        {isBurn && (
                          <span>
                            Burned from <strong className="text-white">{senderName}</strong>
                          </span>
                        )}
                        {tx.tx_kind === 'TRADE' && (
                          <span>
                            <strong className="text-white">{senderName}</strong> →{' '}
                            <strong className="text-white">{receiverName}</strong>
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-400">{tx.note}</div>

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <span className="text-[11px] text-slate-500">
                          {formatRelativeTime(tx.created_at)}
                        </span>

                        {existingReversal && (
                          <Badge variant={existingReversal.status === 'ACCEPTED' ? 'success' : 'warning'}>
                            {existingReversal.status === 'ACCEPTED'
                              ? 'Reversed via trade'
                              : 'Reversal pending'}
                          </Badge>
                        )}

                        {canRequestReversal && (
                          <button
                            type="button"
                            onClick={() => {
                              setReversalTargetTx(tx);
                              setReversalNote('Wrong amount/recipient – please return');
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full"
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
                      className={`text-sm font-bold font-mono ${
                        isMint
                          ? 'text-emerald-400'
                          : isBurn
                          ? 'text-amber-400'
                          : isReceiverMe
                          ? 'text-emerald-400'
                          : isSenderMe
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

            {ledger.length > feedLimit && (
              <button
                type="button"
                onClick={() => setFeedLimit((n) => n + 15)}
                className="w-full py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-800 rounded-xl border border-slate-700/70"
              >
                Load More Transactions ({ledger.length - feedLimit} remaining)
              </button>
            )}
          </div>
        )}
      </div>

      {/* SEND VGC MODAL */}
      <Modal isOpen={sendOpen} onClose={() => setSendOpen(false)} title="Send Vagacoin (P2P Trade)">
        <form onSubmit={handleSendSubmit} className="space-y-4">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-400">Your Available Balance:</span>
            <span className="font-mono font-bold text-emerald-400">
              {formatVGC(myBalance.available_vgc_balance)} (≈ {formatPKR(myBalance.available_vgc_balance, peg)})
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Search & Select Friend</label>
            <input
              type="text"
              value={friendSearch}
              onChange={(e) => setFriendSearch(e.target.value)}
              placeholder="Filter friends by name..."
              className="w-full px-3 py-2 mb-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 outline-none focus:border-emerald-500"
            />
            <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto">
              {filteredFriends.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setReceiverId(f.id)}
                  className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all ${
                    receiverId === f.id
                      ? 'bg-emerald-600/20 border-emerald-500 text-emerald-200'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="truncate font-semibold">{f.full_name}</div>
                  <div className="text-[10px] text-slate-400 capitalize">{f.role}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Amount (Whole VGC Only)</label>
            <input
              type="text"
              inputMode="numeric"
              required
              value={sendAmount}
              onChange={(e) => setSendAmount(sanitizeIntegerInput(e.target.value))}
              placeholder="e.g. 250"
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-base font-mono font-bold text-white focus:border-emerald-500 outline-none"
            />
            {sendAmount && (
              <div className="text-[11px] text-slate-400 mt-1 font-mono">
                ≈ {formatPKR(sendAmount, peg)} • Idempotency Key: {idempotencyKey.slice(0, 8)}...
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Note / Reason</label>
            <input
              type="text"
              required
              value={sendNote}
              onChange={(e) => setSendNote(e.target.value)}
              placeholder="e.g. Chai & samosa share"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:border-emerald-500 outline-none"
            />
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
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
          >
            {sending && <Spinner />}
            <span>Confirm & Send {sendAmount ? formatVGC(sendAmount) : 'VGC'}</span>
          </button>
        </form>
      </Modal>

      {/* REQUEST VGC MODAL */}
      <Modal isOpen={reqOpen} onClose={() => setReqOpen(false)} title="Request VGC from Friend">
        <form onSubmit={handleCreateRequest} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Select Friend</label>
            <select
              value={reqPayerId}
              onChange={(e) => setReqPayerId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white outline-none focus:border-emerald-500"
            >
              {activeFriends.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.full_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Amount (VGC)</label>
            <input
              type="text"
              inputMode="numeric"
              required
              value={reqAmount}
              onChange={(e) => setReqAmount(sanitizeIntegerInput(e.target.value))}
              placeholder="e.g. 500"
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-base font-mono font-bold text-white outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Note</label>
            <input
              type="text"
              required
              value={reqNote}
              onChange={(e) => setReqNote(e.target.value)}
              placeholder="e.g. Movie ticket reimbursement"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white outline-none focus:border-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={requesting || !reqPayerId || !parsePositiveInt(reqAmount)}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
          >
            {requesting && <Spinner />}
            <span>Send Request</span>
          </button>
        </form>
      </Modal>

      {/* ACCEPT PAYMENT / REVERSAL REQUEST PIN MODAL */}
      <Modal
        isOpen={Boolean(respondTarget)}
        onClose={() => setRespondTarget(null)}
        title={respondTarget?.kind === 'REVERSAL' ? 'Approve Trade Reversal' : 'Pay VGC Request'}
      >
        {respondTarget && (
          <form onSubmit={handleAcceptRequest} className="space-y-4">
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
              <div className="text-slate-400">
                Sending to:{' '}
                <strong className="text-white">
                  {profilesById[respondTarget.requester_id]?.full_name || 'Member'}
                </strong>
              </div>
              <div className="text-base font-mono font-bold text-emerald-400">
                {formatVGC(respondTarget.amount)} (≈ {formatPKR(respondTarget.amount, peg)})
              </div>
              <div className="text-slate-400">Reason: {respondTarget.note}</div>
            </div>

            <PinInput value={respondPin} onChange={setRespondPin} disabled={responding} />

            <button
              type="submit"
              disabled={responding || respondPin.length !== 4}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
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
        title="Request Compensating Trade Reversal"
      >
        {reversalTargetTx && (
          <form onSubmit={handleSubmitReversal} className="space-y-4">
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 space-y-1">
              <div className="font-semibold">Immutable Ledger Rule</div>
              <div>
                Ledger rows are never edited or deleted. Accepting this reversal creates a new compensating TRADE of{' '}
                <strong>{formatVGC(reversalTargetTx.amount)}</strong> back to your wallet.
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Reversal Note</label>
              <input
                type="text"
                required
                value={reversalNote}
                onChange={(e) => setReversalNote(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={reversing}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
            >
              {reversing && <Spinner />}
              <span>Send Reversal Request</span>
            </button>
          </form>
        )}
      </Modal>

      {/* MY QR MODAL */}
      <Modal isOpen={myQrOpen} onClose={() => setMyQrOpen(false)} title="My Vagacoin Quick-Pay QR">
        <div className="flex flex-col items-center text-center space-y-4 py-2">
          <div className="p-4 bg-white rounded-2xl shadow-xl">
            <QRCodeSVG value={myQrPayload} size={210} level="M" includeMargin={false} />
          </div>
          <div>
            <div className="text-base font-bold text-white">{currentUser?.full_name}</div>
            <div className="text-xs font-mono text-slate-400 mt-0.5 break-all">{myQrPayload}</div>
          </div>
          <p className="text-xs text-slate-400 max-w-xs">
            Friends can scan this QR from their dashboard to pre-select you as the recipient.
          </p>
        </div>
      </Modal>

      {/* SCAN FRIEND QR MODAL */}
      <Modal
        isOpen={scanQrOpen}
        onClose={() => setScanQrOpen(false)}
        title="Scan Friend's Vagacoin QR"
      >
        <div className="space-y-4">
          <div
            id="vagacoin-qr-reader"
            className="w-full overflow-hidden rounded-xl bg-slate-950 border border-slate-800 min-h-[220px] flex items-center justify-center"
          />

          {cameraError && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
              {cameraError}
            </div>
          )}

          <div className="pt-2 border-t border-slate-800">
            <div className="text-xs font-medium text-slate-400 mb-2">
              Or pick a friend manually:
            </div>
            <div className="grid grid-cols-2 gap-2">
              {activeFriends.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={async () => {
                    await stopScanner();
                    setScanQrOpen(false);
                    openSendModal(f.id);
                  }}
                  className="p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-200 text-left truncate"
                >
                  {f.full_name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
