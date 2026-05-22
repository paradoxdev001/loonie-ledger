export const BUILTIN_CONVERTERS = [
  {
    key: 'rbc_visa_pdf_v1',
    name: 'RBC Visa (PDF Statement)',
    institution: 'RBC',
    account_type: 'credit_card',
    format: 'pdf',
    notes: 'RBC Avion/Visa Infinite PDF statements. Captures transaction + posting dates (MMM DD), description, signed amount. Resolves year boundaries from the "STATEMENT FROM … TO …" header so a statement spanning Dec → Jan parses correctly.',
    spec: {
      type: 'pdf',
      line_regex: '^([A-Z]{3}\\s+\\d{1,2})\\s+([A-Z]{3}\\s+\\d{1,2})\\s+(.+?)\\s+(-?\\$[\\d,]+\\.\\d{2})(?:\\s+.*)?$',
      groups: { transaction_date: 1, posted_date: 2, description: 3, amount: 4 },
      date_format: 'MMM DD',
      amount_handling: 'single_signed',
      amount_sign: 'flipped',
      period_regex: 'STATEMENT\\s+FROM\\s+([A-Z]{3})\\s+\\d{1,2}(?:,\\s+(\\d{4}))?\\s+TO\\s+([A-Z]{3})\\s+\\d{1,2},\\s+(\\d{4})',
      period_groups: { start_month: 1, start_year: 2, end_month: 3, end_year: 4 },
      totals: [
        {
          label: 'Monthly activity',
          regex: 'SUBTOTAL OF MONTHLY ACTIVITY\\s+\\$?(-?[\\d,]+\\.\\d{2})',
          match: 'all'
        }
      ],
      account_type: 'credit_card',
      institution: 'RBC',
      default_account: 'RBC Visa',
      default_currency: 'CAD'
    }
  },
  {
    key: 'amex_year_end_summary_csv_v1',
    name: 'Amex Year End Summary (CSV)',
    institution: 'Amex',
    account_type: 'credit_card',
    format: 'csv',
    notes: 'Amex Canada Year End Summary CSV export. Split debit/credit columns (Charges $ / Credits $). Date format DD/MM/YYYY.',
    spec: {
      type: 'csv',
      has_header: true,
      delimiter: ',',
      columns: {
        transaction_date: 'Date',
        description: 'Transaction',
        debit: 'Charges $',
        credit: 'Credits $'
      },
      date_format: 'DD/MM/YYYY',
      amount_handling: 'split_debit_credit',
      account_type: 'credit_card',
      institution: 'Amex',
      default_account: 'Amex',
      default_currency: 'CAD'
    }
  },
  {
    key: 'bmo_interest_chequing_pdf_v1',
    name: 'BMO Interest Chequing (PDF Statement)',
    institution: 'BMO',
    account_type: 'chequing',
    format: 'pdf',
    notes: 'BMO Everyday Banking PDF. The statement bundles Primary + Interest Chequing in one file — this converter scopes to the Interest Chequing section via account_section_regex (anchored on the page-2 header which has "Interest Chequing Account # 0493 8157-971" all on one row; the page-1 summary table splits those fragments across rows so it doesn\'t false-match). Tabular layout: debit/credit determined by x-column. Wrapped descriptions like "HYUNDAI PMNT CT" / "MSP/DIV" are folded back together via merge_continuation_rows. Header prints only the end date ("For the period ending April 17, 2026"); buildYearResolver handles the start-less case by mapping months ≤ end_month to end_year and later months to end_year - 1.',
    spec: {
      type: 'pdf',
      layout: 'columns',
      columns: [
        { name: 'date',        x_min: 0,   x_max: 100 },
        { name: 'description', x_min: 100, x_max: 290 },
        { name: 'debit',       x_min: 290, x_max: 395 },
        { name: 'credit',      x_min: 395, x_max: 485 },
        { name: 'balance',     x_min: 485, x_max: 1000 }
      ],
      account_section_regex: 'Interest\\s*Chequing\\s*Account\\s*#\\s*0493\\s*8157-971',
      account_section_end_regex: 'Closing\\s*totals',
      merge_continuation_rows: true,
      description_strip_regex: '^(Pre-Authorized\\s*Payment|Online\\s*Bill\\s*Payment),\\s*',
      date_format: 'MMM DD',
      amount_handling: 'split_debit_credit',
      amount_sign: 'natural',
      period_regex: 'For\\s+the\\s+period\\s+ending\\s+([A-Z][a-z]+)\\s+\\d{1,2},\\s+(\\d{4})',
      period_groups: { end_month: 1, end_year: 2 },
      totals: [
        {
          label: 'Total amounts deducted',
          regex: '8157-971\\s+[\\d,]+\\.\\d{2}\\s+([\\d,]+\\.\\d{2})\\s+[\\d,]+\\.\\d{2}\\s+[\\d,]+\\.\\d{2}',
          match: 'negative'
        },
        {
          label: 'Total amounts added',
          regex: '8157-971\\s+[\\d,]+\\.\\d{2}\\s+[\\d,]+\\.\\d{2}\\s+([\\d,]+\\.\\d{2})\\s+[\\d,]+\\.\\d{2}',
          match: 'positive'
        }
      ],
      account_type: 'chequing',
      institution: 'BMO',
      default_account: 'BMO Interest Chequing',
      default_currency: 'CAD'
    }
  },
];

export const RETIRED_BUILTIN_KEYS = new Set([
  'td_chequing_csv_v1', 'td_visa_csv_v1', 'td_aeroplan_visa_pdf_v1',
  'td_business_chequing_pdf_v1', 'rbc_chequing_csv_v1',
  'amex_ca_csv_v1', 'amex_platinum_pdf_v1', 'generic_csv_v1'
]);
