export const DEFAULT_RULES = [
  // Groceries
  ['loblaws|\\bmetro\\b|sobeys|safeway|no frills|\\bcostco\\b|whole foods|farm boy|\\bt&t\\b|fortinos|food basics|freshco|provigo|\\biga\\b|zehrs|superstore|super-c|\\bmaxi\\b|adonis|\\bavril\\b|epicerie|grocery', 'Groceries'],
  // Dining
  ['tim hortons|starbucks|mcdonald|burger king|wendy|\\bkfc\\b|\\bsubway\\b|pizza|sushi|ramen|restaurant|\\bcafe\\b|bistro|uber eats|skip the dishes|doordash|grubhub|\\ba&w\\b|popeyes|domino|five guys|harveys|jack astor|swiss chalet|east side mario|st-?hubert|mr sub|chipotle|panera|freshii|montana|cactus club|\\bearls\\b|milestones|\\bdenny|brasserie|\\bgrill\\b|\\bbakery\\b|boulangerie|patisserie|\\beatery\\b|tavern|trattoria', 'Dining'],
  // Fuel
  ['petro-?canada|\\besso\\b|\\bshell\\b|chevron|\\bhusky\\b|ultramar|pioneer.*gas|7-eleven|sunoco|fas gas|suncor', 'Fuel'],
  // Transportation
  ['\\bpresto\\b|\\bttc\\b|via rail|go transit|\\bmiway\\b|oc transpo|\\bstm\\b|\\byrt\\b|brampton transit|407 etr|greyhound|flixbus|bike share|mobi bikes|\\bparking\\b', 'Transportation'],
  // Rideshare
  ['\\buber\\b|\\blyft\\b|taxify|indriver', 'Transportation'],
  // Shopping
  ['amazon|walmart|best buy|canadian tire|\\bikea\\b|\\bebay\\b|\\betsy\\b|sport chek|atmosphere|winners|homesense|marshalls|value village|dollarama|dollar tree|giant tiger|reitmans|\\broots\\b|lululemon|old navy|\\bh&m\\b|\\bzara\\b|\\bindigo\\b|chapters|sephora|holt renfrew|nordstrom|\\bsimons\\b|\\bmec\\b|mountain equipment|mark\'?s|sport mart|rec room|\\bsail\\b', 'Shopping'],
  // Utilities
  ['hydro|enbridge|toronto water|\\brogers\\b|\\bbell\\b|telus|\\bfido\\b|\\bkoodo\\b|virgin mobile|\\bshaw\\b|freedom mobile|eastlink|videotron|cogeco|natural gas|\\bfortis\\b|direct energy|union gas|\\bemera\\b|electricity|internet bill|wireless bill', 'Utilities'],
  // Subscriptions
  ['netflix|spotify|apple\\.com|disney\\+|disney plus|\\bcrave\\b|amazon prime|youtube premium|nytimes|globe and mail|new york times|\\bhulu\\b|paramount\\+|apple tv|apple music|google one|dropbox|\\badobe\\b|microsoft 365|office 365|onedrive|xbox game pass|\\btwitch\\b|duolingo|\\btidal\\b|\\baudible\\b|\\bnotion\\b|\\bzoom\\b|skillshare|coursera|\\blinkedin\\b|icloud storage|google storage', 'Subscriptions'],
  // Healthcare
  ['shoppers drug mart|rexall|pharma|pharmacy|dental|\\bclinic\\b|\\bmedical\\b|physiotherapy|chiropractic|optometrist|massage therapy|\\bdoctor\\b|\\bhospital\\b|\\bvision\\b|eyecare|eye care|hearing aid', 'Healthcare'],
  // Fitness
  ['goodlife|planet fitness|\\bymca\\b|snap fitness|\\bf45\\b|orangetheory|\\bequinox\\b|la fitness|\\bgym\\b|yoga studio|spin class|crossfit|anytime fitness|movati|athletic club', 'Fitness'],
  // Personal Care
  ['great clips|sport clips|hair salon|haircut|\\bspa\\b|nail salon|\\bbarber\\b|beauty supply|massage envy', 'Personal Care'],
  // Home
  ['\\brona\\b|home hardware|kent building|structube|\\beq3\\b|\\barticle\\b|wayfair|build direct|restoration hardware|pottery barn|west elm', 'Home'],
  // Insurance
  ['intact insurance|\\baviva\\b|td insurance|sonnet|belairdirect|co-operators|desjardins.*insur|state farm|allstate|wawanesa|insurance prem|assurance', 'Insurance'],
  // Entertainment
  ['cineplex|landmark cinemas|\\bimax\\b|steam.*game|nintendo|playstation|\\bxbox\\b|escape room|topgolf|\\bgolf\\b|\\bbowling\\b|\\bbar\\b|\\bpub\\b|live nation|ticketmaster|stubhub', 'Entertainment'],
  // Travel
  ['air canada|westjet|porter airlines|flair airlines|air transat|\\bhotel\\b|\\bmotel\\b|\\bresort\\b|marriott|hilton|\\bhyatt\\b|best western|airbnb|\\bvrbo\\b|booking\\.com|expedia|sunwing|swoop airlines|via rail', 'Travel'],
  // Education
  ['tuition|\\buniversity\\b|\\bcollege\\b|\\budemy\\b|student loan|\\bschool\\b|elearning', 'Education'],
  // Childcare
  ['daycare|day care|child care|babysit|kindercare|after school', 'Childcare'],
  // Rent/Mortgage
  ['mortgage pmt|mortgage payment|rent pmt|rent payment|strata fee|condo fee|property mgmt|lease payment|loyer', 'Rent/Mortgage'],
  // Taxes
  ['\\bcra\\b|agence du revenu|canada revenue|property tax|income tax remit', 'Taxes'],
  // Fees
  ['\\bnsf\\b|overdraft fee|annual fee|service charge|monthly fee|banking fee|atm fee|foreign transaction', 'Fees'],
  // Transfers
  ['e-?transfer|interac|virement|tfr to|tfr from|transfer to|transfer from', 'Transfer'],
  // CC Payment
  ['payment.*thank you|cc payment|paiement reçu|payment received', 'Credit Card Payment'],
  // Income
  ['payroll|\\bsalary\\b|direct dep|cra deposit|cra payment|direct deposit|employment insurance|\\bei\\b benefit', 'Income'],
];

export function applyDefaultRules(description) {
  const desc = (description || '').toLowerCase();
  for (const [pattern, cat] of DEFAULT_RULES) {
    if (new RegExp(pattern, 'i').test(desc)) return cat;
  }
  return null;
}

// A rule with no pattern matches any description (amount-only rule). Otherwise
// it uses the rule's match_type against the (lowercased) description.
function ruleMatchesDescription(rule, description) {
  if (!rule.pattern) return true;
  const desc = (description || '').toLowerCase();
  if (rule.match_type === 'regex') {
    try { return new RegExp(rule.pattern, 'i').test(desc); } catch { return false; }
  }
  if (rule.match_type === 'startswith') return desc.startsWith(rule.pattern.toLowerCase());
  return desc.includes(rule.pattern.toLowerCase());
}

// A rule with no amount_op matches any amount. Comparisons use the absolute
// value, so the user types 2300 and it matches a $2,300 txn either direction.
function ruleMatchesAmount(rule, amount) {
  if (!rule.amount_op) return true;
  const a = Math.abs(Number(amount));
  if (!Number.isFinite(a)) return false;
  const v = Number(rule.amount_value);
  const EPS = 0.005;
  switch (rule.amount_op) {
    case 'eq': return Math.abs(a - v) < EPS;
    case 'gt': return a > v;
    case 'lt': return a < v;
    case 'between': {
      const v2 = Number(rule.amount_value2);
      const lo = Math.min(v, v2), hi = Math.max(v, v2);
      return a >= lo - EPS && a <= hi + EPS;
    }
    default: return true;
  }
}

// Returns the category of the first rule (in the order given, i.e. priority)
// whose description AND amount conditions both match the transaction.
export function applyUserRules(transaction, rules) {
  for (const r of rules) {
    if (ruleMatchesDescription(r, transaction.description) && ruleMatchesAmount(r, transaction.amount)) {
      return r.category;
    }
  }
  return null;
}

export function autoCategorize(transaction, userRules=[]) {
  if (transaction.category) return transaction.category;
  // Explicit user rules win first — this is what lets an amount-conditioned rule
  // re-tag a generic transfer (e.g. an "e-Transfer Received" of $2,300 → Income)
  // even though it'd otherwise fall through to the type-based default below.
  const userMatch = applyUserRules(transaction, userRules);
  if (userMatch) return userMatch;
  if (transaction.transaction_type === 'cc_payment') return 'Credit Card Payment';
  if (transaction.transaction_type === 'transfer') return 'Transfer';
  if (transaction.transaction_type === 'income') {
    return applyDefaultRules(transaction.description) || 'Income';
  }
  if (transaction.transaction_type === 'refund') return 'Refund';
  return applyDefaultRules(transaction.description) || 'Other';
}

export function extractMerchant(description) {
  if (!description) return null;
  let s = description
    .replace(/\s+#\d+/g,'')
    .replace(/\s+\d{6,}/g,'')
    .replace(/\s+ON\b|\s+QC\b|\s+BC\b|\s+AB\b/g,'')
    .replace(/\s+CANADA$/i,'')
    .replace(/\s{2,}/g,' ')
    .trim();
  const words = s.split(/\s+/).slice(0, 4).join(' ');
  return words.length > 2 ? words : null;
}

export function inferTxnType(signedAmount, accountType, description='') {
  const desc = (description || '').toLowerCase();
  if (/payment.*received|cc payment|payment - thank you|payment thank you|paiement/i.test(desc)) {
    return accountType === 'credit_card' ? 'cc_payment' : 'transfer';
  }
  if (/(transfer|tfr|e-transfer|virement|^to\s|^from\s)/i.test(desc)) return 'transfer';
  if (/(refund|remboursement|return)/i.test(desc) && signedAmount > 0) return 'refund';

  if (accountType === 'credit_card') {
    if (signedAmount < 0) return 'expense';
    return /payment/i.test(desc) ? 'cc_payment' : 'refund';
  } else {
    return signedAmount < 0 ? 'expense' : 'income';
  }
}
