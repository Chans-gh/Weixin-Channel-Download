const tablist = document.querySelector(".preview-tabs");
const tabs = [...tablist.querySelectorAll('[role="tab"]')];

function selectTab(active) {
  tabs.forEach(tab => {
    const selected = tab === active;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
  });
}

tablist.hidden = false;
tablist.addEventListener("click", event => {
  if (tabs.includes(event.target)) selectTab(event.target);
});
tablist.addEventListener("keydown", event => {
  const index = tabs.indexOf(event.target);
  if (index < 0) return;
  const targets = {
    ArrowLeft: (index - 1 + tabs.length) % tabs.length,
    ArrowRight: (index + 1) % tabs.length,
    Home: 0,
    End: tabs.length - 1,
  };
  if (!Object.hasOwn(targets, event.key)) return;
  event.preventDefault();
  const next = tabs[targets[event.key]];
  selectTab(next);
  next.focus();
});

const copyButton = document.querySelector(".copy-button");
const promptText = document.getElementById("prompt-text");
const status = document.getElementById("copy-status");

copyButton.hidden = false;
copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(promptText.textContent);
    copyButton.textContent = "已复制";
    status.textContent = "提示词已复制到剪贴板。";
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(promptText);
    selection.removeAllRanges();
    selection.addRange(range);
    copyButton.textContent = "请手动复制";
    status.textContent = "提示词已经选中，可用系统快捷键复制。";
  }
});
