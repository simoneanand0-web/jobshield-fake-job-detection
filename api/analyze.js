// A compact multinomial Naive Bayes text classifier. The example corpus is
// intentionally bundled so the demo runs on Vercel without model downloads.
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
const tokenize = s => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length > 1);
const stop = new Set("the and for with from your this that are our you will have into through their about work job role team".split(" "));
const docs = samples.map(([label, text]) => ({label, words:tokenize(text).filter(w=>!stop.has(w))}));
const vocab = new Set(docs.flatMap(d=>d.words));
const counts = [new Map(),new Map()], totals=[0,0], prior=[0,0];
for (const d of docs) { prior[d.label]++; for (const w of d.words) { counts[d.label].set(w,(counts[d.label].get(w)||0)+1); totals[d.label]++; } }
function classify(text) {
  const words=tokenize(text).filter(w=>!stop.has(w));
  const scores=prior.map((n,c)=>Math.log(n/docs.length)+words.reduce((sum,w)=>sum+Math.log(((counts[c].get(w)||0)+1)/(totals[c]+vocab.size)),0));
  const max=Math.max(...scores), p=scores.map(s=>Math.exp(s-max));
  const risk=Math.round(p[0]/(p[0]+p[1])*100);
  const redFlags=[
    [/(upfront|registration|training|application|starter|processing) fee|pay .* fee|deposit .* (fee|money)/i,"Requests an upfront payment"],
    [/(bank (account|login|details)|banking information|social security|passport|identity documents)/i,"Requests sensitive financial or identity details"],
    [/(no experience|no skills|no qualifications).{0,45}(high|huge|guaranteed|easy|\$|income|weekly|hour)/i,"Promises unusually high pay with few requirements"],
    [/(cashier check|gift cards|crypto|cryptocurrency|reship|forward parcels|money transfer)/i,"Mentions a common payment or reshipping scam pattern"],
    [/(without interview|no interview|hire instantly|instant hiring|guaranteed job)/i,"Claims hiring without a normal interview process"]
  ].filter(([re])=>re.test(text)).map(([,label])=>label);
  return {risk, verdict:risk>=65?"Likely suspicious":risk>=40?"Needs careful review":"Lower risk signals", confidence:Math.round(Math.max(risk,100-risk)), redFlags, signals:words.length, model:"Multinomial Naive Bayes", trainingExamples:docs.length};
}
module.exports = (req,res) => {
  if (req.method !== "POST") return res.status(405).json({error:"Use POST"});
  const text=String((req.body||{}).text||"").slice(0,12000).trim();
  if (text.length < 35) return res.status(400).json({error:"Paste at least a few sentences from the job listing (35 characters minimum)."});
  return res.status(200).json(classify(text));
};
