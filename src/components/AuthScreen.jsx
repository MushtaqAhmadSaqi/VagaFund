import React, { useState } from 'react';
import { ShieldCheck, Lock, Mail, User, Ticket, Coins, ArrowRight } from 'lucide-react';
import { api } from '../lib/supabase.js';
import { Modal, PinInput, Spinner, useToast, Avatar } from './ui.jsx';

const DEMO_PRESETS = [
  { email: 'ali@vagacoin.pk', name: 'Ali Khan', role: 'admin' },
  { email: 'ayesha@vagacoin.pk', name: 'Ayesha Malik', role: 'member' },
  { email: 'hamza@vagacoin.pk', name: 'Hamza Tariq', role: 'member' }
];

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
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-6 relative z-10 backdrop-blur-xl ring-1 ring-white/5">
        <div className="flex flex-col items-center text-center space-y-2.5">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-0.5 shadow-xl shadow-emerald-950/60">
            <div className="w-full h-full bg-slate-950 rounded-[22px] flex items-center justify-center text-emerald-400">
              <Coins className="w-8 h-8" />
            </div>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">Vagacoin (VGC)</h1>
          <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
            Private, Fiat-Backed Digital Treasury & Append-Only Committee Ledger (1 VGC = 1 PKR)
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 rounded-2xl border border-slate-800">
          <button
            type="button"
            onClick={() => setTab('login')}
            className={`py-2 text-xs font-semibold rounded-xl transition-all ${
              tab === 'login' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => setTab('signup')}
            className={`py-2 text-xs font-semibold rounded-xl transition-all ${
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
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Full Name</label>
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
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Committee Invite Code</label>
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
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Email Address</label>
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
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
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
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white font-bold rounded-2xl text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-950/60"
          >
            {loading && <Spinner />}
            <span>{tab === 'login' ? 'Access Treasury' : 'Create Member Account'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {api.mode === 'demo' && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 space-y-2">
            <div className="font-semibold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>One-Click Demo Profiles:</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 pt-0.5">
              {DEMO_PRESETS.map((p) => (
                <button
                  key={p.email}
                  type="button"
                  onClick={() => {
                    setEmail(p.email);
                    setPassword('demo1234');
                  }}
                  className={`p-2 rounded-xl border text-center transition-all ${
                    email === p.email
                      ? 'bg-amber-500/20 border-amber-400 text-amber-100 font-semibold shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="truncate text-[11px] font-medium">{p.name.split(' ')[0]}</div>
                  <div className="text-[10px] text-amber-400/80 capitalize">{p.role}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PinSetupModal({ isOpen, onComplete }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const handleSavePin = async (e) => {
    e.preventDefault();
    if (pin.length !== 4) {
      addToast('PIN must be exactly 4 digits.', 'error');
      return;
    }
    if (pin !== confirmPin) {
      addToast('PINs do not match.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await api.setSecurityPin(pin);
      if (!res.ok) {
        addToast(res.message || 'Failed to set PIN', 'error');
      } else {
        addToast('Security PIN created! Remember this for authorizing trades.', 'success');
        onComplete?.();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={null}
      title="Create Your 4-Digit Security PIN"
      subtitle="Required to authorize peer-to-peer transfers and splits"
    >
      <form onSubmit={handleSavePin} className="space-y-5">
        <PinInput value={pin} onChange={setPin} label="Enter 4-Digit PIN" disabled={saving} />

        <PinInput
          value={confirmPin}
          onChange={setConfirmPin}
          label="Confirm 4-Digit PIN"
          disabled={saving}
        />

        <button
          type="submit"
          disabled={saving || pin.length !== 4 || pin !== confirmPin}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/60 transition-all active:scale-95"
        >
          {saving && <Spinner />}
          <span>Save PIN & Continue</span>
        </button>
      </form>
    </Modal>
  );
}
