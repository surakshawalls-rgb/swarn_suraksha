/**
 * Premium action-button styling for the whole dashboard.
 * Injected at runtime by UiPrefsService (same mechanism as the night-mode styles), so it does not
 * depend on angular.json, stylesheet order, or any other global CSS file.
 */
/** Every "special" button variant that has its own look; the generic secondary style skips these. */
const SPECIAL = ':not(.btn-save):not(.add-item-btn):not(.danger-text):not(.btn-pdf):not(.btn-whatsapp)';

export const PREMIUM_CSS = `
/* ===== Invoice number chip ===== */
.inv-no { display: inline-flex; align-items: center; padding: 3px 11px; border-radius: 999px; white-space: nowrap;
  font: 700 12px 'DM Sans', sans-serif; letter-spacing: .7px; font-variant-numeric: tabular-nums; color: #5b4208;
  border: 1px solid #d9b25a; background: linear-gradient(180deg, #fcf3d3, #efd58a);
  box-shadow: 0 1px 0 rgba(255,255,255,.7) inset, 0 4px 10px -6px rgba(138,100,32,.7); }
.inv-no.inv-no-lg { font-size: 13px; padding: 4px 13px; margin-bottom: 4px; }

/* ===== Icons never grow beyond their button ===== */
svg.btn-icon { width: 16px !important; height: 16px !important; max-width: 16px; max-height: 16px; flex: 0 0 16px; }

/* ===== Bill row actions wrap instead of overlapping ===== */
.purchase-history td.bill-actions, .purchase-history .bill-actions { display: flex !important; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; white-space: normal !important; }
.purchase-history td.bill-actions { min-width: 320px; }
.purchase-history .bill-actions > *, .purchase-history .bill-actions .text-btn { position: static !important; flex: 0 0 auto; width: auto; max-width: 100%; margin: 0 !important; white-space: nowrap; overflow: visible; }
.receipt-actions .text-btn, .receipt-actions .primary-btn { flex: 0 0 auto; white-space: nowrap; }

/* ===== Page header button: stretches across the top bar ===== */
.app-main .topbar .top-actions { flex: 1 1 auto !important; margin-left: 24px !important; gap: 12px; }
.app-main .topbar .top-actions .primary-btn { flex: 1 1 0; min-height: 48px !important; font-size: 15px !important; }

/* ===== PRIMARY buttons: emerald + gold, full width ===== */
.app-main .top-actions .primary-btn,
.app-main .form-actions .primary-btn {
  position: relative; overflow: hidden; display: inline-flex !important; align-items: center; justify-content: center; gap: 10px;
  width: 100% !important; min-height: 58px; padding: 0 30px !important; border-radius: 16px !important;
  font: 800 16px/1 'DM Sans', 'Noto Sans Devanagari', sans-serif !important; letter-spacing: .6px; color: #ffe9a8 !important;
  border: 1.5px solid #e3c36c !important; text-shadow: 0 1px 0 rgba(0,0,0,.45);
  background: linear-gradient(135deg, #24593f 0%, #0f2a1d 55%, #24593f 100%) !important;
  box-shadow: 0 1px 0 rgba(255,240,180,.55) inset, 0 0 0 4px rgba(227,195,108,.18), 0 18px 30px -14px rgba(15,42,29,.9) !important;
  transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
}

/* ===== SAVE buttons (Save customer, Save supplier ...): solid gold ===== */
.app-main .text-btn.btn-save,
.app-main .payment-line > .btn-save {
  position: relative; overflow: hidden; display: inline-flex !important; align-items: center; justify-content: center; gap: 10px;
  width: 100% !important; min-height: 54px; padding: 0 28px !important; border-radius: 16px !important;
  font: 800 15px/1 'DM Sans', 'Noto Sans Devanagari', sans-serif !important; letter-spacing: .5px; color: #3b2704 !important;
  border: 1.5px solid #b88f36 !important; text-shadow: 0 1px 0 rgba(255,255,255,.55);
  background: linear-gradient(180deg, #fdf0bf 0%, #e8c56c 55%, #cfa646 100%) !important;
  box-shadow: 0 1px 0 rgba(255,255,255,.8) inset, 0 0 0 4px rgba(207,166,70,.2), 0 16px 26px -14px rgba(138,100,32,.95) !important;
  transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
}
.app-main .payment-line > .btn-save { grid-column: 1 / -1; }

/* light sweep across primary / save buttons on hover */
.app-main .top-actions .primary-btn::after,
.app-main .form-actions .primary-btn::after,
.app-main .text-btn.btn-save::after {
  content: ''; position: absolute; top: 0; left: -70%; width: 45%; height: 100%; pointer-events: none;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,.45), transparent); transform: skewX(-20deg); transition: left .7s ease;
}
.app-main .top-actions .primary-btn:hover:not(:disabled)::after,
.app-main .form-actions .primary-btn:hover:not(:disabled)::after,
.app-main .text-btn.btn-save:hover:not(:disabled)::after { left: 130%; }
.app-main .top-actions .primary-btn:hover:not(:disabled),
.app-main .form-actions .primary-btn:hover:not(:disabled),
.app-main .text-btn.btn-save:hover:not(:disabled),
.app-main .payment-line > .btn-save:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.07); }
.app-main .top-actions .primary-btn:active:not(:disabled),
.app-main .form-actions .primary-btn:active:not(:disabled),
.app-main .text-btn.btn-save:active:not(:disabled) { transform: translateY(0); }
.app-main .top-actions .primary-btn:disabled,
.app-main .form-actions .primary-btn:disabled,
.app-main .text-btn.btn-save:disabled { opacity: .55; filter: grayscale(.25); }

/* submit row: button on its own full-width line, hint underneath */
.app-main form .form-actions { display: flex !important; flex-direction: column !important; align-items: stretch !important; gap: 10px; }
.app-main form .form-actions > span { text-align: center; }

/* ===== "Add another item / exchange item / payment" ===== */
.app-main .add-item-btn {
  display: flex !important; align-items: center; justify-content: center; gap: 12px;
  width: 100% !important; justify-self: stretch !important; min-height: 58px !important; padding: 10px 22px !important; border-radius: 16px !important;
  font: 800 15px 'DM Sans', 'Noto Sans Devanagari', sans-serif !important; letter-spacing: .4px; color: #4a3306 !important;
  border: 2px dashed #c9a24b !important; background: linear-gradient(180deg, #fffef8, #fbf0cf) !important;
  box-shadow: 0 1px 0 #fff inset, 0 12px 22px -14px rgba(138,100,32,.85) !important;
  transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
}
.app-main .add-item-btn:hover:not(:disabled) {
  transform: translateY(-2px); border-style: solid !important; border-color: #b88f36 !important;
  background: linear-gradient(180deg, #fdf0bf, #ecd081) !important;
  box-shadow: 0 1px 0 rgba(255,255,255,.8) inset, 0 0 0 4px rgba(201,162,75,.22), 0 16px 26px -14px rgba(138,100,32,.95) !important;
}
.app-main .add-item-btn svg.btn-icon {
  width: 30px !important; height: 30px !important; max-width: 30px; max-height: 30px; flex: 0 0 30px; box-sizing: border-box;
  padding: 7px; margin: 0 !important; border-radius: 50%; color: #3b2704;
  background: linear-gradient(180deg, #fbe9ae, #d9b25a); box-shadow: 0 1px 0 rgba(255,255,255,.8) inset, 0 0 0 3px rgba(201,162,75,.3);
}
.app-main .line-heading { flex-wrap: wrap; gap: 10px; }
.app-main .line-heading > .add-item-btn { flex: 1 1 100%; order: 3; }

/* ===== "Customer is exchanging old jewellery?" ===== */
.app-main .exchange-toggle {
  display: flex !important; align-items: center; gap: 16px; width: 100%; min-height: 62px; padding: 14px 22px; cursor: pointer;
  font-size: 15px; font-weight: 800; color: #3b2e10;
  border: 1px solid #e3d3a6; border-left: 6px solid #c9a24b; border-radius: 16px;
  background: linear-gradient(180deg, #fffdf7, #f8f1dc);
  box-shadow: 0 1px 0 #fff inset, 0 12px 22px -14px rgba(138,100,32,.7);
  transition: transform .18s ease, box-shadow .18s ease;
}
.app-main .exchange-toggle:hover { transform: translateY(-1px); box-shadow: 0 1px 0 #fff inset, 0 0 0 4px rgba(201,162,75,.18), 0 16px 26px -14px rgba(138,100,32,.8); }
.app-main .exchange-toggle input { flex: none; width: 24px; height: 24px; accent-color: #1f4f38; cursor: pointer; }

@media (max-width: 700px) {
  .app-main .topbar .top-actions { margin-left: 0 !important; }
  .purchase-history td.bill-actions { min-width: 240px; }
}
@media (prefers-reduced-motion: reduce) {
  .app-main .top-actions .primary-btn, .app-main .form-actions .primary-btn, .app-main .text-btn.btn-save,
  .app-main .add-item-btn, .app-main .exchange-toggle { transition: none; }
  .app-main .top-actions .primary-btn::after, .app-main .form-actions .primary-btn::after, .app-main .text-btn.btn-save::after { display: none; }
}

/* ================================================================
   EVERY button on every dashboard page (Customers & Khata, Girvi, Stock, Suppliers, Bill)
   ================================================================ */

/* ----- inline primary buttons: Apply range, Record part payment, Download PDF ... ----- */
.app-main .primary-btn {
  position: relative; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 46px; padding: 0 24px; border-radius: 14px !important; cursor: pointer;
  font: 800 14px/1 'DM Sans', 'Noto Sans Devanagari', sans-serif !important; letter-spacing: .4px; color: #ffe9a8 !important;
  border: 1.5px solid #e3c36c !important; text-shadow: 0 1px 0 rgba(0,0,0,.45);
  background: linear-gradient(135deg, #24593f 0%, #0f2a1d 55%, #24593f 100%) !important;
  box-shadow: 0 1px 0 rgba(255,240,180,.55) inset, 0 0 0 3px rgba(227,195,108,.16), 0 14px 24px -14px rgba(15,42,29,.9) !important;
  transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
}
.app-main .primary-btn::after {
  content: ''; position: absolute; top: 0; left: -70%; width: 45%; height: 100%; pointer-events: none;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,.45), transparent); transform: skewX(-20deg); transition: left .7s ease;
}
.app-main .primary-btn:hover:not(:disabled)::after { left: 130%; }
.app-main .primary-btn:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.07); }
.app-main .primary-btn:active:not(:disabled) { transform: translateY(0); }
.app-main .primary-btn:disabled { opacity: .55; filter: grayscale(.25); cursor: not-allowed; }

/* buttons that sit in a form grid (Girvi payment / top-up, Sales payment ...) take the whole row */
.app-main .payment-line > .primary-btn { grid-column: 1 / -1; width: 100% !important; min-height: 54px; font-size: 15px !important; }
.app-main .payment-line > .text-btn${SPECIAL} { grid-column: 1 / -1; width: 100%; }

/* ----- generic secondary buttons: Cancel, Retry, Print, Export CSV, Previous / Next, Use current rate ... ----- */
.app-main .text-btn${SPECIAL} {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 0 18px; cursor: pointer;
  font: 700 13px/1.1 'DM Sans', 'Noto Sans Devanagari', sans-serif; letter-spacing: .2px; color: #3b2e10 !important;
  border: 1.5px solid #dcc58a !important; border-radius: 12px !important;
  background: linear-gradient(180deg, #fffef9, #f6ecd0) !important;
  box-shadow: 0 1px 0 #fff inset, 0 8px 16px -12px rgba(138,100,32,.85) !important;
  transition: transform .18s ease, box-shadow .18s ease, background .18s ease, border-color .18s ease;
}
.app-main .text-btn${SPECIAL}:hover:not(:disabled) {
  transform: translateY(-1px); border-color: #b88f36 !important;
  background: linear-gradient(180deg, #fdf0bf, #ecd081) !important;
  box-shadow: 0 1px 0 rgba(255,255,255,.8) inset, 0 0 0 3px rgba(201,162,75,.2), 0 12px 20px -12px rgba(138,100,32,.95) !important;
}
.app-main .text-btn:disabled { opacity: .5; cursor: not-allowed; }

/* empty-state call to action ("Add the first customer") */
.app-main .customer-empty .text-btn${SPECIAL}, .app-main .rate-empty .text-btn${SPECIAL} {
  min-height: 48px; padding: 0 26px; font-size: 14px; color: #ffe9a8 !important; border-color: #e3c36c !important;
  background: linear-gradient(135deg, #24593f 0%, #0f2a1d 55%, #24593f 100%) !important;
  box-shadow: 0 1px 0 rgba(255,240,180,.55) inset, 0 0 0 3px rgba(227,195,108,.16), 0 14px 24px -14px rgba(15,42,29,.9) !important;
}

/* ----- red / remove ----- */
.app-main .text-btn.danger-text {
  min-height: 38px; padding: 0 16px; border-radius: 12px !important; font-weight: 700; color: #8f2a21 !important;
  border: 1.5px solid #efc9c3 !important; background: linear-gradient(180deg, #fff, #fdf0ee) !important;
  box-shadow: 0 1px 0 #fff inset, 0 8px 14px -12px rgba(143,42,33,.7) !important;
}
.app-main .text-btn.danger-text:hover:not(:disabled) { transform: translateY(-1px); background: linear-gradient(180deg, #fff5f3, #f9ddd8) !important; border-color: #d99a92 !important; }

/* ----- PDF (gold) and WhatsApp (green) ----- */
.app-main .text-btn.btn-pdf {
  min-height: 40px; padding: 0 18px; border-radius: 12px !important; font-weight: 800; color: #3b2704 !important;
  border: 1.5px solid #b88f36 !important; background: linear-gradient(180deg, #fdf0bf 0%, #e8c56c 55%, #cfa646 100%) !important;
  box-shadow: 0 1px 0 rgba(255,255,255,.8) inset, 0 10px 18px -12px rgba(138,100,32,.95) !important;
}
.app-main .text-btn.btn-whatsapp {
  min-height: 40px; padding: 0 18px; border-radius: 12px !important; font-weight: 800; color: #fff !important;
  border: 1.5px solid #0f6e3a !important; text-shadow: 0 1px 0 rgba(0,0,0,.25);
  background: linear-gradient(180deg, #34c775 0%, #1a9a52 100%) !important;
  box-shadow: 0 1px 0 rgba(255,255,255,.4) inset, 0 10px 18px -12px rgba(15,110,58,.95) !important;
}
.app-main .text-btn.btn-pdf:hover:not(:disabled), .app-main .text-btn.btn-whatsapp:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }

/* ----- Customers & Khata: row / card actions ----- */
.app-main .customer-action {
  display: inline-flex !important; align-items: center; justify-content: center; gap: 6px; min-height: 38px !important; margin: 3px !important; padding: 0 16px !important;
  border-radius: 12px !important; font: 700 12px 'DM Sans', 'Noto Sans Devanagari', sans-serif !important; letter-spacing: .2px; cursor: pointer;
  color: #3b2e10 !important; border: 1.5px solid #dcc58a !important; background: linear-gradient(180deg, #fffef9, #f6ecd0) !important;
  box-shadow: 0 1px 0 #fff inset, 0 8px 14px -12px rgba(138,100,32,.85) !important;
  transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
}
.app-main .customer-action:hover { transform: translateY(-1px); border-color: #b88f36 !important; background: linear-gradient(180deg, #fdf0bf, #ecd081) !important; }
.app-main .customer-action.statement-action {
  color: #ffe9a8 !important; border-color: #e3c36c !important; text-shadow: 0 1px 0 rgba(0,0,0,.4);
  background: linear-gradient(135deg, #24593f 0%, #0f2a1d 55%, #24593f 100%) !important;
  box-shadow: 0 1px 0 rgba(255,240,180,.5) inset, 0 10px 18px -12px rgba(15,42,29,.9) !important;
}
.app-main .customer-action.statement-action:hover { filter: brightness(1.12); }
.app-main .customer-action.archive-action {
  color: #8f2a21 !important; border-color: #efc9c3 !important; background: linear-gradient(180deg, #fff, #fdf0ee) !important;
  box-shadow: 0 1px 0 #fff inset, 0 8px 14px -12px rgba(143,42,33,.7) !important;
}
.app-main .customer-action.archive-action:hover { background: linear-gradient(180deg, #fff5f3, #f9ddd8) !important; border-color: #d99a92 !important; }

/* ----- Girvi: view / close / PDF dialog ----- */
.app-main .girvi-view-btn {
  display: inline-flex; align-items: center; justify-content: center; padding: 9px 18px !important; border-radius: 12px !important; cursor: pointer;
  font: 700 12px 'DM Sans', 'Noto Sans Devanagari', sans-serif !important; letter-spacing: .3px; color: #ffe9a8 !important; white-space: nowrap;
  border: 1.5px solid #e3c36c !important; text-shadow: 0 1px 0 rgba(0,0,0,.4);
  background: linear-gradient(135deg, #24593f 0%, #0f2a1d 55%, #24593f 100%) !important;
  box-shadow: 0 1px 0 rgba(255,240,180,.5) inset, 0 10px 18px -12px rgba(15,42,29,.9) !important;
  transition: transform .18s ease, filter .18s ease;
}
.app-main .girvi-view-btn:hover { transform: translateY(-1px); filter: brightness(1.12); }
.app-main .girvi-close-btn {
  display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 0 18px !important; border-radius: 12px !important; cursor: pointer;
  font: 700 13px 'DM Sans', 'Noto Sans Devanagari', sans-serif !important; color: #3b2e10 !important;
  border: 1.5px solid #dcc58a !important; background: linear-gradient(180deg, #fffef9, #f6ecd0) !important;
  box-shadow: 0 1px 0 #fff inset, 0 8px 16px -12px rgba(138,100,32,.85) !important; transition: transform .18s ease, background .18s ease;
}
.app-main .girvi-close-btn:hover { transform: translateY(-1px); border-color: #b88f36 !important; background: linear-gradient(180deg, #fdf0bf, #ecd081) !important; }
.app-main .girvi-pdf-close {
  display: inline-grid; place-items: center; width: 40px !important; height: 40px !important; border-radius: 50% !important; cursor: pointer; font-size: 22px; line-height: 1;
  color: #3b2704 !important; border: 1.5px solid #b88f36 !important; background: linear-gradient(180deg, #fdf0bf, #e0b957) !important;
  box-shadow: 0 1px 0 rgba(255,255,255,.8) inset, 0 8px 14px -10px rgba(138,100,32,.9) !important;
}
.app-main .girvi-pdf-close:hover { filter: brightness(1.06); transform: rotate(90deg); transition: transform .25s ease; }
.app-main .girvi-collateral-head { display: flex !important; flex-wrap: wrap !important; align-items: center; gap: 12px; }
.app-main .girvi-collateral-head > .add-item-btn { flex: 1 1 100% !important; order: 3; }

@media (prefers-reduced-motion: reduce) {
  .app-main .primary-btn, .app-main .text-btn, .app-main .customer-action, .app-main .girvi-view-btn, .app-main .girvi-close-btn { transition: none; }
  .app-main .primary-btn::after { display: none; }
  .app-main .girvi-pdf-close:hover { transform: none; }
}
`;