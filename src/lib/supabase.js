import { createClient } from '@supabase/supabase-js';
import { getCurrentMonthTag, getRecentMonthTags, PEG_PKR_PER_VGC, parsePositiveInt } from './format.js';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

const isPlaceholder = (val) =>
  !val ||
  val.includes('your-project') ||
  val.includes('YOUR_') ||
  val.includes('placeholder') ||
  val.includes('example.supabase.co');

const IS_LIVE_MODE = !isPlaceholder(rawUrl) && !isPlaceholder(rawKey);

const supabaseClient = IS_LIVE_MODE ? createClient(rawUrl, rawKey) : null;

const DEMO_STORAGE_KEY = 'vagacoin_demo_v1';
const demoListeners = new Set();
const authListeners = new Set();

function emitDemoChange() {
  demoListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  });
}

function emitAuthChange(session) {
  authListeners.forEach((fn) => {
    try {
      fn('TOKEN_REFRESHED', session);
    } catch (e) {
      console.error(e);
    }
  });
}

if (typeof window !== 'undefined' && !IS_LIVE_MODE) {
  window.addEventListener('storage', (e) => {
    if (e.key === DEMO_STORAGE_KEY) {
      emitDemoChange();
    }
  });
}

function generateSampleReceiptDataUrl(memberName, refNo, amount, monthTag) {
  if (typeof document === 'undefined') {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="100%" height="100%" fill="%23064e3b"/><text x="20" y="50" fill="%23ecfdf5" font-family="monospace" font-size="16">EasyPaisa Receipt</text></svg>';
  }
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 220;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#064e3b';
  ctx.fillRect(0, 0, 360, 220);
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, 340, 200);
  ctx.fillStyle = '#ecfdf5';
  ctx.font = 'bold 16px monospace';
  ctx.fillText('EASYPAISA / BANK TRANSFER RECEIPT', 22, 42);
  ctx.fillStyle = '#6ee7b7';
  ctx.font = '13px monospace';
  ctx.fillText(`Sender:    ${memberName}`, 22, 78);
  ctx.fillText(`Month:     ${monthTag}`, 22, 104);
  ctx.fillText(`Amount:    PKR ${amount}`, 22, 130);
  ctx.fillText(`Ref No:    ${refNo}`, 22, 156);
  ctx.fillStyle = '#34d399';
  ctx.fillText('Status:    PAID / VERIFIED SCREENSHOT', 22, 186);
  return canvas.toDataURL('image/webp', 0.8);
}

function createInitialDemoState() {
  const [m0, m1, m2] = getRecentMonthTags(3, new Date()); // m0 = current, m1 = prev, m2 = 2 months ago
  const now = Date.now();
  const isoAgo = (hoursAgo) => new Date(now - hoursAgo * 3600 * 1000).toISOString();

  const uAli = '11111111-1111-4111-8111-111111111111';
  const uAyesha = '22222222-2222-4222-8222-222222222222';
  const uHamza = '33333333-3333-4333-8333-333333333333';
  const uFatima = '44444444-4444-4444-8444-444444444444';
  const uUsman = '55555555-5555-4555-8555-555555555555';

  const profiles = [
    { id: uAli, email: 'ali@vagacoin.pk', full_name: 'Ali Raza', avatar_url: null, role: 'admin', is_active: true, created_at: isoAgo(1500) },
    { id: uAyesha, email: 'ayesha@vagacoin.pk', full_name: 'Ayesha Khan', avatar_url: null, role: 'member', is_active: true, created_at: isoAgo(1490) },
    { id: uHamza, email: 'hamza@vagacoin.pk', full_name: 'Hamza Sheikh', avatar_url: null, role: 'member', is_active: true, created_at: isoAgo(1480) },
    { id: uFatima, email: 'fatima@vagacoin.pk', full_name: 'Fatima Noor', avatar_url: null, role: 'member', is_active: true, created_at: isoAgo(1470) },
    { id: uUsman, email: 'usman@vagacoin.pk', full_name: 'Usman Tariq', avatar_url: null, role: 'member', is_active: true, created_at: isoAgo(1460) }
  ];

  const secrets = {};
  profiles.forEach((p) => {
    secrets[p.id] = {
      user_id: p.id,
      pin: '1234',
      failed_attempts: 0,
      locked_until: null
    };
  });

  const settings = {
    id: true,
    group_name: 'Vagafund Committee',
    currency: 'PKR',
    peg: PEG_PKR_PER_VGC,
    monthly_contribution: 2000,
    burn_approvals_required: 2,
    rollover_mode: 'CONTINUOUS',
    reversal_window_hours: 48,
    invite_code: 'VAGA2026',
    updated_at: isoAgo(240)
  };

  const claims = [];
  const ledger = [];

  // Mint previous two months (m2 and m1) for all 5 members (10 * 2,000 = 20,000 VGC)
  const allUsers = [uAli, uAyesha, uHamza, uFatima, uUsman];
  allUsers.forEach((uid, idx) => {
    const cId2 = `c0000000-0000-4000-8000-00000000010${idx}`;
    const txId2 = `a0000000-0000-4000-8000-00000000010${idx}`;
    claims.push({
      id: cId2,
      user_id: uid,
      amount: 2000,
      month_tag: m2,
      receipt_url: `${uid}/seed_${m2}.webp`,
      reference_no: `EP-${m2.replace('-', '')}-10${idx}`,
      status: 'APPROVED',
      reviewed_by: uAli,
      review_note: `Monthly Deposit ${m2}`,
      created_at: isoAgo(1350 - idx * 2),
      reviewed_at: isoAgo(1340 - idx * 2)
    });
    ledger.push({
      id: txId2,
      tx_kind: 'MINT',
      sender_id: null,
      receiver_id: uid,
      amount: 2000,
      month_tag: m2,
      note: `Monthly Deposit ${m2} (Ref: EP-${m2.replace('-', '')}-10${idx})`,
      ref_type: 'DEPOSIT_CLAIM',
      ref_id: cId2,
      idempotency_key: null,
      created_at: isoAgo(1340 - idx * 2)
    });

    const cId1 = `c0000000-0000-4000-8000-00000000020${idx}`;
    const txId1 = `a0000000-0000-4000-8000-00000000020${idx}`;
    claims.push({
      id: cId1,
      user_id: uid,
      amount: 2000,
      month_tag: m1,
      receipt_url: `${uid}/seed_${m1}.webp`,
      reference_no: `EP-${m1.replace('-', '')}-20${idx}`,
      status: 'APPROVED',
      reviewed_by: uAli,
      review_note: `Monthly Deposit ${m1}`,
      created_at: isoAgo(720 - idx * 2),
      reviewed_at: isoAgo(710 - idx * 2)
    });
    ledger.push({
      id: txId1,
      tx_kind: 'MINT',
      sender_id: null,
      receiver_id: uid,
      amount: 2000,
      month_tag: m1,
      note: `Monthly Deposit ${m1} (Ref: EP-${m1.replace('-', '')}-20${idx})`,
      ref_type: 'DEPOSIT_CLAIM',
      ref_id: cId1,
      idempotency_key: null,
      created_at: isoAgo(710 - idx * 2)
    });
  });

  // Current month (m0): MINTED for 3 members (Ali, Ayesha, Hamza), PENDING for 2 (Fatima, Usman)
  [uAli, uAyesha, uHamza].forEach((uid, idx) => {
    const cId0 = `c0000000-0000-4000-8000-00000000030${idx}`;
    const txId0 = `a0000000-0000-4000-8000-00000000030${idx}`;
    claims.push({
      id: cId0,
      user_id: uid,
      amount: 2000,
      month_tag: m0,
      receipt_url: `${uid}/seed_${m0}.webp`,
      reference_no: `EP-${m0.replace('-', '')}-30${idx}`,
      status: 'APPROVED',
      reviewed_by: uAli,
      review_note: `Monthly Deposit ${m0}`,
      created_at: isoAgo(96 - idx * 3),
      reviewed_at: isoAgo(90 - idx * 3)
    });
    ledger.push({
      id: txId0,
      tx_kind: 'MINT',
      sender_id: null,
      receiver_id: uid,
      amount: 2000,
      month_tag: m0,
      note: `Monthly Deposit ${m0} (Ref: EP-${m0.replace('-', '')}-30${idx})`,
      ref_type: 'DEPOSIT_CLAIM',
      ref_id: cId0,
      idempotency_key: null,
      created_at: isoAgo(90 - idx * 3)
    });
  });

  // Pending deposit claims for Fatima and Usman with generated canvas receipts
  const fatimaReceiptPath = `${uFatima}/seed_pending_${m0}.webp`;
  const usmanReceiptPath = `${uUsman}/seed_pending_${m0}.webp`;
  const receipts = {
    [fatimaReceiptPath]: generateSampleReceiptDataUrl('Fatima Noor', `EP-${m0.replace('-', '')}-401`, 2000, m0),
    [usmanReceiptPath]: generateSampleReceiptDataUrl('Usman Tariq', `EP-${m0.replace('-', '')}-402`, 2000, m0)
  };

  claims.push(
    {
      id: 'c0000000-0000-4000-8000-000000000401',
      user_id: uFatima,
      amount: 2000,
      month_tag: m0,
      receipt_url: fatimaReceiptPath,
      reference_no: `EP-${m0.replace('-', '')}-401`,
      status: 'PENDING',
      reviewed_by: null,
      review_note: null,
      created_at: isoAgo(14),
      reviewed_at: null
    },
    {
      id: 'c0000000-0000-4000-8000-000000000402',
      user_id: uUsman,
      amount: 2000,
      month_tag: m0,
      receipt_url: usmanReceiptPath,
      reference_no: `EP-${m0.replace('-', '')}-402`,
      status: 'PENDING',
      reviewed_by: null,
      review_note: null,
      created_at: isoAgo(9),
      reviewed_at: null
    }
  );

  // 8 realistic TRADE rows across months
  const trades = [
    { id: 'b0000000-0000-4000-8000-000000000001', sender_id: uHamza, receiver_id: uAli, amount: 350, note: 'Chai & samosa at Quetta Cafe', hoursAgo: 800 },
    { id: 'b0000000-0000-4000-8000-000000000002', sender_id: uUsman, receiver_id: uAyesha, amount: 500, note: 'Lost carrom game', hoursAgo: 620 },
    { id: 'b0000000-0000-4000-8000-000000000003', sender_id: uFatima, receiver_id: uAli, amount: 600, note: 'Biryani Friday split', hoursAgo: 400 },
    { id: 'b0000000-0000-4000-8000-000000000004', sender_id: uAli, receiver_id: uHamza, amount: 250, note: 'Padel court booking share', hoursAgo: 72 },
    { id: 'b0000000-0000-4000-8000-000000000005', sender_id: uAyesha, receiver_id: uFatima, amount: 400, note: 'Cold coffee & brownies', hoursAgo: 36 },
    { id: 'b0000000-0000-4000-8000-000000000006', sender_id: uHamza, receiver_id: uUsman, amount: 150, note: 'Parking & toll token', hoursAgo: 20 },
    { id: 'b0000000-0000-4000-8000-000000000007', sender_id: uAli, receiver_id: uAyesha, amount: 300, note: 'Dessert after dinner', hoursAgo: 12 },
    { id: 'b0000000-0000-4000-8000-000000000008', sender_id: uFatima, receiver_id: uHamza, amount: 600, note: 'Split: Rooftop BBQ Dinner', hoursAgo: 5, ref_type: 'SPLIT', ref_id: 'd0000000-0000-4000-8000-000000000001' }
  ];

  trades.forEach((t) => {
    ledger.push({
      id: t.id,
      tx_kind: 'TRADE',
      sender_id: t.sender_id,
      receiver_id: t.receiver_id,
      amount: t.amount,
      month_tag: null,
      note: t.note,
      ref_type: t.ref_type || 'P2P',
      ref_id: t.ref_id || null,
      idempotency_key: null,
      created_at: isoAgo(t.hoursAgo)
    });
  });

  // One open split (created by Hamza for 3000 across Hamza + Ali + Ayesha + Fatima + Usman = 600 each; Fatima paid, others pending)
  const splitId = 'd0000000-0000-4000-8000-000000000001';
  const splits = [
    {
      id: splitId,
      creator_id: uHamza,
      title: 'Rooftop BBQ Dinner',
      total_amount: 3000,
      include_creator: true,
      status: 'OPEN',
      created_at: isoAgo(8)
    }
  ];

  const participants = [
    { id: 'd1000000-0000-4000-8000-000000000001', split_id: splitId, user_id: uAli, share_amount: 600, status: 'PENDING', paid_tx_id: null, created_at: isoAgo(8) },
    { id: 'd1000000-0000-4000-8000-000000000002', split_id: splitId, user_id: uAyesha, share_amount: 600, status: 'PENDING', paid_tx_id: null, created_at: isoAgo(8) },
    { id: 'd1000000-0000-4000-8000-000000000003', split_id: splitId, user_id: uFatima, share_amount: 600, status: 'PAID', paid_tx_id: 'b0000000-0000-4000-8000-000000000008', created_at: isoAgo(8) },
    { id: 'd1000000-0000-4000-8000-000000000004', split_id: splitId, user_id: uUsman, share_amount: 600, status: 'PENDING', paid_tx_id: null, created_at: isoAgo(8) }
  ];

  // Escrow matches: one OPEN ("Table Tennis Bo5") and one LOCKED ("Chess Blitz")
  const matches = [
    {
      id: 'e0000000-0000-4000-8000-000000000001',
      creator_id: uAli,
      opponent_id: uHamza,
      wager_amount: 400,
      title: 'Table Tennis Bo5',
      status: 'OPEN',
      winner_id: null,
      creator_report: null,
      opponent_report: null,
      creator_cancel: false,
      opponent_cancel: false,
      settled_tx_id: null,
      created_at: isoAgo(6)
    },
    {
      id: 'e0000000-0000-4000-8000-000000000002',
      creator_id: uAyesha,
      opponent_id: uUsman,
      wager_amount: 500,
      title: 'Chess Blitz',
      status: 'LOCKED',
      winner_id: null,
      creator_report: null,
      opponent_report: null,
      creator_cancel: false,
      opponent_cancel: false,
      settled_tx_id: null,
      created_at: isoAgo(4)
    }
  ];

  // One pending burn with 1/2 approvals (requested by Ayesha, approved by Hamza, waiting for Admin Ali)
  const burns = [
    {
      id: 'f0000000-0000-4000-8000-000000000001',
      requester_id: uAyesha,
      amount: 1000,
      reason: 'Committee snacks & beverages reimbursement',
      kind: 'GROUP_EXPENSE',
      approvals: [uHamza],
      status: 'PENDING',
      review_note: null,
      executed_tx_id: null,
      created_at: isoAgo(3)
    }
  ];

  // One pending payment request (Usman requesting 250 VGC from Ali)
  const requests = [
    {
      id: '90000000-0000-4000-8000-000000000001',
      kind: 'REQUEST',
      requester_id: uUsman,
      payer_id: uAli,
      amount: 250,
      note: 'Late night Kashmir chai share',
      related_tx_id: null,
      status: 'PENDING',
      response_tx_id: null,
      created_at: isoAgo(2)
    }
  ];

  // Reconciliations (synced with 26,000 PKR in bank)
  const reconciliations = [
    {
      id: '70000000-0000-4000-8000-000000000001',
      recorded_by: uAli,
      bank_balance_pkr: 26000,
      expected_pkr: 26000,
      variance_pkr: 0,
      note: 'Verified EasyPaisa committee wallet balance',
      created_at: isoAgo(1)
    }
  ];

  const notifications = [
    {
      id: '80000000-0000-4000-8000-000000000001',
      user_id: uAli,
      title: 'New Deposit Claim (' + m0 + ')',
      body: 'Fatima Noor submitted a deposit claim for 2,000 VGC.',
      kind: 'DEPOSIT',
      is_read: false,
      created_at: isoAgo(14)
    },
    {
      id: '80000000-0000-4000-8000-000000000002',
      user_id: uAli,
      title: 'Burn Consensus Needed (1,000 VGC)',
      body: 'Ayesha Khan requested a GROUP_EXPENSE burn of 1,000 VGC (1/2 approvals).',
      kind: 'BURN',
      is_read: false,
      created_at: isoAgo(3)
    },
    {
      id: '80000000-0000-4000-8000-000000000003',
      user_id: uAli,
      title: 'VGC Request from Usman Tariq',
      body: 'Usman Tariq requested 250 VGC: Late night Kashmir chai share',
      kind: 'REQUEST',
      is_read: false,
      created_at: isoAgo(2)
    }
  ];

  const auditLog = [
    {
      id: '60000000-0000-4000-8000-000000000001',
      actor_id: uAli,
      action: 'RECORD_RECONCILIATION',
      target_id: '70000000-0000-4000-8000-000000000001',
      details: { bank_balance_pkr: 26000, expected_pkr: 26000, variance_pkr: 0 },
      created_at: isoAgo(1)
    }
  ];

  const state = {
    settings,
    profiles,
    secrets,
    ledger,
    claims,
    burns,
    splits,
    participants,
    matches,
    requests,
    notifications,
    reconciliations,
    auditLog,
    receipts,
    currentUserId: uAli
  };

  assertGoldenInvariantDemo(state);
  return state;
}

function loadDemoState() {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.profiles) && Array.isArray(parsed.ledger)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to parse demo state, re-seeding:', e);
  }
  const fresh = createInitialDemoState();
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(fresh));
  } catch (e) {
    console.warn('LocalStorage write warning:', e);
  }
  return fresh;
}

function computeWalletBalancesFromState(state) {
  return state.profiles.map((p) => {
    let totalReceived = 0;
    let totalSent = 0;
    state.ledger.forEach((tx) => {
      const amt = Number(tx.amount) || 0;
      if ((tx.tx_kind === 'MINT' || tx.tx_kind === 'TRADE') && tx.receiver_id === p.id) {
        totalReceived += amt;
      }
      if ((tx.tx_kind === 'TRADE' || tx.tx_kind === 'BURN') && tx.sender_id === p.id) {
        totalSent += amt;
      }
    });

    let lockedInEscrow = 0;
    state.matches.forEach((m) => {
      const w = Number(m.wager_amount) || 0;
      if (['OPEN', 'LOCKED', 'DISPUTED'].includes(m.status) && m.creator_id === p.id) {
        lockedInEscrow += w;
      }
      if (['LOCKED', 'DISPUTED'].includes(m.status) && m.opponent_id === p.id) {
        lockedInEscrow += w;
      }
    });

    let reservedForBurn = 0;
    state.burns.forEach((b) => {
      if (b.status === 'PENDING' && b.requester_id === p.id) {
        reservedForBurn += Number(b.amount) || 0;
      }
    });

    const ledgerBalance = totalReceived - totalSent;
    const availableBalance = ledgerBalance - lockedInEscrow - reservedForBurn;

    return {
      user_id: p.id,
      full_name: p.full_name,
      role: p.role,
      is_active: p.is_active,
      total_received: totalReceived,
      total_sent: totalSent,
      ledger_balance: ledgerBalance,
      locked_in_escrow: lockedInEscrow,
      reserved_for_burn: reservedForBurn,
      available_vgc_balance: availableBalance
    };
  });
}

function computeVagafundSummaryFromState(state) {
  let totalMinted = 0;
  let totalBurned = 0;
  state.ledger.forEach((tx) => {
    const amt = Number(tx.amount) || 0;
    if (tx.tx_kind === 'MINT') totalMinted += amt;
    if (tx.tx_kind === 'BURN') totalBurned += amt;
  });

  const activeSupply = totalMinted - totalBurned;
  const balances = computeWalletBalancesFromState(state);
  const sumOfBalances = balances.reduce((acc, b) => acc + b.ledger_balance, 0);
  const minAvailable = balances.reduce((min, b) => Math.min(min, b.available_vgc_balance), 0);
  const minLedger = balances.reduce((min, b) => Math.min(min, b.ledger_balance), 0);

  const approvedClaimsVgc = state.claims
    .filter((c) => c.status === 'APPROVED')
    .reduce((acc, c) => acc + Number(c.amount || 0), 0);

  const peg = Number(state.settings?.peg || PEG_PKR_PER_VGC);
  const fundCashPkr = (approvedClaimsVgc - totalBurned) * peg;

  const sortedRecs = [...(state.reconciliations || [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const lastRec = sortedRecs[0] || null;
  const lastBankBalancePkr = lastRec ? Number(lastRec.bank_balance_pkr) : null;
  const bankVariancePkr = lastBankBalancePkr !== null ? lastBankBalancePkr - fundCashPkr : null;

  const isLedgerSynced = activeSupply === sumOfBalances && minAvailable >= 0 && minLedger >= 0;

  return {
    total_minted: totalMinted,
    total_burned: totalBurned,
    active_vgc_supply: activeSupply,
    sum_of_user_balances: sumOfBalances,
    fund_cash_pkr: fundCashPkr,
    last_bank_balance_pkr: lastBankBalancePkr,
    bank_variance_pkr: bankVariancePkr,
    is_ledger_synced: isLedgerSynced
  };
}

function assertGoldenInvariantDemo(state) {
  const summary = computeVagafundSummaryFromState(state);
  const balances = computeWalletBalancesFromState(state);

  if (summary.active_vgc_supply !== summary.sum_of_user_balances) {
    throw new Error(
      `GOLDEN_INVARIANT_VIOLATION: Supply (${summary.active_vgc_supply}) != Sum of user balances (${summary.sum_of_user_balances})`
    );
  }

  for (const b of balances) {
    if (b.ledger_balance < 0 || b.available_vgc_balance < 0) {
      throw new Error(
        `GOLDEN_INVARIANT_VIOLATION: Negative balance for ${b.full_name} (ledger=${b.ledger_balance}, available=${b.available_vgc_balance})`
      );
    }
  }
}

function runDemoTransaction(mutator) {
  const current = loadDemoState();
  const clone = JSON.parse(JSON.stringify(current));
  try {
    const result = mutator(clone);
    // Even if business logic returned { ok: false } (like wrong PIN counter increment),
    // verify the golden invariant still holds before committing state changes.
    assertGoldenInvariantDemo(clone);
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(clone));
    } catch (e) {
      console.warn('LocalStorage write warning:', e);
    }
    emitDemoChange();
    return result;
  } catch (err) {
    return {
      ok: false,
      error: 'INVARIANT_OR_TX_ERROR',
      message: err?.message || 'Transaction rolled back due to invariant violation.'
    };
  }
}

function verifyDemoPin(clone, userId, suppliedPin) {
  const sec = clone.secrets[userId];
  if (!sec || !sec.pin) {
    return { ok: false, error: 'PIN_NOT_SET', message: 'Please set up your 4-digit security PIN first.' };
  }
  if (sec.locked_until && new Date(sec.locked_until).getTime() > Date.now()) {
    const timeStr = new Date(sec.locked_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return {
      ok: false,
      error: 'PIN_LOCKED',
      locked_until: sec.locked_until,
      message: `PIN locked due to 5 wrong attempts. Try again after ${timeStr}.`
    };
  }
  if (String(suppliedPin ?? '') !== String(sec.pin)) {
    sec.failed_attempts = (sec.failed_attempts || 0) + 1;
    if (sec.failed_attempts >= 5) {
      sec.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      sec.failed_attempts = 0;
      return {
        ok: false,
        error: 'PIN_LOCKED',
        locked_until: sec.locked_until,
        message: 'Too many wrong PIN attempts! Locked for 15 minutes.'
      };
    }
    const rem = 5 - sec.failed_attempts;
    return {
      ok: false,
      error: 'INVALID_PIN',
      remaining_attempts: rem,
      message: `Incorrect PIN (${rem} attempt${rem === 1 ? '' : 's'} remaining before 15-min lockout).`
    };
  }

  sec.failed_attempts = 0;
  sec.locked_until = null;
  return { ok: true };
}

function makeUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// -----------------------------------------------------------------------------
// DEMO IMPLEMENTATION
// -----------------------------------------------------------------------------
const demoApi = {
  mode: 'demo',

  async getSession() {
    const st = loadDemoState();
    const user = st.profiles.find((p) => p.id === st.currentUserId) || null;
    if (!user) return { data: { session: null } };
    return {
      data: {
        session: {
          user: {
            id: user.id,
            email: user.email || `${user.full_name.toLowerCase().replace(/\s+/g, '.')}@vagacoin.pk`
          }
        }
      }
    };
  },

  onAuthChange(callback) {
    authListeners.add(callback);
    return () => authListeners.delete(callback);
  },

  async signIn(email, password) {
    if (!email || !password) {
      return { ok: false, error: 'INVALID_CREDENTIALS', message: 'Email and password are required.' };
    }
    return runDemoTransaction((clone) => {
      const normalized = email.trim().toLowerCase();
      const found =
        clone.profiles.find((p) => (p.email || '').toLowerCase() === normalized) ||
        clone.profiles.find((p) => p.full_name.toLowerCase().includes(normalized.split('@')[0]));
      if (!found) {
        return { ok: false, error: 'USER_NOT_FOUND', message: 'No member found with that email. Use Sign Up with invite code VAGA2026.' };
      }
      clone.currentUserId = found.id;
      setTimeout(() => emitAuthChange({ user: { id: found.id, email: found.email } }), 10);
      return { ok: true, user: found };
    });
  },

  async signUp(email, password, fullName, inviteCode) {
    return runDemoTransaction((clone) => {
      if (String(inviteCode ?? '').trim() !== clone.settings.invite_code) {
        return {
          ok: false,
          error: 'INVALID_INVITE_CODE',
          message: 'Invalid group invite code. Ask your committee admin for the invite code.'
        };
      }
      const cleanName = String(fullName ?? '').trim();
      if (cleanName.length < 2) {
        return { ok: false, error: 'INVALID_NAME', message: 'Full name must be at least 2 characters.' };
      }
      const id = makeUuid();
      const role = clone.profiles.length === 0 ? 'admin' : 'member';
      const newProfile = {
        id,
        email: String(email || `${cleanName.toLowerCase().replace(/\s+/g, '.')}@vagacoin.pk`).trim(),
        full_name: cleanName,
        avatar_url: null,
        role,
        is_active: true,
        created_at: new Date().toISOString()
      };
      clone.profiles.push(newProfile);
      clone.secrets[id] = { user_id: id, pin: null, failed_attempts: 0, locked_until: null };
      clone.currentUserId = id;
      setTimeout(() => emitAuthChange({ user: { id, email: newProfile.email } }), 10);
      return { ok: true, user: newProfile };
    });
  },

  async signOut() {
    return runDemoTransaction((clone) => {
      clone.currentUserId = null;
      setTimeout(() => emitAuthChange(null), 10);
      return { ok: true };
    });
  },

  async switchUser(userId) {
    return runDemoTransaction((clone) => {
      const target = clone.profiles.find((p) => p.id === userId);
      if (!target) {
        return { ok: false, error: 'NOT_FOUND', message: 'Profile not found.' };
      }
      clone.currentUserId = target.id;
      setTimeout(() => emitAuthChange({ user: { id: target.id, email: target.email } }), 10);
      return { ok: true, user: target };
    });
  },

  async resetDemo() {
    const fresh = createInitialDemoState();
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(fresh));
    } catch (e) {
      console.warn(e);
    }
    emitDemoChange();
    const admin = fresh.profiles[0];
    emitAuthChange({ user: { id: admin.id, email: admin.email } });
    return { ok: true, message: 'Demo data reset to factory seed state.' };
  },

  subscribe(onChange) {
    demoListeners.add(onChange);
    return () => demoListeners.delete(onChange);
  },

  async getProfile() {
    const st = loadDemoState();
    return st.profiles.find((p) => p.id === st.currentUserId) || null;
  },

  async listProfiles() {
    const st = loadDemoState();
    return [...st.profiles].sort((a, b) => a.full_name.localeCompare(b.full_name));
  },

  async getWalletBalances() {
    const st = loadDemoState();
    return computeWalletBalancesFromState(st);
  },

  async getVagafundSummary() {
    const st = loadDemoState();
    return computeVagafundSummaryFromState(st);
  },

  async getMonthlyDepositStatus() {
    const st = loadDemoState();
    const curMonth = getCurrentMonthTag();
    return st.profiles.map((p) => {
      const isMinted = st.ledger.some(
        (tx) => tx.tx_kind === 'MINT' && tx.receiver_id === p.id && tx.month_tag === curMonth
      );
      const isPending = st.claims.some(
        (c) => c.user_id === p.id && c.month_tag === curMonth && c.status === 'PENDING'
      );
      return {
        user_id: p.id,
        full_name: p.full_name,
        is_active: p.is_active,
        month_tag: curMonth,
        status: isMinted ? 'MINTED' : isPending ? 'PENDING' : 'NOT_PAID'
      };
    });
  },

  async listLedger({ limit = 100, userId = null } = {}) {
    const st = loadDemoState();
    let rows = [...st.ledger].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    if (userId) {
      rows = rows.filter((tx) => tx.sender_id === userId || tx.receiver_id === userId);
    }
    return rows.slice(0, limit);
  },

  async listDepositClaims() {
    const st = loadDemoState();
    const caller = st.profiles.find((p) => p.id === st.currentUserId);
    const rows = [...st.claims].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    if (caller?.role === 'admin') return rows;
    return rows.filter((c) => c.user_id === st.currentUserId);
  },

  async listBurnRequests() {
    const st = loadDemoState();
    return [...st.burns].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  },

  async listSplits() {
    const st = loadDemoState();
    const splits = [...st.splits].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return splits.map((s) => ({
      ...s,
      participants: st.participants.filter((pt) => pt.split_id === s.id)
    }));
  },

  async listEscrowMatches() {
    const st = loadDemoState();
    return [...st.matches].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  },

  async listPaymentRequests() {
    const st = loadDemoState();
    const caller = st.profiles.find((p) => p.id === st.currentUserId);
    const all = [...st.requests].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    if (caller?.role === 'admin') return all;
    return all.filter((r) => r.requester_id === st.currentUserId || r.payer_id === st.currentUserId);
  },

  async listNotifications() {
    const st = loadDemoState();
    return st.notifications
      .filter((n) => n.user_id === st.currentUserId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async getGroupSettings() {
    const st = loadDemoState();
    const caller = st.profiles.find((p) => p.id === st.currentUserId);
    const copy = { ...st.settings };
    if (caller?.role !== 'admin') {
      delete copy.invite_code;
    }
    return copy;
  },

  async listReconciliations() {
    const st = loadDemoState();
    return [...(st.reconciliations || [])].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  },

  async listAuditLog() {
    const st = loadDemoState();
    const caller = st.profiles.find((p) => p.id === st.currentUserId);
    if (caller?.role !== 'admin') return [];
    return [...(st.auditLog || [])]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50);
  },

  async uploadReceipt(file) {
    const st = loadDemoState();
    const uid = st.currentUserId;
    if (!uid) throw new Error('Not authenticated');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Failed to read receipt file'));
      reader.readAsDataURL(file);
    });
    const path = `${uid}/receipt_${Date.now()}.webp`;
    runDemoTransaction((clone) => {
      clone.receipts[path] = dataUrl;
      return { ok: true };
    });
    return path;
  },

  async getReceiptUrl(path) {
    const st = loadDemoState();
    if (st.receipts && st.receipts[path]) {
      return st.receipts[path];
    }
    return generateSampleReceiptDataUrl('Member', 'EP-VERIFIED', 2000, getCurrentMonthTag());
  },

  async hasPinSet() {
    const st = loadDemoState();
    const sec = st.secrets?.[st.currentUserId];
    return { ok: true, has_pin: Boolean(sec && sec.pin) };
  },

  async setPin(newPin, oldPin = null) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      if (!uid) return { ok: false, error: 'UNAUTHENTICATED', message: 'Not logged in.' };
      if (!/^\d{4}$/.test(String(newPin ?? ''))) {
        return { ok: false, error: 'INVALID_PIN_FORMAT', message: 'PIN must be exactly 4 digits.' };
      }
      const sec = clone.secrets[uid] || { user_id: uid, pin: null, failed_attempts: 0, locked_until: null };
      if (sec.pin) {
        const check = verifyDemoPin(clone, uid, oldPin);
        if (!check.ok) return check;
      }
      sec.pin = String(newPin);
      sec.failed_attempts = 0;
      sec.locked_until = null;
      clone.secrets[uid] = sec;
      return { ok: true, message: '4-digit security PIN saved.' };
    });
  },

  async tradeVagacoin(receiverId, amount, note, pin, idempotencyKey = null) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const sender = clone.profiles.find((p) => p.id === uid);
      const receiver = clone.profiles.find((p) => p.id === receiverId);
      if (!sender || !sender.is_active) {
        return { ok: false, error: 'INACTIVE_SENDER', message: 'Your account is inactive.' };
      }
      if (!receiver || !receiver.is_active || receiver.id === uid) {
        return { ok: false, error: 'INVALID_RECEIVER', message: 'Please select an active friend other than yourself.' };
      }
      const amt = parsePositiveInt(amount);
      if (!amt) {
        return { ok: false, error: 'INVALID_AMOUNT', message: 'Amount must be a positive integer.' };
      }

      if (idempotencyKey) {
        const existing = clone.ledger.find((t) => t.idempotency_key === idempotencyKey);
        if (existing) {
          return { ok: true, duplicate: true, tx_id: existing.id, message: 'Transfer already processed (duplicate tap ignored).' };
        }
      }

      const pinRes = verifyDemoPin(clone, uid, pin);
      if (!pinRes.ok) return pinRes;

      const bals = computeWalletBalancesFromState(clone);
      const myBal = bals.find((b) => b.user_id === uid);
      if (!myBal || myBal.available_vgc_balance < amt) {
        return {
          ok: false,
          error: 'INSUFFICIENT_BALANCE',
          message: `Insufficient available balance (Available: ${myBal?.available_vgc_balance ?? 0} VGC).`
        };
      }

      const txId = makeUuid();
      const cleanNote = String(note ?? '').trim() || 'P2P Transfer';
      clone.ledger.push({
        id: txId,
        tx_kind: 'TRADE',
        sender_id: uid,
        receiver_id: receiver.id,
        amount: amt,
        month_tag: null,
        note: cleanNote,
        ref_type: 'P2P',
        ref_id: null,
        idempotency_key: idempotencyKey || null,
        created_at: new Date().toISOString()
      });

      clone.notifications.push({
        id: makeUuid(),
        user_id: receiver.id,
        title: `Received ${amt} VGC`,
        body: `${sender.full_name} sent you ${amt} VGC (${cleanNote}).`,
        kind: 'TRADE',
        is_read: false,
        created_at: new Date().toISOString()
      });

      return { ok: true, duplicate: false, tx_id: txId, message: `Sent ${amt} VGC to ${receiver.full_name}!` };
    });
  },

  async createPaymentRequest(payerId, amount, note) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const requester = clone.profiles.find((p) => p.id === uid);
      const payer = clone.profiles.find((p) => p.id === payerId);
      const amt = parsePositiveInt(amount);
      if (!requester?.is_active || !payer?.is_active || payer.id === uid) {
        return { ok: false, error: 'INVALID_PAYER', message: 'Choose an active friend.' };
      }
      if (!amt) {
        return { ok: false, error: 'INVALID_AMOUNT', message: 'Enter a valid positive VGC amount.' };
      }
      const reqId = makeUuid();
      const cleanNote = String(note ?? '').trim() || 'Payment request';
      clone.requests.push({
        id: reqId,
        kind: 'REQUEST',
        requester_id: uid,
        payer_id: payer.id,
        amount: amt,
        note: cleanNote,
        related_tx_id: null,
        status: 'PENDING',
        response_tx_id: null,
        created_at: new Date().toISOString()
      });
      clone.notifications.push({
        id: makeUuid(),
        user_id: payer.id,
        title: `VGC Request from ${requester.full_name}`,
        body: `${requester.full_name} requested ${amt} VGC: ${cleanNote}`,
        kind: 'REQUEST',
        is_read: false,
        created_at: new Date().toISOString()
      });
      return { ok: true, request_id: reqId, message: `Requested ${amt} VGC from ${payer.full_name}.` };
    });
  },

  async requestReversal(txId, note) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const tx = clone.ledger.find((t) => t.id === txId);
      if (!tx || tx.tx_kind !== 'TRADE') {
        return { ok: false, error: 'TX_NOT_FOUND', message: 'Only TRADE rows can be reversed.' };
      }
      if (tx.sender_id !== uid) {
        return { ok: false, error: 'NOT_SENDER', message: 'Only the original sender can request a reversal.' };
      }
      const windowHours = Number(clone.settings.reversal_window_hours || 48);
      const ageHours = (Date.now() - new Date(tx.created_at).getTime()) / (3600 * 1000);
      if (ageHours > windowHours) {
        return { ok: false, error: 'WINDOW_EXPIRED', message: `Reversal window (${windowHours}h) has expired.` };
      }
      const existing = clone.requests.find(
        (r) => r.related_tx_id === txId && r.kind === 'REVERSAL' && ['PENDING', 'ACCEPTED'].includes(r.status)
      );
      if (existing) {
        return { ok: false, error: 'REVERSAL_EXISTS', message: 'A reversal request already exists for this trade.' };
      }

      const sender = clone.profiles.find((p) => p.id === uid);
      const reqId = makeUuid();
      const cleanNote = String(note ?? '').trim() || 'Wrong amount/recipient – please return';
      clone.requests.push({
        id: reqId,
        kind: 'REVERSAL',
        requester_id: uid,
        payer_id: tx.receiver_id,
        amount: Number(tx.amount),
        note: cleanNote,
        related_tx_id: txId,
        status: 'PENDING',
        response_tx_id: null,
        created_at: new Date().toISOString()
      });

      clone.notifications.push({
        id: makeUuid(),
        user_id: tx.receiver_id,
        title: `Reversal Request (${tx.amount} VGC)`,
        body: `${sender?.full_name || 'Member'} requested a reversal of ${tx.amount} VGC: ${cleanNote}`,
        kind: 'REVERSAL',
        is_read: false,
        created_at: new Date().toISOString()
      });

      return { ok: true, request_id: reqId, message: 'Reversal request sent to recipient.' };
    });
  },

  async respondPaymentRequest(requestId, accept, pin = null) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const req = clone.requests.find((r) => r.id === requestId);
      if (!req) return { ok: false, error: 'NOT_FOUND', message: 'Request not found.' };
      if (req.payer_id !== uid) return { ok: false, error: 'FORBIDDEN', message: 'Only the payer can respond.' };
      if (req.status !== 'PENDING') return { ok: false, error: 'ALREADY_HANDLED', message: 'Request already handled.' };

      const payer = clone.profiles.find((p) => p.id === uid);

      if (!accept) {
        req.status = 'DECLINED';
        clone.notifications.push({
          id: makeUuid(),
          user_id: req.requester_id,
          title: 'Request Declined',
          body: `${payer?.full_name || 'Member'} declined your ${req.kind.toLowerCase()} for ${req.amount} VGC.`,
          kind: 'REQUEST',
          is_read: false,
          created_at: new Date().toISOString()
        });
        return { ok: true, message: 'Request declined.' };
      }

      const pinRes = verifyDemoPin(clone, uid, pin);
      if (!pinRes.ok) return pinRes;

      const bals = computeWalletBalancesFromState(clone);
      const myBal = bals.find((b) => b.user_id === uid);
      if (!myBal || myBal.available_vgc_balance < req.amount) {
        return { ok: false, error: 'INSUFFICIENT_BALANCE', message: 'Insufficient available VGC balance.' };
      }

      const txId = makeUuid();
      clone.ledger.push({
        id: txId,
        tx_kind: 'TRADE',
        sender_id: uid,
        receiver_id: req.requester_id,
        amount: Number(req.amount),
        month_tag: null,
        note: `${req.kind === 'REVERSAL' ? 'REVERSAL' : 'REQUEST'}: ${req.note}`,
        ref_type: req.kind,
        ref_id: req.id,
        idempotency_key: null,
        created_at: new Date().toISOString()
      });

      req.status = 'ACCEPTED';
      req.response_tx_id = txId;

      clone.notifications.push({
        id: makeUuid(),
        user_id: req.requester_id,
        title: `Request Paid (${req.amount} VGC)`,
        body: `${payer?.full_name || 'Member'} accepted and sent ${req.amount} VGC.`,
        kind: 'TRADE',
        is_read: false,
        created_at: new Date().toISOString()
      });

      return { ok: true, tx_id: txId, message: `Sent ${req.amount} VGC!` };
    });
  },

  async cancelPaymentRequest(requestId) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const req = clone.requests.find((r) => r.id === requestId);
      if (!req || req.requester_id !== uid) {
        return { ok: false, error: 'FORBIDDEN', message: 'Only the requester can cancel.' };
      }
      if (req.status !== 'PENDING') {
        return { ok: false, error: 'INVALID_STATE', message: 'Request is no longer pending.' };
      }
      req.status = 'CANCELLED';
      return { ok: true, message: 'Request cancelled.' };
    });
  },

  async submitDepositClaim(monthTag, amount, receiptPath, referenceNo) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const user = clone.profiles.find((p) => p.id === uid);
      if (!user || !user.is_active) {
        return { ok: false, error: 'INACTIVE_USER', message: 'Account is inactive.' };
      }
      const required = Number(clone.settings.monthly_contribution);
      if (Number(amount) !== required) {
        return { ok: false, error: 'INVALID_CONTRIBUTION_AMOUNT', message: `Deposit must equal ${required} VGC.` };
      }
      if (!receiptPath || !String(receiptPath).startsWith(`${uid}/`)) {
        return { ok: false, error: 'INVALID_RECEIPT_PATH', message: 'Invalid receipt path.' };
      }
      if (!String(referenceNo ?? '').trim()) {
        return { ok: false, error: 'MISSING_REFERENCE', message: 'Reference number is required.' };
      }
      const alreadyMinted = clone.ledger.some(
        (tx) => tx.tx_kind === 'MINT' && tx.receiver_id === uid && tx.month_tag === monthTag
      );
      if (alreadyMinted) {
        return { ok: false, error: 'ALREADY_MINTED', message: `Month ${monthTag} is already minted for you.` };
      }
      const existingClaim = clone.claims.some(
        (c) => c.user_id === uid && c.month_tag === monthTag && ['PENDING', 'APPROVED'].includes(c.status)
      );
      if (existingClaim) {
        return { ok: false, error: 'CLAIM_EXISTS', message: `You already have an active claim for ${monthTag}.` };
      }

      const claimId = makeUuid();
      clone.claims.push({
        id: claimId,
        user_id: uid,
        amount: required,
        month_tag: monthTag,
        receipt_url: receiptPath,
        reference_no: String(referenceNo).trim(),
        status: 'PENDING',
        reviewed_by: null,
        review_note: null,
        created_at: new Date().toISOString(),
        reviewed_at: null
      });

      clone.profiles
        .filter((p) => p.role === 'admin' && p.is_active)
        .forEach((admin) => {
          clone.notifications.push({
            id: makeUuid(),
            user_id: admin.id,
            title: `New Deposit Claim (${monthTag})`,
            body: `${user.full_name} submitted a deposit claim for ${required} VGC.`,
            kind: 'DEPOSIT',
            is_read: false,
            created_at: new Date().toISOString()
          });
        });

      return { ok: true, claim_id: claimId, message: 'Deposit claim submitted for admin review.' };
    });
  },

  async createBurnRequest(amount, reason, kind = 'CASHOUT') {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const user = clone.profiles.find((p) => p.id === uid);
      if (!user || !user.is_active) {
        return { ok: false, error: 'INACTIVE_USER', message: 'Account is inactive.' };
      }
      const amt = parsePositiveInt(amount);
      if (!amt) {
        return { ok: false, error: 'INVALID_AMOUNT', message: 'Enter a valid positive VGC amount.' };
      }
      if (!String(reason ?? '').trim()) {
        return { ok: false, error: 'MISSING_REASON', message: 'Reason is required.' };
      }
      const bals = computeWalletBalancesFromState(clone);
      const myBal = bals.find((b) => b.user_id === uid);
      if (!myBal || myBal.available_vgc_balance < amt) {
        return {
          ok: false,
          error: 'INSUFFICIENT_BALANCE',
          message: `Insufficient available VGC (Available: ${myBal?.available_vgc_balance ?? 0} VGC).`
        };
      }

      const burnId = makeUuid();
      clone.burns.push({
        id: burnId,
        requester_id: uid,
        amount: amt,
        reason: String(reason).trim(),
        kind: kind === 'GROUP_EXPENSE' ? 'GROUP_EXPENSE' : 'CASHOUT',
        approvals: [],
        status: 'PENDING',
        review_note: null,
        executed_tx_id: null,
        created_at: new Date().toISOString()
      });

      clone.profiles
        .filter((p) => p.is_active && p.id !== uid)
        .forEach((m) => {
          clone.notifications.push({
            id: makeUuid(),
            user_id: m.id,
            title: `New Burn Request (${amt} VGC)`,
            body: `${user.full_name} requested a ${kind} burn of ${amt} VGC: ${String(reason).trim()}`,
            kind: 'BURN',
            is_read: false,
            created_at: new Date().toISOString()
          });
        });

      return { ok: true, burn_id: burnId, message: `Burn request created. ${amt} VGC reserved pending consensus.` };
    });
  },

  async cancelBurnRequest(burnId) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const burn = clone.burns.find((b) => b.id === burnId);
      if (!burn || burn.requester_id !== uid) {
        return { ok: false, error: 'FORBIDDEN', message: 'Only the requester can cancel.' };
      }
      if (burn.status !== 'PENDING') {
        return { ok: false, error: 'INVALID_STATE', message: 'Burn request is no longer pending.' };
      }
      burn.status = 'REJECTED';
      burn.review_note = 'Cancelled by requester';
      return { ok: true, message: 'Burn request cancelled and reserved VGC released.' };
    });
  },

  async approveAndExecuteBurn(burnId) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const caller = clone.profiles.find((p) => p.id === uid);
      const burn = clone.burns.find((b) => b.id === burnId);
      if (!caller || !caller.is_active) {
        return { ok: false, error: 'INACTIVE_USER', message: 'Your account is inactive.' };
      }
      if (!burn || burn.status !== 'PENDING') {
        return { ok: false, error: 'INVALID_STATE', message: 'Burn request is no longer pending.' };
      }
      if (burn.requester_id === uid) {
        return { ok: false, error: 'SELF_APPROVAL_FORBIDDEN', message: 'You cannot approve your own burn request.' };
      }
      if (burn.approvals.includes(uid)) {
        return { ok: false, error: 'ALREADY_APPROVED', message: 'You already approved this burn request.' };
      }

      burn.approvals.push(uid);
      const required = Number(clone.settings.burn_approvals_required || 2);
      const peg = Number(clone.settings.peg || PEG_PKR_PER_VGC);
      const hasAdmin = burn.approvals.some((aid) => {
        const prof = clone.profiles.find((p) => p.id === aid);
        return prof && prof.role === 'admin' && prof.is_active;
      });

      if (burn.approvals.length >= required && hasAdmin) {
        const bals = computeWalletBalancesFromState(clone);
        const reqBal = bals.find((b) => b.user_id === burn.requester_id);
        const otherReserved = (reqBal?.reserved_for_burn || 0) - burn.amount;
        const unencumbered = (reqBal?.ledger_balance || 0) - (reqBal?.locked_in_escrow || 0) - Math.max(0, otherReserved);
        if (unencumbered < burn.amount) {
          return { ok: false, error: 'INSUFFICIENT_BALANCE', message: 'Requester no longer has enough unencumbered VGC.' };
        }

        const txId = makeUuid();
        clone.ledger.push({
          id: txId,
          tx_kind: 'BURN',
          sender_id: burn.requester_id,
          receiver_id: null,
          amount: Number(burn.amount),
          month_tag: null,
          note: `${burn.kind}: ${burn.reason}`,
          ref_type: 'BURN_REQUEST',
          ref_id: burn.id,
          idempotency_key: null,
          created_at: new Date().toISOString()
        });

        burn.status = 'APPROVED';
        burn.executed_tx_id = txId;

        const requester = clone.profiles.find((p) => p.id === burn.requester_id);
        clone.notifications.push({
          id: makeUuid(),
          user_id: burn.requester_id,
          title: `Burn Executed (${burn.amount} VGC)`,
          body: `Your ${burn.kind} burn of ${burn.amount} VGC (PKR ${burn.amount * peg}) was approved and executed.`,
          kind: 'BURN',
          is_read: false,
          created_at: new Date().toISOString()
        });

        if (caller.role === 'admin') {
          clone.auditLog.push({
            id: makeUuid(),
            actor_id: uid,
            action: 'APPROVE_AND_EXECUTE_BURN',
            target_id: burn.id,
            details: { amount: burn.amount, requester_id: burn.requester_id, tx_id: txId },
            created_at: new Date().toISOString()
          });
        }

        return {
          ok: true,
          executed: true,
          tx_id: txId,
          approvals: burn.approvals.length,
          required,
          pkr_payout: burn.amount * peg,
          message: `Consensus reached! Burned ${burn.amount} VGC — Pay PKR ${burn.amount * peg} to ${requester?.full_name || 'member'}.`
        };
      }

      if (caller.role === 'admin') {
        clone.auditLog.push({
          id: makeUuid(),
          actor_id: uid,
          action: 'APPROVE_BURN_PARTIAL',
          target_id: burn.id,
          details: { amount: burn.amount, approvals: burn.approvals.length },
          created_at: new Date().toISOString()
        });
      }

      return {
        ok: true,
        executed: false,
        approvals: burn.approvals.length,
        required,
        has_admin: hasAdmin,
        message: `Approval recorded (${burn.approvals.length}/${required}${hasAdmin ? '' : ', waiting for an Admin signature'}).`
      };
    });
  },

  async createSplitRequest(title, total, participantIds, includeCreator = true) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const creator = clone.profiles.find((p) => p.id === uid);
      if (!creator || !creator.is_active) {
        return { ok: false, error: 'INACTIVE_USER', message: 'Your account is inactive.' };
      }
      if (!String(title ?? '').trim()) {
        return { ok: false, error: 'MISSING_TITLE', message: 'Split title is required.' };
      }
      const tot = parsePositiveInt(total);
      if (!tot) {
        return { ok: false, error: 'INVALID_TOTAL', message: 'Total must be a positive whole number.' };
      }

      const cleanFriends = Array.from(
        new Set(
          (participantIds || []).filter((id) => {
            const p = clone.profiles.find((x) => x.id === id);
            return p && p.is_active && p.id !== uid;
          })
        )
      ).sort();

      if (cleanFriends.length === 0) {
        return { ok: false, error: 'NO_PARTICIPANTS', message: 'Select at least one active friend.' };
      }

      const allPayers = includeCreator
        ? Array.from(new Set([...cleanFriends, uid])).sort()
        : cleanFriends;

      const n = allPayers.length;
      if (tot < n) {
        return { ok: false, error: 'TOTAL_TOO_SMALL', message: `Total must be at least ${n} VGC.` };
      }

      const base = Math.floor(tot / n);
      const rem = tot % n;
      const splitId = makeUuid();

      clone.splits.push({
        id: splitId,
        creator_id: uid,
        title: String(title).trim(),
        total_amount: tot,
        include_creator: Boolean(includeCreator),
        status: 'OPEN',
        created_at: new Date().toISOString()
      });

      allPayers.forEach((pid, index) => {
        const share = index < rem ? base + 1 : base;
        if (pid !== uid) {
          clone.participants.push({
            id: makeUuid(),
            split_id: splitId,
            user_id: pid,
            share_amount: share,
            status: 'PENDING',
            paid_tx_id: null,
            created_at: new Date().toISOString()
          });
          clone.notifications.push({
            id: makeUuid(),
            user_id: pid,
            title: `Bill Split: ${String(title).trim()}`,
            body: `${creator.full_name} split ${tot} VGC. Your share is ${share} VGC.`,
            kind: 'SPLIT',
            is_read: false,
            created_at: new Date().toISOString()
          });
        }
      });

      return { ok: true, split_id: splitId, message: 'Bill split created and friends notified.' };
    });
  },

  async paySplitShare(participantId, pin) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const part = clone.participants.find((pt) => pt.id === participantId);
      if (!part || part.user_id !== uid) {
        return { ok: false, error: 'FORBIDDEN', message: 'This split share does not belong to you.' };
      }
      if (part.status !== 'PENDING') {
        return { ok: false, error: 'ALREADY_HANDLED', message: 'Share already handled.' };
      }
      const split = clone.splits.find((s) => s.id === part.split_id);
      if (!split || split.status !== 'OPEN') {
        return { ok: false, error: 'SPLIT_CLOSED', message: 'Split is no longer open.' };
      }

      const pinRes = verifyDemoPin(clone, uid, pin);
      if (!pinRes.ok) return pinRes;

      const bals = computeWalletBalancesFromState(clone);
      const myBal = bals.find((b) => b.user_id === uid);
      if (!myBal || myBal.available_vgc_balance < part.share_amount) {
        return { ok: false, error: 'INSUFFICIENT_BALANCE', message: 'Insufficient available VGC balance.' };
      }

      const txId = makeUuid();
      clone.ledger.push({
        id: txId,
        tx_kind: 'TRADE',
        sender_id: uid,
        receiver_id: split.creator_id,
        amount: Number(part.share_amount),
        month_tag: null,
        note: `Split: ${split.title}`,
        ref_type: 'SPLIT',
        ref_id: split.id,
        idempotency_key: null,
        created_at: new Date().toISOString()
      });

      part.status = 'PAID';
      part.paid_tx_id = txId;

      const anyPending = clone.participants.some((pt) => pt.split_id === split.id && pt.status === 'PENDING');
      if (!anyPending) {
        split.status = 'COMPLETED';
      }

      const payer = clone.profiles.find((p) => p.id === uid);
      clone.notifications.push({
        id: makeUuid(),
        user_id: split.creator_id,
        title: `Split Share Paid (${part.share_amount} VGC)`,
        body: `${payer?.full_name || 'Member'} paid ${part.share_amount} VGC for "${split.title}".`,
        kind: 'SPLIT',
        is_read: false,
        created_at: new Date().toISOString()
      });

      return { ok: true, tx_id: txId, message: `Paid ${part.share_amount} VGC for "${split.title}"!` };
    });
  },

  async declineSplitShare(participantId) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const part = clone.participants.find((pt) => pt.id === participantId);
      if (!part || part.user_id !== uid || part.status !== 'PENDING') {
        return { ok: false, error: 'INVALID_STATE', message: 'Cannot decline this share.' };
      }
      part.status = 'DECLINED';
      const split = clone.splits.find((s) => s.id === part.split_id);
      if (split) {
        const anyPending = clone.participants.some((pt) => pt.split_id === split.id && pt.status === 'PENDING');
        if (!anyPending) split.status = 'COMPLETED';
      }
      return { ok: true, message: 'Split share declined.' };
    });
  },

  async cancelSplitRequest(splitId) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const split = clone.splits.find((s) => s.id === splitId);
      if (!split || split.creator_id !== uid || split.status !== 'OPEN') {
        return { ok: false, error: 'INVALID_STATE', message: 'Only the creator of an open split can cancel it.' };
      }
      split.status = 'CANCELLED';
      clone.participants.forEach((pt) => {
        if (pt.split_id === splitId && pt.status === 'PENDING') {
          pt.status = 'DECLINED';
        }
      });
      return { ok: true, message: 'Split cancelled (unpaid shares voided).' };
    });
  },

  async createEscrowMatch(title, wager, opponentId) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const creator = clone.profiles.find((p) => p.id === uid);
      const opponent = clone.profiles.find((p) => p.id === opponentId);
      if (!creator?.is_active || !opponent?.is_active || opponent.id === uid) {
        return { ok: false, error: 'INVALID_OPPONENT', message: 'Select an active opponent other than yourself.' };
      }
      if (!String(title ?? '').trim()) {
        return { ok: false, error: 'MISSING_TITLE', message: 'Match title is required.' };
      }
      const w = parsePositiveInt(wager);
      if (!w) {
        return { ok: false, error: 'INVALID_WAGER', message: 'Wager must be a positive integer.' };
      }
      const bals = computeWalletBalancesFromState(clone);
      const myBal = bals.find((b) => b.user_id === uid);
      if (!myBal || myBal.available_vgc_balance < w) {
        return { ok: false, error: 'INSUFFICIENT_BALANCE', message: 'Insufficient available VGC to lock wager.' };
      }

      const matchId = makeUuid();
      clone.matches.push({
        id: matchId,
        creator_id: uid,
        opponent_id: opponent.id,
        wager_amount: w,
        title: String(title).trim(),
        status: 'OPEN',
        winner_id: null,
        creator_report: null,
        opponent_report: null,
        creator_cancel: false,
        opponent_cancel: false,
        settled_tx_id: null,
        created_at: new Date().toISOString()
      });

      clone.notifications.push({
        id: makeUuid(),
        user_id: opponent.id,
        title: `1v1 Escrow Challenge: ${String(title).trim()}`,
        body: `${creator.full_name} challenged you for ${w} VGC (${w * 2} VGC pot).`,
        kind: 'ESCROW',
        is_read: false,
        created_at: new Date().toISOString()
      });

      return { ok: true, match_id: matchId, message: `Challenge created! ${w} VGC locked in escrow.` };
    });
  },

  async acceptEscrowMatch(matchId) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const match = clone.matches.find((m) => m.id === matchId);
      if (!match || match.status !== 'OPEN') {
        return { ok: false, error: 'INVALID_STATE', message: 'Match is not open.' };
      }
      if (match.opponent_id !== uid) {
        return { ok: false, error: 'FORBIDDEN', message: 'Only the challenged opponent can accept.' };
      }
      const bals = computeWalletBalancesFromState(clone);
      const myBal = bals.find((b) => b.user_id === uid);
      if (!myBal || myBal.available_vgc_balance < match.wager_amount) {
        return { ok: false, error: 'INSUFFICIENT_BALANCE', message: `Need ${match.wager_amount} available VGC to accept.` };
      }

      match.status = 'LOCKED';
      const opponent = clone.profiles.find((p) => p.id === uid);
      clone.notifications.push({
        id: makeUuid(),
        user_id: match.creator_id,
        title: `Match Locked: ${match.title}`,
        body: `${opponent?.full_name || 'Opponent'} accepted! ${match.wager_amount * 2} VGC pot is locked.`,
        kind: 'ESCROW',
        is_read: false,
        created_at: new Date().toISOString()
      });

      return { ok: true, message: 'Match accepted! Both stakes are now locked in escrow.' };
    });
  },

  async cancelEscrowMatch(matchId) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const caller = clone.profiles.find((p) => p.id === uid);
      const match = clone.matches.find((m) => m.id === matchId);
      if (!match) return { ok: false, error: 'NOT_FOUND', message: 'Match not found.' };

      if (match.status === 'OPEN') {
        if (uid !== match.creator_id && uid !== match.opponent_id && caller?.role !== 'admin') {
          return { ok: false, error: 'FORBIDDEN', message: 'Not authorized to cancel.' };
        }
        match.status = 'CANCELLED';
        return { ok: true, message: 'Match cancelled and stake unlocked.' };
      }

      if (match.status === 'LOCKED') {
        if (caller?.role === 'admin') {
          match.status = 'CANCELLED';
          clone.auditLog.push({
            id: makeUuid(),
            actor_id: uid,
            action: 'ADMIN_CANCEL_ESCROW',
            target_id: matchId,
            details: { title: match.title },
            created_at: new Date().toISOString()
          });
          return { ok: true, message: 'Match cancelled by admin and stakes unlocked.' };
        }
        if (uid === match.creator_id) match.creator_cancel = true;
        else if (uid === match.opponent_id) match.opponent_cancel = true;
        else return { ok: false, error: 'FORBIDDEN', message: 'Only players can request cancellation.' };

        if (match.creator_cancel && match.opponent_cancel) {
          match.status = 'CANCELLED';
          return { ok: true, message: 'Both players agreed to cancel. Stakes unlocked!' };
        }
        return { ok: true, message: 'Cancellation requested; waiting for opponent to confirm.' };
      }

      return { ok: false, error: 'INVALID_STATE', message: 'Match cannot be cancelled now.' };
    });
  },

  async reportEscrowResult(matchId, winnerId) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const match = clone.matches.find((m) => m.id === matchId);
      if (!match || match.status !== 'LOCKED') {
        return { ok: false, error: 'INVALID_STATE', message: 'Match must be LOCKED to report results.' };
      }
      if (uid !== match.creator_id && uid !== match.opponent_id) {
        return { ok: false, error: 'FORBIDDEN', message: 'Only match players can report.' };
      }
      if (winnerId !== match.creator_id && winnerId !== match.opponent_id) {
        return { ok: false, error: 'INVALID_WINNER', message: 'Invalid winner selected.' };
      }

      if (uid === match.creator_id) match.creator_report = winnerId;
      else match.opponent_report = winnerId;

      if (match.creator_report && match.opponent_report) {
        if (match.creator_report === match.opponent_report) {
          const loserId = winnerId === match.creator_id ? match.opponent_id : match.creator_id;
          const txId = makeUuid();
          clone.ledger.push({
            id: txId,
            tx_kind: 'TRADE',
            sender_id: loserId,
            receiver_id: winnerId,
            amount: Number(match.wager_amount),
            month_tag: null,
            note: `Escrow Match Won: ${match.title}`,
            ref_type: 'ESCROW',
            ref_id: match.id,
            idempotency_key: null,
            created_at: new Date().toISOString()
          });
          match.status = 'SETTLED';
          match.winner_id = winnerId;
          match.settled_tx_id = txId;

          clone.notifications.push({
            id: makeUuid(),
            user_id: winnerId,
            title: `Match Won! (+${match.wager_amount} VGC)`,
            body: `Escrow settled for "${match.title}". You won ${match.wager_amount} VGC!`,
            kind: 'ESCROW',
            is_read: false,
            created_at: new Date().toISOString()
          });
          return {
            ok: true,
            settled: true,
            winner_id: winnerId,
            tx_id: txId,
            message: `Both reports matched! ${match.wager_amount} VGC transferred to winner.`
          };
        }

        match.status = 'DISPUTED';
        clone.profiles
          .filter((p) => p.role === 'admin' && p.is_active)
          .forEach((admin) => {
            clone.notifications.push({
              id: makeUuid(),
              user_id: admin.id,
              title: 'Escrow Match Disputed',
              body: `Conflicting result reports on "${match.title}". Admin action needed.`,
              kind: 'ESCROW',
              is_read: false,
              created_at: new Date().toISOString()
            });
          });
        return {
          ok: true,
          settled: false,
          disputed: true,
          message: 'Conflicting result reports! Match marked DISPUTED for admin resolution.'
        };
      }

      return { ok: true, settled: false, disputed: false, message: 'Result recorded. Waiting for opponent confirmation.' };
    });
  },

  async settleEscrowMatch(matchId, winnerId) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const caller = clone.profiles.find((p) => p.id === uid);
      const match = clone.matches.find((m) => m.id === matchId);
      if (!match || !['LOCKED', 'DISPUTED'].includes(match.status)) {
        return { ok: false, error: 'INVALID_STATE', message: 'Match must be LOCKED or DISPUTED.' };
      }
      if (caller?.role !== 'admin') {
        return { ok: false, error: 'ADMIN_ONLY', message: 'Only an admin can force-settle a disputed match.' };
      }
      if (winnerId !== match.creator_id && winnerId !== match.opponent_id) {
        return { ok: false, error: 'INVALID_WINNER', message: 'Winner must be one of the two players.' };
      }

      const loserId = winnerId === match.creator_id ? match.opponent_id : match.creator_id;
      const txId = makeUuid();
      clone.ledger.push({
        id: txId,
        tx_kind: 'TRADE',
        sender_id: loserId,
        receiver_id: winnerId,
        amount: Number(match.wager_amount),
        month_tag: null,
        note: `Escrow Match Won: ${match.title}`,
        ref_type: 'ESCROW',
        ref_id: match.id,
        idempotency_key: null,
        created_at: new Date().toISOString()
      });

      match.status = 'SETTLED';
      match.winner_id = winnerId;
      match.settled_tx_id = txId;

      clone.auditLog.push({
        id: makeUuid(),
        actor_id: uid,
        action: 'RESOLVE_ESCROW_DISPUTE',
        target_id: matchId,
        details: { winner_id: winnerId, wager_amount: match.wager_amount, tx_id: txId },
        created_at: new Date().toISOString()
      });

      return { ok: true, settled: true, winner_id: winnerId, tx_id: txId, message: 'Dispute resolved and escrow settled.' };
    });
  },

  async markNotificationsRead() {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      clone.notifications.forEach((n) => {
        if (n.user_id === uid) n.is_read = true;
      });
      return { ok: true };
    });
  },

  async adminApproveDeposit(claimId) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const admin = clone.profiles.find((p) => p.id === uid);
      if (!admin || admin.role !== 'admin' || !admin.is_active) {
        return { ok: false, error: 'ADMIN_ONLY', message: 'Admin privileges required.' };
      }
      const claim = clone.claims.find((c) => c.id === claimId);
      if (!claim) return { ok: false, error: 'NOT_FOUND', message: 'Deposit claim not found.' };
      if (claim.status !== 'PENDING') {
        return { ok: false, error: 'ALREADY_MINTED', message: `Claim is already ${claim.status}.` };
      }

      const duplicateMint = clone.ledger.some(
        (tx) => tx.tx_kind === 'MINT' && tx.receiver_id === claim.user_id && tx.month_tag === claim.month_tag
      );
      if (duplicateMint) {
        return { ok: false, error: 'ALREADY_MINTED', message: `MINT already exists for ${claim.month_tag}.` };
      }

      const activeAdmins = clone.profiles.filter((p) => p.role === 'admin' && p.is_active);
      let note = `Monthly Deposit ${claim.month_tag} (Ref: ${claim.reference_no})`;
      if (claim.user_id === uid) {
        if (activeAdmins.length > 1) {
          return { ok: false, error: 'SELF_APPROVE_FORBIDDEN', message: 'Another admin must approve your own claim.' };
        }
        note = `Monthly Deposit ${claim.month_tag} [SELF-APPROVED (sole admin)]`;
      }

      const txId = makeUuid();
      clone.ledger.push({
        id: txId,
        tx_kind: 'MINT',
        sender_id: null,
        receiver_id: claim.user_id,
        amount: Number(claim.amount),
        month_tag: claim.month_tag,
        note,
        ref_type: 'DEPOSIT_CLAIM',
        ref_id: claim.id,
        idempotency_key: null,
        created_at: new Date().toISOString()
      });

      claim.status = 'APPROVED';
      claim.reviewed_by = uid;
      claim.review_note = note;
      claim.reviewed_at = new Date().toISOString();

      clone.notifications.push({
        id: makeUuid(),
        user_id: claim.user_id,
        title: `Deposit Approved (+${claim.amount} VGC)`,
        body: `Your ${claim.month_tag} deposit claim was verified and ${claim.amount} VGC was minted.`,
        kind: 'MINT',
        is_read: false,
        created_at: new Date().toISOString()
      });

      clone.auditLog.push({
        id: makeUuid(),
        actor_id: uid,
        action: 'APPROVE_DEPOSIT_MINT',
        target_id: claim.id,
        details: { user_id: claim.user_id, month_tag: claim.month_tag, amount: claim.amount, tx_id: txId },
        created_at: new Date().toISOString()
      });

      return { ok: true, tx_id: txId, message: `Minted +${claim.amount} VGC for ${claim.month_tag}!` };
    });
  },

  async adminRejectDeposit(claimId, reason) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const admin = clone.profiles.find((p) => p.id === uid);
      if (!admin || admin.role !== 'admin') {
        return { ok: false, error: 'ADMIN_ONLY', message: 'Admin privileges required.' };
      }
      if (!String(reason ?? '').trim()) {
        return { ok: false, error: 'REASON_REQUIRED', message: 'Rejection reason is required.' };
      }
      const claim = clone.claims.find((c) => c.id === claimId);
      if (!claim || claim.status !== 'PENDING') {
        return { ok: false, error: 'INVALID_STATE', message: 'Claim is not pending.' };
      }
      claim.status = 'REJECTED';
      claim.reviewed_by = uid;
      claim.review_note = String(reason).trim();
      claim.reviewed_at = new Date().toISOString();

      clone.notifications.push({
        id: makeUuid(),
        user_id: claim.user_id,
        title: 'Deposit Claim Rejected',
        body: `Your ${claim.month_tag} deposit claim was rejected: ${claim.review_note}`,
        kind: 'DEPOSIT',
        is_read: false,
        created_at: new Date().toISOString()
      });

      clone.auditLog.push({
        id: makeUuid(),
        actor_id: uid,
        action: 'REJECT_DEPOSIT',
        target_id: claim.id,
        details: { reason: claim.review_note, user_id: claim.user_id },
        created_at: new Date().toISOString()
      });

      return { ok: true, message: 'Deposit claim rejected.' };
    });
  },

  async adminRejectBurn(burnId, reason) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const admin = clone.profiles.find((p) => p.id === uid);
      if (!admin || admin.role !== 'admin') {
        return { ok: false, error: 'ADMIN_ONLY', message: 'Admin privileges required.' };
      }
      if (!String(reason ?? '').trim()) {
        return { ok: false, error: 'REASON_REQUIRED', message: 'Rejection reason is required.' };
      }
      const burn = clone.burns.find((b) => b.id === burnId);
      if (!burn || burn.status !== 'PENDING') {
        return { ok: false, error: 'INVALID_STATE', message: 'Burn request is not pending.' };
      }
      burn.status = 'REJECTED';
      burn.review_note = String(reason).trim();

      clone.notifications.push({
        id: makeUuid(),
        user_id: burn.requester_id,
        title: 'Burn Request Rejected',
        body: `Your burn request of ${burn.amount} VGC was rejected: ${burn.review_note}`,
        kind: 'BURN',
        is_read: false,
        created_at: new Date().toISOString()
      });

      clone.auditLog.push({
        id: makeUuid(),
        actor_id: uid,
        action: 'REJECT_BURN',
        target_id: burn.id,
        details: { reason: burn.review_note, requester_id: burn.requester_id },
        created_at: new Date().toISOString()
      });

      return { ok: true, message: 'Burn request rejected and reserved VGC unlocked.' };
    });
  },

  async adminMemberExit(userId) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const admin = clone.profiles.find((p) => p.id === uid);
      if (!admin || admin.role !== 'admin') {
        return { ok: false, error: 'ADMIN_ONLY', message: 'Admin privileges required.' };
      }
      const member = clone.profiles.find((p) => p.id === userId);
      if (!member || !member.is_active) {
        return { ok: false, error: 'ALREADY_INACTIVE', message: 'Member is already inactive.' };
      }

      const hasEscrow = clone.matches.some(
        (m) =>
          (m.creator_id === userId || m.opponent_id === userId) &&
          ['OPEN', 'LOCKED', 'DISPUTED'].includes(m.status)
      );
      if (hasEscrow) {
        return {
          ok: false,
          error: 'ACTIVE_ESCROW_BLOCKER',
          message: 'Member has unresolved OPEN/LOCKED/DISPUTED escrow matches. Resolve them before exit.'
        };
      }

      const hasBurn = clone.burns.some((b) => b.requester_id === userId && b.status === 'PENDING');
      if (hasBurn) {
        return {
          ok: false,
          error: 'PENDING_BURN_BLOCKER',
          message: 'Member has a pending burn request. Approve or reject it before exit.'
        };
      }

      const bals = computeWalletBalancesFromState(clone);
      const mBal = bals.find((b) => b.user_id === userId);
      const burned = mBal?.ledger_balance || 0;
      const peg = Number(clone.settings.peg || PEG_PKR_PER_VGC);
      const pkrSettlement = burned * peg;
      let txId = null;

      if (burned > 0) {
        txId = makeUuid();
        clone.ledger.push({
          id: txId,
          tx_kind: 'BURN',
          sender_id: userId,
          receiver_id: null,
          amount: burned,
          month_tag: null,
          note: 'MEMBER_EXIT',
          ref_type: 'MEMBER_EXIT',
          ref_id: userId,
          idempotency_key: null,
          created_at: new Date().toISOString()
        });
      }

      member.is_active = false;

      clone.auditLog.push({
        id: makeUuid(),
        actor_id: uid,
        action: 'MEMBER_EXIT',
        target_id: userId,
        details: { member_name: member.full_name, burned_vgc: burned, pkr_settlement: pkrSettlement, tx_id: txId },
        created_at: new Date().toISOString()
      });

      return {
        ok: true,
        burned,
        pkr_settlement: pkrSettlement,
        tx_id: txId,
        message: `Burned ${burned} VGC — transfer PKR ${pkrSettlement} to ${member.full_name}.`
      };
    });
  },

  async adminRunSettlement(monthTag) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const admin = clone.profiles.find((p) => p.id === uid);
      if (!admin || admin.role !== 'admin') {
        return { ok: false, error: 'ADMIN_ONLY', message: 'Admin privileges required.' };
      }
      if (clone.settings.rollover_mode !== 'MONTHLY_RESET') {
        return { ok: false, error: 'ROLLOVER_MODE_CONTINUOUS', message: 'Switch rollover mode to MONTHLY_RESET first.' };
      }

      const bals = computeWalletBalancesFromState(clone);
      const peg = Number(clone.settings.peg || PEG_PKR_PER_VGC);
      const payouts = [];
      let totalBurned = 0;

      bals
        .filter((b) => b.is_active && b.available_vgc_balance > 0)
        .forEach((b) => {
          const txId = makeUuid();
          clone.ledger.push({
            id: txId,
            tx_kind: 'BURN',
            sender_id: b.user_id,
            receiver_id: null,
            amount: b.available_vgc_balance,
            month_tag: null,
            note: `MONTH_END_SETTLEMENT:${monthTag}`,
            ref_type: 'SETTLEMENT',
            ref_id: null,
            idempotency_key: null,
            created_at: new Date().toISOString()
          });
          totalBurned += b.available_vgc_balance;
          payouts.push({
            user_id: b.user_id,
            full_name: b.full_name,
            burned_vgc: b.available_vgc_balance,
            pkr_payout: b.available_vgc_balance * peg,
            tx_id: txId
          });
        });

      clone.auditLog.push({
        id: makeUuid(),
        actor_id: uid,
        action: 'MONTH_END_SETTLEMENT',
        target_id: null,
        details: { month_tag: monthTag, total_burned: totalBurned, payouts },
        created_at: new Date().toISOString()
      });

      return {
        ok: true,
        total_burned: totalBurned,
        payouts,
        message: `Month-end settlement complete. Burned ${totalBurned} VGC across ${payouts.length} members.`
      };
    });
  },

  async adminRecordReconciliation(bankBalancePkr, note) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const admin = clone.profiles.find((p) => p.id === uid);
      if (!admin || admin.role !== 'admin') {
        return { ok: false, error: 'ADMIN_ONLY', message: 'Admin privileges required.' };
      }
      const bank = Number(bankBalancePkr);
      if (!Number.isFinite(bank) || bank < 0) {
        return { ok: false, error: 'INVALID_BALANCE', message: 'Enter a valid non-negative PKR balance.' };
      }
      const summary = computeVagafundSummaryFromState(clone);
      const expected = summary.fund_cash_pkr;
      const variance = bank - expected;
      const recId = makeUuid();

      clone.reconciliations.push({
        id: recId,
        recorded_by: uid,
        bank_balance_pkr: bank,
        expected_pkr: expected,
        variance_pkr: variance,
        note: String(note ?? '').trim(),
        created_at: new Date().toISOString()
      });

      clone.auditLog.push({
        id: makeUuid(),
        actor_id: uid,
        action: 'RECORD_RECONCILIATION',
        target_id: recId,
        details: { bank_balance_pkr: bank, expected_pkr: expected, variance_pkr: variance },
        created_at: new Date().toISOString()
      });

      return {
        ok: true,
        reconciliation_id: recId,
        variance_pkr: variance,
        message: `Reconciliation recorded (Variance: PKR ${variance}).`
      };
    });
  },

  async adminUpdateSettings({
    groupName,
    monthlyContribution,
    burnApprovalsRequired,
    rolloverMode,
    reversalWindowHours,
    inviteCode
  }) {
    return runDemoTransaction((clone) => {
      const uid = clone.currentUserId;
      const admin = clone.profiles.find((p) => p.id === uid);
      if (!admin || admin.role !== 'admin') {
        return { ok: false, error: 'ADMIN_ONLY', message: 'Admin privileges required.' };
      }
      const contrib = parsePositiveInt(monthlyContribution);
      if (!contrib) {
        return { ok: false, error: 'INVALID_CONTRIBUTION', message: 'Monthly contribution must be a positive integer.' };
      }
      const reqApp = parsePositiveInt(burnApprovalsRequired);
      if (!reqApp || reqApp > 20) {
        return { ok: false, error: 'INVALID_APPROVALS', message: 'Approvals required must be between 1 and 20.' };
      }
      if (!['CONTINUOUS', 'MONTHLY_RESET'].includes(rolloverMode)) {
        return { ok: false, error: 'INVALID_ROLLOVER_MODE', message: 'Invalid rollover mode.' };
      }

      clone.settings = {
        ...clone.settings,
        group_name: String(groupName || clone.settings.group_name).trim(),
        monthly_contribution: contrib,
        burn_approvals_required: reqApp,
        rollover_mode: rolloverMode,
        reversal_window_hours: parsePositiveInt(reversalWindowHours) || 48,
        invite_code: String(inviteCode || clone.settings.invite_code).trim(),
        updated_at: new Date().toISOString()
      };

      clone.auditLog.push({
        id: makeUuid(),
        actor_id: uid,
        action: 'UPDATE_SETTINGS',
        target_id: null,
        details: { monthly_contribution: contrib, burn_approvals_required: reqApp, rollover_mode: rolloverMode },
        created_at: new Date().toISOString()
      });

      return { ok: true, message: 'Group settings updated.' };
    });
  },

  async adminGetInviteCode() {
    const st = loadDemoState();
    return { ok: true, invite_code: st.settings.invite_code };
  }
};

// -----------------------------------------------------------------------------
// LIVE SUPABASE IMPLEMENTATION
// -----------------------------------------------------------------------------
async function callRpc(fnName, params = {}) {
  try {
    const { data, error } = await supabaseClient.rpc(fnName, params);
    if (error) {
      return { ok: false, error: error.code || 'RPC_ERROR', message: error.message || 'Database RPC error' };
    }
    if (data && typeof data === 'object' && 'ok' in data) {
      return data;
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: 'NETWORK_ERROR', message: err?.message || 'Network request failed' };
  }
}

const liveApi = {
  mode: 'live',

  async getSession() {
    return supabaseClient.auth.getSession();
  },

  onAuthChange(callback) {
    const { data } = supabaseClient.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
    return () => data.subscription.unsubscribe();
  },

  async signIn(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.code || 'AUTH_ERROR', message: error.message };
    return { ok: true, user: data.user };
  },

  async signUp(email, password, fullName, inviteCode) {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          invite_code: inviteCode
        }
      }
    });
    if (error) return { ok: false, error: error.code || 'SIGNUP_ERROR', message: error.message };
    return { ok: true, user: data.user };
  },

  async signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) return { ok: false, error: 'SIGNOUT_ERROR', message: error.message };
    return { ok: true };
  },

  async switchUser() {
    return { ok: false, error: 'DEMO_ONLY', message: 'User switching is only available in Demo mode.' };
  },

  async resetDemo() {
    return { ok: false, error: 'DEMO_ONLY', message: 'Reset is only available in Demo mode.' };
  },

  subscribe(onChange) {
    const channel = supabaseClient
      .channel('vagacoin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        onChange();
      })
      .subscribe();
    return () => {
      supabaseClient.removeChannel(channel);
    };
  },

  async getProfile() {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) return null;
    const { data } = await supabaseClient.from('profiles').select('*').eq('id', uid).maybeSingle();
    return data || null;
  },

  async listProfiles() {
    const { data } = await supabaseClient.from('profiles').select('*').order('full_name');
    return data || [];
  },

  async getWalletBalances() {
    const { data } = await supabaseClient.from('wallet_balances').select('*');
    return data || [];
  },

  async getVagafundSummary() {
    const { data } = await supabaseClient.from('vagafund_summary').select('*').maybeSingle();
    return data || null;
  },

  async getMonthlyDepositStatus() {
    const { data } = await supabaseClient.from('monthly_deposit_status').select('*');
    return data || [];
  },

  async listLedger({ limit = 100, userId = null } = {}) {
    let query = supabaseClient
      .from('ledger_transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (userId) {
      query = query.or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
    }
    const { data } = await query;
    return data || [];
  },

  async listDepositClaims() {
    const { data } = await supabaseClient
      .from('deposit_claims')
      .select('*')
      .order('created_at', { ascending: false });
    return data || [];
  },

  async listBurnRequests() {
    const { data } = await supabaseClient
      .from('burn_requests')
      .select('*')
      .order('created_at', { ascending: false });
    return data || [];
  },

  async listSplits() {
    const { data: splits } = await supabaseClient
      .from('split_requests')
      .select('*')
      .order('created_at', { ascending: false });
    const { data: participants } = await supabaseClient.from('split_participants').select('*');
    return (splits || []).map((s) => ({
      ...s,
      participants: (participants || []).filter((p) => p.split_id === s.id)
    }));
  },

  async listEscrowMatches() {
    const { data } = await supabaseClient
      .from('escrow_matches')
      .select('*')
      .order('created_at', { ascending: false });
    return data || [];
  },

  async listPaymentRequests() {
    const { data } = await supabaseClient
      .from('payment_requests')
      .select('*')
      .order('created_at', { ascending: false });
    return data || [];
  },

  async listNotifications() {
    const { data } = await supabaseClient
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(40);
    return data || [];
  },

  async getGroupSettings() {
    const { data } = await supabaseClient
      .from('group_settings')
      .select('id, group_name, currency, peg, monthly_contribution, burn_approvals_required, rollover_mode, reversal_window_hours, updated_at')
      .maybeSingle();
    const inv = await callRpc('admin_get_invite_code');
    if (inv.ok && inv.invite_code && data) {
      data.invite_code = inv.invite_code;
    }
    return data;
  },

  async listReconciliations() {
    const { data } = await supabaseClient
      .from('fund_reconciliations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(25);
    return data || [];
  },

  async listAuditLog() {
    const { data } = await supabaseClient
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    return data || [];
  },

  async uploadReceipt(file) {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) throw new Error('Not authenticated');
    const path = `${uid}/receipt_${Date.now()}.webp`;
    const { error } = await supabaseClient.storage.from('receipts').upload(path, file, {
      contentType: 'image/webp',
      upsert: false
    });
    if (error) throw new Error(error.message);
    return path;
  },

  async getReceiptUrl(path) {
    const { data, error } = await supabaseClient.storage.from('receipts').createSignedUrl(path, 3600);
    if (error) return '';
    return data?.signedUrl || '';
  },

  hasPinSet: () => callRpc('has_pin_set'),
  setPin: (newPin, oldPin = null) => callRpc('set_pin', { p_new_pin: newPin, p_old_pin: oldPin }),
  tradeVagacoin: (receiverId, amount, note, pin, idempotencyKey = null) =>
    callRpc('trade_vagacoin', {
      p_receiver_id: receiverId,
      p_amount: Number(amount),
      p_note: note,
      p_pin: pin,
      p_idempotency_key: idempotencyKey
    }),
  createPaymentRequest: (payerId, amount, note) =>
    callRpc('create_payment_request', { p_payer_id: payerId, p_amount: Number(amount), p_note: note }),
  requestReversal: (txId, note) => callRpc('request_reversal', { p_tx_id: txId, p_note: note }),
  respondPaymentRequest: (requestId, accept, pin = null) =>
    callRpc('respond_payment_request', { p_request_id: requestId, p_accept: accept, p_pin: pin }),
  cancelPaymentRequest: (requestId) => callRpc('cancel_payment_request', { p_request_id: requestId }),
  submitDepositClaim: (monthTag, amount, receiptPath, referenceNo) =>
    callRpc('submit_deposit_claim', {
      p_month_tag: monthTag,
      p_amount: Number(amount),
      p_receipt_path: receiptPath,
      p_reference_no: referenceNo
    }),
  createBurnRequest: (amount, reason, kind = 'CASHOUT') =>
    callRpc('create_burn_request', { p_amount: Number(amount), p_reason: reason, p_kind: kind }),
  cancelBurnRequest: (burnId) => callRpc('cancel_burn_request', { p_burn_id: burnId }),
  approveAndExecuteBurn: (burnId) => callRpc('approve_and_execute_burn', { p_burn_id: burnId }),
  createSplitRequest: (title, total, participantIds, includeCreator = true) =>
    callRpc('create_split_request', {
      p_title: title,
      p_total: Number(total),
      p_participant_ids: participantIds,
      p_include_creator: includeCreator
    }),
  paySplitShare: (participantId, pin) => callRpc('pay_split_share', { p_participant_id: participantId, p_pin: pin }),
  declineSplitShare: (participantId) => callRpc('decline_split_share', { p_participant_id: participantId }),
  cancelSplitRequest: (splitId) => callRpc('cancel_split_request', { p_split_id: splitId }),
  createEscrowMatch: (title, wager, opponentId) =>
    callRpc('create_escrow_match', { p_title: title, p_wager: Number(wager), p_opponent_id: opponentId }),
  acceptEscrowMatch: (matchId) => callRpc('accept_escrow_match', { p_match_id: matchId }),
  cancelEscrowMatch: (matchId) => callRpc('cancel_escrow_match', { p_match_id: matchId }),
  reportEscrowResult: (matchId, winnerId) =>
    callRpc('report_escrow_result', { p_match_id: matchId, p_winner_id: winnerId }),
  settleEscrowMatch: (matchId, winnerId) =>
    callRpc('settle_escrow_match', { p_match_id: matchId, p_winner_id: winnerId }),
  markNotificationsRead: () => callRpc('mark_notifications_read'),
  adminApproveDeposit: (claimId) => callRpc('admin_approve_deposit', { p_claim_id: claimId }),
  adminRejectDeposit: (claimId, reason) =>
    callRpc('admin_reject_deposit', { p_claim_id: claimId, p_reason: reason }),
  adminRejectBurn: (burnId, reason) => callRpc('admin_reject_burn', { p_burn_id: burnId, p_reason: reason }),
  adminMemberExit: (userId) => callRpc('admin_member_exit', { p_user_id: userId }),
  adminRunSettlement: (monthTag) => callRpc('admin_run_settlement', { p_month_tag: monthTag }),
  adminRecordReconciliation: (bankBalancePkr, note) =>
    callRpc('admin_record_reconciliation', { p_bank_balance_pkr: Number(bankBalancePkr), p_note: note }),
  adminUpdateSettings: ({
    groupName,
    monthlyContribution,
    burnApprovalsRequired,
    rolloverMode,
    reversalWindowHours,
    inviteCode
  }) =>
    callRpc('admin_update_settings', {
      p_group_name: groupName,
      p_monthly_contribution: Number(monthlyContribution),
      p_burn_approvals_required: Number(burnApprovalsRequired),
      p_rollover_mode: rolloverMode,
      p_reversal_window_hours: Number(reversalWindowHours),
      p_invite_code: inviteCode || null
    }),
  adminGetInviteCode: () => callRpc('admin_get_invite_code')
};

export const api = IS_LIVE_MODE ? liveApi : demoApi;
