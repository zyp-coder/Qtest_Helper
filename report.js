/**
 * Qoder Test Helper - Report Page Script
 * 展示和管理测试报告
 */

document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.tab');
  const selectorPanel = document.getElementById('selector-panel');
  const recorderPanel = document.getElementById('recorder-panel');
  const reportDetail = document.getElementById('report-detail');
  const detailContent = document.getElementById('detail-content');
  const selectorList = document.getElementById('selector-list');
  const recorderList = document.getElementById('recorder-list');
  const selectorEmpty = document.getElementById('selector-empty');
  const recorderEmpty = document.getElementById('recorder-empty');
  const selectorBadge = document.getElementById('selector-badge');
  const recorderBadge = document.getElementById('recorder-badge');
  const backBtn = document.getElementById('back-btn');
  const exportDetailBtn = document.getElementById('export-detail-btn');
  const copyDetailBtn = document.getElementById('copy-detail-btn');
  const exportAllBtn = document.getElementById('export-all-btn');
  const clearAllBtn = document.getElementById('clear-all-btn');

  let currentReport = null;
  let currentReportType = null;
  let allReports = { selectorReports: [], recorderReports: [] };

  // === Tab 切换 ===
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      selectorPanel.classList.toggle('hidden', target !== 'selector');
      recorderPanel.classList.toggle('hidden', target !== 'recorder');
      reportDetail.classList.add('hidden');
    });
  });

  // === 返回按钮 ===
  backBtn.addEventListener('click', () => {
    reportDetail.classList.add('hidden');
    const activeTab = document.querySelector('.tab.active').dataset.tab;
    if (activeTab === 'selector') selectorPanel.classList.remove('hidden');
    else recorderPanel.classList.remove('hidden');
    currentReport = null;
  });

  // === 导出详情 ===
  exportDetailBtn.addEventListener('click', () => {
    if (!currentReport) return;
    const json = JSON.stringify(currentReport, null, 2);
    downloadFile(json, `qoder-report-${currentReport.type}-${Date.now()}.json`);
  });

  // === 复制详情 ===
  copyDetailBtn.addEventListener('click', () => {
    if (!currentReport) return;
    const json = JSON.stringify(currentReport, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      showToast('已复制到剪贴板');
    }).catch(() => {
      showToast('复制失败');
    });
  });

  // === 导出全部 ===
  exportAllBtn.addEventListener('click', () => {
    const json = JSON.stringify(allReports, null, 2);
    downloadFile(json, `qoder-all-reports-${Date.now()}.json`);
  });

  // === 清空数据 ===
  clearAllBtn.addEventListener('click', () => {
    if (confirm('确定要清空所有报告数据吗？此操作不可撤销。')) {
      chrome.runtime.sendMessage({ type: 'CLEAR_ALL_DATA' }, () => {
        allReports = { selectorReports: [], recorderReports: [] };
        renderReports();
        showToast('数据已清空');
      });
    }
  });

  // === 加载报告 ===
  function loadReports() {
    chrome.runtime.sendMessage({ type: 'GET_REPORT' }, (response) => {
      if (response) {
        allReports = {
          selectorReports: response.selectorReports || [],
          recorderReports: response.recorderReports || []
        };
        renderReports();
      }
    });
  }

  function renderReports() {
    // 更新 badge
    selectorBadge.textContent = allReports.selectorReports.length;
    recorderBadge.textContent = allReports.recorderReports.length;

    // 渲染选择器报告
    selectorList.innerHTML = '';
    selectorEmpty.style.display = allReports.selectorReports.length === 0 ? 'block' : 'none';

    allReports.selectorReports.slice().reverse().forEach((report, idx) => {
      const realIdx = allReports.selectorReports.length - 1 - idx;
      const card = createSelectorReportCard(report, realIdx);
      selectorList.appendChild(card);
    });

    // 渲染录制器报告
    recorderList.innerHTML = '';
    recorderEmpty.style.display = allReports.recorderReports.length === 0 ? 'block' : 'none';

    allReports.recorderReports.slice().reverse().forEach((report, idx) => {
      const realIdx = allReports.recorderReports.length - 1 - idx;
      const card = createRecorderReportCard(report, realIdx);
      recorderList.appendChild(card);
    });
  }

  function createSelectorReportCard(report, index) {
    const card = document.createElement('div');
    card.className = 'report-card';
    const time = new Date(report.generatedAt).toLocaleString('zh-CN');
    card.innerHTML = `
      <div class="report-card-header">
        <span class="report-card-title">🎯 ${report.title || '元素选择器报告'}</span>
        <span class="report-card-time">${time}</span>
      </div>
      <div class="report-card-meta">
        <span class="meta-item"><span class="meta-icon">📦</span> ${report.totalElements} 个元素</span>
        <span class="meta-item"><span class="meta-icon">🌐</span> ${report.pageTitle || 'N/A'}</span>
      </div>
      <div class="report-card-url">${report.pageUrl}</div>
      <div class="report-card-actions">
        <button class="btn btn-primary btn-sm view-btn">查看详情</button>
        <button class="btn btn-outline btn-sm export-btn">导出</button>
        <button class="btn btn-danger btn-sm delete-btn">删除</button>
      </div>
    `;

    card.querySelector('.view-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      showSelectorDetail(report);
    });
    card.querySelector('.export-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      downloadFile(JSON.stringify(report, null, 2), `selector-report-${index}.json`);
    });
    card.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'DELETE_REPORT', reportType: 'selectorReports', reportId: index }, () => {
        loadReports();
        showToast('报告已删除');
      });
    });

    return card;
  }

  function createRecorderReportCard(report, index) {
    const card = document.createElement('div');
    card.className = 'report-card';
    const time = new Date(report.generatedAt).toLocaleString('zh-CN');
    const duration = formatDuration(report.duration);
    card.innerHTML = `
      <div class="report-card-header">
        <span class="report-card-title">📹 ${report.title || '日志采集报告'}</span>
        <span class="report-card-time">${time} | 时长 ${duration}</span>
      </div>
      <div class="report-card-meta">
        <span class="meta-item"><span class="meta-icon">📝</span> ${report.summary.totalLogs} 条日志</span>
        <span class="meta-item"><span class="meta-icon">🌐</span> ${report.summary.totalNetworkRequests} 个请求</span>
        <span class="meta-item"><span class="meta-icon">🔧</span> ${report.summary.totalDomMutations} DOM变化</span>
        <span class="meta-item"><span class="meta-icon">👆</span> ${report.summary.totalUserActions} 次操作</span>
        <span class="meta-item"><span class="meta-icon">❌</span> ${report.summary.errorCount} 个错误</span>
      </div>
      <div class="report-card-url">${report.pageUrl}</div>
      <div class="report-card-actions">
        <button class="btn btn-primary btn-sm view-btn">查看详情</button>
        <button class="btn btn-outline btn-sm export-btn">导出</button>
        <button class="btn btn-danger btn-sm delete-btn">删除</button>
      </div>
    `;

    card.querySelector('.view-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      showRecorderDetail(report);
    });
    card.querySelector('.export-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      downloadFile(JSON.stringify(report, null, 2), `recorder-report-${index}.json`);
    });
    card.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'DELETE_REPORT', reportType: 'recorderReports', reportId: index }, () => {
        loadReports();
        showToast('报告已删除');
      });
    });

    return card;
  }

  // === 选择器报告详情 ===
  function showSelectorDetail(report) {
    currentReport = report;
    currentReportType = 'selector';
    selectorPanel.classList.add('hidden');
    recorderPanel.classList.add('hidden');
    reportDetail.classList.remove('hidden');

    let html = `
      <div class="detail-section">
        <h2 class="section-title">报告概览</h2>
        <div class="summary-grid">
          <div class="summary-card">
            <div class="summary-value">${report.totalElements}</div>
            <div class="summary-label">选中元素</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">${new Date(report.generatedAt).toLocaleTimeString('zh-CN')}</div>
            <div class="summary-label">生成时间</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">${report.viewportSize.width}x${report.viewportSize.height}</div>
            <div class="summary-label">视口大小</div>
          </div>
        </div>
      </div>
      <div class="detail-section">
        <h2 class="section-title">页面信息</h2>
        <div class="element-info-grid">
          <div class="element-info-item"><span class="label">URL</span><span class="value">${report.pageUrl}</span></div>
          <div class="element-info-item"><span class="label">标题</span><span class="value">${report.pageTitle}</span></div>
        </div>
      </div>
      <div class="detail-section">
        <h2 class="section-title">选中的元素 (${report.elements.length})</h2>
    `;

    report.elements.forEach((el, i) => {
      html += `
        <div class="element-card">
          <div class="element-card-header">
            <span class="element-tag">&lt;${el.tagName}&gt;</span>
            <span style="color:#8b8fa3;font-size:12px">#${i + 1}</span>
            ${el.id ? `<span style="color:#6c5ce7;font-size:12px">#${el.id}</span>` : ''}
          </div>
          <div class="element-info-grid">
            <div class="element-info-item"><span class="label">CSS选择器</span><span class="value">${el.selectorPath}</span></div>
            <div class="element-info-item"><span class="label">XPath</span><span class="value">${el.xpath}</span></div>
            <div class="element-info-item"><span class="label">位置</span><span class="value">x:${el.boundingBox.x} y:${el.boundingBox.y} w:${el.boundingBox.width} h:${el.boundingBox.height}</span></div>
            <div class="element-info-item"><span class="label">文本内容</span><span class="value">${el.textContent || '(空)'}</span></div>
            ${el.className ? `<div class="element-info-item"><span class="label">类名</span><span class="value">.${el.className}</span></div>` : ''}
            <div class="element-info-item"><span class="label">Display</span><span class="value">${el.styles.display}</span></div>
          </div>
          ${Object.keys(el.attributes).length > 0 ? `
            <details style="margin-top:8px">
              <summary style="cursor:pointer;font-size:12px;color:#6c5ce7">属性详情</summary>
              <pre style="font-size:11px;background:#f0f2f5;padding:8px;border-radius:4px;margin-top:4px;overflow-x:auto">${JSON.stringify(el.attributes, null, 2)}</pre>
            </details>
          ` : ''}
          ${el.innerHTML ? `
            <details style="margin-top:4px">
              <summary style="cursor:pointer;font-size:12px;color:#6c5ce7">HTML内容</summary>
              <pre style="font-size:11px;background:#f0f2f5;padding:8px;border-radius:4px;margin-top:4px;overflow-x:auto;max-height:200px">${escapeHtml(el.innerHTML.substring(0, 500))}</pre>
            </details>
          ` : ''}
        </div>
      `;
    });

    html += '</div>';

    // JSON原始数据
    html += `
      <div class="detail-section">
        <details>
          <summary style="cursor:pointer;font-size:14px;font-weight:600;color:#6c5ce7">原始JSON数据</summary>
          <pre class="json-viewer" style="margin-top:8px">${escapeHtml(JSON.stringify(report, null, 2))}</pre>
        </details>
      </div>
    `;

    detailContent.innerHTML = html;
  }

  // === 录制器报告详情 ===
  function showRecorderDetail(report) {
    currentReport = report;
    currentReportType = 'recorder';
    selectorPanel.classList.add('hidden');
    recorderPanel.classList.add('hidden');
    reportDetail.classList.remove('hidden');

    const duration = formatDuration(report.duration);

    let html = `
      <div class="detail-section">
        <h2 class="section-title">报告概览</h2>
        <div class="summary-grid">
          <div class="summary-card">
            <div class="summary-value">${duration}</div>
            <div class="summary-label">录制时长</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">${report.summary.totalLogs}</div>
            <div class="summary-label">日志条数</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">${report.summary.totalNetworkRequests}</div>
            <div class="summary-label">网络请求</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">${report.summary.totalDomMutations}</div>
            <div class="summary-label">DOM变化</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">${report.summary.totalUserActions}</div>
            <div class="summary-label">用户操作</div>
          </div>
          <div class="summary-card">
            <div class="summary-value ${report.summary.errorCount > 0 ? 'error' : 'success'}">${report.summary.errorCount}</div>
            <div class="summary-label">错误数</div>
          </div>
          <div class="summary-card">
            <div class="summary-value ${report.summary.failedRequests > 0 ? 'error' : 'success'}">${report.summary.failedRequests}</div>
            <div class="summary-label">失败请求</div>
          </div>
        </div>
      </div>
      <div class="detail-section">
        <h2 class="section-title">页面信息</h2>
        <div class="element-info-grid">
          <div class="element-info-item"><span class="label">URL</span><span class="value">${report.pageUrl}</span></div>
          <div class="element-info-item"><span class="label">标题</span><span class="value">${report.pageTitle}</span></div>
          <div class="element-info-item"><span class="label">User Agent</span><span class="value">${report.userAgent}</span></div>
          <div class="element-info-item"><span class="label">开始时间</span><span class="value">${new Date(report.startTime).toLocaleString('zh-CN')}</span></div>
        </div>
      </div>
    `;

    // 控制台日志
    if (report.logs.length > 0) {
      html += `
        <div class="detail-section">
          <h2 class="section-title">控制台日志 (${report.logs.length})</h2>
          <table class="data-table">
            <thead><tr><th>时间</th><th>级别</th><th>内容</th></tr></thead>
            <tbody>
      `;
      report.logs.forEach(log => {
        const time = new Date(log.timestamp).toLocaleTimeString('zh-CN');
        const badgeClass = `badge-${log.method || 'log'}`;
        const content = log.args ? log.args.join(' ') : (log.message || log.reason || '');
        html += `<tr><td>${time}</td><td><span class="badge ${badgeClass}">${log.method || log.type}</span></td><td class="code">${escapeHtml(content)}</td></tr>`;
      });
      html += '</tbody></table></div>';
    }

    // 网络请求
    if (report.networkRequests.length > 0) {
      html += `
        <div class="detail-section">
          <h2 class="section-title">网络请求 (${report.networkRequests.length})</h2>
          <table class="data-table">
            <thead><tr><th>时间</th><th>方法</th><th>URL</th><th>状态</th><th>耗时</th></tr></thead>
            <tbody>
      `;
      report.networkRequests.forEach(req => {
        const time = new Date(req.timestamp).toLocaleTimeString('zh-CN');
        const statusClass = req.status >= 400 || req.type === 'network-error' ? 'status-error' : req.status >= 300 ? 'status-redirect' : 'status-ok';
        const status = req.type === 'network-error' ? 'ERR' : req.status;
        const duration = req.duration ? `${req.duration}ms` : '-';
        html += `<tr><td>${time}</td><td>${req.method}</td><td class="code">${escapeHtml(req.url)}</td><td class="${statusClass}">${status}</td><td>${duration}</td></tr>`;
      });
      html += '</tbody></table></div>';
    }

    // 用户操作
    if (report.userActions.length > 0) {
      html += `
        <div class="detail-section">
          <h2 class="section-title">用户操作 (${report.userActions.length})</h2>
          <table class="data-table">
            <thead><tr><th>时间</th><th>事件</th><th>目标元素</th><th>详情</th></tr></thead>
            <tbody>
      `;
      report.userActions.forEach(action => {
        const time = new Date(action.timestamp).toLocaleTimeString('zh-CN');
        const target = `<${action.target.tag}>${action.target.id ? '#' + action.target.id : ''}`;
        let detail = '';
        if (action.key) detail = `Key: ${action.key.key}${action.key.ctrlKey ? ' (Ctrl)' : ''}${action.key.shiftKey ? ' (Shift)' : ''}`;
        else if (action.mousePosition) detail = `(${action.mousePosition.x}, ${action.mousePosition.y})`;
        html += `<tr><td>${time}</td><td><span class="badge badge-info">${action.type}</span></td><td class="code">${escapeHtml(target)}</td><td>${escapeHtml(detail)}</td></tr>`;
      });
      html += '</tbody></table></div>';
    }

    // DOM变化
    if (report.domMutations.length > 0) {
      html += `
        <div class="detail-section">
          <details>
            <summary style="cursor:pointer;font-size:16px;font-weight:600;color:#1a1a2e;margin-bottom:12px">DOM变化 (${report.domMutations.length})</summary>
            <table class="data-table">
              <thead><tr><th>时间</th><th>类型</th><th>目标</th><th>详情</th></tr></thead>
              <tbody>
      `;
      report.domMutations.slice(0, 200).forEach(mutation => {
        const time = new Date(mutation.timestamp).toLocaleTimeString('zh-CN');
        let detail = '';
        if (mutation.type === 'attributes') detail = `${mutation.attribute}: ${mutation.oldValue} → ${mutation.newValue}`;
        else if (mutation.type === 'childList') detail = `+${mutation.addedNodes} -${mutation.removedNodes}`;
        else if (mutation.type === 'characterData') detail = `${mutation.oldValue?.substring(0, 50)} → ${mutation.newValue?.substring(0, 50)}`;
        html += `<tr><td>${time}</td><td><span class="badge badge-debug">${mutation.type}</span></td><td class="code">${escapeHtml(mutation.target?.selector || '')}</td><td>${escapeHtml(detail)}</td></tr>`;
      });
      html += '</tbody></table>';
      if (report.domMutations.length > 200) {
        html += `<p style="text-align:center;color:#8b8fa3;padding:10px">仅显示前200条，共${report.domMutations.length}条</p>`;
      }
      html += '</details></div>';
    }

    // 时间线
    if (report.timeline && report.timeline.length > 0) {
      html += `
        <div class="detail-section">
          <details>
            <summary style="cursor:pointer;font-size:16px;font-weight:600;color:#1a1a2e;margin-bottom:12px">完整时间线 (${report.timeline.length})</summary>
            <div class="timeline">
      `;
      report.timeline.slice(0, 500).forEach(event => {
        const time = new Date(event.timestamp).toLocaleTimeString('zh-CN');
        let content = '';
        if (event.category === 'log') content = `[${event.method}] ${(event.args || [event.message]).join(' ').substring(0, 200)}`;
        else if (event.category === 'network') content = `${event.method} ${event.url} → ${event.status || 'ERR'}`;
        else if (event.category === 'action') content = `${event.type} on <${event.target?.tag || '?'}>`;
        html += `<div class="timeline-item ${event.category}"><div class="timeline-time">${time}</div><div class="timeline-content">${escapeHtml(content)}</div></div>`;
      });
      html += '</div>';
      if (report.timeline.length > 500) {
        html += `<p style="text-align:center;color:#8b8fa3;padding:10px">仅显示前500条</p>`;
      }
      html += '</details></div>';
    }

    // JSON原始数据
    html += `
      <div class="detail-section">
        <details>
          <summary style="cursor:pointer;font-size:14px;font-weight:600;color:#6c5ce7">原始JSON数据</summary>
          <pre class="json-viewer" style="margin-top:8px">${escapeHtml(JSON.stringify(report, null, 2))}</pre>
        </details>
      </div>
    `;

    detailContent.innerHTML = html;
  }

  // === 工具函数 ===
  function formatDuration(ms) {
    if (!ms) return '0s';
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // === 初始化 ===
  loadReports();
});
