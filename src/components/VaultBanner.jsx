import React, { useState, useEffect } from 'react';
import {
  Landmark,
  CheckCircle2,
  AlertOctagon,
  ChevronDown,
  ChevronUp,
  Coins,
  Flame,
  Sparkles,
  Scale,
  ShieldCheck,
  Info
} from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);

  const fundCashPkr = useAnimatedNumber(summary?.fund_cash_pkr ?? 0);
  const activeSupply = useAnimatedNumber(summary?.active_vgc_supply ?? 0);
  const totalMinted = useAnimatedNumber(summary?.total_minted ?? 0);
  const totalBurned = useAnimatedNumber(summary?.total_burned ?? 0);

  const isSynced = summary?.is_ledger_synced ?? true;
  const mismatchDiff = (Number(summary?.active_vgc_supply) || 0) - (Number(summary?.sum_of_user_balances) || 0);
  const hasReconciliation = summary?.bank_variance_pkr !== null && summary?.bank_variance_pkr !== undefined;
  const variance = Number(summary?.bank_variance_pkr || 0);

  return (
    <div className="bg-slate-900/80 backdrop-blur-md border-b border-slate-800/80 sticky top-0 z-30 transition-all">
      <div className="max-w-5xl mx-auto px-4 py-2 sm:py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* LEFT: Trust Indicator & Vault Reserves */}
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Landmark className="w-4 h-4" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900 pulse-glow" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Reserve Vault</span>
                </span>
                <span className="text-[10px] font-mono text-slate-400 hidden sm:inline px-1.5 py-0.2 rounded bg-slate-800/80">
                  1 VGC = {peg} PKR Pegged
                </span>
              </div>
              <div className="text-sm sm:text-base font-bold text-white font-mono flex items-center gap-1.5">
                <span>PKR {new Intl.NumberFormat('en-PK').format(fundCashPkr)}</span>
                <span className="text-xs font-normal text-slate-400">
                  ({formatVGC(activeSupply)} active)
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT: Sync status & Expand button */}
          <div className="flex items-center gap-2">
            {isSynced ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden xs:inline">100% Backed</span>
                <span className="xs:hidden">Synced</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/20 text-rose-300 border border-rose-500/40">
                <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
                <span>Mismatch ({mismatchDiff > 0 ? `+${mismatchDiff}` : mismatchDiff})</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="px-2.5 py-1 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 text-xs font-medium text-slate-300 hover:text-white flex items-center gap-1 transition-all"
              aria-label="Toggle reserve transparency details"
            >
              <span className="hidden sm:inline">{expanded ? 'Hide Details' : 'Inspect Audit'}</span>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* EXPANDABLE AUDIT DETAILS DRAWER */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-3 animate-fadeIn">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Info className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Committee Invariant: Every VGC in circulation is backed 1:1 by real fiat cash deposited in the committee pool.
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Coins className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Active VGC Supply</span>
                </div>
                <div className="text-base font-bold font-mono text-white mt-0.5">{formatVGC(activeSupply)}</div>
                <div className="text-[11px] text-slate-400 font-mono">≈ {formatPKR(activeSupply, peg)}</div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                  <span>Total Minted</span>
                </div>
                <div className="text-base font-bold font-mono text-emerald-300 mt-0.5">+{formatVGC(totalMinted)}</div>
                <div className="text-[11px] text-slate-400 font-mono">≈ {formatPKR(totalMinted, peg)}</div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span>Total Burned</span>
                </div>
                <div className="text-base font-bold font-mono text-amber-300 mt-0.5">-{formatVGC(totalBurned)}</div>
                <div className="text-[11px] text-slate-400 font-mono">≈ {formatPKR(totalBurned, peg)}</div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Scale className="w-3.5 h-3.5 text-sky-400" />
                  <span>Bank Reconciliation</span>
                </div>
                {hasReconciliation ? (
                  <>
                    <div className={`text-base font-bold font-mono mt-0.5 ${variance === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {variance === 0 ? '0 PKR Variance' : `PKR ${variance > 0 ? '+' : ''}${variance}`}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      Bank: PKR {new Intl.NumberFormat('en-PK').format(summary.last_bank_balance_pkr)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-semibold text-slate-400 mt-0.5">Not Recorded</div>
                    <div className="text-[11px] text-slate-500">Admin reconciles in panel</div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
