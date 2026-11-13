/* IndiaPII Guard samples: the five fixed sample documents of SPEC 8.6, rendered from seed 5005.
 * Pure; the same build() output on every call and machine. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode
    ? { synth: require('./synth.js'), prng: require('./prng.js') }
    : { synth: root.IndiaPIIGuard.synth, prng: root.IndiaPIIGuard.prng };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.IndiaPIIGuard = root.IndiaPIIGuard || {}; root.IndiaPIIGuard.samples = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var S = deps.synth;
  var P = deps.prng;

  var SEED = 5005;

  var TEMPLATES = [
    {
      id: 'support-ticket',
      title: 'Support ticket',
      note: 'A payment complaint with a phone, e-mail, card, UPI ID and Aadhaar number.',
      text: 'Ticket {DECOY:otp} - payment failed\n' +
        'Customer: {NAME}\n' +
        'Registered mobile: {PHONE}\n' +
        'Email: {EMAIL}\n' +
        'The customer says the refund for order {DECOY:order10} has not arrived. They paid with card {CARD} and later retried with UPI {UPI}.\n' +
        'Please verify the Aadhaar ({AADHAAR}) shared for KYC and call back.'
    },
    {
      id: 'hr-form',
      title: 'HR onboarding form',
      note: 'A form with labels on each line.',
      text: 'Employee onboarding form\n' +
        'Full name: {NAME}\n' +
        'Date of joining: {DATE}\n' +
        'PAN: {PAN}\n' +
        'Aadhaar No.: {AADHAAR}\n' +
        'Bank account no: {BANK_ACCOUNT}\n' +
        'IFSC: {IFSC}\n' +
        'Personal email: {EMAIL}\n' +
        'Emergency contact: {PHONE}'
    },
    {
      id: 'chat-log',
      title: 'Chat log',
      note: 'Timestamps and an invoice number look like numbers but are not personal data.',
      text: '[{DECOY:timestamp}] {NAME}: hi, my new number is {PHONE}\n' +
        '[{DECOY:timestamp}] Agent: thanks! can you share the GSTIN for the invoice?\n' +
        '[{DECOY:timestamp}] {NAME}: sure, {GSTIN}. invoice no {DECOY:invoice}\n' +
        '[{DECOY:timestamp}] Agent: got it. please don\'t share card numbers here.'
    },
    {
      id: 'hinglish',
      title: 'Hinglish message',
      note: 'Hinglish context words such as aadhar, khata and call karna.',
      text: 'bhai mera aadhar no {AADHAAR} hai aur pan card {PAN}. paise upi id {UPI} pe bhej do, ya khata number ' +
        '{BANK_ACCOUNT} (IFSC {IFSC}) mein daal do. kuch problem ho toh {PHONE} pe call karna.'
    },
    {
      id: 'ocr-noisy',
      title: 'Noisy scanned text',
      note: 'OCR-style text: O for 0 and l for 1. The second Aadhaar number has three lookalikes and is missed on ' +
        'purpose to show the limit.',
      text: 'KYC  VERIFICATION  RECEIPT\n' +
        'NAME : {NAME_UPPER}\n' +
        'AADHAAR N0 : {AADHAAR|noise=ocr1}\n' +
        'M0BILE : {PHONE|noise=ocr1,fmt=none/5-5}\n' +
        'PAN : {PAN}\n' +
        'AADHAAR (RESCAN) : {AADHAAR|noise=ocr3,knownMiss}\n' +
        'AMOUNT PAID : {AMOUNT}'
    }
  ];

  // Renders the five templates in order with one mulberry32(5005) generator.
  function build() {
    var rng = P.mulberry32(SEED);
    var avoid = new Set();
    var out = [];
    for (var i = 0; i < TEMPLATES.length; i++) {
      var t = TEMPLATES[i];
      var r = S.renderTemplate(rng, S.parseTemplate(t.text), avoid);
      out.push({
        id: t.id,
        title: t.title,
        note: t.note,
        text: r.text,
        gold: r.gold.map(function (g) { return { entity: g.entity, start: g.start, end: g.end, knownMiss: g.knownMiss }; })
      });
    }
    return out;
  }

  return { SEED: SEED, TEMPLATES: TEMPLATES, build: build };
});
