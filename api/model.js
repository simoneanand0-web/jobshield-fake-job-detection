"use strict";

const weights = require("./model_weights.json");
const MODEL_VERSION = weights.version;
const MODEL_UPDATED_AT = weights.updatedAt;
const MAX_LISTING_CHARS = 12000;
const stopWords = new Set(weights.tfidf.stopWords);

const scamRules = [
  {pattern:/(?:upfront|registration|training|application|starter|processing)\s+fee|pay.{0,24}fee|deposit.{0,24}(?:fee|money)/i, label:"Requests an upfront payment", advice:"Do not pay to apply. Check the employer's official careers page and contact details."},
  {pattern:/bank\s+(?:account|login|details)|banking information|social security|passport|identity documents/i, label:"Requests sensitive financial or identity details", advice:"Do not share banking credentials or identity documents before verifying the employer and the hiring stage."},
  {pattern:/(?:no experience|no skills|no qualifications)[^\.\n]{0,65}(?:\$\s?\d[\d,]*(?:\s?(?:per|\/|a)?\s?(?:hour|week))?|high|huge|guaranteed|easy|income|weekly|hour)|(?:\$\s?\d[\d,]*|\d[\d,]*\s?(?:dollars|usd))\s?(?:per|\/|a)?\s?(?:hour|week).{0,70}(?:no experience|no skills|no qualifications|easy work|few hours|no interview)/i, label:"Pairs unusually high pay with few requirements", advice:"Compare the pay and duties with the employer's official posting. High pay by itself is not proof of fraud."},
  {pattern:/(?:whats\s?app|telegram|signal).{0,35}(?:only|contact|apply|interview|message)|(?:only|contact|apply|interview|message).{0,35}(?:whats\s?app|telegram|signal)/i, label:"Pushes applicants to messaging-app-only or messaging-led contact", advice:"Verify the role and recruiter through contact details on the company's official website. A messaging app alone does not prove a scam."},
  {pattern:/[A-Z0-9._%+-]+@(?:gmail|yahoo|outlook|hotmail|protonmail)\.[A-Z]{2,}/i, label:"Uses a personal email service for hiring contact", advice:"Check whether the address matches the employer's official domain. Small businesses may use personal email, so verify independently."},
  {pattern:/cashier check|gift cards|crypto|cryptocurrency|reship|forward parcels|money transfer/i, label:"Mentions a payment or reshipping scam pattern", advice:"Never deposit a check, buy gift cards, move money, or forward parcels for a recruiter."},
  {pattern:/without interview|no interview|hire instantly|instant hiring|guaranteed job/i, label:"Claims hiring without a normal interview process", advice:"Verify the hiring process using contact details from the company's official website."}
];

const positiveRules = [
  {pattern:/health insurance|medical benefits|retirement plan|401\s?k|paid leave|paid vacation/i, label:"Lists standard employment benefits"},
  {pattern:/salary range|\$\s?\d[\d,]*\s?(?:-|to)\s?\$?\s?\d|equal opportunity employer/i, label:"Includes specific compensation or equal-opportunity details"},
  {pattern:/apply through (?:the )?(?:company|official) careers page|company careers page|official careers page/i, label:"Directs applicants to an official careers page"}
];

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function sparseTfidf(text) {
  const tokens = (String(text).toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) || [])
    .filter(token => !stopWords.has(token));
  const terms = new Map();
  for (let i = 0; i < tokens.length; i++) {
    terms.set(tokens[i], (terms.get(tokens[i]) || 0) + 1);
    if (i + 1 < tokens.length) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      terms.set(bigram, (terms.get(bigram) || 0) + 1);
    }
  }

  const entries = [];
  let normSquared = 0;
  for (const [term, frequency] of terms) {
    const index = weights.tfidf.vocab[term];
    if (index === undefined) continue;
    const value = frequency * weights.tfidf.idf[index];
    entries.push([index, value]);
    normSquared += value * value;
  }
  const norm = Math.sqrt(normSquared) || 1;
  return {entries:entries.map(([index, value]) => [index, value / norm]), tokenCount:tokens.length};
}

function linearScore(vector, estimator) {
  let score = estimator.intercept;
  for (const [index, value] of vector.entries) score += value * estimator.coef[index];
  return score;
}

function estimatorProbabilities(vector) {
  const models = weights.estimators;
  const naiveBayes = sigmoid(linearScore(vector, models.naiveBayes));
  const logistic = sigmoid(linearScore(vector, models.logistic));
  const svmMargin = linearScore(vector, models.linearSvm);
  const {a, b} = models.linearSvm.calibration;
  const calibratedSvm = sigmoid(-(a * svmMargin + b));
  return {
    "Multinomial Naive Bayes":naiveBayes,
    "Logistic Regression":logistic,
    "Calibrated Linear SVM":calibratedSvm,
    "Soft Voting Ensemble":(naiveBayes + logistic + calibratedSvm) / 3
  };
}

function evidenceFrom(text, rules) {
  return rules.flatMap(rule => {
    const match = text.match(rule.pattern);
    return match ? [{label:rule.label, evidence:match[0].trim().slice(0, 140), ...(rule.advice ? {advice:rule.advice} : {})}] : [];
  });
}

function classify(text) {
  const vector = sparseTfidf(text);
  const scores = estimatorProbabilities(vector);
  const fakeScore = scores[weights.selectedModel];
  const risk = Math.max(0, Math.min(100, Math.round(fakeScore * 100)));
  const predictedFake = fakeScore >= weights.decisionThreshold;
  const riskLevel = risk >= 65 ? "High" : risk >= 40 ? "Medium" : "Low";
  const scamEvidence = evidenceFrom(text, scamRules);
  const positiveSignals = evidenceFrom(text, positiveRules);
  return {
    risk,
    riskLevel,
    verdict:predictedFake ? "Likely suspicious" : riskLevel === "Medium" ? "Needs careful review" : "Fewer scam signals detected",
    scoreLabel:"Sigmoid-calibrated model score, not a verified real-world probability",
    predictedLabel:predictedFake ? "Fake-risk signals detected" : "Below the model's fake-post threshold",
    threshold:weights.decisionThreshold,
    redFlags:scamEvidence.map(item => item.label),
    explanations:scamEvidence,
    positiveSignals,
    signals:vector.tokenCount,
    model:weights.selectedModel,
    modelVersion:MODEL_VERSION,
    trainingExamples:weights.dataset.rowsAfterCleaning,
    comparison:weights.models,
    evaluation:weights.evaluation
  };
}

function scoreForText(text) {
  const vector = sparseTfidf(text);
  return estimatorProbabilities(vector)[weights.selectedModel];
}

function validateListingText(value) {
  if (typeof value !== "string" || !value.trim()) {
    return {error:"Paste a job description before analyzing.", status:400};
  }
  if (value.length > MAX_LISTING_CHARS) {
    return {error:"This listing is too long. The maximum is 12,000 characters.", status:413};
  }
  const text = value.trim();
  if (text.length < 35) {
    return {error:"Paste at least 35 characters from the job listing so there is enough text to review.", status:400};
  }
  return {text};
}

function getModelInfo() {
  return {
    version:MODEL_VERSION,
    updatedAt:MODEL_UPDATED_AT,
    selectedModel:weights.selectedModel,
    modelSelection:weights.modelSelection,
    thresholdTuning:weights.thresholdTuning,
    crossValidation:weights.crossValidation,
    modernQualitativeChecks:weights.modernQualitativeChecks,
    dataset:weights.dataset,
    models:weights.models,
    evaluation:weights.evaluation,
    candidateModels:weights.models.map(model => model.name),
    limitations:[
      "EMSCAD contains English-language job ads published in 2012–2014; newer scam styles, regions, and labor markets may differ.",
      "This is a text-only model trained on title, company profile, description, requirements, and benefits; it does not verify employers, domains, or live job pages.",
      "The held-out test split and five-fold cross-validation use historical EMSCAD data; neither is an independent benchmark of current job listings.",
      "Three hand-written modern-style probes are qualitative examples, not a representative or labeled modern-scam benchmark.",
      "The selected SVM uses sigmoid calibration, but the score has not been validated as a real-world probability on current listings. A high or low score is not proof that a listing is fake or legitimate.",
      "Phrase matches may lack context. Messaging apps, personal email, and high pay alone do not prove fraud."
    ]
  };
}

module.exports = {classify, scoreForText, validateListingText, getModelInfo, MODEL_VERSION, MODEL_UPDATED_AT, MAX_LISTING_CHARS};
