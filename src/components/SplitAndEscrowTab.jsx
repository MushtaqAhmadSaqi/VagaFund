import React, { useState, useMemo } from 'react';
import {
  Users,
  Swords,
  Plus,
  Check,
  X,
  Trophy,
  AlertTriangle,
  Lock
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../lib/supabase.js';
import {
  formatVGC,
  formatPKR,
  sanitizeIntegerInput,
  parsePositiveInt,
  computeSplitShares,
  formatRelativeTime,
  PEG_PKR_PER_VGC
} from '../lib/format.js';
import { Modal, Badge, ProgressBar, PinInput, EmptyState, Spinner, useToast } from './ui.jsx';

const MATCH_SUGGESTIONS = ['Table Tennis Bo5', 'Chess Blitz', 'Carrom', 'FIFA 1v1', 'Padel Tiebreak'];

export default function SplitAndEscrowTab({
  currentUser,
  profiles,
  balances,
  splits,
  escrowMatches,
  settings,
  onRefresh
}) {
  const { addToast } = useToast();
  const peg = Number(settings?.peg || PEG_PKR_PER_VGC);
  const [subTab, setSubTab] = useState('splits'); // 'splits' | 'escrow'

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

  const myBalance = useMemo(
    () =>
      balances.find((b) => b.user_id === currentUser?.id) || {
        available_vgc_balance: 0,
        locked_in_escrow: 0,
        ledger_balance: 0
      },
    [balances, currentUser]
  );

  // New Split Modal State
  const [newSplitOpen, setNewSplitOpen] = useState(false);
  const [splitTitle, setSplitTitle] = useState('');
  const [splitTotal, setSplitTotal] = useState('');
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [includeCreator, setIncludeCreator] = useState(true);
  const [creatingSplit, setCreatingSplit] = useState(false);

  // Pay Split Share PIN Modal State
  const [payShareTarget, setPayShareTarget] = useState(null);
  const [payPin, setPayPin] = useState('');
  const [payingShare, setPayingShare] = useState(false);

  // New Escrow Match Modal State
  const [newMatchOpen, setNewMatchOpen] = useState(false);
  const [matchTitle, setMatchTitle] = useState('Table Tennis Bo5');
  const [matchWager, setMatchWager] = useState('');
  const [matchOpponentId, setMatchOpponentId] = useState('');
  const [creatingMatch, setCreatingMatch] = useState(false);
  const [busyMatchId, setBusyMatchId] = useState(null);

  const liveSharesPreview = useMemo(
    () => computeSplitShares(splitTotal, selectedFriends, currentUser?.id, includeCreator),
    [splitTotal, selectedFriends, currentUser, includeCreator]
  );

  const toggleFriendSelection = (fid) => {
    setSelectedFriends((prev) =>
      prev.includes(fid) ? prev.filter((x) => x !== fid) : [...prev, fid]
    );
  };

  const handleCreateSplit = async (e) => {
    e.preventDefault();
    const total = parsePositiveInt(splitTotal);
    if (!splitTitle.trim()) {
      addToast('Enter a title for the bill split.', 'error');
      return;
    }
    if (!total) {
      addToast('Enter a positive integer total.', 'error');
      return;
    }
    if (selectedFriends.length === 0) {
      addToast('Select at least one friend to split with.', 'error');
      return;
    }

    setCreatingSplit(true);
    try {
      const res = await api.createSplitRequest(splitTitle, total, selectedFriends, includeCreator);
      if (!res.ok) {
        addToast(res.message || 'Could not create split', 'error');
      } else {
        addToast(res.message || 'Split created!', 'success');
        setNewSplitOpen(false);
        onRefresh?.();
      }
    } finally {
      setCreatingSplit(false);
    }
  };

  const handlePayShare = async (e) => {
    e.preventDefault();
    if (!payShareTarget) return;
    if (payPin.length !== 4) {
      addToast('Enter your 4-digit security PIN.', 'error');
      return;
    }
    setPayingShare(true);
    try {
      const res = await api.paySplitShare(payShareTarget.participant.id, payPin);
      if (!res.ok) {
        addToast(res.message || 'Failed to pay share', 'error');
        setPayPin('');
      } else {
        addToast(res.message || 'Share paid!', 'success');
        setPayShareTarget(null);
        setPayPin('');
        onRefresh?.();
      }
    } finally {
      setPayingShare(false);
    }
  };

  const handleDeclineShare = async (participantId) => {
    const res = await api.declineSplitShare(participantId);
    if (!res.ok) addToast(res.message || 'Could not decline share', 'error');
    else {
      addToast('Split share declined.', 'info');
      onRefresh?.();
    }
  };

  const handleCancelSplit = async (splitId) => {
    const res = await api.cancelSplitRequest(splitId);
    if (!res.ok) addToast(res.message || 'Could not cancel split', 'error');
    else {
      addToast('Split cancelled.', 'info');
      onRefresh?.();
    }
  };

  const handleCreateMatch = async (e) => {
    e.preventDefault();
    const wager = parsePositiveInt(matchWager);
    if (!matchTitle.trim()) {
      addToast('Enter a match title.', 'error');
      return;
    }
    if (!wager) {
      addToast('Enter a positive integer wager.', 'error');
      return;
    }
    if (wager > myBalance.available_vgc_balance) {
      addToast('Wager exceeds your available VGC balance.', 'error');
      return;
    }
    if (!matchOpponentId) {
      addToast('Choose an opponent.', 'error');
      return;
    }

    setCreatingMatch(true);
    try {
      const res = await api.createEscrowMatch(matchTitle, wager, matchOpponentId);
      if (!res.ok) {
        addToast(res.message || 'Failed to create match', 'error');
      } else {
        addToast(res.message || 'Match created!', 'success');
        setNewMatchOpen(false);
        onRefresh?.();
      }
    } finally {
      setCreatingMatch(false);
    }
  };

  const handleAcceptMatch = async (matchId) => {
    setBusyMatchId(matchId);
    try {
      const res = await api.acceptEscrowMatch(matchId);
      if (!res.ok) addToast(res.message || 'Could not accept match', 'error');
      else {
        addToast(res.message || 'Match accepted!', 'success');
        onRefresh?.();
      }
    } finally {
      setBusyMatchId(null);
    }
  };

  const handleCancelMatch = async (matchId) => {
    setBusyMatchId(matchId);
    try {
      const res = await api.cancelEscrowMatch(matchId);
      if (!res.ok) addToast(res.message || 'Could not cancel match', 'error');
      else {
        addToast(res.message || 'Match cancellation updated.', 'info');
        onRefresh?.();
      }
    } finally {
      setBusyMatchId(null);
    }
  };

  const handleReportResult = async (matchId, winnerId) => {
    setBusyMatchId(matchId);
    try {
      const res = await api.reportEscrowResult(matchId, winnerId);
      if (!res.ok) {
        addToast(res.message || 'Could not report result', 'error');
      } else {
        if (res.settled && res.winner_id === currentUser?.id) {
          try {
            confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
          } catch {
            // ignore
          }
        }
        addToast(res.message || 'Result reported!', res.disputed ? 'error' : 'success');
        onRefresh?.();
      }
    } finally {
      setBusyMatchId(null);
    }
  };

  const owedToMeSplits = useMemo(
    () => (splits || []).filter((s) => s.creator_id === currentUser?.id),
    [splits, currentUser]
  );

  const iOweItems = useMemo(() => {
    const list = [];
    (splits || []).forEach((s) => {
      const myPart = (s.participants || []).find((pt) => pt.user_id === currentUser?.id);
      if (myPart) {
        list.push({ split: s, participant: myPart });
      }
    });
    return list;
  }, [splits, currentUser]);

  return (
    <div className="space-y-6">
      {/* SUB-TAB SWITCHER */}
      <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-900 border border-slate-800 rounded-2xl">
        <button
          type="button"
          onClick={() => setSubTab('splits')}
          className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            subTab === 'splits'
              ? 'bg-emerald-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Bill Splitter (Splitwise)</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('escrow')}
          className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            subTab === 'escrow'
              ? 'bg-emerald-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Swords className="w-4 h-4" />
          <span>1v1 Match Escrow</span>
        </button>
      </div>

      {subTab === 'splits' ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Split a Group Bill</h3>
              <p className="text-xs text-slate-400">
                Exact integer remainder math guarantees shares sum 100% to the bill total.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSplitTitle('');
                setSplitTotal('');
                setSelectedFriends(activeFriends.map((f) => f.id));
                setIncludeCreator(true);
                setNewSplitOpen(true);
              }}
              disabled={!currentUser?.is_active}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>New Split</span>
            </button>
          </div>

          {/* I OWE SECTION */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
            <h4 className="text-sm font-semibold text-slate-200">Shares I Owe</h4>
            {iOweItems.length === 0 ? (
              <EmptyState title="You don't owe any split shares" description="When friends include you in a bill split, it will show up here." />
            ) : (
              <div className="space-y-2.5">
                {iOweItems.map(({ split, participant }) => {
                  const creator = profilesById[split.creator_id];
                  const isPending = participant.status === 'PENDING' && split.status === 'OPEN';
                  return (
                    <div
                      key={participant.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-950/80 border border-slate-800"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">{split.title}</span>
                          <Badge
                            variant={
                              participant.status === 'PAID'
                                ? 'success'
                                : participant.status === 'PENDING'
                                ? 'warning'
                                : 'danger'
                            }
                          >
                            {participant.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-400">
                          Paid by <strong className="text-slate-200">{creator?.full_name || 'Member'}</strong> • Total bill:{' '}
                          <span className="font-mono">{formatVGC(split.total_amount)}</span> •{' '}
                          {formatRelativeTime(split.created_at)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isPending ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setPayShareTarget({ split, participant });
                                setPayPin('');
                              }}
                              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Pay {formatVGC(participant.share_amount)}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeclineShare(participant.id)}
                              className="px-2.5 py-2 bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-200 text-xs font-medium rounded-xl border border-slate-700"
                            >
                              Decline
                            </button>
                          </>
                        ) : (
                          <div className="text-sm font-mono font-bold text-slate-300">
                            {formatVGC(participant.share_amount)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* OWED TO ME SECTION */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
            <h4 className="text-sm font-semibold text-slate-200">Splits Owed to Me</h4>
            {owedToMeSplits.length === 0 ? (
              <EmptyState title="No splits created by you yet" description="Create a split when you pay for a group meal or outing." />
            ) : (
              <div className="space-y-3">
                {owedToMeSplits.map((split) => {
                  const parts = split.participants || [];
                  const totalCollectible = parts.reduce((acc, p) => acc + Number(p.share_amount), 0);
                  const paidSoFar = parts
                    .filter((p) => p.status === 'PAID')
                    .reduce((acc, p) => acc + Number(p.share_amount), 0);

                  return (
                    <div
                      key={split.id}
                      className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white">{split.title}</span>
                            <Badge
                              variant={
                                split.status === 'COMPLETED'
                                  ? 'success'
                                  : split.status === 'OPEN'
                                  ? 'info'
                                  : 'default'
                              }
                            >
                              {split.status}
                            </Badge>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            Total bill: <span className="font-mono text-slate-200">{formatVGC(split.total_amount)}</span> •{' '}
                            {split.include_creator ? 'Includes your share' : 'Friends only'}
                          </div>
                        </div>

                        {split.status === 'OPEN' && (
                          <button
                            type="button"
                            onClick={() => handleCancelSplit(split.id)}
                            className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                          >
                            Cancel Split
                          </button>
                        )}
                      </div>

                      <ProgressBar
                        value={paidSoFar}
                        max={totalCollectible || 1}
                        label={`Collected ${formatVGC(paidSoFar)} of ${formatVGC(totalCollectible)}`}
                      />

                      <div className="flex flex-wrap gap-2 pt-1">
                        {parts.map((pt) => {
                          const friend = profilesById[pt.user_id];
                          return (
                            <div
                              key={pt.id}
                              className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs flex items-center gap-2"
                            >
                              <span className="text-slate-200">{friend?.full_name || 'Member'}</span>
                              <span className="font-mono text-slate-400">{formatVGC(pt.share_amount)}</span>
                              <Badge
                                variant={
                                  pt.status === 'PAID'
                                    ? 'success'
                                    : pt.status === 'PENDING'
                                    ? 'warning'
                                    : 'danger'
                                }
                              >
                                {pt.status}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 1V1 MATCH ESCROW SUB-TAB */
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Swords className="w-4 h-4 text-emerald-400" />
                <span>1v1 Match Escrow Arena</span>
              </h3>
              <p className="text-xs text-slate-400">
                Locked stakes are immediately deducted from Available VGC ({formatVGC(myBalance.locked_in_escrow)} currently locked).
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setMatchTitle('Table Tennis Bo5');
                setMatchWager('');
                setMatchOpponentId(activeFriends[0]?.id || '');
                setNewMatchOpen(true);
              }}
              disabled={!currentUser?.is_active}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Create 1v1 Match</span>
            </button>
          </div>

          {escrowMatches.length === 0 ? (
            <EmptyState title="No escrow matches yet" description="Challenge a friend to Table Tennis, Chess, or Carrom with locked VGC stakes." />
          ) : (
            <div className="space-y-3">
              {escrowMatches.map((m) => {
                const creator = profilesById[m.creator_id];
                const opponent = profilesById[m.opponent_id];
                const winner = m.winner_id ? profilesById[m.winner_id] : null;
                const isPlayer = m.creator_id === currentUser?.id || m.opponent_id === currentUser?.id;
                const isOpponent = m.opponent_id === currentUser?.id;
                const myReport =
                  m.creator_id === currentUser?.id
                    ? m.creator_report
                    : m.opponent_id === currentUser?.id
                    ? m.opponent_report
                    : null;

                const steps = ['OPEN', 'LOCKED', m.status === 'DISPUTED' ? 'DISPUTED' : m.status === 'CANCELLED' ? 'CANCELLED' : 'SETTLED'];
                const currentStepIdx =
                  m.status === 'OPEN' ? 0 : m.status === 'LOCKED' ? 1 : 2;

                return (
                  <div
                    key={m.id}
                    className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3.5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold text-white">{m.title}</span>
                          <Badge
                            variant={
                              m.status === 'SETTLED'
                                ? 'success'
                                : m.status === 'LOCKED'
                                ? 'info'
                                : m.status === 'DISPUTED'
                                ? 'danger'
                                : m.status === 'OPEN'
                                ? 'warning'
                                : 'default'
                            }
                          >
                            {m.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          <strong className="text-slate-200">{creator?.full_name || 'Creator'}</strong> vs{' '}
                          <strong className="text-slate-200">{opponent?.full_name || 'Opponent'}</strong> •{' '}
                          {formatRelativeTime(m.created_at)}
                        </div>
                      </div>

                      <div className="text-left sm:text-right">
                        <div className="text-xs text-slate-400">Total Escrow Pot</div>
                        <div className="text-base font-mono font-bold text-emerald-400">
                          {formatVGC(Number(m.wager_amount) * 2)}{' '}
                          <span className="text-xs font-normal text-slate-400">
                            ({formatVGC(m.wager_amount)} each)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* STEPPER */}
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      {steps.map((st, idx) => {
                        const active = idx <= currentStepIdx;
                        return (
                          <div
                            key={st}
                            className={`text-center py-1 rounded-lg text-[11px] font-mono font-semibold border ${
                              active
                                ? st === 'DISPUTED'
                                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                                  : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                : 'bg-slate-950 border-slate-800 text-slate-500'
                            }`}
                          >
                            {idx + 1}. {st}
                          </div>
                        );
                      })}
                    </div>

                    {/* LOCKED STAKE STATUS */}
                    {['OPEN', 'LOCKED', 'DISPUTED'].includes(m.status) && (
                      <div className="flex flex-wrap items-center gap-3 text-xs bg-slate-950/80 border border-slate-800/80 rounded-xl px-3 py-2">
                        <span className="flex items-center gap-1 text-amber-300">
                          <Lock className="w-3.5 h-3.5" />
                          {creator?.full_name}: {formatVGC(m.wager_amount)} locked
                        </span>
                        <span className="text-slate-600">•</span>
                        <span className="flex items-center gap-1 text-amber-300">
                          <Lock className="w-3.5 h-3.5" />
                          {opponent?.full_name}:{' '}
                          {m.status === 'OPEN' ? 'Waiting to accept' : `${formatVGC(m.wager_amount)} locked`}
                        </span>
                      </div>
                    )}

                    {/* ACTION CONTROLS */}
                    {m.status === 'OPEN' && (
                      <div className="flex items-center gap-2">
                        {isOpponent && (
                          <button
                            type="button"
                            disabled={busyMatchId === m.id}
                            onClick={() => handleAcceptMatch(m.id)}
                            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5"
                          >
                            {busyMatchId === m.id && <Spinner />}
                            <span>Accept & Lock {formatVGC(m.wager_amount)}</span>
                          </button>
                        )}
                        {(isPlayer || currentUser?.role === 'admin') && (
                          <button
                            type="button"
                            disabled={busyMatchId === m.id}
                            onClick={() => handleCancelMatch(m.id)}
                            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl"
                          >
                            Cancel Challenge
                          </button>
                        )}
                      </div>
                    )}

                    {m.status === 'LOCKED' && isPlayer && (
                      <div className="space-y-2 pt-1">
                        <div className="text-xs text-slate-300">
                          {myReport ? (
                            <span>
                              You reported{' '}
                              <strong className="text-emerald-400">
                                {profilesById[myReport]?.full_name || 'Winner'}
                              </strong>{' '}
                              as winner. Waiting for opponent confirmation.
                            </span>
                          ) : (
                            <span>Report who won this match (matching reports settle automatically):</span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={busyMatchId === m.id}
                            onClick={() => handleReportResult(m.id, currentUser.id)}
                            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5"
                          >
                            <Trophy className="w-3.5 h-3.5" />
                            <span>I Won (+{formatVGC(m.wager_amount)})</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyMatchId === m.id}
                            onClick={() =>
                              handleReportResult(
                                m.id,
                                m.creator_id === currentUser.id ? m.opponent_id : m.creator_id
                              )
                            }
                            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700"
                          >
                            They Won
                          </button>
                          <button
                            type="button"
                            disabled={busyMatchId === m.id}
                            onClick={() => handleCancelMatch(m.id)}
                            className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 text-xs rounded-xl border border-slate-800"
                          >
                            Mutual Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {m.status === 'DISPUTED' && (
                      <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                        <span>
                          Disputed — conflicting reports submitted ({profilesById[m.creator_report]?.full_name || '?'} vs{' '}
                          {profilesById[m.opponent_report]?.full_name || '?'}). Admin will decide in the Admin Panel.
                        </span>
                      </div>
                    )}

                    {m.status === 'SETTLED' && winner && (
                      <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-xl">
                        <Trophy className="w-4 h-4 text-emerald-400" />
                        <span>
                          Winner: <strong>{winner.full_name}</strong> (+{formatVGC(m.wager_amount)} transferred)
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* NEW SPLIT MODAL */}
      <Modal isOpen={newSplitOpen} onClose={() => setNewSplitOpen(false)} title="Create Bill Split">
        <form onSubmit={handleCreateSplit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Expense Title</label>
            <input
              type="text"
              required
              value={splitTitle}
              onChange={(e) => setSplitTitle(e.target.value)}
              placeholder="e.g. Rooftop BBQ Dinner"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Total Bill Amount (VGC)</label>
            <input
              type="text"
              inputMode="numeric"
              required
              value={splitTotal}
              onChange={(e) => setSplitTotal(sanitizeIntegerInput(e.target.value))}
              placeholder="e.g. 3000"
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-base font-mono font-bold text-white outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300">Select Friends in Split</label>
              <label className="inline-flex items-center gap-1.5 text-xs text-emerald-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeCreator}
                  onChange={(e) => setIncludeCreator(e.target.checked)}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>Include me in the share</span>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {activeFriends.map((f) => {
                const checked = selectedFriends.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleFriendSelection(f.id)}
                    className={`p-2.5 rounded-xl border text-left text-xs font-medium flex items-center justify-between ${
                      checked
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <span className="truncate">{f.full_name}</span>
                    {checked && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {liveSharesPreview.length > 0 && (
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
              <div className="text-xs font-semibold text-slate-300">
                Exact Remainder Split Preview (Sum = {formatVGC(splitTotal)}):
              </div>
              {liveSharesPreview.map((s) => (
                <div key={s.userId} className="flex justify-between text-xs">
                  <span className="text-slate-400">
                    {s.isCreator ? `${currentUser?.full_name} (You — already paid)` : profilesById[s.userId]?.full_name}
                  </span>
                  <span className="font-mono font-semibold text-emerald-300">
                    {formatVGC(s.shareAmount)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            type="submit"
            disabled={creatingSplit || liveSharesPreview.length === 0}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
          >
            {creatingSplit && <Spinner />}
            <span>Create Split & Notify Friends</span>
          </button>
        </form>
      </Modal>

      {/* PAY SPLIT SHARE PIN MODAL */}
      <Modal
        isOpen={Boolean(payShareTarget)}
        onClose={() => setPayShareTarget(null)}
        title="Pay Bill Split Share"
      >
        {payShareTarget && (
          <form onSubmit={handlePayShare} className="space-y-4">
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
              <div className="text-slate-400">
                Bill: <strong className="text-white">{payShareTarget.split.title}</strong>
              </div>
              <div className="text-slate-400">
                Payee:{' '}
                <strong className="text-white">
                  {profilesById[payShareTarget.split.creator_id]?.full_name}
                </strong>
              </div>
              <div className="text-base font-mono font-bold text-emerald-400 pt-1">
                Your Share: {formatVGC(payShareTarget.participant.share_amount)} (≈{' '}
                {formatPKR(payShareTarget.participant.share_amount, peg)})
              </div>
            </div>

            <PinInput value={payPin} onChange={setPayPin} disabled={payingShare} />

            <button
              type="submit"
              disabled={payingShare || payPin.length !== 4}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
            >
              {payingShare && <Spinner />}
              <span>Authorize & Pay {formatVGC(payShareTarget.participant.share_amount)}</span>
            </button>
          </form>
        )}
      </Modal>

      {/* CREATE ESCROW MATCH MODAL */}
      <Modal isOpen={newMatchOpen} onClose={() => setNewMatchOpen(false)} title="Create 1v1 Escrow Match">
        <form onSubmit={handleCreateMatch} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Match Title</label>
            <input
              type="text"
              required
              value={matchTitle}
              onChange={(e) => setMatchTitle(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white outline-none focus:border-emerald-500"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {MATCH_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setMatchTitle(s)}
                  className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Select Opponent</label>
            <select
              value={matchOpponentId}
              onChange={(e) => setMatchOpponentId(e.target.value)}
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
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Wager Stake per Player (Available: {formatVGC(myBalance.available_vgc_balance)})
            </label>
            <input
              type="text"
              inputMode="numeric"
              required
              value={matchWager}
              onChange={(e) => setMatchWager(sanitizeIntegerInput(e.target.value))}
              placeholder="e.g. 500"
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-base font-mono font-bold text-white outline-none focus:border-emerald-500"
            />
            {matchWager && (
              <div className="text-[11px] text-emerald-400 mt-1 font-mono">
                Total Winner Pot: {formatVGC(Number(matchWager) * 2)} (Your {formatVGC(matchWager)} locks immediately)
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={
              creatingMatch ||
              !matchOpponentId ||
              !parsePositiveInt(matchWager) ||
              parsePositiveInt(matchWager) > myBalance.available_vgc_balance
            }
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
          >
            {creatingMatch && <Spinner />}
            <span>Lock Stake & Send Challenge</span>
          </button>
        </form>
      </Modal>
    </div>
  );
}
