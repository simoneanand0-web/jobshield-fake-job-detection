# JobShield - Fake Job Post Detection

JobShield is a student project demo for screening suspicious job listings. It has Clerk sign-in/sign-up, a Vercel analysis API, explainable warning signals, model comparisons, URL text import, per-user browser history, report downloads, and local feedback controls.

## Features

- **Explainable results:** highlights matched warning phrases and gives a suggested verification step. It can also point out some ordinary job details, such as benefits or a company careers page.
- **Classifier comparison:** compares Naive Bayes, Logistic Regression, Linear SVM, and a soft-voting ensemble. Accuracy, precision, recall, F1, and confusion-matrix counts are calculated with five-fold cross-validation on the bundled corpus.
- **Listing URL import:** signed-in users can ask the server to read a public HTTPS listing page and extract visible text. Some sites block automated requests or render listings in the browser; when import fails, paste the job description manually. Import is bounded by a timeout and response-size limit and rejects private network destinations.
- **Recent checks:** the browser saves up to 25 summaries under the signed-in Clerk user ID. It does not save the full job description; URLs are stored without query parameters.
- **Downloadable report:** saves a plain-text summary with the assessment, matched signals, and demo model metrics. It does not include the full listing text.
- **Feedback:** helpful/not-helpful choices and an optional reason are saved only in the current browser. Feedback is not sent to a server or used to retrain the classifier.

## Account registration and sign-in

The website uses Clerk to create and manage user accounts. Sign-up and sign-in are available in the same authentication panel. The analysis and URL-import APIs verify the Clerk session token on the server.

### Connect Clerk to the live Vercel project

1. Create a Clerk application at [clerk.com](https://clerk.com/) and enable email sign-up/sign-in.
2. For this demo's `*.vercel.app` address, use the Clerk **Development** instance and copy its **Publishable key** (`pk_test_...`) and **Secret key** (`sk_test_...`). Clerk development keys are intended for testing; production keys require a domain you own.
3. In Vercel, open the `jobshield-fake-job-detection` project, then go to **Settings -> Environment Variables**.
4. Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` with the publishable key, and `CLERK_SECRET_KEY` with the secret key. Select **Production** (and Preview too, if you use preview deployments). Never put the secret key in frontend code or GitHub.
5. Redeploy the latest version so the serverless functions receive both variables.
6. Open the production URL and select **Sign up** below the sign-in form.

For local development, copy `.env.example` to `.env.local`, fill in Clerk development keys, and run `vercel dev`. Do not commit `.env.local` or share the secret key.

## Run locally

1. Install Node.js and the Vercel CLI (`npm i -g vercel`).
2. Run `npm install` and `vercel dev` in this folder.
3. Open the local URL printed by Vercel. The Clerk instance must allow the local origin (`http://localhost:3000` or `http://localhost:5173`).

Opening `index.html` directly will not run the APIs. The deployed site also needs both Clerk environment variables before registration, analysis, and URL import can work.

## Demo model limitations

`api/analyze.js` compares four JavaScript classifiers using five-fold cross-validation on 40 illustrative examples: 20 legitimate-style and 20 scam-style. Metrics are useful for demonstrating evaluation terms and code flow, but this corpus is too small and synthetic to support claims about real-world detection performance. A low risk score does not prove a listing is safe. Always verify the employer through independently located official channels.

`train_models.py` is a separate offline experiment that trains TF-IDF models on a labeled CSV and compares Multinomial Naive Bayes, Logistic Regression, Linear SVM, Random Forest, and a soft-voting ensemble. It expects columns named `text` and `fraudulent`; inspect the dataset's label coding first.

```powershell
python -m pip install -r requirements.txt
python train_models.py --data job_posts.csv --output model_artifacts
```

The offline training artifact is not wired into the Vercel endpoint. Use a permitted, representative labeled dataset and a properly hosted model before claiming production performance.

## Project abstract

Online employment scams can exploit job seekers through misleading offers, requests for advance payments, identity theft, and fraudulent money-transfer schemes. JobShield demonstrates a machine-learning screening workflow for job descriptions. The website accepts pasted or imported listing text, compares several classifiers, and explains matched warning patterns to help users decide what to verify. Its evaluation data is small and illustrative; results are decision-support estimates and must be checked against the employer's official channels.

## Files

- `index.html`, `style.css`, `app.js` - responsive frontend, Clerk account flow, explanations, comparison display, browser history, reports, and local feedback.
- `api/auth-config.js` - provides only the public Clerk key to the browser.
- `api/analyze.js` - verifies the signed-in user, classifies the listing, and calculates cross-validation comparisons.
- `api/extract.js` - verifies the signed-in user and imports visible text from eligible public HTTPS pages.
- `train_models.py` - separate local classifier comparison and artifact export.
- `vercel.json` - Vercel configuration.
