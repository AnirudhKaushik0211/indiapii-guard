# Case study: IndiaPII Guard

Template. Every real-world value is a `[[placeholder]]`. Fill only with real, checked numbers; delete any clause you can't support.

## One-line summary

A browser-only detector and redactor for Indian personal data (Aadhaar, PAN, UPI, phone, cards, bank details) in text bound for LLM prompts, with a published, reproducible evaluation on synthetic data.

## Links

- Live demo: [[live demo address]]
- Repository: [[repository address]]
- Release date: [[YYYY-MM-DD]]

## The problem

People paste support tickets, HR forms and chat logs into LLM prompts. That text often holds Aadhaar numbers, PAN, UPI IDs, mobile, card and bank numbers. General-purpose PII tools focus on other countries' formats, and uploading text to a cloud redaction service defeats the purpose. [[One or two sentences from your own experience of the problem, if any.]]

## What I built

- A static web page that finds nine identifier types as you type, highlights them, explains each finding and produces redacted text (tokens, masks or partial masks) with a token map that stays in the page.
- A zero-dependency JavaScript library for Node and the browser, and a CLI for files and pipelines.
- A synthetic data generator, three evaluation sets (development, held-out, adversarial) and a release gate fixed before measuring.
- Browser smoke tests in Edge and Firefox, a deny-list scan and a PII self-scan that guard the public package.

## Key decisions and trade-offs

- Rules and checksums vs an ML NER model: Indian identifiers have rigid structures, and Aadhaar, cards and GSTIN carry public check digits. Rules give high precision, explainable findings and fast in-browser execution with no dependencies. The cost: names and addresses are out of scope.
- Precision vs recall per entity: checksummed identifiers can be reported on structure alone; the others need context. Negative context ("order", "utr", "rs") lowers scores to keep reference numbers out.
- Why context is required for bank accounts: there is no public checksum, so a bare 9-18 digit number is far more often an order or reference number. Bank accounts start at 0.30 and need a word such as "a/c" to be reported.
- Why browser-only: the text that needs redacting is exactly the text that should not be uploaded. No network requests (blocked by a Content Security Policy and checked by automated tests).
- Why classic scripts: ES modules do not load from `file://`, and the page must work when double-clicked from a downloaded folder.
- Why tokens instead of fake values: tokens such as `[PHONE_1]` are obviously not real, keep the text readable for the LLM, and stay consistent within one text.

## How I evaluated it

- Three synthetic sets built from templates with fixed seeds: development (used while building), held-out (different structures and some unknown context phrasings, frozen before any run) and adversarial (OCR noise, spacing, lower case, obfuscation and many lookalike decoys).
- Exact span matching, per-entity precision and recall with Wilson intervals, leak rate and decoy hit rate.
- The release gate (27 criteria) was fixed in the SPEC before the first measurement and was never changed.
- Gate result, copied from `docs/EVAL-REPORT.md`: PASS (27 of 27 criteria met) on held-out run 2. Held-out run 1 failed (24 of 27): G05 (held-out PHONE precision), G10 (held-out UPI recall) and G21 (adversarial decoy hit rate). I held the release, traced the causes on the development and adversarial sets only (a missing Devanagari "order" word and "complaint" as negative context, payment words as UPI context, and labels of the next value counted for a reference number), fixed them with unit tests and recorded each change in `eval/HISTORY.md`. Because some fixes cite adversarial documents, the adversarial results are no longer unseen data.
- Held-out runs used: 2 of 3, each recorded in `eval/HISTORY.md`.

## What I measured after launch

The app has no analytics by design. Only what GitHub shows the owner is measured; visits to the live page, texts redacted and time in the app are not measurable.

| Metric | Source | Day 30 | Day 90 |
|---|---|---|---|
| Release gate result | `npm run eval` | [[n]] | [[n]] |
| Held-out precision / recall per entity | `docs/EVAL-REPORT.md` | [[n]] | [[n]] |
| Stars and forks | Repository page | [[n]] | [[n]] |
| Repository views and unique visitors | Insights > Traffic | [[n]] | [[n]] |
| Referring sites | Insights > Traffic | [[n]] | [[n]] |
| Clones | Insights > Traffic | [[n]] | [[n]] |
| Release ZIP downloads | GitHub REST API release asset `download_count` | [[n]] | [[n]] |
| Issues reporting misses or false positives | Issues | [[n]] | [[n]] |

## What I learned

- [[Lesson 1]]
- [[Lesson 2]]
- [[Lesson 3]]

## What's next

- [[Next step 1, for example a new held-out set with a new seed for v1.1]]
- [[Next step 2]]

## Resume line

"Built IndiaPII Guard, an open-source, browser-only detector and redactor for Indian personal data (Aadhaar, PAN, UPI, cards); [[P]]% precision / [[R]]% recall on a [[N]]-span synthetic held-out set, p95 [[L]] ms for 10 KB in-browser; [[S]] stars, [[D]] downloads in [[W]] weeks."

Fill only with real, checked numbers; delete any clause you can't support.
