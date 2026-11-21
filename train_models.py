"""Train, evaluate, and export JobShield's EMSCAD text models.

Download ``fake_job_postings.csv`` from the Kaggle dataset linked in the README,
then run:

    python train_models.py --data data/fake_job_postings.csv

The raw CSV stays local and ignored by Git. This script removes duplicate text
before a stratified 80/20 split, reports fake-class metrics on the untouched
test split, and exports inference weights that api/model.js uses in production.
"""
from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.svm import LinearSVC


DATASET_NAME = "Employment Scam Aegean Dataset (EMSCAD)"
DATASET_SOURCE = "https://www.kaggle.com/datasets/shivamb/real-or-fake-fake-jobposting-prediction"
DATASET_PAPER = "https://doi.org/10.3390/fi9010006"
MODEL_VERSION = "3.0.0"
MODEL_UPDATED_AT = "2026-11-21"
TEXT_COLUMNS = ["title", "company_profile", "description", "requirements", "benefits"]
PARITY_TEXTS = [
    "No experience needed. Earn $5,000 weekly. Contact us only on WhatsApp and pay a registration fee.",
    "Senior data analyst. Build SQL dashboards with the product team. Apply through the official company careers page.",
    "We will send you a check to buy equipment. Deposit the extra amount into our vendor account immediately.",
    "Registered nurse, full time at a hospital. Three years of experience required. Health insurance and paid leave.",
    "Telegram interview only; send passport and bank details before your guaranteed remote job starts.",
    "Marketing coordinator to plan campaigns, analyze performance, and collaborate with the communications team.",
]


def clean_text(value: object) -> str:
    """Strip markup and normalize whitespace without changing word content."""
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def read_dataset(path: Path) -> tuple[pd.DataFrame, dict[str, int]]:
    frame = pd.read_csv(path)
    if "fraudulent" not in frame.columns:
        raise SystemExit("CSV needs a 'fraudulent' column with 0=legitimate and 1=fake.")

    if "text" in frame.columns:
        text = frame["text"].fillna("").map(clean_text)
    elif set(TEXT_COLUMNS).intersection(frame.columns) == set(TEXT_COLUMNS):
        text = frame[TEXT_COLUMNS].fillna("").astype(str).agg(" ".join, axis=1).map(clean_text)
    else:
        missing = ", ".join(column for column in TEXT_COLUMNS if column not in frame.columns)
        raise SystemExit(
            "CSV needs a 'text' column, or all five EMSCAD text fields: " + missing
        )

    labels = pd.to_numeric(frame["fraudulent"], errors="coerce")
    valid = labels.isin([0, 1])
    before = len(frame)
    work = pd.DataFrame({"text": text, "fraudulent": labels})
    work = work.loc[valid].copy()
    invalid_labels_removed = before - len(work)
    work["fraudulent"] = work["fraudulent"].astype(int)
    work = work.loc[work["text"].str.len() > 35].copy()
    short_text_removed = before - invalid_labels_removed - len(work)

    # Normalize case and whitespace for duplicate detection, but retain readable text.
    work["_dedup_key"] = work["text"].str.casefold().str.replace(r"\s+", " ", regex=True).str.strip()
    conflicting = work.groupby("_dedup_key")["fraudulent"].nunique()
    conflicting_keys = set(conflicting[conflicting > 1].index)
    conflicting_rows_removed = int(work["_dedup_key"].isin(conflicting_keys).sum())
    work = work.loc[~work["_dedup_key"].isin(conflicting_keys)].copy()
    before_dedup = len(work)
    work = work.drop_duplicates(subset="_dedup_key", keep="first").drop(columns="_dedup_key")
    duplicates_removed = before_dedup - len(work)

    counts = work["fraudulent"].value_counts().to_dict()
    if set(counts) != {0, 1} or min(counts.values()) < 2:
        raise SystemExit("After cleaning, each class needs at least two unique listings.")
    return work.reset_index(drop=True), {
        "sourceRows": int(before),
        "invalidLabelsRemoved": int(invalid_labels_removed),
        "shortTextsRemoved": int(short_text_removed),
        "conflictingDuplicateRowsRemoved": int(conflicting_rows_removed),
        "duplicateTextsRemoved": int(duplicates_removed),
        "rowsAfterCleaning": int(len(work)),
        "legitimate": int(counts.get(0, 0)),
        "fake": int(counts.get(1, 0)),
    }


def metric_row(name: str, y_true: pd.Series, probabilities: np.ndarray, threshold: float = 0.5) -> dict:
    predicted = (probabilities >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, predicted, labels=[0, 1]).ravel()
    return {
        "name": name,
        "accuracy": round(float(accuracy_score(y_true, predicted)) * 100, 1),
        "precision": round(float(precision_score(y_true, predicted, zero_division=0)) * 100, 1),
        "recall": round(float(recall_score(y_true, predicted, zero_division=0)) * 100, 1),
        "f1": round(float(f1_score(y_true, predicted, zero_division=0)) * 100, 1),
        "prAuc": round(float(average_precision_score(y_true, probabilities)) * 100, 1),
        "confusionMatrix": {"tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn)},
    }


def tune_threshold_for_recall(labels: pd.Series, probabilities: np.ndarray, target_recall: float) -> tuple[float, dict]:
    """Choose the highest validation cutoff that reaches the requested fake recall."""
    candidates = np.unique(np.r_[probabilities, 0.0])
    qualifying = []
    for threshold in candidates:
        row = metric_row("validation", labels, probabilities, float(threshold))
        actual_recall = recall_score(labels, (probabilities >= threshold).astype(int), zero_division=0)
        if actual_recall >= target_recall:
            qualifying.append((float(threshold), row))
    if not qualifying:
        threshold = 0.0
        return threshold, metric_row("validation", labels, probabilities, threshold)
    return max(qualifying, key=lambda item: item[0])


def as_float_list(array: np.ndarray) -> list[float]:
    return [float(value) for value in np.asarray(array).reshape(-1)]


def make_vectorizer() -> TfidfVectorizer:
    return TfidfVectorizer(
        ngram_range=(1, 2),
        min_df=3,
        max_features=20_000,
        stop_words="english",
        lowercase=True,
        token_pattern=r"(?u)\b\w\w+\b",
        norm="l2",
        use_idf=True,
        smooth_idf=True,
        sublinear_tf=False,
        dtype=np.float64,
    )


def fit_estimators(x_matrix, labels: pd.Series) -> dict:
    naive_bayes = MultinomialNB().fit(x_matrix, labels)
    logistic = LogisticRegression(class_weight="balanced", max_iter=1000, random_state=42)
    logistic.fit(x_matrix, labels)
    calibrated_svm = fit_calibrated_svm(x_matrix, labels)
    return {"naiveBayes": naive_bayes, "logistic": logistic, "calibratedSvm": calibrated_svm}


def fit_calibrated_svm(x_matrix, labels: pd.Series):
    svm_estimator = LinearSVC(class_weight="balanced", random_state=42)
    try:
        calibrated_svm = CalibratedClassifierCV(
            estimator=svm_estimator, method="sigmoid", cv=3, ensemble=False
        )
    except TypeError:  # Compatibility with older scikit-learn versions.
        calibrated_svm = CalibratedClassifierCV(
            base_estimator=svm_estimator, method="sigmoid", cv=3, ensemble=False
        )
    return calibrated_svm.fit(x_matrix, labels)


def five_fold_svm_metrics(x_text: pd.Series, labels: pd.Series) -> dict:
    """Evaluate the selected model within the training partition, at the 0.5 cutoff."""
    fold_rows = []
    splitter = StratifiedKFold(n_splits=5, shuffle=True, random_state=44)
    print("Running 5-fold CV on the training partition...", flush=True)
    for fold, (fit_indices, eval_indices) in enumerate(splitter.split(x_text, labels), start=1):
        x_fit = x_text.iloc[fit_indices]
        x_eval = x_text.iloc[eval_indices]
        y_fit = labels.iloc[fit_indices]
        y_eval = labels.iloc[eval_indices]
        vectorizer = make_vectorizer()
        fit_matrix = vectorizer.fit_transform(x_fit)
        eval_matrix = vectorizer.transform(x_eval)
        model = fit_calibrated_svm(fit_matrix, y_fit)
        probabilities = model.predict_proba(eval_matrix)[:, 1]
        row = metric_row("Calibrated Linear SVM", y_eval, probabilities)
        row.update({"fold": fold, "examples": int(len(y_eval)), "fakeExamples": int(y_eval.sum())})
        fold_rows.append(row)
        print(f"Completed CV fold {fold}/5: recall={row['recall']}%, F1={row['f1']}%", flush=True)

    metric_names = ("accuracy", "precision", "recall", "f1", "prAuc")
    summary = {
        metric: {
            "mean": round(float(np.mean([row[metric] for row in fold_rows])), 2),
            "standardDeviation": round(float(np.std([row[metric] for row in fold_rows], ddof=1)), 2),
        }
        for metric in metric_names
    }
    return {
        "method": "5-fold stratified CV within the 80% training partition; shuffle=True; random_state=44",
        "classifier": "Calibrated Linear SVM",
        "threshold": 0.5,
        "folds": fold_rows,
        "summary": summary,
    }


def estimator_probabilities(estimators: dict, x_matrix) -> dict[str, np.ndarray]:
    probabilities = {
        "Multinomial Naive Bayes": estimators["naiveBayes"].predict_proba(x_matrix)[:, 1],
        "Logistic Regression": estimators["logistic"].predict_proba(x_matrix)[:, 1],
        "Calibrated Linear SVM": estimators["calibratedSvm"].predict_proba(x_matrix)[:, 1],
    }
    probabilities["Soft Voting Ensemble"] = np.mean(np.column_stack(list(probabilities.values())), axis=1)
    return probabilities


def selection_key(row: dict) -> tuple[float, float, float, float]:
    return (row["f1"], row["prAuc"], row["recall"], row["precision"])


def raw_selection_key(labels: pd.Series, probabilities: np.ndarray) -> tuple[float, float, float, float]:
    predicted = (probabilities >= 0.5).astype(int)
    return (
        float(f1_score(labels, predicted, zero_division=0)),
        float(average_precision_score(labels, probabilities)),
        float(recall_score(labels, predicted, zero_division=0)),
        float(precision_score(labels, predicted, zero_division=0)),
    )


def write_confusion_svg(row: dict, destination: Path, test_rows: int) -> None:
    matrix = row["confusionMatrix"]
    cells = [
        ("True negative", matrix["tn"], 290, 180, "#e4f2ed"),
        ("False positive", matrix["fp"], 510, 180, "#fff1dc"),
        ("False negative", matrix["fn"], 290, 330, "#fff1dc"),
        ("True positive", matrix["tp"], 510, 330, "#e2eee7"),
    ]
    cell_markup = "".join(
        f'<rect x="{x}" y="{y}" width="170" height="112" rx="14" fill="{color}" />'
        f'<text x="{x + 85}" y="{y + 48}" text-anchor="middle" class="count">{count}</text>'
        f'<text x="{x + 85}" y="{y + 78}" text-anchor="middle" class="cell-label">{label}</text>'
        for label, count, x, y, color in cells
    )
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560" role="img" aria-labelledby="title desc">
  <title id="title">Confusion matrix for {row['name']}</title>
  <desc id="desc">Held-out test confusion matrix with {test_rows} rows. Rows are actual class and columns are predicted class.</desc>
  <style>text{{font-family:Arial,sans-serif;fill:#182b27}} .title{{font-size:25px;font-weight:700}} .sub{{font-size:14px;fill:#667a73}} .axis{{font-size:15px;font-weight:700}} .label{{font-size:13px;fill:#667a73}} .count{{font-size:31px;font-weight:700}} .cell-label{{font-size:13px;fill:#667a73}}</style>
  <rect width="900" height="560" rx="24" fill="#fff" />
  <text x="48" y="58" class="title">Held-out confusion matrix</text>
  <text x="48" y="84" class="sub">{row['name']} · fake job post is the positive class · {test_rows:,} test listings</text>
  <text x="485" y="125" text-anchor="middle" class="axis">Predicted class</text>
  <text x="375" y="155" text-anchor="middle" class="label">Legitimate</text>
  <text x="595" y="155" text-anchor="middle" class="label">Fake</text>
  <text x="96" y="275" text-anchor="middle" class="axis" transform="rotate(-90 96 275)">Actual class</text>
  <text x="210" y="240" text-anchor="middle" class="label">Legitimate</text>
  <text x="210" y="390" text-anchor="middle" class="label">Fake</text>
  {cell_markup}
  <text x="48" y="520" class="sub">Precision, recall, F1, and PR-AUC are reported for fake listings. Test split kept separate from training.</text>
</svg>'''
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(svg, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, help="Local EMSCAD CSV; not committed to Git")
    parser.add_argument("--output", default="model_artifacts", help="Folder for evaluation artifacts")
    parser.add_argument("--weights", default="api/model_weights.json", help="Deployable JavaScript weights JSON")
    parser.add_argument("--parity", default="tests/model-parity.json", help="Python expected-output fixture for JS parity tests")
    parser.add_argument("--matrix", default="docs/figures/holdout-confusion-matrix.svg", help="SVG confusion matrix for the selected model")
    args = parser.parse_args()

    data, cleaning = read_dataset(Path(args.data))
    print(f"Loaded and cleaned {len(data):,} unique listings.", flush=True)
    x_train, x_test, y_train, y_test = train_test_split(
        data["text"],
        data["fraudulent"],
        test_size=0.2,
        random_state=42,
        stratify=data["fraudulent"],
    )

    # Select a live classifier inside the training portion. The final test split
    # remains untouched by model selection and is used only for final reporting.
    x_fit, x_validation, y_fit, y_validation = train_test_split(
        x_train, y_train, test_size=0.2, random_state=43, stratify=y_train
    )
    selection_vectorizer = make_vectorizer()
    x_fit_matrix = selection_vectorizer.fit_transform(x_fit)
    x_validation_matrix = selection_vectorizer.transform(x_validation)
    selection_estimators = fit_estimators(x_fit_matrix, y_fit)
    validation_probabilities = estimator_probabilities(selection_estimators, x_validation_matrix)
    selection_rows = [
        metric_row(name, y_validation, values)
        for name, values in validation_probabilities.items()
    ]
    best_name = max(
        validation_probabilities,
        key=lambda name: raw_selection_key(y_validation, validation_probabilities[name]),
    )
    print(f"Validation selected {best_name}; evaluating held-out split.", flush=True)
    target_validation_recall = 0.85
    candidate_threshold, validation_threshold_metrics = tune_threshold_for_recall(
        y_validation, validation_probabilities[best_name], target_validation_recall
    )

    vectorizer = make_vectorizer()
    x_train_matrix = vectorizer.fit_transform(x_train)
    x_test_matrix = vectorizer.transform(x_test)
    estimators = fit_estimators(x_train_matrix, y_train)
    probabilities = estimator_probabilities(estimators, x_test_matrix)
    results = [metric_row(name, y_test, values) for name, values in probabilities.items()]
    results.sort(key=selection_key, reverse=True)
    threshold_test_metrics = {
        "default": metric_row(best_name, y_test, probabilities[best_name], 0.5),
        "recallForwardCandidate": metric_row(best_name, y_test, probabilities[best_name], candidate_threshold),
    }
    cross_validation = five_fold_svm_metrics(x_train, y_train)

    modern_examples_path = Path("tests/modern-scam-examples.json")
    modern_examples = json.loads(modern_examples_path.read_text(encoding="utf-8"))
    modern_matrix = vectorizer.transform([sample["text"] for sample in modern_examples])
    modern_scores = estimator_probabilities(estimators, modern_matrix)[best_name]
    modern_checks = []
    for sample, score in zip(modern_examples, modern_scores):
        modern_checks.append({
            "scenario": sample["scenario"],
            "modelScore": round(float(score) * 100, 1),
            "predictedFake": bool(score >= 0.5),
            "explanation": sample["explanation"],
        })

    naive_bayes = estimators["naiveBayes"]
    logistic = estimators["logistic"]
    calibrated_svm = estimators["calibratedSvm"]
    calibrator = calibrated_svm.calibrated_classifiers_[0].calibrators[0]
    svm_fitted = calibrated_svm.calibrated_classifiers_[0].estimator
    weights = {
        "formatVersion": 1,
        "version": MODEL_VERSION,
        "updatedAt": MODEL_UPDATED_AT,
        "selectedModel": best_name,
        "modelSelection": {
            "method": "Stratified validation split from training data; fake-class F1, then PR-AUC",
            "validationRows": int(len(y_validation)),
            "validationFake": int(y_validation.sum()),
            "validationResults": sorted(selection_rows, key=selection_key, reverse=True),
            "finalTestUsedForSelection": False,
        },
        "decisionThreshold": 0.5,
        "thresholdTuning": {
            "method": "Highest cutoff on the training validation split that reaches the target fake-class recall",
            "targetValidationRecall": round(target_validation_recall * 100, 1),
            "candidateThreshold": round(float(candidate_threshold), 8),
            "validationMetrics": validation_threshold_metrics,
            "testMetrics": threshold_test_metrics,
            "deployed": False,
        },
        "crossValidation": cross_validation,
        "modernQualitativeChecks": modern_checks,
        "dataset": {
            "name": DATASET_NAME,
            "source": DATASET_SOURCE,
            "paper": DATASET_PAPER,
            "license": "CC0: Public Domain (as labeled on the Kaggle dataset page)",
            **cleaning,
            "trainingRows": int(len(y_train)),
            "testRows": int(len(y_test)),
            "trainingFake": int(y_train.sum()),
            "testFake": int(y_test.sum()),
        },
        "evaluation": {
            "method": "Stratified 80/20 held-out test split; random_state=42; duplicate text removed before splitting",
            "examples": int(len(y_test)),
            "positiveClass": "Fake job post",
            "threshold": 0.5,
            "classCounts": {"legitimate": int((y_test == 0).sum()), "fake": int((y_test == 1).sum())},
            "note": "Precision, recall, F1, confusion matrices, and PR-AUC are measured on the untouched test split. Accuracy is included only as a secondary metric.",
        },
        "models": results,
        "tfidf": {
            "vocab": {str(term): int(index) for term, index in vectorizer.vocabulary_.items()},
            "idf": as_float_list(vectorizer.idf_),
            "stopWords": sorted(vectorizer.get_stop_words()),
            "ngramRange": [1, 2],
            "tokenPattern": r"(?u)\b\w\w+\b",
            "maxFeatures": 20_000,
            "minDf": 3,
            "norm": "l2",
        },
        "estimators": {
            "naiveBayes": {
                "coef": as_float_list(naive_bayes.feature_log_prob_[1] - naive_bayes.feature_log_prob_[0]),
                "intercept": float(naive_bayes.class_log_prior_[1] - naive_bayes.class_log_prior_[0]),
            },
            "logistic": {"coef": as_float_list(logistic.coef_[0]), "intercept": float(logistic.intercept_[0])},
            "linearSvm": {
                "coef": as_float_list(svm_fitted.coef_[0]),
                "intercept": float(svm_fitted.intercept_[0]),
                "calibration": {"a": float(calibrator.a_), "b": float(calibrator.b_)},
            },
        },
    }

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    Path(args.weights).parent.mkdir(parents=True, exist_ok=True)
    Path(args.parity).parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {"vectorizer": vectorizer, **estimators, "selectedModel": best_name},
        output / "models.joblib",
    )
    report = {key: value for key, value in weights.items() if key not in ("tfidf", "estimators")}
    (output / "comparison.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    Path(args.weights).write_text(json.dumps(weights, separators=(",", ":")), encoding="utf-8")
    selected_test_result = next(row for row in results if row["name"] == best_name)
    write_confusion_svg(selected_test_result, Path(args.matrix), len(y_test))

    parity_rows = []
    parity_matrix = vectorizer.transform(PARITY_TEXTS)
    expected = estimator_probabilities(estimators, parity_matrix)
    for index, text in enumerate(PARITY_TEXTS):
        parity_rows.append({"text": text, "fakeScore": float(expected[best_name][index])})
    Path(args.parity).write_text(json.dumps(parity_rows, indent=2, ensure_ascii=False), encoding="utf-8")

    print("Dataset cleaning:", json.dumps(cleaning, sort_keys=True))
    print("Test split class counts:", json.dumps(weights["evaluation"]["classCounts"], sort_keys=True))
    print("Validation-based model selection:", json.dumps({"selected": best_name, "validationRows": len(y_validation), "validationFake": int(y_validation.sum()), "finalTestUsedForSelection": False}, sort_keys=True))
    print(pd.DataFrame(results).drop(columns="confusionMatrix").to_string(index=False))
    print("\nFake-positive confusion matrices:")
    for row in results:
        print(f"{row['name']}: {json.dumps(row['confusionMatrix'], sort_keys=True)}")
    print("\nRecall-forward threshold candidate:", json.dumps(weights["thresholdTuning"], sort_keys=True))
    print("\nFive-fold cross-validation:", json.dumps(weights["crossValidation"]["summary"], sort_keys=True))
    print("\nModern-style qualitative checks:", json.dumps(weights["modernQualitativeChecks"], sort_keys=True))
    print(f"\nSelected for the live JavaScript scorer on validation data by fake-class F1, then PR-AUC: {best_name}")
    print(f"Wrote {args.weights}, {output / 'comparison.json'}, {args.parity}, and {args.matrix}")


if __name__ == "__main__":
    main()
