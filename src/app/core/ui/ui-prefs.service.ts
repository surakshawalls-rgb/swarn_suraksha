import { Injectable } from '@angular/core';
import { LABELS, PATTERNS, TEXT } from './translations';

export type ThemeMode = 'auto' | 'day' | 'night';
export type AppLanguage = 'en' | 'hinglish' | 'hi';

/** Night-mode styles. Injected by the service so Night mode works without any extra stylesheet entry. */
const DARK_CSS = `
html[data-ss-theme='dark'] { color-scheme: dark; }
html[data-ss-theme='dark'] body,
html[data-ss-theme='dark'] .app-main { background: #131b16 !important; }
html[data-ss-theme='dark'] .app-main .topbar,
html[data-ss-theme='dark'] .app-main .content > :not(.stock-modal-backdrop):not(.receipt-overlay):not([role='dialog']) {
  filter: invert(1) hue-rotate(180deg) contrast(.92);
}
html[data-ss-theme='dark'] .app-main .primary-btn,
html[data-ss-theme='dark'] .app-main .create-button,
html[data-ss-theme='dark'] .app-main .btn-save,
html[data-ss-theme='dark'] .app-main .btn-pdf,
html[data-ss-theme='dark'] .app-main .btn-whatsapp,
html[data-ss-theme='dark'] .app-main .rate-card,
html[data-ss-theme='dark'] .app-main .brand-mark,
html[data-ss-theme='dark'] .app-main .avatar,
html[data-ss-theme='dark'] .app-main .customer-row-avatar,
html[data-ss-theme='dark'] .app-main .home-action-icon,
html[data-ss-theme='dark'] .app-main img {
  filter: contrast(1.087) hue-rotate(180deg) invert(1);
}
html[data-ss-theme='dark'] .app-main .panel,
html[data-ss-theme='dark'] .app-main .setup-card,
html[data-ss-theme='dark'] .app-main .home-action,
html[data-ss-theme='dark'] .app-main .activity-card,
html[data-ss-theme='dark'] .app-main table { box-shadow: none; }
`;

/** WhatsApp-style green buttons. Injected with the service so they work without any extra stylesheet entry. */
const WHATSAPP_CSS = `
.btn-whatsapp, .text-btn.btn-whatsapp, .primary-btn.btn-whatsapp {
  display: inline-flex !important; align-items: center; justify-content: center; gap: 8px;
  color: #ffffff !important; font-weight: 700 !important; letter-spacing: .1px;
  border: 1px solid #128c7e !important; border-radius: 10px;
  background: linear-gradient(180deg, #34e07a 0%, #25d366 48%, #1faa52 100%) !important;
  box-shadow: 0 1px 0 rgba(255, 255, 255, .4) inset, 0 8px 16px -8px rgba(18, 140, 126, .85) !important;
  text-shadow: 0 1px 1px rgba(7, 94, 84, .35);
  transition: transform .16s ease, filter .16s ease, box-shadow .16s ease;
}
.btn-whatsapp:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
.btn-whatsapp:active:not(:disabled) { transform: translateY(0); filter: brightness(.96); }
.btn-whatsapp:disabled { opacity: .6; cursor: not-allowed; }
.btn-whatsapp:focus-visible { outline: 2px solid #075e54; outline-offset: 2px; }
.btn-whatsapp .wa-icon { flex: none; width: 18px; height: 18px; fill: currentColor; }
`;

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'] as const;

/** English day / month names that show up in dates, as [Hinglish, Hindi]. */
const DATE_WORDS: Record<string, [string, string]> = {
  Monday: ['Somvar', 'सोमवार'], Tuesday: ['Mangalvar', 'मंगलवार'], Wednesday: ['Budhvar', 'बुधवार'], Thursday: ['Guruvar', 'गुरुवार'],
  Friday: ['Shukravar', 'शुक्रवार'], Saturday: ['Shanivar', 'शनिवार'], Sunday: ['Ravivar', 'रविवार'],
  January: ['Janvari', 'जनवरी'], February: ['Farvari', 'फ़रवरी'], March: ['March', 'मार्च'], April: ['April', 'अप्रैल'], May: ['Mai', 'मई'],
  June: ['Jun', 'जून'], July: ['Julai', 'जुलाई'], August: ['Agast', 'अगस्त'], September: ['Sitambar', 'सितंबर'], October: ['Aktubar', 'अक्टूबर'],
  November: ['Navambar', 'नवंबर'], December: ['Disambar', 'दिसंबर'],
  Jan: ['Janvari', 'जनवरी'], Feb: ['Farvari', 'फ़रवरी'], Mar: ['March', 'मार्च'], Apr: ['April', 'अप्रैल'], Jun: ['Jun', 'जून'], Jul: ['Julai', 'जुलाई'],
  Aug: ['Agast', 'अगस्त'], Sep: ['Sitambar', 'सितंबर'], Oct: ['Aktubar', 'अक्टूबर'], Nov: ['Navambar', 'नवंबर'], Dec: ['Disambar', 'दिसंबर']
};
const DATE_REGEX = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g;

const THEME_KEY = 'swarn-suraksha.theme';
const LANG_KEY = 'swarn-suraksha.language';

/** Text for the two sidebar buttons themselves (they are not run through the DOM translator). */
const SHELL_TEXT: Record<AppLanguage, Record<string, string>> = {
  en: { theme: 'Theme', language: 'Language', auto: 'Auto (by time)', day: 'Day mode', night: 'Night mode', autoNow: 'Auto' },
  hinglish: { theme: 'Theme', language: 'Bhasha', auto: 'Auto (samay ke hisaab se)', day: 'Din Mode', night: 'Raat Mode', autoNow: 'Auto' },
  hi: { theme: 'थीम', language: 'भाषा', auto: 'ऑटो (समय के अनुसार)', day: 'दिन मोड', night: 'रात मोड', autoNow: 'ऑटो' }
};

/**
 * Keeps the display theme (day / night / auto by local time) and the app language
 * (English / Hinglish / Hindi). Only presentation changes; no business logic is touched.
 * Language works by swapping exact button / menu / heading labels listed in translations.ts.
 */
@Injectable({ providedIn: 'root' })
export class UiPrefsService {
  theme: ThemeMode = 'day';
  language: AppLanguage = 'hinglish';

  private observer: MutationObserver | null = null;
  private readonly originals = new WeakMap<Text, string>();
  private readonly written = new WeakMap<Text, string>();
  private clock: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.theme = this.read<ThemeMode>(THEME_KEY, ['auto', 'day', 'night'], 'day');
    this.language = this.read<AppLanguage>(LANG_KEY, ['en', 'hinglish', 'hi'], 'hinglish');
  }

  /** Called once from the root component. */
  start(): void {
    if (typeof document === 'undefined') return;
    this.injectDarkStyles();
    this.applyTheme();
    this.clock = setInterval(() => { if (this.theme === 'auto') this.applyTheme(); }, 60_000);
    this.applyLanguage();
    this.observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData' && record.target.nodeType === Node.TEXT_NODE) this.translateNode(record.target as Text);
        else if (record.type === 'attributes' && record.target.nodeType === Node.ELEMENT_NODE) this.translateAttribute(record.target as Element, record.attributeName ?? '');
        else record.addedNodes.forEach(node => this.translateTree(node));
      }
    });
    this.observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  }

  setTheme(mode: ThemeMode): void {
    this.theme = mode;
    this.write(THEME_KEY, mode);
    this.applyTheme();
  }

  setLanguage(language: AppLanguage): void {
    this.language = language;
    this.write(LANG_KEY, language);
    this.applyLanguage();
  }

  /** True when the dark appearance is currently active. */
  get isNight(): boolean {
    if (this.theme === 'night') return true;
    if (this.theme === 'day') return false;
    const hour = new Date().getHours();
    return hour >= 19 || hour < 6;
  }

  text(key: string): string { return SHELL_TEXT[this.language][key] ?? key; }

  private injectDarkStyles(): void {
    if (document.getElementById('ss-dark-theme')) return;
    const style = document.createElement('style');
    style.id = 'ss-dark-theme';
    style.textContent = DARK_CSS + WHATSAPP_CSS;
    document.head.appendChild(style);
  }

  private applyTheme(): void {
    document.documentElement.setAttribute('data-ss-theme', this.isNight ? 'dark' : 'light');
    document.documentElement.setAttribute('data-ss-theme-mode', this.theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', this.isNight ? '#0b130f' : '#17251f');
  }

  private applyLanguage(): void {
    document.documentElement.lang = this.language === 'hi' ? 'hi' : this.language === 'hinglish' ? 'en-IN' : 'en';
    document.documentElement.setAttribute('data-ss-language', this.language);
    this.translateTree(document.body);
  }

  private translateTree(root: Node): void {
    if (root.nodeType === Node.TEXT_NODE) { this.translateNode(root as Text); return; }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    nodes.forEach(node => this.translateNode(node));
    const elements = [root as Element, ...Array.from((root as Element).querySelectorAll('[placeholder],[title],[aria-label],[alt]'))];
    elements.forEach(element => ATTRS.forEach(name => { if (element.hasAttribute(name)) this.translateAttribute(element, name); }));
  }

  private translateNode(node: Text): void {
    const parent = node.parentElement;
    if (!parent) return;
    if (parent.closest('script,style,textarea,input,.receipt-print,[data-no-translate]')) return;
    const current = node.nodeValue ?? '';
    const known = this.originals.get(node);
    // If Angular wrote a new value since we last translated, that new value is the new English original.
    const original = known !== undefined && current === this.written.get(node) ? known : current;
    const inButton = !!parent.closest('button,a,[role="button"],[role="option"],h1,h2,h3,h4');
    const target = this.language === 'en' ? original : this.translate(original, inButton);
    if (target === current) return;
    this.originals.set(node, original);
    this.written.set(node, target);
    node.nodeValue = target;
  }

  private readonly attrState = new WeakMap<Element, Record<string, { original: string; written: string }>>();

  private translateAttribute(element: Element, name: string): void {
    if (!(ATTRS as readonly string[]).includes(name) || element.closest('[data-no-translate],.receipt-print')) return;
    const current = element.getAttribute(name);
    if (current === null) return;
    const state = this.attrState.get(element) ?? {};
    const known = state[name];
    const original = known && current === known.written ? known.original : current;
    const target = this.language === 'en' ? original : this.translate(original, false);
    if (target === current) return;
    state[name] = { original, written: target };
    this.attrState.set(element, state);
    element.setAttribute(name, target);
  }

  /** Looks the text up in: button names (buttons/links/headings only), full texts, then sentence patterns. */
  private translate(original: string, inButton: boolean): string {
    const core = original.replace(/\s+/g, ' ').trim();
    if (!core) return original;
    const index = this.language === 'hinglish' ? 0 : 1;
    const lead = /^\s*/.exec(original)?.[0] ?? '';
    const trail = /\s*$/.exec(original)?.[0] ?? '';
    const entry = (inButton ? LABELS[core] : undefined) ?? TEXT[core];
    if (entry) return lead + entry[index] + trail;
    const withDates = (text: string): string => /\d/.test(text) ? text.replace(DATE_REGEX, word => DATE_WORDS[word]?.[index] ?? word) : text;
    for (const [pattern, hinglish, hindi] of PATTERNS) {
      const match = pattern.exec(core);
      if (!match) continue;
      const template = index === 0 ? hinglish : hindi;
      const result = template.replace(/\$(\d)/g, (_all: string, n: string) => {
        const part = match[Number(n)] ?? '';
        const known = TEXT[part];
        return known ? known[index] : part;
      });
      return lead + withDates(result) + trail;
    }
    const dated = withDates(core);
    return dated === core ? original : lead + dated + trail;
  }

  private read<T extends string>(key: string, allowed: T[], fallback: T): T {
    try { const value = localStorage.getItem(key) as T | null; return value && allowed.includes(value) ? value : fallback; }
    catch { return fallback; }
  }

  private write(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* storage may be unavailable; the choice still applies this session */ }
  }
}