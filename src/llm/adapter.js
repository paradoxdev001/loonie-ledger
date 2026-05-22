export const LLM_KEY_STORAGE = {
  provider: 'loonieledger_llm_provider',
  anthropic: 'loonieledger_llm_key_anthropic',
  openai: 'loonieledger_llm_key_openai',
};

export const LLM_PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-6', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai:    { label: 'OpenAI (GPT)',       defaultModel: 'gpt-4o',            keyUrl: 'https://platform.openai.com/api-keys' },
};

export function getLLMConfig() {
  const provider = localStorage.getItem(LLM_KEY_STORAGE.provider) || 'anthropic';
  const apiKey = localStorage.getItem(LLM_KEY_STORAGE[provider]) || '';
  return { provider, apiKey, model: LLM_PROVIDERS[provider]?.defaultModel };
}

export function setLLMConfig({ provider, apiKey }) {
  if (provider) localStorage.setItem(LLM_KEY_STORAGE.provider, provider);
  if (provider && typeof apiKey === 'string') localStorage.setItem(LLM_KEY_STORAGE[provider], apiKey.trim());
}

export const SPEC_JSON_SCHEMA = {
  type: 'object',
  properties: {
    spec: {
      type: 'object',
      description: 'The converter spec object that applyConverter consumes.',
      properties: {
        type: { type: 'string', enum: ['csv', 'pdf'] },
        has_header: { type: 'boolean' },
        delimiter: { type: 'string' },
        skip_top_rows: { type: 'integer' },
        skip_bottom_rows: { type: 'integer' },
        columns: { type: 'object', description: 'CSV: field->header-name/index. Columns-mode PDF: array handled separately.', additionalProperties: true },
        line_regex: { type: 'string' },
        groups: { type: 'object', additionalProperties: { type: 'integer' } },
        next_line_amount_regex: { type: 'string' },
        next_line_amount_lookahead: { type: 'integer' },
        layout: { type: 'string', enum: ['columns'] },
        pdf_columns: {
          type: 'array',
          description: 'For layout:"columns" — written to spec.columns. Each entry {name,x_min,x_max}.',
          items: { type: 'object', properties: { name: { type: 'string' }, x_min: { type: 'number' }, x_max: { type: 'number' } }, required: ['name', 'x_min', 'x_max'] },
        },
        account_section_regex: { type: 'string' },
        account_section_end_regex: { type: 'string' },
        merge_continuation_rows: { type: 'boolean' },
        description_strip_regex: { type: 'string' },
        description_strip_regex_flags: { type: 'string' },
        period_regex: { type: 'string' },
        period_groups: { type: 'object', additionalProperties: { type: 'integer' } },
        year: { type: 'integer' },
        date_format: { type: 'string', description: "e.g. YYYY-MM-DD, MM/DD/YYYY, 'MMM DD', MMMDD, auto" },
        amount_handling: { type: 'string', enum: ['single_signed', 'split_debit_credit'] },
        amount_sign: { type: 'string', enum: ['natural', 'flipped'] },
        totals: {
          type: 'array',
          items: { type: 'object', properties: { regex: { type: 'string' }, match: { type: 'string', enum: ['all', 'positive', 'negative'] }, label: { type: 'string' } }, required: ['regex', 'match'] },
        },
        account_type: { type: 'string' },
        default_account: { type: 'string' },
        default_currency: { type: 'string' },
      },
      required: ['type', 'date_format', 'amount_handling', 'amount_sign', 'account_type'],
      additionalProperties: true,
    },
    explanation: { type: 'string', description: 'One or two sentences: what you detected, or what you changed.' },
  },
  required: ['spec', 'explanation'],
};

export const LLM_SYSTEM_PROMPT = `You are an expert at reverse-engineering bank/credit-card statement formats into a deterministic parser spec. You are given an excerpt of ONE statement (CSV text, or PDF text, and for tabular PDFs a sample of items with their x-coordinates). Produce a converter spec JSON that will correctly extract every transaction. The spec is consumed by a deterministic engine — you must get regexes, column names, date formats and signs exactly right.

SIGN CONVENTION: after normalization, amount < 0 = money out (expense), amount > 0 = money in. amount_sign "natural" keeps the raw sign; "flipped" negates it (use for credit-card statements where charges print as positive). amount_handling is "single_signed" (one amount column/group) or "split_debit_credit" (separate debit & credit columns).

DATE FORMATS: tokens YYYY/YY/MMM/MM/M/DD/D. "MMM" = 3-letter month (JAN..DEC); full month names are sliced to 3 letters. Compact forms like "MMMDD" (JAN30, no separator) are supported. Use "auto" only as a last resort.

CSV spec: { type:"csv", has_header, delimiter, skip_top_rows?, columns:{transaction_date, description, amount | debit+credit, posted_date?}, date_format, amount_handling, amount_sign, account_type, default_account, default_currency }. Column values are header names (when has_header) or 0-based indices.

PDF line-regex spec: { type:"pdf", line_regex (matches ONE transaction line), groups:{transaction_date, posted_date?, description, amount}, date_format, amount_handling, amount_sign, ... }. Capture-group indices are 1-based. When the signed amount sits on the NEXT line (e.g. Amex), set next_line_amount_regex and point groups.amount at it. PDF lines often carry only "MMM DD" with no year — supply period_regex + period_groups (capturing start_month/start_year?/end_month/end_year) so the engine recovers the year from the statement header; start_year may be omitted. As a fallback set "year".

PDF columns-layout spec (use when debit vs credit depends on x-position, not text): { type:"pdf", layout:"columns", pdf_columns:[{name,x_min,x_max}], ... }. Standard names: description, debit, credit, date, balance (or amount for single_signed). Derive x ranges from the provided x-coordinate sample. Optional: account_section_regex + account_section_end_regex (scope to one account in a multi-account file), merge_continuation_rows (fold undated wrap rows into the prior description), description_strip_regex (+_flags) to strip boilerplate prefixes.

OPTIONAL totals sanity-check: totals:[{regex (group1 = a printed dollar total), match:"all"|"positive"|"negative", label}].

Return ONLY the structured spec + a one or two sentence explanation. If given a current spec and parse errors, return a corrected spec and say what you changed.`;

export async function callLLM({ provider, apiKey, model, messages, signal }) {
  if (!apiKey) throw new Error('No API key set for ' + provider);
  if (provider === 'anthropic') return callAnthropic({ apiKey, model, messages, signal });
  if (provider === 'openai') return callOpenAI({ apiKey, model, messages, signal });
  throw new Error('Unknown provider: ' + provider);
}

async function callAnthropic({ apiKey, model, messages, signal }) {
  const tool = {
    name: 'emit_converter_spec',
    description: 'Emit the converter spec JSON and a short explanation.',
    input_schema: SPEC_JSON_SCHEMA,
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || LLM_PROVIDERS.anthropic.defaultModel,
      max_tokens: 2048,
      system: LLM_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'emit_converter_spec' },
      messages,
    }),
  });
  if (!res.ok) throw new Error(await llmErrorText(res));
  const data = await res.json();
  const block = (data.content || []).find(b => b.type === 'tool_use');
  if (!block) throw new Error('Model did not return a spec.');
  return { spec: block.input.spec, text: block.input.explanation || '' };
}

async function callOpenAI({ apiKey, model, messages, signal }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: model || LLM_PROVIDERS.openai.defaultModel,
      messages: [{ role: 'system', content: LLM_SYSTEM_PROMPT }, ...messages],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'converter_spec', schema: SPEC_JSON_SCHEMA },
      },
    }),
  });
  if (!res.ok) throw new Error(await llmErrorText(res));
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Model returned no content.');
  const parsed = JSON.parse(content);
  return { spec: parsed.spec, text: parsed.explanation || '' };
}

async function llmErrorText(res) {
  let detail = '';
  try { const j = await res.json(); detail = j.error?.message || JSON.stringify(j.error || j); }
  catch { detail = await res.text().catch(() => ''); }
  if (res.status === 401) return 'Invalid or missing API key (401). Check your key.';
  if (res.status === 429) return 'Rate limited (429). Wait a moment and retry.';
  return `Request failed (${res.status}). ${detail}`.trim();
}

export function normalizeWizardSpec(spec) {
  if (!spec) return spec;
  const out = { ...spec };
  if (out.layout === 'columns' && Array.isArray(out.pdf_columns)) {
    out.columns = out.pdf_columns;
    delete out.pdf_columns;
  }
  return out;
}
