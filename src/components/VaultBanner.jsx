import React, { useState, useEffect } from 'react';
import { Landmark, CheckCircle2, AlertOctagon, ChevronDown, ChevronUp, Coins, Flame, Sparkles, Scale } from 'lucide-react';
import { formatVGC, formatPKR, PEG_PKR_PER_VGC } from '../lib/format.js';

function useAnimatedNumber(targetValue, duration = 350) {
  const [display, setDisplay] = useState(targetValue);

  useEffect(() => {
    const startVal = Number(display) || 0;
    const endVal = Number(targetValue) || 0;
    if (startVal === endVal) return undefined;

    const startTime = performance.now();
    let rafId;

    const step = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const current = Math.round(startVal + (endVal - startVal) * progress);
      setDisplay(current);
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [targetValue]);

  return display;
}

export default function VaultBanner({ summary, peg = PEG_PKR_PER_VGC }) {
  const [collapsed, setCollapsed] = useState(false);

  const fundCashPkr = useAnimatedNumber(summary?.fund_cash_pkr ?? 0);
  const activeSupply = useAnimatedNumber(summary?.active_vgc_supply ?? 0);
  const totalMinted = useAnimatedNumber(summary?.total_minted ?? 0);
  const totalBurned = useAnimatedNumber(summary?.total_burned ?? 0);

  const isSynced = summary?.is_ledger_synced ?? true;
  const mismatchDiff = (Number(summary?.active_vgc_supply) || 0) - (Number(summary?.sum_of_user_balances) || 0);
  const hasReconciliation = summary?.bank_variance_pkr !== null && summary?.bank_variance_pkr !== undefined;
  const variance = Number(summary?.bank_variance_pkr || 0);

  return (
    <div className="bg-gradient-to-r from-slate-900 via-emerald-950/60 to-slate-900 border-b border-slate-800/90 sticky top-0 z-30 backdrop-blur-md">
      <div className="max-w-5xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  Vagafund Reserve Vault
                </span>
                <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                  (1 VGC = {peg} PKR)
                </span>
              </div>
              <div className="text-base sm:text-lg font-bold text-white font-mono">
                PKR {new Intl.NumberFormat('en-PK').format(fundCashPkr)}{' '}
                <span className="text-xs font-normal text-slate-400">
                  ({formatVGC(activeSupply)} active)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isSynced ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Ledger Synced: 0 Surplus</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/20 text-rose-300 border border-rose-500/40">
                <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
                <span>Ledger Mismatch: {mismatchDiff > 0 ? `+${mismatchDiff}` : mismatchDiff}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="sm:hidden p-1.5 rounded-lg bg-slate-800/80 text-slate-300 hover:text-white"
              aria-label="Toggle vault metrics"
            >
              {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className={`${collapsed ? 'hidden sm:grid' : 'grid'} grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3 pt-3 border-t border-slate-800/70`}>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Coins className="w-3.5 h-3.5 text-emerald-400" />
              <span>Active VGC Supply</span>
            </div>
            <div className="text-sm font-bold font-mono text-white mt-0.5">{formatVGC(activeSupply)}</div>
            <div className="text-[11px] text-slate-400">≈ {formatPKR(activeSupply, peg)}</div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-teal-400" />
              <span>Total Minted</span>
            </div>
            <div className="text-sm font-bold font-mono text-emerald-300 mt-0.5">+{formatVGC(totalMinted)}</div>
            <div className="text-[11px] text-slate-400">≈ {formatPKR(totalMinted, peg)}</div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <span>Total Burned</span>
            </div>
            <div className="text-sm font-bold font-mono text-amber-300 mt-0.5">-{formatVGC(totalBurned)}</div>
            <div className="text-[11px] text-slate-400">≈ {formatPKR(totalBurned, peg)}</div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Scale className="w-3.5 h-3.5 text-sky-400" />
              <span>Bank Reconciliation</span>
            </div>
            {hasReconciliation ? (
              <>
                <div className={`text-sm font-bold font-mono mt-0.5 ${variance === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {variance === 0 ? 'PKR 0 Variance' : `PKR ${variance > 0 ? '+' : ''}${variance}`}
                </div>
                <div className="text-[11px] text-slate-400">
                  Bank: PKR {new Intl.NumberFormat('en-PK').format(summary.last_bank_balance_pkr)}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-slate-400 mt-0.5">Not Recorded</div>
                <div className="text-[11px] text-slate-500">Admin can verify in panel</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
