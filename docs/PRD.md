# IndiaPII Guard: Product Requirements Document

Status: v1.0 (MVP). Owner: the repository owner. Companion documents: [SPEC.md](SPEC.md) (clean-room build spec), [EVAL-REPORT.md](EVAL-REPORT.md) (generated evaluation report), [THREAT-MODEL.md](THREAT-MODEL.md) (what it protects against and what it does not), [CASE-STUDY.md](CASE-STUDY.md) (portfolio write-up template).

## 1. Summary

IndiaPII Guard is a free, open-source, browser-only tool that finds Indian personal identifiers in text and redacts them before the text is pasted into an LLM prompt, a ticket, a log or a chat. It detects Aadhaar numbers, PANs, Indian mobile numbers, e-mail addresses, UPI IDs, IFSC codes, bank account numbers (with context), payment card numbers and GSTINs. Each detector combines a pattern, a checksum or structure check where one exists (Verhoeff for Aadhaar, Luhn for cards, the GSTIN check character, the PAN holder-type letter) and context words in English, Hinglish and a few Hindi words, and gives every finding a rule-based confidence score.

It comes in three forms that share one detection core:

- A single static web page (paste text, see highlighted findings, copy the redacted text). It works on GitHub Pages and offline by double-clicking `index.html`. No server, no network calls, no analytics, no cookies; input text is never stored.
- A small JavaScript library (the same files, loadable from Node with `require`).
- A command-line tool for developers: `node scripts/redact.cjs <file>`.

The key artefact is a reproducible, published evaluation. `npm run eval` builds labelled synthetic datasets from a seeded generator (a development set, a separately generated held-out set with different templates and seed, and an adversarial set with Hinglish, noise, OCR-like substitutions and lookalike non-PII), measures per-entity precision, recall and F1 at the span level, lists failures and false positives, measures latency, and checks a release gate that is fixed in the SPEC before any measurement. The result is reported as measured, pass or fail.

All test data is synthetic and randomly generated. It is not linked to any person. Any match with a real identifier would be coincidental.

## 2. Problem

Teams in India are putting LLMs into support, HR, lending, payments and operations workflows. The text that goes into those prompts is full of personal data: a customer pastes an Aadhaar number into a chat, an HR form carries a PAN and a bank account, a payment dispute quotes a UPI ID and the last digits of a card. Once that text is in a prompt it may be sent to a third-party model provider, logged, cached or used for evaluation. India's Digital Personal Data Protection Act, 2023 and the DPDP Rules (notified on 13 November 2025, with obligations phasing in through 2026 and 2027 according to public commentary) make careless handling of personal data a compliance and trust problem.

The gap, from the market research behind this project:

- General PII tools are built around US and EU identifiers (SSNs, IBANs). Indian identifiers need their own rules: Aadhaar's Verhoeff check digit, the PAN holder-type letter, UPI's `<name>@<handle>` form that looks like an e-mail address, Indian mobile prefixes and groupings, IFSC and GSTIN structures.
- Real Indian text is mixed: Hinglish ("mera aadhar no ... hai"), copy-pasted forms, OCR output with O/0 and l/1 swaps, and many numbers that look like PII but are not (order IDs, UTRs, timestamps, prices).
- None of the tools found publishes an honest, reproducible evaluation for Indian identifiers, so users can't tell how much to trust them.

## 3. Target users

| Persona | Context | What they need from the tool |
|---|---|---|
| Developer building an LLM feature (support bot, HR assistant, fintech copilot) | Needs to strip identifiers before calling a model API | A library and CLI with documented rules, confidence scores and consistent tokens such as `[AADHAAR_1]` so the model can still refer to "the Aadhaar number" |
| Product manager or analyst | Pastes real tickets or chats into an LLM to summarise or analyse them | A paste-and-copy page that runs locally, with a clear findings table |
| Support, HR or operations staff | Copies customer text into tools | A simple page that works offline and explains what it found and what it may have missed |
| Privacy, security or compliance reviewer | Assesses whether a redaction step is good enough | A published evaluation with failure cases, a threat model and an explicit statement of limitations |
| Student or job seeker | Learning PII detection and evaluation practice | Readable rules, validator explanations and a reproducible eval |

Assumption: users understand that redaction reduces risk but does not remove it. The Help tab, README and threat model say this plainly.

## 4. Jobs to be done

1. When I am about to paste customer text into an LLM, I want the Indian identifiers in it replaced, so I do not send personal data to a third party by accident.
2. When the tool flags something, I want to see why (checksum, context word, confidence), so I can trust or override it.
3. When the same identifier appears several times, I want the same placeholder each time, so the model's answer still makes sense and I can map it back.
4. When I build a pipeline, I want the same detector as a library and a CLI, so I can run it in code and in CI.
5. When I decide whether to rely on it, I want honest numbers on a held-out set, the failure cases and the limits, so I know what it misses.

## 5. Competitors and differentiation

Taken from the market research behind this project. Descriptions are limited to what that research recorded.

| Tool | Type (as recorded) | Gap this project fills |
|---|---|---|
| [aisafeguard](https://github.com/akshaymagapu/aisafeguard) | LLM guardrail library with PII features | Not centred on Indian identifiers; no published India-specific evaluation found |
| [guardrails-prompt-injection-defense](https://github.com/Dhineshkumar-710/guardrails-prompt-injection-defense) | Offline prompt-injection and PII pipeline | Developer pipeline, not a no-install page; no published India-specific evaluation found |
| [DFKI PII guardrail browser extension](https://github.com/dfki-dsa/pii-guardrail-browser-extension) | Browser extension | Needs installation; not India-specific |
| Microsoft Presidio | General PII detection framework | Reported to include some India-specific recognizers (not verified in this research); needs a Python service; no India-focused public evaluation found |

Differentiation, in order of importance:

1. Indian identifiers first, with real validators (Verhoeff, Luhn, GSTIN check character, PAN structure) and Indian context words, including Hinglish.
2. A reproducible, honest evaluation: synthetic but labelled, with a separate held-out set, an adversarial set, failure listings and a release gate set before measuring.
3. Privacy by construction: one static page, no network, works offline, input never stored.
4. One core in three forms (page, library, CLI), with zero dependencies.

## 6. v1 entity decisions

| Entity (label) | v1? | Rule summary | Why |
|---|---|---|---|
| Aadhaar number (`AADHAAR`) | Yes | 12 digits, first digit 2-9, Verhoeff check digit; contiguous or grouped 4-4-4 with spaces or hyphens | Core Indian identifier; the checksum gives high precision |
| Aadhaar Virtual ID (16 digits) | No (backlog) | - | Its check-digit scheme was not confirmed from a public source for this design, and a 16-digit number collides with card formats. Documented as a limitation |
| PAN (`PAN`) | Yes | 5 letters, 4 digits, 1 letter; the 4th letter must be a holder-type code (P, C, H, F, A, T, B, L, J, G); upper case alone, other case only with context | Core tax identifier; structure check limits false positives |
| Indian mobile number (`PHONE`) | Yes | 10 digits starting 6-9, optional `+91`, `91`, `0`, `0091` or `(+91)` prefix, common groupings | Most common identifier in support text |
| Landline | No (backlog) | - | Variable STD-code lengths make precise rules hard; high false-positive risk |
| E-mail address (`EMAIL`) | Yes | Standard address with a dotted domain | Universal personal identifier |
| UPI ID / VPA (`UPI`) | Yes | `<name>@<handle>` where the handle has no dot; known handles score higher, unknown handles need context | India-specific payment identifier. Precedence with e-mail is fixed: a dot in the domain means e-mail, no dot means UPI, never both |
| IFSC (`IFSC`) | Yes | 4 letters, the digit 0, 6 letters or digits | Identifies a bank branch; together with an account number it identifies a person's account |
| Bank account number (`BANK_ACCOUNT`) | Yes, context required | 9-18 digits, reported only near words such as "account", "a/c", "khata" | Without context any long number would match; context keeps precision usable |
| Payment card number (`CARD`) | Yes | 13-19 digits, Luhn, first digit 2-6, common groupings | High-risk financial identifier |
| GSTIN (`GSTIN`) | Yes | 2-digit state code, embedded PAN, entity code, check character | Has a public check-character algorithm; for sole proprietors it embeds a personal PAN |
| Passport number | No (backlog) | - | 1 letter + 7 digits collides with many product and reference codes; would need context-only detection and its own evaluation |
| Vehicle registration | No (backlog) | - | Many state formats; not a priority for LLM prompts |
| Date of birth | No (backlog) | - | Needs date parsing and context; dates are everywhere |
| Person names, addresses | No | - | Needs NER (a model), which v1 deliberately does not include. Names and addresses in text are left as-is; this is the biggest limitation and is stated everywhere |

## 7. MVP scope

### 7.1 Detection core

- The nine v1 entities in section 6, each with a documented rule, validator and confidence calculation (SPEC section 3).
- Context words per entity in English, Hinglish transliterations (for example "aadhar", "khata", "mobile no", "call karna") and a few Hindi words in Devanagari. Context raises confidence; negative context ("order", "invoice", "UTR", "txn", "Rs", "₹" and similar) lowers it; a context word for a different numeric entity on the same line lowers it slightly.
- OCR-style lookalike handling: inside long numbers, O/o read as 0 and I/l read as 1 (at most two substitutions per number, with a confidence penalty). The pipe `|` is not treated as a lookalike, so pipe-delimited fields are never fused into one number.
- Confidence is a rule-based score from 0.00 to 0.99, not a calibrated probability. Default threshold 0.50, with Lenient (0.35) and Strict (0.70) presets.
- Overlaps are resolved deterministically (longer span, then higher confidence, then a fixed entity priority).

### 7.2 Redaction

- Styles: typed token (default, for example `[AADHAAR_1]`), mask (`XXXX XXXX XXXX`), partial (keep the last 4 characters; for e-mail and UPI keep the first character and the domain or handle).
- Consistent tokens within one text: the same identifier gets the same token; numbering follows first appearance. No hashing, so tokens can't be linked across texts.
- A token map (token -> original) shown only in the page, so users can map an LLM's answer back.
- Per-finding override: the user can keep any finding unredacted.

### 7.3 Web page

- Tabs: Help (opens first for new visitors), Redact, Settings.
- Redact: input box, five synthetic sample texts (support ticket, HR form, chat log, Hinglish message, noisy OCR-like text), highlighted view with entity labels and confidence, findings table with reasons, redacted output with a Copy button, token map.
- Settings: entity on/off toggles, redaction style, threshold preset, lookalike handling on/off, an opt-in "remember settings on this device" (settings only, never text).
- Quality bar: keyboard operable, visible focus in Edge and Firefox, labelled controls, colour never the only signal, contrast at least 4.5:1, reflow to 320 px, collision-proof element ids, safe field reads, visible status messages, no `alert`.

### 7.4 Library and CLI

- `IndiaPIIGuard.detect(text, options)` and `IndiaPIIGuard.redact(text, options)` in the browser and via `require('./js/guard.js')` in Node. API documented in the README.
- `node scripts/redact.cjs <file|-> [--style] [--threshold] [--entities] [--no-ocr] [--json] [--out] [--fail-on-find]`.
- MCP server: out of scope for v1.

### 7.5 Evaluation

- `npm run eval`: builds the dev, held-out and adversarial sets from seeded generators and templates, measures span-level precision, recall and F1 per entity (exact match as the primary rule, overlap match reported too), character-level leak rate, decoy false-positive rate, per-format and per-language recall, a confusion table, a threshold sweep, failure examples, and latency (p50/p95 for 1 KB and 10 KB inputs in Node; in Edge and Firefox via `npm run bench:browser`).
- Writes `eval/results/metrics.json` (deterministic: identical on every run), latency JSON files, `docs/EVAL-REPORT.md` and the README headline table.
- Release gate fixed in SPEC section 9.8 before measuring; reported honestly as PASS, FAIL or INCOMPLETE.

### 7.6 Documents

README (public, exhaustive), PRD, SPEC, EVAL-REPORT (generated), THREAT-MODEL, CASE-STUDY (placeholders for real usage numbers), LICENSE (MIT, placeholder holder).

## 8. Non-goals (v1)

- Names, addresses, dates of birth and other free-text personal data (no NER model).
- Images, PDFs, scanned documents, audio. Text only.
- Indian-language scripts beyond a few Devanagari context words. Devanagari digits are not detected.
- Aadhaar VID, landline numbers, passport numbers, vehicle registrations, voter IDs, driving licences.
- Format-preserving fake values (pseudonyms that look like real Aadhaar numbers). Tokens are used instead.
- Re-identification protection beyond identifiers: quasi-identifiers (employer, city, age) are left in the text.
- A compliance product. It is not a DPDP compliance tool, certification or legal advice.
- An MCP server, a browser extension, a hosted API, npm publishing.
- Accounts, a backend, telemetry, analytics.

## 9. User flows

### Flow A: first visit

1. Open the page. The Help tab is shown first.
2. Read "What it does" and "Privacy", or press "Try a sample".
3. The Redact tab opens with the support-ticket sample loaded, findings highlighted and the redacted output ready.

### Flow B: redact before prompting

1. Redact tab: paste text.
2. Read the highlighted findings and the table (entity, text, confidence, why).
3. Untick any finding that should stay.
4. Press Copy and paste the redacted text into the LLM.
5. Optionally open the token map to map the LLM's answer back.

### Flow C: tune

1. Settings: switch off entities that are not sensitive in this context, choose a style, choose Strict or Lenient.
2. Back on Redact, the findings update immediately.

### Flow D: developer

1. `node scripts/redact.cjs ticket.txt > ticket.redacted.txt`, or `--json` for findings.
2. In code: `const guard = require('./js/guard.js'); guard.redact(text).text`.
3. In CI: `--fail-on-find` exits 3 when anything is found.

### Flow E: evaluate

1. `npm run eval`, then read `docs/EVAL-REPORT.md`.
2. `npm run eval -- --write-data` to inspect the generated, labelled data.

## 10. Success metrics (honestly measurable)

The app has no analytics by design, so adoption is measured only with what GitHub shows the owner. No usage figures appear in the README or the app.

| Metric | Source | How to record | Notes |
|---|---|---|---|
| Release gate result | `npm run eval` | Every release | Reported as PASS, FAIL or INCOMPLETE, never adjusted after measuring |
| Held-out precision / recall per entity | `docs/EVAL-REPORT.md` | Every release | Synthetic, self-constructed data; stated next to every number |
| Stars and forks | Repository page | Weekly snapshot in a private sheet | Public numbers |
| Repository views and unique visitors | Insights > Traffic | Weekly snapshot (GitHub keeps 14 days) | Repository page views, not GitHub Pages visits |
| Referring sites | Insights > Traffic | Weekly snapshot | Which launch channel worked |
| Clones | Insights > Traffic | Weekly snapshot | Developer interest |
| Release ZIP downloads | Release asset `download_count` from the GitHub REST API (`GET /repos/{owner}/{repo}/releases`) | At 7, 30 and 90 days | Offline users |
| Issues reporting misses or false positives | Issues | Count at 30 and 90 days | Each confirmed report becomes a new test case |

Not measurable: visits to the live page, texts redacted, time in the app. The case study must say so instead of estimating.

## 11. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Users treat redaction as complete | Personal data leaks through misses (names, addresses, unusual formats) | Limitations in Help, README, threat model and every eval report; "not a compliance guarantee" wording; names and addresses explicitly out of scope |
| Over-claiming accuracy | Credibility loss | Synthetic-data caveat next to every number; held-out set separate from development; gate fixed before measuring; failures listed; confidence intervals shown |
| Eval that only measures what the generator produces | Optimistic numbers | Adversarial set, unsupported formats included on purpose, per-format recall, held-out templates written before tuning and frozen, every held-out run logged in `eval/HISTORY.md` |
| Real people's identifiers in the repository | Privacy breach | Seeded generator only; no generated datasets committed; card numbers only from public test numbers; e-mail only on reserved example domains; masked excerpts in the eval report; a package-time self-scan with the detector that fails on any identifier not in a short list of documented synthetic examples |
| False positives annoy users | Users stop using it | Context words, negative context, checksums; per-finding override; threshold presets; decoy false-positive rate gated |
| Catastrophic regex backtracking | Page freezes | Linear hand-written scanners, bounded quantifiers, a ReDoS test |
| Legal-advice perception (DPDP) | Liability, credibility | "Not legal advice" in the README, Help and threat model; DPDP described only at a high level with public sources |
| ES modules blocked on file:// | Offline double-click fails | Classic scripts with a UMD wrapper; smoke test in file:// mode in Edge and Firefox |
| Private data or employer-related content in the public repo | Policy breach | Clean-room build; allow-list packaging; deny-list scan (0 hits required); visible-text scan before screenshots; manual look at every screenshot |

## 12. Launch plan

Approval first: nothing is published until the owner has open-source approval.

1. Pre-launch: all tests, eval, browser smoke tests (Edge and Firefox, file and http modes) and the package scans pass; every screenshot checked by eye; README complete.
2. Publish: public repository created with GitHub's MIT licence and the Node `.gitignore`; package contents uploaded (except `LICENSE` and `.gitignore`); GitHub Pages from `main` / root; About text and topics (`pii`, `pii-detection`, `redaction`, `privacy`, `india`, `aadhaar`, `upi`, `llm`, `dpdp`, `github-pages`); release v1.0.0 with the zip.
3. Share: posts in Indian developer and privacy communities with one screenshot and the eval headline; feedback through GitHub Issues only.
4. Review at day 30 and day 90: record section 10 metrics, fill CASE-STUDY with real numbers, turn confirmed misses into test cases, plan v1.1 (candidates: Aadhaar VID with a confirmed check scheme, passport and DOB with context, an MCP server, a browser extension).

## 13. Assumptions

- Input is plain text pasted or typed by the user; UTF-16 offsets as in JavaScript strings.
- Identifiers are written with ASCII digits and Latin letters.
- The synthetic formats and contexts in the generator cover the common ways these identifiers are written; real text will contain formats the generator does not, and the eval cannot measure those.
- The UPI handle list is compiled from public sources, is not exhaustive and will age; unknown handles fall back to context.
- The PAN holder-type letters are the commonly published list; it was not verified against the issuing authority for this design.
