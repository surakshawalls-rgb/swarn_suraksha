import { Pipe, PipeTransform } from '@angular/core';

/** Short brand prefix shown on every invoice number. */
export const INVOICE_PREFIX = 'SS';

/** Indian financial year (1 April – 31 March) for a date, in IST, e.g. "2026-27". */
export function financialYearLabel(date: string | Date | null | undefined): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-IN', { year: 'numeric', month: 'numeric', timeZone: 'Asia/Kolkata' }).formatToParts(parsed);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '';
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Display format for the stored invoice sequence number, e.g. invoice 7 on 17 Nov 2026 → "SS/2026-27/00007".
 * This only changes how the number is shown and printed; the stored invoice_number is untouched.
 */
export function formatInvoiceNumber(invoiceNumber: number | string | null | undefined, createdAt?: string | Date | null): string {
  const digits = String(invoiceNumber ?? '').trim();
  if (!/^\d+$/.test(digits)) return digits ? `#${digits}` : '—';
  const fy = financialYearLabel(createdAt);
  const serial = digits.padStart(5, '0');
  return fy ? `${INVOICE_PREFIX}/${fy}/${serial}` : `${INVOICE_PREFIX}/${serial}`;
}

/** Same as formatInvoiceNumber but safe inside file names. */
export function invoiceNumberForFile(invoiceNumber: number | string | null | undefined, createdAt?: string | Date | null): string {
  return formatInvoiceNumber(invoiceNumber, createdAt).replace(/[\\/]/g, '-');
}

@Pipe({ name: 'invoiceNo', standalone: true })
export class InvoiceNumberPipe implements PipeTransform {
  transform(invoiceNumber: number | string | null | undefined, createdAt?: string | Date | null): string {
    return formatInvoiceNumber(invoiceNumber, createdAt);
  }
}