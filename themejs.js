/* Load AFTER app.js:  <script src="theme.js"></script>
   Reads the rendered result and sets data-risk="low|medium|high" on #resultCard. */
(function () {
  var card = document.getElementById("resultCard");
  if (!card) return;
  function tag() {
    var level = null, nodes = card.querySelectorAll("*");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.children.length) continue;
      var t = (n.textContent || "").trim();
      var m = t.match(/^(low|medium|high) risk$/i);
      if (m) { level = m[1].toLowerCase(); n.classList.add("jsr-badge"); }
      else if (/^\d{1,3}$/.test(t) && n.parentElement) { n.parentElement.classList.add("jsr-ring"); }
    }
    if (level) card.setAttribute("data-risk", level); else card.removeAttribute("data-risk");
  }
  new MutationObserver(tag).observe(card, { childList: true, subtree: true, characterData: true });
  tag();
})();
