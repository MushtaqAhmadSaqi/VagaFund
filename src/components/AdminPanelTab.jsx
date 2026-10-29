import React, { useState, useMemo } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Eye,
  Swords,
  UserMinus,
  Scale,
  Settings,
  ClipboardList,
  CalendarCheck2
} from 'lucide-react';
import { api } from '../lib/supabase.js';
import {
  formatVGC,
  formatPKR,
  sanitizeIntegerInput,
  getCurrentMonthTag,
  formatRelativeTime,
  PEG_PKR_PER_VGC
} from '../lib/format.js';
import { Modal, Badge, EmptyState, Spinner, useToast } from './ui.jsx';

export default function AdminPanelTab({
  currentUser,
  profiles,
  balances,
  ledger,
  depositClaims,
  burnRequests,
  escrowMatches,
  reconciliations,
  auditLog,
  summary,
  settings,
  onRefresh
}) {
  const { addToast } = useToast();
  const peg = Number(settings?.peg || PEG_PKR_PER_VGC);

  // Guard for non-admins
  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-2">
        <ShieldAlert className="w-8 h-8 text-rose-400 mx-auto" />
        <h3 className="text-base font-bold text-white">Admins Only</h3>
        <p className="text-xs text-slate-400">
          Only committee administrators can verify deposits, resolve disputes, or manage treasury settings.
        </p>
      </div>
    );
  }

  const profilesById = useMemo(() => {
    const map = {};
    profiles.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [profiles]);

  const pendingClaims = useMemo(
    () => (depositClaims || []).filter((c) => c.status === 'PENDING'),
    [depositClaims]
  );

  const pendingBurns = useMemo(
    () => (burnRequests || []).filter((b) => b.status === 'PENDING'),
    [burnRequests]
  );

  const disputedMatches = useMemo(
    () => (escrowMatches || []).filter((m) => m.status === 'DISPUTED'),
    [escrowMatches]
  );

  // Receipt preview modal
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  // Confirm Mint Modal
  const [confirmMintClaim, setConfirmMintClaim] = useState(null);
  const [minting, setMinting] = useState(false);

  // Reject Deposit / Burn Modal
  const [rejectTarget, setRejectTarget] = useState(null); // { type: 'deposit'|'burn', item }
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // Clean Member Exit Calculator state
  const activeMembers = useMemo(
    () => profiles.filter((p) => p.is_active),
    [profiles]
  );
  const [exitUserId, setExitUserId] = useState(activeMembers[0]?.id || '');
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [exitTypedName, setExitTypedName] = useState('');
  const [exiting, setExiting] = useState(false);
  const [exitReceipt, setExitReceipt] = useState(null);

  // Reconciliation state
  const [bankBalanceInput, setBankBalanceInput] = useState(
    String(summary?.fund_cash_pkr ?? 0)
  );
  const [recNote, setRecNote] = useState('');
  const [savingRec, setSavingRec] = useState(false);

  // Settings form state
  const [groupName, setGroupName] = useState(settings?.group_name || 'Vagafund Committee');
  const [monthlyContrib, setMonthlyContrib] = useState(String(settings?.monthly_contribution || 2000));
  const [approvalsReq, setApprovalsReq] = useState(String(settings?.burn_approvals_required || 2));
  const [rolloverMode, setRolloverMode] = useState(settings?.rollover_mode || 'CONTINUOUS');
  const [reversalHours, setReversalHours] = useState(String(settings?.reversal_window_hours || 48));
  const [inviteCode, setInviteCode] = useState(settings?.invite_code || 'VAGA2026');
  const [savingSettings, setSavingSettings] = useState(false);

  // Month-End Settlement state
  const [runningSettlement, setRunningSettlement] = useState(false);
  const [settlementResult, setSettlementResult] = useState(null);

  const handleOpenReceipt = async (path) => {
    const url = await api.getReceiptUrl(path);
    setPreviewUrl(url);
    setPreviewOpen(true);
  };

  const handleConfirmApproveMint = async () => {
    if (!confirmMintClaim) return;
    setMinting(true);
    try {
      const res = await api.adminApproveDeposit(confirmMintClaim.id);
      if (!res.ok) {
        addToast(res.message || 'Could not approve deposit', 'error');
      } else {
        addToast(res.message || 'Deposit minted!', 'success');
        setConfirmMintClaim(null);
        onRefresh?.();
      }
    } finally {
      setMinting(false);
    }
  };

  const handleConfirmReject = async (e) => {
    e.preventDefault();
    if (!rejectTarget || !rejectReason.trim()) return;
    setRejecting(true);
    try {
      const res =
        rejectTarget.type === 'deposit'
          ? await api.adminRejectDeposit(rejectTarget.item.id, rejectReason.trim())
          : await api.adminRejectBurn(rejectTarget.item.id, rejectReason.trim());
      if (!res.ok) {
        addToast(res.message || 'Rejection failed', 'error');
      } else {
        addToast(res.message || 'Rejected.', 'info');
        setRejectTarget(null);
        setRejectReason('');
        onRefresh?.();
      }
    } finally {
      setRejecting(false);
    }
  };

  const handleApproveBurnAdmin = async (burnId) => {
    const res = await api.approveAndExecuteBurn(burnId);
    if (!res.ok) addToast(res.message || 'Could not approve burn', 'error');
    else {
      addToast(res.message || 'Burn approved!', 'success');
      onRefresh?.();
    }
  };

  const handleResolveDispute = async (matchId, winnerId) => {
    const res = await api.settleEscrowMatch(matchId, winnerId);
    if (!res.ok) addToast(res.message || 'Failed to settle dispute', 'error');
    else {
      addToast(res.message || 'Dispute resolved!', 'success');
      onRefresh?.();
    }
  };

  // Exit member breakdown calculation
  const exitStats = useMemo(() => {
    if (!exitUserId) return null;
    const member = profilesById[exitUserId];
    const bal = balances.find((b) => b.user_id === exitUserId);
    if (!member || !bal) return null;

    let mintedTotal = 0;
    let tradeReceived = 0;
    let tradeSent = 0;
    let burnedTotal = 0;
    ledger.forEach((tx) => {
      const amt = Number(tx.amount) || 0;
      if (tx.tx_kind === 'MINT' && tx.receiver_id === exitUserId) mintedTotal += amt;
      if (tx.tx_kind === 'TRADE' && tx.receiver_id === exitUserId) tradeReceived += amt;
      if (tx.tx_kind === 'TRADE' && tx.sender_id === exitUserId) tradeSent += amt;
      if (tx.tx_kind === 'BURN' && tx.sender_id === exitUserId) burnedTotal += amt;
    });

    const hasEscrowBlocker = (escrowMatches || []).some(
      (m) =>
        (m.creator_id === exitUserId || m.opponent_id === exitUserId) &&
        ['OPEN', 'LOCKED', 'DISPUTED'].includes(m.status)
    );
    const hasBurnBlocker = (burnRequests || []).some(
      (b) => b.requester_id === exitUserId && b.status === 'PENDING'
    );

    return {
      member,
      bal,
      mintedTotal,
      tradeReceived,
      tradeSent,
      burnedTotal,
      hasEscrowBlocker,
      hasBurnBlocker,
      pkrSettlement: bal.ledger_balance * peg
    };
  }, [exitUserId, profilesById, balances, ledger, escrowMatches, burnRequests, peg]);

  const handleExecuteMemberExit = async (e) => {
    e.preventDefault();
    if (!exitStats) return;
    if (exitTypedName.trim() !== exitStats.member.full_name) {
      addToast(`Please type "${exitStats.member.full_name}" exactly to confirm.`, 'error');
      return;
    }
    setExiting(true);
    try {
      const res = await api.adminMemberExit(exitStats.member.id);
      if (!res.ok) {
        addToast(res.message || 'Member exit blocked', 'error');
      } else {
        setExitReceipt({
          memberName: exitStats.member.full_name,
          burned: res.burned,
          pkrSettlement: res.pkr_settlement,
          message: res.message
        });
        setExitConfirmOpen(false);
        setExitTypedName('');
        addToast(res.message, 'success');
        onRefresh?.();
      }
    } finally {
      setExiting(false);
    }
  };

  const handleRecordReconciliation = async (e) => {
    e.preventDefault();
    setSavingRec(true);
    try {
      const res = await api.adminRecordReconciliation(Number(bankBalanceInput || 0), recNote);
      if (!res.ok) addToast(res.message || 'Failed to record reconciliation', 'error');
      else {
        addToast(res.message, 'success');
        setRecNote('');
        onRefresh?.();
      }
    } finally {
      setSavingRec(false);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await api.adminUpdateSettings({
        groupName,
        monthlyContribution: Number(monthlyContrib),
        burnApprovalsRequired: Number(approvalsReq),
        rolloverMode,
        reversalWindowHours: Number(reversalHours),
        inviteCode
      });
      if (!res.ok) addToast(res.message || 'Failed to update settings', 'error');
      else {
        addToast('Settings saved!', 'success');
        onRefresh?.();
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRunMonthEndSettlement = async () => {
    setRunningSettlement(true);
    try {
      const res = await api.adminRunSettlement(getCurrentMonthTag());
      if (!res.ok) addToast(res.message || 'Settlement failed', 'error');
      else {
        setSettlementResult(res);
        addToast(res.message, 'success');
        onRefresh?.();
      }
    } finally {
      setRunningSettlement(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. PENDING DEPOSITS */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">
            Pending Deposit Claims ({pendingClaims.length})
          </h3>
          <Badge variant="info">Verify & Mint VGC</Badge>
        </div>

        {pendingClaims.length === 0 ? (
          <EmptyState title="No pending deposit claims" description="All member deposit claims have been verified." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingClaims.map((c) => {
              const member = profilesById[c.user_id];
              return (
                <div
                  key={c.id}
                  className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-bold text-white">{member?.full_name || 'Member'}</div>
                      <div className="text-xs text-slate-400">
                        Month: <strong className="text-slate-200">{c.month_tag}</strong> • Ref:{' '}
                        <span className="font-mono">{c.reference_no}</span>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-sm font-bold text-emerald-400">+{formatVGC(c.amount)}</div>
                      <div className="text-[11px] text-slate-400">+{formatPKR(c.amount, peg)}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenReceipt(c.receipt_url)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                      <span>Preview Receipt</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmMintClaim(c)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve & Mint VGC</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setRejectTarget({ type: 'deposit', item: c });
                        setRejectReason('');
                      }}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-200 text-xs font-medium rounded-lg flex items-center gap-1"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. BURN CONSENSUS */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">
            Pending Burn Consensus ({pendingBurns.length})
          </h3>
          <Badge variant="warning">Admin Signature Required</Badge>
        </div>

        {pendingBurns.length === 0 ? (
          <EmptyState title="No pending burn requests" description="Open cash-out and group-expense burns will appear here." />
        ) : (
          <div className="space-y-3">
            {pendingBurns.map((b) => {
              const requester = profilesById[b.requester_id];
              const alreadyApproved = (b.approvals || []).includes(currentUser.id);
              const isSelf = b.requester_id === currentUser.id;
              return (
                <div
                  key={b.id}
                  className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">
                        {requester?.full_name || 'Member'}
                      </span>
                      <Badge variant="purple">{b.kind}</Badge>
                      <span className="text-xs text-slate-400">
                        {(b.approvals || []).length}/{settings?.burn_approvals_required || 2} approvals
                      </span>
                    </div>
                    <div className="text-xs text-slate-300">{b.reason}</div>
                    <div className="text-xs font-mono text-amber-300">
                      Burn {formatVGC(b.amount)} → Pay {formatPKR(b.amount, peg)} to {requester?.full_name}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!isSelf && !alreadyApproved && (
                      <button
                        type="button"
                        onClick={() => handleApproveBurnAdmin(b.id)}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg"
                      >
                        Approve (Admin Signature)
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setRejectTarget({ type: 'burn', item: b });
                        setRejectReason('');
                      }}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-200 text-xs font-medium rounded-lg"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. ESCROW DISPUTES */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Swords className="w-4 h-4 text-rose-400" />
            <span>Escrow Disputes ({disputedMatches.length})</span>
          </h3>
        </div>

        {disputedMatches.length === 0 ? (
          <EmptyState title="Zero disputed matches" description="Conflicting 1v1 match reports will appear here for arbitration." />
        ) : (
          <div className="space-y-3">
            {disputedMatches.map((m) => {
              const c = profilesById[m.creator_id];
              const o = profilesById[m.opponent_id];
              return (
                <div
                  key={m.id}
                  className="p-4 rounded-xl bg-slate-950 border border-rose-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-sm font-bold text-white">
                      {m.title} — Pot: {formatVGC(Number(m.wager_amount) * 2)}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {c?.full_name} reported {profilesById[m.creator_report]?.full_name || '?'} •{' '}
                      {o?.full_name} reported {profilesById[m.opponent_report]?.full_name || '?'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleResolveDispute(m.id, m.creator_id)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg"
                    >
                      Award {c?.full_name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveDispute(m.id, m.opponent_id)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg"
                    >
                      Award {o?.full_name}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. CLEAN MEMBER EXIT CALCULATOR */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <UserMinus className="w-4 h-4 text-amber-400" />
            <span>Clean Member Exit Calculator</span>
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-300">Select Active Member</label>
            <select
              value={exitUserId}
              onChange={(e) => setExitUserId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white outline-none focus:border-emerald-500"
            >
              {activeMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} ({m.role})
                </option>
              ))}
            </select>

            {exitStats && (
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Minted:</span>
                  <span className="font-mono text-emerald-400">+{formatVGC(exitStats.mintedTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Trades Received / Sent:</span>
                  <span className="font-mono text-slate-200">
                    +{formatVGC(exitStats.tradeReceived, false)} / -{formatVGC(exitStats.tradeSent, false)} VGC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Locked Escrow / Pending Burn:</span>
                  <span className="font-mono text-amber-300">
                    {formatVGC(exitStats.bal.locked_in_escrow, false)} / {formatVGC(exitStats.bal.reserved_for_burn, false)} VGC
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-800 flex justify-between text-sm font-bold">
                  <span className="text-white">Exact Cash Settlement:</span>
                  <span className="font-mono text-emerald-400">
                    {formatPKR(exitStats.bal.ledger_balance, peg)} ({formatVGC(exitStats.bal.ledger_balance)})
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col justify-between p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            {exitStats?.hasEscrowBlocker || exitStats?.hasBurnBlocker ? (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
                Cannot exit yet: Member has an active escrow match or pending burn request. Resolve those first so locked/reserved funds are 0.
              </div>
            ) : (
              <div className="text-xs text-slate-400">
                Exiting burns 100% of the member&apos;s balance via a single <code className="text-amber-300">MEMBER_EXIT</code> BURN row, sets their profile inactive, and preserves historic ledger integrity.
              </div>
            )}

            {exitReceipt && (
              <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-200 font-mono">
                Receipt: {exitReceipt.message}
              </div>
            )}

            <button
              type="button"
              disabled={!exitStats || exitStats.hasEscrowBlocker || exitStats.hasBurnBlocker}
              onClick={() => {
                setExitTypedName('');
                setExitConfirmOpen(true);
              }}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-semibold rounded-xl text-xs sm:text-sm"
            >
              Settle & Exit {exitStats?.member?.full_name || 'Member'}
            </button>
          </div>
        </div>
      </div>

      {/* 5. FUND RECONCILIATION & 6. SETTINGS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Scale className="w-4 h-4 text-sky-400" />
            <span>Real-World Bank Reconciliation</span>
          </h3>

          <form onSubmit={handleRecordReconciliation} className="space-y-3">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs flex justify-between">
              <span className="text-slate-400">Expected Vault Cash (PKR):</span>
              <span className="font-mono font-bold text-emerald-400">
                PKR {new Intl.NumberFormat('en-PK').format(summary?.fund_cash_pkr || 0)}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Actual Bank / EasyPaisa Balance (PKR)
              </label>
              <input
                type="text"
                inputMode="numeric"
                required
                value={bankBalanceInput}
                onChange={(e) => setBankBalanceInput(e.target.value.replace(/[^0-9]/g, ''))}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Audit Note</label>
              <input
                type="text"
                value={recNote}
                onChange={(e) => setRecNote(e.target.value)}
                placeholder="e.g. Verified Meezan / EasyPaisa statement"
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={savingRec}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2"
            >
              {savingRec && <Spinner />}
              <span>Record Reconciliation</span>
            </button>
          </form>

          {reconciliations?.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-800">
              <div className="text-xs font-medium text-slate-400">Recent Reconciliations</div>
              {reconciliations.slice(0, 3).map((r) => (
                <div key={r.id} className="flex justify-between text-xs font-mono bg-slate-950 px-3 py-1.5 rounded-lg">
                  <span className="text-slate-300">Bank: PKR {r.bank_balance_pkr}</span>
                  <span className={Number(r.variance_pkr) === 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    Var: PKR {r.variance_pkr}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SETTINGS */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Settings className="w-4 h-4 text-emerald-400" />
            <span>Committee Treasury Settings</span>
          </h3>

          <form onSubmit={handleSaveSettings} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Monthly Contribution (VGC)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={monthlyContrib}
                  onChange={(e) => setMonthlyContrib(sanitizeIntegerInput(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Burn Approvals Req.</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={approvalsReq}
                  onChange={(e) => setApprovalsReq(sanitizeIntegerInput(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Rollover Mode</label>
                <select
                  value={rolloverMode}
                  onChange={(e) => setRolloverMode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white"
                >
                  <option value="CONTINUOUS">CONTINUOUS (Default)</option>
                  <option value="MONTHLY_RESET">MONTHLY_RESET</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Signup Invite Code</label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-emerald-500/40 rounded-xl text-xs font-mono text-emerald-300"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2"
            >
              {savingSettings && <Spinner />}
              <span>Save Committee Settings</span>
            </button>
          </form>

          {/* MONTH-END SETTLEMENT (ONLY VISIBLE IN MONTHLY_RESET MODE) */}
          {settings?.rollover_mode === 'MONTHLY_RESET' && (
            <div className="pt-3 border-t border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                  <CalendarCheck2 className="w-4 h-4" />
                  <span>Month-End Settlement Tool</span>
                </span>
                <Badge variant="warning">MONTHLY_RESET Active</Badge>
              </div>
              <div className="text-xs text-slate-400">
                Burns every active member&apos;s available VGC balance and generates a PKR payout table.
              </div>
              <button
                type="button"
                disabled={runningSettlement}
                onClick={handleRunMonthEndSettlement}
                className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2"
              >
                {runningSettlement && <Spinner />}
                <span>Run Month-End Settlement ({getCurrentMonthTag()})</span>
              </button>
              {settlementResult?.payouts && (
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                  {settlementResult.payouts.map((p) => (
                    <div key={p.user_id} className="flex justify-between font-mono">
                      <span>{p.full_name}</span>
                      <span className="text-emerald-400">PKR {p.pkr_payout} ({p.burned_vgc} VGC)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 7. AUDIT LOG */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-emerald-400" />
          <span>Admin Audit Log (Last 50 Actions)</span>
        </h3>
        {!auditLog || auditLog.length === 0 ? (
          <EmptyState title="No audit log entries" description="Admin actions are recorded here automatically." />
        ) : (
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {auditLog.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800/80 text-xs"
              >
                <div>
                  <span className="font-mono font-semibold text-emerald-300">{a.action}</span>{' '}
                  <span className="text-slate-400">
                    by {profilesById[a.actor_id]?.full_name || 'Admin'}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500">{formatRelativeTime(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RECEIPT PREVIEW MODAL */}
      <Modal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} title="Deposit Receipt Verification">
        <div className="flex flex-col items-center space-y-3">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Deposit Receipt"
              className="max-h-[65vh] w-auto rounded-xl border border-slate-700"
            />
          ) : (
            <div className="text-xs text-slate-400 py-8">Receipt preview unavailable.</div>
          )}
        </div>
      </Modal>

      {/* CONFIRM MINT MODAL */}
      <Modal
        isOpen={Boolean(confirmMintClaim)}
        onClose={() => setConfirmMintClaim(null)}
        title="Confirm Deposit & Mint VGC"
      >
        {confirmMintClaim && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-1.5">
              <div className="text-slate-300">
                Member: <strong className="text-white">{profilesById[confirmMintClaim.user_id]?.full_name}</strong>
              </div>
              <div className="text-slate-300">
                Month: <strong className="text-white">{confirmMintClaim.month_tag}</strong>
              </div>
              <div className="text-base font-mono font-bold text-emerald-300 pt-1">
                +{formatVGC(confirmMintClaim.amount)}, +{formatPKR(confirmMintClaim.amount, peg)} to fund
              </div>
            </div>
            <button
              type="button"
              disabled={minting}
              onClick={handleConfirmApproveMint}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
            >
              {minting && <Spinner />}
              <span>Confirm & Mint +{formatVGC(confirmMintClaim.amount)}</span>
            </button>
          </div>
        )}
      </Modal>

      {/* REJECT MODAL */}
      <Modal
        isOpen={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title={`Reject ${rejectTarget?.type === 'deposit' ? 'Deposit Claim' : 'Burn Request'}`}
      >
        <form onSubmit={handleConfirmReject} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Reason for Rejection</label>
            <input
              type="text"
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Unclear screenshot or reference mismatch"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white outline-none focus:border-rose-500"
            />
          </div>
          <button
            type="submit"
            disabled={rejecting || !rejectReason.trim()}
            className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
          >
            {rejecting && <Spinner />}
            <span>Confirm Rejection</span>
          </button>
        </form>
      </Modal>

      {/* CONFIRM MEMBER EXIT MODAL */}
      <Modal
        isOpen={exitConfirmOpen}
        onClose={() => setExitConfirmOpen(false)}
        title="Confirm Clean Member Exit"
      >
        {exitStats && (
          <form onSubmit={handleExecuteMemberExit} className="space-y-4">
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 space-y-1">
              <div>
                This will burn <strong>{formatVGC(exitStats.bal.ledger_balance)}</strong> and deactivate{' '}
                <strong>{exitStats.member.full_name}</strong>.
              </div>
              <div className="font-mono font-bold text-sm text-white pt-1">
                Cash to transfer: {formatPKR(exitStats.bal.ledger_balance, peg)}
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Type <strong>{exitStats.member.full_name}</strong> to confirm:
              </label>
              <input
                type="text"
                required
                value={exitTypedName}
                onChange={(e) => setExitTypedName(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
              />
            </div>
            <button
              type="submit"
              disabled={exiting || exitTypedName.trim() !== exitStats.member.full_name}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
            >
              {exiting && <Spinner />}
              <span>Execute Member Exit & Burn Balance</span>
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
