# class-easydown 开发文档

> 西安交通大学在线学习平台课程回放下载 — 用户脚本技术细节

## 平台架构

```
class.xjtu.edu.cn          ← 主站 (AngularJS 内嵌)
class-rms.xjtu.edu.cn      ← 直录播资源管理子系统
review-class.xjtu.edu.cn   ← S3 对象存储 (视频文件)
```

## 视频下载链路

```
录播教材页面 (/course/{id}/lesson)
  │
  ├── ① GET /api/course/{id}/coursewares
  │     → lesson 列表 (id, title, lesson_resource_id)
  │
  ├── ② GET /api/activities/{lesson_id}
  │     → video_suite.videos[]
  │         ├── camera_type: "INSTRUCTOR"  老师路 (0-)
  │         └── camera_type: "ENCODER"     电脑路 (2-)
  │        file_url: preview URL (class-rms)
  │
  ├── ③ GET /api/lessons/{lesson_id}/player-url?from_page=course
  │     → { url: embed_url }  用作 Referer
  │
  └── ④ HEAD file_url + Referer: embed_url
        → 302 → S3 预签名 URL
        → <a> 点击下载
```

## 核心 API

### 录播列表

```
GET /api/course/{course_id}/coursewares
  ?conditions={"category":"lesson","class_ids":[],"itemsSortBy":{"predicate":"chapter","reverse":false}}
  &page=1&page_size=50
```

返回 `activities[]`，每个含 `id`、`title`、`data.lesson_resource_id`。自动分页遍历全部。

### 视频源信息

```
GET /api/activities/{activity_id}
```

返回 `video_suite.videos[]`：
- `camera_type`: `"INSTRUCTOR"` | `"ENCODER"`
- `mute`: `true` | `false`
- `file_url`: `https://class-rms.xjtu.edu.cn/api/base/orgs/xjtu/captures/{capture_id}/videos/{camera_id}/preview?previewToken={token}`

### 播放器嵌入页 URL

```
GET /api/lessons/{lesson_id}/player-url?from_page=course
```

返回 `{ url: "https://class-rms.xjtu.edu.cn/embed/lms/lesson-activity/{capture_id}/detail?token={JWT}&..." }`。

### Preview URL 重定向

```
HEAD file_url
  Headers: Referer: embed_url
  redirect: follow
→ 302 → S3 预签名 URL
```

S3 URL 格式：`https://review-class.xjtu.edu.cn/{room_code}/{track}-{room_code}-{datetime}.mp4?X-Amz-Signature=...`

## 代码结构

```
class-easydown.user.js (~850 行)
├── 配置 (TRACK_OPTIONS, API_BASE)
├── 状态 (state: lessons, selected, track, buttonMap, ...)
├── GM_addStyle CSS 样式
├── DOM 工具 ($, $$, el)
├── API 层
│   ├── loadLessonData()        分页获取录播列表
│   ├── loadLessonVideoSuite()  获取 video_suite
│   └── loadPlayerUrl()         获取 embed URL (Referer)
├── 链接解析
│   └── getFileUrl()            三步解析 → finalUrl
├── 行内按钮
│   ├── injectInlineButtons()   每行注入两个按钮
│   ├── injectBatchButton()     "一键获取全部链接"
│   └── updateInlineButton()    按钮状态更新 (buttonMap)
├── 底部面板
│   ├── buildPanel()            旧版批量 UI (默认折叠)
│   ├── renderLessonList()      复选框列表
│   └── refreshData()           重新加载
├── 下载逻辑 (startDownload, formatSize, buildFilename)
└── 主入口
    ├── init()                  初始化 + MutationObserver
    └── checkRoute()            SPA 路由监听
```

## 关键设计决策

### 1. HEAD 而非 GET 解析 finalUrl

preview URL 返回的是 1GB+ 视频流。用 GET 会让 `GM_xmlhttpRequest` 下载整个视频到内存才触发 `onload`。**HEAD 请求只拿响应头**，`resp.finalUrl` 即 S3 重定向后的目标 URL。

### 2. Referer 必然性

`class-rms.xjtu.edu.cn` 的 preview 端点会检查 `Referer` 头。必须先用 `player-url` API 获取 embed URL，作为 Referer 传入。缺少 Referer 会导致请求被服务端拒绝。

### 3. buttonMap 替代 DOM 匹配

翻页时 DOM 会刷新，旧的标题文本匹配不可靠。`injectInlineButtons` 注入时将 `lessonId -> track -> btnElement` 记录到 `state.buttonMap`。`updateInlineButton` 直接查 map，无需遍历 DOM。

### 4. MutationObserver 处理翻页

课程有多页时，点翻页按钮 AngularJS 会替换 DOM 内容。`MutationObserver` 监听 `childList` + `subtree`，发现新的未注入 `.activity-operations-container` 时自动调用 `injectInlineButtons()`。

### 5. `<a>` 标签替代 `GM_download`

`GM_download` 对跨域 S3 URL 可能静默失败。改用 `<a>` 元素 `click()` 走浏览器原生下载栏，可靠性更高。跨域场景下 `download` 属性被浏览器忽略，文件名使用服务器 `Content-Disposition` 头或 URL 路径名。

### 6. stopPropagation 防止页面跳转

行内按钮注入在 `.activity-operations-container` 之前，其父级 `.activity-summary` 有点击导航 handler。按钮的 `click` 事件必须 `e.stopPropagation()` + `e.preventDefault()`。

## 轨道说明

| 轨道 | camera_type | 文件前缀 | 说明 |
|------|-------------|---------|------|
| 老师路 | `INSTRUCTOR` | `0-` | 教师跟踪画面，静音 |
| 电脑路 | `ENCODER` | `2-` | 课件/黑板画面，有声 |

## @connect 配置

```
// @connect class.xjtu.edu.cn       ← 主站 API (coursewares, activities, player-url)
// @connect class-rms.xjtu.edu.cn   ← preview URL (HEAD 解析)
// @connect review-class.xjtu.edu.cn ← S3 下载 URL (GM_xmlhttpRequest 使用)
```

## 注意事项

- **S3 签名有效期**: 6 天（518400 秒），过期后需重新点击「获取链接」
- **并发**: 一键获取全部链接时所有请求并发执行，无数量限制
- **SPA**: 页面切换课程时通过 `hashchange` / `popstate` 监听，自动刷新数据
- **grants**: 脚本需要 `GM_xmlhttpRequest`、`GM_addStyle`、`GM_download` 三项权限
