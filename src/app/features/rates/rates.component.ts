import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { WorkspaceService } from '../dashboard/workspace.service';

interface GoldRate {
  purity: string;
  rate: number;
  symbol: string;
  provider: string;
  providerTimestamp: string;
  fetchedAt: string;
}

interface CachedQuote<T> {
  data: T;
  cachedAt: number;
}

@Component({
  selector: 'app-rates',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './rates.component.html',
  styleUrl: './rates.component.scss'
})
export class RatesComponent implements OnInit, OnDestroy {
  @Input() embedded = false;
  fetching = false;
  errorMessage = '';

  rates: GoldRate[] = [];
  latestQuoteTime: string | null = null;

  silverRate: number | null = null;
  silverRatePerKilogram: number | null = null;
  readonly silverBharGrams = 11.6638;
  silverProviderTimestamp: string | null = null;
  silverFetchedAt: string | null = null;
  silverFetching = false;
  silverErrorMessage = '';
  showOtherGoldRates = false;

  workspace: { id: string } | null = null;

  private workspaceSubscription: Subscription | null = null;
  private requestId = 0;

  private readonly primaryPurities = ['24K'];
  private readonly otherPurities = ['22K', '18K'];
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  private cacheKey(key: string): string {
    return `swarnasuraksha_rates_${key}`;
  }

  private readCache<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(this.cacheKey(key));

      if (!raw) {
        return null;
      }

      const cached = JSON.parse(raw) as CachedQuote<T>;

      // Remove expired cache
      if (Date.now() - cached.cachedAt >= this.CACHE_TTL) {
        localStorage.removeItem(this.cacheKey(key));
        return null;
      }

      return cached.data;
    } catch {
      return null;
    }
  }

  private writeCache<T>(key: string, data: T): void {
    try {
      const cached: CachedQuote<T> = {
        data,
        cachedAt: Date.now()
      };

      localStorage.setItem(
        this.cacheKey(key),
        JSON.stringify(cached)
      );
    } catch (error) {
      // Caching failure should not prevent rates from displaying.
      console.warn('Unable to cache metal rate:', error);
    }
  }

  ngOnInit(): void {
    this.workspaceSubscription =
      this.workspaceService.activeWorkspace$.subscribe(workspace => {
        if (workspace?.id === this.workspace?.id) {
          this.workspace = workspace;
          return;
        }

        this.requestId++;
        this.workspace = workspace;
        this.rates = [];
        this.latestQuoteTime = null;
        this.errorMessage = '';
        this.fetching = false;

        this.silverRate = null;
        this.silverRatePerKilogram = null;
        this.silverProviderTimestamp = null;
        this.silverFetchedAt = null;
        this.silverFetching = false;
        this.silverErrorMessage = '';

        if (workspace) {
          void this.fetchGoldRates();
        } else {
          this.errorMessage = 'Select a business workspace to continue.';
          this.cdr.markForCheck();
        }
      });
  }

  ngOnDestroy(): void {
    this.requestId++;
    this.workspaceSubscription?.unsubscribe();
  }

  /**
   * forceRefresh = true  -> ignore the 30-minute browser cache and ask the market API again
   *                          (used by the Refresh / Try again buttons).
   * forceRefresh = false -> use cached rates when they are fresh (used when the page opens).
   */
  async fetchGoldRates(forceRefresh = false): Promise<void> {
    if (!this.workspace || this.fetching) {
      return;
    }

    const client = this.workspaceService.client;

    if (!client) {
      this.errorMessage = 'Supabase is not configured.';
      this.cdr.markForCheck();
      return;
    }

    const businessId = this.workspace.id;
    const requestId = ++this.requestId;

    this.fetching = true;
    this.errorMessage = '';

    // Silver has independent state/error handling and cannot fail the gold request.
    void this.fetchSilverRate(client, businessId, requestId, forceRefresh);

    try {
      // Check cache for each purity first
      const cachedRates: GoldRate[] = [];
      const puritiesToFetch: string[] = [];

      const requestedPurities = this.showOtherGoldRates
        ? [...this.primaryPurities, ...this.otherPurities]
        : this.primaryPurities;
      for (const purity of requestedPurities) {
        const cached = forceRefresh
          ? null
          : this.readCache<GoldRate>(`gold_${purity.toLowerCase()}`);
        if (cached) {
          cachedRates.push(cached);
        } else {
          puritiesToFetch.push(purity);
        }
      }

      // If all rates are cached, use them directly
      if (puritiesToFetch.length === 0) {
        if (requestId !== this.requestId) {
          return;
        }
        this.rates = cachedRates;
        this.latestQuoteTime = cachedRates
          .map(rate => rate.fetchedAt)
          .sort()
          .at(-1) ?? new Date().toISOString();
        this.fetching = false;
        this.cdr.markForCheck();
        return;
      }

      // Fetch only the missing/expired purities
      const fetchedResults = await Promise.all(
        puritiesToFetch.map(async purity => {
          const result = await client.functions.invoke(
            'market-gold-rate',
            {
              body: {
                businessId,
                purity
              }
            }
          );

          if (result.error) {
            throw new Error(
              `${purity}: ${result.error.message || 'Request failed.'}`
            );
          }

          const quote = result.data as {
            rate?: number;
            symbol?: string;
            provider?: string;
            providerTimestamp?: string;
            fetchedAt?: string;
            error?: string;
          } | null;

          if (
            !quote ||
            quote.error ||
            typeof quote.rate !== 'number' ||
            !Number.isFinite(quote.rate) ||
            quote.rate <= 0 ||
            !quote.providerTimestamp
          ) {
            throw new Error(
              quote?.error || `The ${purity} market quote is invalid.`
            );
          }

          const goldRate: GoldRate = {
            purity,
            rate: quote.rate,
            symbol: quote.symbol ?? `XAU/INR-${purity}`,
            provider: quote.provider ?? 'GoldAPI',
            providerTimestamp: quote.providerTimestamp,
            fetchedAt: quote.fetchedAt ?? new Date().toISOString()
          };

          // Cache the fetched rate
          this.writeCache(`gold_${purity.toLowerCase()}`, goldRate);

          return goldRate;
        })
      );

      if (requestId !== this.requestId) {
        return;
      }

      // Combine cached and fetched rates, maintaining the original purity order
      const allRates = requestedPurities.map(purity => {
        const cached = cachedRates.find(r => r.purity === purity);
        if (cached) return cached;
        return fetchedResults.find(r => r.purity === purity)!;
      });

      this.rates = allRates;
      this.latestQuoteTime = allRates
        .map(rate => rate.fetchedAt)
        .sort()
        .at(-1) ?? new Date().toISOString();
    } catch (error) {
      if (requestId === this.requestId) {
        this.errorMessage =
          error instanceof Error
            ? error.message
            : 'Could not fetch gold rates. Please try again.';
      }

    } finally {
      if (requestId === this.requestId) {
        this.fetching = false;
        this.cdr.markForCheck();
      }
    }
  }

  async loadOtherGoldRates(): Promise<void> {
    if (this.showOtherGoldRates) return;
    this.showOtherGoldRates = true;
    await this.fetchGoldRates();
  }

  private async fetchSilverRate(
    client: NonNullable<WorkspaceService['client']>,
    businessId: string,
    requestId: number,
    forceRefresh = false
  ): Promise<void> {
    // Check cache first (skipped when the user pressed Refresh)
    interface SilverRate {
      rate: number;
      ratePerKilogram: number;
      providerTimestamp: string;
      fetchedAt: string;
    }

    const cachedSilver = forceRefresh ? null : this.readCache<SilverRate>('silver');
    if (cachedSilver) {
      if (requestId !== this.requestId) {
        return;
      }
      this.silverRate = cachedSilver.rate;
      this.silverRatePerKilogram = cachedSilver.ratePerKilogram;
      this.silverProviderTimestamp = cachedSilver.providerTimestamp;
      this.silverFetchedAt = cachedSilver.fetchedAt;
      this.silverFetching = false;
      this.cdr.markForCheck();
      return;
    }

    this.silverFetching = true;
    this.silverErrorMessage = '';
    this.cdr.markForCheck();

    try {
      const result = await client.functions.invoke('market-gold-rate', {
        body: {
          businessId,
          metal: 'silver'
        }
      });

      if (requestId !== this.requestId) {
        return;
      }

      if (result.error) {
        throw new Error(result.error.message || 'Silver rate request failed.');
      }

      const quote = result.data as {
        rate?: number;
        ratePerKilogram?: number;
        providerTimestamp?: string;
        fetchedAt?: string;
        error?: string;
      } | null;

      if (
        !quote ||
        quote.error ||
        typeof quote.rate !== 'number' ||
        !Number.isFinite(quote.rate) ||
        quote.rate <= 0 ||
        typeof quote.ratePerKilogram !== 'number' ||
        !Number.isFinite(quote.ratePerKilogram) ||
        quote.ratePerKilogram <= 0 ||
        !quote.providerTimestamp
      ) {
        throw new Error(quote?.error || 'The silver market quote is invalid.');
      }

      const silverRate: SilverRate = {
        rate: quote.rate,
        ratePerKilogram: quote.ratePerKilogram,
        providerTimestamp: quote.providerTimestamp,
        fetchedAt: quote.fetchedAt ?? new Date().toISOString()
      };

      // Cache the fetched silver rate
      this.writeCache('silver', silverRate);

      this.silverRate = silverRate.rate;
      this.silverRatePerKilogram = silverRate.ratePerKilogram;
      this.silverProviderTimestamp = silverRate.providerTimestamp;
      this.silverFetchedAt = silverRate.fetchedAt;
    } catch (error) {
      if (requestId === this.requestId) {
        this.silverErrorMessage = error instanceof Error
          ? error.message
          : 'Could not fetch silver rates. Please try again.';
      }
    } finally {
      if (requestId === this.requestId) {
        this.silverFetching = false;
        this.cdr.markForCheck();
      }
    }
  }

  formatRate(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }
}