import type { jsPDF } from 'jspdf';

export interface BusinessLetterhead { name: string; lines: string[]; }
const clean = (v: unknown): string => typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : '';
const join = (values: unknown[], separator = ' | '): string => [...new Set(values.map(clean).filter(Boolean))].join(separator);
const labelled = (label: string, value: unknown): string => clean(value) ? `${label}: ${clean(value)}` : '';
export function buildBusinessLetterhead(profile: Record<string, unknown>, settings: Record<string, unknown> = {}): BusinessLetterhead {
  const address = (profile['address'] && typeof profile['address'] === 'object' ? profile['address'] : {}) as Record<string, unknown>;
  const name = clean(profile['business_name']) || 'Jewellery Business';
  const legal = clean(profile['legal_name']);
  const show = (key: string) => settings[key] !== false;
  const lines = [
    show('show_tagline') ? clean(profile['tagline']) : '',
    join([legal && legal !== name ? labelled('Legal name', legal) : '', show('show_proprietor') ? labelled('Proprietor', profile['proprietor_name']) : '', labelled('Est.', profile['established_year'])]),
    join([address['shop_number'], address['building_name'], address['street'], address['line1'], show('show_landmark') ? address['landmark'] : '', address['locality'], address['village'], address['city'], address['district'], address['state'], address['postal_code'] || address['pincode'], address['country']], ', '),
    join([labelled('Phone', join([profile['phone'], profile['alternate_phone']], ', ')), show('show_whatsapp') ? labelled('WhatsApp', profile['whatsapp_number']) : '']),
    join([labelled('Email', profile['email']), show('show_website') ? clean(profile['website']) : '']),
    join([show('show_gstin') ? labelled('GSTIN', profile['gst_number']) : '', labelled('BIS registration', profile['bis_registration_number']), labelled('Trade licence', profile['trade_licence_number'])])
  ].filter(Boolean);
  return { name, lines };
}

/** Shared A4 letterhead. Returns the next available body baseline. */
export function drawBusinessLetterhead(pdf: jsPDF, header: BusinessLetterhead, title: string, reference: string): number {
  const width = pdf.internal.pageSize.getWidth();
  const center = width / 2;
  let y = 12;
  pdf.setTextColor(43, 38, 30);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(19);
  const names = pdf.splitTextToSize(header.name, width - 28) as string[];
  for (const line of names) { if (y > 175) throw new Error('Business name is too long for printing.'); pdf.text(line, center, y, {align:'center'}); y += 7; }
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
  for (const detail of header.lines) {
    for (const line of pdf.splitTextToSize(detail, width - 28) as string[]) {
      if (y > 175) throw new Error('Business letterhead is too long. Shorten the business profile before printing.');
      pdf.text(line, center, y, {align:'center'}); y += 4.4;
    }
  }
  pdf.setDrawColor(181,138,57); pdf.setLineWidth(0.6); pdf.line(14,y,width-14,y); y += 7;
  pdf.setFont('helvetica','bold'); pdf.setFontSize(11);
  for (const line of pdf.splitTextToSize(title, width-28) as string[]) { pdf.text(line,center,y,{align:'center'}); y+=5; }
  pdf.setFont('helvetica','normal'); pdf.setFontSize(9);
  for (const line of pdf.splitTextToSize(reference,width-28) as string[]) { pdf.text(line,center,y,{align:'center'}); y+=4.5; }
  return y+5;
}
