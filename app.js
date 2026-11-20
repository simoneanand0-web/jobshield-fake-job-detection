const login = document.querySelector('#login');
const app = document.querySelector('#app');
const text = document.querySelector('#jobText');
const toast = document.querySelector('#toast');
const authMount = document.querySelector('#clerk-auth');
const authStatus = document.querySelector('#authStatus');
let clerk;
let userButtonMounted = false;
let signInMounted = false;

function mountSignIn() {
  if (signInMounted) return;
  clerk.mountSignIn(authMount, {
    routing: 'hash',
    withSignUp: true,
    fallbackRedirectUrl: location.origin,
    signUpFallbackRedirectUrl: location.origin,
    appearance: {
      variables: {
        colorPrimary: '#216b50',
        colorText: '#18332b',
        colorTextSecondary: '#728279',
        colorBackground: '#ffffff',
        borderRadius: '8px',
        fontFamily: 'DM Sans, sans-serif'
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
    const response = await fetch('/api/auth-config', { cache: 'no-store' });
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
    await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
    clerk.addListener(({ user }) => updateAuthView(user));
    updateAuthView(clerk.user);
    setAuthStatus('Your account is managed securely by Clerk.');
  } catch (error) {
    setAuthStatus(error.message || 'Secure sign-in could not start. Please reload the page.', 'error');
  }
}

text.addEventListener('input', () => {
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function resetResult() {
  document.querySelector('#resultCard').classList.remove('done');
  document.querySelector('#resultCard').innerHTML = `<div class="result-top"><span>ANALYSIS RESULT</span><span class="result-icon">&#9673;</span></div><div class="empty-state"><div class="scan-art"><div class="scan-circle">&#8987;</div><div class="scan-line"></div><div class="scan-line short"></div></div><h3>Your results will show up here</h3><p>We will check for patterns that commonly appear in fraudulent job listings.</p></div><div class="result-foot"><span>MODEL</span><b>Multinomial Naive Bayes</b></div>`;
}

document.querySelector('#analyzeBtn').onclick = async () => {
  const content = text.value.trim();
  if (content.length < 35) {
    notify('Paste a few sentences from the listing to get started.');
    text.focus();
    return;
  }
  if (!clerk?.session) {
    notify('Please sign in again to analyze this listing.');
    return;
  }

  const button = document.querySelector('#analyzeBtn');
  button.disabled = true;
  button.innerHTML = '<span>&#10033;</span> Checking listing...';
  try {
    const token = await clerk.session.getToken();
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: content, url: document.querySelector('#jobUrl').value.trim() })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not analyze this listing.');
    render(result);
  } catch (error) {
    notify(error.message.includes('Failed to fetch') ? 'The analysis service could not be reached. Please try again.' : error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>&#10033;</span> Analyze listing <span class="arrow">&#8594;</span>';
  }
};

function render(result) {
  const color = result.risk >= 65 ? '#dc8167' : result.risk >= 40 ? '#d7a656' : '#5da77a';
  const flags = result.redFlags.length
    ? result.redFlags.map(flag => `<div class="flag"><span>&#9650;</span>${escapeHtml(flag)}</div>`).join('')
    : '<div class="flag clear"><span>&#10003;</span>No strong scam patterns found in the text</div>';
  const card = document.querySelector('#resultCard');
  card.classList.add('done');
  card.innerHTML = `<div class="result-top"><span>ANALYSIS RESULT</span><span class="result-icon">&#9673;</span></div><div class="score-head"><div class="score-ring" style="--risk:${result.risk};--score-color:${color}"><span>${result.risk}</span></div><div><div class="score-title">${escapeHtml(result.verdict)}</div><div class="score-sub">Scam risk score &middot; ${result.confidence}% model confidence</div></div></div><div class="eyebrow" style="font-size:9px;margin-bottom:10px">SIGNALS FOUND</div><div class="flag-list">${flags}</div><div class="result-actions"><button id="copyResult">Copy summary</button><button id="againResult">Check another</button></div><div class="result-foot" style="margin-top:13px"><span>MODEL &middot; ${result.trainingExamples} EXAMPLES</span><b>${result.signals} text signals</b></div>`;
  document.querySelector('#copyResult').onclick = () => navigator.clipboard?.writeText(`${result.verdict} - scam risk ${result.risk}%. ${result.redFlags.join('; ')}`).then(() => notify('Summary copied.')).catch(() => notify('Copy unavailable in this browser.'));
  document.querySelector('#againResult').onclick = () => {
    text.value = '';
    text.dispatchEvent(new Event('input'));
    resetResult();
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

document.querySelector('#aboutModel').onclick = event => {
  event.preventDefault();
  notify('Naive Bayes text model trained on 40 illustrative examples; educational demo only.');
};
document.querySelector('#historyNav').onclick = () => notify('Recent checks are kept only for this demo session.');

initializeAuth();
