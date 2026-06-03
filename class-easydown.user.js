// ==UserScript==
// @name         class-easydown - 西安交大课程回放批量下载
// @namespace    https://github.com/xu-fencer/class-easydown-script
// @version      1.0.1
// @description  在录播教材页面批量下载课程回放视频（区分老师路/电脑路）
// @author       xu-fencer
// @match        https://class.xjtu.edu.cn/course/*/lesson*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_addStyle
// @connect      class.xjtu.edu.cn
// @connect      class-rms.xjtu.edu.cn
// @connect      review-class.xjtu.edu.cn
// @changelog
// ==v1.0.1==
// - [优化] "下载选中"功能改为"提取链接"：点击后弹出窗口，自动复制所有选中视频的最终链接到剪贴板，支持一键复制
// ==v1.0.0==
// - 初始版本，支持老师路/电脑路两路视频获取、行内快捷按钮、一键获取全部链接
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 配置 ====================
    const API_BASE = 'https://class.xjtu.edu.cn';
    const TRACK_OPTIONS = [
        { key: 'INSTRUCTOR', label: '老师路 (教师画面, 静音)', icon: '👨‍🏫' },
        { key: 'ENCODER', label: '电脑路 (课件画面, 有声)', icon: '🖥️' },
    ];

    // ==================== 状态 ====================
    const state = {
        courseId: null,
        lessons: [],          // [{ id, title, videoSuite, courseName }]
        selected: new Set(),  // 选中的 lesson id
        track: null,          // 'INSTRUCTOR' | 'ENCODER' (必须选择)
        downloading: false,
        downloadQueue: [],    // [{ filename, url }]
        completed: 0,
        failed: 0,
        buttonMap: {},        // { lessonId: { INSTRUCTOR: btnEl, ENCODER: btnEl } }
    };

    // ==================== 样式注入 ====================
    GM_addStyle(`
        .easydown-panel {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 99999;
            background: #fff;
            border-top: 3px solid #1890ff;
            box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            color: #333;
            transition: transform 0.3s ease;
        }
        .easydown-panel.collapsed { transform: translateY(calc(100% - 48px)); }
        .easydown-panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 7px 16px;
            background: #1890ff;
            color: #fff;
            cursor: pointer;
            user-select: none;
        }
        .easydown-panel-header .easydown-title {
            font-size: 16px;
            font-weight: 600;
        }
        .easydown-panel-header .easydown-toggle {
            font-size: 18px;
            cursor: pointer;
        }
        .easydown-panel-body {
            padding: 10px 16px 16px;
            max-height: 220px;
            overflow-y: auto;
        }
        .easydown-toolbar {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            padding-bottom: 10px;
            border-bottom: 1px solid #f0f0f0;
            margin-bottom: 6px;
        }
        .easydown-btn {
            padding: 5px 14px;
            border: 1px solid #d9d9d9;
            border-radius: 4px;
            background: #fff;
            cursor: pointer;
            font-size: 13px;
            color: #333;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .easydown-btn:hover { border-color: #1890ff; color: #1890ff; }
        .easydown-btn-primary {
            background: #1890ff;
            border-color: #1890ff;
            color: #fff;
        }
        .easydown-btn-primary:hover { background: #40a9ff; border-color: #40a9ff; color: #fff; }
        .easydown-btn-primary:disabled { background: #b0d4ff; border-color: #b0d4ff; cursor: not-allowed; }
        .easydown-btn-danger { background: #ff4d4f; border-color: #ff4d4f; color: #fff; }
        .easydown-btn-danger:hover { background: #ff7875; }
        .easydown-btn-sm { padding: 3px 8px; font-size: 12px; }
        .easydown-track-group {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 13px;
        }
        .easydown-track-group label {
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
        }
        .easydown-track-group input[type="radio"] { cursor: pointer; }
        .easydown-count-badge {
            background: #fff3e0;
            color: #e65100;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 12px;
            font-weight: 500;
        }
        .easydown-progress {
            margin-top: 8px;
            padding: 8px 12px;
            background: #f6ffed;
            border: 1px solid #b7eb8f;
            border-radius: 4px;
            font-size: 12px;
            display: none;
        }
        .easydown-progress.active { display: block; }
        .easydown-progress-bar {
            height: 6px;
            background: #e8e8e8;
            border-radius: 3px;
            margin-top: 4px;
            overflow: hidden;
        }
        .easydown-progress-fill {
            height: 100%;
            background: #52c41a;
            border-radius: 3px;
            transition: width 0.3s;
        }
        .easydown-checkbox {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            font-size: 12px;
            padding: 2px 6px;
            border-radius: 3px;
            transition: background 0.2s;
        }
        .easydown-checkbox:hover { background: #e6f7ff; }
        .easydown-checkbox input { margin: 0; cursor: pointer; }
        .easydown-lesson-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 10px;
            border-bottom: 1px solid #fafafa;
            font-size: 13px;
            transition: background 0.2s;
        }
        .easydown-lesson-item:hover { background: #fafafa; }
        .easydown-lesson-item .easydown-lesson-title {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .easydown-lesson-item .easydown-lesson-meta {
            font-size: 11px;
            color: #999;
            white-space: nowrap;
        }
        .easydown-status {
            display: inline-block;
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 11px;
        }
        .easydown-status-done { background: #f6ffed; color: #52c41a; }
        .easydown-status-fail { background: #fff2f0; color: #ff4d4f; }
        .easydown-status-queued { background: #fffbe6; color: #faad14; }
        .easydown-inline-btns { display: inline-flex; gap: 5px; margin-left: 8px; vertical-align: middle; }
        .easydown-inline-btn {
            padding: 3px 10px; border: 1px solid #d9d9d9; border-radius: 4px;
            background: #fff; cursor: pointer; font-size: 12px; color: #555;
            transition: all 0.2s; white-space: nowrap;
        }
        .easydown-inline-btn:hover { border-color: #1890ff; color: #1890ff; }
        .easydown-inline-btn.easydown-loading { opacity: 0.55; cursor: wait; border-color: #faad14; color: #faad14; }
        .easydown-inline-btn.easydown-ready { background: #1890ff; color: #fff; border-color: #1890ff; font-weight: 500; }
        .easydown-inline-btn.easydown-ready:hover { background: #40a9ff; }
        .easydown-inline-btn.easydown-error { border-color: #ff4d4f; color: #ff4d4f; }
        .easydown-batch-btn {
            display: inline-flex; align-items: center; gap: 4px; margin-left: 10px;
            padding: 5px 14px; border: 1px solid #1890ff; border-radius: 4px;
            background: #fff; color: #1890ff; cursor: pointer; font-size: 13px;
            transition: all 0.2s;
        }
        .easydown-batch-btn:hover { background: #e6f7ff; }
        .easydown-batch-btn.easydown-loading { opacity: 0.55; cursor: wait; }
        .easydown-modal-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5); z-index: 9999999;
            display: flex; align-items: center; justify-content: center;
        }
        .easydown-modal {
            background: #fff; border-radius: 8px; width: 640px; max-width: 90vw;
            max-height: 80vh; display: flex; flex-direction: column;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .easydown-modal-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 16px; border-bottom: 1px solid #f0f0f0;
            background: #1890ff; color: #fff; border-radius: 8px 8px 0 0;
        }
        .easydown-modal-header .easydown-modal-title { font-size: 15px; font-weight: 600; }
        .easydown-modal-close { background: none; border: none; color: #fff; font-size: 18px; cursor: pointer; padding: 0; line-height: 1; }
        .easydown-modal-close:hover { opacity: 0.8; }
        .easydown-modal-body { padding: 16px; overflow-y: auto; }
        .easydown-modal-track {
            display: inline-block; padding: 2px 10px; border-radius: 12px;
            font-size: 12px; font-weight: 500; margin-bottom: 10px;
        }
        .easydown-modal-track-INSTRUCTOR { background: #e6f7ff; color: #1890ff; }
        .easydown-modal-track-ENCODER { background: #fff7e6; color: #fa8c16; }
        .easydown-modal-textarea {
            width: 100%; height: 300px; resize: none; border: 1px solid #d9d9d9;
            border-radius: 4px; padding: 10px; font-size: 12px; font-family: Consolas, monospace;
            color: #333; box-sizing: border-box; line-height: 1.6;
        }
        .easydown-modal-textarea:focus { outline: none; border-color: #1890ff; }
        .easydown-modal-copy-hint {
            margin-top: 8px; font-size: 12px; color: #52c41a; display: none;
        }
        .easydown-modal-copy-hint.show { display: block; }
    `);

    // ==================== DOM 工具 ====================
    function $(sel, parent) { return (parent || document).querySelector(sel); }
    function $$(sel, parent) { return (parent || document).querySelectorAll(sel); }
    function el(tag, attrs, ...children) {
        const e = document.createElement(tag);
        if (attrs) Object.entries(attrs).forEach(([k, v]) => {
            if (k === 'className') e.className = v;
            else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
            else e.setAttribute(k, v);
        });
        children.forEach(c => { if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c); });
        return e;
    }

    // ==================== 页面初始化 ====================
    function extractCourseId() {
        const match = location.pathname.match(/\/course\/(\d+)\//);
        return match ? parseInt(match[1]) : null;
    }

    async function loadLessonData() {
        const courseId = extractCourseId();
        if (!courseId) { console.error('[easydown] 无法提取课程ID'); return; }
        state.courseId = courseId;

        // 获取课程名称
        let courseName = '';
        try {
            const resp = await fetch(`${API_BASE}/api/courses/${courseId}?fields=id,name,display_name`);
            const data = await resp.json();
            courseName = data.display_name || data.name || '';
        } catch (e) { /* ignore */ }

        // 获取所有录播教材（分页）
        let page = 1;
        const allLessons = [];
        while (true) {
            const conditions = JSON.stringify({
                category: 'lesson',
                class_ids: [],
                itemsSortBy: { predicate: 'chapter', reverse: false },
            });
            const url = `${API_BASE}/api/course/${courseId}/coursewares?conditions=${encodeURIComponent(conditions)}&page=${page}&page_size=50`;
            const resp = await fetch(url);
            const data = await resp.json();
            const activities = data.activities || [];
            if (activities.length === 0) break;

            for (const act of activities) {
                allLessons.push({
                    id: act.id,
                    title: act.title || '',
                    courseName,
                    data: act.data || {},
                });
            }

            if (activities.length < 50) break;
            page++;
        }

        state.lessons = allLessons;
        return allLessons;
    }

    async function loadLessonVideoSuite(lessonId) {
        const resp = await fetch(`${API_BASE}/api/activities/${lessonId}`);
        const data = await resp.json();
        return data.video_suite || null;
    }

    async function loadPlayerUrl(lessonId) {
        const resp = await fetch(`${API_BASE}/api/lessons/${lessonId}/player-url?from_page=course`);
        const data = await resp.json();
        return data.url || '';
    }

    // ==================== 链接解析 ====================
    async function getFileUrl(lessonId, track) {
        // Step 1: 获取 video_suite
        const vsResp = await fetch(`${API_BASE}/api/activities/${lessonId}`);
        const vsData = await vsResp.json();
        const videoSuite = vsData.video_suite;
        if (!videoSuite || !videoSuite.videos) throw new Error('无回放数据');
        const video = videoSuite.videos.find(v => v.camera_type === track);
        if (!video || !video.file_url) throw new Error('无该轨道视频');

        // Step 2: 获取 embed URL 作为 Referer
        const puResp = await fetch(`${API_BASE}/api/lessons/${lessonId}/player-url?from_page=course`);
        const embedUrl = (await puResp.json()).url;
        if (!embedUrl) throw new Error('无法获取播放页地址');

        // Step 3: HEAD + Referer 获取重定向后的 finalUrl
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'HEAD',
                url: video.file_url,
                headers: { 'Referer': embedUrl },
                redirect: 'follow',
                onload: (r) => resolve(r.finalUrl),
                onerror: () => reject(new Error('解析下载链接失败')),
                ontimeout: () => reject(new Error('解析超时')),
            });
        });
    }

    // ==================== 下载逻辑 ====================
    function formatSize(bytes) {
        if (!bytes || bytes <= 0) return '';
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
    }

    function buildFilename(lesson, trackKey) {
        const trackLabel = trackKey === 'INSTRUCTOR' ? '老师路' : '电脑路';
        let name = lesson.title || `lesson-${lesson.id}`;
        name = name.replace(/[:*?"<>|\\/]/g, '_');
        if (lesson.courseName) name = `${lesson.courseName}_${name}`;
        return `${name}_${trackLabel}.mp4`;
    }

    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    async function extractSelectedLinks() {
        if (state.downloading) return;
        if (state.selected.size === 0) { alert('请先选择要提取链接的录播视频'); return; }
        if (!state.track) { alert('请选择提取老师路还是电脑路'); return; }

        state.downloading = true;
        state.completed = 0;
        state.failed = 0;
        state.downloadQueue = [];
        updateUI();

        const progressEl = $('#easydown-progress');
        const progressText = $('#easydown-progress-text');
        progressEl.classList.add('active');
        progressText.textContent = '正在解析视频链接...';

        const selectedIds = [...state.selected];
        const urls = [];

        for (let i = 0; i < selectedIds.length; i++) {
            const lessonId = selectedIds[i];
            const lesson = state.lessons.find(l => l.id === lessonId);
            if (!lesson) continue;

            let videoSuite = lesson._videoSuite;
            if (!videoSuite) {
                try {
                    videoSuite = await loadLessonVideoSuite(lessonId);
                    lesson._videoSuite = videoSuite;
                } catch (e) {
                    state.failed++;
                    updateProgress();
                    continue;
                }
            }

            if (!videoSuite || !videoSuite.videos) {
                state.failed++;
                updateProgress();
                continue;
            }

            const video = videoSuite.videos.find(v => v.camera_type === state.track);
            if (!video || !video.file_url) {
                state.failed++;
                updateProgress();
                continue;
            }

            let referer = '';
            try {
                referer = await loadPlayerUrl(lessonId);
            } catch (e) {
                console.error('[easydown] 获取 player-url 失败:', lesson.title, e);
            }

            progressText.textContent = `解析 (${i + 1}/${selectedIds.length}): ${lesson.title}`;
            updateProgress();

            try {
                const finalUrl = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'HEAD',
                        url: video.file_url,
                        headers: { 'Referer': referer },
                        redirect: 'follow',
                        onload: (resp) => resolve(resp.finalUrl),
                        onerror: () => reject(new Error('解析失败')),
                        ontimeout: () => reject(new Error('解析超时')),
                    });
                });
                urls.push(finalUrl);
                state.completed++;
            } catch (e) {
                state.failed++;
            }
            updateProgress();
        }

        state.downloading = false;
        progressEl.classList.remove('active');
        updateUI();

        if (urls.length > 0) {
            showLinksModal(urls, state.track);
        } else {
            alert('没有可提取链接的视频（可能暂无回放数据）');
        }
    }

    function updateProgress() {
        const total = state.downloadQueue.length;
        const done = state.completed + state.failed;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const fill = $('#easydown-progress-fill');
        if (fill) fill.style.width = pct + '%';
    }

    function showLinksModal(urls, track) {
        const overlay = el('div', { className: 'easydown-modal-overlay' });
        const trackClass = track === 'INSTRUCTOR' ? 'easydown-modal-track-INSTRUCTOR' : 'easydown-modal-track-ENCODER';
        const trackLabel = track === 'INSTRUCTOR' ? '👨‍🏫 老师路' : '🖥️ 电脑路';

        const modal = el('div', { className: 'easydown-modal' });
        const header = el('div', { className: 'easydown-modal-header' });
        header.append(
            el('span', { className: 'easydown-modal-title' }, '📥 批量提取链接结果'),
            el('button', { className: 'easydown-modal-close', onClick: () => overlay.remove() }, '✕'),
        );

        const body = el('div', { className: 'easydown-modal-body' });
        const textarea = el('textarea', {
            className: 'easydown-modal-textarea',
            readonly: 'readonly',
            rows: Math.min(urls.length, 20),
        }, urls.join('\n'));
        const hint = el('div', { className: 'easydown-modal-copy-hint' }, '✅ 链接已自动复制到剪贴板');

        body.append(
            el('span', { className: `easydown-modal-track ${trackClass}` }, trackLabel),
            el('div', { style: 'margin-bottom:8px;font-size:13px;color:#666;' }, `共 ${urls.length} 个链接，一行一个，点击下方文本框全选复制`),
            textarea,
            hint,
        );

        modal.append(header, body);
        overlay.append(modal);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        navigator.clipboard.writeText(urls.join('\n')).then(() => hint.classList.add('show'));
    }

    // ==================== 行内按钮注入 ====================
    function injectInlineButtons() {
        const containers = document.querySelectorAll('.activity-operations-container');
        if (containers.length === 0) return false;

        containers.forEach(container => {
            if (container.dataset.easydownInjected) return;
            container.dataset.easydownInjected = '1';

            // 从父级 activity-summary 中提取标题来匹配 lesson
            const summary = container.closest('.activity-summary');
            if (!summary) return;
            const titleEl = summary.querySelector('.activity-title');
            const rawTitle = titleEl ? titleEl.textContent.trim() : '';
            // 清理标题中的空白字符用于匹配
            const cleanTitle = rawTitle.replace(/\s+/g, ' ').trim();

            const lesson = state.lessons.find(l => {
                const lTitle = (l.title || '').replace(/\s+/g, ' ').trim();
                return lTitle === cleanTitle || lTitle.includes(cleanTitle) || cleanTitle.includes(lTitle);
            });
            if (!lesson) return;

            const btnsDiv = document.createElement('span');
            btnsDiv.className = 'easydown-inline-btns';

            TRACK_OPTIONS.forEach(opt => {
                const btn = document.createElement('button');
                btn.className = 'easydown-inline-btn';
                btn.innerHTML = `${opt.icon} 获取${opt.label}`;
                btn.title = `${lesson.title} - ${opt.label}`;

                // 记录到 buttonMap
                if (!state.buttonMap[lesson.id]) state.buttonMap[lesson.id] = {};
                state.buttonMap[lesson.id][opt.key] = btn;

                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (btn.classList.contains('easydown-loading')) return;

                    if (btn.classList.contains('easydown-ready')) {
                        const filename = buildFilename(lesson, opt.key);
                        console.log('[easydown] 开始下载:', filename, btn.dataset.url);
                        const a = document.createElement('a');
                        a.href = btn.dataset.url;
                        a.download = filename;
                        a.style.display = 'none';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        return;
                    }

                    btn.classList.add('easydown-loading');
                    btn.innerHTML = `⏳ 获取中...`;

                    try {
                        const finalUrl = await getFileUrl(lesson.id, opt.key);
                        btn.classList.remove('easydown-loading');
                        btn.classList.add('easydown-ready');
                        btn.dataset.url = finalUrl;
                        btn.innerHTML = `⬇ 下载${opt.label}`;
                        btn.title = `${lesson.title} - ${opt.label} (点击下载)`;
                    } catch (e) {
                        btn.classList.remove('easydown-loading');
                        btn.classList.add('easydown-error');
                        btn.innerHTML = `❌ 失败`;
                        btn.title = e.message;
                        console.error('[easydown] 获取失败:', lesson.title, opt.label, e);
                    }
                });

                btnsDiv.appendChild(btn);
            });

            container.parentElement.insertBefore(btnsDiv, container);
        });

        return true;
    }

    function injectBatchButton() {
        if (document.getElementById('easydown-batch-btn')) return;

        // 找到 "继续学习" 按钮
        const allElements = document.body.querySelectorAll('*');
        let continueBtn = null;
        for (const el of allElements) {
            if (el.children.length === 0 && el.textContent.trim() === '继续学习') {
                continueBtn = el;
                break;
            }
        }
        if (!continueBtn) return;

        const batchBtn = document.createElement('button');
        batchBtn.id = 'easydown-batch-btn';
        batchBtn.className = 'easydown-batch-btn';
        batchBtn.innerHTML = '⚡ 一键获取全部链接';

        batchBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (batchBtn.classList.contains('easydown-loading')) return;
            batchBtn.classList.add('easydown-loading');
            const total = state.lessons.length * TRACK_OPTIONS.length;
            let done = 0;

            batchBtn.innerHTML = `⏳ 获取中 (0/${total})...`;

            const promises = [];
            state.lessons.forEach(lesson => {
                TRACK_OPTIONS.forEach(opt => {
                    const p = getFileUrl(lesson.id, opt.key)
                        .then(url => {
                            done++;
                            batchBtn.innerHTML = `⏳ 获取中 (${done}/${total})...`;
                            // 更新对应按钮
                            updateInlineButton(lesson.id, opt.key, url);
                        })
                        .catch(e => {
                            done++;
                            batchBtn.innerHTML = `⏳ 获取中 (${done}/${total})...`;
                            console.error('[easydown] 批量获取失败:', lesson.title, opt.label, e);
                        });
                    promises.push(p);
                });
            });

            await Promise.allSettled(promises);
            batchBtn.classList.remove('easydown-loading');
            batchBtn.innerHTML = `✅ 全部完成 (${done}/${total})`;
            updateUI();
        });

        continueBtn.parentElement.insertBefore(batchBtn, continueBtn.nextSibling);
    }

    function updateInlineButton(lessonId, track, url) {
        const map = state.buttonMap[lessonId];
        if (!map) return;
        const btn = map[track];
        if (!btn) return;

        btn.classList.remove('easydown-loading');
        btn.classList.add('easydown-ready');
        btn.dataset.url = url;
        const opt = TRACK_OPTIONS.find(o => o.key === track);
        btn.innerHTML = `⬇ 下载${opt.label}`;
        btn.title = `${btn.title.split(' - ')[0]} - ${opt.label} (点击下载)`;
    }

    // ==================== UI ====================
    function buildPanel() {
        const panel = el('div', { className: 'easydown-panel collapsed' });

        // 头部
        const header = el('div', { className: 'easydown-panel-header' });
        header.append(
            el('span', { className: 'easydown-title' }, '📥 class-easydown 批量下载'),
            el('span', { className: 'easydown-toggle', onClick: () => panel.classList.toggle('collapsed') }, '▲'),
        );
        header.addEventListener('click', (e) => {
            if (e.target.classList.contains('easydown-toggle')) return;
            panel.classList.toggle('collapsed');
        });

        // 主体
        const body = el('div', { className: 'easydown-panel-body' });

        // 工具栏
        const toolbar = el('div', { className: 'easydown-toolbar' });
        toolbar.append(
            el('button', { className: 'easydown-btn easydown-btn-sm', onClick: selectAll }, '全选'),
            el('button', { className: 'easydown-btn easydown-btn-sm', onClick: deselectAll }, '取消全选'),
            el('span', { className: 'easydown-count-badge', id: 'easydown-count' }, '已选 0 个'),
        );

        // 轨道选择
        const trackGroup = el('div', { className: 'easydown-track-group' });
        trackGroup.append(el('span', {}, '下载线路:'));
        TRACK_OPTIONS.forEach(opt => {
            const label = el('label', {});
            const radio = el('input', {
                type: 'radio',
                name: 'easydown-track',
                value: opt.key,
                onChange: (e) => { state.track = e.target.checked ? opt.key : null; updateDownloadBtn(); },
            });
            label.append(radio, el('span', {}, `${opt.icon} ${opt.label}`));
            trackGroup.append(label);
        });
        toolbar.append(trackGroup);

               // 下载按钮
        toolbar.append(
            el('button', {
                className: 'easydown-btn easydown-btn-primary easydown-btn-sm',
                id: 'easydown-download-btn',
                disabled: 'true',
                onClick: extractSelectedLinks,
            }, '⬇ 提取链接'),
            el('button', {
                className: 'easydown-btn easydown-btn-sm',
                onClick: refreshData,
            }, '🔄 刷新'),
        );

        body.append(toolbar);

        // 进度条
        const progress = el('div', { className: 'easydown-progress', id: 'easydown-progress' });
        progress.append(
            el('span', { id: 'easydown-progress-text' }, ''),
            el('div', { className: 'easydown-progress-bar' },
                el('div', { className: 'easydown-progress-fill', id: 'easydown-progress-fill', style: 'width:0%' }),
            ),
        );
        body.append(progress);

        // 课程列表
        const list = el('div', { id: 'easydown-lesson-list' });
        body.append(list);

        panel.append(header, body);
        document.body.appendChild(panel);
        return panel;
    }

    function renderLessonList() {
        const container = $('#easydown-lesson-list');
        if (!container) return;
        container.innerHTML = '';

        if (state.lessons.length === 0) {
            container.append(el('div', { style: 'padding:20px;text-align:center;color:#999;' }, '未找到录播视频，请确认课程有录播内容'));
            return;
        }

        state.lessons.forEach(lesson => {
            const row = el('div', { className: 'easydown-lesson-item' });
            const cb = el('input', {
                type: 'checkbox',
                id: `easydown-cb-${lesson.id}`,
                checked: state.selected.has(lesson.id),
                onChange: (e) => {
                    if (e.target.checked) state.selected.add(lesson.id);
                    else state.selected.delete(lesson.id);
                    updateUI();
                },
            });
            const label = el('label', { className: 'easydown-checkbox' }, cb);

            // 从标题提取日期和时间信息
            let timeStr = '';
            const timeMatch = lesson.title.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
            if (timeMatch) {
                timeStr = `${timeMatch[1]} ${timeMatch[2]}:${timeMatch[3]}`;
            }

            row.append(
                label,
                el('span', { className: 'easydown-lesson-title', title: lesson.title }, lesson.title),
                timeStr ? el('span', { className: 'easydown-lesson-meta' }, timeStr) : '',
            );
            container.append(row);
        });
    }

    function selectAll() {
        state.lessons.forEach(l => state.selected.add(l.id));
        updateUI();
    }

    function deselectAll() {
        state.selected.clear();
        updateUI();
    }

    function updateDownloadBtn() {
        const btn = $('#easydown-download-btn');
        if (!btn) return;
        btn.disabled = state.selected.size === 0 || !state.track || state.downloading;
        if (state.downloading) btn.textContent = '⏳ 提取中...';
        else if (state.selected.size > 0 && state.track) btn.textContent = `⬇ 提取链接 (${state.selected.size}个)`;
        else btn.textContent = '⬇ 提取链接';
    }

    function updateUI() {
        updateDownloadBtn();

        // 更新计数
        const countEl = $('#easydown-count');
        if (countEl) countEl.textContent = `已选 ${state.selected.size} 个`;

        // 更新复选框状态
        state.lessons.forEach(lesson => {
            const cb = $(`#easydown-cb-${lesson.id}`);
            if (cb) cb.checked = state.selected.has(lesson.id);
        });
    }

    async function refreshData() {
        state.lessons = [];
        state.selected.clear();
        state.track = null;
        state.downloading = false;
        state.downloadQueue = [];
        state.buttonMap = {};

        // 清除缓存的 videoSuite
        state.lessons.forEach(l => delete l._videoSuite);

        // 清除轨道选择
        $$('input[name="easydown-track"]').forEach(r => r.checked = false);

        const panel = $('.easydown-panel');
        if (panel) panel.classList.remove('collapsed');

        await loadLessonData();
        renderLessonList();
        updateUI();
    }

    // ==================== 主入口 ====================
    async function init() {
        // 等待页面加载完成
        if (document.readyState === 'loading') {
            await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));
        }

        // 检查是否在 lesson 页面
        if (!location.pathname.includes('/lesson')) return;

        // 等待课程数据加载（Vue 渲染完成后）
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('[easydown] 初始化 class-easydown...');
        buildPanel();
        await loadLessonData();
        renderLessonList();
        updateUI();
        console.log(`[easydown] 加载完成，共 ${state.lessons.length} 个录播视频`);

        // 等待 AngularJS 渲染并注入行内按钮
        const maxWait = 15;
        let waited = 0;
        while (!document.querySelector('.activity-operations-container') && waited < maxWait) {
            await new Promise(r => setTimeout(r, 1000));
            waited++;
        }
        injectInlineButtons();
        injectBatchButton();

        // 监听翻页/动态加载，自动注入新按钮
        const lessonList = document.querySelector('[class*="lesson-list"]') || document.querySelector('.course-courseware-area') || document.body;
        new MutationObserver(() => {
            const uninjected = document.querySelector('.activity-operations-container:not([data-easydown-injected])');
            if (uninjected) injectInlineButtons();
        }).observe(lessonList, { childList: true, subtree: true });
    }

    // 支持 SPA 路由切换
    let lastPath = location.pathname + location.hash;
    function checkRoute() {
        const currentPath = location.pathname + location.hash;
        if (currentPath !== lastPath && currentPath.includes('/lesson')) {
            lastPath = currentPath;
            setTimeout(refreshData, 1500);
        }
    }

    // 启动
    init();

    // 监听 SPA hash 变化
    window.addEventListener('hashchange', checkRoute);
    // 也监听 popstate（某些 SPA 使用 history API）
    window.addEventListener('popstate', checkRoute);
})();
