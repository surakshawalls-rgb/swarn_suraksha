import type { jsPDF } from 'jspdf';
import { formatFixed, parseFixed } from './decimal';

/** Plain, already-resolved data for one sales receipt. Amounts are decimal strings (e.g. "4973.77"). */
export interface ReceiptPdfData {
  business: string;
  invoiceNo: string;
  dateLabel: string;
  customer: string;
  mobile: string;
  lines: { description: string; metal: string; purity: string; weightG: string; rate: string; making: string; makingPct: string; taxable: string; gst: string; total: string }[];
  exchanges: { description: string; metal: string; purity: string; netG: string; deductionPct: string; acceptedG: string; rate: string; credit: string }[];
  returns: { item: string; reason: string; value: string; refund: string }[];
  summary: { taxable: string; gstPercent: string; gst: string; newTotal: string; exchangeCredit: string; net: string; previous: string; totalPayable: string; paid: string; balance: string; returned: string; refunded: string };
  payments: { method: string; amount: string; reference: string; date: string }[];
  note: string;
}

type RGB = [number, number, number];
interface Col { label: string; w: number; align: 'left' | 'right' | 'center'; }
interface Cell { t: string; s?: string; b?: boolean; wrap?: boolean; color?: RGB; }

const NAVY: RGB = [43, 38, 30];
const GOLD: RGB = [196, 154, 66];
const CREAM: RGB = [252, 249, 242];
const INK: RGB = [34, 40, 52];
const MUTED: RGB = [108, 115, 128];
const LINE: RGB = [228, 222, 208];
const GREEN: RGB = [28, 128, 84];
const RED: RGB = [186, 52, 52];
const AMBER: RGB = [200, 120, 20];
const WHITE: RGB = [255, 255, 255];

/** Draws a branded A4 sales receipt. Helvetica has no rupee glyph, so amounts use the "INR" label. */
export function renderReceiptPdf(pdf: jsPDF, d: ReceiptPdfData): void {
  const PW = 210, PH = 297, L = 14, W = 182, R = L + W, BOTTOM = 274;
  let y = 0;

  const fillC = (c: RGB) => pdf.setFillColor(c[0], c[1], c[2]);
  const drawC = (c: RGB) => pdf.setDrawColor(c[0], c[1], c[2]);
  const money = (v: string | null | undefined): string => {
    const s = formatFixed(parseFixed(v || '0', 2), 2);
    const neg = s.startsWith('-');
    const [whole, frac] = (neg ? s.slice(1) : s).split('.');
    return `${neg ? '-' : ''}${new Intl.NumberFormat('en-IN').format(Number(whole))}.${frac}`;
  };
  const isPositive = (v: string | null | undefined): boolean => parseFixed(v || '0', 2) > 0n;
  const qty = (v: string): string => {
    const n = Number(v);
    return Number.isFinite(n) ? String(parseFloat(n.toFixed(4))) : v;
  };
  const txt = (s: string, x: number, yy: number, size = 9, bold = false, color: RGB = INK, align: 'left' | 'right' | 'center' = 'left') => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(color[0], color[1], color[2]);
    pdf.text(s, x, yy, { align });
  };
  const wrap = (s: string, width: number, size: number, bold = false, maxLines = 3): string[] => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(s || '', width) as string[];
    if (lines.length <= maxLines) return lines;
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/\s+$/, '') + '...';
    return cut;
  };
  const fit = (s: string, width: number, size: number, bold = false): string => wrap(s, width, size, bold, 1)[0] ?? '';

  const drawHeader = () => {
    fillC(NAVY); pdf.rect(0, 0, PW, 42, 'F');
    fillC(GOLD); pdf.rect(0, 42, PW, 1.6, 'F');
    fillC(GOLD); pdf.circle(L + 9, 21, 9, 'F');
    drawC(NAVY); pdf.setLineWidth(0.5); pdf.circle(L + 9, 21, 7.4, 'S');
    txt((d.business.trim().charAt(0) || 'S').toUpperCase(), L + 9, 24.6, 16, true, NAVY, 'center');
    txt(fit(d.business, 100, 17, true), L + 23, 20, 17, true, WHITE);
    txt('SALES RECEIPT', L + 23, 28, 8.5, true, GOLD);
    txt('INVOICE NO.', R, 15, 7, true, GOLD, 'right');
    txt(d.invoiceNo, R, 22, 13, true, WHITE, 'right');
    txt(d.dateLabel, R, 29, 8.5, false, [200, 205, 218], 'right');
    y = 52;
  };
  const newPage = () => {
    pdf.addPage();
    fillC(NAVY); pdf.rect(0, 0, PW, 7, 'F');
    fillC(GOLD); pdf.rect(0, 7, PW, 1, 'F');
    txt(fit(d.business, 100, 8, true), L, 15, 8, true, NAVY);
    txt(`Invoice ${d.invoiceNo}`, R, 15, 8, false, MUTED, 'right');
    y = 22;
  };
  const ensure = (h: number): boolean => {
    if (y + h > BOTTOM) { newPage(); return true; }
    return false;
  };
  const heading = (title: string, caption = '') => {
    ensure(24);
    fillC(GOLD); pdf.rect(L, y, 1.4, 5.5, 'F');
    txt(title.toUpperCase(), L + 4, y + 4.4, 9.5, true, NAVY);
    if (caption) txt(caption, R, y + 4.4, 7, false, MUTED, 'right');
    y += 8.5;
  };
  const drawHead = (cols: Col[]) => {
    fillC(NAVY); pdf.roundedRect(L, y, W, 8, 1.5, 1.5, 'F');
    let x = L;
    for (const c of cols) {
      txt(c.label.toUpperCase(), c.align === 'right' ? x + c.w - 2.5 : c.align === 'center' ? x + c.w / 2 : x + 2.5, y + 5.2, 6.6, true, GOLD, c.align);
      x += c.w;
    }
    y += 8;
  };
  const table = (title: string, caption: string, cols: Col[], rows: Cell[][]) => {
    heading(title, caption);
    ensure(8 + 12);
    drawHead(cols);
    rows.forEach((row, i) => {
      const lines = row.map((cell, ci) => cell.wrap
        ? wrap(cell.t, cols[ci].w - 5, 8, !!cell.b, 3)
        : [fit(cell.t, cols[ci].w - 5, 8, !!cell.b)]);
      const rowH = Math.max(11.5, ...lines.map((l, ci) => l.length * 3.8 + (row[ci].s ? 3.6 : 0) + 5));
      if (y + rowH > BOTTOM) { newPage(); drawHead(cols); }
      if (i % 2 === 0) { fillC(CREAM); pdf.rect(L, y, W, rowH, 'F'); }
      let x = L;
      row.forEach((cell, ci) => {
        const col = cols[ci];
        const contentH = lines[ci].length * 3.8 + (cell.s ? 3.6 : 0);
        let by = y + (rowH - contentH) / 2 + 3;
        const tx = col.align === 'right' ? x + col.w - 2.5 : col.align === 'center' ? x + col.w / 2 : x + 2.5;
        for (const ln of lines[ci]) { txt(ln, tx, by, 8, !!cell.b, cell.color ?? INK, col.align); by += 3.8; }
        if (cell.s) txt(fit(cell.s, col.w - 5, 6.8), tx, by - 0.2, 6.8, false, MUTED, col.align);
        x += col.w;
      });
      drawC(LINE); pdf.setLineWidth(0.2); pdf.line(L, y + rowH, R, y + rowH);
      y += rowH;
    });
    y += 7;
  };

  // ───────── Page 1: header + customer / invoice cards
  drawHeader();
  const bal = parseFixed(d.summary.balance || '0', 2);
  const paidAmt = parseFixed(d.summary.paid || '0', 2);
  const status = bal === 0n ? { label: 'PAID', color: GREEN } : paidAmt > 0n ? { label: 'PART PAID', color: AMBER } : { label: 'UNPAID', color: RED };

  const cardH = 32;
  fillC(CREAM); drawC(LINE); pdf.setLineWidth(0.3);
  pdf.roundedRect(L, y, 88, cardH, 2, 2, 'FD');
  pdf.roundedRect(L + 94, y, 88, cardH, 2, 2, 'FD');
  txt('BILLED TO', L + 5, y + 7, 7, true, GOLD);
  txt(fit(d.customer || 'Walk-in customer', 78, 12, true), L + 5, y + 16, 12, true, NAVY);
  txt(d.mobile ? `Mobile: ${d.mobile}` : 'No mobile recorded', L + 5, y + 23, 9, false, MUTED);
  const rx = L + 94;
  txt('INVOICE DETAILS', rx + 5, y + 7, 7, true, GOLD);
  txt('Invoice no.', rx + 5, y + 14, 8, false, MUTED);
  txt(d.invoiceNo, rx + 83, y + 14, 9, true, NAVY, 'right');
  txt('Date', rx + 5, y + 20, 8, false, MUTED);
  txt(d.dateLabel, rx + 83, y + 20, 9, true, NAVY, 'right');
  txt('Status', rx + 5, y + 27, 8, false, MUTED);
  const bw = 26;
  fillC(status.color); pdf.roundedRect(rx + 83 - bw, y + 22.6, bw, 6, 3, 3, 'F');
  txt(status.label, rx + 83 - bw / 2, y + 26.7, 7, true, WHITE, 'center');
  y += cardH + 9;

  // ───────── Item tables
  table('New jewellery', 'Amounts in INR', [
    { label: '#', w: 8, align: 'center' },
    { label: 'Item', w: 38, align: 'left' },
    { label: 'Weight', w: 16, align: 'right' },
    { label: 'Rate / g', w: 24, align: 'right' },
    { label: 'Making', w: 26, align: 'right' },
    { label: 'Taxable', w: 26, align: 'right' },
    { label: 'GST', w: 20, align: 'right' },
    { label: 'Total', w: 24, align: 'right' },
  ], d.lines.length ? d.lines.map((l, i) => [
    { t: String(i + 1), color: MUTED },
    { t: l.description, b: true, s: `${l.metal.toUpperCase()}${l.purity ? ' · ' + l.purity : ''}` },
    { t: `${qty(l.weightG)} g` },
    { t: money(l.rate) },
    { t: money(l.making), s: l.makingPct ? `${qty(l.makingPct)}%` : undefined },
    { t: money(l.taxable) },
    { t: money(l.gst) },
    { t: money(l.total), b: true },
  ]) : [[{ t: '' }, { t: 'No item details available.', color: MUTED }, { t: '' }, { t: '' }, { t: '' }, { t: '' }, { t: '' }, { t: '' }]]);

  if (d.exchanges.length) {
    table('Old jewellery received (exchange)', 'Amounts in INR', [
      { label: '#', w: 8, align: 'center' },
      { label: 'Item', w: 58, align: 'left' },
      { label: 'Net wt', w: 20, align: 'right' },
      { label: 'Deduction', w: 22, align: 'right' },
      { label: 'Accepted', w: 22, align: 'right' },
      { label: 'Rate / g', w: 24, align: 'right' },
      { label: 'Credit', w: 28, align: 'right' },
    ], d.exchanges.map((e, i) => [
      { t: String(i + 1), color: MUTED },
      { t: e.description, b: true, s: `${e.metal.toUpperCase()} · ${e.purity}` },
      { t: `${qty(e.netG)} g` },
      { t: `${qty(e.deductionPct)}%` },
      { t: `${qty(e.acceptedG)} g` },
      { t: money(e.rate) },
      { t: money(e.credit), b: true, color: GREEN },
    ]));
  }

  if (d.returns.length) {
    table('Returned items', 'Amounts in INR', [
      { label: '#', w: 8, align: 'center' },
      { label: 'Item', w: 56, align: 'left' },
      { label: 'Reason', w: 58, align: 'left' },
      { label: 'Value', w: 30, align: 'right' },
      { label: 'Refund', w: 30, align: 'right' },
    ], d.returns.map((r, i) => [
      { t: String(i + 1), color: MUTED },
      { t: r.item, b: true },
      { t: r.reason, wrap: true },
      { t: money(r.value) },
      { t: money(r.refund), b: true },
    ]));
  }

  // ───────── Summary + payments
  const sRows: [string, string][] = [
    ['Taxable subtotal', money(d.summary.taxable)],
    [`GST (${qty(d.summary.gstPercent)}%)`, money(d.summary.gst)],
    ['New jewellery total', money(d.summary.newTotal)],
  ];
  if (isPositive(d.summary.exchangeCredit)) {
    sRows.push(['Old jewellery exchange', `- ${money(d.summary.exchangeCredit)}`]);
    sRows.push(['Net after exchange', money(d.summary.net)]);
  }
  if (isPositive(d.summary.previous)) sRows.push(['Previous outstanding', money(d.summary.previous)]);
  if (isPositive(d.summary.returned)) sRows.push(['Returned items', `- ${money(d.summary.returned)}`]);
  if (isPositive(d.summary.refunded)) sRows.push(['Refunded', money(d.summary.refunded)]);

  if(d.payments.length) table('Payment history','Amounts in INR',[
    {label:'Date',w:48,align:'left'},{label:'Method',w:32,align:'left'},{label:'Reference',w:62,align:'left'},{label:'Amount',w:40,align:'right'}
  ],d.payments.map(p=>[{t:p.date,wrap:true},{t:p.method.toUpperCase()},{t:p.reference||'-',wrap:true},{t:money(p.amount),b:true}]));
  const pw = 112, px = R - pw;
  const blockH = 5 + sRows.length * 6.4 + 3 + 11 + 3 + 7 + 3 + 13 + 8;
  ensure(blockH + 10);
  const top = y;
  fillC(CREAM); drawC(LINE); pdf.setLineWidth(0.3);
  pdf.roundedRect(px, top, pw, blockH, 2, 2, 'FD');
  let ry = top + 10;
  for (const [label, value] of sRows) {
    txt(label, px + 5, ry, 8.5, false, MUTED);
    txt(value, px + pw - 5, ry, 8.5, true, INK, 'right');
    ry += 6.4;
  }
  ry += 0.5;
  fillC(NAVY); pdf.roundedRect(px + 3, ry - 1, pw - 6, 11, 2, 2, 'F');
  txt('TOTAL PAYABLE', px + 7, ry + 5.9, 7.5, true, GOLD);
  txt(`INR ${money(d.summary.totalPayable)}`, px + pw - 7, ry + 6.2, 11, true, WHITE, 'right');
  ry += 17;
  txt('Amount paid', px + 5, ry, 8.5, false, MUTED);
  txt(`INR ${money(d.summary.paid)}`, px + pw - 5, ry, 9, true, GREEN, 'right');
  ry += 4;
  const due = bal > 0n;
  fillC(due ? [253, 238, 238] : [231, 245, 238]);
  pdf.roundedRect(px + 3, ry, pw - 6, 13, 2, 2, 'F');
  txt(due ? 'BALANCE DUE' : 'SETTLED', px + 7, ry + 8, 7.5, true, due ? RED : GREEN);
  txt(`INR ${money(d.summary.balance)}`, px + pw - 7, ry + 8.4, 12, true, due ? RED : GREEN, 'right');
  y = top + blockH + 8;

  // ───────── Note, thank-you and signatures
  const noteLines = wrap(d.note, W - 10, 7, false, 4);
  const noteH = noteLines.length * 3.5 + 8;
  ensure(noteH + 38);
  fillC([248, 246, 240]); pdf.roundedRect(L, y, W, noteH, 2, 2, 'F');
  let ny = y + 5.5;
  for (const ln of noteLines) { txt(ln, L + 5, ny, 7, false, MUTED); ny += 3.5; }
  y += noteH + 10;

  txt('Thank you for your business!', PW / 2, y, 11, true, NAVY, 'center');
  y += 17;
  drawC(MUTED); pdf.setLineWidth(0.25);
  pdf.line(L, y, L + 55, y); pdf.line(R - 55, y, R, y);
  txt('Customer signature', L + 27.5, y + 4.5, 7.5, false, MUTED, 'center');
  txt('Authorised signatory', R - 27.5, y + 4.5, 7.5, false, MUTED, 'center');

  // ───────── Footer on every page
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    drawC(LINE); pdf.setLineWidth(0.25); pdf.line(L, PH - 14, R, PH - 14);
    txt(`${fit(d.business, 100, 7)}  ·  Invoice ${d.invoiceNo}`, L, PH - 9.5, 7, false, MUTED);
    txt(`Page ${p} of ${pages}`, R, PH - 9.5, 7, false, MUTED, 'right');
    txt('SwarnaSuraksha | Developed by Suraksha Software | www.surakshasoftware.in', PW/2, PH-5.5, 7, false, MUTED, 'center');
    fillC(NAVY); pdf.rect(0, PH - 4, PW, 4, 'F');
    fillC(GOLD); pdf.rect(0, PH - 4, PW, 0.9, 'F');
  }
}