// ═══════════════════════════════════════
//  平台适配层 — 微信小游戏 (WeChat)
//  在 game-core.js 加载前定义全局 Platform
// ═══════════════════════════════════════
const canvas = wx.createCanvas();
const sysInfo = wx.getSystemInfoSync();

globalThis.Platform = {
    name: 'wechat',

    // ─── Canvas（尺寸匹配屏幕 CSS 像素，1:1 映射） ───
    createCanvas() {
        canvas.width = Math.min(sysInfo.windowWidth, 1920);
        canvas.height = Math.min(sysInfo.windowHeight, 1080);
        return canvas;
    },
    getContext(c) { return c.getContext('2d'); },

    // ─── 屏幕信息 ───
    getScreenWidth() { return sysInfo.windowWidth; },
    getScreenHeight() { return sysInfo.windowHeight; },

    // ─── 触摸检测 ───
    isTouchDevice() { return true; },

    // ─── 坐标转换（canvas 尺寸 = 屏幕 CSS 像素尺寸，1:1 映射） ───
    canvasToLogical(c, cx, cy) {
        return { x: cx, y: cy };
    },

    // ─── 事件监听 ───
    onKeyDown() {},
    onKeyUp() {},
    onMouseDown() {},
    onMouseMove() {},
    onMouseUp() {},
    onMouseLeave() {},

    onTouchStart(c, cb) {
        wx.onTouchStart(e => { cb({ changedTouches: (e.changedTouches||[]).map(t => ({clientX:t.clientX,clientY:t.clientY,identifier:t.identifier||t.id})) }); });
    },
    onTouchMove(c, cb) {
        wx.onTouchMove(e => { cb({ changedTouches: (e.changedTouches||[]).map(t => ({clientX:t.clientX,clientY:t.clientY,identifier:t.identifier||t.id})) }); });
    },
    onTouchEnd(c, cb) {
        wx.onTouchEnd(e => { cb({ changedTouches: (e.changedTouches||[]).map(t => ({clientX:t.clientX,clientY:t.clientY,identifier:t.identifier||t.id})) }); });
    },
    onTouchCancel(c, cb) {
        wx.onTouchCancel(() => cb({ changedTouches: [] }));
    },
    onResize(cb) {
        wx.onWindowResize ? wx.onWindowResize((res) => {
            canvas.width = Math.min(res.windowWidth, 1920);
            canvas.height = Math.min(res.windowHeight, 1080);
            if (cb) cb();
        }) : null;
    },
    onOrientationChange(cb) {
        // 同 onResize（微信只提供 onWindowResize）
        wx.onWindowResize ? wx.onWindowResize((res) => {
            canvas.width = Math.min(res.windowWidth, 1920);
            canvas.height = Math.min(res.windowHeight, 1080);
            if (cb) cb();
        }) : null;
    },

    // ─── 事件数据提取 ───
    getMousePos() { return null; },
    getTouch(e) {
        if (e.changedTouches && e.changedTouches.length > 0) {
            const t = e.changedTouches[0];
            return { clientX: t.clientX, clientY: t.clientY, identifier: t.identifier };
        }
        return null;
    },
    getTouches(e) { return e.changedTouches || []; },
    preventDefault() {},

    // ─── 音效 ───
    createAudioContext() { return null; },

    // ─── 屏幕尺寸刷新（横竖屏切换时） ───
    refreshScreenSize() {
        const info = wx.getSystemInfoSync();
        canvas.width = Math.min(info.windowWidth, 1920);
        canvas.height = Math.min(info.windowHeight, 1080);
    },

    // ─── 本地存储 ───
    getItem(key) {
        try { return wx.getStorageSync(key); } catch (e) { return null; }
    },
    setItem(key, value) {
        try { wx.setStorageSync(key, value); } catch (e) {}
    },

    // ─── 动画帧 ───
    requestAnimationFrame(cb) {
        return requestAnimationFrame(cb);
    },
};

// ─── 加载游戏核心代码 ───
require('./game-core.js');
