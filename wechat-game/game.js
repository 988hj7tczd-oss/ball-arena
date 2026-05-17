// ═══════════════════════════════════════
//  平台适配层 — 微信小游戏 (WeChat)
//  在 game-core.js 加载前定义全局 Platform
// ═══════════════════════════════════════
const canvas = wx.createCanvas();
const sysInfo = wx.getSystemInfoSync();
const LOGICAL_W = 1920, LOGICAL_H = 1080;
const SCALE_X = sysInfo.windowWidth / LOGICAL_W;
const SCALE_Y = sysInfo.windowHeight / LOGICAL_H;

globalThis.Platform = {
    name: 'wechat',

    // ─── Canvas（固定 1920×1080，微信运行时自动拉伸到全屏） ───
    createCanvas() {
        canvas.width = 1920;
        canvas.height = 1080;
        return canvas;
    },
    getContext(c) { return c.getContext('2d'); },

    // ─── 屏幕信息 ───
    getScreenWidth() { return sysInfo.windowWidth; },
    getScreenHeight() { return sysInfo.windowHeight; },

    // ─── 触摸检测 ───
    isTouchDevice() { return true; },

    // ─── 坐标转换（触屏坐标 = 画布像素坐标，缩放到逻辑坐标系） ───
    canvasToLogical(c, cx, cy) {
        return { x: cx * (1920 / c.width), y: cy * (1080 / c.height) };
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
    onResize(cb) { wx.onWindowResize ? wx.onWindowResize(cb) : null; },
    onOrientationChange(cb) { wx.onWindowResize ? wx.onWindowResize(cb) : null; },

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
        // canvas 固定 1920×1080，无需调整
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
