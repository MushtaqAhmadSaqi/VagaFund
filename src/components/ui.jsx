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
              className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-xl backdrop-blur-md transition-all ${
                isSuccess
                  ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-100'
                  : isError
                  ? 'bg-rose-950/95 border-rose-500/40 text-rose-100'
                  : 'bg-slate-900/95 border-slate-700 text-slate-100'
              }`}
            >
              {isSuccess ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : isError ? (
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              ) : (
                <Info className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 text-sm leading-snug">
                {t.title && <div className="font-semibold mb-0.5">{t.title}</div>}
                <div>{t.message}</div>
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="text-slate-400 hover:text-white p-0.5 rounded"
                aria-label="Close notification"
              >
                <X className="w-4 h-4" />
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
// ACCESSIBLE MODAL (Closes on Escape & Backdrop, traps focus)
// -----------------------------------------------------------------------------
export function Modal({ isOpen, onClose, title, children, maxWidth = 'max-w-md' }) {
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        className={`w-full ${maxWidth} bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/60">
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="p-5 overflow-y-auto space-y-4">{children}</div>
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
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 border border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
      <div className="w-11 h-11 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-400 mb-3">
        <Icon className="w-5 h-5" />
      </div>
      <h4 className="text-sm font-medium text-slate-200">{title}</h4>
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
      {label && <label className="block text-xs font-medium text-slate-300 mb-2">{label}</label>}
      <div className="flex items-center justify-center gap-3">
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
            className="w-12 h-13 text-center text-xl font-mono font-bold bg-slate-950 border border-slate-700 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 rounded-xl text-emerald-300 outline-none transition-all"
            placeholder="•"
          />
        ))}
      </div>
    </div>
  );
}
