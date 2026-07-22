/**
 * Qoder Test Helper - Popup Script
 * 简化为悬浮面板的开关
 */
document.addEventListener('DOMContentLoaded', async () => {
  const toggleBtn = document.getElementById('toggle-panel-btn');
  const btnText = document.getElementById('btn-text');

  toggleBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
      if (response && response.visible) {
        btnText.textContent = '隐藏悬浮面板';
        toggleBtn.classList.add('active');
      } else {
        btnText.textContent = '打开悬浮面板';
        toggleBtn.classList.remove('active');
      }
    } catch (e) {
      // content script 未注入，尝试注入
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });
      // 等一下再发消息
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
        btnText.textContent = '隐藏悬浮面板';
        toggleBtn.classList.add('active');
      }, 200);
    }
  });
});
