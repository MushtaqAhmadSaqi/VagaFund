import React, { useState, useMemo } from 'react';
import { Trophy, FileDown, ShieldCheck, Medal } from 'lucide-react';
import {
  formatVGC,
  formatPKR,
  getRecentMonthTags,
  formatMonthLabel,
  computeMonthlyRolloverForUser,
  PEG_PKR_PER_VGC
} from '../lib/format.js';
import { exportMonthlyStatement, exportGroupStatement } from '../lib/pdfExporter.js';
import { Badge, useToast } from './ui.jsx';

export default function LeaderboardTab({
  currentUser,
  profiles,
  balances,
  depositStatuses,
  summary,
  ledger,
  settings
}) {
  const { addToast } = useToast();
  const peg = Number(settings?.peg || PEG_PKR_PER_VGC);
  const recentMonths = useMemo(() => getRecentMonthTags(6, new Date()), []);
  const [statementMonth, setStatementMonth] = useState(recentMonths[0]);
  const [statementScope, setStatementScope] = useState('personal'); // 'personal' | 'group'

  const profilesById = useMemo(() => {
    const map = {};
    profiles.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [profiles]);

  const statusByUser = useMemo(() => {
    const map = {};
    (depositStatuses || []).forEach((s) => {
      map[s.user_id] = s.status;
    });
    return map;
  }, [depositStatuses]);

  const rankedBalances = useMemo(
    () =>
      [...(balances || [])].sort((a, b) => {
        if (b.ledger_balance !== a.ledger_balance) return b.ledger_balance - a.ledger_balance;
        return a.full_name.localeCompare(b.full_name);
      }),
    [balances]
  );

  const activeSupply = Number(summary?.active_vgc_supply || 0);
  const totalMinted = Number(summary?.total_minted || 0);
  const totalBurned = Number(summary?.total_burned || 0);
  const sumBalances = Number(summary?.sum_of_user_balances || 0);

  const handleDownloadPdf = () => {
    try {
      if (statementScope === 'group' && currentUser?.role === 'admin') {
        exportGroupStatement({
          monthTag: statementMonth,
          balances: rankedBalances,
          ledgerRows: ledger,
          profilesById,
          summary,
          groupName: settings?.group_name || 'Vagafund Committee',
          peg
        });
        addToast(`Downloaded whole-group statement for ${statementMonth}`, 'success');
      } else {
        const rollover = computeMonthlyRolloverForUser(currentUser?.id, ledger);
        const monthEntry = rollover.find((r) => r.monthTag === statementMonth);
        exportMonthlyStatement({
          monthTag: statementMonth,
          user: currentUser,
          ledgerRows: ledger,
          profilesById,
          openingBalance: monthEntry?.opening || 0,
          summary,
          groupName: settings?.group_name || 'Vagafund Committee',
          peg
        });
        addToast(`Downloaded personal statement for ${statementMonth}`, 'success');
      }
    } catch (err) {
      addToast(err?.message || 'PDF export failed', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* GOLDEN INVARIANT PROOF BANNER & PDF EXPORT */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4" />
            <span>Golden Invariant Mathematical Proof</span>
          </div>
          <div className="text-xs sm:text-sm font-mono text-slate-200">
            Σ balances = <strong className="text-emerald-400">{formatVGC(sumBalances)}</strong> = Minted (
            {formatVGC(totalMinted, false)}) − Burned ({formatVGC(totalBurned, false)}) = Active Supply (
            <strong className="text-white">{formatVGC(activeSupply)}</strong>)
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statementMonth}
            onChange={(e) => setStatementMonth(e.target.value)}
            className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 outline-none focus:border-emerald-500"
          >
            {recentMonths.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(m)} ({m})
              </option>
            ))}
          </select>

          {currentUser?.role === 'admin' && (
            <select
              value={statementScope}
              onChange={(e) => setStatementScope(e.target.value)}
              className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 outline-none focus:border-emerald-500"
            >
              <option value="personal">My Statement</option>
              <option value="group">Whole Group (Admin)</option>
            </select>
          )}

          <button
            type="button"
            onClick={handleDownloadPdf}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow"
          >
            <FileDown className="w-4 h-4" />
            <span>Download Monthly PDF Statement</span>
          </button>
        </div>
      </div>

      {/* LEADERBOARD LIST */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            <span>Committee Treasury Standings</span>
          </h3>
          <span className="text-xs text-slate-400">Current Month Deposit Status</span>
        </div>

        <div className="space-y-2.5">
          {rankedBalances.map((b, index) => {
            const rank = index + 1;
            const isMe = b.user_id === currentUser?.id;
            const sharePct =
              activeSupply > 0 ? ((b.ledger_balance / activeSupply) * 100).toFixed(1) : '0.0';
            const depStatus = statusByUser[b.user_id] || 'NOT_PAID';

            const medalStyle =
              rank === 1
                ? 'bg-amber-400/20 text-amber-300 border-amber-400/40'
                : rank === 2
                ? 'bg-slate-300/20 text-slate-200 border-slate-300/40'
                : rank === 3
                ? 'bg-amber-700/25 text-amber-400 border-amber-600/40'
                : 'bg-slate-800 text-slate-400 border-slate-700';

            return (
              <div
                key={b.user_id}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border transition-all ${
                  isMe
                    ? 'bg-emerald-950/30 border-emerald-500/40'
                    : 'bg-slate-950/70 border-slate-800/90'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center font-mono text-sm font-bold shrink-0 ${medalStyle}`}
                  >
                    {rank <= 3 ? <Medal className="w-4 h-4" /> : `#${rank}`}
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white">{b.full_name}</span>
                      {isMe && <Badge variant="success">You</Badge>}
                      {b.role === 'admin' && <Badge variant="info">Admin</Badge>}
                      {!b.is_active && <Badge variant="danger">Exited</Badge>}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
                      <span>Share of supply: <strong className="font-mono text-slate-200">{sharePct}%</strong></span>
                      <span>•</span>
                      <span>Available: <span className="font-mono text-emerald-300">{formatVGC(b.available_vgc_balance)}</span></span>
                      {b.locked_in_escrow > 0 && (
                        <span>• Locked: <span className="font-mono text-amber-300">{formatVGC(b.locked_in_escrow)}</span></span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4">
                  <div>
                    {depStatus === 'MINTED' && <Badge variant="success">MINTED</Badge>}
                    {depStatus === 'PENDING' && <Badge variant="warning">PENDING</Badge>}
                    {depStatus === 'NOT_PAID' && <Badge variant="danger">NOT PAID</Badge>}
                  </div>

                  <div className="text-right font-mono">
                    <div className="text-base font-bold text-white">
                      {formatVGC(b.ledger_balance)}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      ≈ {formatPKR(b.ledger_balance, peg)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
