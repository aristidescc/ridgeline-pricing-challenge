import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv.js';

export interface Product {
  partNumber: string;
  description: string;
  unit: string;
  listPriceCents: number;
  status: string;
  replacedBy: string | null;
}

export interface Customer {
  customerId: string;
  name: string;
  region: string;
  pricingTier: string;
}

export interface ContractPrice {
  customerId: string;
  partNumber: string;
  contractPriceCents: number;
  validFrom: string;
  validTo: string;
}

export interface Approver {
  approverId: string;
  name: string;
  role: string;
  region: string;
  backupApproverId: string | null;
  outOfOfficeFrom: string | null;
  outOfOfficeTo: string | null;
}

/** What the pricing rules need from the reporting DB. */
export interface PricingReference {
  product(partNumber: string): Product | undefined;
  contracts(customerId: string, partNumber: string): ContractPrice[];
}

const toCents = (v: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid money value: "${v}"`);
  return Math.round(n * 100);
};
const orNull = (v: string | undefined): string | null => (v ? v : null);

/**
 * Read-only view of the nightly reporting export (SAP → reporting DB → CSV snapshot).
 * Loaded once at boot; there is no write path. Never writes to SAP or the reporting DB.
 */
export class ReportingRepository implements PricingReference {
  private readonly products = new Map<string, Product>();
  private readonly customers = new Map<string, Customer>();
  private readonly contractIndex = new Map<string, ContractPrice[]>();

  constructor(
    products: Product[],
    customers: Customer[],
    contracts: ContractPrice[],
    readonly approvers: Approver[],
    /** When the snapshot was exported from SAP (export_metadata.json). */
    readonly exportedAt: Date,
  ) {
    products.forEach((p) => this.products.set(p.partNumber, p));
    customers.forEach((c) => this.customers.set(c.customerId, c));
    contracts.forEach((c) => {
      const key = `${c.customerId}|${c.partNumber}`;
      this.contractIndex.set(key, [...(this.contractIndex.get(key) ?? []), c]);
    });
  }

  static fromDir(dir: string): ReportingRepository {
    const read = (f: string) => parseCsv(readFileSync(join(dir, f), 'utf8'));
    const meta = JSON.parse(
      readFileSync(join(dir, 'export_metadata.json'), 'utf8'),
    ) as { exported_at?: string };
    const exportedAt = new Date(meta.exported_at ?? '');
    if (Number.isNaN(exportedAt.getTime())) {
      throw new Error('export_metadata.json: exported_at missing or invalid');
    }
    return new ReportingRepository(
      read('products.csv').map((r) => ({
        partNumber: r.part_number,
        description: r.description,
        unit: r.unit,
        listPriceCents: toCents(r.list_price),
        status: r.status,
        replacedBy: orNull(r.replaced_by),
      })),
      read('customers.csv').map((r) => ({
        customerId: r.customer_id,
        name: r.name,
        region: r.region,
        pricingTier: r.pricing_tier,
      })),
      read('contract_prices.csv').map((r) => ({
        customerId: r.customer_id,
        partNumber: r.part_number,
        contractPriceCents: toCents(r.contract_price),
        validFrom: r.valid_from,
        validTo: r.valid_to,
      })),
      read('approvers.csv').map((r) => ({
        approverId: r.approver_id,
        name: r.name,
        role: r.role,
        region: r.region,
        backupApproverId: orNull(r.backup_approver_id),
        outOfOfficeFrom: orNull(r.out_of_office_from),
        outOfOfficeTo: orNull(r.out_of_office_to),
      })),
      exportedAt,
    );
  }

  product(partNumber: string): Product | undefined {
    return this.products.get(partNumber);
  }

  customer(customerId: string): Customer | undefined {
    return this.customers.get(customerId);
  }

  contracts(customerId: string, partNumber: string): ContractPrice[] {
    return this.contractIndex.get(`${customerId}|${partNumber}`) ?? [];
  }
}
