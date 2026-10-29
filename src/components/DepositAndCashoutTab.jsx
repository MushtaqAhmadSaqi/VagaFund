import React, { useState, useMemo, useEffect } from 'react';
import {
  Upload,
  Flame,
  FileCheck2,
  CheckCircle2,
  XCircle,
  Clock
} from 'lucide-react';
import { api } from '../lib/supabase.js';
import { compressReceipt } from '../lib/imageCompressor.js';
import {
  formatVGC,
  formatPKR,
  sanitizeIntegerInput,
  parsePositiveInt,
  getRecentMonthTags,
  formatMonthLabel,
  formatRelativeTime,
  PEG_PKR_PER_VGC
} from '../lib/format.js';
import { Badge, ProgressBar, EmptyState, Spinner, useToast } from './ui.jsx';

export default function DepositAndCashoutTab({
  currentUser,
  profiles,
  balances,
  ledger,
  depositClaims,
  burnRequests,
  settings,
  onRefresh
}) {
  const { addToast } = useToast();
  const peg = Number(settings?.peg || PEG_PKR_PER_VGC);
  const fixedContribution = Number(settings?.monthly_contribution || 2000);
  const approvalsRequired = Number(settings?.burn_approvals_required || 2);

  const recentMonths = useMemo(() => getRecentMonthTags(3, new Date()), []);

  const profilesById = useMemo(() => {
    const map = {};
    profiles.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [profiles]);

  const myBalance = useMemo(
    () =>
      balances.find((b) => b.user_id === currentUser?.id) || {
        available_vgc_balance: 0,
        reserved_for_burn: 0,
        ledger_balance: 0
      },
    [balances, currentUser]
  );

  // Month status map for current user
  const myMonthStatuses = useMemo(() => {
    const statusMap = {};
    recentMonths.forEach((m) => {
      const minted = ledger.some(
        (tx) => tx.tx_kind === 'MINT' && tx.receiver_id === currentUser?.id && tx.month_tag === m
      );
      const pending = depositClaims.some(
        (c) => c.user_id === currentUser?.id && c.month_tag === m && c.status === 'PENDING'
      );
      statusMap[m] = minted ? 'MINTED' : pending ? 'PENDING' : 'OPEN';
    });
    return statusMap;
  }, [recentMonths, ledger, depositClaims, currentUser]);

  const firstOpenMonth = useMemo(
    () => recentMonths.find((m) => myMonthStatuses[m] === 'OPEN') || recentMonths[0],
    [recentMonths, myMonthStatuses]
  );

  const [selectedMonth, setSelectedMonth] = useState(firstOpenMonth);
  const [referenceNo, setReferenceNo] = useState('');
  const [compressedInfo, setCompressedInfo] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const [submittingClaim, setSubmittingClaim] = useState(false);

  // Burn Request State
  const [burnKind, setBurnKind] = useState('CASHOUT'); // 'CASHOUT' | 'GROUP_EXPENSE'
  const [burnAmount, setBurnAmount] = useState('');
  const [burnReason, setBurnReason] = useState('');
  const [submittingBurn, setSubmittingBurn] = useState(false);
  const [busyBurnId, setBusyBurnId] = useState(null);

  useEffect(() => {
    setSelectedMonth(firstOpenMonth);
  }, [firstOpenMonth]);

  useEffect(() => {
    return () => {
      if (compressedInfo?.revokePreview) {
        compressedInfo.revokePreview();
      }
    };
  }, [compressedInfo]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (compressedInfo?.revokePreview) compressedInfo.revokePreview();
    setCompressing(true);
    try {
      const info = await compressReceipt(file);
      setCompressedInfo(info);
      addToast(
        `Receipt compressed to ${(info.compressedSize / 1024).toFixed(1)} KB WebP`,
        'success'
      );
    } catch (err) {
      addToast(err?.message || 'Failed to compress image', 'error');
      setCompressedInfo(null);
    } finally {
      setCompressing(false);
    }
  };

  const handleSubmitClaim = async (e) => {
    e.preventDefault();
    if (myMonthStatuses[selectedMonth] !== 'OPEN') {
      addToast(`Month ${selectedMonth} is already ${myMonthStatuses[selectedMonth]}.`, 'error');
      return;
    }
    if (!referenceNo.trim()) {
      addToast('Enter your bank / EasyPaisa reference number.', 'error');
      return;
    }
    if (!compressedInfo?.file) {
      addToast('Please upload a payment receipt screenshot.', 'error');
      return;
    }

    setSubmittingClaim(true);
    try {
      const path = await api.uploadReceipt(compressedInfo.file);
      const res = await api.submitDepositClaim(
        selectedMonth,
        fixedContribution,
        path,
        referenceNo.trim()
      );
      if (!res.ok) {
        addToast(res.message || 'Deposit claim failed', 'error');
      } else {
        addToast(res.message || 'Deposit claim submitted!', 'success');
        setReferenceNo('');
        if (compressedInfo.revokePreview) compressedInfo.revokePreview();
        setCompressedInfo(null);
        onRefresh?.();
      }
    } catch (err) {
      addToast(err?.message || 'Failed to upload receipt', 'error');
    } finally {
      setSubmittingClaim(false);
    }
  };

  const handleCreateBurn = async (e) => {
    e.preventDefault();
    const amt = parsePositiveInt(burnAmount);
    if (!amt) {
      addToast('Enter a positive integer VGC amount.', 'error');
      return;
    }
    if (amt > myBalance.available_vgc_balance) {
      addToast(`Amount exceeds available VGC (${formatVGC(myBalance.available_vgc_balance)}).`, 'error');
      return;
    }
    if (!burnReason.trim()) {
      addToast('Provide a reason for the burn request.', 'error');
      return;
    }

    setSubmittingBurn(true);
    try {
      const res = await api.createBurnRequest(amt, burnReason.trim(), burnKind);
      if (!res.ok) {
        addToast(res.message || 'Could not create burn request', 'error');
      } else {
        addToast(res.message || 'Burn request submitted!', 'success');
        setBurnAmount('');
        setBurnReason('');
        onRefresh?.();
      }
    } finally {
      setSubmittingBurn(false);
    }
  };

  const handleApproveBurn = async (burnId) => {
    setBusyBurnId(burnId);
    try {
      const res = await api.approveAndExecuteBurn(burnId);
      if (!res.ok) {
        addToast(res.message || 'Could not approve burn', 'error');
      } else {
        addToast(res.message || 'Burn approval recorded!', 'success');
        onRefresh?.();
      }
    } finally {
      setBusyBurnId(null);
    }
  };

  const handleCancelBurn = async (burnId) => {
    setBusyBurnId(burnId);
    try {
      const res = await api.cancelBurnRequest(burnId);
      if (!res.ok) addToast(res.message || 'Could not cancel burn', 'error');
      else {
        addToast('Burn request cancelled.', 'info');
        onRefresh?.();
      }
    } finally {
      setBusyBurnId(null);
    }
  };

  const myClaims = useMemo(
    () => (depositClaims || []).filter((c) => c.user_id === currentUser?.id),
    [depositClaims, currentUser]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* LEFT COLUMN: MONTHLY DEPOSIT CLAIM */}
      <div className="space-y-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-emerald-400" />
              <span>Submit Monthly Deposit Claim</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Deposit real PKR into the committee bank/EasyPaisa account, then upload your receipt to mint VGC.
            </p>
          </div>

          <form onSubmit={handleSubmitClaim} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Select Contribution Month
              </label>
              <div className="grid grid-cols-3 gap-2">
                {recentMonths.map((m) => {
                  const st = myMonthStatuses[m];
                  const isDisabled = st !== 'OPEN';
                  const isSelected = selectedMonth === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => setSelectedMonth(m)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        isSelected && !isDisabled
                          ? 'bg-emerald-600/20 border-emerald-500 text-white'
                          : isDisabled
                          ? 'bg-slate-950/50 border-slate-800/60 text-slate-500 cursor-not-allowed'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-xs font-semibold">{formatMonthLabel(m)}</div>
                      <div className="mt-1">
                        {st === 'MINTED' && <Badge variant="success">MINTED</Badge>}
                        {st === 'PENDING' && <Badge variant="warning">PENDING</Badge>}
                        {st === 'OPEN' && <Badge variant="default">UNPAID</Badge>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Fixed Monthly Contribution (Locked)
              </label>
              <div className="px-3.5 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between">
                <span className="font-mono font-bold text-emerald-400">
                  {formatVGC(fixedContribution)}
                </span>
                <span className="text-xs font-mono text-slate-400">
                  = {formatPKR(fixedContribution, peg)}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Bank / EasyPaisa Reference Number
              </label>
              <input
                type="text"
                required
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="e.g. EP-202610-94821"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Receipt Image (Auto-compressed to ≤ 50KB WebP)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-3.5 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-emerald-600/20 file:text-emerald-300 hover:file:bg-emerald-600/30"
              />

              {compressing && (
                <div className="flex items-center gap-2 text-xs text-emerald-400 mt-2">
                  <Spinner />
                  <span>Compressing receipt to ≤ 50KB WebP...</span>
                </div>
              )}

              {compressedInfo && (
                <div className="mt-3 p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-3">
                  <img
                    src={compressedInfo.previewUrl}
                    alt="Receipt preview"
                    className="w-16 h-16 object-cover rounded-lg border border-slate-700"
                  />
                  <div className="text-xs space-y-1">
                    <div className="font-semibold text-emerald-300 flex items-center gap-1">
                      <FileCheck2 className="w-3.5 h-3.5" />
                      <span>WebP Ready for Upload</span>
                    </div>
                    <div className="text-slate-400 font-mono">
                      Before: {(compressedInfo.originalSize / 1024).toFixed(1)} KB → After:{' '}
                      <strong className="text-white">
                        {(compressedInfo.compressedSize / 1024).toFixed(1)} KB
                      </strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={
                submittingClaim ||
                compressing ||
                myMonthStatuses[selectedMonth] !== 'OPEN' ||
                !referenceNo.trim() ||
                !compressedInfo
              }
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
            >
              {submittingClaim && <Spinner />}
              <span>Submit Deposit Claim ({formatVGC(fixedContribution)})</span>
            </button>
          </form>
        </div>

        {/* MY DEPOSIT CLAIMS HISTORY */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h4 className="text-sm font-semibold text-slate-200">My Deposit Claim History</h4>
          {myClaims.length === 0 ? (
            <EmptyState title="No deposit claims yet" description="Your monthly deposit claims and verification statuses will appear here." />
          ) : (
            <div className="space-y-2.5">
              {myClaims.map((c) => (
                <div
                  key={c.id}
                  className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        {formatMonthLabel(c.month_tag)} ({c.month_tag})
                      </span>
                      <Badge
                        variant={
                          c.status === 'APPROVED'
                            ? 'success'
                            : c.status === 'PENDING'
                            ? 'warning'
                            : 'danger'
                        }
                      >
                        {c.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-400 font-mono">Ref: {c.reference_no}</div>
                    {c.review_note && (
                      <div className="text-xs text-slate-300">Note: {c.review_note}</div>
                    )}
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-sm font-bold text-emerald-400">{formatVGC(c.amount)}</div>
                    <div className="text-[11px] text-slate-500">{formatRelativeTime(c.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: CASH-OUT / GROUP EXPENSE BURN */}
      <div className="space-y-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400" />
              <span>Request Cash-Out / Group Expense Burn</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Burning VGC reserves your tokens immediately and pays out real PKR from the Vagafund once{' '}
              {approvalsRequired} members (including 1 admin) approve.
            </p>
          </div>

          <form onSubmit={handleCreateBurn} className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBurnKind('CASHOUT')}
                className={`p-3 rounded-xl border text-left text-xs transition-all ${
                  burnKind === 'CASHOUT'
                    ? 'bg-amber-500/15 border-amber-500 text-amber-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <div className="font-semibold text-white">Personal Cash-Out</div>
                <div className="text-[11px] mt-0.5">Redeem your VGC for PKR transfer</div>
              </button>

              <button
                type="button"
                onClick={() => setBurnKind('GROUP_EXPENSE')}
                className={`p-3 rounded-xl border text-left text-xs transition-all ${
                  burnKind === 'GROUP_EXPENSE'
                    ? 'bg-amber-500/15 border-amber-500 text-amber-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <div className="font-semibold text-white">Group Expense Burn</div>
                <div className="text-[11px] mt-0.5">Burn pooled split VGC to pay vendor</div>
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Burn Amount (Available: {formatVGC(myBalance.available_vgc_balance)})
              </label>
              <input
                type="text"
                inputMode="numeric"
                required
                value={burnAmount}
                onChange={(e) => setBurnAmount(sanitizeIntegerInput(e.target.value))}
                placeholder="e.g. 1000"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-base font-mono font-bold text-white outline-none focus:border-amber-500"
              />
              {burnAmount && (
                <div className="text-xs text-amber-300 font-mono mt-1">
                  PKR Payout from Vault: {formatPKR(burnAmount, peg)}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Reason / Payout Instructions
              </label>
              <input
                type="text"
                required
                value={burnReason}
                onChange={(e) => setBurnReason(e.target.value)}
                placeholder="e.g. EasyPaisa payout or Catering vendor bill"
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white outline-none focus:border-amber-500"
              />
            </div>

            <button
              type="submit"
              disabled={
                submittingBurn ||
                !parsePositiveInt(burnAmount) ||
                parsePositiveInt(burnAmount) > myBalance.available_vgc_balance ||
                !burnReason.trim()
              }
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
            >
              {submittingBurn && <Spinner />}
              <span>Reserve VGC & Request Burn</span>
            </button>
          </form>
        </div>

        {/* GROUP BURN CONSENSUS QUEUE */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-200">Burn Consensus Queue</h4>
            <span className="text-xs text-slate-400">
              Requires {approvalsRequired} approvals (incl. 1 Admin)
            </span>
          </div>

          {burnRequests.length === 0 ? (
            <EmptyState title="No burn requests" description="Cash-out and group-expense burns appear here for member consensus." />
          ) : (
            <div className="space-y-3">
              {burnRequests.map((b) => {
                const requester = profilesById[b.requester_id];
                const isMine = b.requester_id === currentUser?.id;
                const approvals = b.approvals || [];
                const hasApproved = approvals.includes(currentUser?.id);
                const approverNames = approvals
                  .map((uid) => profilesById[uid]?.full_name || 'Member')
                  .join(', ');

                return (
                  <div
                    key={b.id}
                    className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">
                            {requester?.full_name || 'Member'}
                          </span>
                          <Badge variant={b.kind === 'GROUP_EXPENSE' ? 'purple' : 'info'}>
                            {b.kind}
                          </Badge>
                          <Badge
                            variant={
                              b.status === 'APPROVED'
                                ? 'success'
                                : b.status === 'PENDING'
                                ? 'warning'
                                : 'danger'
                            }
                          >
                            {b.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-300 mt-1">{b.reason}</div>
                      </div>

                      <div className="text-right font-mono shrink-0">
                        <div className="text-sm font-bold text-amber-400">-{formatVGC(b.amount)}</div>
                        <div className="text-[11px] text-slate-400">
                          Payout: {formatPKR(b.amount, peg)}
                        </div>
                      </div>
                    </div>

                    <ProgressBar
                      value={approvals.length}
                      max={approvalsRequired}
                      label={`${approvals.length}/${approvalsRequired} approvals${
                        approverNames ? ` (${approverNames})` : ''
                      }`}
                    />

                    {b.status === 'PENDING' && (
                      <div className="flex items-center justify-end gap-2 pt-1">
                        {!isMine && !hasApproved && currentUser?.is_active && (
                          <button
                            type="button"
                            disabled={busyBurnId === b.id}
                            onClick={() => handleApproveBurn(b.id)}
                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1"
                          >
                            {busyBurnId === b.id && <Spinner />}
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Approve Burn</span>
                          </button>
                        )}
                        {hasApproved && (
                          <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> You approved
                          </span>
                        )}
                        {isMine && (
                          <button
                            type="button"
                            disabled={busyBurnId === b.id}
                            onClick={() => handleCancelBurn(b.id)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg flex items-center gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancel Request</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
