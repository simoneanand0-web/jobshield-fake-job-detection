const test = require("node:test");
const assert = require("node:assert/strict");
const {classify, validateListingText, getModelInfo, MAX_LISTING_CHARS} = require("../api/model");

test("listing validation rejects blank, short, and oversized input", () => {
  assert.equal(validateListingText("").status, 400);
  assert.equal(validateListingText("too short").status, 400);
  assert.equal(validateListingText("x".repeat(MAX_LISTING_CHARS + 1)).status, 413);
});

test("listing validation accepts text at the minimum and trims surrounding spaces", () => {
  const listing = ` ${"A".repeat(35)} `;
  assert.equal(validateListingText(listing).text, "A".repeat(35));
});

test("classifier returns risk level, model agreement, and evaluation metadata", () => {
  const result = classify("Data analyst role uses SQL and Python. Apply on the company's official careers page and review the salary range.");
  assert.ok(result.risk >= 0 && result.risk <= 100);
  assert.ok(["Low", "Medium", "High"].includes(result.riskLevel));
  assert.ok(result.modelAgreement >= 0 && result.modelAgreement <= 100);
  assert.equal(result.comparison.length, 4);
  assert.equal(result.evaluation.examples, 40);
});

test("classifier returns exact evidence for fee, messaging, personal email, and pay signals", () => {
  const listing = "No experience needed; earn $5,000 per week. Contact us only on WhatsApp, email hiring at recruiter@gmail.com, and pay a registration fee.";
  const result = classify(listing);
  const labels = result.explanations.map(item => item.label);
  const evidence = result.explanations.map(item => item.evidence.toLowerCase());
  assert.ok(labels.includes("Requests an upfront payment"));
  assert.ok(labels.includes("Pushes applicants to messaging-app-only or messaging-led contact"));
  assert.ok(labels.includes("Uses a personal email service for hiring contact"));
  assert.ok(labels.includes("Pairs unusually high pay with few requirements"));
  assert.ok(evidence.some(phrase => phrase.includes("registration fee")));
  assert.ok(evidence.some(phrase => phrase.includes("whatsapp")));
  assert.ok(evidence.some(phrase => phrase.includes("recruiter@gmail.com")));
});

test("model card identifies the bundled data and reports confusion counts for every model", () => {
  const card = getModelInfo();
  assert.equal(card.dataset.total, 40);
  assert.equal(card.dataset.legitimateStyle, 20);
  assert.equal(card.dataset.fakeStyle, 20);
  assert.match(card.dataset.source, /not EMSCAD/i);
  assert.equal(card.models.length, 4);
  for (const model of card.models) {
    assert.ok(Number.isFinite(model.precision));
    assert.ok(Number.isFinite(model.recall));
    assert.ok(Number.isFinite(model.f1));
    const {tp, fp, fn, tn} = model.confusionMatrix;
    assert.equal(tp + fp + fn + tn, card.evaluation.examples);
  }
});
