# class-easydown 技术文档

> 西安交通大学在线学习平台课程回放下载 — 视频 URL 解析与下载逻辑

---

## 1. 概述

### 1.1 平台架构

```
class.xjtu.edu.cn          ← 主站 (Vue SPA)
class-rms.xjtu.edu.cn      ← 直录播资源管理子系统
review-class.xjtu.edu.cn   ← S3 兼容对象存储 (视频文件)
login.xjtu.edu.cn           ← CAS 统一身份认证
```

### 1.2 视频下载完整链路

```
课程录播教材页面 (/course/{id}/lesson)
  │
  ├── ① 获取录播列表
  │   GET /api/course/{course_id}/coursewares
  │   → 返回 lesson 列表 (含 lesson_resource_id)
  │
  ├── ② 获取视频源信息
  │   GET /api/activities/{lesson_id}
  │   → 返回 video_suite.videos[]
  │       ├── INSTRUCTOR (老师路, 静音)
  │       └── ENCODER   (电脑路, 有声)
  │     每个 video.file_url 是 preview URL
  │
  ├── ③ 获取播放器嵌入页 URL (用作 Referer)
  │   GET /api/lessons/{lesson_id}/player-url?from_page=course
  │   → 返回 { url: embed_url }
  │     embed_url 格式:
  │     https://class-rms.xjtu.edu.cn/embed/lms/lesson-activity/{capture_id}/detail?token={JWT}&...
  │
  └── ④ 解析最终下载 URL
      HEAD preview_url
        Headers: { Referer: embed_url }
        redirect: follow
      → 302 → S3 预签名 URL (finalUrl)
        格式: https://review-class.xjtu.edu.cn/{room_code}/{track}-{room_code}-{datetime}.mp4?X-Amz-...
```

---

## 2. API 参考

### 2.1 获取录播列表

```
GET /api/course/{course_id}/coursewares?conditions={...}&page=1&page_size=50
```

**Query Parameters**:

| 参数 | 说明 |
|------|------|
| `conditions` | URL-encoded JSON，固定格式 `{"category":"lesson","class_ids":[],"itemsSortBy":{"predicate":"chapter","reverse":false}}` |
| `page` | 页码，从 1 开始 |
| `page_size` | 每页数量，建议 50 |

**Response** (精简):

```json
{
  "total": 6,
  "page": 1,
  "page_size": 50,
  "activities": [
    {
      "id": 5819212,
      "title": "数字营销 文管-333 2026-04-28 10:10:00-11:00:00",
      "type": "lesson",
      "data": {
        "lesson_resource_id": 2992300,
        "duration": 3000,
        "lesson_start": "2026-04-28T02:10:00Z",
        "lesson_end": "2026-04-28T03:00:00Z",
        "allow_download": true,
        "download_setting": "ALLOWALL"
      }
    }
  ]
}
```

**分页**: 循环请求直到 `activities.length < page_size`。

### 2.2 获取视频源信息 ★核心★

```
GET /api/activities/{lesson_id}
```

**Response** (精简):

```json
{
  "id": 5819212,
  "title": "数字营销 文管-333 2026-04-28 10:10:00-11:00:00",
  "type": "lesson",
  "video_suite": {
    "start_time": "2026-04-28T02:10:00Z",
    "end_time": "2026-04-28T03:00:00Z",
    "videos": [
      {
        "camera_type": "INSTRUCTOR",
        "file_url": "https://class-rms.xjtu.edu.cn/api/base/orgs/xjtu/captures/{capture_id}/videos/{camera_id}/preview?previewToken={token}",
        "label": "INSTRUCTOR",
        "mute": true
      },
      {
        "camera_type": "ENCODER",
        "file_url": "https://class-rms.xjtu.edu.cn/api/base/orgs/xjtu/captures/{capture_id}/videos/{camera_id}/preview?previewToken={token}",
        "label": "ENCODER",
        "mute": false
      }
    ]
  },
  "lesson_resource": {
    "id": 2992300,
    "properties": {
      "replay_code": "e7dc01ccb5a745728bf44d5f6af49760",
      "status": "FINISHED",
      "type": "RECORD",
      "duration": 3000
    },
    "size": 1827819497
  }
}
```

**字段说明**:

| 字段 | 说明 |
|------|------|
| `video_suite.videos[].camera_type` | `INSTRUCTOR` = 教师路 (track 0), `ENCODER` = 电脑路 (track 2) |
| `video_suite.videos[].mute` | `true` = 静音 (教师路通常是), `false` = 有声 |
| `video_suite.videos[].file_url` | preview URL，需配合 Referer 解析为真实下载 URL |
| `lesson_resource.size` | 文件大小 (bytes) |
| `lesson_resource.properties.replay_code` | 回放 capture ID |

### 2.3 获取播放器嵌入页 URL

```
GET /api/lessons/{lesson_id}/player-url?from_page=course
```

**Response**:

```json
{
  "url": "https://class-rms.xjtu.edu.cn/embed/lms/lesson-activity/{capture_id}/detail?token={JWT}&dep_id={dep_id}&course_id={course_id}&activity_id={lesson_id}&user_id={user_id}"
}
```

**用途**: 作为 Referer 头传递给 preview URL 的请求。

### 2.4 Preview URL 重定向

```
HEAD https://class-rms.xjtu.edu.cn/api/base/orgs/xjtu/captures/{capture_id}/videos/{camera_id}/preview?previewToken={token}
Headers:
  Referer: {embed_url}
Redirect: follow
```

**行为**: 服务器返回 **302** 重定向到 S3 预签名下载 URL。

**最终 URL 格式**:

```
https://review-class.xjtu.edu.cn/{room_code}/{track}-{room_code}-{YYYYMMDD}{HHMM}-{YYYYMMDD}{HHMM}.mp4
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-Credential={credential}
  &X-Amz-Date={date}
  &X-Amz-Expires=518400
  &X-Amz-SignedHeaders=host
  &X-Amz-Signature={signature}
```

**S3 URL 参数说明**:

| 参数 | 说明 |
|------|------|
| `X-Amz-Expires` | 签名有效期 **518400 秒 (6 天)** |
| `X-Amz-SignedHeaders` | 签名的头域，固定 `host` |
| `X-Amz-Signature` | HMAC-SHA256 签名 |

**文件命名规范**:

```
{track}-{room_code}-{start_date}{start_time}-{end_date}{end_time}.mp4

示例:
  0-34333-202604281000-202604281100.mp4  ← 教师路 (track 0)
  2-34333-202604281000-202604281100.mp4  ← 电脑路 (track 2)
```

---

## 3. 下载实现 (Tampermonkey)

### 3.1 关键发现

| 问题 | 根因 | 解决 |
|------|------|------|
| `GM_download` `xhr_failed` | 跨域请求缺 Referer，服务端拒绝 | 先调 `player-url` API 获取 embed URL，作为 Referer 传入 |
| `GM_xmlhttpRequest` HEAD 不跟随重定向 | GET 请求 1GB+ body 阻塞 `onload` | 用 **HEAD** 请求，只拿响应头即可获取 `finalUrl` |
| `GM_download` `onerror` 不触发 onload | `finalUrl` 为空时静默失败 | 先 HEAD 验证拿到 finalUrl 再下载 |
| 文件名被服务器 UUID 覆盖 | S3 URL 中 `response-content-disposition` 参数 | `finalUrl` 不带该参数，`GM_download({ name })` 有效 |

### 3.2 正确流程

```javascript
// ① 获取 video_suite
const resp1 = await fetch(`/api/activities/${lessonId}`);
const videoSuite = resp1.json().video_suite;
const video = videoSuite.videos.find(v => v.camera_type === trackKey);

// ② 获取 embed URL (用作 Referer)
const resp2 = await fetch(`/api/lessons/${lessonId}/player-url?from_page=course`);
const embedUrl = resp2.json().url;

// ③ HEAD 请求获取重定向后的 S3 最终 URL
GM_xmlhttpRequest({
    method: 'HEAD',
    url: video.file_url,
    headers: { 'Referer': embedUrl },
    redirect: 'follow',
    onload: (resp) => {
        const finalUrl = resp.finalUrl;  // ← S3 预签名 URL
        console.log('finalUrl:', finalUrl);

        // ④ 下载
        GM_download({
            url: finalUrl,
            name: '课程名_日期_轨道.mp4',
            saveAs: false,
        });
    },
});
```

### 3.3 `@connect` 配置

`GM_xmlhttpRequest` 和 `GM_download` 涉及三个域，需要在 `@connect` 中全部声明：

```
// @connect class.xjtu.edu.cn
// @connect class-rms.xjtu.edu.cn
// @connect review-class.xjtu.edu.cn
```

---

## 4. 轨道说明

| 轨道 | camera_type | 文件前缀 | 说明 |
|------|-------------|---------|------|
| 老师路 | `INSTRUCTOR` | `0-` | 教师跟踪画面，静音 (mute: true) |
| 电脑路 | `ENCODER` | `2-` | 课件/黑板画面，有声 (mute: false) |

---

## 5. 认证机制 (参考)

### 5.1 登录流程

```
class.xjtu.edu.cn → 302 → login.xjtu.edu.cn (CAS)
  → GET /cas/jwt/publicKey (RSA 公钥)
  → JS 加密密码
  → POST /cas/login (username + __RSA__{encrypted} + execution + 隐藏字段)
  → 302 → OAuth2 callback → Keycloak Broker → class.xjtu.edu.cn
  → Set-Cookie: STATE={token}.TronClass
```

### 5.2 关键 API 端点 (CAS)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/cas/jwt/publicKey` | GET | RSA-2048 公钥 (PEM) |
| `/cas/login` | POST | 登录 (password 需 `__RSA__` 前缀 + RSA 加密) |
| `/cas/qr/qrcode` | GET | 扫码登录二维码 |
| `/cas/qr/comet` | POST | 长轮询扫码状态 |

---

## 6. 注意事项

- **S3 URL 有效期**: 6 天 (518400 秒)，需在签名过期前下载
- **下载间隔**: 建议每次下载间隔 ≥ 800ms，避免触发浏览器限流
- **Referer 必需**: preview URL 必须带正确的 embed URL 作为 Referer，否则服务端返回错误
- **GM_xmlhttpRequest 方法**: 用 HEAD 获取 finalUrl，不要用 GET (会下载整个视频到内存)
- **文件名**: 最终 S3 URL 不含 `response-content-disposition` 参数时，`GM_download({ name })` 可正常自定义文件名
