const MODEL_VERSION = "2.1.0";
const MODEL_UPDATED_AT = "2026-11-21";
const MAX_LISTING_CHARS = 12000;
const samples = [
  [1,"Senior software engineer build scalable applications collaborate product team competitive salary health insurance apply through company careers page"],
  [1,"Registered nurse full time hospital experience required benefits paid leave submit resume to hr department"],
  [1,"Marketing coordinator plan campaigns analyze performance bachelor's degree preferred hybrid position apply online"],
  [1,"Data analyst use SQL Python dashboards and business intelligence tools salary range listed equal opportunity employer"],
  [1,"Customer service representative answer customer questions training provided hourly pay company benefits background check"],
  [1,"Project manager coordinate timelines budgets and stakeholders PMP certification preferred full time position"],
  [1,"Accountant prepare financial statements reconcile accounts CPA preferred competitive compensation and retirement plan"],
  [1,"Warehouse associate pick pack and ship orders safety training provided hourly wage overtime available"],
  [1,"UX designer conduct user research create wireframes partner with engineers portfolio required remote eligible"],
  [1,"Operations assistant organize schedules maintain records and support daily office operations paid vacation"],
  [1,"Sales representative manage business accounts meet quarterly targets base salary plus commission and health coverage"],
  [1,"Electrical technician maintain equipment follow safety procedures two years experience required paid holidays"],
  [1,"Human resources specialist support recruitment onboarding employee relations and payroll systems"],
  [1,"Content writer research and write articles follow editorial guidelines samples required salaried role"],
  [1,"Teaching assistant support classroom instruction bachelor's degree background check required school district benefits"],
  [1,"Junior developer review code write tests work with senior engineers internship experience helpful"],
  [1,"Delivery driver valid license clean driving record company vehicle provided hourly pay"],
  [1,"Medical receptionist schedule appointments verify insurance maintain patient records clinic experience preferred"],
  [1,"Business analyst gather requirements document workflows communicate with stakeholders full time position"],
  [1,"Graphic designer create brand assets collaborate with creative team submit portfolio with application"],
  [0,"Work from home earn 5000 weekly no experience needed pay registration fee today limited vacancies"],
  [0,"We will send you a check to buy equipment deposit the extra money into our vendor account immediately"],
  [0,"Guaranteed job offer without interview send your social security number and bank details to recruiter"],
  [0,"Make money fast processing payments from home keep a generous commission no background check"],
  [0,"Urgent hiring personal assistant receive packages and reship them earn huge income with no experience"],
  [0,"Pay a small training fee to secure your position guaranteed income work only two hours daily"],
  [0,"Congratulations you are selected immediately click this link and provide your passport and banking information"],
  [0,"Earn 300 dollars per hour stuffing envelopes no skills required pay for starter kit"],
  [0,"Crypto investment company hiring money transfer agents send funds through your personal account"],
  [0,"No interview needed instant hiring work from anywhere send copies of identity documents by chat"],
  [0,"Deposit this cashier check purchase gift cards and send codes to your hiring manager"],
  [0,"Secret shopper job requires upfront payment for your background check guaranteed placement"],
  [0,"Recruiter asks for your bank login to set up direct deposit before an interview"],
  [0,"Work remotely receive and forward parcels using your home address earn easy cash"],
  [0,"Pay a refundable application deposit by cryptocurrency to reserve this high paying job"],
  [0,"Limited time offer no qualifications needed send a fee to unlock the job description"],
  [0,"We hire instantly via messaging app provide your tax number and pay processing charge"],
  [0,"Earn passive income by accepting money transfers through your personal bank account"],
  [0,"Amazing salary for easy work no interview required purchase our mandatory starter package"],
  [0,"Urgent opportunity send your identity documents and account number before we reveal employer"]
];

const tokenize = value => (String(value).toLowerCase().match(/[a-z0-9]+/g) || []).filter(word => word.length > 1);
const stop = new Set("the and for with from your this that are our you will have into through their about work job role team".split(" "));
const vectorize = value => tokenize(value).filter(word => !stop.has(word));
const labeledDocs = samples.map(([label, text]) => ({label, words:vectorize(text)}));

function sigmoid(value) {
  if (value > 30) return 1;
  if (value < -30) return 0;
  return 1 / (1 + Math.exp(-value));
}

function trainNaiveBayes(training) {
  const wordCounts = [new Map(), new Map()];
  const totals = [0, 0];
  const classCounts = [0, 0];
  const vocab = new Set();
  for (const doc of training) {
    const fake = doc.label === 0 ? 1 : 0;
    classCounts[fake]++;
    for (const word of doc.words) {
      vocab.add(word);
      wordCounts[fake].set(word, (wordCounts[fake].get(word) || 0) + 1);
      totals[fake]++;
    }
  }
  const size = Math.max(vocab.size, 1);
  return words => {
    let fake = Math.log((classCounts[1] + 1) / (training.length + 2));
    let genuine = Math.log((classCounts[0] + 1) / (training.length + 2));
    for (const word of words) {
      fake += Math.log(((wordCounts[1].get(word) || 0) + 1) / (totals[1] + size));
      genuine += Math.log(((wordCounts[0].get(word) || 0) + 1) / (totals[0] + size));
    }
    return sigmoid(fake - genuine);
  };
}

function trainLinear(training, kind) {
  const vocab = [...new Set(training.flatMap(doc => doc.words))];
  const index = new Map(vocab.map((word, i) => [word, i]));
  const weights = new Float64Array(vocab.length);
  let bias = 0;
  const passes = kind === "svm" ? 36 : 100;
  const rate = kind === "svm" ? 0.025 : 0.12;
  for (let pass = 0; pass < passes; pass++) {
    for (const doc of training) {
      const indices = [...new Set(doc.words.map(word => index.get(word)).filter(value => value !== undefined))];
      const target = doc.label === 0 ? 1 : 0;
      let score = bias;
      for (const i of indices) score += weights[i];
      if (kind === "svm") {
        const y = target ? 1 : -1;
        if (y * score < 1) {
          for (let i = 0; i < weights.length; i++) weights[i] *= 1 - rate * 0.001;
          for (const i of indices) weights[i] += rate * y;
          bias += rate * y;
        }
      } else {
        const error = target - sigmoid(score);
        for (let i = 0; i < weights.length; i++) weights[i] *= 1 - rate * 0.0008;
        for (const i of indices) weights[i] += rate * error;
        bias += rate * error;
      }
    }
  }
  return words => {
    let score = bias;
    for (const word of words) {
      const i = index.get(word);
      if (i !== undefined) score += weights[i];
    }
    return kind === "svm" ? sigmoid(score * 1.25) : sigmoid(score);
  };
}

function trainEnsemble(training) {
  const models = [trainNaiveBayes(training), trainLinear(training, "logistic"), trainLinear(training, "svm")];
  return words => models.reduce((sum, model) => sum + model(words), 0) / models.length;
}

const modelTypes = [
  {key:"naiveBayes", name:"Naive Bayes"},
  {key:"logistic", name:"Logistic Regression"},
  {key:"svm", name:"Linear SVM"},
  {key:"ensemble", name:"Ensemble"}
];
const trainers = {
  naiveBayes:trainNaiveBayes,
  logistic:training => trainLinear(training, "logistic"),
  svm:training => trainLinear(training, "svm"),
  ensemble:trainEnsemble
};

function evaluateModel(key) {
  const matrix = {tp:0, fp:0, fn:0, tn:0};
  const folds = 5;
  for (let fold = 0; fold < folds; fold++) {
    const training = labeledDocs.filter((_, i) => i % folds !== fold);
    const validation = labeledDocs.filter((_, i) => i % folds === fold);
    const predict = trainers[key](training);
    for (const doc of validation) {
      const predictedFake = predict(doc.words) >= 0.5;
      const actualFake = doc.label === 0;
      if (actualFake && predictedFake) matrix.tp++;
      else if (!actualFake && predictedFake) matrix.fp++;
      else if (actualFake && !predictedFake) matrix.fn++;
      else matrix.tn++;
    }
  }
  const precision = matrix.tp / Math.max(matrix.tp + matrix.fp, 1);
  const recall = matrix.tp / Math.max(matrix.tp + matrix.fn, 1);
  return {
    accuracy:Math.round((matrix.tp + matrix.tn) / labeledDocs.length * 100),
    precision:Math.round(precision * 100),
    recall:Math.round(recall * 100),
    f1:Math.round(2 * precision * recall / Math.max(precision + recall, 0.0001) * 100),
    confusionMatrix:matrix
  };
}
const comparison = modelTypes.map(model => ({...model, ...evaluateModel(model.key)}));
const fullModels = [trainNaiveBayes(labeledDocs), trainLinear(labeledDocs, "logistic"), trainLinear(labeledDocs, "svm")];

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

function evidenceFrom(text, rules) {
  return rules.flatMap(rule => {
    const match = text.match(rule.pattern);
    return match ? [{label:rule.label, evidence:match[0].trim().slice(0, 140), ...(rule.advice ? {advice:rule.advice} : {})}] : [];
  });
}

function classify(text) {
  const words = vectorize(text);
  const probabilities = fullModels.map(model => model(words));
  const risk = Math.round(probabilities.reduce((sum, probability) => sum + probability, 0) / probabilities.length * 100);
  const modelAgreement = Math.round((1 - (Math.max(...probabilities) - Math.min(...probabilities))) * 100);
  const scamEvidence = evidenceFrom(text, scamRules);
  const positiveSignals = evidenceFrom(text, positiveRules);
  return {
    risk,
    riskLevel:risk >= 65 ? "High" : risk >= 40 ? "Medium" : "Low",
    verdict:risk >= 65 ? "Likely suspicious" : risk >= 40 ? "Needs careful review" : "Lower risk signals",
    modelAgreement,
    confidenceLabel:"Model agreement (uncalibrated)",
    redFlags:scamEvidence.map(item => item.label),
    explanations:scamEvidence,
    positiveSignals,
    signals:words.length,
    model:"Ensemble (Naive Bayes, Logistic Regression, Linear SVM)",
    trainingExamples:labeledDocs.length,
    comparison,
    evaluation:{method:"5-fold cross-validation", examples:labeledDocs.length, caveat:"Metrics come from a small illustrative demo corpus and do not predict real-world accuracy."}
  };
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
    dataset:{
      name:"JobShield illustrative demo corpus",
      total:labeledDocs.length,
      legitimateStyle:labeledDocs.filter(doc => doc.label === 1).length,
      fakeStyle:labeledDocs.filter(doc => doc.label === 0).length,
      source:"Hand-written illustrative examples bundled in api/model.js; not EMSCAD or another external dataset."
    },
    ensemble:["Multinomial Naive Bayes", "Logistic Regression", "Linear SVM"],
    evaluation:{
      method:"Deterministic, class-balanced 5-fold cross-validation",
      examples:labeledDocs.length,
      positiveClass:"Fake job post",
      note:"Each example is evaluated once. The corpus is small, synthetic, and balanced, so these scores demonstrate evaluation code only; they are not evidence of real-world performance."
    },
    models:comparison,
    limitations:[
      "The 40 examples are illustrative and balanced, unlike many real fake-job datasets.",
      "This project does not currently train on EMSCAD or another external dataset.",
      "The vocabulary, scam tactics, job markets, and languages in new listings may differ from these examples.",
      "Risk scores and model-agreement values are uncalibrated screening estimates. Verify the employer and listing independently."
    ]
  };
}

module.exports = {classify, validateListingText, getModelInfo, MODEL_VERSION, MODEL_UPDATED_AT, MAX_LISTING_CHARS};
