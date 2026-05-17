// ═══════════════════════════════════════
//  平台适配层 — 浏览器 (Browser)
//  供 game-core.js 通过 Platform.* 调用
// ═══════════════════════════════════════
window.Platform = {
    name: 'browser',

    // ─── Canvas ───
    createCanvas(id) {
        const c = document.getElementById(id);
        c.width = 1920;
        c.height = 1080;
        return c;
    },
    getContext(canvas, type) {
        return canvas.getContext(type);
    },

    // ─── 屏幕信息 ───
    getScreenWidth() { return window.innerWidth; },
    getScreenHeight() { return window.innerHeight; },

    // ─── 触摸检测 ───
    isTouchDevice() {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    },

    // ─── 坐标转换 (canvas 客户端坐标 → 逻辑坐标) ───
    canvasToLogical(canvas, cx, cy) {
        const r = canvas.getBoundingClientRect();
        return {
            x: (cx - r.left) * (canvas.width / r.width),
            y: (cy - r.top) * (canvas.height / r.height)
        };
    },

    // ─── 事件监听 ───
    onKeyDown(callback) {
        document.addEventListener('keydown', callback);
    },
    onKeyUp(callback) {
        document.addEventListener('keyup', callback);
    },
    onMouseDown(canvas, callback) {
        canvas.addEventListener('mousedown', callback);
    },
    onMouseMove(canvas, callback) {
        canvas.addEventListener('mousemove', callback);
    },
    onMouseUp(canvas, callback) {
        canvas.addEventListener('mouseup', callback);
    },
    onMouseLeave(canvas, callback) {
        canvas.addEventListener('mouseleave', callback);
    },
    onTouchStart(canvas, callback) {
        canvas.addEventListener('touchstart', callback, { passive: false });
    },
    onTouchMove(canvas, callback) {
        canvas.addEventListener('touchmove', callback, { passive: false });
    },
    onTouchEnd(canvas, callback) {
        canvas.addEventListener('touchend', callback, { passive: false });
    },
    onTouchCancel(canvas, callback) {
        canvas.addEventListener('touchcancel', callback);
    },
    onResize(callback) {
        window.addEventListener('resize', callback);
    },
    onOrientationChange(callback) {
        window.addEventListener('orientationchange', () => setTimeout(callback, 300));
    },

    // ─── 事件数据提取 ───
    getMousePos(e) { return { clientX: e.clientX, clientY: e.clientY }; },
    getTouch(e) {
        const t = e.changedTouches;
        if (t && t.length > 0) return { clientX: t[0].clientX, clientY: t[0].clientY, identifier: t[0].identifier };
        return null;
    },
    getTouches(e) { return e.changedTouches; },
    preventDefault(e) { e.preventDefault(); },

    // ─── 音效 ───
    createAudioContext() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') ctx.resume();
            return ctx;
        } catch (e) { return null; }
    },

    // ─── 本地存储 ───
    getItem(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    setItem(key, value) {
        try { localStorage.setItem(key, value); } catch (e) {}
    },

    // ─── 动画帧 ───
    requestAnimationFrame(cb) {
        return requestAnimationFrame(cb);
    },
};
