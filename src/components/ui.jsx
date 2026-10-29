import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { X, CheckCircle2, AlertTriangle, Info, Loader2, Inbox } from 'lucide-react';

// -----------------------------------------------------------------------------
// TOAST SYSTEM
// -----------------------------------------------------------------------------
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', title = '') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type, title }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => {
          const isSuccess = t.type === 'success';
          const isError = t.type === 'error';
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-2xl border shadow-2xl backdrop-blur-md transition-all animate-fadeIn ${
                isSuccess
                  ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-100 shadow-emerald-950/40'
                  : isError
                  ? 'bg-rose-950/90 border-rose-500/40 text-rose-100 shadow-rose-950/40'
                  : 'bg-slate-900/90 border-slate-700/80 text-slate-100 shadow-slate-950/50'
              }`}
            >
              {isSuccess ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : isError ? (
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              ) : (
                <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 text-xs sm:text-sm leading-snug">
                {t.title && <div className="font-semibold mb-0.5">{t.title}</div>}
                <div>{t.message}</div>
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
                aria-label="Close notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { addToast: () => {} };
  }
  return ctx;
}

// -----------------------------------------------------------------------------
// AVATAR COMPONENT (Deterministic pleasing colors & initials)
// -----------------------------------------------------------------------------
const GRADIENT_PALETTES = [
  'from-emerald-500 to-teal-700 text-emerald-50',
  'from-teal-500 to-cyan-700 text-teal-50',
  'from-blue-500 to-indigo-700 text-blue-50',
  'from-indigo-500 to-purple-700 text-indigo-50',
  'from-purple-500 to-pink-700 text-purple-50',
  'from-amber-500 to-orange-700 text-amber-50',
  'from-rose-500 to-red-700 text-rose-50'
];

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getGradientIndex(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % GRADIENT_PALETTES.length;
}

export function Avatar({ name = '', id = '', size = 'md', className = '', showOnline = false }) {
  const initials = getInitials(name);
  const palette = GRADIENT_PALETTES[getGradientIndex(name || id || 'user')];

  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-xs font-semibold',
    lg: 'w-12 h-12 text-sm font-bold',
    xl: 'w-16 h-16 text-lg font-bold'
  };

  return (
    <div className="relative inline-flex shrink-0">
      <div
        className={`rounded-full bg-gradient-to-br ${palette} flex items-center justify-center font-mono select-none shadow-inner border border-white/10 ${
          sizeClasses[size] || sizeClasses.md
        } ${className}`}
        title={name}
      >
        {initials}
      </div>
      {showOnline && (
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900" />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// STAT CARD (Neo-fintech stat tile)
// -----------------------------------------------------------------------------
export function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  variant = 'default',
  trend,
  className = '',
  onClick
}) {
  const borderStyles = {
    default: 'border-slate-800/80 bg-slate-900/60 hover:border-slate-700',
    emerald: 'border-emerald-500/25 bg-emerald-950/20 hover:border-emerald-500/40',
    amber: 'border-amber-500/25 bg-amber-950/20 hover:border-amber-500/40',
    sky: 'border-sky-500/25 bg-sky-950/20 hover:border-sky-500/40',
    rose: 'border-rose-500/25 bg-rose-950/20 hover:border-rose-500/40'
  };

  const iconStyles = {
    default: 'text-slate-400 bg-slate-800/80',
    emerald: 'text-emerald-400 bg-emerald-500/15',
    amber: 'text-amber-400 bg-amber-500/15',
    sky: 'text-sky-400 bg-sky-500/15',
    rose: 'text-rose-400 bg-rose-500/15'
  };

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`rounded-2xl p-4 border backdrop-blur-sm transition-all duration-200 ${
        borderStyles[variant] || borderStyles.default
      } ${onClick ? 'cursor-pointer hover:-translate-y-0.5 shadow-lg' : ''} ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && (
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${iconStyles[variant] || iconStyles.default}`}>
              <Icon className="w-4 h-4" />
            </div>
          )}
          <span className="text-xs font-medium text-slate-400">{label}</span>
        </div>
        {trend && (
          <span className="text-[11px] font-medium font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
            {trend}
          </span>
        )}
      </div>

      <div className="mt-2.5">
        <div className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">{value}</div>
        {subValue && <div className="text-xs text-slate-400 font-mono mt-0.5">{subValue}</div>}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SEGMENTED CONTROL / TAB PILLS
// -----------------------------------------------------------------------------
export function SegmentedControl({ options = [], value, onChange, className = '', size = 'md' }) {
  const sizeClasses = {
    sm: 'text-xs py-1 px-2.5',
    md: 'text-xs sm:text-sm py-1.5 px-3.5'
  };

  return (
    <div className={`inline-flex items-center p-1 bg-slate-900/90 border border-slate-800 rounded-xl gap-1 ${className}`}>
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`flex items-center gap-1.5 font-medium rounded-lg transition-all ${
              sizeClasses[size] || sizeClasses.md
            } ${
              active
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5" />}
            <span>{opt.label}</span>
            {opt.badge !== undefined && (
              <span
                className={`text-[10px] font-bold font-mono px-1.5 py-0.2 rounded-full ${
                  active ? 'bg-emerald-950 text-emerald-200' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// QUICK AMOUNT PRESETS (Interactive chips for fast input)
// -----------------------------------------------------------------------------
export function AmountPresets({ presets = [50, 100, 250, 500, 1000], onSelect, maxAmount }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-slate-400 font-medium mr-1">Quick:</span>
      {presets.map((amt) => (
        <button
          key={amt}
          type="button"
          onClick={() => onSelect(String(amt))}
          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-emerald-600/30 hover:border-emerald-500/50 border border-slate-700/80 text-[11px] font-mono text-slate-200 hover:text-emerald-300 transition-all active:scale-95"
        >
          +{amt}
        </button>
      ))}
      {maxAmount !== undefined && Number(maxAmount) > 0 && (
        <button
          type="button"
          onClick={() => onSelect(String(Math.trunc(Number(maxAmount))))}
          className="px-2.5 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-600 hover:text-white border border-emerald-500/40 text-[11px] font-mono font-semibold text-emerald-300 transition-all active:scale-95"
        >
          Max ({Math.trunc(Number(maxAmount))})
        </button>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// ACCESSIBLE MODAL (Closes on Escape & Backdrop, traps focus)
// -----------------------------------------------------------------------------
export function Modal({ isOpen, onClose, title, subtitle, children, maxWidth = 'max-w-md' }) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      } else if (e.key === 'Tab' && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        className={`w-full ${maxWidth} bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col ring-1 ring-white/5 animate-scaleUp`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/90 bg-slate-900/90">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4">{children}</div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// BADGE
// -----------------------------------------------------------------------------
export function Badge({ variant = 'default', children, className = '' }) {
  const styles = {
    default: 'bg-slate-800 text-slate-300 border-slate-700',
    success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    danger: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    purple: 'bg-purple-500/15 text-purple-300 border-purple-500/30'
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
        styles[variant] || styles.default
      } ${className}`}
    >
      {children}
    </span>
  );
}

// -----------------------------------------------------------------------------
// PROGRESS BAR
// -----------------------------------------------------------------------------
export function ProgressBar({ value = 0, max = 100, label = '' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : 0;
  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>{label}</span>
          <span className="font-mono">{pct}%</span>
        </div>
      )}
      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SKELETON & EMPTY STATE & SPINNER
// -----------------------------------------------------------------------------
export function Skeleton({ className = 'h-16 w-full' }) {
  return <div className={`animate-pulse bg-slate-800/70 rounded-xl ${className}`} />;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 border border-dashed border-slate-800/90 rounded-2xl bg-slate-900/30">
      <div className="w-12 h-12 rounded-2xl bg-slate-800/80 flex items-center justify-center text-slate-400 mb-3 shadow-inner">
        <Icon className="w-6 h-6" />
      </div>
      <h4 className="text-sm font-semibold text-slate-200">{title}</h4>
      {description && <p className="text-xs text-slate-400 mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className = 'w-4 h-4' }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

// -----------------------------------------------------------------------------
// 4-DIGIT MASKED PIN INPUT
// -----------------------------------------------------------------------------
export function PinInput({ value = '', onChange, label = '4-Digit Security PIN', disabled = false }) {
  const digits = [0, 1, 2, 3].map((i) => value[i] || '');
  const inputsRef = useRef([]);

  const handleDigitChange = (index, raw) => {
    const clean = raw.replace(/[^0-9]/g, '').slice(-1);
    const nextArr = [...digits];
    nextArr[index] = clean;
    const nextPin = nextArr.join('');
    onChange(nextPin);
    if (clean && index < 3) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  return (
    <div>
      {label && (
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-slate-300">{label}</label>
          <span className="text-[11px] text-slate-500 font-mono">Demo: 1234</span>
        </div>
      )}
      <div className="flex items-center justify-center gap-2.5 sm:gap-3">
        {[0, 1, 2, 3].map((idx) => (
          <input
            key={idx}
            ref={(el) => {
              inputsRef.current[idx] = el;
            }}
            type="password"
            inputMode="numeric"
            maxLength={1}
            disabled={disabled}
            value={digits[idx]}
            onChange={(e) => handleDigitChange(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            className="w-12 h-14 sm:w-14 sm:h-16 text-center text-2xl font-mono font-bold bg-slate-950 border border-slate-700/90 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 rounded-2xl text-emerald-300 outline-none transition-all shadow-inner"
            placeholder="•"
          />
        ))}
      </div>
    </div>
  );
}
