/**
 * Qoder Test Helper - Content Script
 * 悬浮面板 + 多问题累积 + 元素选择 + 日志采集 + MD报告生成
 */
(() => {
  if (document.getElementById('qoder-floating-panel')) return;

  // ==================== 问题分类：按“修改级别/处理深度”分类（供AI快速判断） ====================
  const ISSUE_LEVELS = {
    'L1_frontend': { label: '🎨 前端修改',      hint: '仅前端UI/样式/交互调整，不涉及后端接口与业务流程变更' },
    'L2_backend':  { label: '🔧 后端/业务流程',  hint: '涉及后端接口、业务逻辑或数据流程的变更' },
    'L3_module':   { label: '🏗️ 模块重做',      hint: '问题根源在架构层面，需整个模块重构或大范围整改' },
    'L4_feature':  { label: '✨ 新需求',         hint: '现有能力无法满足，需要新增功能或能力扩展' }
  };

  // ==================== 状态管理 ====================
  let panelVisible = false;
  let panelMinimized = false;
  let selectorMode = false;
  let hoveredElement = null;
  let selectedElements = []; // { el, info }
  let highlightOverlays = [];
  let hoverOverlay = null;
  let issues = []; // 累积的问题列表: { id, type:'element'|'flow', category, description, pageUrl, elements, logs, networkRequests, timestamp }
  let issueIdCounter = 0;
  let onSelectionChanged = null;
  let issueLogStart = null; // 当前问题采集起始时的日志快照位置
  let workflowMode = null; // 'element' | 'flow' | null

  // 日志采集
  let recorderData = { startTime: Date.now(), logs: [], networkRequests: [], domMutations: [], userActions: [] };
  let mutationObserver = null;
  let isRecording = false;

  // ==================== 工具函数 ====================

  function getXPath(el) {
    if (!el) return '';
    if (el.id) return `//*[@id="${el.id}"]`;
    const path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 0;
      let sibling = current.previousSibling;
      while (sibling) { if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === current.tagName) index++; sibling = sibling.previousSibling; }
      path.unshift(`${current.tagName.toLowerCase()}[${index + 1}]`);
      current = current.parentNode;
    }
    return '/' + path.join('/');
  }

  function extractElementInfo(el) {
    // 子元素结构预览（前 5 个直接子元素，帮助 AI 理解外层容器内部结构）
    const childPreview = [];
    try {
      for (let i = 0; i < Math.min(el.children?.length || 0, 5); i++) {
        const c = el.children[i];
        const cText = (c.textContent?.trim().substring(0, 30)) || '';
        childPreview.push({
          tag: c.tagName.toLowerCase(),
          cls: (c.className && typeof c.className === 'string') ? c.className.trim().split(/\s+/).slice(0, 3).join(' ') : '',
          id: c.id || '',
          text: cText
        });
      }
    } catch (e) { /* 忽略 */ }
    return {
      xpath: getXPath(el),
      tag: el.tagName.toLowerCase(),
      cls: (el.className && typeof el.className === 'string') ? el.className.trim().split(/\s+/).slice(0, 5).join(' ') : '',
      id: el.id || '',
      text: (el.textContent?.trim().substring(0, 120)) || '',
      children: childPreview,
      pageUrl: window.location.href
    };
  }

  // ==================== 高亮系统 ====================

  function showHoverHighlight(el) {
    removeHoverHighlight();
    const rect = el.getBoundingClientRect();
    hoverOverlay = document.createElement('div');
    hoverOverlay.className = 'qoder-hover-overlay';
    hoverOverlay.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:rgba(108,92,231,0.12);border:2px solid #6c5ce7;border-radius:3px;pointer-events:none;z-index:2147483646;`;
    const label = document.createElement('div');
    label.textContent = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '');
    label.style.cssText = `position:absolute;top:-22px;left:0;background:#6c5ce7;color:#fff;font-size:11px;padding:2px 6px;border-radius:3px;white-space:nowrap;font-family:monospace;`;
    hoverOverlay.appendChild(label);
    document.body.appendChild(hoverOverlay);
  }

  function removeHoverHighlight() { if (hoverOverlay) { hoverOverlay.remove(); hoverOverlay = null; } }

  function addSelectedHighlight(el) {
    const rect = el.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.className = 'qoder-selected-overlay';
    overlay.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:rgba(81,207,102,0.15);border:2px solid #51cf66;border-radius:3px;pointer-events:none;z-index:2147483645;`;
    const badge = document.createElement('div');
    badge.textContent = `#${selectedElements.length}`;
    badge.style.cssText = `position:absolute;top:-20px;right:0;background:#51cf66;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;font-family:monospace;font-weight:bold;`;
    overlay.appendChild(badge);
    document.body.appendChild(overlay);
    highlightOverlays.push(overlay);
  }

  function clearAllHighlights() {
    highlightOverlays.forEach(o => o.remove());
    highlightOverlays = [];
    removeHoverHighlight();
    document.querySelectorAll('[data-qoder-selected]').forEach(el => el.removeAttribute('data-qoder-selected'));
  }

  // ==================== 元素选择器 ====================

  function isPanelElement(el) {
    return el && (el.closest('#qoder-floating-panel') || el.closest('.qoder-hover-overlay') || el.closest('.qoder-selected-overlay'));
  }

  function onSelectorMouseMove(e) {
    if (isPanelElement(e.target)) return;
    hoveredElement = e.target;
    showHoverHighlight(e.target);
  }

  function onSelectorClick(e) {
    if (isPanelElement(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.target;
    selectedElements.push({ el, info: extractElementInfo(el) });
    el.setAttribute('data-qoder-selected', 'true');
    addSelectedHighlight(el);
    removeHoverHighlight();
    if (onSelectionChanged) onSelectionChanged();
  }

  function enterSelectorMode() {
    selectorMode = true;
    document.addEventListener('mousemove', onSelectorMouseMove, true);
    document.addEventListener('click', onSelectorClick, true);
    document.body.classList.add('qoder-selector-active');
  }

  function exitSelectorMode() {
    selectorMode = false;
    document.removeEventListener('mousemove', onSelectorMouseMove, true);
    document.removeEventListener('click', onSelectorClick, true);
    document.body.classList.remove('qoder-selector-active');
    removeHoverHighlight();
  }

  function removeSelectedElement(index) {
    const item = selectedElements[index];
    if (item) {
      item.el.removeAttribute('data-qoder-selected');
      if (highlightOverlays[index]) { highlightOverlays[index].remove(); highlightOverlays.splice(index, 1); }
      selectedElements.splice(index, 1);
      highlightOverlays.forEach((o, i) => { const b = o.querySelector('div'); if (b) b.textContent = `#${i + 1}`; });
      if (onSelectionChanged) onSelectionChanged();
    }
  }

  // ==================== 日志采集器 ====================

  function injectLogInterceptor() {
    if (document.getElementById('qoder-log-interceptor')) return;
    const script = document.createElement('script');
    script.id = 'qoder-log-interceptor';
    script.textContent = `
      (function() {
        const methods = ['log','warn','error','info','debug','trace'];
        const originals = {};
        methods.forEach(method => {
          originals[method] = console[method];
          console[method] = function(...args) {
            const data = { type:'console', method, args: args.map(a => { try { if(a instanceof Error) return {error:a.message,stack:a.stack}; if(typeof a==='object') return JSON.stringify(a).substring(0,1000); return String(a).substring(0,500); } catch(e) { return String(a); } }), timestamp:Date.now(), url:window.location.href };
            window.postMessage({ source:'qoder-test-helper', data }, '*');
            originals[method].apply(console, args);
          };
        });
        const origOnError = window.onerror;
        window.onerror = function(message, source, lineno, colno, error) {
          window.postMessage({ source:'qoder-test-helper', data:{ type:'error', message:String(message), source, lineno, colno, stack:error?.stack||null, timestamp:Date.now(), url:window.location.href }}, '*');
          if(origOnError) return origOnError.apply(this, arguments);
        };
        window.addEventListener('unhandledrejection', (event) => {
          window.postMessage({ source:'qoder-test-helper', data:{ type:'unhandledrejection', reason:event.reason?.message||String(event.reason), stack:event.reason?.stack||null, timestamp:Date.now(), url:window.location.href }}, '*');
        });
        const origFetch = window.fetch;
        window.fetch = function(...args) {
          const st=Date.now(), url=typeof args[0]==='string'?args[0]:args[0]?.url||'unknown', opts=args[1]||{};
          return origFetch.apply(this,args).then(resp=>{
            window.postMessage({source:'qoder-test-helper',data:{type:'network',method:opts.method||'GET',url,status:resp.status,duration:Date.now()-st,timestamp:Date.now()}},'*');
            return resp;
          }).catch(err=>{
            window.postMessage({source:'qoder-test-helper',data:{type:'network-error',method:opts.method||'GET',url,error:err.message,duration:Date.now()-st,timestamp:Date.now()}},'*');
            throw err;
          });
        };
        const origOpen=XMLHttpRequest.prototype.open, origSend=XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open=function(method,url){this._qd={method,url,st:null};return origOpen.apply(this,arguments);};
        XMLHttpRequest.prototype.send=function(){if(this._qd)this._qd.st=Date.now();this.addEventListener('loadend',()=>{if(this._qd){window.postMessage({source:'qoder-test-helper',data:{type:'network',method:this._qd.method,url:this._qd.url,status:this.status,duration:Date.now()-this._qd.st,timestamp:Date.now()}},'*');}});return origSend.apply(this,arguments);};
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  function onWindowMessage(e) {
    if (e.data?.source !== 'qoder-test-helper') return;
    const d = e.data.data;
    if (!d) return;
    if (['console','error','unhandledrejection'].includes(d.type)) recorderData.logs.push(d);
    else if (['network','network-error'].includes(d.type)) recorderData.networkRequests.push(d);
    if (recorderData.logs.length > 2000) recorderData.logs = recorderData.logs.slice(-1500);
    if (recorderData.networkRequests.length > 1000) recorderData.networkRequests = recorderData.networkRequests.slice(-800);
  }

  function startMutationObserver() {
    if (mutationObserver) return;
    mutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const entry = { type: m.type, timestamp: Date.now() };
        if (m.type === 'attributes') entry.attribute = m.attributeName;
        else if (m.type === 'childList') { entry.added = m.addedNodes.length; entry.removed = m.removedNodes.length; }
        recorderData.domMutations.push(entry);
      }
      if (recorderData.domMutations.length > 1000) recorderData.domMutations = recorderData.domMutations.slice(-800);
    });
    mutationObserver.observe(document.body, { childList: true, attributes: true, characterData: true, subtree: true });
  }

  function recordUserAction(e) {
    if (isPanelElement(e.target)) return; // 不记录对工具面板自身的操作
    recorderData.userActions.push({
      type: e.type, timestamp: Date.now(),
      target: { tag: e.target.tagName?.toLowerCase(), id: e.target.id || null, selector: getXPath(e.target), text: (e.target.textContent?.trim().substring(0, 40)) || '' },
      key: e instanceof KeyboardEvent ? { key: e.key } : null,
      mouse: e instanceof MouseEvent ? { x: e.clientX, y: e.clientY } : null
    });
    if (recorderData.userActions.length > 1000) recorderData.userActions = recorderData.userActions.slice(-800);
  }

  const trackedEvents = ['click','dblclick','input','change','keydown','keyup','focus','blur','submit'];
  let actionListenersAdded = false;
  function startActionRecording() { if (actionListenersAdded) return; trackedEvents.forEach(t => document.addEventListener(t, recordUserAction, true)); actionListenersAdded = true; }
  function stopActionRecording() { trackedEvents.forEach(t => document.removeEventListener(t, recordUserAction, true)); actionListenersAdded = false; }

  function startRecorder() {
    if (isRecording) return;
    isRecording = true; recorderData.startTime = Date.now();
    window.addEventListener('message', onWindowMessage);
    startMutationObserver(); startActionRecording();
  }
  function clearRecorderData() { recorderData = { startTime: Date.now(), logs: [], networkRequests: [], domMutations: [], userActions: [] }; }

  // ==================== MD 报告生成（多问题合并） ====================

  function generateCombinedReportMD() {
    if (issues.length === 0) return '';
    const now = new Date();
    const dateStr = now.toISOString().replace('T', ' ').substring(0, 19);

    // 按页面URL分组
    const pageGroups = new Map();
    issues.forEach(issue => {
      const url = issue.pageUrl || 'unknown';
      if (!pageGroups.has(url)) pageGroups.set(url, []);
      pageGroups.get(url).push(issue);
    });

    // 报告头
    let md = `# 🐛 测试问题报告\n\n`;
    md += `**生成时间:** ${dateStr}  \n`;
    md += `**问题总数:** ${issues.length}  \n`;
    md += `**涉及页面:** ${pageGroups.size}\n\n`;
    md += `---\n\n`;

    // 全局计数器
    let globalIdx = 0;

    // 按页面分组输出
    pageGroups.forEach((pageIssues, pageUrl) => {
      // 尝试提取路径部分（去掉协议和域名）
      let pageLabel = pageUrl;
      try { const u = new URL(pageUrl); pageLabel = u.pathname + u.search; } catch(e) {}
      md += `## 📄 ${pageLabel}\n\n`;
      md += `> ${pageUrl}\n\n`;

      pageIssues.forEach((issue) => {
        globalIdx++;
        const catLabel = issue.category ? ISSUE_LEVELS[issue.category]?.label || '' : '';
        const typeTag = issue.type === 'flow' ? '`流程` ' : '';
        md += `### ${globalIdx}. ${typeTag}${issue.description}${catLabel ? ` _${catLabel}_` : ''}\n\n`;

        // 元素问题：显示 XPath 列表 + 元素上下文（文本/类名/id/子元素预览），避免 AI 对外层容器失焦
        if (issue.type === 'element' && issue.elements.length > 0) {
          md += `**元素:**\n`;
          issue.elements.forEach(el => {
            md += `- xpath: \`${el.xpath}\`\n`;
            const cls = el.cls ? `.${el.cls.split(' ').join('.')}` : '';
            const id = el.id ? `#${el.id}` : '';
            if (cls || id) md += `  - 选择器: \`<${el.tag || '?'}>${id}${cls}\`\n`;
            if (el.text) md += `  - 文本: "${el.text.substring(0, 100)}"\n`;
            if (Array.isArray(el.children) && el.children.length > 0) {
              md += `  - 子元素预览:\n`;
              el.children.forEach(c => {
                const cCls = c.cls ? `.${c.cls.split(' ').join('.')}` : '';
                const cId = c.id ? `#${c.id}` : '';
                const cTxt = c.text ? ` "${c.text}"` : '';
                md += `    - \`<${c.tag}>${cId}${cCls}\`${cTxt}\n`;
              });
            }
          });
          md += `\n`;
        }

        // 流程问题：显示操作序列（点击顺序），即使无日志也能还原用户行为
        if (issue.type === 'flow' && (issue.actions || []).length > 0) {
          md += `**操作序列** (${issue.actions.length}步):\n\n`;
          issue.actions.forEach((a, i) => {
            const tgt = a.target || {};
            const label = tgt.text ? `"${tgt.text}"` : (tgt.id ? `#${tgt.id}` : `<${tgt.tag || '?'}>`);
            md += `${i + 1}. \`${a.type}\` ${label}${tgt.selector ? ` — \`${tgt.selector}\`` : ''}\n`;
          });
          md += `\n`;
        }

        // 该问题的日志
        const iLogs = issue.logs || [];
        const iNets = issue.networkRequests || [];
        const iErrors = iLogs.filter(l => l.type === 'error' || l.type === 'unhandledrejection');
        const iFailed = iNets.filter(r => r.type === 'network-error' || r.status >= 400);
        if (iLogs.length > 0 || iNets.length > 0) {
          // 流程问题：日志是主要内容，直接展开；元素问题：折叠显示
          if (issue.type === 'flow') {
            md += `**操作日志** (${iLogs.length}条/${iErrors.length}错误, ${iNets.length}请求/${iFailed.length}失败):\n\n`;
            if (iLogs.length > 0) {
              md += `| 时间 | 级别 | 内容 |\n|---|---|---|\n`;
              iLogs.slice(-30).forEach(l => {
                const t = new Date(l.timestamp).toLocaleTimeString('zh-CN');
                const c = l.args ? l.args.join(' ').substring(0, 100) : (l.message || l.reason || '');
                md += `| ${t} | ${l.method || l.type} | \`${c}\` |\n`;
              });
              md += `\n`;
            }
            if (iNets.length > 0) {
              md += `| 时间 | 方法 | URL | 状态 | 耗时 |\n|---|---|---|---|---|\n`;
              iNets.slice(-20).forEach(r => {
                const t = new Date(r.timestamp).toLocaleTimeString('zh-CN');
                md += `| ${t} | ${r.method} | \`${r.url.substring(0, 60)}\` | ${r.type === 'network-error' ? 'ERR' : r.status} | ${r.duration || '-'}ms |\n`;
              });
              md += `\n`;
            }
          } else {
            md += `<details><summary>📊 日志 (${iLogs.length}条/${iErrors.length}错误, ${iNets.length}请求/${iFailed.length}失败)</summary>\n\n`;
            if (iLogs.length > 0) {
              md += `| 时间 | 级别 | 内容 |\n|---|---|---|\n`;
              iLogs.slice(-20).forEach(l => {
                const t = new Date(l.timestamp).toLocaleTimeString('zh-CN');
                const c = l.args ? l.args.join(' ').substring(0, 100) : (l.message || l.reason || '');
                md += `| ${t} | ${l.method || l.type} | \`${c}\` |\n`;
              });
              md += `\n`;
            }
            if (iNets.length > 0) {
              md += `| 时间 | 方法 | URL | 状态 | 耗时 |\n|---|---|---|---|---|\n`;
              iNets.slice(-15).forEach(r => {
                const t = new Date(r.timestamp).toLocaleTimeString('zh-CN');
                md += `| ${t} | ${r.method} | \`${r.url.substring(0, 60)}\` | ${r.type === 'network-error' ? 'ERR' : r.status} | ${r.duration || '-'}ms |\n`;
              });
              md += `\n`;
            }
            md += `</details>\n\n`;
          }
        }
      });
      md += `---\n\n`;
    });

    // AI 提示词 —— 不重复问题详情，直接引用报告正文
    const totalErrors = issues.reduce((s, iss) => s + (iss.logs || []).filter(l => l.type === 'error' || l.type === 'unhandledrejection').length, 0);
    const totalFailed = issues.reduce((s, iss) => s + (iss.networkRequests || []).filter(r => r.type === 'network-error' || r.status >= 400).length, 0);

    const aiPrompt = `你是一位资深全栈架构师兼产品质量官。请对上方报告中的每个问题进行**研究式分析**，严格遵循下面的方法论。

注意：每个问题的描述、页面路径、元素XPath及日志已在报告正文中，无需重复描述问题。

## ⛔ 铁律（防幻觉，不可违反）

1. **先事实，后结论**：严禁未查真实代码就凭经验臆测。先自己判断需要哪些资料 → 主动去代码库检索/阅读/追踪 → 资料齐全后再下结论。
2. **结论可追溯**：每个判断都要能指向具体文件/代码行/页面元素，禁止凭印象。资料不足时，明确说出还缺什么、要看哪些文件，而不是编造。
3. **用户反馈优先**：用户指出的方向（如“宽度不够”“显示不对”）必须先按此方向排查，不得以“代码逻辑正确”为由反驳。

## 一、按【修改级别】决定研究深度与分析法

报告中每个问题都标注了修改级别，据此选择分析路线：

- **🎨 前端修改**：若为纯UI/布局/样式 → 走【第五节·UI双维评定】；若涉及前端逻辑/交互 → 走【第三节·分析链路】
- **🔧 后端/业务流程**：走【第三节·分析链路】，必须追踪 API→Service→数据模型 全链路 + 业务流程影响
- **🏗️ 模块重做**：必须做整个模块纵向链路 + 横向影响性分析（第二节），给架构级整改
- **✨ 新需求**：先做概念设计（业务流程、模块边界与职责、对外接口、依赖方向），再评估现有架构承载力与集成点

> 对**被反复提出问题**的模块（同一模块多个问题），要**升维思考**：不头痛医头，追问是不是架构/设计层面的系统性缺陷。

## 二、变更前三思·影响分析（改代码前必做）

1. **资料收集**（收集不全不下结论）：技术架构现状（技术栈/分层/模块边界）、业务流程、源码路径与现有写法、组件定位/触发链路/数据来源/组件关系/样式体系/业务逻辑/历史背景
2. **拓扑完整度核验**：先 grep 改动目标的类名/方法名/接口名，找全**真实调用点**，确认“依赖谁/被谁依赖”
3. **波及面评估**：沿被依赖方向定位受影响的模块**及其功能细项**，列出改动会不会改坏下游

## 三、统一分析链路（逐环节走完，禁止跳步）

\`\`\`
【组件树定位】→ 找到具体文件
【数据流追踪】API → Service → State → Props → Component
【交互链路追踪】用户操作 → 事件处理 → 状态变更 → 视图更新 → 副作用
【依赖关系分析】该组件依赖了哪些子组件 / 工具函数 / Hooks / Context
【问题根因定位】在以上链路中究竟哪个环节出了问题（给出确切文件与代码位置）
【修改方案设计】基于完整链路理解给出方案
\`\`\`

## 四、同类问题全排查（泛化，禁止只修一个点）

发现一个问题时，先判断它是**孤立点**还是**模式**：
- 若属模式（相同函数调用/相同反模式/相同缺失校验/同类入口缺失）→ grep 横向排查**所有同类对象**，列全待修点，一次性整体修复，禁止“发现模式却只修一个”

## 五、UI/布局问题：宏观 + 微观双维评定 + 量化尺寸推理

**宏观架构**：布局骨架是否匹配任务类型（数据密集→表格/仪表盘、分步→向导、多对象→左右分栏、轻量→弹窗）；功能区职责是否单一；信息架构无巨型/空壳页
**微观元素**：归属与主体（操作的业务对象是否明确）、位置与聚合、一致性与冲突（控件类型与语义匹配，如二元开关用Switch）、反馈与容错（空/错/加载态）、尺寸与层叠
**量化尺寸推理**：不靠“看着挤”，必须从源码+数据模型算出具体数字（如“容器宽720 - 固定元素 = 剩余，是否够”、“8列共90，溢出”）

## 六、修改方案要求

- 定位到**具体文件、函数、代码行**，说明怎么改、为什么这样改
- **至少给出多方案对比**：如“治标局部补丁 vs 治本重构公共逻辑”，逐方案标明代价/风险
- **涉及大整改/模块重做**：不许只给前端补丁，必须给：①架构整改方案（范围/风险/迁移路径）②**逐一列出被牵连的其他模块及其具体修改内容**（哪个文件、改什么）③临时缓解方案（如需）④长期演进
- 每项修改标注优先级：**P0**阻断/**P1**应改/**P2**建议

## 七、输出格式（每个问题）

1. **需要的资料 & 已查阅的文件**（列出实际研究了哪些）
2. **根因**（一句话，指向确切代码位置/页面元素）
3. **分析链路还原**（按第三节；UI问题附宏观+微观+量化尺寸）
4. **影响范围**（波及模块 + 同类待修点清单）
5. **修改方案**（多方案对比 + 跨模块改动清单 + P0/P1/P2）
6. **验证方法**

## 报告统计

- 发现时间: ${dateStr} | 问题总数: ${issues.length} | 错误: ${totalErrors} | 失败请求: ${totalFailed}

请对每个问题分别给出研究式分析报告。`;

    md += `## 🤖 AI 分析提示词\n\n> 将以下提示词复制到AI对话中，获取深度分析报告：\n\n\`\`\`\n${aiPrompt}\n\`\`\`\n\n---\n\n*由 Qoder Test Helper 自动生成*\n`;
    return md;
  }

  function downloadMD(md) {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `test-report-${Date.now()}.md`; a.click();
    URL.revokeObjectURL(url);
  }

  // 简易 ZIP 打包（无需外部库）
  function createZipBlob(fileName, content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const fileNameBytes = encoder.encode(fileName);

    // CRC32 计算
    const crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[i] = c;
    }
    function crc32(buf) {
      let crc = 0xFFFFFFFF;
      for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    const crc = crc32(data);
    const size = data.length;

    // Local file header
    const localHeader = new Uint8Array(30 + fileNameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);  // signature
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0, true);            // flags
    lv.setUint16(8, 0, true);            // compression (store)
    lv.setUint16(10, 0, true);           // mod time
    lv.setUint16(12, 0, true);           // mod date
    lv.setUint32(14, crc, true);         // crc32
    lv.setUint32(18, size, true);        // compressed size
    lv.setUint32(22, size, true);        // uncompressed size
    lv.setUint16(26, fileNameBytes.length, true); // filename length
    lv.setUint16(28, 0, true);           // extra field length
    localHeader.set(fileNameBytes, 30);

    // Central directory
    const centralDir = new Uint8Array(46 + fileNameBytes.length);
    const cv = new DataView(centralDir.buffer);
    cv.setUint32(0, 0x02014b50, true);   // signature
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0, true);            // flags
    cv.setUint16(10, 0, true);           // compression
    cv.setUint16(12, 0, true);           // mod time
    cv.setUint16(14, 0, true);           // mod date
    cv.setUint32(16, crc, true);         // crc32
    cv.setUint32(20, size, true);        // compressed size
    cv.setUint32(24, size, true);        // uncompressed size
    cv.setUint16(28, fileNameBytes.length, true); // filename length
    cv.setUint16(30, 0, true);           // extra length
    cv.setUint16(32, 0, true);           // comment length
    cv.setUint16(34, 0, true);           // disk number
    cv.setUint16(36, 0, true);           // internal attrs
    cv.setUint32(38, 0, true);           // external attrs
    cv.setUint32(42, 0, true);           // local header offset
    centralDir.set(fileNameBytes, 46);

    // End of central directory
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);   // signature
    ev.setUint16(4, 0, true);            // disk number
    ev.setUint16(6, 0, true);            // disk with central dir
    ev.setUint16(8, 1, true);            // entries on disk
    ev.setUint16(10, 1, true);           // total entries
    ev.setUint32(12, centralDir.length, true);  // central dir size
    ev.setUint32(16, localHeader.length + size, true); // offset
    ev.setUint16(20, 0, true);           // comment length

    // 合并所有部分
    const zipData = new Uint8Array(localHeader.length + size + centralDir.length + eocd.length);
    let offset = 0;
    zipData.set(localHeader, offset); offset += localHeader.length;
    zipData.set(data, offset); offset += size;
    zipData.set(centralDir, offset); offset += centralDir.length;
    zipData.set(eocd, offset);

    return new Blob([zipData], { type: 'application/zip' });
  }

  function downloadZip(md) {
    const fileName = `test-report-${Date.now()}.md`;
    const blob = createZipBlob(fileName, md);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `test-report-${Date.now()}.zip`; a.click();
    URL.revokeObjectURL(url);
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => showToast('已复制到剪贴板')).catch(() => {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); showToast('已复制到剪贴板');
    });
  }

  // ==================== 悬浮面板 UI ====================

  let panel, panelBody, panelTextarea, selectedListEl;
  let lastGeneratedMD = '';

  function createFloatingPanel() {
    panel = document.createElement('div');
    panel.id = 'qoder-floating-panel';
    panel.innerHTML = `
      <div class="qoder-panel-header">
        <div class="qoder-panel-title"><span class="qoder-panel-logo">🛠</span><span>Qoder Test Helper</span></div>
        <div class="qoder-panel-actions">
          <button class="qoder-btn-icon" id="qoder-btn-clear-all" title="清空所有问题">🗑</button>
          <button class="qoder-btn-icon" id="qoder-btn-minimize" title="最小化">─</button>
          <button class="qoder-btn-icon" id="qoder-btn-close" title="隐藏面板">✕</button>
        </div>
      </div>
      <div class="qoder-panel-body" id="qoder-panel-body">
        <!-- 问题列表区 -->
        <div class="qoder-section" id="qoder-issues-section">
          <div class="qoder-section-title">📋 问题列表 <span class="qoder-issue-count" id="qoder-issue-count">0</span></div>
          <div class="qoder-issue-list" id="qoder-issue-list">
            <div class="qoder-empty-hint" id="qoder-issues-empty">还没有问题，点击「新增元素问题」或「新增流程问题」添加</div>
          </div>
          <div class="qoder-btn-group" style="margin-top:8px">
            <button class="qoder-btn qoder-btn-primary" id="qoder-btn-new-element" style="flex:1">🎯 元素问题</button>
            <button class="qoder-btn qoder-btn-secondary" id="qoder-btn-new-flow" style="flex:1">🔄 流程问题</button>
          </div>
          <button class="qoder-btn qoder-btn-dark qoder-btn-full" id="qoder-btn-gen-report" style="margin-top:6px" disabled>📋 生成测试报告到粘贴板</button>
        </div>

        <!-- 新增问题工作流 -->
        <div class="qoder-section qoder-hidden" id="qoder-workflow-section">
          <div class="qoder-workflow-header">
            <span class="qoder-step-badge" id="qoder-step-badge">步骤 1</span>
            <span class="qoder-step-text" id="qoder-step-text">选择问题元素</span>
          </div>

          <!-- 选择元素 (元素问题工作流) -->
          <div class="qoder-workflow-panel" id="qoder-wf-selecting">
            <p class="qoder-hint">🎯 点击页面中的元素来选择（可多选）</p>
            <div class="qoder-selected-list" id="qoder-selected-list"><div class="qoder-empty-hint">暂未选择元素</div></div>
            <button class="qoder-btn qoder-btn-primary qoder-btn-full" id="qoder-btn-next-step" disabled>下一步 →</button>
          </div>

          <!-- 流程录制 (流程问题工作流) -->
          <div class="qoder-workflow-panel qoder-hidden" id="qoder-wf-flow">
            <p class="qoder-hint">🔄 正在录制你的操作，请在页面上进行操作...</p>
            <div class="qoder-flow-status">
              <span class="qoder-flow-dot"></span>
              <span>录制中</span>
              <span class="qoder-flow-stats" id="qoder-flow-stats">0条日志 | 0次操作</span>
            </div>
            <button class="qoder-btn qoder-btn-primary qoder-btn-full" id="qoder-btn-flow-next">下一步 →</button>
          </div>

          <!-- 分类 + 描述 -->
          <div class="qoder-workflow-panel qoder-hidden" id="qoder-wf-editing">
            <label class="qoder-label">修改级别 <span class="qoder-hint-inline">(帮助AI判断处理深度，可选)</span></label>
            <!-- 修改级别分类 -->
            <div class="qoder-category-grid" id="qoder-cat-grid">
              ${Object.entries(ISSUE_LEVELS).map(([k, v]) => `<button class="qoder-cat-btn" data-cat="${k}" title="${v.hint}">${v.label}</button>`).join('')}
            </div>
            <label class="qoder-label" style="margin-top:10px">问题描述</label>
            <textarea class="qoder-textarea" id="qoder-problem-desc" placeholder="请描述你遇到的问题..." rows="3"></textarea>
            <button class="qoder-btn qoder-btn-primary qoder-btn-full" id="qoder-btn-save-issue">💾 保存问题</button>
            <button class="qoder-btn qoder-btn-outline qoder-btn-full" id="qoder-btn-back-select" style="margin-top:6px">← 返回</button>
          </div>
        </div>

        <!-- 报告操作区 -->
        <div class="qoder-section qoder-hidden" id="qoder-report-actions">
          <div class="qoder-section-title">📄 报告已生成</div>
          <div class="qoder-md-actions">
            <button class="qoder-btn qoder-btn-sm qoder-btn-primary" id="qoder-btn-copy-md">复制MD</button>
            <button class="qoder-btn qoder-btn-sm" id="qoder-btn-download-md">下载MD</button>
            <button class="qoder-btn qoder-btn-sm" id="qoder-btn-download-zip">下载ZIP</button>
            <button class="qoder-btn qoder-btn-sm" id="qoder-btn-copy-prompt">复制AI提示词</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    panel.style.display = 'none';

    panelBody = document.getElementById('qoder-panel-body');
    selectedListEl = document.getElementById('qoder-selected-list');
    panelTextarea = document.getElementById('qoder-problem-desc');

    const wfSection = document.getElementById('qoder-workflow-section');
    const wfSelecting = document.getElementById('qoder-wf-selecting');
    const wfFlow = document.getElementById('qoder-wf-flow');
    const wfEditing = document.getElementById('qoder-wf-editing');
    const stepBadge = document.getElementById('qoder-step-badge');
    const stepText = document.getElementById('qoder-step-text');
    const btnNextStep = document.getElementById('qoder-btn-next-step');
    const btnFlowNext = document.getElementById('qoder-btn-flow-next');
    const btnSaveIssue = document.getElementById('qoder-btn-save-issue');
    const btnBackSelect = document.getElementById('qoder-btn-back-select');
    const btnGenReport = document.getElementById('qoder-btn-gen-report');
    const issueListEl = document.getElementById('qoder-issue-list');
    const issueCountEl = document.getElementById('qoder-issue-count');
    const issuesEmpty = document.getElementById('qoder-issues-empty');
    const reportActions = document.getElementById('qoder-report-actions');
    const btnCopyMD = document.getElementById('qoder-btn-copy-md');
    const btnDownloadMD = document.getElementById('qoder-btn-download-md');
    const btnDownloadZip = document.getElementById('qoder-btn-download-zip');
    const btnCopyPrompt = document.getElementById('qoder-btn-copy-prompt');
    const catGrid = document.getElementById('qoder-cat-grid');
    let selectedCategory = null;

    function showWf(name) {
      wfSection.classList.remove('qoder-hidden');
      wfSelecting.classList.toggle('qoder-hidden', name !== 'selecting');
      wfFlow.classList.toggle('qoder-hidden', name !== 'flow');
      wfEditing.classList.toggle('qoder-hidden', name !== 'editing');
      if (name === 'selecting') { stepBadge.textContent = '步骤 1'; stepText.textContent = '选择问题元素'; }
      else if (name === 'flow') { stepBadge.textContent = '步骤 1'; stepText.textContent = '录制操作流程'; }
      else if (name === 'editing') { stepBadge.textContent = '步骤 2'; stepText.textContent = '分类 & 描述问题'; }
    }
    function hideWf() { wfSection.classList.add('qoder-hidden'); }

    function updateIssueList() {
      issueCountEl.textContent = issues.length;
      btnGenReport.disabled = issues.length === 0;
      issuesEmpty.style.display = issues.length === 0 ? 'block' : 'none';
      // 渲染问题卡片
      const cards = issueListEl.querySelectorAll('.qoder-issue-card');
      cards.forEach(c => c.remove());
      issues.forEach((issue, i) => {
        const cat = issue.category ? ISSUE_LEVELS[issue.category]?.label || '' : '';
        const typeBadge = issue.type === 'flow' ? '<span class="qoder-issue-type qoder-type-flow">流程</span>' : '<span class="qoder-issue-type qoder-type-elem">元素</span>';
        const elemInfo = issue.type === 'flow'
          ? `<span class="qoder-issue-elems">${(issue.actions||[]).length}步 / ${(issue.logs||[]).length}日志</span>`
          : `<span class="qoder-issue-elems">${issue.elements.length}个元素</span>`;
        const card = document.createElement('div');
        card.className = 'qoder-issue-card';
        card.innerHTML = `
          <div class="qoder-issue-card-top">
            <span class="qoder-issue-num">#${i + 1}</span>
            ${typeBadge}
            ${cat ? `<span class="qoder-issue-cat">${cat}</span>` : ''}
            ${elemInfo}
            <button class="qoder-btn-remove" data-idx="${i}" title="删除">✕</button>
          </div>
          <div class="qoder-issue-card-desc">${issue.description.substring(0, 60)}${issue.description.length > 60 ? '...' : ''}</div>
        `;
        card.querySelector('.qoder-btn-remove').addEventListener('click', (e) => {
          e.stopPropagation();
          issues.splice(parseInt(e.target.dataset.idx), 1);
          updateIssueList();
        });
        issueListEl.appendChild(card);
      });
    }

    // 重置工作流状态
    function resetWorkflow() {
      clearAllHighlights();
      selectedElements = [];
      selectedCategory = null;
      workflowMode = null;
      issueLogStart = null;
      catGrid.querySelectorAll('.qoder-cat-btn').forEach(b => b.classList.remove('qoder-cat-active'));
      panelTextarea.value = '';
      reportActions.classList.add('qoder-hidden');
      lastGeneratedMD = '';
    }

    // === 事件绑定 ===

    document.getElementById('qoder-btn-minimize').addEventListener('click', () => {
      panelMinimized = !panelMinimized;
      panelBody.classList.toggle('qoder-hidden', panelMinimized);
      document.getElementById('qoder-btn-minimize').textContent = panelMinimized ? '□' : '─';
    });

    document.getElementById('qoder-btn-close').addEventListener('click', () => {
      panel.style.display = 'none'; panelVisible = false; exitSelectorMode();
    });

    // 一键清空所有问题（无需刷新页面）
    document.getElementById('qoder-btn-clear-all').addEventListener('click', () => {
      if (issues.length === 0 && workflowMode === null) { showToast('没有可清空的内容'); return; }
      issues = [];
      issueIdCounter = 0;
      clearRecorderData();
      resetWorkflow();
      hideWf();
      exitSelectorMode();
      updateIssueList();
      showToast('已清空所有问题');
    });

    // 新增元素问题
    document.getElementById('qoder-btn-new-element').addEventListener('click', () => {
      resetWorkflow();
      workflowMode = 'element';
      issueLogStart = { logs: recorderData.logs.length, networkRequests: recorderData.networkRequests.length, userActions: recorderData.userActions.length };
      showWf('selecting');
      enterSelectorMode();
    });

    // 新增流程问题
    document.getElementById('qoder-btn-new-flow').addEventListener('click', () => {
      resetWorkflow();
      workflowMode = 'flow';
      issueLogStart = { logs: recorderData.logs.length, networkRequests: recorderData.networkRequests.length, userActions: recorderData.userActions.length };
      // 确保日志采集已启动
      if (!isRecording) {
        startRecorder();
      }
      showWf('flow');
    });

    // 元素问题：下一步
    btnNextStep.addEventListener('click', () => {
      if (workflowMode !== 'element' || selectedElements.length === 0) return;
      exitSelectorMode();
      showWf('editing');
      panelTextarea.focus();
    });

    // 流程问题：下一步（停止录制→进入描述）
    btnFlowNext.addEventListener('click', () => {
      if (workflowMode !== 'flow') return;
      showWf('editing');
      panelTextarea.focus();
    });

    // 返回
    btnBackSelect.addEventListener('click', () => {
      if (workflowMode === 'element') { showWf('selecting'); enterSelectorMode(); }
      else if (workflowMode === 'flow') { showWf('flow'); }
    });

    // 分类选择
    function onCategoryClick(grid, categories) {
      grid.addEventListener('click', (e) => {
        const btn = e.target.closest('.qoder-cat-btn');
        if (!btn) return;
        const cat = btn.dataset.cat;
        if (selectedCategory === cat) {
          selectedCategory = null;
          btn.classList.remove('qoder-cat-active');
        } else {
          grid.querySelectorAll('.qoder-cat-btn').forEach(b => b.classList.remove('qoder-cat-active'));
          selectedCategory = cat;
          btn.classList.add('qoder-cat-active');
        }
        // 自动填入默认描述
        const currentVal = panelTextarea.value.trim();
        const isEmpty = currentVal === '';
                const isPrevHint = Object.values(ISSUE_LEVELS).some(c => c.hint === currentVal);
        if (isEmpty || isPrevHint) {
          panelTextarea.value = selectedCategory ? categories[selectedCategory]?.hint || '' : '';
        }
      });
    }
        onCategoryClick(catGrid, ISSUE_LEVELS);

    // 保存问题
    btnSaveIssue.addEventListener('click', () => {
      const desc = panelTextarea.value.trim() || '(未填写描述)';
      const startIdx = issueLogStart || { logs: 0, networkRequests: 0, userActions: 0 };
      const issueLogs = recorderData.logs.slice(startIdx.logs);
      const issueNets = recorderData.networkRequests.slice(startIdx.networkRequests);
      const issueActions = recorderData.userActions
        .slice(startIdx.userActions || 0)
        .filter(a => ['click', 'dblclick', 'change', 'submit'].includes(a.type));

      if (workflowMode === 'element') {
        if (selectedElements.length === 0) { showToast('请先选择元素'); return; }
        issues.push({
          id: ++issueIdCounter,
          type: 'element',
          category: selectedCategory,
          description: desc,
          pageUrl: window.location.href,
          elements: selectedElements.map(s => ({ xpath: s.info.xpath })),
          logs: issueLogs,
          networkRequests: issueNets,
          timestamp: Date.now()
        });
      } else if (workflowMode === 'flow') {
        issues.push({
          id: ++issueIdCounter,
          type: 'flow',
          category: selectedCategory,
          description: desc,
          pageUrl: window.location.href,
          elements: [],
          actions: issueActions,
          logs: issueLogs,
          networkRequests: issueNets,
          timestamp: Date.now()
        });
      }
      // 重置
      resetWorkflow();
      hideWf();
      updateIssueList();
      showToast(`问题 #${issues.length} 已保存`);
    });

    // 生成报告
    btnGenReport.addEventListener('click', () => {
      if (issues.length === 0) return;
      lastGeneratedMD = generateCombinedReportMD();
      reportActions.classList.remove('qoder-hidden');
      chrome.storage.local.get(['issueReports'], (r) => {
        const reports = r.issueReports || [];
        reports.push({ md: lastGeneratedMD, timestamp: Date.now(), url: window.location.href, title: document.title, issueCount: issues.length });
        chrome.storage.local.set({ issueReports: reports });
      });
      // 自动复制到剪贴板
      copyToClipboard(lastGeneratedMD);
      showToast('测试报告已生成并复制到剪贴板！');
    });

    btnCopyMD.addEventListener('click', () => { if (lastGeneratedMD) copyToClipboard(lastGeneratedMD); });
    btnDownloadMD.addEventListener('click', () => { if (lastGeneratedMD) downloadMD(lastGeneratedMD); });
    btnDownloadZip.addEventListener('click', () => { if (lastGeneratedMD) downloadZip(lastGeneratedMD); });
    btnCopyPrompt.addEventListener('click', () => {
      if (!lastGeneratedMD) return;
      const match = lastGeneratedMD.match(/```\n([\s\S]*?)\n```/);
      if (match) copyToClipboard(match[1]); else showToast('未找到AI提示词');
    });

    // 拖拽
    let isDragging = false, dragOX = 0, dragOY = 0;
    panel.querySelector('.qoder-panel-header').addEventListener('mousedown', (e) => {
      if (e.target.closest('.qoder-btn-icon')) return;
      isDragging = true;
      const rect = panel.getBoundingClientRect();
      dragOX = e.clientX - rect.left; dragOY = e.clientY - rect.top;
      panel.style.transition = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panel.style.left = Math.max(0, Math.min(e.clientX - dragOX, window.innerWidth - 100)) + 'px';
      panel.style.top = Math.max(0, Math.min(e.clientY - dragOY, window.innerHeight - 50)) + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; panel.style.transition = ''; } });

    // 回调桥
    onSelectionChanged = updatePanelSelectedList;

    function updatePanelSelectedList() {
      if (!selectedListEl) return;
      if (selectedElements.length === 0) {
        selectedListEl.innerHTML = '<div class="qoder-empty-hint">暂未选择元素</div>';
        btnNextStep.disabled = true;
      } else {
        selectedListEl.innerHTML = selectedElements.map((item, i) => {
          const info = item.info;
          const tag = `<${info.tag}>`;
          const text = info.text ? `"${info.text.substring(0, 25)}"` : '';
          return `<div class="qoder-selected-item"><span class="qoder-sel-badge">#${i+1}</span><span class="qoder-sel-tag">${tag}</span><span class="qoder-sel-text">${text}</span><button class="qoder-btn-remove" data-index="${i}" title="移除">✕</button></div>`;
        }).join('');
        btnNextStep.disabled = false;
        selectedListEl.querySelectorAll('.qoder-btn-remove').forEach(btn => {
          btn.addEventListener('click', (e) => { e.stopPropagation(); removeSelectedElement(parseInt(btn.dataset.index)); });
        });
      }
    }

    function updateLogStats() {
      // 更新流程录制状态显示
      const flowStatsEl = document.getElementById('qoder-flow-stats');
      if (flowStatsEl && workflowMode === 'flow') {
        const startIdx = issueLogStart || { logs: 0, networkRequests: 0 };
        const flowLogs = recorderData.logs.length - startIdx.logs;
        const flowActions = recorderData.userActions.length - (startIdx.userActions || 0);
        flowStatsEl.textContent = `${flowLogs}条日志 | ${flowActions}次操作`;
      }
    }
    setInterval(updateLogStats, 1000);
    updateIssueList();
  }

  function showToast(msg) {
    const t = document.createElement('div'); t.className = 'qoder-toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2500);
  }

  // ==================== Popup 通信 ====================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOGGLE_PANEL') {
      if (panel) {
        panelVisible = !panelVisible;
        panel.style.display = panelVisible ? 'flex' : 'none';
        if (panelVisible && panelMinimized) { panelMinimized = false; panelBody.classList.remove('qoder-hidden'); document.getElementById('qoder-btn-minimize').textContent = '─'; }
      }
      sendResponse({ ok: true, visible: panelVisible });
    }
    if (message.type === 'PAGE_LOADED') { selectedElements = []; clearAllHighlights(); }
    return true;
  });

  // ==================== 初始化 ====================
  injectLogInterceptor();
  startRecorder();
  createFloatingPanel();
})();
