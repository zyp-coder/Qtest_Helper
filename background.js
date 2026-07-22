/**
 * Qoder Test Helper - Background Service Worker
 * 消息中转、数据存储、标签页管理
 */

// 监听扩展消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'OPEN_REPORT':
      // 在新标签页打开报告
      chrome.tabs.create({ url: message.url });
      sendResponse({ ok: true });
      break;

    case 'GET_REPORT':
      // 获取报告数据
      chrome.storage.local.get(['selectorReports', 'recorderReports'], (result) => {
        sendResponse({
          selectorReports: result.selectorReports || [],
          recorderReports: result.recorderReports || []
        });
      });
      return true; // 异步响应

    case 'DELETE_REPORT':
      // 删除指定报告
      const reportType = message.reportType;
      const reportId = message.reportId;
      chrome.storage.local.get([reportType], (result) => {
        const reports = result[reportType] || [];
        const filtered = reports.filter((_, i) => i !== reportId);
        chrome.storage.local.set({ [reportType]: filtered }, () => {
          sendResponse({ ok: true });
        });
      });
      return true;

    case 'CLEAR_ALL_DATA':
      chrome.storage.local.clear(() => {
        sendResponse({ ok: true });
      });
      return true;

    case 'EXPORT_REPORT':
      // 导出单个报告为JSON
      const reportData = message.data;
      const jsonStr = JSON.stringify(reportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      // 使用 download API
      const reader = new FileReader();
      reader.onload = function() {
        chrome.downloads?.download({
          url: reader.result,
          filename: message.filename || `qoder-report-${Date.now()}.json`,
          saveAs: true
        });
      };
      reader.readAsDataURL(blob);
      sendResponse({ ok: true });
      break;
  }
});

// 扩展安装时初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('Qoder Test Helper 已安装');
  // 初始化存储
  chrome.storage.local.set({
    selectorReports: [],
    recorderReports: [],
    settings: {
      maxReports: 50,
      autoClean: true
    }
  });
});

// 标签页更新时通知 content script
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // 可选：通知 content script 页面已刷新
    chrome.tabs.sendMessage(tabId, { type: 'PAGE_LOADED' }).catch(() => {
      // content script 可能未注入，忽略错误
    });
  }
});

// 键盘快捷键支持（可选）
chrome.commands?.onCommand?.addListener((command) => {
  if (command === 'toggle-selector') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_SELECTOR', active: true });
      }
    });
  }
});
