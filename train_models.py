"""Compare baseline text classifiers on a labeled job-post CSV.

Expected columns: text (job description) and fraudulent (binary 0/1).
Example: python train_models.py --data job_posts.csv --output model_artifacts
"""
import argparse
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, help="CSV with text and fraudulent columns")
    parser.add_argument("--output", default="model_artifacts")
    args = parser.parse_args()
    data = pd.read_csv(args.data)
    if not {"text", "fraudulent"}.issubset(data.columns):
        raise SystemExit("CSV needs columns named 'text' and 'fraudulent'.")
    data = data[["text", "fraudulent"]].dropna()
    data["text"] = data["text"].astype(str)
    y = data["fraudulent"].astype(int)
    if set(y.unique()) != {0, 1}:
        raise SystemExit("Encode fraudulent labels as 0 (legitimate) and 1 (fraudulent).")
    if y.value_counts().min() < 2:
        raise SystemExit("Need at least two rows in each class for a stratified split.")
    x_train, x_test, y_train, y_test = train_test_split(
        data["text"], y, test_size=0.2, random_state=42, stratify=y
    )
    def pipeline(clf):
        return Pipeline([("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=100_000)), ("clf", clf)])

    models = {
        "Multinomial Naive Bayes": pipeline(MultinomialNB()),
        "Logistic Regression": pipeline(LogisticRegression(max_iter=1000, class_weight="balanced")),
        "Linear SVM": pipeline(LinearSVC(class_weight="balanced")),
        "Random Forest": pipeline(RandomForestClassifier(n_estimators=300, class_weight="balanced", random_state=42, n_jobs=-1)),
    }
    models["Soft Voting Ensemble"] = VotingClassifier(
        estimators=[("nb", models["Multinomial Naive Bayes"]), ("lr", models["Logistic Regression"]),
                    ("rf", models["Random Forest"])], voting="soft", weights=[1, 2, 1]
    )
    rows, fitted = [], {}
    for name, model in models.items():
        model.fit(x_train, y_train)
        pred = model.predict(x_test)
        try:
            probability = model.predict_proba(x_test)[:, 1]
            auc = roc_auc_score(y_test, probability)
        except (AttributeError, ValueError):
            auc = None
        rows.append({"model": name, "accuracy": accuracy_score(y_test, pred),
                     "precision": precision_score(y_test, pred, zero_division=0),
                     "recall": recall_score(y_test, pred, zero_division=0),
                     "f1": f1_score(y_test, pred, zero_division=0), "roc_auc": auc})
        fitted[name] = model
    rows.sort(key=lambda r: r["f1"], reverse=True)
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump(fitted[rows[0]["model"]], out / "best_model.joblib")
    (out / "comparison.json").write_text(json.dumps({"test_size": len(y_test), "class_counts": y.value_counts().to_dict(), "results": rows}, indent=2), encoding="utf-8")
    print(pd.DataFrame(rows).to_string(index=False, float_format=lambda x: f"{x:.3f}"))
    print(f"\nBest by F1: {rows[0]['model']} (saved to {out / 'best_model.joblib'})")
    print("Holdout metrics are dataset-specific; report the split, class counts, and dataset source with results.")


if __name__ == "__main__":
    main()
