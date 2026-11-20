# JobShield - Fake Job Post Detection

JobShield is a student project demo for screening suspicious job listings. It includes a responsive website, real account registration through Clerk, a Vercel serverless prediction endpoint, and a local Python experiment for comparing classifiers.

## Account registration and sign-in

The website uses Clerk to create and manage user accounts. Sign-up and sign-in are available in the same authentication panel. The analysis API verifies a Clerk session token on the server before returning a result.

### Connect Clerk to the live Vercel project

1. Create a Clerk application at [clerk.com](https://clerk.com/) and enable email sign-up/sign-in. Keep account creation enabled.
2. For this demo's `*.vercel.app` address, use the Clerk **Development** instance and copy its **Publishable key** (`pk_test_...`) and **Secret key** (`sk_test_...`). Clerk development keys work with hosting-provider preview domains; development accounts are capped at 100 users and include a development banner.
3. In Vercel, open the `jobshield-fake-job-detection` project, then go to **Settings -> Environment Variables**.
4. Add `CLERK_PUBLISHABLE_KEY` with the Publishable key, and `CLERK_SECRET_KEY` with the Secret key. Select **Production** (and Preview too, if you plan to use preview deployments). Never put the Secret key in frontend code or GitHub.
5. Redeploy the latest version so the serverless functions receive both variables.
6. Open the production URL and select the sign-up link below the sign-in form. New users can register with their email and verify it using Clerk's configured flow.

You can also use Clerk's Vercel Marketplace integration to provision the same keys. The app accepts `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` as an alternative to `CLERK_PUBLISHABLE_KEY`; the secret must remain `CLERK_SECRET_KEY`. For a production identity service on Clerk, you must use a domain you own and Clerk Production keys; Clerk does not support production keys on `*.vercel.app` domains.

For local development, copy `.env.example` to `.env.local`, fill in your Clerk development keys, and run `vercel dev`. Do not commit `.env.local` or share the Secret key in chat.

## Run locally

1. Install Node.js and the Vercel CLI (`npm i -g vercel`).
2. Run `npm install` and `vercel dev` in this folder.
3. Open the local URL printed by Vercel. The Clerk instance must allow the local origin (`http://localhost:3000` or `http://localhost:5173`).

Opening `index.html` directly will not run the API. The deployed site also needs both Clerk environment variables before registration and analysis can work.

## Deploy

Push the project files to GitHub, import the repository into Vercel (or update the existing project), set the Clerk environment variables, and redeploy. Vercel detects the Node function under `api/` automatically.

## What the demo model does

`api/analyze.js` trains a compact multinomial Naive Bayes text classifier at cold start from 40 illustrative examples (20 legitimate-style and 20 scam-style). It tokenizes listing text, scores it with Laplace-smoothed word likelihoods, and returns a risk score, verdict, and matching warning patterns. These examples are teaching/demo material, not a representative benchmark. A low score does not prove a listing is safe.

The URL field is saved as context for a presentation but the browser does not crawl arbitrary job boards. Paste the job description into the text box. Job sites commonly block third-party page reads; a production crawler needs a permitted source, secure extraction, and review.

## Research / classifier comparison

`train_models.py` trains TF-IDF text models on a labeled CSV and compares Multinomial Naive Bayes, Logistic Regression, Linear SVM, Random Forest, and a soft-voting ensemble using a stratified holdout. It prints accuracy, precision, recall, F1, and ROC-AUC (where supported), then saves the best F1 model and metrics. It expects columns named `text` and `fraudulent`; use a dataset you are allowed to use and inspect its label coding first.

```powershell
python -m pip install -r requirements.txt
python train_models.py --data job_posts.csv --output model_artifacts
```

This offline training artifact is for experimentation and report writing; it is not wired into the Vercel demo endpoint. The hosted app uses its tiny illustrative corpus. Replace the endpoint classifier with a properly hosted model before claiming production performance.

## Project abstract

Online employment scams can exploit job seekers through misleading offers, requests for advance payments, identity theft, and fraudulent money-transfer schemes. JobShield demonstrates a machine-learning-based screening workflow for job descriptions. The web application accepts listing text, applies a multinomial Naive Bayes text classifier, and surfaces matching warning patterns to help users decide what to verify. An offline experiment compares single classifiers and a soft-voting ensemble using standard classification metrics. The system is decision support: its demonstration corpus is small and illustrative, and every result should be checked against the employer's official channels.

## Suggested presentation outline

1. Problem and motivation: online job fraud and risks to applicants.
2. Objective: prioritize suspicious listings for human review.
3. Method: text cleaning, TF-IDF features, supervised classifiers, stratified holdout.
4. Demo: register or sign in, analyze the sample scam, then analyze a conventional listing.
5. Evaluation: report precision, recall, F1, ROC-AUC, confusion matrix, and class balance from your chosen dataset. Do not use demo scores as scientific results.
6. Limitations and future work: representative labeled data, temporal drift, multilingual text, calibration, source verification, and privacy.

## Files

- `index.html`, `style.css`, `app.js` - responsive frontend with Clerk account registration.
- `api/auth-config.js` - provides only the public Clerk key to the browser.
- `api/analyze.js` - verifies the signed-in user's Clerk session, then runs the demo Naive Bayes prediction.
- `train_models.py` - local classifier comparison and artifact export.
- `vercel.json` - Vercel configuration.
