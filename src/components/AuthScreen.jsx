import React, { useState } from 'react';
import { ShieldCheck, KeyRound, Lock, Mail, User, Ticket } from 'lucide-react';
import { api } from '../lib/supabase.js';
import { Modal, PinInput, Spinner, useToast } from './ui.jsx';

export function AuthScreen({ onAuthenticated }) {
  const [tab, setTab] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('ali@vagacoin.pk');
  const [password, setPassword] = useState('demo1234');
  const [fullName, setFullName] = useState('');
  const [inviteCode, setInviteCode] = useState('VAGA2026');
  const [loading, setLoading] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (tab === 'login') {
        const res = await api.signIn(email, password);
        if (!res.ok) {
          addToast(res.message || 'Sign in failed', 'error');
        } else {
          addToast('Signed in to Vagacoin Treasury', 'success');
          onAuthenticated?.();
        }
      } else {
        const res = await api.signUp(email, password, fullName, inviteCode);
        if (!res.ok) {
          addToast(res.message || 'Sign up failed', 'error');
        } else {
          addToast('Account created! Welcome to Vagacoin.', 'success');
          onAuthenticated?.();
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Vagacoin (VGC)</h1>
          <p className="text-xs text-slate-400 max-w-xs">
            Private, Fiat-Backed Digital Treasury & Append-Only Committee Ledger (1 VGC = 1 PKR)
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setTab('login')}
            className={`py-2 text-xs font-semibold rounded-lg transition-all ${
              tab === 'login' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => setTab('signup')}
            className={`py-2 text-xs font-semibold rounded-lg transition-all ${
              tab === 'signup' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Join with Invite Code
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {tab === 'signup' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Bilal Ahmed"
                    className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Committee Invite Code</label>
                <div className="relative">
                  <Ticket className="w-4 h-4 text-emerald-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    required
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="Enter group invite code (e.g. VAGA2026)"
                    className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950 border border-emerald-500/40 rounded-xl text-sm font-mono text-emerald-300 focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:border-emerald-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:border-emerald-500 outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-950/50"
          >
            {loading && <Spinner />}
            {tab === 'login' ? 'Access Treasury' : 'Create Member Account'}
          </button>
        </form>

        {api.mode === 'demo' && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 space-y-1">
            <div className="font-semibold">Demo Mode Ready</div>
            <div>Seeded emails: ali@vagacoin.pk, ayesha@vagacoin.pk, hamza@vagacoin.pk, fatima@vagacoin.pk, usman@vagacoin.pk (Invite code: VAGA2026, PIN: 1234).</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PinSetupModal({ isOpen, onComplete }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const { addToast } = useToast();

  const handleSave = async (e) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(pin)) {
      addToast('PIN must be 4 digits', 'error');
      return;
    }
    if (pin !== confirmPin) {
      addToast('PINs do not match', 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await api.setPin(pin, null);
      if (!res.ok) {
        addToast(res.message || 'Failed to set PIN', 'error');
      } else {
        addToast('Security PIN configured!', 'success');
        onComplete?.();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Set Your 4-Digit Security PIN">
      <form onSubmit={handleSave} className="space-y-5">
        <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-200">
          <KeyRound className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>Your 4-digit PIN authorizes all VGC transfers, split payments, and reversal approvals.</span>
        </div>
        <PinInput label="Choose 4-Digit PIN" value={pin} onChange={setPin} disabled={loading} />
        <PinInput label="Confirm 4-Digit PIN" value={confirmPin} onChange={setConfirmPin} disabled={loading} />
        <button
          type="submit"
          disabled={loading || pin.length !== 4 || confirmPin.length !== 4}
          className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2"
        >
          {loading && <Spinner />}
          Save Security PIN
        </button>
      </form>
    </Modal>
  );
}
