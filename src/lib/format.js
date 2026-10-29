// Single source of truth for default peg (mirrored in group_settings.peg)
export const PEG_PKR_PER_VGC = 1;
export const MAX_VGC_AMOUNT = 10000000;

const numberFormatter = new Intl.NumberFormat('en-PK', {
  maximumFractionDigits: 0
});

export function formatVGC(amount, withUnit = true) {
  const n = Number.isFinite(Number(amount)) ? Math.trunc(Number(amount)) : 0;
  const formatted = numberFormatter.format(n);
  return withUnit ? `${formatted} VGC` : formatted;
}

export function formatPKR(vgcAmount, peg = PEG_PKR_PER_VGC) {
  const n = Number.isFinite(Number(vgcAmount)) ? Math.trunc(Number(vgcAmount)) : 0;
  const p = Number.isFinite(Number(peg)) && Number(peg) > 0 ? Math.trunc(Number(peg)) : PEG_PKR_PER_VGC;
  const pkr = n * p;
  return `PKR ${numberFormatter.format(pkr)}`;
}

export function sanitizeIntegerInput(rawValue) {
  const digitsOnly = String(rawValue ?? '').replace(/[^0-9]/g, '');
  if (!digitsOnly) return '';
  const parsed = parseInt(digitsOnly, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return String(Math.min(parsed, MAX_VGC_AMOUNT));
}

export function parsePositiveInt(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_VGC_AMOUNT) {
    return value;
  }
  const str = String(value ?? '').trim();
  if (!/^\d+$/.test(str)) return null;
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num <= 0 || num > MAX_VGC_AMOUNT) return null;
  return num;
}

export function getCurrentMonthTag(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getRecentMonthTags(count = 3, baseDate = new Date()) {
  const tags = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth() - i, 1);
    tags.push(getCurrentMonthTag(d));
  }
  return tags;
}

export function formatMonthLabel(monthTag) {
  if (!monthTag || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthTag)) return monthTag || '';
  const [y, m] = monthTag.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function txToMonthTag(tx) {
  if (tx?.month_tag) return tx.month_tag;
  if (!tx?.created_at) return getCurrentMonthTag();
  const d = new Date(tx.created_at);
  if (Number.isNaN(d.getTime())) return getCurrentMonthTag();
  return getCurrentMonthTag(d);
}

export function formatRelativeTime(isoString) {
  if (!isoString) return 'just now';
  const date = new Date(isoString);
  const now = Date.now();
  const diffSec = Math.round((now - date.getTime()) / 1000);
  if (Number.isNaN(diffSec)) return '';
  if (diffSec < 45) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  return d.toLocaleString('en-PK', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function computeSplitShares(totalAmount, participantIds, creatorId, includeCreator) {
  const total = parsePositiveInt(totalAmount);
  if (!total) return [];
  const cleanOthers = Array.from(new Set((participantIds || []).filter((id) => id && id !== creatorId))).sort();
  if (cleanOthers.length === 0) return [];
  const allPayers = includeCreator
    ? Array.from(new Set([...cleanOthers, creatorId])).sort()
    : cleanOthers;
  const n = allPayers.length;
  if (total < n) return [];
  const base = Math.floor(total / n);
  const rem = total % n;
  return allPayers.map((userId, index) => ({
    userId,
    shareAmount: index < rem ? base + 1 : base,
    isCreator: userId === creatorId
  }));
}

export function computeMonthlyRolloverForUser(userId, ledgerTransactions) {
  const sorted = [...(ledgerTransactions || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const monthsSet = new Set();
  sorted.forEach((tx) => {
    monthsSet.add(txToMonthTag(tx));
  });
  monthsSet.add(getCurrentMonthTag());
  const months = Array.from(monthsSet).sort();

  let runningOpening = 0;
  return months.map((monthTag) => {
    let minted = 0;
    let received = 0;
    let sent = 0;
    let burned = 0;
    sorted.forEach((tx) => {
      if (txToMonthTag(tx) !== monthTag) return;
      if (tx.tx_kind === 'MINT' && tx.receiver_id === userId) {
        minted += Number(tx.amount);
      } else if (tx.tx_kind === 'TRADE' && tx.receiver_id === userId) {
        received += Number(tx.amount);
      } else if (tx.tx_kind === 'TRADE' && tx.sender_id === userId) {
        sent += Number(tx.amount);
      } else if (tx.tx_kind === 'BURN' && tx.sender_id === userId) {
        burned += Number(tx.amount);
      }
    });
    const opening = runningOpening;
    const closing = opening + minted + received - sent - burned;
    runningOpening = closing;
    return {
      monthTag,
      opening,
      minted,
      received,
      sent,
      burned,
      closing
    };
  });
}
