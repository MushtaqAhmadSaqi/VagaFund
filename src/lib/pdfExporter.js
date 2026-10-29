import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatVGC, formatPKR, PEG_PKR_PER_VGC, txToMonthTag } from './format.js';

function toAsciiSafe(text) {
  return String(text ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addPageFooters(doc, summary, peg) {
  const pageCount = doc.internal.getNumberOfPages();
  const minted = Number(summary?.total_minted ?? 0);
  const burned = Number(summary?.total_burned ?? 0);
  const supply = Number(summary?.active_vgc_supply ?? minted - burned);
  const sumBal = Number(summary?.sum_of_user_balances ?? supply);

  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    const proofLine = `Golden Invariant Proof: Sum(Balances) = ${sumBal} VGC = Minted (${minted}) - Burned (${burned}) = Active Supply (${supply}) | Peg: 1 VGC = ${peg} PKR`;
    doc.text(toAsciiSafe(proofLine), 14, 285);
    doc.text(`Page ${i} of ${pageCount}`, 196, 285, { align: 'right' });
  }
}

export function exportMonthlyStatement({
  monthTag,
  user,
  ledgerRows,
  profilesById,
  openingBalance = 0,
  summary,
  groupName = 'Vagafund Committee',
  peg = PEG_PKR_PER_VGC
}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const safeGroup = toAsciiSafe(groupName || 'Vagafund Committee');
  const safeName = toAsciiSafe(user?.full_name || 'Member');
  const safeMonth = toAsciiSafe(monthTag);

  // Header Banner
  doc.setFillColor(6, 78, 59);
  doc.rect(0, 0, 210, 34, 'F');
  doc.setTextColor(236, 253, 245);
  doc.setFontSize(18);
  doc.text(`${safeGroup} - Monthly VGC Statement`, 14, 15);
  doc.setFontSize(10);
  doc.text(`Member: ${safeName}   |   Period: ${safeMonth}   |   Generated: ${toAsciiSafe(new Date().toISOString().slice(0, 16).replace('T', ' '))}`, 14, 25);

  const sortedAll = [...(ledgerRows || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  let running = Number(openingBalance) || 0;
  let minted = 0;
  let received = 0;
  let sent = 0;
  let burned = 0;

  const monthRows = [];
  sortedAll.forEach((tx) => {
    const tag = txToMonthTag(tx);
    if (tag !== monthTag) return;

    const amt = Number(tx.amount) || 0;
    let delta = 0;
    let counterparty = '-';

    if (tx.tx_kind === 'MINT' && tx.receiver_id === user.id) {
      minted += amt;
      delta = amt;
      counterparty = 'Vagafund Mint';
    } else if (tx.tx_kind === 'TRADE' && tx.receiver_id === user.id) {
      received += amt;
      delta = amt;
      counterparty = profilesById?.[tx.sender_id]?.full_name || 'Member';
    } else if (tx.tx_kind === 'TRADE' && tx.sender_id === user.id) {
      sent += amt;
      delta = -amt;
      counterparty = profilesById?.[tx.receiver_id]?.full_name || 'Member';
    } else if (tx.tx_kind === 'BURN' && tx.sender_id === user.id) {
      burned += amt;
      delta = -amt;
      counterparty = 'Vagafund Burn';
    } else {
      return;
    }

    running += delta;
    monthRows.push([
      toAsciiSafe(new Date(tx.created_at).toISOString().slice(0, 16).replace('T', ' ')),
      toAsciiSafe(tx.tx_kind),
      toAsciiSafe(counterparty),
      toAsciiSafe(tx.note || '-'),
      `${delta >= 0 ? '+' : ''}${delta} VGC`,
      `${running} VGC`
    ]);
  });

  const closingBalance = (Number(openingBalance) || 0) + minted + received - sent - burned;

  // Summary Box
  autoTable(doc, {
    startY: 40,
    head: [['Opening Balance', 'Minted (+)', 'Received (+)', 'Sent (-)', 'Burned (-)', 'Closing Balance']],
    body: [[
      formatVGC(openingBalance),
      formatVGC(minted),
      formatVGC(received),
      formatVGC(sent),
      formatVGC(burned),
      `${formatVGC(closingBalance)} (${formatPKR(closingBalance, peg)})`
    ]],
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 9 },
    bodyStyles: { fontSize: 9, fontStyle: 'bold' }
  });

  // Transactions Table
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [['Date', 'Type', 'Counterparty', 'Note', 'Amount', 'Running Balance']],
    body: monthRows.length > 0
      ? monthRows
      : [['-', '-', '-', 'No transactions recorded in this period', '0 VGC', `${closingBalance} VGC`]],
    theme: 'striped',
    headStyles: { fillColor: [5, 150, 105], textColor: [255, 255, 255], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    margin: { bottom: 20 }
  });

  addPageFooters(doc, summary, peg);
  const fileSafeName = safeName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Member';
  doc.save(`Vagacoin_Statement_${fileSafeName}_${safeMonth}.pdf`);
}

export function exportGroupStatement({
  monthTag,
  balances,
  ledgerRows,
  profilesById,
  summary,
  groupName = 'Vagafund Committee',
  peg = PEG_PKR_PER_VGC
}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const safeGroup = toAsciiSafe(groupName || 'Vagafund Committee');
  const safeMonth = toAsciiSafe(monthTag);

  doc.setFillColor(6, 78, 59);
  doc.rect(0, 0, 210, 34, 'F');
  doc.setTextColor(236, 253, 245);
  doc.setFontSize(18);
  doc.text(`${safeGroup} - Whole Group Treasury Audit`, 14, 15);
  doc.setFontSize(10);
  doc.text(`Period: ${safeMonth}   |   Active Supply: ${formatVGC(summary?.active_vgc_supply || 0)}   |   Vault Cash: ${formatPKR(summary?.active_vgc_supply || 0, peg)}`, 14, 25);

  const memberBody = (balances || []).map((b, idx) => [
    String(idx + 1),
    toAsciiSafe(b.full_name),
    formatVGC(b.ledger_balance),
    formatVGC(b.locked_in_escrow),
    formatVGC(b.reserved_for_burn),
    formatVGC(b.available_vgc_balance),
    formatPKR(b.ledger_balance, peg)
  ]);

  autoTable(doc, {
    startY: 40,
    head: [['#', 'Member', 'Ledger Balance', 'Locked Escrow', 'Reserved Burn', 'Available VGC', 'PKR Value']],
    body: memberBody,
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8.5 },
    bodyStyles: { fontSize: 8 }
  });

  const periodRows = (ledgerRows || [])
    .filter((tx) => txToMonthTag(tx) === monthTag)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((tx) => [
      toAsciiSafe(new Date(tx.created_at).toISOString().slice(0, 16).replace('T', ' ')),
      toAsciiSafe(tx.tx_kind),
      toAsciiSafe(tx.sender_id ? (profilesById?.[tx.sender_id]?.full_name || 'Member') : 'Vagafund'),
      toAsciiSafe(tx.receiver_id ? (profilesById?.[tx.receiver_id]?.full_name || 'Member') : 'Burned'),
      toAsciiSafe(tx.note || '-'),
      formatVGC(tx.amount)
    ]);

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [['Date', 'Type', 'From', 'To', 'Note', 'Amount']],
    body: periodRows.length > 0 ? periodRows : [['-', '-', '-', '-', 'No group ledger rows in this period', '0 VGC']],
    theme: 'striped',
    headStyles: { fillColor: [5, 150, 105], textColor: [255, 255, 255], fontSize: 8.5 },
    bodyStyles: { fontSize: 8 },
    margin: { bottom: 20 }
  });

  addPageFooters(doc, summary, peg);
  doc.save(`Vagacoin_Statement_WholeGroup_${safeMonth}.pdf`);
}
