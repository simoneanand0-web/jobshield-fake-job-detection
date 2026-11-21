const login = document.querySelector('#login');
const app = document.querySelector('#app');
const text = document.querySelector('#jobText');
const toast = document.querySelector('#toast');
const authMount = document.querySelector('#clerk-auth');
const authStatus = document.querySelector('#authStatus');
const historyDialog = document.querySelector('#historyDialog');
let clerk;
let currentUserId = null;
let userButtonMounted = false;
let signInMounted = false;
let currentAnalysisId = '';
let currentModelVersion = '3.0.0';
let currentSelectedModel = 'Loading classifier';

function mountSignIn() {
  if (signInMounted) return;
  clerk.mountSignIn(authMount, {
    routing: 'hash',
    withSignUp: true,
    fallbackRedirectUrl: location.origin,
    signUpFallbackRedirectUrl: location.origin,
    appearance: {
      variables: {
        colorPrimary: '#6259e8', colorText: '#1b2140', colorTextSecondary: '#777b96',
        colorBackground: '#ffffff', borderRadius: '8px', fontFamily: 'DM Sans, sans-serif'
      }
    }
  });
  signInMounted = true;
}

function setAuthStatus(message, kind = '') {
  authStatus.textContent = message;
  authStatus.className = `auth-status ${kind}`.trim();
}

function loadScript(script) {
  return new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load the secure sign-in service. Check your network and Clerk domain settings.'));
    document.head.appendChild(script);
  });
}

function updateAuthView(user) {
  currentUserId = user?.id || null;
  if (!user) {
    if (clerk) mountSignIn();
    app.classList.add('hidden');
    login.classList.remove('hidden');
    return;
  }

  if (signInMounted) {
    clerk.unmountSignIn(authMount);
    signInMounted = false;
  }
  login.classList.add('hidden');
  app.classList.remove('hidden');
  const email = user.primaryEmailAddress?.emailAddress || user.emailAddresses?.[0]?.emailAddress || '';
  const name = user.fullName || user.username || email || 'JobShield member';
  document.querySelector('#profileName').textContent = name;
  document.querySelector('#profileEmail').textContent = email;
  document.querySelector('#profileAvatar').textContent = (name.trim()[0] || 'J').toUpperCase();

  if (!userButtonMounted) {
    clerk.mountUserButton(document.querySelector('#clerk-user-button'));
    userButtonMounted = true;
  }
}

async function initializeAuth() {
  try {
    const response = await fetch('/api/auth-config', {cache:'no-store'});
    const config = await response.json();
    if (!response.ok || !config.configured || !config.publishableKey) {
      setAuthStatus('Account registration is not connected yet. Add the Clerk keys to the Vercel project to enable sign-up.', 'error');
      return;
    }
    const publishableKey = config.publishableKey;
    const encodedDomain = publishableKey.split('_')[2];
    if (!encodedDomain) throw new Error('The Clerk publishable key is invalid. Check the Vercel environment variable.');
    const clerkDomain = atob(encodedDomain).slice(0, -1);
    const uiScript = document.createElement('script');
    uiScript.src = `https://${clerkDomain}/npm/@clerk/ui@1/dist/ui.browser.js`;
    uiScript.async = true;
    uiScript.crossOrigin = 'anonymous';
    await loadScript(uiScript);
    const sdkScript = document.createElement('script');
    sdkScript.src = `https://${clerkDomain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
    sdkScript.async = true;
    sdkScript.crossOrigin = 'anonymous';
    sdkScript.dataset.clerkPublishableKey = publishableKey;
    await loadScript(sdkScript);
    clerk = window.Clerk;
    if (!clerk) throw new Error('Clerk loaded without its sign-in client. Please reload the page.');
    await clerk.load({ui:{ClerkUI:window.__internal_ClerkUICtor}});
    clerk.addListener(({user}) => updateAuthView(user));
    updateAuthView(clerk.user);
    setAuthStatus('Your account is managed securely by Clerk.');
  } catch (error) {
    setAuthStatus(error.message || 'Secure sign-in could not start. Please reload the page.', 'error');
  }
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

function userStorageKey(type) {
  return currentUserId ? `jobshield.${type}.${currentUserId}` : '';
}

function readStored(type) {
  const key = userStorageKey(type);
  if (!key) return [];
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function writeStored(type, values) {
  const key = userStorageKey(type);
  if (!key) return false;
  try {
    localStorage.setItem(key, JSON.stringify(values));
    return true;
  } catch {
    notify('Browser storage is full. Clear old checks and try again.');
    return false;
  }
}

function safeHistoryUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch { return ''; }
}

function safeTitle(raw) {
  return String(raw || 'Job listing').split(/\r?\n/).map(line => line.trim()).find(Boolean)
    ?.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number]')
    .slice(0, 100) || 'Job listing';
}

function saveHistory(result, listingText, listingUrl) {
  const item = {
    id:`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    checkedAt:new Date().toISOString(),
    title:safeTitle(listingText),
    url:safeHistoryUrl(listingUrl),
    risk:result.risk,
    riskLevel:result.riskLevel,
    verdict:result.verdict,
    scoreLabel:result.scoreLabel,
    redFlags:result.redFlags || [],
    explanations:result.explanations || [],
    positiveSignals:result.positiveSignals || [],
    signals:result.signals,
    trainingExamples:result.trainingExamples,
    model:result.model,
    comparison:result.comparison || [],
    evaluation:result.evaluation || {}
  };
  const items = [item, ...readStored('history')].slice(0, 25);
  if (writeStored('history', items)) currentAnalysisId = item.id;
}

function resetResult() {
  currentAnalysisId = '';
  document.querySelector('#resultCard').classList.remove('done');
  document.querySelector('#resultCard').innerHTML = `<div class="result-top"><span>ANALYSIS RESULT</span><span class="result-icon">&#9673;</span></div><div class="empty-state"><div class="scan-art"><div class="scan-circle">&#8987;</div><div class="scan-line"></div><div class="scan-line short"></div></div><h3>Your results will show up here</h3><p>We’ll check for patterns that commonly appear in fraudulent job listings.</p></div><div class="result-foot"><span>MODEL</span><b>Ensemble classifier</b></div>`;
  document.querySelector('#resultCard .result-foot b').textContent = currentSelectedModel;
}

document.querySelector('#jobText').addEventListener('input', () => {
  document.querySelector('#charCount').textContent = `${text.value.length.toLocaleString()} / 12,000`;
});

const sample = `Remote Personal Assistant - $4,500 per week\n\nWe are urgently hiring a personal assistant to work from home. No experience needed and no interview required. You will receive and reship packages using your home address.\n\nTo secure your position, send your passport and bank account details to our recruiter today. A small refundable training fee is required before your first day. Earn guaranteed income with just two hours of work daily!`;
document.querySelector('#sampleBtn').onclick = () => {
  text.value = sample;
  text.dispatchEvent(new Event('input'));
  text.focus();
};

document.querySelector('#newCheck').onclick = () => {
  text.value = '';
  document.querySelector('#jobUrl').value = '';
  text.dispatchEvent(new Event('input'));
  resetResult();
  window.scrollTo({top:0, behavior:'smooth'});
};

async function getSessionToken() {
  if (!clerk?.session) throw new Error('Please sign in again to continue.');
  return clerk.session.getToken();
}

document.querySelector('#importUrlBtn').onclick = async () => {
  const urlInput = document.querySelector('#jobUrl');
  const url = urlInput.value.trim();
  if (!url) { notify('Paste a job listing URL first.'); urlInput.focus(); return; }
  const button = document.querySelector('#importUrlBtn');
  button.disabled = true;
  button.textContent = 'Importing…';
  try {
    const token = await getSessionToken();
    const response = await fetch('/api/extract', {
      method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
      body:JSON.stringify({url})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not import this listing.');
    text.value = result.text;
    text.dispatchEvent(new Event('input'));
    urlInput.value = result.url || url;
    notify(`Imported “${result.title || 'job listing'}”. Review the text before analysis.`);
    text.focus();
  } catch (error) {
    notify(error.message.includes('Failed to fetch') ? 'The import service could not be reached. Paste the listing text instead.' : error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Import text';
  }
};

document.querySelector('#jobUrl').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); document.querySelector('#importUrlBtn').click(); }
});

document.querySelector('#analyzeBtn').onclick = async () => {
  const content = text.value.trim();
  if (content.length < 35) { notify('Paste a few sentences from the listing to get started.'); text.focus(); return; }
  if (!clerk?.session) { notify('Please sign in again to analyze this listing.'); return; }
  const button = document.querySelector('#analyzeBtn');
  button.disabled = true;
  button.innerHTML = '<span>&#10033;</span> Checking listing...';
  try {
    const token = await clerk.session.getToken();
    const response = await fetch('/api/analyze', {
      method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
      body:JSON.stringify({text:content, url:document.querySelector('#jobUrl').value.trim()})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not analyze this listing.');
    render(result);
    saveHistory(result, content, document.querySelector('#jobUrl').value.trim());
  } catch (error) {
    notify(error.message.includes('Failed to fetch') ? 'The analysis service could not be reached. Please try again.' : error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>&#10033;</span> Analyze listing <span class="arrow">&#8594;</span>';
  }
};

function renderComparison(result) {
  const models = Array.isArray(result.comparison) ? result.comparison : [];
  if (!models.length) return '';
  const rows = models.map(model => `<tr><th scope="row">${escapeHtml(model.name)}</th><td>${model.accuracy}%</td><td>${model.precision}%</td><td>${model.recall}%</td><td>${model.f1}%</td><td>${model.prAuc}%</td></tr>`).join('');
  const matrices = models.map(model => `<tr><th scope="row">${escapeHtml(model.name)}</th><td>${model.confusionMatrix?.tp ?? 0}</td><td>${model.confusionMatrix?.fp ?? 0}</td><td>${model.confusionMatrix?.fn ?? 0}</td><td>${model.confusionMatrix?.tn ?? 0}</td></tr>`).join('');
  return `<details class="model-comparison"><summary>Compare classifiers</summary><p>${escapeHtml(result.evaluation?.method || 'Held-out evaluation')} on ${Number(result.evaluation?.examples || 0).toLocaleString()} unseen listings. Precision, recall, F1, and PR-AUC refer to the fake class.</p><div class="table-scroll"><table class="metrics-table"><thead><tr><th>Model</th><th>Acc.</th><th>Prec.</th><th>Recall</th><th>F1</th><th>PR-AUC</th></tr></thead><tbody>${rows}</tbody></table></div><details class="matrix-details"><summary>Confusion matrix counts</summary><div class="table-scroll"><table class="metrics-table matrix-table"><thead><tr><th>Model</th><th>TP</th><th>FP</th><th>FN</th><th>TN</th></tr></thead><tbody>${matrices}</tbody></table></div><small>Positive class = fake listing. Counts come from the held-out test split.</small></details></details>`;
}

function downloadReport(result) {
  const lines = [
    'JOBSHIELD LISTING REVIEW',
    `Created: ${new Date().toLocaleString()}`,
    `Listing: ${safeTitle(text.value)}`,
    `Source: ${safeHistoryUrl(document.querySelector('#jobUrl').value) || 'Not provided'}`,
    '',
    `Risk level: ${result.riskLevel || 'Not available'}`,
    `Risk score: ${result.risk}/100`,
    `Model score: ${result.risk}/100 (not a verified real-world probability)`,
    `Assessment: ${result.verdict}`,
    `Classifier: ${result.model}`,
    '',
    'MATCHED WARNING SIGNS:',
    ...(result.explanations?.length ? result.explanations.map(item => `- ${item.label}: “${item.evidence}”. ${item.advice}`) : ['- No strong known warning phrase matched.']),
    '',
    'OTHER LISTING DETAILS:',
    ...(result.positiveSignals?.length ? result.positiveSignals.map(item => `- ${item.label}: “${item.evidence}”.`) : ['- No listed positive pattern matched.']),
    '',
    'MODEL COMPARISON (HELD-OUT TEST SPLIT; FAKE CLASS):',
    ...(result.comparison || []).map(model => `- ${model.name}: accuracy ${model.accuracy}%, precision ${model.precision}%, recall ${model.recall}%, F1 ${model.f1}%, PR-AUC ${model.prAuc}%`),
    '',
    'LIMITATION: EMSCAD postings date from 2012–2014. The score is not proof that a job is fake or legitimate. Verify the employer independently. The job description text is not included in this report.'
  ];
  const blob = new Blob([lines.join('\n')], {type:'text/plain;charset=utf-8'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `jobshield-review-${new Date().toISOString().slice(0,10)}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  notify('Your report was downloaded.');
}

function saveFeedback(vote, reason) {
  const records = readStored('feedback');
  records.push({analysisId:currentAnalysisId, vote, reason, risk:Number(document.querySelector('#resultCard').dataset.risk || 0), createdAt:new Date().toISOString()});
  if (writeStored('feedback', records.slice(-100))) {
    document.querySelector('#feedbackMessage').textContent = 'Thanks. Your feedback is saved only in this browser.';
    document.querySelector('#saveFeedback').disabled = true;
  }
}

function attachFeedback() {
  let vote = '';
  document.querySelectorAll('[data-feedback]').forEach(button => {
    button.onclick = () => {
      vote = button.dataset.feedback;
      document.querySelectorAll('[data-feedback]').forEach(item => item.classList.toggle('selected', item === button));
      document.querySelector('#saveFeedback').disabled = !vote;
    };
  });
  document.querySelector('#saveFeedback').onclick = () => {
    if (!vote) return;
    saveFeedback(vote, document.querySelector('#feedbackReason').value);
  };
}

function render(result, options = {}) {
  const color = result.risk >= 65 ? '#e77872' : result.risk >= 40 ? '#e1a748' : '#43b9ad';
  const flags = result.redFlags?.length
    ? result.redFlags.map(flag => `<div class="flag"><span>&#9650;</span>${escapeHtml(flag)}</div>`).join('')
    : '<div class="flag clear"><span>&#10003;</span>No strong scam patterns found in the text</div>';
  const riskLevel = result.riskLevel || (result.risk >= 65 ? 'High' : result.risk >= 40 ? 'Medium' : 'Low');
  const explanations = result.explanations?.length
    ? result.explanations.map(item => `<li><b>${escapeHtml(item.label)}</b><span class="evidence-caption">Matched phrase</span><mark class="evidence-highlight">“${escapeHtml(item.evidence)}”</mark><small>${escapeHtml(item.advice || '')}</small></li>`).join('')
    : '<li><b>No strong known scam phrase matched</b><span>The model score is based on language patterns in the full listing.</span><small>Check the employer and application link independently.</small></li>';
  const positiveSignals = result.positiveSignals?.length
    ? `<div class="positive-signals"><b>Details that may support legitimacy</b><ul>${result.positiveSignals.map(item => `<li>${escapeHtml(item.label)}</li>`).join('')}</ul></div>` : '';
  const card = document.querySelector('#resultCard');
  card.dataset.risk = result.risk;
  card.classList.add('done');
  card.innerHTML = `<div class="result-top"><span>ANALYSIS RESULT</span><span class="result-icon">&#9673;</span></div><div class="score-head"><div class="score-ring" style="--risk:${result.risk};--score-color:${color}"><span>${result.risk}</span></div><div class="score-copy"><span class="risk-chip risk-${riskLevel.toLowerCase()}">${escapeHtml(riskLevel)} risk</span><div class="score-title">${escapeHtml(result.verdict)}</div><div class="score-sub">${escapeHtml(result.scoreLabel || 'Uncalibrated model score, not a probability')}</div><div class="agreement-score">Model decision threshold · ${Math.round(Number(result.threshold || 0.5) * 100)}%</div></div></div><div class="eyebrow section-label">SIGNALS FOUND</div><div class="flag-list">${flags}</div><details class="explanation" open><summary>Why this score?</summary><ul>${explanations}</ul>${positiveSignals}<p class="caveat">Exact matched phrases are highlighted. This is a screening signal, not proof; verify the employer directly.</p></details>${renderComparison(result)}<div class="result-actions"><button id="copyResult">Copy summary</button><button id="downloadReport">Download report</button><button id="againResult">Check another</button></div><div class="feedback-panel"><b>Was this result helpful?</b><div class="feedback-votes"><button type="button" data-feedback="helpful">Yes</button><button type="button" data-feedback="not-helpful">No</button><select id="feedbackReason" aria-label="Optional feedback reason"><option value="">Optional reason</option><option value="false-alarm">It flagged a legitimate listing</option><option value="missed-signal">It missed a warning sign</option><option value="unclear-score">The score was unclear</option></select><button type="button" id="saveFeedback" disabled>Save</button></div><small id="feedbackMessage">Feedback stays in this browser and is not sent to a server.</small></div><div class="result-foot" style="margin-top:13px"><span>MODEL v${escapeHtml(currentModelVersion)} · ${Number(result.trainingExamples || 0).toLocaleString()} LISTINGS</span><b>${Number(result.signals || 0).toLocaleString()} text signals</b></div>`;
  document.querySelector('#copyResult').onclick = () => navigator.clipboard?.writeText(`${riskLevel} risk (${result.risk}/100; score is not a calibrated probability). ${result.redFlags?.join('; ') || 'No strong known pattern matched.'}`).then(() => notify('Summary copied.')).catch(() => notify('Copy unavailable in this browser.'));
  document.querySelector('#downloadReport').onclick = () => downloadReport(result);
  document.querySelector('#againResult').onclick = () => {
    text.value = '';
    document.querySelector('#jobUrl').value = '';
    text.dispatchEvent(new Event('input'));
    resetResult();
  };
  attachFeedback();
  if (options.save !== false) window.scrollTo({top:0, behavior:'smooth'});
}

function showHistory() {
  const items = readStored('history');
  const list = document.querySelector('#historyList');
  if (!items.length) {
    list.innerHTML = '<div class="history-empty"><b>No saved checks yet</b><span>After an analysis, its summary appears here. Listing text is never saved.</span></div>';
  } else {
    list.innerHTML = items.map(item => `<button class="history-row" data-history-id="${escapeHtml(item.id)}"><span class="history-score" style="--score-color:${item.risk >= 65 ? '#e77872' : item.risk >= 40 ? '#e1a748' : '#43b9ad'}">${item.risk}</span><span class="history-copy"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.verdict)} · ${new Date(item.checkedAt).toLocaleString()}</small></span><span class="history-open">View</span></button>`).join('');
    list.querySelectorAll('[data-history-id]').forEach(button => {
      button.onclick = () => {
        const selected = items.find(item => item.id === button.dataset.historyId);
        if (!selected) return;
        currentAnalysisId = selected.id;
        document.querySelector('#jobUrl').value = selected.url || '';
        render(selected, {save:false});
        historyDialog.classList.add('hidden');
        window.scrollTo({top:0, behavior:'smooth'});
      };
    });
  }
  historyDialog.classList.remove('hidden');
}

document.querySelector('#historyNav').onclick = showHistory;
document.querySelector('#closeHistory').onclick = () => historyDialog.classList.add('hidden');
historyDialog.addEventListener('click', event => { if (event.target === historyDialog) historyDialog.classList.add('hidden'); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    historyDialog.classList.add('hidden');
    document.querySelector('#modelInfoDialog').classList.add('hidden');
  }
});
document.querySelector('#clearHistory').onclick = () => {
  if (!currentUserId || !confirm('Clear saved check summaries from this browser?')) return;
  localStorage.removeItem(userStorageKey('history'));
  showHistory();
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

function renderModelInfo(info) {
  currentModelVersion = String(info.version || '3.0.0');
  currentSelectedModel = String(info.selectedModel || 'Text classifier');
  document.querySelector('#modelVersion').textContent = `v${currentModelVersion}`;
  const updated = new Date(`${info.updatedAt || '2026-11-21'}T12:00:00`).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'});
  document.querySelector('#modelUpdated').textContent = `UPDATED ${updated.toUpperCase()}`;
  const models = Array.isArray(info.models) ? info.models : [];
  const percent = value => `${Number(value || 0)}%`;
  const modelRows = models.map(model => `<tr><th scope="row">${escapeHtml(model.name)}${model.name === info.selectedModel ? ' <small>(live)</small>' : ''}</th><td>${percent(model.accuracy)}</td><td>${percent(model.precision)}</td><td>${percent(model.recall)}</td><td>${percent(model.f1)}</td><td>${percent(model.prAuc)}</td></tr>`).join('');
  const matrixRows = models.map(model => `<tr><th scope="row">${escapeHtml(model.name)}</th><td>${Number(model.confusionMatrix?.tp || 0)}</td><td>${Number(model.confusionMatrix?.fp || 0)}</td><td>${Number(model.confusionMatrix?.fn || 0)}</td><td>${Number(model.confusionMatrix?.tn || 0)}</td></tr>`).join('');
  const limitations = (info.limitations || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
  const dataset = info.dataset || {};
  const total = Number(dataset.rowsAfterCleaning || 0);
  const legitimate = Number(dataset.legitimate || 0);
  const fake = Number(dataset.fake || 0);
  const liveModel = escapeHtml(info.selectedModel || 'Selected classifier');
  document.querySelector('#modelInfoBody').innerHTML = `<div class="model-intro"><p><b>${escapeHtml(dataset.name || 'Dataset')}</b> contains ${total.toLocaleString()} unique usable listings after cleaning: ${legitimate.toLocaleString()} legitimate and ${fake.toLocaleString()} fake (${total ? (fake / total * 100).toFixed(2) : '0.00'}% fake).</p><p>Data: <a href="${escapeHtml(dataset.source || '#')}" target="_blank" rel="noreferrer">Kaggle dataset</a> · Research: <a href="${escapeHtml(dataset.paper || '#')}" target="_blank" rel="noreferrer">EMSCAD paper</a> · ${escapeHtml(dataset.license || '')}</p><p>${Number(dataset.duplicateTextsRemoved || 0).toLocaleString()} duplicate texts removed before the split; ${Number(dataset.conflictingDuplicateRowsRemoved || 0).toLocaleString()} rows with conflicting duplicate labels excluded.</p></div><div class="model-stat-grid"><div><span>MODEL VERSION</span><b>v${escapeHtml(currentModelVersion)}</b></div><div><span>LAST UPDATED</span><b>${escapeHtml(updated)}</b></div><div><span>LIVE CLASSIFIER</span><b>${liveModel}</b></div><div><span>TEST SPLIT</span><b>${Number(info.evaluation?.examples || 0).toLocaleString()} listings</b></div></div><h3>Held-out test results</h3><p class="model-method">${escapeHtml(info.evaluation?.method || 'Not available')}. Positive class: <b>${escapeHtml(info.evaluation?.positiveClass || 'Fake job post')}</b>. Precision, recall, F1, and PR-AUC refer to fake listings. The live classifier was selected using a separate validation split inside the training data; the test split was not used to choose it.</p><div class="table-scroll"><table class="metrics-table model-card-table"><thead><tr><th>Model</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th><th>PR-AUC</th></tr></thead><tbody>${modelRows}</tbody></table></div><h3>Confusion matrices</h3><p class="model-method">Counts across the same ${Number(info.evaluation?.examples || 0).toLocaleString()} held-out listings. TP/FP/FN/TN are for the fake-job positive class.</p><div class="table-scroll"><table class="metrics-table matrix-table model-card-table"><thead><tr><th>Model</th><th>TP</th><th>FP</th><th>FN</th><th>TN</th></tr></thead><tbody>${matrixRows}</tbody></table></div><details class="model-limitations" open><summary>Limitations</summary><ul>${limitations}</ul></details><p class="model-disclaimer">These results are from one holdout split of historical EMSCAD data. The selected model is ${liveModel}. Treat the score as a screening aid, not a guarantee.</p>`;
}

document.querySelector('#aboutModel').onclick = async event => {
  event.preventDefault();
  const dialog = document.querySelector('#modelInfoDialog');
  const body = document.querySelector('#modelInfoBody');
  dialog.classList.remove('hidden');
  body.innerHTML = '<div class="model-loading">Loading the current dataset and evaluation results…</div>';
  try {
    const response = await fetch('/api/analyze', {method:'GET', cache:'no-store'});
    const info = await response.json();
    if (!response.ok) throw new Error(info.error || 'Model information is unavailable.');
    renderModelInfo(info);
  } catch (error) {
    body.innerHTML = `<div class="model-load-error">${escapeHtml(error.message || 'Model information could not be loaded. Please try again.')}</div>`;
  }
};
document.querySelector('#closeModelInfo').onclick = () => document.querySelector('#modelInfoDialog').classList.add('hidden');
document.querySelector('#modelInfoDialog').addEventListener('click', event => {
  if (event.target.id === 'modelInfoDialog') event.currentTarget.classList.add('hidden');
});

fetch('/api/analyze', {method:'GET', cache:'no-store'})
  .then(response => response.json().then(info => ({response, info})))
  .then(({response, info}) => {
    if (!response.ok) throw new Error(info.error || 'Could not load model information.');
    renderModelInfo(info);
    const modelLabel = document.querySelector('#resultCard .result-foot b');
    if (modelLabel) modelLabel.textContent = info.selectedModel || 'Text classifier';
  })
  .catch(() => {});

initializeAuth();
