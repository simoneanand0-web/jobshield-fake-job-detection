# JobShield — Fake Job Post Detection

An end-to-end student major project demo for screening suspicious job listings with machine learning. It includes a responsive web app, a Vercel serverless prediction endpoint, and an offline Python script to compare conventional classifiers on a labeled dataset.

## Run the demo

1. Install Node.js and the Vercel CLI (`npm i -g vercel`).
2. In this folder, run `vercel dev`.
3. Open the local URL printed by Vercel.
4. Sign in with **demo@jobshield.io** / **Demo123!** and select **Try a sample**.

The demo login is client-side and is not authentication for a real account. The hosted endpoint needs no external service credentials.

## Deploy to GitHub and Vercel

1. Create a GitHub repository and push the contents of this folder to its root.
2. In Vercel, import that repository. Keep the project root at `.` and deploy; `vercel.json` routes `/api/analyze` to the included Node function.
3. Share the resulting Vercel URL. Demo credentials are the same as above.

No build command or environment variables are required. Vercel detects the Node.js endpoint under `api/` automatically. Use `vercel dev` for local testing because it serves the API function too; opening `index.html` directly will not run `/api/analyze`.

## What the demo model does

`api/analyze.js` trains a compact multinomial Naive Bayes text classifier at cold start from 40 small, illustrative examples (20 legitimate-style, 20 scam-style). It tokenizes listing text, scores it with Laplace-smoothed word likelihoods, and returns a risk score, verdict, and transparent red-flag patterns. The examples are teaching/demo material, not a representative benchmark. A low score does **not** prove a listing is safe.

The URL field is saved as context for a presentation but the browser does not crawl arbitrary job boards. Paste the job description into the text box. Sites generally block third-party page reads, and scraping can violate their terms; a production crawler would need a permitted source, secure server-side extraction, and review.

The sign-in is a demo gate stored in the current browser session. Do not use it to protect real data. For a real deployment, replace it with a managed identity provider, remove personal data from logs, train and version a model with a properly licensed dataset, calibrate scores on held-out data, and add monitoring and abuse controls.

## Research / classifier comparison

`train_models.py` trains TF-IDF text models on a labeled CSV and compares Multinomial Naive Bayes, Logistic Regression, Linear SVM, Random Forest, and soft-voting ensemble using a stratified holdout. It prints accuracy, precision, recall, F1, and ROC-AUC (where supported), then saves the best F1 model and metrics. It expects columns named `text` and `fraudulent`; use a dataset you are allowed to use, and inspect its label coding first.

```powershell
python -m pip install -r requirements.txt
python train_models.py --data job_posts.csv --output model_artifacts
```

This offline training artifact is for experimentation and report writing; it is not automatically wired into the Vercel demo endpoint. The Vercel app intentionally stays dependency-free and uses its tiny illustrative corpus. Replace the endpoint classifier with a properly hosted model before claiming production performance.

## Project abstract

Online employment scams can exploit job seekers through misleading offers, requests for advance payments, identity theft, and fraudulent money-transfer schemes. JobShield demonstrates a machine-learning-based screening workflow for job descriptions. The web application accepts listing text, applies a multinomial Naive Bayes text classifier, and surfaces matching warning patterns to help users decide what to verify. An offline experiment compares single classifiers and a soft-voting ensemble using standard classification metrics. The system is decision support: its demonstration corpus is small and illustrative, and every result should be checked against the employer's official channels.

## Suggested presentation outline

1. Problem and motivation: online job fraud and risks to applicants.
2. Objective: prioritize suspicious listings for human review.
3. Method: text cleaning, TF-IDF features, supervised classifiers, stratified holdout.
4. Demo: sign in, analyze the sample scam, then analyze a conventional listing.
5. Evaluation: report precision, recall, F1, ROC-AUC, confusion matrix, and class balance from your chosen dataset. Do not use demo scores as scientific results.
6. Limitations and future work: representative labeled data, temporal drift, multilingual text, calibration, source verification, and privacy.

## Files

- `index.html`, `style.css`, `app.js` — responsive frontend and demo sign-in.
- `api/analyze.js` — Vercel-compatible Naive Bayes prediction function.
- `train_models.py` — local model comparison and artifact export.
- `vercel.json` — serverless function configuration.
