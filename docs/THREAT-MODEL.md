# IndiaPII Guard threat model

## Purpose and scope

This document describes what IndiaPII Guard protects, what it does not protect, and where its trust boundaries are. It covers version 1: the web page (`index.html`), the library (`js/guard.js` and the modules it loads) and the command-line tool (`scripts/redact.cjs`).

## Assets

- Identifiers in pasted text: Aadhaar numbers, PAN, UPI IDs, mobile numbers, card numbers, bank account numbers, IFSC, GSTIN and e-mail addresses that a user is about to share.
- The token map: the table that links each token (for example `[AADHAAR_1]`) to the original value. It holds the original values and is as sensitive as the input text.

## Intended use

A well-meaning user removes identifiers from text before sharing it with an LLM or a third party. The user reviews the findings, keeps any value that should stay, and copies the redacted text.

## Protects against

- Accidental inclusion of the v1 identifier types in their supported formats (section 3 of `docs/SPEC.md`): the values are found and replaced before the text is copied.

## Does not protect against

- Names, postal addresses, free-text personal details and quasi-identifiers (age, employer, locality and similar).
- Unsupported formats and deliberate obfuscation (for example digits spelled out as words, or identifiers split across lines).
- Images and PDFs; only text is checked.
- Re-identification from the remaining context of the redacted text.
- A compromised device, or browser extensions that read the page.
- Clipboard history and screen sharing.
- Copying the token map into a prompt.
- A malicious user who wants to leak data.

## Trust boundaries

- The page runs locally in the browser, from a web server or from a downloaded folder. Detection and redaction happen in the page.
- No network: the page makes no requests, and a Content Security Policy (`connect-src 'none'`) blocks them. Automated browser tests check that every request is local.
- The CLI runs on the user's machine with the user's file permissions. It reads one input file (or stdin) and writes to stdout or one output file. It never overwrites the input file.

## Residual risks and mitigations

| Risk | Mitigation |
|---|---|
| False negatives (an identifier is missed) | Review the highlighted text before copying; use the Lenient threshold for sensitive text; the evaluation report lists known misses |
| False positives (a reference number is redacted) | Untick the row to keep that value unredacted (per-finding keep) |
| The token map is pasted into a prompt | The map is collapsed by default and labelled "Do not paste it into the LLM" |
| Confidence is read as a probability | The page and the README state that it is a rule-based score |

## Data handling

- Input text is never stored, logged or sent.
- localStorage holds only the "help seen" flag and, if the user opts in, the settings. Turning "Remember" off removes the stored settings.
- No cookies and no analytics.

## Not legal advice

IndiaPII Guard helps reduce the personal data you share. It does not make any processing lawful or compliant with the Digital Personal Data Protection Act, 2023 or any other law. It is not legal advice.

## Reporting issues

Report misses, false positives and security issues with synthetic reproductions only. Build a value with the right structure and check digit, or change digits of a documented example. Never include a real identifier in an issue.
