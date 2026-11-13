/**
 * The report's stylesheet and its small page script, kept inline in report.html so the file
 * works offline and can be emailed (SPEC §5.3). No external fonts, images or libraries.
 */

export const REPORT_CSS = `
:root{color-scheme:light dark;--bg:#f5f6f8;--surface:#fff;--text:#1a1f2b;--muted:#566074;--border:#dde1e8;--accent:#2a55cc;--code:#f0f2f5;
--blocker-fg:#9b1219;--blocker-bg:#fde7e7;--major-fg:#854200;--major-bg:#fdebd2;--minor-fg:#665000;--minor-bg:#faf1c0;--info-fg:#1d4a86;--info-bg:#e2edfc;--ok-fg:#14603a;--ok-bg:#def3e6}
@media (prefers-color-scheme:dark){:root{--bg:#12151b;--surface:#1b2029;--text:#e7eaf0;--muted:#a7b0c0;--border:#323a48;--accent:#9bb8ff;--code:#252b36;
--blocker-fg:#ffb4b4;--blocker-bg:#4a1a1d;--major-fg:#ffd09c;--major-bg:#4a2f10;--minor-fg:#f0dc82;--minor-bg:#403609;--info-fg:#add0ff;--info-bg:#16304f;--ok-fg:#a3e2bb;--ok-bg:#123522}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}
.wrap{max-width:880px;margin:0 auto;padding:0 20px}
a{color:var(--accent)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:4px}
.skip{position:absolute;left:-9999px}
.skip:focus{left:12px;top:12px;z-index:10;background:var(--surface);padding:8px 12px;border-radius:6px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
h1,h2,h3,h4,h5{line-height:1.25;margin:0}
h1{font-size:1.6rem}
h2{font-size:1.3rem;margin:44px 0 14px}
h3{font-size:1.05rem;margin:28px 0 12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
h4{font-size:1.15rem}
h5{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:18px 0 4px}
p{margin:0 0 10px}
.top{padding:32px 0 8px}
.brand{font-size:.85rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 24px;margin:18px 0 0;padding:0}
.meta div{min-width:0}
.meta dt{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.meta dd{margin:0}
.verdict{margin-top:24px;padding:22px 24px;border-radius:12px;border-left:8px solid;background:var(--v-bg);color:var(--v-fg);border-color:var(--v-fg)}
.verdict.v-not-ready{--v-fg:var(--blocker-fg);--v-bg:var(--blocker-bg)}
.verdict.v-fix-before-launch{--v-fg:var(--major-fg);--v-bg:var(--major-bg)}
.verdict.v-ready{--v-fg:var(--ok-fg);--v-bg:var(--ok-bg)}
.verdict h2{margin:0;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em}
.verdict .big{color:var(--v-fg);font-size:2rem;font-weight:800;line-height:1.15;margin:4px 0 8px}
.verdict p{color:var(--text)}
.counts{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:14px 0 0;padding:0}
.caveat{margin-top:12px;padding:12px 16px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
.badge,.tag{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.82rem;font-weight:700;white-space:nowrap}
.tag{font-weight:500;border:1px solid var(--border);color:var(--muted);background:var(--surface)}
.sev-blocker{background:var(--blocker-bg);color:var(--blocker-fg)}
.sev-major{background:var(--major-bg);color:var(--major-fg)}
.sev-minor{background:var(--minor-bg);color:var(--minor-fg)}
.sev-info{background:var(--info-bg);color:var(--info-fg)}
.badge{border:1px solid currentColor}
.panel,.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px 22px}
.card{margin:0 0 16px;border-left:6px solid var(--edge,var(--border));scroll-margin-top:12px}
.card.c-blocker{--edge:var(--blocker-fg)}
.card.c-major{--edge:var(--major-fg)}
.card.c-minor{--edge:var(--minor-fg)}
.card.c-info{--edge:var(--info-fg)}
.badges{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:10px 0 4px;padding:0}
.first{margin:0;padding:0;list-style:none;counter-reset:first}
.first li{counter-increment:first;display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center;padding:12px 0;border-top:1px solid var(--border)}
.first li:first-child{border-top:0;padding-top:0}
.first li:last-child{padding-bottom:0}
.first li::before{content:counter(first) ".";font-weight:800;min-width:1.4em}
.first a{font-weight:600;flex:1 1 240px}
.legend,.hint,.where{color:var(--muted);font-size:.92rem}
ol.steps{margin:0 0 10px;padding-left:1.4em}
.shots{display:flex;flex-wrap:wrap;gap:12px;margin:6px 0 10px}
figure{margin:0;max-width:100%}
figcaption{font-size:.85rem;color:var(--muted);margin-top:4px}
.shot{display:block;padding:0;border:1px solid var(--border);border-radius:8px;background:none;overflow:hidden;max-width:100%;font:inherit}
.js .shot{cursor:zoom-in}
.shot img{display:block;max-width:100%;max-height:300px;height:auto}
.zoom{display:none}
.js .zoom{display:inline}
details{margin:6px 0 10px}
summary{cursor:pointer;color:var(--accent);font-weight:600;padding:4px 0}
pre{margin:6px 0 0;padding:12px 14px;background:var(--code);border-radius:8px;white-space:pre-wrap;font:.86rem/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.fix{margin-top:18px;padding:14px 16px;border:1px dashed var(--border);border-radius:10px}
.fix-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.fix h5{margin:0}
.copy{display:none;font:inherit;font-size:.88rem;font-weight:700;padding:8px 16px;min-height:40px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--surface);cursor:pointer}
.js .copy{display:inline-block}
ul.list{list-style:none;margin:0;padding:0}
ul.list li{padding:7px 0 7px 28px;position:relative;border-top:1px solid var(--border)}
ul.list li:first-child{border-top:0}
ul.list li::before{position:absolute;left:4px;font-weight:800}
ul.worked li::before{content:"\\2713";color:var(--ok-fg)}
ul.skipped li::before{content:"\\2013";color:var(--muted)}
footer{margin:48px 0 0;padding:24px 0 40px;border-top:1px solid var(--border);color:var(--muted);font-size:.92rem}
dialog{border:0;border-radius:12px;padding:14px;background:var(--surface);color:var(--text);max-width:96vw;max-height:96vh}
dialog::backdrop{background:rgba(0,0,0,.75)}
dialog img{display:block;max-width:100%;max-height:78vh;margin:10px auto 0}
dialog .bar{display:flex;justify-content:space-between;align-items:center;gap:12px}
dialog button{font:inherit;font-weight:700;padding:8px 16px;min-height:40px;border-radius:8px;border:1px solid var(--border);background:var(--code);color:var(--text);cursor:pointer}
@media (max-width:560px){.wrap{padding:0 14px}.panel,.card{padding:16px}.verdict{padding:18px}.verdict .big{font-size:1.6rem}h1{font-size:1.35rem}}
@media print{.copy,.zoom,.skip{display:none!important}body{background:#fff}.card,.panel{break-inside:avoid}}
`.trim();

/**
 * Copy buttons and the screenshot lightbox. The report stays fully readable without it:
 * the script only adds the "js" class that reveals the controls it powers.
 */
export const REPORT_JS = `
(function () {
  var doc = document;
  doc.documentElement.classList.add('js');
  var status = doc.getElementById('status');
  var box = doc.getElementById('lightbox');
  function say(text) { if (status) status.textContent = text; }
  function fallbackCopy(node) {
    var range = doc.createRange();
    range.selectNodeContents(node);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    var ok = false;
    try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
    return ok;
  }
  function copied(button, ok) {
    var label = button.getAttribute('data-label') || button.textContent;
    button.setAttribute('data-label', label);
    button.textContent = ok ? 'Copied' : 'Select the text and copy it';
    say(ok ? 'Fix prompt copied' : 'Copying did not work. Select the text and copy it by hand.');
    setTimeout(function () { button.textContent = label; }, 2500);
  }
  function copy(button) {
    var node = doc.getElementById(button.getAttribute('data-copy'));
    if (!node) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(node.textContent).then(
        function () { copied(button, true); },
        function () { copied(button, fallbackCopy(node)); }
      );
    } else {
      copied(button, fallbackCopy(node));
    }
  }
  function enlarge(trigger) {
    var image = doc.getElementById(trigger.getAttribute('data-shot'));
    if (!image || !box || !box.showModal) return false;
    box.querySelector('img').src = image.src;
    box.querySelector('img').alt = image.alt;
    box.querySelector('.caption').textContent = image.alt;
    box.showModal();
    return true;
  }
  doc.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    if (box && (target === box || target.closest('[data-close]'))) { box.close(); return; }
    var copyButton = target.closest('[data-copy]');
    if (copyButton) { copy(copyButton); return; }
    var shot = target.closest('[data-shot]');
    if (shot && enlarge(shot)) event.preventDefault();
  });
})();
`.trim();
