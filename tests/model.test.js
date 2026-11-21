const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  classify,
  scoreForText,
  validateListingText,
  getModelInfo,
  MAX_LISTING_CHARS
} = require("../api/model");

test("listing validation rejects blank, short, and oversized input", () => {
  assert.equal(validateListingText("").status, 400);
  assert.equal(validateListingText("too short").status, 400);
  assert.equal(validateListingText("x".repeat(MAX_LISTING_CHARS + 1)).status, 413);
});

test("listing validation accepts minimum-length text and trims surrounding spaces", () => {
  const listing = ` ${"A".repeat(35)} `;
  assert.equal(validateListingText(listing).text, "A".repeat(35));
});

test("the live model returns bounded risk and actual dataset evaluation metadata", () => {
  const result = classify("Data analyst role uses SQL and Python. Apply on the company's official careers page and review the salary range.");
  assert.ok(result.risk >= 0 && result.risk <= 100);
  assert.ok(["Low", "Medium", "High"].includes(result.riskLevel));
  assert.ok(result.trainingExamples > 1000);
  assert.equal(result.evaluation.method.includes("held-out test split"), true);
  assert.ok(result.comparison.length >= 3);
  assert.match(result.scoreLabel, /not a .*probability/i);
});

test("known scam signals return exact phrases and practical explanations", () => {
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

test("model card identifies EMSCAD and reports fake-class metrics and matrices", () => {
  const card = getModelInfo();
  assert.match(card.dataset.name, /EMSCAD/);
  assert.equal(card.dataset.rowsAfterCleaning, card.dataset.legitimate + card.dataset.fake);
  assert.ok(card.dataset.fake > 0 && card.dataset.fake < card.dataset.legitimate);
  assert.match(card.evaluation.method, /stratified 80\/20/i);
  assert.equal(card.models.length, 4);
  assert.ok(card.models.some(model => model.name === card.selectedModel));
  assert.equal(card.crossValidation.folds.length, 5);
  assert.equal(card.crossValidation.threshold, 0.5);
  assert.equal(card.thresholdTuning.deployed, false);
  assert.equal(card.modernQualitativeChecks.length, 3);
  for (const model of card.models) {
    for (const metric of ["accuracy", "precision", "recall", "f1", "prAuc"]) {
      assert.ok(Number.isFinite(model[metric]), `${model.name} ${metric} is finite`);
      assert.ok(model[metric] >= 0 && model[metric] <= 100);
    }
    const {tp, fp, fn, tn} = model.confusionMatrix;
    assert.equal(tp + fp + fn + tn, card.evaluation.examples);
  }
});

test("modern-style WhatsApp and fee probes show both catches and a known miss", () => {
  const examples = JSON.parse(fs.readFileSync(path.join(__dirname, "modern-scam-examples.json"), "utf8"));
  assert.equal(examples.length, 3);
  const results = examples.map(example => classify(example.text));
  assert.equal(results[0].predictedLabel, "Fake-risk signals detected");
  assert.equal(results[1].predictedLabel, "Fake-risk signals detected");
  assert.equal(results[2].predictedLabel, "Below the model's fake-post threshold");
});

test("JavaScript TF-IDF and estimator output matches Python on parity samples", () => {
  const parityPath = path.join(__dirname, "model-parity.json");
  const cases = JSON.parse(fs.readFileSync(parityPath, "utf8"));
  assert.ok(cases.length >= 5);
  for (const example of cases) {
    assert.ok(Math.abs(scoreForText(example.text) - example.fakeScore) < 1e-6, example.text);
  }
});

test("all 40 hand-written listings remain qualitative checks, outside metric evaluation", () => {
  const samples = JSON.parse(fs.readFileSync(path.join(__dirname, "qualitative-listings.json"), "utf8"));
  assert.equal(samples.length, 40);
  assert.equal(samples.filter(sample => sample.fraudulent === 1).length, 20);
  for (const sample of samples) {
    const result = classify(sample.text);
    assert.ok(Number.isInteger(result.risk) && result.risk >= 0 && result.risk <= 100);
    assert.ok(Array.isArray(result.explanations));
  }
});
