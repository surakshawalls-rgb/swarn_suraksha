import { CommonModule } from '@angular/common';
import { Component, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { StockComponent } from './stock.component';
import { SuppliersComponent } from '../suppliers/suppliers.component';

@Component({
  standalone: true,
  imports: [CommonModule, StockComponent, SuppliersComponent],
  template: `
    <section class="stock-workspace-nav" aria-label="Stock workspace">
      <div><h1>Stock &amp; Suppliers</h1></div>
      <div class="stock-workspace-tabs" role="group" aria-label="Choose stock view">
        <button type="button" [class.active]="view==='stock'" [attr.aria-pressed]="view==='stock'" [disabled]="blocked" (click)="selectView('stock')">Stock items</button>
        <button type="button" [class.active]="view==='suppliers'" [attr.aria-pressed]="view==='suppliers'" [disabled]="blocked" (click)="selectView('suppliers')">Suppliers</button>
      </div>
      <p *ngIf="blocked" role="status">Close the current form to switch tabs.</p>
    </section>
    <ss-stock-register *ngIf="view==='stock'" [openCreateOnEntry]="openCreateOnEntry"></ss-stock-register>
    <ss-supplier-directory *ngIf="view==='suppliers'" [openCreateOnEntry]="openCreateOnEntry"></ss-supplier-directory>
  `
})
export class StockWorkspaceComponent {
  @ViewChild(StockComponent) stock?: StockComponent;
  @ViewChild(SuppliersComponent) suppliers?: SuppliersComponent;
  view: 'stock' | 'suppliers';
  openCreateOnEntry: boolean;

  constructor(route: ActivatedRoute) {
    this.view = route.snapshot.data['suppliers'] ? 'suppliers' : 'stock';
    this.openCreateOnEntry = route.snapshot.queryParamMap.get('action') === 'add';
  }

  selectView(view: 'stock' | 'suppliers'): void {
    this.openCreateOnEntry = false;
    this.view = view;
  }
  get blocked(): boolean {
    return !!(this.stock?.saving || this.stock?.pending || this.stock?.intakeOpen || this.stock?.paymentIntake || this.stock?.actionItem || this.suppliers?.saving || this.suppliers?.editing);
  }
}
