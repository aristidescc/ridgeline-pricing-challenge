/** Draft quote as produced by the extraction (Intake) team — data-pack/draft_quotes.json. */
export interface DraftLine {
  line: number;
  part_number: string;
  description?: string;
  quantity: number;
  unit: string;
  extraction_confidence: number;
}

export interface Draft {
  draft_id: string;
  rfq_id: string;
  customer_id: string;
  created_at: string;
  prepared_by?: string;
  proposed_discount_pct: number;
  lines: DraftLine[];
  note?: string;
}

/** A reason the specialist must look at the quote. line = null → whole quote. */
export interface ReviewFlag {
  line: number | null;
  reason: string;
}
