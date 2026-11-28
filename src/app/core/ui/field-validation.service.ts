import { Injectable } from '@angular/core';

/**
 * Central field validation for every <input> and <textarea> in the app.
 *
 * It is purely a presentation / input-hygiene layer: it never touches component state, services or
 * business logic. It works with delegated DOM events (like UiPrefsService does for language), so every
 * existing form is covered without editing each component:
 *   - while typing: removes characters a field can never accept (letters in a mobile number, digits in a name ...)
 *   - on blur / change: shows an inline message under the field
 *   - on form submit: if any field is invalid the submit is stopped (ngSubmit does not run) and the first
 *     invalid field is focused
 * Fields are recognised by their name / type / autocomplete / placeholder. Add data-no-validate to opt out.
 */

export type FieldKind =
  | 'mobile' | 'email' | 'personName' | 'businessName' | 'newPassword' | 'confirmPassword'
  | 'pin' | 'gstin' | 'pan' | 'year' | 'website' | 'address' | 'place' | 'shop' | 'alnumId'
  | 'money' | 'weight' | 'rate' | 'text' | 'notes' | 'reason' | 'reference' | 'purity'
  | 'date' | 'number' | 'search' | 'plain';

export interface FieldInfo {
  name: string;          // field name with a trailing row index removed ("itemWeight2" -> "itemWeight")
  type: string;
  autocomplete: string;
  placeholder: string;
  tag: string;           // 'input' | 'textarea'
}

const MAX_DATE = '2100-12-31';
const MIN_DATE = '1990-01-01';
const INVALID_CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const NAME_CHARS = /[^\p{L}\p{M}\s.'’-]/gu;
const BUSINESS_CHARS = /[^\p{L}\p{M}\p{N}\s&.,'’()/-]/gu;
const ADDRESS_CHARS = /[^\p{L}\p{M}\p{N}\s,.\-/#()&'’:]/gu;
const PLACE_CHARS = /[^\p{L}\p{M}\s.'’-]/gu;
const GSTIN_RE = /^(0[1-9]|[12]\d|3[0-8]|97|99)[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

/** Decides which rule applies to a field. */
export function kindOf(f: FieldInfo): FieldKind {
  const n = f.name;
  if (f.type === 'search' || /search/i.test(n)) return 'search';
  if (f.type === 'date') return 'date';
  if (f.type === 'password') {
    if (/^confirmPassword$/i.test(n)) return 'confirmPassword';
    if (f.autocomplete === 'new-password' || /^newPassword$/i.test(n)) return 'newPassword';
    return 'plain'; // current password: only "required" applies, so existing users can still sign in
  }
  if (f.type === 'number') return 'number'; // honours the field's own min / max / step
  if (f.type === 'email' || /email/i.test(n) || f.autocomplete === 'email') return 'email';
  if (/^(phone|alternate_phone|whatsapp_number)$/i.test(n) || /(mobile|phone|whatsapp)/i.test(n) || f.autocomplete === 'tel') return 'mobile';
  if (/^(customerName|newName|newCustomerName|contact_name)$/i.test(n) || f.autocomplete === 'name') return 'personName';
  if (/^(supplierName|business_name|legal_name|expensePayee|soldTo)$/i.test(n) || f.autocomplete === 'organization') return 'businessName';
  if (/^(postal_code|pincode|pin_code)$/i.test(n)) return 'pin';
  if (/^gst(in|_number)?$/i.test(n)) return 'gstin';
  if (/^pan(_number)?$/i.test(n)) return 'pan';
  if (/^established_year$/i.test(n)) return 'year';
  if (/^website$/i.test(n)) return 'website';
  if (/^(city|district|state)$/i.test(n)) return 'place';
  if (/^shop_number$/i.test(n)) return 'shop';
  if (/^(bis_registration_number|trade_licence_number)$/i.test(n)) return 'alnumId';
  if (/(address|street|landmark|locality|building_name)/i.test(n) || /street-address/.test(f.autocomplete)) return 'address';
  if (/reason/i.test(n) || /reason/i.test(f.placeholder)) return 'reason';
  if (/reference/i.test(n)) return 'reference';
  if (/purity$/i.test(n)) return 'purity';
  if (/^itemCost$/i.test(n)) return 'money';
  if (/(weight|gross)$/i.test(n) || /^net$/i.test(n)) return 'weight';
  if (/(rate|cost)$/i.test(n)) return 'rate';
  if (/(amount|paid|extra|manualvalue|principal)$/i.test(n)) return 'money';
  if (/(description|category|itemname|condition|tagline|note)/i.test(n)) return f.tag === 'textarea' ? 'notes' : 'text';
  if (f.tag === 'textarea') return 'notes';
  return 'text';
}

function decimals(v: string, maxInt: number, maxDec: number): string {
  let s = v.replace(/,/g, '').replace(/[^0-9.]/g, '');
  const dot = s.indexOf('.');
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  const hasDot = s.includes('.');
  let [whole, frac] = s.split('.');
  whole = whole.replace(/^0+(?=\d)/, '').slice(0, maxInt);
  if (!hasDot) return whole;
  if (whole === '') whole = '0';
  return `${whole}.${(frac ?? '').slice(0, maxDec)}`;
}

/** Removes characters the field can never accept. Safe to run repeatedly (idempotent). */
export function sanitize(kind: FieldKind, v: string): string {
  switch (kind) {
    case 'mobile': {
      let d = v.replace(/\D/g, '');
      if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
      else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
      return d.slice(0, 10);
    }
    case 'personName': return v.replace(NAME_CHARS, '').replace(/^\s+/, '').replace(/\s{2,}/g, ' ').slice(0, 80);
    case 'businessName': return v.replace(BUSINESS_CHARS, '').replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
    case 'place': return v.replace(PLACE_CHARS, '').replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
    case 'address': return v.replace(ADDRESS_CHARS, '').replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
    case 'pin': return v.replace(/\D/g, '').slice(0, 6);
    case 'year': return v.replace(/\D/g, '').slice(0, 4);
    case 'gstin': return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
    case 'pan': return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    case 'shop':
    case 'alnumId': return v.replace(/[^\p{L}\p{N}\s/-]/gu, '').replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
    case 'money': return decimals(v, 10, 2);
    case 'weight': return decimals(v, 7, 4);
    case 'rate': return decimals(v, 8, 6);
    case 'reference': return v.replace(/[^\p{L}\p{N}\s\-_/.#:]/gu, '').replace(/^\s+/, '');
    case 'purity': return v.replace(/[^0-9A-Za-z .%+/-]/g, '').replace(/^\s+/, '');
    case 'website': return v.replace(/\s/g, '');
    case 'text': return v.replace(INVALID_CTRL, '').replace(/[<>]/g, '').replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
    case 'reason': return v.replace(INVALID_CTRL, '').replace(/^\s+/, '');
    case 'search': return v.replace(INVALID_CTRL, '');
    case 'notes': return v.replace(INVALID_CTRL, '');
    default: return v;
  }
}

/** Final tidy-up when leaving a field (trims; drops a dangling decimal point). */
export function tidy(kind: FieldKind, v: string): string {
  if (kind === 'newPassword' || kind === 'confirmPassword' || kind === 'plain' || kind === 'number' || kind === 'date' || kind === 'search') return v;
  let s = v.trim();
  if ((kind === 'money' || kind === 'weight' || kind === 'rate') && s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

export function passwordProblems(pw: string, emailLocal = ''): string[] {
  const missing: string[] = [];
  if (pw.length < 8) missing.push('at least 8 characters');
  if (!/[A-Z]/.test(pw)) missing.push('an uppercase letter (A-Z)');
  if (!/[a-z]/.test(pw)) missing.push('a lowercase letter (a-z)');
  if (!/[0-9]/.test(pw)) missing.push('a number (0-9)');
  if (!/[^A-Za-z0-9\s]/.test(pw)) missing.push('a special character (! @ # $ % ...)');
  if (pw.length > 72) missing.push('no more than 72 characters');
  if (/\s/.test(pw)) missing.push('no spaces');
  return missing;
}

export interface ValidateOptions {
  required: boolean;
  minLength: number;     // from the minlength attribute, or 0
  maxLength: number;     // from the maxlength attribute, or 0
  min: string;           // min attribute (number / date), or ''
  max: string;           // max attribute (number / date), or ''
  badInput: boolean;     // browser says the typed text is not a valid number / date
  stepMismatch: boolean;
  name: string;          // field name without row index
  emailLocal: string;    // email typed in the same form (used to stop "password contains email")
  compare: string | null; // value of the paired field (confirm password, net vs gross, date range)
}

/** Returns an error message, or '' when the value is acceptable. */
export function validateValue(kind: FieldKind, raw: string, o: ValidateOptions): string {
  const v = kind === 'newPassword' || kind === 'confirmPassword' || kind === 'plain' ? raw : raw.trim();
  if (v === '') {
    if (o.badInput) return kind === 'date' ? 'Enter a valid date.' : 'Enter a valid number.';
    return o.required ? 'This field is required.' : '';
  }
  if (o.minLength && v.length < o.minLength && kind !== 'mobile') return `Enter at least ${o.minLength} characters.`;
  const letters = (v.match(/\p{L}/gu) ?? []).length;
  switch (kind) {
    case 'mobile': {
      const d = v.replace(/\D/g, '');
      if (!/^\d+$/.test(v)) return 'Mobile number can contain digits only.';
      if (d.length !== 10) return 'Enter a 10-digit mobile number.';
      if (!/^[6-9]/.test(d)) return 'Mobile number must start with 6, 7, 8 or 9.';
      if (/^(\d)\1{9}$/.test(d)) return 'Enter a real mobile number.';
      return '';
    }
    case 'email': {
      if (v.length > 254) return 'Email address is too long.';
      const m = /^([A-Za-z0-9._%+'-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})$/.exec(v);
      if (!m || m[1].length > 64 || m[1].startsWith('.') || m[1].endsWith('.') || /\.\./.test(v) || /(^-|-\.|\.-|-$)/.test(m[2])) return 'Enter a valid email address, e.g. name@example.com.';
      return '';
    }
    case 'personName':
      if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(v) || letters < 2) return 'Name can contain only letters, spaces, . \' and - (no numbers or symbols), minimum 2 letters.';
      if (v.length > (o.maxLength || 80)) return `Name must be ${o.maxLength || 80} characters or fewer.`;
      return '';
    case 'businessName':
      if (letters < 1 || v.length < 2) return 'Enter a valid name (at least 2 characters, including a letter).';
      if (/[^\p{L}\p{M}\p{N}\s&.,'’()/-]/u.test(v)) return 'Name has unsupported characters.';
      if (v.length > (o.maxLength || 160)) return `Must be ${o.maxLength || 160} characters or fewer.`;
      return '';
    case 'newPassword': {
      const local = o.emailLocal.length >= 4 ? o.emailLocal.toLowerCase() : '';
      const problems = passwordProblems(v);
      if (problems.length) return `Password needs ${problems.join(', ')}.`;
      if (local && v.toLowerCase().includes(local)) return 'Password must not contain your email name.';
      if (/(password|qwerty|123456|abcdef|letmein|admin)/i.test(v)) return 'Choose a less common password.';
      if (/(.)\1{3,}/.test(v)) return 'Avoid repeating the same character 4 or more times.';
      return '';
    }
    case 'confirmPassword':
      return o.compare !== null && v !== o.compare ? 'Passwords do not match.' : '';
    case 'pin':
      return /^[1-9]\d{5}$/.test(v) ? '' : 'Enter a valid 6-digit PIN code.';
    case 'gstin':
      return GSTIN_RE.test(v) ? '' : 'Enter a valid 15-character GSTIN, e.g. 22AAAAA0000A1Z5.';
    case 'pan':
      return PAN_RE.test(v) ? '' : 'Enter a valid PAN, e.g. ABCDE1234F.';
    case 'year': {
      const y = Number(v);
      return /^\d{4}$/.test(v) && y >= 1800 && y <= new Date().getFullYear() ? '' : `Enter a 4-digit year between 1800 and ${new Date().getFullYear()}.`;
    }
    case 'website': {
      if (v.length > 200) return 'Website address is too long.';
      return /^(https?:\/\/)?([A-Za-z0-9-]+\.)+[A-Za-z]{2,}(:\d+)?(\/[^\s]*)?$/i.test(v) ? '' : 'Enter a valid website, e.g. www.example.com.';
    }
    case 'place':
      return letters >= 2 && !/[^\p{L}\p{M}\s.'’-]/u.test(v) ? '' : 'Use letters only (minimum 2).';
    case 'shop':
    case 'alnumId':
      if (/[^\p{L}\p{N}\s/-]/u.test(v)) return 'Use letters, numbers, space, / or - only.';
      return v.length > 30 ? 'Must be 30 characters or fewer.' : '';
    case 'address':
      if (/[^\p{L}\p{M}\p{N}\s,.\-/#()&'’:]/u.test(v)) return 'Address has unsupported characters.';
      if (v.length < 3 || !/[\p{L}\p{N}]/u.test(v)) return 'Enter at least 3 characters.';
      return v.length > (o.maxLength || 300) ? `Must be ${o.maxLength || 300} characters or fewer.` : '';
    case 'money': {
      if (!/^\d+(\.\d{1,2})?$/.test(v)) return 'Enter a valid amount (up to 2 decimals), e.g. 1500 or 1500.50.';
      const n = Number(v);
      if (n > 9999999999.99) return 'Amount is too large.';
      if ((o.required || /amount$/i.test(o.name)) && n <= 0) return 'Amount must be greater than zero.';
      return '';
    }
    case 'weight': {
      if (!/^\d+(\.\d{1,4})?$/.test(v)) return 'Enter a valid weight in grams (up to 4 decimals).';
      const n = Number(v);
      if (n <= 0) return 'Weight must be greater than zero.';
      if (o.compare !== null && o.compare !== '' && /^net$/i.test(o.name) && n > Number(o.compare)) return 'Net weight cannot be more than gross weight.';
      return '';
    }
    case 'rate': {
      if (!/^\d+(\.\d{1,6})?$/.test(v)) return 'Enter a valid rate (up to 6 decimals).';
      return Number(v) <= 0 ? 'Rate must be greater than zero.' : '';
    }
    case 'purity':
      return /[0-9A-Za-z]/.test(v) && v.length <= 40 ? '' : 'Enter a valid purity, e.g. 22K or 916.';
    case 'reason': {
      const min = /^returnReason$/i.test(o.name) ? 3 : 5;
      return v.length < min ? `Enter a reason of at least ${min} characters.` : (v.length > (o.maxLength || 1000) ? 'Reason is too long.' : '');
    }
    case 'reference':
      if (/[^\p{L}\p{N}\s\-_/.#:]/u.test(v)) return 'Reference can contain letters, numbers, space and - _ / . # : only.';
      return v.length > (o.maxLength || 120) ? 'Reference is too long.' : '';
    case 'text':
      if (!/[\p{L}\p{N}]/u.test(v)) return 'Enter a valid value (must contain a letter or number).';
      if (/[<>]/.test(v)) return 'The characters < and > are not allowed.';
      if (v.length < (o.required ? 2 : 1)) return 'Enter at least 2 characters.';
      return v.length > (o.maxLength || 200) ? `Must be ${o.maxLength || 200} characters or fewer.` : '';
    case 'notes':
      return v.length > (o.maxLength || 2000) ? `Must be ${o.maxLength || 2000} characters or fewer.` : '';
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return 'Enter a valid date.';
      if (v < MIN_DATE || v > MAX_DATE) return 'Enter a date between 1990 and 2100.';
      if (o.min && v < o.min) return `Date cannot be before ${o.min}.`;
      if (o.max && v > o.max) return `Date cannot be after ${o.max}.`;
      if (o.compare && /through|to$/i.test(o.name) && v < o.compare) return 'End date cannot be before the start date.';
      if (o.compare && /from/i.test(o.name) && v > o.compare) return 'Start date cannot be after the end date.';
      return '';
    }
    case 'number': {
      const n = Number(v);
      if (o.badInput || !Number.isFinite(n)) return 'Enter a valid number.';
      if (o.min !== '' && n < Number(o.min)) return `Must be at least ${o.min}.`;
      if (o.max !== '' && n > Number(o.max)) return `Must be at most ${o.max}.`;
      if (o.stepMismatch) return 'Enter a value with fewer decimal places.';
      return '';
    }
    default:
      return '';
  }
}

const MAX_LENGTH: Partial<Record<FieldKind, number>> = {
  personName: 80, businessName: 160, text: 200, notes: 2000, address: 300, place: 60, shop: 30, alnumId: 30,
  search: 100, pin: 6, gstin: 15, pan: 10, year: 4, reason: 1000, reference: 120, purity: 40, website: 200,
  email: 254, newPassword: 72, confirmPassword: 72, money: 13, weight: 12, rate: 16
};
const INPUT_MODE: Partial<Record<FieldKind, string>> = {
  mobile: 'numeric', pin: 'numeric', year: 'numeric', money: 'decimal', weight: 'decimal', rate: 'decimal', email: 'email'
};
const DATE_PAIRS: [string, string][] = [
  ['auditFrom', 'auditThrough'], ['cashbookFrom', 'cashbookTo'], ['inventoryFrom', 'inventoryThrough'],
  ['statementFrom', 'statementThrough'], ['fromDate', 'throughDate']
];
const SKIP_TYPES = new Set(['checkbox', 'radio', 'hidden', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image']);

const STYLE = `
.ss-field-error { display: block; margin: 5px 0 0; color: #b3261e; font-size: 12.5px; font-weight: 500; line-height: 1.4; letter-spacing: 0; text-transform: none; white-space: normal; }
html[data-ss-theme='dark'] .ss-field-error { color: #ff9a8f; }
input[aria-invalid='true'], textarea[aria-invalid='true'] { border-color: #c0392b !important; box-shadow: 0 0 0 3px rgba(192, 57, 43, .14) !important; }
`;

@Injectable({ providedIn: 'root' })
export class FieldValidationService {
  private started = false;
  private seq = 0;
  private readonly touched = new WeakSet<Element>();
  private readonly messages = new WeakMap<Element, HTMLElement>();
  private readonly lastUserValue = new WeakMap<Element, string>();
  private readonly shown = new Set<HTMLInputElement | HTMLTextAreaElement>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  /** Called once from the root component. */
  start(): void {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;
    const style = document.createElement('style');
    style.id = 'ss-field-validation';
    style.textContent = STYLE;
    document.head.appendChild(style);

    document.addEventListener('focusin', e => { const f = this.field(e.target); if (f) this.prepare(f); }, true);
    document.addEventListener('keydown', e => this.onKeydown(e), true);
    document.addEventListener('input', e => this.onInput(e), true);
    document.addEventListener('compositionend', e => this.onInput(e), true);
    document.addEventListener('focusout', e => this.onBlur(e), true);
    document.addEventListener('change', e => this.onChange(e), true);
    document.addEventListener('submit', e => this.onSubmit(e), true);
    document.addEventListener('click', () => this.scheduleRefresh(), true);
  }

  // ---------- field helpers ----------
  private field(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return null;
    if (target instanceof HTMLInputElement && SKIP_TYPES.has((target.getAttribute('type') || 'text').toLowerCase())) return null;
    if (target.readOnly || target.hasAttribute('data-no-validate') || target.closest('[data-no-validate]')) return null;
    return target;
  }

  private info(el: HTMLInputElement | HTMLTextAreaElement): FieldInfo {
    return {
      name: (el.getAttribute('name') || el.name || el.id || '').replace(/\d+$/, ''),
      type: (el.getAttribute('type') || 'text').toLowerCase(),
      autocomplete: (el.getAttribute('autocomplete') || '').toLowerCase(),
      placeholder: el.getAttribute('placeholder') || '',
      tag: el.tagName.toLowerCase()
    };
  }

  private kind(el: HTMLInputElement | HTMLTextAreaElement): FieldKind { return kindOf(this.info(el)); }

  /** Sets sensible max length / keyboard hints the first time a field is used. */
  private prepare(el: HTMLInputElement | HTMLTextAreaElement): void {
    const kind = this.kind(el);
    const max = MAX_LENGTH[kind];
    if (max && el.maxLength < 0) el.maxLength = max;
    const mode = INPUT_MODE[kind];
    if (mode && !el.getAttribute('inputmode')) el.setAttribute('inputmode', mode);
    if (kind === 'personName' && !el.getAttribute('autocapitalize')) el.setAttribute('autocapitalize', 'words');
    if ((kind === 'gstin' || kind === 'pan') && !el.getAttribute('autocapitalize')) el.setAttribute('autocapitalize', 'characters');
  }

  private form(el: Element): ParentNode { return el.closest('form') ?? document; }

  private options(el: HTMLInputElement | HTMLTextAreaElement, kind: FieldKind): ValidateOptions {
    const info = this.info(el);
    const scope = this.form(el);
    const q = (sel: string) => scope.querySelector<HTMLInputElement>(sel);
    let compare: string | null = null;
    let emailLocal = '';
    if (kind === 'confirmPassword') compare = q('input[name="newPassword"]')?.value ?? null;
    if (kind === 'newPassword') {
      const email = q('input[type="email"]')?.value ?? '';
      emailLocal = email.includes('@') ? email.split('@')[0] : '';
    }
    if (kind === 'weight' && /^net$/i.test(info.name)) {
      const index = /\d+$/.exec(el.getAttribute('name') || '')?.[0] ?? '';
      compare = q(`input[name="gross${index}"]`)?.value ?? null;
    }
    if (kind === 'date') {
      const own = el.getAttribute('name') || '';
      for (const [from, through] of DATE_PAIRS) {
        if (own === from) compare = document.querySelector<HTMLInputElement>(`input[name="${through}"]`)?.value ?? null;
        if (own === through) compare = document.querySelector<HTMLInputElement>(`input[name="${from}"]`)?.value ?? null;
      }
    }
    const input = el as HTMLInputElement;
    return {
      required: el.required,
      minLength: el.minLength > 0 ? el.minLength : 0,
      maxLength: el.maxLength > 0 ? el.maxLength : 0,
      min: input.min ?? '', max: input.max ?? '',
      badInput: !!el.validity?.badInput, stepMismatch: !!el.validity?.stepMismatch,
      name: info.name, emailLocal, compare: compare === '' ? (kind === 'confirmPassword' ? '' : null) : compare
    };
  }

  private check(el: HTMLInputElement | HTMLTextAreaElement): string {
    const kind = this.kind(el);
    return validateValue(kind, el.value, this.options(el, kind));
  }

  // ---------- messages ----------
  private show(el: HTMLInputElement | HTMLTextAreaElement, message: string): void {
    let node = this.messages.get(el);
    if (!message) {
      node?.remove();
      this.messages.delete(el);
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
      this.shown.delete(el);
      return;
    }
    if (!node || !node.isConnected) {
      node = document.createElement('small');
      node.className = 'ss-field-error';
      node.id = `ss-err-${++this.seq}`;
      node.setAttribute('role', 'alert');
      node.setAttribute('data-no-translate', '');
      el.insertAdjacentElement('afterend', node);
      this.messages.set(el, node);
    }
    if (node.textContent !== message) node.textContent = message;
    el.setAttribute('aria-invalid', 'true');
    el.setAttribute('aria-describedby', node.id);
    this.shown.add(el);
  }

  private validateAndShow(el: HTMLInputElement | HTMLTextAreaElement): string {
    const message = this.check(el);
    this.show(el, message);
    return message;
  }

  /** A related field (confirm password, gross weight, other end of a date range) may need re-checking. */
  private revalidateRelated(el: HTMLInputElement | HTMLTextAreaElement): void {
    const kind = this.kind(el);
    const scope = this.form(el);
    const related: (HTMLInputElement | null)[] = [];
    if (kind === 'newPassword') related.push(scope.querySelector('input[name="confirmPassword"]'));
    if (kind === 'weight') related.push(scope.querySelector(`input[name="net${/\d+$/.exec(el.getAttribute('name') || '')?.[0] ?? ''}"]`));
    if (kind === 'date') {
      const own = el.getAttribute('name') || '';
      for (const [from, through] of DATE_PAIRS) {
        if (own === from) related.push(document.querySelector(`input[name="${through}"]`));
        if (own === through) related.push(document.querySelector(`input[name="${from}"]`));
      }
    }
    for (const other of related) if (other && this.touched.has(other)) this.validateAndShow(other);
  }

  // ---------- events ----------
  private onKeydown(e: KeyboardEvent): void {
    const el = this.field(e.target);
    if (!el || !(el instanceof HTMLInputElement) || el.type !== 'number' || e.ctrlKey || e.metaKey) return;
    const nonNegative = el.min !== '' && Number(el.min) >= 0;
    if (e.key === 'e' || e.key === 'E' || e.key === '+' || (e.key === '-' && nonNegative)) e.preventDefault();
  }

  private onInput(e: Event): void {
    const el = this.field(e.target);
    if (!el || (e as InputEvent).isComposing) return;
    const kind = this.kind(el);
    const before = el.value;
    const after = sanitize(kind, before);
    if (after !== before) {
      const caret = el.selectionStart;
      el.value = after;
      if (caret !== null) {
        const keep = sanitize(kind, before.slice(0, caret)).length;
        try { el.setSelectionRange(keep, keep); } catch { /* types without selection support */ }
      }
    }
    this.lastUserValue.set(el, el.value);
    if (kind === 'newPassword' || kind === 'confirmPassword') this.touched.add(el);
    if (this.touched.has(el) || this.messages.has(el)) {
      this.validateAndShow(el);
      this.revalidateRelated(el);
    }
    this.scheduleRefresh();
  }

  private onBlur(e: FocusEvent): void {
    const el = this.field(e.target);
    if (!el) return;
    const kind = this.kind(el);
    const tidied = tidy(kind, el.value);
    if (tidied !== el.value) {
      el.value = tidied;
      el.dispatchEvent(new Event('input', { bubbles: true })); // lets ngModel pick up the trimmed value
    }
    this.lastUserValue.set(el, el.value);
    this.touched.add(el);
    // Shown a moment later so the message appearing never shifts a button away from the user's finger mid-tap.
    // (A submit validates everything immediately anyway.)
    setTimeout(() => { if (el.isConnected) { this.validateAndShow(el); this.revalidateRelated(el); } }, 250);
  }

  private onChange(e: Event): void {
    const el = this.field(e.target);
    if (!el || el.type !== 'date') return;
    this.touched.add(el);
    this.validateAndShow(el);
    this.revalidateRelated(el);
  }

  private onSubmit(e: Event): void {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const invalid: (HTMLInputElement | HTMLTextAreaElement)[] = [];
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(el => {
      if (!this.field(el) || el.disabled || (el as HTMLInputElement).readOnly) return;
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return; // hidden field
      const kind = this.kind(el);
      // legacy saved numbers such as "+91 98765 43210" are tidied rather than rejected
      if (kind === 'mobile') {
        const clean = sanitize('mobile', el.value);
        if (clean !== el.value && /^\d{10}$/.test(clean)) { el.value = clean; el.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      this.touched.add(el);
      if (this.validateAndShow(el)) invalid.push(el);
    });
    if (invalid.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const target: HTMLElement = invalid[0];
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /** After clicks / typing: refresh messages whose value was changed by the app (form reset, mode switch ...). */
  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      for (const el of Array.from(this.shown)) {
        if (!el.isConnected) { this.shown.delete(el); continue; }
        const changedByApp = el.value !== (this.lastUserValue.get(el) ?? el.value);
        if (changedByApp && el.value === '') { this.touched.delete(el); this.show(el, ''); continue; }
        this.show(el, this.check(el));
      }
    }, 200);
  }
}