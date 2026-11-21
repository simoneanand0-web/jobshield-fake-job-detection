# JobShield

**An ML-powered web app that screens job listings for scam signals and shows the phrases that triggered them.**

[![Live demo](https://img.shields.io/badge/demo-live-6b5ce7?logo=vercel&logoColor=white)](https://jobshield-fake-job-detection.vercel.app/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.9-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Hosted on Vercel](https://img.shields.io/badge/hosted%20on-Vercel-black?logo=vercel)](https://vercel.com/)
[![License](https://img.shields.io/badge/license-not%20specified-lightgrey)](#version-license-and-contact)

**Live demo:** [jobshield-fake-job-detection.vercel.app](https://jobshield-fake-job-detection.vercel.app/) · **Source:** [GitHub repository](https://github.com/simoneanand0-web/jobshield-fake-job-detection)

![JobShield sample analysis result](docs/screenshots/sample-result-preview.svg)

*Sample result preview produced from the bundled model and the example listing below. It is a visual preview, not a recorded browser session. The score and matched phrases are the classifier's output for that example.*

## Problem and solution

Job seekers can encounter listings that ask for advance payments, sensitive identity or banking details, or unusual money and package transfers. JobShield screens pasted listing text for patterns like these, highlights the matching phrases, and gives the user practical verification steps. It is decision support: a score cannot prove that a listing is genuine or fraudulent.

## Features

- Risk score and Low, Medium, or High risk label, with a separate model-agreement value clearly marked as uncalibrated.
- Highlighted evidence for upfront fees, messaging-app-led contact, personal email providers, unusually high pay with few requirements, and other common warning patterns.
- Positive details and short next steps to help users verify an employer independently.
- Comparison of Naive Bayes, Logistic Regression, Linear SVM, and their ensemble, including precision, recall, F1, accuracy, and confusion-matrix counts.
- Clerk sign-in and account registration.
- Paste listing text or import text from an eligible public HTTPS listing page.
- Recent check summaries and feedback saved in the current browser. Listing text is not saved to browser history.
- CSV-based Python experiment for comparing additional classifiers on a dataset you provide.

## How it works

~~~mermaid
flowchart LR
  U[Browser form] -->|Clerk session + listing text| A[Vercel API]
  A --> V[Input validation]
  V --> P[Token cleanup]
  P --> M[Naive Bayes + Logistic Regression + Linear SVM]
  M --> R[Risk score + ensemble agreement]
  V --> X[Scam-pattern evidence rules]
  X --> R
  R --> O[Risk label, highlighted phrases, advice]
  O --> U
  U --> H[Browser-only summary history]
~~~

The live endpoint validates that a listing contains at least 35 characters and no more than 12,000. Its JavaScript model lowercases text, tokenizes letters and digits, drops one-character tokens and a small stop-word list, then combines three lightweight classifiers. Separate evidence rules locate exact phrases for explanation; those rules annotate the result and do not turn model scores into calibrated probabilities. The listing is sent to the API for analysis but is not added to browser history.

The optional Python script is a separate experiment. It uses scikit-learn pipelines with TF-IDF features, Naive Bayes, Logistic Regression, Linear SVM, Random Forest, and a soft-voting ensemble. The Python artifacts are not loaded by the live Vercel endpoint.

## Model performance

### Evaluation data

The live demo currently uses **40 hand-written illustrative examples** in api/model.js: 20 legitimate-style and 20 fake-style listings. It is a balanced teaching corpus, not EMSCAD and not an external benchmark dataset. The model card and analysis response calculate deterministic, class-balanced five-fold cross-validation results over these examples.

### Cross-validation results

| Classifier | Accuracy | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: |
| Naive Bayes | 93% | 87% | 100% | 93% |
| Logistic Regression | 95% | 100% | 90% | 95% |
| Linear SVM | 95% | 100% | 90% | 95% |
| Ensemble | 95% | 95% | 95% | 95% |

These values are measurements of the small bundled corpus only. They are **not validated real-world accuracy estimates** and should not be used to claim that the app reliably detects current job scams.

### Ensemble confusion matrix

Positive class: fake listing. Rows are actual labels; columns are predictions.

![Ensemble confusion matrix from five-fold cross-validation on the 40 illustrative examples](docs/figures/ensemble-confusion-matrix.svg)

| Actual class | Predicted fake | Predicted legitimate |
| --- | ---: | ---: |
| Fake | TP: 19 | FN: 1 |
| Legitimate | FP: 1 | TN: 19 |

The demo corpus is balanced, so the live model does not use class weighting or resampling. The optional Python benchmark stratifies its train/test split and uses balanced class weights for Logistic Regression, Linear SVM, and Random Forest. For a serious deployment, evaluate on a larger, current, independently sourced dataset with its real class distribution; report per-class metrics and tune the decision threshold with validation data.

### Limitations

- The live model does not train on EMSCAD or another external dataset.
- The corpus has only 40 hand-written examples. Its vocabulary and examples do not represent the range or changing tactics of real listings.
- Risk scores and model-agreement values are uncalibrated screening estimates. Model agreement means the three model outputs are close to one another; it is not confidence that the verdict is correct.
- Phrase rules can miss new wording and can flag legitimate details out of context. A personal email address, high salary, or messaging app alone is not proof of fraud.
- Imported listing pages may block text extraction or require sign-in. Pasting the description is the fallback.
- Always confirm the employer, role, and recruiter through independently located official contact details.

## Tech stack

- Frontend: HTML, CSS, and browser JavaScript.
- API: Vercel Node.js Functions.
- Authentication: Clerk.
- Live classifier: lightweight JavaScript Naive Bayes, Logistic Regression, and Linear SVM ensemble.
- Optional research script: Python, pandas, scikit-learn, and joblib.
- Hosting: Vercel; source control: GitHub.

## Setup

### Requirements

- Node.js 20.9 or newer.
- A Clerk application with email sign-in enabled.
- Vercel CLI for local function development.
- Python and the packages in requirements.txt only if you want to run the optional CSV experiment.

### Run the web app locally

~~~powershell
git clone https://github.com/simoneanand0-web/jobshield-fake-job-detection.git
Set-Location jobshield-fake-job-detection
npm install
Copy-Item .env.example .env.local
~~~

Edit .env.local and replace the placeholders with the **test** keys from Clerk. Keep the secret key on the server and do not commit .env.local.

~~~dotenv
CLERK_SECRET_KEY=sk_test_replace_with_your_clerk_secret_key
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_replace_with_your_clerk_publishable_key
~~~

Then sign in to Vercel CLI, link the project if prompted, and start the local functions:

~~~powershell
npx vercel login
npx vercel link
npx vercel dev
~~~

Open the local URL printed by Vercel. To run the model and input-validation unit tests:

~~~powershell
node --test
~~~

### Run the optional Python experiment

Prepare a CSV with text and fraudulent columns. Use 0 for legitimate and 1 for fraudulent, with at least two examples in each class.

~~~powershell
python -m pip install -r requirements.txt
python train_models.py --data path\to\job_posts.csv --output model_artifacts
~~~

The script prints the holdout metrics and writes the best-by-F1 model plus its comparison JSON to model_artifacts/. Use data you are authorized to process and document its source, collection date, class counts, and split when reporting results.

## Usage and examples

1. Open the [live demo](https://jobshield-fake-job-detection.vercel.app/) and sign in or create an account.
2. Paste a job description (at least 35 characters, at most 12,000), or choose **Try a sample**.
3. Select **Analyze listing**. Review the risk level, score, model agreement, highlighted phrases, and advice.
4. Verify the employer independently before acting on the result.

**Fake-style example**

~~~text
No experience needed; earn $5,000 weekly. Contact us only on WhatsApp, email recruiter@gmail.com and pay a registration fee to secure your position.
~~~

With model version 2.1.0, this exact example returns **High risk**, a **96/100 demo risk score**, and **88% model agreement (uncalibrated)**. It highlights the payment request, high pay paired with few requirements, WhatsApp-led contact, and personal email address.

**Legitimate-style example**

~~~text
Data analyst position. Use SQL and Python to build dashboards for the product team. Salary range is $70,000 to $90,000. Health insurance, paid leave, equal opportunity employer. Apply through the official company careers page.
~~~

With the same model version, this example returns **Low risk**, a **6/100 demo risk score**, and **84% model agreement (uncalibrated)**, with positive details about benefits, compensation, and the official careers page. Low risk does not mean verified or guaranteed safe.

## Roadmap

- Evaluate on a larger, licensed, current dataset with an imbalanced class distribution.
- Add a held-out benchmark, threshold tuning, per-class metrics, and a clearly documented confusion matrix for that dataset.
- Improve domain and employer verification while preserving the rule that a signal is not proof.
- Add broader test coverage and a browser-level flow test.

## Version, license, and contact

- **Live model version:** 2.1.0
- **Last model update:** 2026-11-21
- **License:** No license file is included. Ask the repository owner before reusing or redistributing the code.
- **Contact:** Open a question or bug report in [GitHub Issues](https://github.com/simoneanand0-web/jobshield-fake-job-detection/issues).
