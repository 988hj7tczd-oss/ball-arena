// ═══════════════════════════════════════
//  弹球大乱斗 Ball Arena — 核心游戏引擎
//  跨平台支持：浏览器 / 微信小游戏 / 抖音小游戏
//  依赖全局 Platform 对象（未定义时自动使用浏览器模式）
// ═══════════════════════════════════════
var Platform;
(function(){
    // 从 globalThis 获取（微信/抖音 game.js 设置）
    var p = (typeof globalThis !== 'undefined' && globalThis.Platform) ? globalThis.Platform : null;
    if (p) { Platform = p; return; }
    // ─── 浏览器默认平台适配 ───
    if (typeof window === 'undefined') {
        throw new Error('Platform not defined. Load game.js before game-core.js in mini game mode.');
    }
    Platform = {
        name: 'browser',
        createCanvas(id) {
            const c = document.getElementById(id);
            c.width = 1920; c.height = 1080; return c;
        },
        getContext(c, t) { return c.getContext(t); },
        getScreenWidth() { return window.innerWidth; },
        getScreenHeight() { return window.innerHeight; },
        isTouchDevice() { return 'ontouchstart' in window || navigator.maxTouchPoints > 0; },
        canvasToLogical(canvas, cx, cy) {
            const r = canvas.getBoundingClientRect();
            return { x: (cx - r.left) * (canvas.width / r.width), y: (cy - r.top) * (canvas.height / r.height) };
        },
        onKeyDown(cb) { document.addEventListener('keydown', cb); },
        onKeyUp(cb) { document.addEventListener('keyup', cb); },
        onMouseDown(c, cb) { c.addEventListener('mousedown', cb); },
        onMouseMove(c, cb) { c.addEventListener('mousemove', cb); },
        onMouseUp(c, cb) { c.addEventListener('mouseup', cb); },
        onMouseLeave(c, cb) { c.addEventListener('mouseleave', cb); },
        onTouchStart(c, cb) { c.addEventListener('touchstart', cb, {passive:false}); },
        onTouchMove(c, cb) { c.addEventListener('touchmove', cb, {passive:false}); },
        onTouchEnd(c, cb) { c.addEventListener('touchend', cb, {passive:false}); },
        onTouchCancel(c, cb) { c.addEventListener('touchcancel', cb); },
        onResize(cb) { window.addEventListener('resize', cb); },
        onOrientationChange(cb) { window.addEventListener('orientationchange', () => setTimeout(cb, 300)); },
        getMousePos(e) { return {clientX:e.clientX,clientY:e.clientY}; },
        getTouch(e) {
            const t = e.changedTouches; if(t&&t.length>0) return {clientX:t[0].clientX,clientY:t[0].clientY,identifier:t[0].identifier};
            return null;
        },
        getTouches(e) { return e.changedTouches; },
        preventDefault(e) { e.preventDefault(); },
        createAudioContext() {
            try{const c=new(window.AudioContext||window.webkitAudioContext)();if(c.state==='suspended')c.resume();return c;}catch(e){return null;}
        },
        getItem(k) { try{return localStorage.getItem(k);}catch(e){return null;} },
        setItem(k,v) { try{localStorage.setItem(k,v);}catch(e){} },
        requestAnimationFrame(cb) { return requestAnimationFrame(cb); },
    };
    window.Platform = Platform;
})();
// ═══════════════════════════════════════
//  画布初始化
// ═══════════════════════════════════════
const canvas = Platform.createCanvas('game');
const ctx = Platform.getContext(canvas, '2d');
// ─── roundRect 修补（微信/抖音的 roundRect 有兼容问题，直接覆盖 ctx 上的方法） ───
ctx.roundRect = function(x, y, w, h, r) {
    if (typeof r === 'number') r = [r,r,r,r];
    if (!Array.isArray(r)) r = [0,0,0,0];
    const [tl, tr, br, bl] = r.map(v => Math.min(v, Math.min(w,h)/2));
    this.beginPath();
    this.moveTo(x+tl, y);
    this.lineTo(x+w-tr, y);
    this.quadraticCurveTo(x+w, y, x+w, y+tr);
    this.lineTo(x+w, y+h-br);
    this.quadraticCurveTo(x+w, y+h, x+w-br, y+h);
    this.lineTo(x+bl, y+h);
    this.quadraticCurveTo(x, y+h, x, y+h-bl);
    this.lineTo(x, y+tl);
    this.quadraticCurveTo(x, y, x+tl, y);
    this.closePath();
    return this;
};

// ─── 响应式缩放工具 ───
function S(n) { return Math.round(n * Math.max(0.45, GAME_H / 1080)); }         // 字体/UI 尺寸（按高度缩放）
function SX(n) { return Math.round(n * GAME_W / 1920); }        // X 方向缩放
function SP(n) { return Math.round(n * ARENA_RADIUS / 525); }   // 游戏物理值缩放（球半径、速度、武器射程等）

// ─── 游戏逻辑分辨率（浏览器固定 1920×1080，移动端匹配屏幕尺寸） ───
let GAME_W = 1920, GAME_H = 1080;

let ARENA_RADIUS = 525;
let CENTER_X = GAME_W / 2;
let CENTER_Y = GAME_H / 2;

// ─── 屏幕→逻辑坐标缩放因子（canvas 实际像素 / 逻辑分辨率） ───
let GAME_SCALE_X = 1;
let GAME_SCALE_Y = 1;
let MODE_BTN_BOTTOM = 0; // 模式按钮区域底部 Y（由 buildMenu 计算，drawMenu 使用）

// ═══════════════════════════════════════
//  响应式尺寸
// ═══════════════════════════════════════
let JOYSTICK_X = 280, JOYSTICK_Y = 930, JOYSTICK_RADIUS = 75, JOYSTICK_KNOB = 33, JOYSTICK_DEADZONE = 13;
let ATTACK_X = 1640, ATTACK_Y = 930, ATTACK_RADIUS = 60;
let BOOST_X = 1640, BOOST_Y = 850, BOOST_RADIUS = 40;
const BOOST_DURATION = 2;
const BOOST_COOLDOWN = 5;
const BOOST_SPEED_MULT = 1.5;
let boostCooldown = 0;
let boostPressed = false;

// ─── 响应式核心：根据 canvas 实际尺寸重算 GAME_W/GAME_H ───
function recalcGameDimensions() {
    if (Platform.name !== 'browser') {
        GAME_W = canvas.width;
        GAME_H = canvas.height;
    }
    ARENA_RADIUS = Math.min(GAME_W, GAME_H) * (525 / 1080);
    CENTER_X = GAME_W / 2;
    CENTER_Y = GAME_H / 2;
    GAME_SCALE_X = canvas.width / GAME_W;
    GAME_SCALE_Y = canvas.height / GAME_H;
    recalcUI();
}

function recalcUI() {
    JOYSTICK_X = GAME_W * 0.146; JOYSTICK_Y = GAME_H * 0.86;
    JOYSTICK_RADIUS = Math.max(40, Math.min(GAME_W, GAME_H) * 0.07);
    JOYSTICK_KNOB = JOYSTICK_RADIUS * 0.44;
    JOYSTICK_DEADZONE = Math.min(GAME_W, GAME_H) * 0.012;
    ATTACK_X = GAME_W * 0.854; ATTACK_Y = GAME_H * 0.86;
    ATTACK_RADIUS = Math.max(30, Math.min(GAME_W, GAME_H) * 0.055);
    BOOST_X = ATTACK_X + ATTACK_RADIUS * 0.8;
    BOOST_Y = ATTACK_Y - ATTACK_RADIUS * 2.1;
    BOOST_RADIUS = ATTACK_RADIUS;
}

function resizeCanvas() {
    if (Platform.name === 'browser') {
        const maxW = Platform.getScreenWidth(), maxH = Platform.getScreenHeight(), aspect = GAME_W / GAME_H;
        let w, h;
        if (maxW / maxH > aspect) { h = maxH; w = h * aspect; } else { w = maxW; h = w / aspect; }
        canvas.style.width = Math.floor(w) + 'px'; canvas.style.height = Math.floor(h) + 'px';
    }
    if (typeof Platform.refreshScreenSize === 'function') Platform.refreshScreenSize(canvas);
    recalcGameDimensions();
}
Platform.onResize(resizeCanvas);
Platform.onOrientationChange(() => setTimeout(resizeCanvas, 300));

// ═══════════════════════════════════════
//  数据表
// ═══════════════════════════════════════
const WEAPONS = [
    { id:'single_gun',  name:'🔫单发枪', type:'ranged', damage:0.9, cooldown:0.5, range:450, speed:825, uses:2, weight:15 },
    { id:'triple_gun',  name:'🔫🔫🔫三连发', type:'ranged', damage:0.6, cooldown:1.5, range:375, speed:720, uses:2, bulletCount:3, spread:15, weight:10 },
    { id:'brick',       name:'🧱砖块', type:'ranged', damage:1.0, cooldown:2.0, range:525, speed:480, uses:1, splash:90, splashDmg:0.5, weight:8 },
    { id:'dagger',      name:'🗡️匕首', type:'melee', damage:0.8, cooldown:0.3, range:98, uses:3, arc:360, weight:12 },
    { id:'big_sword',   name:'⚔️大刀', type:'melee', damage:1.2, cooldown:0.8, range:128, uses:3, arc:120, weight:10 },
    { id:'staff',       name:'🏏长棍', type:'melee', damage:0.9, cooldown:0.6, range:158, uses:3, arc:90, knockback:60, weight:10 },
    { id:'laser_gun',   name:'🔫激光枪', type:'ranged', damage:1.2, cooldown:1.2, range:750, speed:3000, uses:2, piercing:true, weight:6 },
    { id:'shotgun',     name:'💥霰弹枪', type:'ranged', damage:0.6, cooldown:2.0, range:300, speed:675, uses:1, bulletCount:6, spread:28, weight:8 },
    { id:'boomerang',   name:'🪃回旋镖',  type:'ranged', damage:0.5, cooldown:0.6, range:450, speed:450, uses:2, piercing:true, boomerang:true, weight:3 },
];
const ITEMS = [
    { id:'white_apple',  name:'🍎白苹果', type:'heal', target:'self', value:1, weight:30, color:'#ffffff' },
    { id:'yellow_apple', name:'🍏黄苹果', type:'heal', target:'self', value:2, weight:15, color:'#ffdc32' },
    { id:'red_apple',    name:'🔴红苹果', type:'heal', target:'team', value:2, weight:8,  color:'#ff5050' },
    { id:'blue_armor',   name:'🛡️蓝护甲', type:'shield', target:'self', weight:20, color:'#64c8ff' },
    { id:'yellow_armor', name:'🛡️黄护甲', type:'shield', target:'team', weight:8,  color:'#ffc832' },
    { id:'magnet',       name:'🧲磁铁', type:'magnet', target:'self', weight:10, color:'#ff9696' },
    { id:'ice',          name:'🧊冰块', type:'freeze', target:'enemy', duration:1.5, weight:12, color:'#96dcff' },
    { id:'dodge',        name:'💨闪避', type:'dodge', target:'self', weight:10, color:'#96ff96' },
    { id:'poison_apple', name:'🟣毒苹果', type:'slow', target:'enemy', duration:3, weight:12, color:'#b464ff' },
];

// ═══════════════════════════════════════
//  球型 & 游戏模式
// ═══════════════════════════════════════
const BALL_TYPES = [
    { id:'balanced', name:'⚖️ 均衡型', hp:28, speed:225, radius:27, desc:'攻防平衡 · 新手首选' },
    { id:'tank',     name:'🛡️ 坦克型', hp:38, speed:165, radius:33, desc:'高防高血 · 稳扎稳打' },
    { id:'speedy',   name:'💨 速度型', hp:12, speed:363, radius:23, desc:'高移速机动 · 灵活拉扯' },
    { id:'attacker', name:'⚔️ 攻击型', hp:18, speed:255, radius:26, desc:'高伤高爆发 · 一击制胜', dmgMul:1.3 },
];
const GAME_MODES = [
    { id:'2v2',      name:'🎌 2v2 团队战', desc:'红蓝对抗 • 五局三胜' },
    { id:'4v4',      name:'⚔️ 4v4 团队战', desc:'8人混战 • 团队配合' },
    { id:'team2',    name:'🤝 2人组队',    desc:'双人合作 • 对抗AI' },
    { id:'team4',    name:'🤝 4人组队',    desc:'四人合作 • 对抗AI' },
    { id:'ffa',      name:'🏆 大乱斗',     desc:'各自为战 • 活到最后' },
    { id:'survival', name:'生存竞技',   desc:'毒圈缩圈 • 最后存活' },
    { id:'duo_survival', name:'组队竞技',desc:'双人组队 • 6队混战' },
    { id:'training', name:'🎯 训练场',      desc:'自由测试 • 无限武器' },
];

// ═══════════════════════════════════════
//  场地机制
// ═══════════════════════════════════════
// 动态加速带（随机刷新，10秒出现，持续5秒）
let speedZone = { active:false, x:0, y:0, r:70, boost:1.6, timer:0 };

// ═══════════════════════════════════════
//  FFA 颜色
// ═══════════════════════════════════════
const FFA_COLORS = [
    { id:'ffa_red',   name:'🔴 红', fill:'#ff5050', stroke:'#cc2020' },
    { id:'ffa_blue',  name:'🔵 蓝', fill:'#50a0ff', stroke:'#2060cc' },
    { id:'ffa_green', name:'🟢 绿', fill:'#50ff50', stroke:'#20cc20' },
    { id:'ffa_gold',  name:'🟡 金', fill:'#ffcc00', stroke:'#cc9900' },
    { id:'ffa_pink',  name:'🌸 粉', fill:'#ff66cc', stroke:'#cc44aa' },
    { id:'ffa_purple',name:'🟣 紫', fill:'#cc66ff', stroke:'#9944cc' },
    { id:'ffa_orange',name:'🟠 橙', fill:'#ff8844', stroke:'#cc6622' },
    { id:'ffa_cyan',  name:'🩵 青', fill:'#44ffcc', stroke:'#22cc99' },
];
const SURVIVAL_COLORS = [
    { id:'sv_0', name:'🔴 赤', fill:'#ff5050', stroke:'#cc2020' },
    { id:'sv_1', name:'🔵 蓝', fill:'#50a0ff', stroke:'#2060cc' },
    { id:'sv_2', name:'🟢 绿', fill:'#50ff50', stroke:'#20cc20' },
    { id:'sv_3', name:'🟡 金', fill:'#ffcc00', stroke:'#cc9900' },
    { id:'sv_4', name:'🌸 粉', fill:'#ff66cc', stroke:'#cc44aa' },
    { id:'sv_5', name:'🟣 紫', fill:'#cc66ff', stroke:'#9944cc' },
    { id:'sv_6', name:'🟠 橙', fill:'#ff8844', stroke:'#cc6622' },
    { id:'sv_7', name:'🩵 青', fill:'#44ffcc', stroke:'#22cc99' },
    { id:'sv_8', name:'🧡 橘', fill:'#ff9966', stroke:'#cc7733' },
    { id:'sv_9', name:'🌿 薄荷', fill:'#66ff99', stroke:'#33cc66' },
    { id:'sv_10', name:'🌹 玫红', fill:'#ff6699', stroke:'#cc4477' },
    { id:'sv_11', name:'💠 天蓝', fill:'#66ccff', stroke:'#3399cc' },
];

// ═══════════════════════════════════════
//  游戏状态
// ═══════════════════════════════════════
let selectedMode = null;
let selectedBallType = 'balanced';
let gameState = 'menu'; // menu | countdown | playing | roundEnd | champion | ended
let countdownTimer = 3.2;
let gameTime = 60;
let isOvertime = false;
let spawnTimer = 0;
let lastCountdownStage = -1;

let balls = [], projectiles = [], drops = [], particles = [];
let isRunning = true;

// 多回合
let roundNum = 1;
const WINS_NEEDED = 3;
let scores = { red:0, blue:0 };
let matchHistory = [];
let menuTimer = null;

// ═══════════════════════════════════════
//  输入状态
// ═══════════════════════════════════════
let joystick = { active:false, dx:0, dy:0, knobX:JOYSTICK_X, knobY:JOYSTICK_Y, touchId:-1 };
let attackPressed = false, attackJustPressed = false, attackTouchId = -1;
let p2AttackPressed = false, p2AttackJustPressed = false;
const keys = {};
const isTouchDevice = Platform.isTouchDevice();
let soundEnabled = true;

// 视觉反馈
let screenShake = 0;
let damageFlash = 0;
let guideTimer = 0;

let lastWinner = null;
let killNotifications = [];
let gameOverTab = 0; // 结算界面标签页: 0=全局击杀, 1=团队击杀, 2=个人收益
let resetConfirm = false; // 重置升级确认状态

// 进度系统：金币、升级、连胜
let playerGold = 0;
let totalGoldEarned = 0;
let winStreak = 0;
let bestStreak = 0;
let upgrades = { speed:0, attack:0, hp:0 };
let earnedGold = 0; // 本局获得金币（用于展示）
let goldPopup = 0;  // 金币获得弹窗计时器
const MAX_UPGRADE_LEVEL = 10;
const UPGRADE_COSTS = {
    speed: [30,50,80,120,170, 230,300,380,470,570],
    attack:[30,50,80,120,170, 230,300,380,470,570],
    hp:    [30,50,80,120,170, 230,300,380,470,570],
};
const UPGRADE_EFFECTS = { speed:5, attack:0.05, hp:1 };
const UPGRADE_LABELS = {
    speed: { icon:'💨', name:'速度', desc:'每级 +5 移速' },
    attack:{ icon:'⚔️', name:'攻击', desc:'每级 +5% 伤害' },
    hp:    { icon:'❤️', name:'血量', desc:'每级 +1 血量' },
};

// ─── 段位系统 ───
const TIERS = [
    { name:'青铜', icon:'🥉', minRP:0, maxRP:299, color:'#cd7f32' },
    { name:'白银', icon:'🥈', minRP:300, maxRP:599, color:'#c0c0c0' },
    { name:'黄金', icon:'🥇', minRP:600, maxRP:999, color:'#ffd700' },
    { name:'铂金', icon:'💎', minRP:1000, maxRP:1499, color:'#00e5ff' },
    { name:'钻石', icon:'🏆', minRP:1500, maxRP:2199, color:'#44aaff' },
    { name:'大师', icon:'🌟', minRP:2200, maxRP:2999, color:'#ff66ff' },
    { name:'王者', icon:'👑', minRP:3000, maxRP:9999, color:'#ff4444' },
];
let rankPoints = 0;
let playerCity = '未知';
let friendList = [];
let totalMatches = 0;
let totalWins = 0;

// 外观收集
let unlockedEmblems = [];
let activeEmblem = null;
let totalKills = 0;
let modeWins = {};
// 通行证
let xp = 0;
let passLevel = 1;
let totalXPEarned = 0;

// 称号函数
function getStreakTitle(ws) {
    if (ws >= 20) return { text:'神挡杀神', color:'#ff4444' };
    if (ws >= 10) return { text:'不败传说', color:'#ff8800' };
    if (ws >= 5) return { text:'势不可挡', color:'#ffcc00' };
    if (ws >= 2) return { text:'小试牛刀', color:'#88ccff' };
    return null;
}
function getKillTitle(tk) {
    if (tk >= 1000) return { text:'万人敌', color:'#ff4444' };
    if (tk >= 500) return { text:'修罗', color:'#ff66ff' };
    if (tk >= 100) return { text:'百人斩', color:'#ff8844' };
    return null;
}
function getAllModeTitle() {
    const modes = ['2v2','4v4','team2','team4','ffa','survival','duo_survival'];
    for (const m of modes) { if (!modeWins[m]) return null; }
    return { text:'全能斗士', color:'#ffdd44' };
}
function getActiveTitle() {
    return getStreakTitle(winStreak) || getKillTitle(totalKills) || getAllModeTitle() || null;
}
// 纹章列表
const EMBLEMS = [
    { id:'flame', name:'🔥 火焰纹', unlockAt:3, desc:'连胜 3 场解锁' },
    { id:'lightning', name:'⚡ 闪电纹', unlockAt:5, desc:'连胜 5 场解锁' },
    { id:'skull', name:'💀 骷髅纹', unlockAt:10, desc:'连胜 10 场解锁' },
];
function getRankTier(rp) {
    for (let i = TIERS.length-1; i >= 0; i--) {
        if (rp >= TIERS[i].minRP) return { ...TIERS[i], index:i };
    }
    return { ...TIERS[0], index:0 };
}
function getRankLevel(rp) {
    const t = getRankTier(rp);
    // 段位内有 I/II/III 三级
    const range = t.maxRP - t.minRP;
    const offset = rp - t.minRP;
    const sub = Math.min(3, Math.floor(offset / (range/3)) + 1);
    return sub;
}
function getRankProgress(rp) {
    const t = getRankTier(rp);
    const range = t.maxRP - t.minRP;
    const offset = Math.min(range, Math.max(0, rp - t.minRP));
    return range > 0 ? offset / range : 1;
}

// AI 难度等级（根据 totalLevel 计算）
let aiDifficulty = 0; // 0=easy, 1=medium, 2=hard

function saveProgress() {
    try {
        Platform.setItem('ba_progress', JSON.stringify({
            gold:playerGold, totalGoldEarned, bestStreak,
            upgrades, rankPoints, playerCity, friendList,
            totalMatches, totalWins, xp, passLevel, totalXPEarned,
            totalKills, modeWins, unlockedEmblems, activeEmblem,
            version:3
        }));
    } catch(e) {}
}
function loadProgress() {
    try {
        const d = JSON.parse(Platform.getItem('ba_progress'));
        if (d && d.version) {
            playerGold = d.gold || 0;
            totalGoldEarned = d.totalGoldEarned || 0;
            bestStreak = d.bestStreak || 0;
            upgrades = d.upgrades || { speed:0, attack:0, hp:0 };
            if (d.version >= 2) {
                rankPoints = d.rankPoints || 0;
                playerCity = d.playerCity || '未知';
                friendList = d.friendList || [];
                totalMatches = d.totalMatches || 0;
                totalWins = d.totalWins || 0;
            }
            if (d.version >= 3) {
                xp = d.xp || 0;
                passLevel = d.passLevel || 1;
                totalXPEarned = d.totalXPEarned || 0;
                totalKills = d.totalKills || 0;
                modeWins = d.modeWins || {};
                unlockedEmblems = d.unlockedEmblems || [];
                activeEmblem = d.activeEmblem || null;
            }
        }
    } catch(e) {}
    seedNPCs();
    // 检查纹章解锁（基于 bestStreak）
    for (const e of EMBLEMS) {
        if (bestStreak >= e.unlockAt && !unlockedEmblems.includes(e.id)) {
            unlockedEmblems.push(e.id);
        }
    }
}
// 生成 NPC 排行榜数据
const NPC_NAMES = ['清风','明月','星辰','雷霆','闪电','暴风','烈火','寒冰','落日','飞云',
    '剑魂','刀锋','枪神','箭雨','流星','虎啸','龙吟','凤鸣','麒麟','朱雀',
    '玄武','白虎','青龙','禅心','无痕','绝影','追风','破晓','暗夜','曙光',
    '天行者','地藏','海王','山岳','林语','花落','雪见','霜降','雷鸣','电闪'];
const NPC_CITIES = ['北京','上海','广州','深圳','杭州','成都','武汉','南京','重庆','西安',
    '苏州','天津','长沙','郑州','东莞','青岛','沈阳','宁波','昆明','大连'];
function seedNPCs() {
    try {
        const existing = Platform.getItem('ba_npcs');
        if (existing) return;
        const npcs = [];
        for (let i = 0; i < 50; i++) {
            const rp = Math.floor(Math.random() * 3400 + 100);
            const wins = Math.floor(rp * (0.4 + Math.random() * 0.3));
            const matches = Math.floor(wins * (1.2 + Math.random() * 0.8));
            npcs.push({
                name: NPC_NAMES[i % NPC_NAMES.length] + (i >= NPC_NAMES.length ? (i+1) : ''),
                rp, wins, matches: Math.max(matches, wins),
                city: NPC_CITIES[Math.floor(Math.random() * NPC_CITIES.length)]
            });
        }
        Platform.setItem('ba_npcs', JSON.stringify(npcs));
    } catch(e) {}
}
function getLeaderboard() {
    try {
        const npcs = JSON.parse(Platform.getItem('ba_npcs')) || [];
        // 添加玩家到排行
        const all = npcs.map(n => ({ ...n, isPlayer:false }));
        all.push({ name:'🧑 我', rp:rankPoints, wins:totalWins, matches:totalMatches, city:playerCity, isPlayer:true });
        all.sort((a,b) => b.rp - a.rp);
        return all;
    } catch(e) { return []; }
}
function getAIDifficulty() {
    const total = (upgrades.speed||0) + (upgrades.attack||0) + (upgrades.hp||0);
    if (total >= 16) return 2; // hard
    if (total >= 6) return 1;  // medium
    return 0;                   // easy
}
// 应用升级到球
function applyUpgradesToBall(b, bt) {
    if (!bt) return;
    b.hp = bt.hp + (upgrades.hp||0);
    b.maxHp = b.hp;
    b.speed = SP(bt.speed) + (upgrades.speed||0) * 5;
    b.damageMultiplier = (bt.dmgMul||1) + (upgrades.attack||0) * 0.05;
}

// 毒圈 (生存模式)
const ZONE_PHASES = [
    { radius:350, dmgPerSec:0,  time:30,  label:'准备' },
    { radius:260, dmgPerSec:1,  time:60,  label:'第一阶段' },
    { radius:175, dmgPerSec:2,  time:90,  label:'第二阶段' },
    { radius:100, dmgPerSec:3,  time:120, label:'第三阶段' },
    { radius:60,  dmgPerSec:4,  time:999, label:'决赛圈' },
];
let zoneState = {
    phase:-1, timer:0,
    curRadius:350, curCenterX:CENTER_X, curCenterY:CENTER_Y,
    startRadius:350, startCenterX:CENTER_X, startCenterY:CENTER_Y,
    targetRadius:350, targetCenterX:CENTER_X, targetCenterY:CENTER_Y,
    warning:false, dmgAccum:0
};

// 4v4 名字
const NAMES_4v4_RED = ['🧑玩家', '🤖红·关羽', '🤖红·张飞', '🤖红·赵云'];
const NAMES_4v4_BLUE = ['🤖蓝·海神', '🤖蓝·雅典娜', '🤖蓝·阿瑞斯', '🤖蓝·宙斯'];
const NAMES_SURVIVAL = ['🧑玩家', '🤖猎手', '🤖刺客', '🤖武士', '🤖弓手', '🤖法师', '🤖盗贼', '🤖骑士', '🤖忍者', '🤖拳师', '🤖巫医', '🤖狂战'];

// ═══════════════════════════════════════
//  粒子系统
// ═══════════════════════════════════════
class Particle {
    constructor(x,y,vx,vy,color,life,size) {
        this.x=x;this.y=y;this.vx=vx;this.vy=vy;this.color=color;
        this.life=life;this.maxLife=life;this.size=size||3;
    }
    update(dt) { this.x+=this.vx*dt;this.y+=this.vy*dt;this.life-=dt;this.vx*=0.96;this.vy*=0.96; }
    draw() {
        const a=Math.max(0,this.life/this.maxLife);
        ctx.globalAlpha=a;ctx.fillStyle=this.color;
        ctx.beginPath();ctx.arc(this.x,this.y,this.size*(0.3+a*0.7),0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    }
    get dead(){return this.life<=0}
}
function spawnHitParticles(x,y,color,count=10){
    for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,s=60+Math.random()*200;particles.push(new Particle(x,y,Math.cos(a)*s,Math.sin(a)*s,color,0.2+Math.random()*0.3,2+Math.random()*3));}
    for(let i=0;i<count/2;i++){const a=Math.random()*Math.PI*2,s=40+Math.random()*120;particles.push(new Particle(x,y,Math.cos(a)*s,Math.sin(a)*s,'#ffffff',0.15+Math.random()*0.2,1.5+Math.random()*2));}
}
function spawnKillParticles(x,y,color,kills){
    // 基础爆炸
    let count = 25;
    if (kills >= 6) count = 40;
    else if (kills >= 3) count = 30;
    spawnHitParticles(x,y,color,count);
    // 金色冲击波（所有等级）
    for(let i=0;i<12;i++){const a=Math.random()*Math.PI*2,s=100+Math.random()*300;particles.push(new Particle(x,y,Math.cos(a)*s,Math.sin(a)*s,'#ffdd44',0.4+Math.random()*0.4,3+Math.random()*4));}
    // 中级：光柱 (kills 3-5)
    if (kills >= 3) {
        for (let i=0;i<16;i++) {
            const a = -Math.PI/2 + (i/16-0.5)*0.8;
            const s = 200+Math.random()*200;
            particles.push(new Particle(x+Math.cos(a)*10,y+Math.sin(a)*10,Math.cos(a)*s*0.3,Math.sin(a)*s,'#ffee88',0.5+Math.random()*0.3,3+Math.random()*4));
        }
    }
    // 高级：龙卷风 (kills 6-9)
    if (kills >= 6) {
        for (let i=0;i<30;i++) {
            const a = Math.random()*Math.PI*2;
            const dist = 20+Math.random()*60;
            const rot = Date.now()/100 + i;
            const px = x + Math.cos(a+rot)*dist;
            const py = y + Math.sin(a+rot)*dist;
            const s = 100+Math.random()*300;
            particles.push(new Particle(px,py,Math.cos(a)*s*0.2+Math.cos(rot)*40,Math.sin(a)*s*0.2+Math.sin(rot)*40,'#ffdd44',0.6+Math.random()*0.4,4+Math.random()*6));
        }
    }
    // 超级：核爆 (kills >= 10)
    if (kills >= 10) {
        for (let r=0;r<3;r++) {
            const rad = 20+r*25;
            for (let i=0;i<12;i++) {
                const a = (i/12)*Math.PI*2;
                particles.push(new Particle(x+Math.cos(a)*rad,y+Math.sin(a)*rad,Math.cos(a)*50,Math.sin(a)*50,['#ff4444','#ff8800','#ffdd44'][r],0.5-r*0.1,6-r));
            }
        }
    }
}
function spawnPickupParticles(x,y,color){
    for(let i=0;i<8;i++){const a=Math.random()*Math.PI*2,s=30+Math.random()*80;particles.push(new Particle(x,y,Math.cos(a)*s,Math.sin(a)*s,color,0.3+Math.random()*0.3,2+Math.random()*2));}
}

// ═══════════════════════════════════════
//  音效
// ═══════════════════════════════════════
const sound = {
    _ctx:null,_enabled:true,
    _c(){if(!this._enabled)return null;if(!this._ctx){this._ctx=Platform.createAudioContext();if(!this._ctx){this._enabled=false;return null}}if(this._ctx.state==='suspended')try{this._ctx.resume()}catch(e){}return this._ctx},
    shoot(t){const c=this._c();if(!c)return;const o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);if(t==='melee'){o.type='sawtooth';o.frequency.setValueAtTime(300,c.currentTime);o.frequency.exponentialRampToValueAtTime(80,c.currentTime+0.08)}else{o.frequency.setValueAtTime(1200,c.currentTime);o.frequency.exponentialRampToValueAtTime(300,c.currentTime+0.08)}g.gain.setValueAtTime(0.08,c.currentTime);g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+0.08);o.start(c.currentTime);o.stop(c.currentTime+0.08)},
    hit(){const c=this._c();if(!c)return;const b=c.createBuffer(1,c.sampleRate*0.04,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length);const s=c.createBufferSource();s.buffer=b;const g=c.createGain();s.connect(g);g.connect(c.destination);g.gain.setValueAtTime(0.1,c.currentTime);g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+0.04);s.start(c.currentTime)},
    kill(){const c=this._c();if(!c)return;const o=c.createOscillator(),g=c.createGain();o.type='sine';o.connect(g);g.connect(c.destination);o.frequency.setValueAtTime(200,c.currentTime);o.frequency.exponentialRampToValueAtTime(40,c.currentTime+0.3);g.gain.setValueAtTime(0.18,c.currentTime);g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+0.3);o.start(c.currentTime);o.stop(c.currentTime+0.3)},
    pickup(){const c=this._c();if(!c)return;[523,659,784].forEach((f,i)=>{const o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.setValueAtTime(f,c.currentTime+i*0.07);g.gain.setValueAtTime(0.08,c.currentTime+i*0.07);g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+i*0.07+0.1);o.start(c.currentTime+i*0.07);o.stop(c.currentTime+i*0.07+0.1)})},
    countdown(){const c=this._c();if(!c)return;const o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.setValueAtTime(660,c.currentTime);g.gain.setValueAtTime(0.12,c.currentTime);g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+0.12);o.start(c.currentTime);o.stop(c.currentTime+0.12)},
    gameOver(){const c=this._c();if(!c)return;[262,330,392].forEach((f,i)=>{const o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.setValueAtTime(f,c.currentTime+i*0.12);g.gain.setValueAtTime(0.1,c.currentTime+i*0.12);g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+i*0.12+0.35);o.start(c.currentTime+i*0.12);o.stop(c.currentTime+i*0.12+0.35)})},
};

function triggerShake(intensity){screenShake=Math.max(screenShake,intensity);}

// ═══════════════════════════════════════
//  颜色工具函数
// ═══════════════════════════════════════
function _parseHex(hex) {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return { r:128, g:128, b:128 };
    return { r:parseInt(m[1],16), g:parseInt(m[2],16), b:parseInt(m[3],16) };
}
function lightenColor(hex, pct) {
    const c = _parseHex(hex); const f = pct/100;
    return 'rgb('+Math.min(255,Math.round(c.r+(255-c.r)*f))+','+Math.min(255,Math.round(c.g+(255-c.g)*f))+','+Math.min(255,Math.round(c.b+(255-c.b)*f))+')';
}
function darkenColor(hex, pct) {
    const c = _parseHex(hex); const f = pct/100;
    return 'rgb('+Math.round(c.r*(1-f))+','+Math.round(c.g*(1-f))+','+Math.round(c.b*(1-f))+')';
}

// ═══════════════════════════════════════
//  球
// ═══════════════════════════════════════
class Ball {
    constructor(team, index, x, y) {
        this.team = team; this.index = index;
        this.x = x; this.y = y;
        this.radius = 18; this.hp = 5; this.maxHp = 5;
        this.isAlive = true; this.speed = SP(150);
        this.angle = 0; this.respawnTimer = 0;
        this.isPlayer = false; this.isPlayer2 = false;
        this.name = ''; this.kills = 0;
        this.hurtTimer = 0;
        this.damageMultiplier = 1;

        const initAngle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(initAngle) * this.speed;
        this.vy = Math.sin(initAngle) * this.speed;

        this.weapon = null; this.weaponUses = 0;
        this.attackCD = 0; this.shieldCount = 0; this.shieldTimer = 0;
        this.hasDodge = false; this.dodgeCD = 0;
        this.frozen = 0; this.slowed = 0; this.oobTimer = 0;
        this.speedBoost = 0; // 加速带离开后持续效果计时
        this.boostTimer = 0; // 加速键计时

        // AI
        this.targetX = this.x; this.targetY = this.y;
        this.pickTarget();
        this.changeTimer = 2 + Math.random() * 3;
        this.aiState = 'roam';

        // 拖尾
        this.trail = [];

        // ─── 3D 玻璃球体质感 ───
        this.handPos = [{x:this.x,y:this.y},{x:this.x,y:this.y}]; // 实际手位置
        this.handTarget = [{x:this.x,y:this.y},{x:this.x,y:this.y}]; // 目标手位置
        this.handAnim = { active:false, phase:0, timer:0, type:'ranged' };

        // 能量内核
        this.coreAngle = 0;

        // 表情系统
        this.expression = 'normal';
        this.expressionTimer = 0;
        this.blinkTimer = 2 + Math.random() * 3;
        this._prevKills = 0;

    }

    get color() {
        if (this.team === 'red') return '#ff5050';
        if (this.team === 'blue') return '#50a0ff';
        const f = FFA_COLORS.find(t => t.id === this.team);
        if (f) return f.fill;
        const s = SURVIVAL_COLORS.find(t => t.id === this.team);
        return s ? s.fill : '#888';
    }
    get outline() {
        if (this.team === 'red') return '#cc2020';
        if (this.team === 'blue') return '#2060cc';
        const f = FFA_COLORS.find(t => t.id === this.team);
        if (f) return f.stroke;
        const s = SURVIVAL_COLORS.find(t => t.id === this.team);
        return s ? s.stroke : '#666';
    }

    pickTarget() {
        const r = ARENA_RADIUS * 0.65 * Math.sqrt(Math.random());
        const a = Math.random() * Math.PI * 2;
        this.targetX = CENTER_X + Math.cos(a) * r;
        this.targetY = CENTER_Y + Math.sin(a) * r;
    }

    getSpeedMultiplier() {
        let m = 1;
        if (this.speedBoost > 0) m *= 1.6;
        if (this.boostTimer > 0) m *= BOOST_SPEED_MULT;
        return m;
    }

    update(dt) {
        if (!this.isAlive) {
            if (selectedMode === 'survival' || selectedMode === 'duo_survival') return; // 生存模式不复活
            this.respawnTimer-=dt; if(this.respawnTimer<=0)this.respawn(); return;
        }
        if (this.frozen>0) this.frozen-=dt;
        if (this.slowed>0) this.slowed-=dt;
        if (this.attackCD>0) this.attackCD-=dt;
        if (this.dodgeCD>0) this.dodgeCD-=dt;
        if (this.shieldTimer>0){this.shieldTimer-=dt;if(this.shieldTimer<=0){this.shieldTimer=0;this.shieldCount=0;}}
        if (this.hurtTimer>0) this.hurtTimer=Math.max(0,this.hurtTimer-dt);
        if (this.frozen>0) return;

        // 加速带持续效果（接触刷新3秒，离圈倒计时）
        if (speedZone.active && Math.sqrt(Math.pow(this.x-speedZone.x,2)+Math.pow(this.y-speedZone.y,2)) < speedZone.r) {
            this.speedBoost = 3;
        } else if (this.speedBoost > 0) {
            this.speedBoost -= dt;
        }
        if (this.boostTimer > 0) this.boostTimer -= dt;

        if (this.isPlayer) this._handleP1Input(dt);
        else if (this.isPlayer2) this._handleP2Input(dt);
        else this._handleAI(dt);

        if (!this.isStationary) this._applyCommonPhysics(dt);
        // 拖尾
        this.trail.push({x:this.x,y:this.y});
        if (this.trail.length > 6) this.trail.shift();

        // 手部物理（弹簧阻尼）
        this._updateHands(dt);
        // 能量内核旋转
        this.coreAngle += dt * Math.PI * 2;
        // 表情状态机
        this._updateExpression(dt);
        // 攻击动画
        if (this.handAnim.active) {
            this.handAnim.timer += dt;
            if (this.handAnim.timer > 0.4) this.handAnim.active = false;
        }
    }

    _handleP1Input(dt) {
        const kx=(keys['d']||keys['D']?1:0)-(keys['a']||keys['A']?1:0);
        const ky=(keys['s']||keys['S']?1:0)-(keys['w']||keys['W']?1:0);
        const kb=kx!==0||ky!==0;
        let spd=this.speed*this.getSpeedMultiplier();
        if(this.slowed>0)spd*=0.5;
        if(kb){const l=Math.sqrt(kx*kx+ky*ky);this.vx=(kx/l)*spd;this.vy=(ky/l)*spd;}
        else if(joystick.active&&(Math.abs(joystick.dx)>0.01||Math.abs(joystick.dy)>0.01)){this.vx=joystick.dx*spd;this.vy=joystick.dy*spd;}
        else{this.vx*=0.85;this.vy*=0.85;if(Math.abs(this.vx)<1)this.vx=0;if(Math.abs(this.vy)<1)this.vy=0;}
    }
    _handleP2Input(dt) {
        const kx=(keys['ArrowRight']?1:0)-(keys['ArrowLeft']?1:0);
        const ky=(keys['ArrowDown']?1:0)-(keys['ArrowUp']?1:0);
        const kb=kx!==0||ky!==0;
        let spd=this.speed*this.getSpeedMultiplier();
        if(this.slowed>0)spd*=0.5;
        if(kb){const l=Math.sqrt(kx*kx+ky*ky);this.vx=(kx/l)*spd;this.vy=(ky/l)*spd;}
        else{this.vx*=0.85;this.vy*=0.85;if(Math.abs(this.vx)<1)this.vx=0;if(Math.abs(this.vy)<1)this.vy=0;}
    }
    _handleAI(dt) {
        if (this.isStationary) return;
        let spd=this.speed*this.getSpeedMultiplier();
        if(this.slowed>0)spd*=0.5;
        const hpRatio=this.hp/this.maxHp;
        const enemy=this.findNearest();
        const nearDrop=this._nearestDrop();
        const dDrop=nearDrop?Math.sqrt(Math.pow(nearDrop.x-this.x,2)+Math.pow(nearDrop.y-this.y,2)):Infinity;
        const dEnemy=enemy?Math.sqrt(Math.pow(enemy.x-this.x,2)+Math.pow(enemy.y-this.y,2)):Infinity;
        const fleeRange=[150,200,250][aiDifficulty]||150;
        const chaseRange=[220,280,340][aiDifficulty]||220;
        const wpPickupRange=SP([210,260,300][aiDifficulty]||210);
        const healRange=[280,350,400][aiDifficulty]||280;
        if(hpRatio<0.5&&nearDrop&&nearDrop.data&&nearDrop.data.type==='heal'&&dDrop<healRange){this.aiState='pickup';this.targetX=nearDrop.x;this.targetY=nearDrop.y;}
        else if(hpRatio<0.3&&enemy&&dEnemy<fleeRange){this.aiState="flee";const dx=this.x-enemy.x,dy=this.y-enemy.y,d=Math.sqrt(dx*dx+dy*dy)||1;this.targetX=this.x+(dx/d)*250;this.targetY=this.y+(dy/d)*250;}
        else if(this.weapon&&enemy&&dEnemy<chaseRange){this.aiState="chase";this.targetX=enemy.x;this.targetY=enemy.y;}
        else if(!this.weapon&&nearDrop&&nearDrop.data&&nearDrop.data.type==='weapon'&&dDrop<wpPickupRange){this.aiState="pickup";this.targetX=nearDrop.x;this.targetY=nearDrop.y;}
        else{if(this.aiState!=='roam'){this.aiState='roam';this.pickTarget();this.changeTimer=1+Math.random()*2;}}
        const dx=this.targetX-this.x,dy=this.targetY-this.y,dist=Math.sqrt(dx*dx+dy*dy);
        if(dist>15){const cs=Math.sqrt(this.vx*this.vx+this.vy*this.vy);if(cs>0){const nx=dx/dist,ny=dy/dist,cNx=this.vx/cs,cNy=this.vy/cs,tr=this.aiState==='flee'?6:3;this.vx+=(nx-cNx)*spd*dt*tr;this.vy+=(ny-cNy)*spd*dt*tr;}const s=Math.sqrt(this.vx*this.vx+this.vy*this.vy);if(s>0){this.vx=(this.vx/s)*spd;this.vy=(this.vy/s)*spd;}}
        if(this.aiState==='roam'){this.changeTimer-=dt;if(this.changeTimer<=0){this.pickTarget();this.changeTimer=2+Math.random()*3;}}
    }
    _nearestDrop() {
        let b=null,bd=Infinity;
        for(const d of drops){const dist=Math.pow(d.x-this.x,2)+Math.pow(d.y-this.y,2);if(dist<bd){bd=dist;b=d;}}
        return b;
    }
    _applyCommonPhysics(dt) {
        this.arenaBounce();
        this.ballBounce();
        this.x+=this.vx*dt;this.y+=this.vy*dt;
        this.checkOutOfBounds(dt);
        const spd=Math.sqrt(this.vx*this.vx+this.vy*this.vy);
        if(spd>5)this.angle=Math.atan2(this.vy,this.vx);
    }
    arenaBounce() {
        const dx=this.x-CENTER_X,dy=this.y-CENTER_Y,dist=Math.sqrt(dx*dx+dy*dy);
        if(dist>ARENA_RADIUS-this.radius){const nx=dx/dist,ny=dy/dist,dot=this.vx*nx+this.vy*ny;if(dot>0){this.vx-=2*dot*nx;this.vy-=2*dot*ny;}this.x=CENTER_X+nx*(ARENA_RADIUS-this.radius);this.y=CENTER_Y+ny*(ARENA_RADIUS-this.radius);}
    }
    ballBounce() {
        for(const o of balls){if(o===this||!o.isAlive)continue;const dx=o.x-this.x,dy=o.y-this.y,dist=Math.sqrt(dx*dx+dy*dy),min=this.radius+o.radius;if(dist<min&&dist>0){const nx=dx/dist,ny=dy/dist,ov=min-dist;this.x-=nx*ov/2;this.y-=ny*ov/2;o.x+=nx*ov/2;o.y+=ny*ov/2;const v1=this.vx*nx+this.vy*ny,v2=o.vx*nx+o.vy*ny;if(v1-v2>0){this.vx+=(v2-v1)*nx;this.vy+=(v2-v1)*ny;o.vx+=(v1-v2)*nx;o.vy+=(v1-v2)*ny;}}}
    }
    checkOutOfBounds(dt) {
        const dx=this.x-CENTER_X,dy=this.y-CENTER_Y,dist=Math.sqrt(dx*dx+dy*dy);
        if(dist>ARENA_RADIUS){this.oobTimer+=dt;if(this.oobTimer>=1){this.oobTimer=0;this.takeDamage(1,0,0,'#ff6666');}}else this.oobTimer=0;
    }

    autoAttack() {
        if(!this.weapon||this.attackCD>0||this.weaponUses<=0)return;
        const w=this.weapon;
        if(w.type==='ranged'){this.fire(w);this.attackCD=w.cooldown;this.weaponUses--;if(this.weaponUses<=0)this.weapon=null;sound.shoot('ranged');this._startAttackAnim('ranged');}
        else if(w.type==='melee'){this.swing(w);this.attackCD=w.cooldown;this.weaponUses--;if(this.weaponUses<=0)this.weapon=null;sound.shoot('melee');this._startAttackAnim('melee');}
    }
    findNearest() {
        let b=null,bd=Infinity;
        for(const ball of balls){if(ball===this||!ball.isAlive||ball.team===this.team)continue;const d=Math.pow(ball.x-this.x,2)+Math.pow(ball.y-this.y,2);if(d<bd){bd=d;b=ball;}}
        return b;
    }

    fire(w) {
        const c=w.bulletCount||1;
        for(let i=0;i<c;i++){let a=this.angle;if(w.spread&&c>1){const half=(w.spread/2)*Math.PI/180;a+=(i/(c-1)-0.5)*half*2;}projectiles.push(new Projectile(this.x,this.y,a,w.damage*this.damageMultiplier,w.speed||500,w.range,this.team,w.splash||0,w.splashDmg||0,w.piercing||false,this,w.boomerang||false));}
    }
    swing(w) {
        const arc=w.arc||90;
        // 近战挥击特效: 生成扇形粒子
        const aStart=this.angle-arc/2*Math.PI/180,aEnd=this.angle+arc/2*Math.PI/180;
        for(let i=0;i<12;i++){
            const a=aStart+Math.random()*(aEnd-aStart);
            const dist=20+Math.random()*w.range*0.7;
            const px=this.x+Math.cos(a)*dist,py=this.y+Math.sin(a)*dist;
            const spd=80+Math.random()*160;
            particles.push(new Particle(px,py,Math.cos(a)*spd,Math.sin(a)*spd,'#ffdd44',0.15+Math.random()*0.2,4+Math.random()*4));
        }
        for(let i=0;i<6;i++){
            const a=aStart+Math.random()*(aEnd-aStart);
            const dist=10+Math.random()*w.range*0.5;
            const px=this.x+Math.cos(a)*dist,py=this.y+Math.sin(a)*dist;
            particles.push(new Particle(px,py,Math.cos(a)*30,Math.sin(a)*30,'#ffffff',0.1+Math.random()*0.15,2+Math.random()*3));
        }
        for(const b of balls){if(b===this||!b.isAlive||b.team===this.team)continue;const d=Math.sqrt(Math.pow(b.x-this.x,2)+Math.pow(b.y-this.y,2));if(d>w.range+20)continue;if(arc>=360){const prevHp=b.hp;b.takeDamage(w.damage*this.damageMultiplier,SP(w.knockback||0),this.angle,'#ffcc00');if(!b.isAlive&&prevHp>0)this.kills++;continue;}const eAngle=Math.atan2(b.y-this.y,b.x-this.x);let diff=Math.abs(eAngle-this.angle)*180/Math.PI;if(diff>180)diff=360-diff;if(diff<=arc/2){const prevHp=b.hp;b.takeDamage(w.damage*this.damageMultiplier,SP(w.knockback||0),this.angle,'#ffcc00');if(!b.isAlive&&prevHp>0)this.kills++;}}
    }

    takeDamage(dmg, knockback=0, angle=0, hitColor) {
        if (!this.isAlive) return;
        if (selectedMode==='training' && this.isPlayer) return;
        if (this.shieldCount > 0) { this.shieldCount--; this.shieldTimer = 0; return; }
        this.hp = Math.max(0, this.hp - dmg);
        this.hurtTimer = 1.0;
        spawnHitParticles(this.x, this.y, this.color);
        sound.hit();
        triggerShake(4);
        if (this.isPlayer || this.isPlayer2) damageFlash = Math.min(1, damageFlash + 0.3);
        if (knockback > 0) { this.x += Math.cos(angle)*knockback; this.y += Math.sin(angle)*knockback; }
        if (this.hp <= 0) this.die();
    }

    die() {
        this.isAlive = false; this.respawnTimer = 3;
        spawnKillParticles(this.x, this.y, this.color, this.kills);
        sound.kill();
        // 掉落白苹果
        spawnDropAt(this.x, this.y, 'white_apple');
        // 掉落未用完的武器（含剩余使用次数）
        if (this.weapon && this.weaponUses > 0) {
            const wCopy = { ...this.weapon, uses: this.weaponUses };
            drops.push({ x: this.x, y: this.y, type:'weapon', data: wCopy, spawnTime: Date.now()/1000 });
        }
        this.weapon = null; this.weaponUses = 0; this.shieldCount = 0;
    }

    respawn() {
        this.isAlive = true; this.hp = this.maxHp;
        this.weapon = null; this.weaponUses = 0; this.shieldCount = 0; this.shieldTimer = 0;
        this.frozen = 0; this.slowed = 0;
        const side = this.team==='red'||this.team==='ffa_red'||this.team==='ffa_blue'?-1:1;
        this.x = CENTER_X + side * ARENA_RADIUS * 0.3;
        this.y = CENTER_Y;
        this.pickTarget();
        for(let i=0;i<16;i++){const a=Math.random()*Math.PI*2,s=50+Math.random()*150;particles.push(new Particle(this.x,this.y,Math.cos(a)*s,Math.sin(a)*s,this.color,0.5,3+Math.random()*3));}
    }

    pickupWeapon(w) { if(this.weapon)return;this.weapon={...w,range:SP(w.range),speed:w.speed?SP(w.speed):undefined};this.weaponUses=w.uses;this.attackCD=0; }
    pickupItem(item) {
        switch(item.type){
            case'heal':if(item.target==='self'){if(this.hp>=this.maxHp)return;this.hp=Math.min(this.maxHp,this.hp+(item.value||1));}else{for(const b of balls){if(b.team===this.team&&b.isAlive&&b.hp<(item.value||2))b.hp=Math.min(b.maxHp,b.hp+(item.value||2));}}break;
            case'shield':if(item.target==='self'){this.shieldCount=1;this.shieldTimer=5;}else for(const b of balls){if(b.team===this.team&&b.isAlive){b.shieldCount=1;b.shieldTimer=5;}}break;
            case'magnet':for(const d of drops){const dx=this.x-d.x,dy=this.y-d.y,dist=Math.sqrt(dx*dx+dy*dy);if(dist<200){d.x+=(dx/dist)*10;d.y+=(dy/dist)*10;}}break;
            case'freeze':for(const b of balls){if(b.team!==this.team&&b.isAlive)b.frozen=1.5;}break;
            case'slow':for(const b of balls){if(b.team!==this.team&&b.isAlive)b.slowed=3;}break;
            case'dodge':this.hasDodge=true;break;
        }
    }

    _updateHands(dt) {
        if (!this.isAlive) return;
        const spd = Math.sqrt(this.vx*this.vx+this.vy*this.vy);
        const moveAngle = spd > 10 ? Math.atan2(this.vy, this.vx) : this.angle;
        const r = this.radius;
        for (let h = 0; h < 2; h++) {
            // 垂直于移动方向的附着角
            const perpAngle = moveAngle + (h === 0 ? Math.PI/2 : -Math.PI/2);
            const ax = this.x + Math.cos(perpAngle) * r;
            const ay = this.y + Math.sin(perpAngle) * r;
            // 手掌直接贴在球表面
            let tx = ax;
            let ty = ay;
            // 闲置时手掌微微偏移（增加生动感）
            if (spd <= 10) {
                tx += Math.cos(this.angle) * 2;
                ty += Math.sin(this.angle) * 2;
            }
            // 攻击动画：武器手伸出到前方
            if (this.handAnim.active) {
                const t = this.handAnim.timer;
                if (h === 0) {
                    if (this.handAnim.type === 'ranged') {
                        if (t < 0.1) { tx=this.x+Math.cos(this.angle)*(r+6); ty=this.y+Math.sin(this.angle)*(r+6); }
                        else if (t < 0.18) { tx=this.x+Math.cos(this.angle)*(r+2); ty=this.y+Math.sin(this.angle)*(r+2); }
                    } else {
                        if (t < 0.08) { tx=this.x+Math.cos(this.angle)*(r+1); ty=this.y+Math.sin(this.angle)*(r+1); }
                        else { const sw=(t-0.08)/0.18,sA=this.angle+sw*2.5-1.0;
                            tx=this.x+Math.cos(sA)*(r+5); ty=this.y+Math.sin(sA)*(r+5); }
                    }
                } else {
                    tx -= Math.cos(this.angle)*2*Math.min(1,t*15);
                    ty -= Math.sin(this.angle)*2*Math.min(1,t*15);
                }
            }
            // 低血量抖动
            if (this.hp/this.maxHp<0.3 && this.isAlive) {
                tx += (Math.random()-0.5)*3; ty += (Math.random()-0.5)*3;
            }
            // 更新目标
            this.handTarget[h].x = tx;
            this.handTarget[h].y = ty;
            // lerp 平滑过渡
            this.handPos[h].x += (this.handTarget[h].x - this.handPos[h].x) * Math.min(1, 6 * dt);
            this.handPos[h].y += (this.handTarget[h].y - this.handPos[h].y) * Math.min(1, 6 * dt);
        }
    }

    _updateExpression(dt) {
        if (!this.isAlive) return;
        this.expressionTimer -= dt;
        // 检测击杀→得意
        if (this.kills > this._prevKills) {
            this.expression = 'proud';
            this.expressionTimer = 2;
        }
        this._prevKills = this.kills;
        // 受伤覆盖
        if (this.hurtTimer > 0.3) {
            this.expression = 'hurt';
            this.expressionTimer = 0.5;
        }
        // 攻击表情
        if (this.handAnim.active && this.expressionTimer <= 0) {
            this.expression = 'combat';
        }
        // 残血
        if (this.hp / this.maxHp < 0.3 && this.expressionTimer <= 0) {
            this.expression = 'critical';
        }
        // 眨眼
        if (this.expression === 'normal' || this.expression === 'combat') {
            this.blinkTimer -= dt;
            if (this.blinkTimer <= 0) {
                this.expression = 'blink';
                this.blinkTimer = 0.12;
            }
        }
        if (this.blinkTimer <= 0) this.blinkTimer = 2 + Math.random() * 3;
    }

    _getHandTip(h) {
        const r = this.radius;
        const spd = Math.sqrt(this.vx*this.vx+this.vy*this.vy);
        const moveAngle = spd > 10 ? Math.atan2(this.vy, this.vx) : this.angle;
        const perpAngle = moveAngle + (h === 0 ? Math.PI/2 : -Math.PI/2);
        const ax = this.x + Math.cos(perpAngle) * r;
        const ay = this.y + Math.sin(perpAngle) * r;
        // 手掌直接贴在球表面
        const tx = this.handPos[h].x, ty = this.handPos[h].y;
        return {
            attach: { x:ax, y:ay },
            tip: { x:tx, y:ty }
        };
    }

    _startAttackAnim(type) {
        this.handAnim.active = true;
        this.handAnim.phase = 0;
        this.handAnim.timer = 0;
        this.handAnim.type = type;
    }

    draw() {
        if(!this.isAlive){ctx.globalAlpha=0.3;}
        // 拖尾
        // 拖尾颜色（基于最高连胜）
        const streak = bestStreak;
        const trailGrad = ctx.createLinearGradient(this.x,this.y,this.x+20,this.y+10);
        if (streak >= 10) {
            trailGrad.addColorStop(0,'#ff4400');trailGrad.addColorStop(0.5,'#ff8800');trailGrad.addColorStop(1,'#ffdd00');
        } else if (streak >= 5) {
            const hue = (Date.now()/50)%360;
            trailGrad.addColorStop(0,'hsl('+hue+',100%,60%)');trailGrad.addColorStop(1,'hsl('+((hue+60)%360)+',100%,60%)');
        } else if (streak >= 3) {
            trailGrad.addColorStop(0,'#ffd700');trailGrad.addColorStop(1,'#ffaa00');
        }
        for(let i=0;i<this.trail.length;i++){
            const a=(i/this.trail.length)*0.2,s=this.radius*(0.3+0.7*i/this.trail.length);
            ctx.globalAlpha=a;
            ctx.fillStyle=streak>=3?trailGrad:this.color;
            ctx.beginPath();ctx.arc(this.trail[i].x,this.trail[i].y,s,0,Math.PI*2);ctx.fill();
        }
        ctx.globalAlpha=this.isAlive?1:0.3;
        const r=this.radius;
        const now=Date.now();
        
        // ─── 2. 手掌位置 ───
        const rh=this._getHandTip(0),lh=this._getHandTip(1);
        
        // ─── 3. 球体（径向渐变+高光+暗影）───
        const grad=ctx.createRadialGradient(this.x-r*0.3,this.y-r*0.3,r*0.3,this.x,this.y,r);
        grad.addColorStop(0,lightenColor(this.color,50));
        grad.addColorStop(0.6,this.color);
        grad.addColorStop(0.85,darkenColor(this.color,20));
        grad.addColorStop(1,darkenColor(this.color,40));
        ctx.beginPath();ctx.arc(this.x,this.y,r,0,Math.PI*2);
        ctx.fillStyle=grad;ctx.fill();
        ctx.strokeStyle=this.outline;ctx.lineWidth=2;ctx.stroke();
        // 高光
        ctx.save();ctx.globalAlpha=0.5;
        ctx.beginPath();ctx.ellipse(this.x-r*0.25,this.y-r*0.25,r*0.35,r*0.15,-0.5,0,Math.PI*1.5);
        ctx.fillStyle='rgba(255,255,255,0.4)';ctx.fill();ctx.restore();
        ctx.globalAlpha=this.isAlive?1:0.3;
        // 暗影
        ctx.save();ctx.globalAlpha=0.2;
        ctx.beginPath();ctx.ellipse(this.x+r*0.2,this.y+r*0.2,r*0.3,r*0.12,0.5,0,Math.PI*1.5);
        ctx.fillStyle='rgba(0,0,0,0.2)';ctx.fill();ctx.restore();
        ctx.globalAlpha=this.isAlive?1:0.3;
        
        // ─── 4. 能量内核（旋转光圈）───
        if(this.isAlive){
            const hpR=this.hp/this.maxHp;
            let c1,c2,ca,gs,cs,isS=this.shieldCount>0;
            if(isS){c1='#64c8ff';c2='#2060cc';ca=0.7;gs=6;cs=3;}
            else if(hpR>0.7){c1='#ffdd44';c2='#ff8800';ca=0.8;gs=6;cs=1;}
            else if(hpR>0.3){c1='#ffffff';c2='#aaaacc';ca=0.5;gs=3;cs=1.5;}
            else{c1='#ff3333';c2='#ff0000';ca=0.3+0.7*(0.5+0.5*Math.sin(now/200));gs=4;cs=2;}
            ctx.save();ctx.translate(this.x,this.y);ctx.rotate(this.coreAngle*cs);
            ctx.globalAlpha=ca;ctx.shadowColor=c1;ctx.shadowBlur=gs;
            const cg=ctx.createRadialGradient(0,0,r*0.2,0,0,r*0.45);
            cg.addColorStop(0,c1);cg.addColorStop(1,c2);
            ctx.beginPath();ctx.arc(0,0,r*0.45,0,Math.PI*2);ctx.fillStyle=cg;ctx.fill();
            ctx.shadowBlur=0;ctx.restore();ctx.globalAlpha=this.isAlive?1:0.3;
        }
        
        // ─── 5. 纹章 / 冻结 ───
        const em=activeEmblem&&this.isAlive?activeEmblem:null;
        if(em==='flame'){
            ctx.save();ctx.translate(this.x,this.y);
            for(let i=0;i<3;i++){const a=-0.5+i*0.5+Math.sin(now/300+i)*0.2;
                ctx.fillStyle=i===1?'#ff8800':'#ff4400';ctx.globalAlpha=0.4+0.2*Math.sin(now/200+i);
                ctx.beginPath();ctx.moveTo(0,-3);ctx.quadraticCurveTo(Math.cos(a)*8,-14+Math.sin(now/150+i*2)*3,Math.cos(a)*14,-8);
                ctx.quadraticCurveTo(Math.cos(a)*10,-4,Math.cos(a)*6,0);ctx.fill();
            }ctx.restore();ctx.globalAlpha=this.isAlive?1:0.3;
        }else if(em==='lightning'){
            ctx.save();ctx.translate(this.x,this.y);
            ctx.strokeStyle='#ffdd44';ctx.lineWidth=2.5;ctx.globalAlpha=0.7;
            ctx.shadowColor='#ffdd44';ctx.shadowBlur=8;
            ctx.beginPath();ctx.moveTo(3,-12);ctx.lineTo(-4,-3);ctx.lineTo(2,-3);ctx.lineTo(-3,8);ctx.lineTo(6,-4);ctx.lineTo(0,-4);ctx.closePath();ctx.stroke();
            ctx.shadowBlur=0;ctx.restore();ctx.globalAlpha=this.isAlive?1:0.3;
        }else if(em==='skull'){
            ctx.save();ctx.translate(this.x,this.y);ctx.globalAlpha=0.35;
            ctx.fillStyle='#fff';ctx.strokeStyle='#222';ctx.lineWidth=1;
            ctx.beginPath();ctx.arc(0,-1,6,0,Math.PI*2);ctx.fill();ctx.stroke();
            ctx.fillStyle='#222';ctx.beginPath();ctx.arc(-2.5,-2,1.5,0,Math.PI*2);ctx.fill();
            ctx.beginPath();ctx.arc(2.5,-2,1.5,0,Math.PI*2);ctx.fill();
            ctx.strokeStyle='#222';ctx.lineWidth=1;
            ctx.beginPath();ctx.moveTo(-2,3);ctx.lineTo(2,3);ctx.stroke();
            ctx.beginPath();ctx.moveTo(0,3);ctx.lineTo(0,7);ctx.stroke();
            ctx.fillStyle='#222';ctx.fillRect(-2,4,4,1);
            ctx.restore();ctx.globalAlpha=this.isAlive?1:0.3;
        }
        if(this.frozen>0){ctx.beginPath();ctx.arc(this.x,this.y,r+4,0,Math.PI*2);ctx.strokeStyle='rgba(200,230,255,0.8)';ctx.lineWidth=2;ctx.stroke();}
        
        // ─── 6. 拳击手套（椭圆柱形）───
        const handR=r*0.3;
        for(let h=0;h<2;h++){
            const hp=h===0?rh.tip:lh.tip;
            const spd=Math.sqrt(this.vx*this.vx+this.vy*this.vy);
            const mA=spd>10?Math.atan2(this.vy,this.vx):this.angle;
            const fAngle=mA+(h===0?-1:1)*Math.PI/6;
            const gR=handR*1.15;
            ctx.save();ctx.translate(hp.x,hp.y);ctx.rotate(fAngle);
            // 主体（前大后小的椭圆柱）
            ctx.beginPath();ctx.ellipse(0,0,gR*1.1,gR*0.75,0,0,Math.PI*2);
            ctx.fillStyle='#ffffff';ctx.fill();
            ctx.strokeStyle='#222';ctx.lineWidth=1.5;ctx.stroke();
            // 拇指（内侧凸起）
            const ts=h===0?1:-1;
            ctx.beginPath();ctx.ellipse(-gR*0.05,ts*gR*0.55,gR*0.28,gR*0.22,-0.3,0,Math.PI*2);
            ctx.fillStyle='#ffffff';ctx.fill();
            ctx.strokeStyle='#222';ctx.lineWidth=1.5;ctx.stroke();
            // 红色腕带（后部）
            ctx.fillStyle='#ff4444';
            ctx.beginPath();ctx.ellipse(-gR*0.65,0,gR*0.35,gR*0.6,0,0,Math.PI*2);
            ctx.fill();
            ctx.strokeStyle='#222';ctx.lineWidth=1.5;ctx.stroke();
            // 缝线（拳面弧线）
            ctx.strokeStyle='rgba(0,0,0,0.12)';ctx.lineWidth=0.8;
            ctx.beginPath();ctx.arc(gR*0.15,0,gR*0.45,-0.8,0.8);
            ctx.stroke();
            ctx.restore();
        }
        
        // ─── 7. 表情 ───
        if(this.isAlive){
            const es=r/13,eoX=6*es,eoY=3.5*es,eR=3.5*es,mY=4*es;
            const expr=this.expression;
            if(this.hp/this.maxHp<0.3&&expr!=='hurt'){
                ctx.strokeStyle='rgba(255,0,0,0.4)';ctx.lineWidth=1.5*es;
                ctx.beginPath();ctx.arc(this.x-eoX,this.y-eoY,eR+3*es,0,Math.PI*2);ctx.stroke();
                ctx.beginPath();ctx.arc(this.x+eoX,this.y-eoY,eR+3*es,0,Math.PI*2);ctx.stroke();
            }
            ctx.fillStyle='#222';ctx.strokeStyle='#222';
            if(expr==='hurt'){
                ctx.lineWidth=2.5*es;
                ctx.beginPath();ctx.moveTo(this.x-eoX-eR,this.y-eoY-eR);ctx.lineTo(this.x-eoX+eR,this.y-eoY+eR);
                ctx.moveTo(this.x-eoX+eR,this.y-eoY-eR);ctx.lineTo(this.x-eoX-eR,this.y-eoY+eR);ctx.stroke();
                ctx.beginPath();ctx.moveTo(this.x+eoX-eR,this.y-eoY-eR);ctx.lineTo(this.x+eoX+eR,this.y-eoY+eR);
                ctx.moveTo(this.x+eoX+eR,this.y-eoY-eR);ctx.lineTo(this.x+eoX-eR,this.y-eoY+eR);ctx.stroke();
                ctx.beginPath();ctx.moveTo(this.x-3*es,this.y+mY);
                ctx.quadraticCurveTo(this.x-1.5*es,this.y+mY-2*es,this.x,this.y+mY);
                ctx.quadraticCurveTo(this.x+1.5*es,this.y+mY+2*es,this.x+3*es,this.y+mY);ctx.stroke();
            }else if(expr==='proud'){
                ctx.lineWidth=2.5*es;ctx.lineCap='round';
                ctx.beginPath();ctx.arc(this.x-eoX,this.y-eoY-eR,eR*1.8,Math.PI*0.1,Math.PI*0.9);ctx.stroke();
                ctx.beginPath();ctx.arc(this.x+eoX,this.y-eoY-eR,eR*1.8,Math.PI*0.1,Math.PI*0.9);ctx.stroke();
                ctx.lineCap='butt';
                // 弧形裂齿笑（微笑弧 + 两排白齿 上6下4）
                const tp=Date.now()/40;
                const shX=Math.sin(tp)*1.2,shY=Math.cos(tp*1.3)*0.8;
                const mx=this.x+shX,my=this.y+4*es+shY;
                const mRad=6*es;
                ctx.fillStyle='#000';ctx.strokeStyle='#222';ctx.lineWidth=1.5*es;
                ctx.beginPath();ctx.arc(mx,my+mRad*0.3,mRad,0.1*Math.PI,0.9*Math.PI);ctx.closePath();ctx.fill();ctx.stroke();
                ctx.save();
                ctx.beginPath();ctx.arc(mx,my+mRad*0.3,mRad,0.1*Math.PI,0.9*Math.PI);ctx.closePath();ctx.clip();
                const topY=my+mRad*0.3+mRad*Math.sin(0.1*Math.PI),hw=mRad*Math.cos(0.1*Math.PI);
                const th=mRad*0.35,gap=es*0.3;
                // 上排白齿条 + 5条黑分隔线 → 6颗
                ctx.fillStyle='#fff';ctx.fillRect(mx-hw,topY-0.5,hw*2,th*0.5);
                ctx.strokeStyle='#000';ctx.lineWidth=es;
                for(let i=1;i<6;i++){const lx=mx-hw+i*(hw*2/6);ctx.beginPath();ctx.moveTo(lx,topY);ctx.lineTo(lx,topY+th*0.5);ctx.stroke();}
                // 下排白齿条 + 3条黑分隔线 → 4颗
                ctx.fillStyle='#fff';ctx.fillRect(mx-hw,topY+th*0.5+gap,hw*2,th*0.5-gap);
                ctx.strokeStyle='#000';ctx.lineWidth=es;
                for(let i=1;i<4;i++){const lx=mx-hw+i*(hw*2/4);ctx.beginPath();ctx.moveTo(lx,topY+th*0.5+gap);ctx.lineTo(lx,topY+th);ctx.stroke();}
                ctx.restore();
            }else if(expr==='combat'){
                ctx.lineWidth=2*es;ctx.lineCap='round';
                ctx.beginPath();ctx.moveTo(this.x-eoX-eR,this.y-eoY);ctx.lineTo(this.x-eoX+eR,this.y-eoY);ctx.stroke();
                ctx.lineWidth=2*es;ctx.lineCap='butt';
                ctx.beginPath();ctx.arc(this.x+eoX,this.y-eoY,eR*1.2,0,Math.PI*2);ctx.fill();
                ctx.fillStyle='#222';ctx.strokeStyle='#222';ctx.lineWidth=2*es;ctx.lineCap='round';
                ctx.beginPath();ctx.arc(this.x,this.y+mY,4*es,0.1*Math.PI,0.9*Math.PI);ctx.stroke();
                ctx.lineWidth=1*es;
                for(let t=-2;t<=2;t+=1){ctx.beginPath();ctx.moveTo(this.x+t*es*1.5,this.y+mY+es);ctx.lineTo(this.x+t*es*1.5,this.y+mY-0.5*es);ctx.stroke();}
                ctx.lineCap='butt';
            }else if(expr==='critical'){
                ctx.beginPath();ctx.arc(this.x-eoX,this.y-eoY,eR*1.3,0,Math.PI*2);ctx.fill();
                ctx.beginPath();ctx.arc(this.x+eoX,this.y-eoY,eR*1.3,0,Math.PI*2);ctx.fill();
                ctx.fillStyle='#fff';
                ctx.beginPath();ctx.arc(this.x-eoX,this.y-eoY,eR*0.5,0,Math.PI*2);ctx.fill();
                ctx.beginPath();ctx.arc(this.x+eoX,this.y-eoY,eR*0.5,0,Math.PI*2);ctx.fill();
                ctx.fillStyle='#222';ctx.strokeStyle='#222';ctx.lineWidth=2*es;
                ctx.beginPath();ctx.moveTo(this.x-3*es,this.y+mY);ctx.lineTo(this.x+3*es,this.y+mY);ctx.stroke();
                for(let t=-2;t<=2;t+=1){ctx.beginPath();ctx.moveTo(this.x+t*es*1.5,this.y+mY);ctx.lineTo(this.x+t*es*1.5+0.3,this.y+mY-1.5*es);ctx.lineTo(this.x+t*es*1.5+0.6,this.y+mY);ctx.stroke();}
            }else if(expr==='blink'){
                ctx.lineWidth=2.5*es;ctx.lineCap='round';
                ctx.beginPath();ctx.moveTo(this.x-eoX-eR,this.y-eoY);ctx.lineTo(this.x-eoX+eR,this.y-eoY);ctx.stroke();
                ctx.beginPath();ctx.moveTo(this.x+eoX-eR,this.y-eoY);ctx.lineTo(this.x+eoX+eR,this.y-eoY);ctx.stroke();
                ctx.lineCap='butt';
                ctx.strokeStyle='#222';ctx.lineWidth=2*es;
                ctx.beginPath();ctx.arc(this.x,this.y+mY,3*es,0.15*Math.PI,0.85*Math.PI);ctx.stroke();
            }else{
                ctx.beginPath();ctx.arc(this.x-eoX,this.y-eoY,eR,0,Math.PI*2);ctx.fill();
                ctx.beginPath();ctx.arc(this.x+eoX,this.y-eoY,eR,0,Math.PI*2);ctx.fill();
                ctx.strokeStyle='#222';ctx.lineWidth=2*es;
                ctx.beginPath();ctx.arc(this.x,this.y+mY,3*es,0.15*Math.PI,0.85*Math.PI);ctx.stroke();
            }
        }
        
        // ─── 8. 武器（画在右手旁）───
        const wx=rh.tip.x+Math.cos(this.angle)*6,wy=rh.tip.y+Math.sin(this.angle)*6;
        if(this.weapon){
            const wScale = 1.5 * Math.sqrt(ARENA_RADIUS / 525);
            ctx.save();ctx.translate(wx,wy);ctx.rotate(this.angle);ctx.scale(wScale,wScale);
            ctx.lineWidth=1.5;ctx.strokeStyle='#222';
            switch(this.weapon.id){
                case'single_gun':
                    ctx.fillStyle='#88aacc';ctx.beginPath();ctx.moveTo(0,1);ctx.lineTo(9,-3);ctx.lineTo(14,-3);ctx.lineTo(14,3);ctx.lineTo(9,3);ctx.closePath();ctx.fill();ctx.stroke();
                    ctx.fillStyle='#667788';ctx.fillRect(10,-2,6,4);ctx.strokeRect(10,-2,6,4);
                    ctx.fillStyle='#ffdd44';ctx.beginPath();ctx.arc(16,0,1.5,0,Math.PI*2);ctx.fill();ctx.stroke();
                    ctx.fillStyle='#8B5E3C';ctx.fillRect(0,1,5,4);ctx.strokeRect(0,1,5,4);
                    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(6,-1,1,0,Math.PI*2);ctx.fill();break;
                case'triple_gun':
                    ctx.fillStyle='#556677';ctx.fillRect(0,-3,7,6);ctx.strokeRect(0,-3,7,6);
                    for(let i=-1;i<=1;i++){
                        ctx.fillStyle='#8899aa';ctx.beginPath();ctx.arc(9,i*3.5,2.5,0,Math.PI*2);ctx.fill();ctx.stroke();
                        ctx.fillStyle='#ff6633';ctx.beginPath();ctx.arc(9,i*3.5,1.2,0,Math.PI*2);ctx.fill();
                        ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(8.5,i*3.5-0.5,0.6,0,Math.PI*2);ctx.fill();
                    }break;
                case'brick':
                    ctx.fillStyle='#cc8844';ctx.fillRect(0,-6,11,11);ctx.strokeRect(0,-6,11,11);
                    ctx.strokeStyle='#996633';ctx.lineWidth=0.5;
                    ctx.beginPath();ctx.moveTo(5,-6);ctx.lineTo(5,5);ctx.moveTo(0,-1);ctx.lineTo(11,-1);ctx.stroke();
                    ctx.fillStyle='#ff4444';ctx.font=`bold ${S(12)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillText('!',5,2);
                    ctx.strokeStyle='#222';ctx.lineWidth=1.5;break;
                case'dagger':
                    ctx.fillStyle='#d0d8e8';ctx.beginPath();ctx.moveTo(14,0);ctx.lineTo(2,-4);ctx.lineTo(2,4);ctx.closePath();ctx.fill();ctx.stroke();
                    ctx.fillStyle='#884466';ctx.fillRect(2,-2,4,4);ctx.strokeRect(2,-2,4,4);
                    ctx.fillStyle='#ff88cc';ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fill();ctx.stroke();
                    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(10,-1,1.2,0,Math.PI*2);ctx.fill();break;
                case'big_sword':
                    ctx.fillStyle='#88ccff';ctx.beginPath();ctx.moveTo(20,0);ctx.lineTo(2,-6);ctx.lineTo(6,0);ctx.lineTo(2,6);ctx.closePath();ctx.fill();ctx.stroke();
                    ctx.fillStyle='#66aadd';ctx.beginPath();ctx.moveTo(20,0);ctx.lineTo(8,-2);ctx.lineTo(8,2);ctx.closePath();ctx.fill();
                    ctx.fillStyle='#8B5E3C';ctx.fillRect(0,-2,4,4);ctx.strokeRect(0,-2,4,4);
                    ctx.fillStyle='#ffcc44';ctx.fillRect(4,-1,2,2);
                    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(14,-1,1,0,Math.PI*2);ctx.fill();break;
                case'staff':
                    ctx.fillStyle='#8B5E3C';ctx.fillRect(0,-1.5,12,3);ctx.strokeRect(0,-1.5,12,3);
                    ctx.fillStyle='#44ff88';ctx.beginPath();ctx.arc(12,0,4.5,0,Math.PI*2);ctx.fill();ctx.stroke();
                    ctx.fillStyle='#aaffcc';ctx.beginPath();ctx.arc(12,0,2.5,0,Math.PI*2);ctx.fill();
                    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(11,-1,1,0,Math.PI*2);ctx.fill();
                    ctx.fillStyle='#44ff88';ctx.font=`${S(9)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillText('✦',14,-5);break;
                case'laser_gun':
                    ctx.fillStyle='#778899';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(6,-3);ctx.lineTo(18,-3);ctx.lineTo(18,3);ctx.lineTo(6,3);ctx.closePath();ctx.fill();ctx.stroke();
                    ctx.fillStyle='#ff3344';ctx.fillRect(14,-2,6,4);ctx.strokeRect(14,-2,6,4);
                    ctx.fillStyle='#ffaa88';ctx.fillRect(14,-1,6,2);
                    ctx.fillStyle='#445566';ctx.fillRect(4,-1,2,2);
                    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(10,-1,1,0,Math.PI*2);ctx.fill();break;
                case'shotgun':
                    ctx.fillStyle='#8899aa';ctx.fillRect(0,-5,8,10);ctx.strokeRect(0,-5,8,10);
                    for(let i=-1;i<=1;i+=2){
                        ctx.fillStyle='#667788';ctx.beginPath();ctx.arc(9,i*3,2.5,0,Math.PI*2);ctx.fill();ctx.stroke();
                        ctx.fillStyle='#ff8844';ctx.beginPath();ctx.arc(9,i*3,1.2,0,Math.PI*2);ctx.fill();
                    }
                    ctx.fillStyle='#8B5E3C';ctx.fillRect(0,-1,4,2);ctx.strokeRect(0,-1,4,2);
                    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(4,-3,1,0,Math.PI*2);ctx.fill();break;
                case'boomerang':
                    const rot2=Date.now()/100;ctx.rotate(-this.angle);
                    ctx.translate(6,0);ctx.rotate(rot2);
                    const bCols=[{f:'#fff',s:'#ccc'},{f:'#222',s:'#444'},{f:'#fff',s:'#ccc'},{f:'#222',s:'#444'}];
                    for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.fillStyle=bCols[i].f;ctx.strokeStyle=bCols[i].s;
                        ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*9,Math.sin(a)*9);ctx.lineTo(Math.cos(a+0.5)*4,Math.sin(a+0.5)*4);ctx.closePath();ctx.fill();ctx.stroke();}
                    ctx.fillStyle='#888';ctx.beginPath();ctx.arc(0,0,2,0,Math.PI*2);ctx.fill();
                    break;
            }
            ctx.fillStyle='#fff';ctx.font=`bold ${S(14)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(this.weaponUses,8,-10);
            ctx.restore();
        }
        // ─── 9. 称号 ───
        const title=this.isPlayer?getActiveTitle():(this.isPlayer2?getStreakTitle(bestStreak):null);
        const label=this.isPlayer?'P1':(this.isPlayer2?'P2':'');
        if(title){
            ctx.globalAlpha=1;
            ctx.font=`bold ${S(15)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='bottom';
            ctx.fillStyle=title.color;
            ctx.fillText('「'+title.text+'」',this.x,this.y-r-28-(label?10:0));
        }
        // ─── 10. 名字 ───
        ctx.globalAlpha=1;
        ctx.font=`${S(17)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='bottom';
        ctx.fillStyle=this.isPlayer2?'#ffff88':(this.team==='red'?'#ff8888':'#88bbff');
        ctx.fillText(this.name,this.x,this.y-r-16);
        if(label){ctx.font=`bold ${S(14)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ffff88';ctx.textBaseline='bottom';ctx.fillText('['+label+']',this.x,this.y-r-SP(28));}
        // ─── 11. HP 条 ───
        const bw=SP(45),bh=SP(6),bx=this.x-bw/2,by=this.y-r-SP(11);
        ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(bx,by,bw,bh);
        const hr=this.hp/this.maxHp;ctx.fillStyle=hr>0.5?'#44ff44':(hr>0.25?'#ff8800':'#ff3333');ctx.fillRect(bx,by,bw*hr,bh);
        // ─── 12. 护甲环 ───
        if(this.shieldCount>0&&this.shieldTimer>0){const sa=this.shieldTimer<1?(Math.floor(Date.now()/150)%2===0?0.9:0):0.6;ctx.beginPath();ctx.arc(this.x,this.y,r+7,0,Math.PI*2);ctx.strokeStyle='rgba(100,200,255,'+sa+')';ctx.lineWidth=3;ctx.stroke();}
        ctx.globalAlpha=1;
    }
}

// ═══════════════════════════════════════
//  子弹
// ═══════════════════════════════════════
class Projectile {
    constructor(x,y,angle,damage,speed,range,team,splash,splashDmg,piercing,owner,boomerang=false){
        this.x=x;this.y=y;this.prevX=x;this.prevY=y;
        this.vx=Math.cos(angle)*speed;this.vy=Math.sin(angle)*speed;
        this.damage=damage;this.range=range;this.team=team;
        this.distTraveled=0;this.splash=splash;this.splashDmg=splashDmg;
        this.speed=speed;this.piercing=piercing;this.owner=owner;
        this.boomerang=boomerang;this.returning=false;this.travelTime=0;
        this.trail=[];
    }
    update(dt) {
        this.prevX=this.x;this.prevY=this.y;
        this.trail.push({x:this.x,y:this.y});
        if(this.trail.length>8)this.trail.shift();

        if (this.boomerang) {
            this.travelTime += dt;
            this.distTraveled += this.speed * dt;

            if (!this.returning) {
                // 飞出阶段
                this.x += this.vx * dt;
                this.y += this.vy * dt;
                if (this.travelTime > 0.45 || this.distTraveled > SP(250)) {
                    this.returning = true;
                }
            } else {
                // 回旋阶段：追踪发射者（速度一致）
                if (this.owner && this.owner.isAlive) {
                    const dx = this.owner.x - this.x;
                    const dy = this.owner.y - this.y;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    if (dist < SP(30)) return true; // 回到手中
                    const spd = this.speed * 1.0;
                    this.vx = (dx/dist) * spd;
                    this.vy = (dy/dist) * spd;
                }
                this.x += this.vx * dt;
                this.y += this.vy * dt;
                if (this.distTraveled > SP(900)) return true; // 飞太远了
            }

            // 回旋镖全程检测碰撞（穿透伤害）
            for(const b of balls){
                if(!b.isAlive||b.team===this.team)continue;
                const d=Math.sqrt(Math.pow(b.x-this.x,2)+Math.pow(b.y-this.y,2));
                if(d<25){
                    const prevHp=b.hp;
                    b.takeDamage(this.damage, 0, 0, '#ffaa44');
                    if(!b.isAlive&&prevHp>0&&this.owner&&this.owner.isAlive)this.owner.kills++;
                    spawnHitParticles(b.x, b.y, '#ffaa44', 5);
                }
            }
            return false;
        }

        // 普通子弹
        this.x+=this.vx*dt;this.y+=this.vy*dt;
        this.distTraveled+=this.speed*dt;
        if(this.distTraveled>this.range)return true;
        // 球碰撞
        for(const b of balls){
            if(!b.isAlive||b.team===this.team)continue;
            const d=Math.sqrt(Math.pow(b.x-this.x,2)+Math.pow(b.y-this.y,2));
            if(d<25){
                const prevHp=b.hp;
                b.takeDamage(this.damage,0,0,this.team==='red'?'#ff8888':'#88bbff');
                if(!b.isAlive&&prevHp>0&&this.owner&&this.owner.isAlive)this.owner.kills++;
                else if(!b.isAlive&&prevHp>0){} // killed by projectile from dead owner or no owner
                if(this.splash>0){for(const o of balls){if(o===b||!o.isAlive)continue;const d2=Math.sqrt(Math.pow(o.x-b.x,2)+Math.pow(o.y-b.y,2));if(d2<this.splash){o.takeDamage(this.splashDmg);spawnHitParticles(o.x,o.y,o.color,6);}}}
                if(!this.piercing)return true;
                this.damage*=0.7;
                if(this.damage<0.3)return true;
            }
        }
        return false;
    }
    draw() {
        // 拖尾
        for(let i=0;i<this.trail.length;i++){
            const a=i/this.trail.length*0.35;
            const s=1.5+i/this.trail.length*2;
            ctx.globalAlpha=a;
            ctx.fillStyle=this.boomerang?'#888888':(this.piercing?'#ff4444':(this.splash>0?'#b08050':'#ffdd88'));
            ctx.beginPath();ctx.arc(this.trail[i].x,this.trail[i].y,s,0,Math.PI*2);ctx.fill();
        }
        ctx.globalAlpha=1;
        if(this.boomerang){
            const rot=Date.now()/120;
            ctx.save();ctx.translate(this.x,this.y);ctx.rotate(rot);
            ctx.shadowColor='#aaa';ctx.shadowBlur=8;
            const bladeSides=[{f:'#fff',s:'#ccc'},{f:'#222',s:'#444'},{f:'#fff',s:'#ccc'},{f:'#222',s:'#444'}];
            for(let i=0;i<4;i++){
                const a=i*Math.PI/2;
                ctx.fillStyle=bladeSides[i].f;ctx.strokeStyle=bladeSides[i].s;
                ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*9,Math.sin(a)*9);
                ctx.lineTo(Math.cos(a+0.5)*4,Math.sin(a+0.5)*4);ctx.closePath();ctx.fill();ctx.stroke();
            }
            ctx.shadowBlur=0;ctx.restore();
        }else if(this.piercing){
            ctx.save();ctx.shadowColor='#ff4444';ctx.shadowBlur=12;
            ctx.strokeStyle='#ff4444';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(this.prevX,this.prevY);ctx.lineTo(this.x,this.y);ctx.stroke();
            ctx.strokeStyle='#ffaaaa';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(this.prevX,this.prevY);ctx.lineTo(this.x,this.y);ctx.stroke();
            ctx.restore();
        }else if(this.splash>0){ctx.beginPath();ctx.arc(this.x,this.y,6,0,Math.PI*2);ctx.fillStyle='#b08050';ctx.fill();ctx.strokeStyle='#806040';ctx.lineWidth=1;ctx.stroke();}
        else{ctx.beginPath();ctx.arc(this.x,this.y,4,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();}
    }
}

// ═══════════════════════════════════════
//  掉落
// ═══════════════════════════════════════
function randomWeapon(){
    const total=WEAPONS.reduce((s,w)=>s+(w.weight||10),0);
    let r=Math.random()*total;
    for(const w of WEAPONS){r-=(w.weight||10);if(r<=0)return w;}
    return WEAPONS[0];
}
function randomItem(){const t=ITEMS.reduce((s,i)=>s+i.weight,0);let r=Math.random()*t;for(const i of ITEMS){r-=i.weight;if(r<=0)return i;}return ITEMS[0];}
function spawnDrop(){if(Math.random()<0.5)spawnWeaponDrop();else spawnItemDrop();}
function spawnWeaponDrop(){const w=randomWeapon(),r=ARENA_RADIUS*0.55*Math.sqrt(Math.random()),a=Math.random()*Math.PI*2;drops.push({x:CENTER_X+Math.cos(a)*r,y:CENTER_Y+Math.sin(a)*r,type:'weapon',data:w,spawnTime:Date.now()/1000});}
function spawnItemDrop(){const item=randomItem(),r=ARENA_RADIUS*0.55*Math.sqrt(Math.random()),a=Math.random()*Math.PI*2;drops.push({x:CENTER_X+Math.cos(a)*r,y:CENTER_Y+Math.sin(a)*r,type:'item',data:item,spawnTime:Date.now()/1000});}
function spawnDropAt(x,y,itemId){const item=ITEMS.find(i=>i.id===itemId);if(item)drops.push({x,y,type:'item',data:item,spawnTime:Date.now()/1000});}

// ═══════════════════════════════════════
//  初始化
// ═══════════════════════════════════════
function initGame() {
    balls=[];projectiles=[];drops=[];particles=[];killNotifications=[];
    gameTime=60;isOvertime=false;gameState='countdown';countdownTimer=3.2;
    spawnTimer=0;lastCountdownStage=-1;
    joystick.active=false;joystick.dx=0;joystick.dy=0;
    joystick.knobX=JOYSTICK_X;joystick.knobY=JOYSTICK_Y;
    joystick.touchId=-1;attackPressed=false;p2AttackPressed=false;
    boostCooldown=0;boostPressed=false;

    lastWinner = null; gameOverTab = 0;
    // 首次启动指引
    if (!Platform.getItem('guide_shown') && guideTimer === 0) guideTimer = 3;
    // 重置毒圈
    zoneState = { phase:-1, timer:0, curRadius:ARENA_RADIUS, curCenterX:CENTER_X, curCenterY:CENTER_Y, startRadius:ARENA_RADIUS, startCenterX:CENTER_X, startCenterY:CENTER_Y, targetRadius:ARENA_RADIUS, targetCenterX:CENTER_X, targetCenterY:CENTER_Y, warning:false, dmgAccum:0 };
    // 重置加速带
    speedZone = { active:false, x:0, y:0, r:SP(70), boost:1.6, timer:0 };
    if (selectedMode === 'survival' || selectedMode === 'duo_survival') gameTime = 400;
    aiDifficulty = getAIDifficulty();
    // 段位匹配难度递增（叠加）
    const rankDiff = rankPoints >= 1000 ? 2 : (rankPoints >= 300 ? 1 : 0);
    if (rankDiff > aiDifficulty) aiDifficulty = rankDiff;

    const bt = BALL_TYPES.find(t=>t.id===selectedBallType)||BALL_TYPES[0];

    if (selectedMode === 'training') {
        const b = new Ball('red', 0, CENTER_X, CENTER_Y);
        b.isPlayer = true; b.name = '🧑训练生';
        b.radius = SP(bt.radius); applyUpgradesToBall(b, bt);
        balls.push(b);
        b.pickupWeapon(WEAPONS.find(w=>w.id==='single_gun'));
        // 静止木桩机器人
        const dummy = new Ball('blue', 1, CENTER_X + 120, CENTER_Y);
        dummy.isStationary = true; dummy.name = '🎯 训练木桩';
        dummy.hp = 20; dummy.maxHp = 20; dummy.radius = SP(20);
        balls.push(dummy);
        // 所有武器道具沿内圈固定摆放
        const trainingItems = [];
        for (const w of WEAPONS) trainingItems.push({ type:'weapon', data:{...w} });
        for (const item of ITEMS) trainingItems.push({ type:'item', data:{...item} });
        const circleR = ARENA_RADIUS * 0.72;
        for (let i = 0; i < trainingItems.length; i++) {
            const angle = (i / trainingItems.length) * Math.PI * 2;
            const x = CENTER_X + Math.cos(angle) * circleR;
            const y = CENTER_Y + Math.sin(angle) * circleR;
            drops.push({ x, y, originX:x, originY:y, type:trainingItems[i].type,
                data:trainingItems[i].data, spawnTime:Date.now()/1000,
                isTrainingDrop:true, respawnTimer:0 });
        }
        return;
    }

    if (selectedMode === 'ffa') {
        const ffaNames = ['🧑玩家', '🤖战神', '🤖海神', '🤖雅典娜', '🤖雷神', '🤖月神', '🤖太阳神', '🤖冥王'];
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
            const r = 80;
            const x = CENTER_X + Math.cos(angle) * r;
            const y = CENTER_Y + Math.sin(angle) * r;
            const b = new Ball(FFA_COLORS[i].id, i, x, y);
            b.name = ffaNames[i];
            b.radius = SP(bt.radius);
            if (i === 0) { b.isPlayer = true; applyUpgradesToBall(b, bt); }
            balls.push(b);
        }
        return;
    }

    if (selectedMode === 'survival') {
        for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = 50 + Math.random() * (ARENA_RADIUS - 100);
            const x = CENTER_X + Math.cos(a) * r;
            const y = CENTER_Y + Math.sin(a) * r;
            const b = new Ball(SURVIVAL_COLORS[i].id, i, x, y);
            b.name = NAMES_SURVIVAL[i];
            b.hp = 4; b.maxHp = 4;
            b.radius = SP(bt.radius);
            if (i === 0) { b.isPlayer = true; applyUpgradesToBall(b, bt); }
            balls.push(b);
        }
        return;
    }

    if (selectedMode === 'duo_survival') {
        const teamColors = SURVIVAL_COLORS.slice(0, 6);
        const teamNames = [
            ['🧑玩家', '👤队友'],
            ['🤖赤·鬼丸', '🤖赤·影'],
            ['🤖蓝·冰牙', '🤖蓝·霜'],
            ['🤖绿·翠风', '🤖绿·岚'],
            ['🤖金·光', '🤖金·闪'],
            ['🤖粉·桃', '🤖粉·樱'],
        ];
        for (let t = 0; t < 6; t++) {
            for (let m = 0; m < 2; m++) {
                const a = Math.random() * Math.PI * 2;
                const r = 50 + Math.random() * (ARENA_RADIUS - 100);
                const x = CENTER_X + Math.cos(a) * r;
                const y = CENTER_Y + Math.sin(a) * r;
                const idx = t * 2 + m;
                const b = new Ball(teamColors[t].id, idx, x, y);
                b.name = teamNames[t][m];
                b.hp = 4; b.maxHp = 4;
                b.radius = SP(bt.radius);
                if (t === 0 && m === 0) { b.isPlayer = true; applyUpgradesToBall(b, bt); }
                if (t === 0 && m === 1) { b.isPlayer2 = true; applyUpgradesToBall(b, bt); }
                balls.push(b);
            }
        }
        return;
    }

    // 2v2 / 4v4 / team2 / team4
    const isCoop = selectedMode === 'team2' || selectedMode === 'team4';
    const total = (selectedMode === '4v4' || selectedMode === 'team4') ? 8 : 4;
    const half = total / 2;
    const redNames = (selectedMode === '4v4' || selectedMode === 'team4') ? NAMES_4v4_RED : ['🧑玩家','🤖红队·战神'];
    const blueNames = (selectedMode === '4v4' || selectedMode === 'team4') ? NAMES_4v4_BLUE : ['🤖蓝队·海神','🤖蓝队·雅典娜'];
    for(let i=0;i<total;i++){
        const team=i<half?'red':'blue';
        const side=team==='red'?-1:1;
        const row = i % half;
        const offset = row - (half-1)/2;
        const spacing = half <= 2 ? 50 : Math.min(45, 300/half);
        const x=CENTER_X+side*ARENA_RADIUS*0.28;
        const y=CENTER_Y+offset*spacing;
        const b=new Ball(team,i,x,y);
        if(team==='red'){
            b.name=redNames[row];
            if(i===0){b.isPlayer=true;b.radius=SP(bt.radius); applyUpgradesToBall(b, bt);}
            else if(isCoop && row===1){b.isPlayer2=true;b.radius=SP(bt.radius); applyUpgradesToBall(b, bt);}
        }
        else{
            b.name=blueNames[row];
            if(!isCoop && row===0)b.isPlayer2=true;
        }
        balls.push(b);
    }

    // 根据难度提升机器人血量
    const botHpBonus = [0, 1, 2][aiDifficulty] || 0;
    if (botHpBonus > 0) {
        for (const b of balls) {
            if (!b.isPlayer && !b.isPlayer2) {
                b.hp += botHpBonus;
                b.maxHp += botHpBonus;
            }
        }
    }
}

// ═══════════════════════════════════════
//  坐标转换
// ═══════════════════════════════════════
function screenToCanvas(cx,cy){
    if (Platform.name === 'browser') {
        const r = canvas.getBoundingClientRect();
        return { x: (cx - r.left) * (canvas.width / r.width), y: (cy - r.top) * (canvas.height / r.height) };
    }
    // 微信/抖音：canvas = 屏幕 CSS 像素尺寸，1:1 映射到 GAME_W/GAME_H
    return { x: cx * (GAME_W / canvas.width), y: cy * (GAME_H / canvas.height) };
}

// ═══════════════════════════════════════
//  摇杆 & 攻击键
// ═══════════════════════════════════════
function updateJoystickPos(cx,cy){
    const dx=cx-JOYSTICK_X,dy=cy-JOYSTICK_Y,dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<=JOYSTICK_DEADZONE){joystick.dx=0;joystick.dy=0;joystick.knobX=JOYSTICK_X;joystick.knobY=JOYSTICK_Y;return;}
    let nx=dx/JOYSTICK_RADIUS,ny=dy/JOYSTICK_RADIUS;const nd=Math.sqrt(nx*nx+ny*ny);
    if(nd>1){nx/=nd;ny/=nd;}
    joystick.dx=Math.max(-1,Math.min(1,nx));joystick.dy=Math.max(-1,Math.min(1,ny));
    joystick.knobX=JOYSTICK_X+joystick.dx*JOYSTICK_RADIUS;joystick.knobY=JOYSTICK_Y+joystick.dy*JOYSTICK_RADIUS;
}
function resetJoystick(){joystick.active=false;joystick.dx=0;joystick.dy=0;joystick.knobX=JOYSTICK_X;joystick.knobY=JOYSTICK_Y;joystick.touchId=-1;}
function isInJoystick(mx,my){return Math.sqrt(Math.pow(mx-JOYSTICK_X,2)+Math.pow(my-JOYSTICK_Y,2))<=JOYSTICK_RADIUS*1.5;}
function isInAttack(mx,my){return Math.sqrt(Math.pow(mx-ATTACK_X,2)+Math.pow(my-ATTACK_Y,2))<=ATTACK_RADIUS*1.5;}
function isInBoost(mx,my){return Math.sqrt(Math.pow(mx-BOOST_X,2)+Math.pow(my-BOOST_Y,2))<=BOOST_RADIUS*1.5;}

// ═══════════════════════════════════════
//  键盘
// ═══════════════════════════════════════
Platform.onKeyDown((e)=>{
    keys[e.key]=true;
    if(e.key===' '||e.key==='j'||e.key==='J'){attackPressed=true;attackJustPressed=true;e.preventDefault();}
    if(e.key==='Enter'){p2AttackPressed=true;p2AttackJustPressed=true;e.preventDefault();}
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))e.preventDefault();
    if(e.key==='m'||e.key==='M'){soundEnabled=!soundEnabled;sound._enabled=soundEnabled;sound._c();}
    if(e.key==='Shift'){boostPressed=true;}
    if(e.key==='Escape'&&(selectedMode==='training'||gameState==='playing'||gameState==='countdown')){gameState='menu';e.preventDefault();}
});
Platform.onKeyUp((e)=>{
    keys[e.key]=false;
    if(e.key===' '||e.key==='j'||e.key==='J'){attackPressed=false;e.preventDefault();}
    if(e.key==='Enter'){p2AttackPressed=false;e.preventDefault();}
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))e.preventDefault();
});

// ═══════════════════════════════════════
//  鼠标
// ═══════════════════════════════════════
Platform.onMouseDown(canvas,(e)=>{
    const {x,y}=screenToCanvas(e.clientX,e.clientY);
    if(guideTimer>0){guideTimer=0;Platform.setItem('guide_shown','1');}
    if(x>=SX(50)&&x<=SX(104)&&y>=S(26)&&y<=S(80)){soundEnabled=!soundEnabled;sound._enabled=soundEnabled;return;}
    if(gameState!=='menu'&&x>=GAME_W-SX(110)&&x<=GAME_W-SX(56)&&y>=S(26)&&y<=S(80)){gameState='menu';return;}
    if(gameState==='menu'){handleMenuClick(x,y);return;}
    if(gameState==='upgrade'){handleUpgradeClick(x,y);return;}
    if(gameState==='leaderboard'){handleLeaderboardClick(x,y);return;}
    if(isInJoystick(x,y)){joystick.active=true;updateJoystickPos(x,y);}
    if(gameState==='ended'&&y>GAME_H*0.07&&y<GAME_H*0.10){handleGameOverTabClick(x,y);}
    else if(gameState==='ended'||gameState==='champion'){handleGameOverBtnClick(x,y);}
    else if(isInAttack(x,y)){attackPressed=true;attackJustPressed=true;}
    else if(isInBoost(x,y)){boostPressed=true;}
});
Platform.onMouseMove(canvas,(e)=>{if(joystick.active){const {x,y}=screenToCanvas(e.clientX,e.clientY);updateJoystickPos(x,y);}});
Platform.onMouseUp(canvas,()=>{if(joystick.active)resetJoystick();attackPressed=false;});
Platform.onMouseLeave(canvas,()=>{if(joystick.active)resetJoystick();attackPressed=false;});

// ═══════════════════════════════════════
//  触摸
// ═══════════════════════════════════════
Platform.onTouchStart(canvas,(e)=>{
    Platform.preventDefault(e);sound._c();
    const tBtnSize=Math.max(S(54),44),tBtnY=S(26),tMuteX=Math.max(SX(40),12),tCloseM=Math.max(SX(150),75);
    for(const t of (Platform.getTouches(e)||[])){
        const {x,y}=screenToCanvas(t.clientX,t.clientY);
        // 新手引导点击关闭
        if(guideTimer>0){guideTimer=0;Platform.setItem('guide_shown','1');}
        // 手机端静音按钮
        if(x>=tMuteX&&x<=tMuteX+tBtnSize&&y>=tBtnY&&y<=tBtnY+tBtnSize){soundEnabled=!soundEnabled;sound._enabled=soundEnabled;continue;}
        // 手机端返回按钮
        if(gameState!=='menu'&&x>=GAME_W-tCloseM&&x<=GAME_W-tCloseM+tBtnSize&&y>=tBtnY&&y<=tBtnY+tBtnSize){gameState='menu';continue;}
        if(gameState==='menu'){handleMenuClick(x,y);return;}
        if(gameState==='upgrade'){handleUpgradeClick(x,y);return;}
        if(gameState==='leaderboard'){handleLeaderboardClick(x,y);return;}
        if(isInJoystick(x,y)){joystick.active=true;joystick.touchId=t.identifier;updateJoystickPos(x,y);}
        if(gameState==='ended'&&y>GAME_H*0.07&&y<GAME_H*0.10){handleGameOverTabClick(x,y);}
        else if(gameState==='ended'||gameState==='champion'){handleGameOverBtnClick(x,y);}
        else if(isInAttack(x,y)){attackPressed=true;attackJustPressed=true;attackTouchId=t.identifier;}
        else if(isInBoost(x,y)){boostPressed=true;}
    }
});
Platform.onTouchMove(canvas,(e)=>{Platform.preventDefault(e);for(const t of (Platform.getTouches(e)||[])){if(t.identifier===joystick.touchId){const {x,y}=screenToCanvas(t.clientX,t.clientY);updateJoystickPos(x,y);}}});
Platform.onTouchEnd(canvas,(e)=>{Platform.preventDefault(e);for(const t of (Platform.getTouches(e)||[])){if(t.identifier===joystick.touchId)resetJoystick();if(t.identifier===attackTouchId)attackPressed=false;} });
Platform.onTouchCancel(canvas,()=>{resetJoystick();attackPressed=false;attackTouchId=-1;});

// ═══════════════════════════════════════
//  菜单 UI
// ═══════════════════════════════════════
const menuBtns = [];

function buildMenu() {
    menuBtns.length = 0;
    const cw = GAME_W, ch = GAME_H;

    // ─── 多人对战 (4 buttons, 2×2) ───
    const col1x = cw * 0.19;
    const btnW = S(130), btnH = Math.max(S(40), 38), gap = S(10);
    const row1y = ch * 0.24, row2y = row1y + btnH + gap;
    let sx = col1x - (btnW + gap / 2);
    menuBtns.push({ x:sx, y:row1y, w:btnW, h:btnH, text:'2v2团战', type:'mode', id:'2v2' });
    sx += btnW + gap;
    menuBtns.push({ x:sx, y:row1y, w:btnW, h:btnH, text:'4v4团战', type:'mode', id:'4v4' });
    sx = col1x - (btnW + gap / 2);
    menuBtns.push({ x:sx, y:row2y, w:btnW, h:btnH, text:'2人组队', type:'mode', id:'team2' });
    sx += btnW + gap;
    menuBtns.push({ x:sx, y:row2y, w:btnW, h:btnH, text:'4人组队', type:'mode', id:'team4' });

    // ─── 生存竞技 (2 buttons, stacked) ───
    const col2x = cw * 0.50;
    const survW = S(170), survH = Math.max(S(42), 40);
    const survRow1y = ch * 0.24;
    menuBtns.push({ x:col2x - survW/2, y:survRow1y, w:survW, h:survH, text:'单人竞技', type:'mode', id:'survival' });
    menuBtns.push({ x:col2x - survW/2, y:survRow1y + survH + Math.max(S(8), 6), w:survW, h:survH, text:'组队竞技', type:'mode', id:'duo_survival' });

    // ─── 休闲娱乐 (2 buttons, side by side) ───
    const col3x = cw * 0.81;
    const casualRow1y = ch * 0.24;
    sx = col3x - (btnW + gap / 2);
    menuBtns.push({ x:sx, y:casualRow1y, w:btnW, h:btnH, text:'大乱斗', type:'mode', id:'ffa' });
    sx += btnW + gap;
    menuBtns.push({ x:sx, y:casualRow1y, w:btnW, h:btnH, text:'训练场', type:'mode', id:'training' });

    // ─── 计算模式按钮区域底部（用于后续定位） ───
    MODE_BTN_BOTTOM = 0;
    for (const btn of menuBtns) {
        if (btn.type === 'mode') MODE_BTN_BOTTOM = Math.max(MODE_BTN_BOTTOM, btn.y + btn.h);
    }

    // ─── 球型卡片 ───
    const cardAreaTop = Math.max(ch * 0.54, MODE_BTN_BOTTOM + Math.max(S(56), 28));
    const cardY = cardAreaTop + Math.max(S(28), 16);
    const cardW = S(200), cardH = Math.max(S(64), 36), cardGap = S(14);
    const totalW = BALL_TYPES.length * cardW + (BALL_TYPES.length - 1) * cardGap;
    sx = (cw - totalW) / 2;
    for (const b of BALL_TYPES) {
        menuBtns.push({ x:sx, y:cardY, w:cardW, h:cardH, text:b.name, type:'ball', id:b.id, desc:b.desc });
        sx += cardW + cardGap;
    }

    // ─── 开始按钮 ───
    const startW = S(220), startH = Math.max(S(50), 42);
    menuBtns.push({ x:(cw-startW)/2, y:ch*0.835, w:startW, h:startH, text:'🎮 开始游戏', type:'start' });
    // ─── 通行证 XP 进度条 ───
    const xpBarY = Math.max(ch * 0.50, cardAreaTop - Math.max(S(30), 16)), xpBarW = cw*0.5, xpBarH = S(10);
    const xpX = cw/2 - xpBarW/2;
    ctx.fillStyle='rgba(255,255,255,0.06)';ctx.strokeStyle='rgba(255,255,255,0.1)';ctx.lineWidth=1;
    ctx.beginPath();ctx.roundRect(xpX-4,xpBarY-4,xpBarW+8,xpBarH+22,8);ctx.fill();ctx.stroke();
    ctx.font=`${S(15)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.4)';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('声望 Lv.'+passLevel, cw/2, xpBarY+xpBarH+12);
    const xpNeeded = passLevel >= 50 ? 0 : 80 + passLevel * 20;
    if (xpNeeded > 0) {
        const xpPct = Math.min(1, xp / xpNeeded);
        ctx.fillStyle='rgba(255,255,255,0.1)';ctx.fillRect(xpX,xpBarY,xpBarW,xpBarH);
        const xpG=ctx.createLinearGradient(xpX,0,xpX+xpBarW,0);
        xpG.addColorStop(0,'#ff66ff');xpG.addColorStop(0.5,'#ffcc44');xpG.addColorStop(1,'#66ffcc');
        ctx.fillStyle=xpG;ctx.beginPath();ctx.roundRect(xpX,xpBarY,xpBarW*xpPct,xpBarH,5);ctx.fill();
        ctx.font=`${S(14)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.5)';ctx.textAlign='center';
        ctx.fillText(xp+'/'+xpNeeded, cw/2, xpBarY+xpBarH/2+1);
    } else {
        ctx.font=`bold ${S(14)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ffcc44';ctx.textAlign='center';
        ctx.fillText('🏆 满级', cw/2, xpBarY+xpBarH/2+1);
    }

    // ─── 纹章选择 ───
    const emY = ch*0.57, emSize = S(28), emGap = S(8);
    const emTotalW = EMBLEMS.length * (emSize + emGap) - emGap;
    let emX = cw/2 - emTotalW/2;
    for (const e of EMBLEMS) {
        const owned = unlockedEmblems.includes(e.id);
        const active = activeEmblem === e.id;
        ctx.fillStyle=active?'rgba(255,200,80,0.2)':(owned?'rgba(255,255,255,0.06)':'rgba(100,100,100,0.1)');
        ctx.strokeStyle=active?'#ffcc44':(owned?'rgba(255,255,255,0.15)':'rgba(100,100,100,0.1)');
        ctx.lineWidth=active?2:1;
        ctx.beginPath();ctx.roundRect(emX,emY,emSize,emSize,6);ctx.fill();ctx.stroke();
        ctx.font=`${S(24)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle=owned?'#fff':'rgba(100,100,100,0.5)';
        const icon = {'flame':'🔥','lightning':'⚡','skull':'💀'}[e.id]||'❓';
        ctx.fillText(icon,emX+emSize/2,emY+emSize/2);
        // 小锁图标
        if (!owned) {ctx.font=`${S(15)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(100,100,100,0.4)';ctx.fillText('🔒',emX+emSize/2,emY+emSize+10);}
        emX += emSize + emGap;
    }

    // ─── 升级按钮 ───
    const upgW = S(150), upgH = S(42);
    menuBtns.push({ x:40, y:ch*0.84, w:upgW, h:upgH, text:'升级', type:'upgrade' });
    // ─── 排行榜按钮 ───
    menuBtns.push({ x:40, y:ch*0.84+upgH+10, w:upgW, h:upgH, text:'排行', type:'leaderboard' });
}

function handleMenuClick(mx, my) {
    for (const btn of menuBtns) {
        if (mx >= btn.x && mx <= btn.x+btn.w && my >= btn.y && my <= btn.y+btn.h) {
            if (btn.type === 'mode') selectedMode = btn.id;
            else if (btn.type === 'ball') selectedBallType = btn.id;
            else if (btn.type === 'upgrade') { gameState = 'upgrade'; return; }
            else if (btn.type === 'leaderboard') { gameState = 'leaderboard'; return; }
            else if (btn.type === 'start') {
                if (!selectedMode) selectedMode = '2v2';
                if (menuTimer) { clearTimeout(menuTimer); menuTimer = null; }
                scores = { red:0, blue:0 }; roundNum = 1; matchHistory = [];
                initGame();
                return;
            }
        }
    }
}

function drawMenu() {
    ctx.fillStyle='rgba(0,0,0,0.85)';ctx.fillRect(0,0,GAME_W,GAME_H);
    const cw=GAME_W,ch=GAME_H;
    const t=Date.now()/1000;


    // ─── 标题 ───
    ctx.font=`bold ${S(57)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='#ffcc44';
    ctx.shadowColor='#ffcc44';ctx.shadowBlur=20;
    ctx.fillText('疯狂的珠子',cw/2,ch*0.07);
    ctx.shadowBlur=0;ctx.shadowColor='transparent';

    // ─── 标题下方滚动公告 ───
    (function(){
        const msgs=['欢迎来到疯狂的珠子！','新增加速键·Shift加速','生存模式缩圈伤害平衡','球型血量与武器调整','训练场可试用所有武器','连胜获得额外金币奖励！'];
        const longText='  ★  '+msgs.join('  ★  ')+'  ★  ';
        ctx.font=`bold ${S(18)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
        const tw=ctx.measureText(longText).width;
        const speed=35;
        const offset=(Date.now()/1000*speed)%tw;
        const barW = cw * 0.55, barX = (cw - barW) / 2, barY = ch*0.13, barH = S(26);
        ctx.save();
        ctx.textAlign='left';ctx.textBaseline='middle';
        ctx.beginPath();ctx.roundRect(barX,barY,barW,barH,8);ctx.clip();
        ctx.fillStyle='#ffcc44';ctx.shadowColor='#ffcc44';ctx.shadowBlur=6;
        ctx.fillText(longText,barX+barW-offset,barY+barH/2);
        ctx.fillText(longText,barX+barW/2-offset+tw,barY+barH/2);
        ctx.shadowBlur=0;ctx.restore();
    })();

    // ─── 金币余额（内缩避开屏幕边缘）───
    ctx.font=`bold ${S(22)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='right';ctx.textBaseline='middle';
    ctx.fillStyle='#ffcc44';
    ctx.fillText(`金币 ${playerGold}`, cw*0.92, S(30));
    if (winStreak > 1) {
        ctx.font=`${S(19)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ff8844';
        ctx.fillText(`连胜 ${winStreak}`, cw*0.92, S(54));
    }
    // 当前称号
    const curTitle = getActiveTitle();
    if (curTitle) {
        ctx.font=`bold ${S(18)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='right';ctx.textBaseline='middle';
        ctx.fillStyle=curTitle.color;
        ctx.fillText('「'+curTitle.text+'」', cw*0.92, S(76));
    }

    // ─── 模式分类卡片背景 ───
    const colCenters=[cw*0.19,cw*0.50,cw*0.81];
    const cardTop=ch*0.16,cardBottom=Math.max(ch*0.40, MODE_BTN_BOTTOM + S(5));
    const cardAreaW=S(320);
    for(let ci=0;ci<3;ci++){
        const cx=colCenters[ci];
        ctx.fillStyle='rgba(255,255,255,0.03)';
        ctx.strokeStyle='rgba(255,255,255,0.07)';
        ctx.lineWidth=1;
        ctx.beginPath();ctx.roundRect(cx-cardAreaW/2,cardTop,cardAreaW,cardBottom-cardTop,12);ctx.fill();ctx.stroke();
    }

    // ─── 分类标题 ───
    ctx.textAlign='center';ctx.textBaseline='middle';
    const headers=[
        {text:'多人对战',x:colCenters[0],color:'#ffcc66'},
        {text:'生存竞技',x:colCenters[1],color:'#ff6688'},
        {text:'休闲娱乐',x:colCenters[2],color:'#66ccff'},
    ];
    for(const h of headers){
        ctx.font=`bold ${S(26)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle=h.color;
        ctx.fillText(h.text,h.x,ch*0.20);
    }

    // ─── 按钮绘制 ───
    for(const btn of menuBtns){
        if(btn.type==='start'||btn.type==='upgrade'||btn.type==='leaderboard')continue;
        const isMode=btn.type==='mode';
        const isBall=btn.type==='ball';
        const isSel=(isMode&&btn.id===selectedMode)||(isBall&&btn.id===selectedBallType);
        const isSurvival=btn.id==='survival';

        // 选中时生存模式高亮发光
        if(isSel&&isSurvival){
            ctx.shadowColor='#ff4444';
            ctx.shadowBlur=18+Math.sin(t*4)*6;
        }

        let bg,border;
        if(isSel){
            if(isSurvival){bg='rgba(255,80,80,0.35)';border='#ff6666';}
            else if(isBall){bg='rgba(100,200,255,0.22)';border='#64c8ff';}
            else{bg='rgba(100,200,255,0.22)';border='#64c8ff';}
        }else{
            bg='rgba(255,255,255,0.06)';border='rgba(255,255,255,0.15)';
        }
        ctx.fillStyle=bg;
        ctx.strokeStyle=border;
        ctx.lineWidth=isSel?2:1;
        const rad=isBall?10:7;
        ctx.beginPath();ctx.roundRect(btn.x,btn.y,btn.w,btn.h,rad);ctx.fill();ctx.stroke();
        ctx.shadowBlur=0;ctx.shadowColor='transparent';

        // 球型卡片内容（名称 + 描述常驻）
        if(isBall){
            ctx.font=isSel?`bold ${S(28)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`:`${S(26)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
            ctx.fillStyle=isSel?'#fff':'#bbb';
            ctx.textAlign='center';ctx.textBaseline='middle';
            ctx.fillText(btn.text,btn.x+btn.w/2,btn.y+btn.h*0.32);
            ctx.font=`${S(15)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.35)';
            ctx.fillText(btn.desc,btn.x+btn.w/2,btn.y+btn.h*0.74);
        }else{
            // 模式按钮文字
            ctx.font=isSel?`bold ${S(28)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`:`${S(26)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
            ctx.fillStyle=isSel?'#fff':'#bbb';
            ctx.textAlign='center';ctx.textBaseline='middle';
            ctx.fillText(btn.text,btn.x+btn.w/2,btn.y+btn.h/2);
        }
    }

    // ─── 渐变分隔线 + 提示文字 ───
    const sepY = Math.max(ch * 0.44, MODE_BTN_BOTTOM + Math.max(S(10), 5));
    const grad=ctx.createLinearGradient(cw*0.1,0,cw*0.9,0);
    grad.addColorStop(0,'transparent');
    grad.addColorStop(0.3,'rgba(255,255,255,0.12)');
    grad.addColorStop(0.7,'rgba(255,255,255,0.12)');
    grad.addColorStop(1,'transparent');
    ctx.fillStyle=grad;
    ctx.fillRect(cw*0.1,sepY,cw*0.8,2);
    ctx.font=`${S(22)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.3)';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('— 选完模式，选择你的专属球型 —',cw/2,Math.max(ch*0.49, sepY + Math.max(S(22), 10)));

    // ─── 球型区卡片背景 ───
    const btCardTop = Math.max(ch * 0.54, MODE_BTN_BOTTOM + Math.max(S(40), 20)), btCardH = Math.max(S(88), 50), btCardW = cw - 40;
    ctx.fillStyle='rgba(255,255,255,0.03)';
    ctx.strokeStyle='rgba(255,255,255,0.06)';
    ctx.lineWidth=1;
    ctx.beginPath();ctx.roundRect(20,btCardTop,btCardW,btCardH,14);ctx.fill();ctx.stroke();

    // ─── 开始按钮 ───
    const startBtn=menuBtns.find(b=>b.type==='start');
    if(startBtn){
        const isSurvivalSel=selectedMode==='survival'||selectedMode==='duo_survival';
        ctx.fillStyle=isSurvivalSel?'#ff5544':'#ff6644';
        ctx.shadowColor=isSurvivalSel?'#ff5544':'#ff6644';
        ctx.shadowBlur=20;
        ctx.beginPath();ctx.roundRect(startBtn.x,startBtn.y,startBtn.w,startBtn.h,10);ctx.fill();
        ctx.shadowBlur=0;ctx.shadowColor='transparent';
        ctx.font=`bold ${S(32)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#fff';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(startBtn.text,startBtn.x+startBtn.w/2,startBtn.y+startBtn.h/2);
    }

    // ─── 升级按钮 ───
    const upgBtn=menuBtns.find(b=>b.type==='upgrade');
    if(upgBtn){
        ctx.fillStyle='rgba(255,200,80,0.15)';ctx.strokeStyle='rgba(255,200,80,0.4)';ctx.lineWidth=1.5;
        ctx.beginPath();ctx.roundRect(upgBtn.x,upgBtn.y,upgBtn.w,upgBtn.h,10);ctx.fill();ctx.stroke();
        ctx.font=`bold ${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ffcc44';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(upgBtn.text,upgBtn.x+upgBtn.w/2,upgBtn.y+upgBtn.h/2);
    }
    // ─── 排行榜按钮 ───
    const lbBtn=menuBtns.find(b=>b.type==='leaderboard');
    if(lbBtn){
        ctx.fillStyle='rgba(100,200,255,0.12)';ctx.strokeStyle='rgba(100,200,255,0.3)';ctx.lineWidth=1.5;
        ctx.beginPath();ctx.roundRect(lbBtn.x,lbBtn.y,lbBtn.w,lbBtn.h,10);ctx.fill();ctx.stroke();
        ctx.font=`${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#64c8ff';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(lbBtn.text,lbBtn.x+lbBtn.w/2,lbBtn.y+lbBtn.h/2);
    }

    // ─── 右下角段位显示 ───
    const tier=getRankTier(rankPoints);
    const level=getRankLevel(rankPoints);
    const progress=getRankProgress(rankPoints);
    const rankX=cw-20,rankY=ch*0.90;
    // 背景
    ctx.fillStyle='rgba(255,255,255,0.04)';ctx.strokeStyle='rgba(255,255,255,0.08)';ctx.lineWidth=1;
    ctx.beginPath();ctx.roundRect(rankX-160,rankY-20,170,70,10);ctx.fill();ctx.stroke();
    // 段位图标
    ctx.font=`${S(42)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.fillText(tier.icon,rankX-148,rankY+8);
    // 段位名称
    ctx.font=`bold ${S(24)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle=tier.color;
    ctx.fillText(tier.name+' '+['I','II','III'][level-1],rankX-110,rankY);
    // RP
    ctx.font=`${S(20)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.6)';
    ctx.fillText('RP '+rankPoints,rankX-110,rankY+22);
    // 进度条
    const pbX=rankX-148,pbY=rankY+36,pbW=136,pbH=4;
    ctx.fillStyle='rgba(255,255,255,0.1)';ctx.fillRect(pbX,pbY,pbW,pbH);
    const pg=ctx.createLinearGradient(pbX,0,pbX+pbW,0);
    pg.addColorStop(0,tier.color);pg.addColorStop(1,tier.color);
    ctx.fillStyle=pg;ctx.fillRect(pbX,pbY,pbW*Math.min(1,progress),pbH);
    // 进度文字
    const nextName=TIERS[Math.min(tier.index+1,TIERS.length-1)].name;
    if(tier.index<TIERS.length-1){
        ctx.font=`${S(14)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.3)';ctx.textAlign='right';
        ctx.fillText('→ '+nextName,rankX-12,pbY+12);
    }

    // ─── 底部操作提示 ───
    if(isTouchDevice){
        ctx.font=`${S(18)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.2)';
        ctx.textAlign='center';ctx.fillText('点击选择模式和球型，然后点开始游戏',cw/2,ch*0.94);
    }else{
        ctx.font=`${S(18)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.2)';
        ctx.textAlign='center';ctx.fillText('鼠标选择  |  WASD+Shift加速 操作  |  方向键+Enter 双人',cw/2,ch*0.94);
    }
}

// ═══════════════════════════════════════
//  升级系统
// ═══════════════════════════════════════
const UPGRADE_BTNS = [];
const gameOverBtns = [];

function handleUpgradeClick(mx, my) {
    for (const btn of UPGRADE_BTNS) {
        if (mx >= btn.x && mx <= btn.x+btn.w && my >= btn.y && my <= btn.y+btn.h) {
            if (btn.type === 'buy') {
                const key = btn.id;
                const level = upgrades[key] || 0;
                if (level >= MAX_UPGRADE_LEVEL) return;
                const cost = UPGRADE_COSTS[key][level];
                if (playerGold < cost) return;
                playerGold -= cost;
                upgrades[key] = level + 1;
                totalGoldEarned += cost;
                saveProgress();
                resetConfirm = false;
                return;
            } else if (btn.type === 'back') {
                gameState = 'menu';
                resetConfirm = false;
                return;
            } else if (btn.type === 'reset') {
                const total = (upgrades.speed||0)+(upgrades.attack||0)+(upgrades.hp||0);
                if (total === 0) return;
                if (!resetConfirm) {
                    resetConfirm = true;
                    return;
                }
                // 计算总投入金币 = 各属性各级花费之和
                let refund = 0;
                for (const key of ['speed','attack','hp']) {
                    const lv = upgrades[key] || 0;
                    for (let i = 0; i < lv; i++) {
                        refund += UPGRADE_COSTS[key][i];
                    }
                }
                upgrades = { speed:0, attack:0, hp:0 };
                playerGold += refund;
                resetConfirm = false;
                saveProgress();
                return;
            }
        }
    }
}

function drawUpgradeMenu() {
    ctx.fillStyle='rgba(0,0,0,0.88)';ctx.fillRect(0,0,GAME_W,GAME_H);
    const cw=GAME_W,ch=GAME_H;
    UPGRADE_BTNS.length = 0;

    // 标题 + 金币
    ctx.font=`bold ${S(48)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='#ffcc44';ctx.fillText('🔧 升级中心',cw/2,ch*0.08);
    ctx.font=`bold ${S(27)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='right';
    ctx.fillStyle='#ffcc44';ctx.fillText(`💰 ${playerGold} 金币`,cw-20,S(30));

    const keys = ['speed','attack','hp'];
    const cardW = S(220), cardH = S(210), gap = S(30);
    const totalW = keys.length * cardW + (keys.length-1) * gap;
    let sx = (cw - totalW) / 2;
    const cardY = ch * 0.18;

    for (const key of keys) {
        const level = upgrades[key] || 0;
        const info = UPGRADE_LABELS[key];
        const maxed = level >= MAX_UPGRADE_LEVEL;
        const cost = maxed ? 0 : UPGRADE_COSTS[key][level];
        const effect = level * UPGRADE_EFFECTS[key];
        const nextEffect = maxed ? effect : (level+1) * UPGRADE_EFFECTS[key];
        const effStr = key === 'speed' ? `+${effect} 移速` : (key === 'attack' ? `+${Math.round(effect*100)}% 伤害` : `+${effect} 血量`);

        // 卡片背景
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(sx, cardY, cardW, cardH, 14); ctx.fill(); ctx.stroke();

        // 图标
        ctx.font=`bold ${S(63)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(info.icon, sx+cardW/2, cardY + S(32));

        // 名称
        ctx.font=`bold ${S(24)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ffcc44';
        ctx.fillText(info.name, sx+cardW/2, cardY + S(68));

        // 等级
        ctx.font=`${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle= maxed ? '#ff8844' : '#64c8ff';
        ctx.fillText(`Lv ${level}/${MAX_UPGRADE_LEVEL}`, sx+cardW/2, cardY + S(94));

        // 效果描述
        ctx.font=`${S(20)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.5)';
        ctx.fillText(effStr, sx+cardW/2, cardY + S(120));

        // 下一级预览
        if (!maxed) {
            ctx.font=`${S(17)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.3)';
            const nextStr = key === 'speed' ? `+${nextEffect} 移速` : (key === 'attack' ? `+${Math.round(nextEffect*100)}% 伤害` : `+${nextEffect} 血量`);
            ctx.fillText(`下一级: ${nextStr}`, sx+cardW/2, cardY + S(146));
        }

        // 购买按钮
        const btnW=S(100), btnH=S(34), btnY=cardY+cardH-S(48);
        UPGRADE_BTNS.push({ x:sx+cardW/2-btnW/2, y:btnY, w:btnW, h:btnH, type:'buy', id:key });

        const canBuy = !maxed && playerGold >= cost;
        ctx.fillStyle = maxed ? 'rgba(100,100,100,0.3)' : (canBuy ? 'rgba(255,200,80,0.25)' : 'rgba(255,200,80,0.1)');
        ctx.strokeStyle = maxed ? 'rgba(100,100,100,0.3)' : (canBuy ? 'rgba(255,200,80,0.6)' : 'rgba(255,200,80,0.2)');
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(sx+cardW/2-btnW/2, btnY, btnW, btnH, 8); ctx.fill(); ctx.stroke();
        ctx.font = `bold ${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`; ctx.fillStyle = maxed ? '#888' : (canBuy ? '#ffcc44' : 'rgba(255,200,80,0.4)');
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(maxed ? '已满级' : `💰 ${cost}`, sx+cardW/2, btnY+btnH/2);

        sx += cardW + gap;
    }

    // 底部按钮行：返回 + 重置
    const btnRowY = ch*0.88;
    const backW=S(160), backH=S(40), resetW=S(160);
    const totalBtnW = backW + 20 + resetW;
    const leftBtnX = cw/2 - totalBtnW/2;
    const rightBtnX = leftBtnX + backW + 20;
    UPGRADE_BTNS.push({ x:leftBtnX, y:btnRowY, w:backW, h:backH, type:'back' });
    ctx.fillStyle='rgba(255,255,255,0.08)'; ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.roundRect(leftBtnX, btnRowY, backW, backH, 10); ctx.fill(); ctx.stroke();
    ctx.font=`${S(24)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`; ctx.fillStyle='#ccc'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('🔙 返回', leftBtnX+backW/2, btnRowY+backH/2);

    // 重置按钮
    UPGRADE_BTNS.push({ x:rightBtnX, y:btnRowY, w:resetW, h:backH, type:'reset' });
    const hasUpgrades = (upgrades.speed||0)+(upgrades.attack||0)+(upgrades.hp||0) > 0;
    if (resetConfirm) {
        ctx.fillStyle='rgba(255,80,80,0.25)'; ctx.strokeStyle='rgba(255,80,80,0.6)';
    } else {
        ctx.fillStyle= hasUpgrades ? 'rgba(255,200,80,0.08)' : 'rgba(100,100,100,0.15)';
        ctx.strokeStyle= hasUpgrades ? 'rgba(255,200,80,0.2)' : 'rgba(100,100,100,0.15)';
    }
    ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.roundRect(rightBtnX, btnRowY, resetW, backH, 10); ctx.fill(); ctx.stroke();
    ctx.font=`bold ${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
    ctx.fillStyle = !hasUpgrades ? '#666' : (resetConfirm ? '#ff6666' : 'rgba(255,200,80,0.6)');
    ctx.fillText(resetConfirm ? '❗ 确认重置?' : '🔄 重置升级', rightBtnX+resetW/2, btnRowY+backH/2);

    // 底部连胜显示
    if (bestStreak > 0) {
        ctx.font=`${S(20)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.3)';ctx.textAlign='center';
        ctx.fillText(`🏆 最高连胜: ${bestStreak}`, cw/2, ch*0.95);
    }
}

// ═══════════════════════════════════════
//  回合结束 & 冠军
// ═══════════════════════════════════════
function drawRoundEnd() {
    ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(0,0,GAME_W,GAME_H);
    const cw=GAME_W,ch=GAME_H;

    ctx.font=`bold ${S(48)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='#fff';ctx.fillText(`第 ${roundNum} 局结束`,cw/2,ch*0.15);

    // 大比分
    ctx.font=`bold ${S(84)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
    ctx.textAlign='right';ctx.fillStyle='#ff8888';ctx.fillText(`🔴 ${scores.red}`,cw/2-30,ch*0.30);
    ctx.textAlign='center';ctx.fillStyle='#fff';ctx.fillText(':',cw/2,ch*0.30);
    ctx.textAlign='left';ctx.fillStyle='#88bbff';ctx.fillText(`${scores.blue} 🔵`,cw/2+30,ch*0.30);

    // 各球击杀
    ctx.font=`${S(30)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;let y=ch*0.43;
    for(const b of balls){
        const c=b.team==='red'?'#ff8888':(b.team==='blue'?'#88bbff':'#ddd');
        ctx.textAlign='center';ctx.fillStyle=c;
        ctx.fillText(`${b.name}: ${b.kills} 击杀`,cw/2,y);
        y+=30;
    }

    ctx.font=`${S(27)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.textAlign='center';ctx.fillText('下一局即将开始...',cw/2,ch*0.72);
}

function drawChampion() {
    const cw=GAME_W,ch=GAME_H;
    const grad=ctx.createRadialGradient(cw/2,ch*0.3,0,cw/2,ch*0.3,cw*0.6);
    grad.addColorStop(0,'rgba(40,20,10,0.88)');grad.addColorStop(1,'rgba(0,0,0,0.92)');
    ctx.fillStyle=grad;ctx.fillRect(0,0,cw,ch);

    let champ=scores.red>=WINS_NEEDED?'red':'blue';
    const tColor=champ==='red'?'#ff6666':'#66aaff';
    ctx.font=`bold ${S(72)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.shadowColor=tColor;ctx.shadowBlur=30;
    ctx.fillStyle=tColor;
    ctx.fillText('🏆 '+(champ==='red'?'🔴 红队 总冠军！':'🔵 蓝队 总冠军！'),cw/2,ch*0.13);
    ctx.shadowBlur=0;ctx.shadowColor='transparent';

    ctx.fillStyle='rgba(255,255,255,0.05)';ctx.strokeStyle='rgba(255,255,255,0.1)';ctx.lineWidth=1;
    ctx.beginPath();ctx.roundRect(cw*0.3,ch*0.20,cw*0.4,44,10);ctx.fill();ctx.stroke();
    ctx.font=`bold ${S(42)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='right';ctx.fillStyle='#ff8888';
    ctx.fillText('🔴 '+scores.red,cw/2-8,ch*0.20+22);
    ctx.textAlign='center';ctx.fillStyle='#fff';ctx.fillText(':',cw/2,ch*0.20+22);
    ctx.textAlign='left';ctx.fillStyle='#88bbff';
    ctx.fillText(scores.blue+' 🔵',cw/2+8,ch*0.20+22);

    let mvp=null,mvk=0;
    for(const b of balls){if(b.kills>mvk){mvk=b.kills;mvp=b;}}
    if(mvp){
        ctx.fillStyle='rgba(255,200,80,0.08)';ctx.strokeStyle='rgba(255,200,80,0.3)';ctx.lineWidth=1;
        ctx.beginPath();ctx.roundRect(cw*0.28,ch*0.30,cw*0.44,30,8);ctx.fill();ctx.stroke();
        ctx.font=`${S(24)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ffdd44';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText('⭐ MVP: '+mvp.name+' ('+mvk+' 击杀)',cw/2,ch*0.30+15);
    }

    const sorted=[...balls].sort((a,b)=>b.kills-a.kills);
    ctx.font=`${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='rgba(255,255,255,0.4)';ctx.fillText('— 击杀榜 —',cw/2,ch*0.40);
    let y=ch*0.44;
    for(let i=0;i<sorted.length;i++){
        const b=sorted[i];
        const medal=i===0?'🥇':(i===1?'🥈':(i===2?'🥉':''));
        ctx.fillStyle=i%2===0?'rgba(255,255,255,0.04)':'rgba(255,255,255,0.02)';
        ctx.strokeStyle='rgba(255,255,255,0.05)';ctx.lineWidth=0.5;
        ctx.beginPath();ctx.roundRect(cw*0.2,y-2,cw*0.6,26,6);ctx.fill();ctx.stroke();
        ctx.textAlign='left';ctx.font=medal&&i<3?`${S(26)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`:`${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
        const c=b.team==='red'?'#ff8888':'#88bbff';
        ctx.fillStyle=c;ctx.fillText((medal?' '+medal:'')+' '+b.name,cw*0.23,(y+13));
        ctx.textAlign='right';ctx.font=`bold ${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ff8844';
        ctx.fillText(b.kills+' 击杀',cw*0.78,(y+13));
        y+=30;
    }

    ctx.fillStyle='rgba(255,200,80,0.06)';ctx.strokeStyle='rgba(255,200,80,0.2)';ctx.lineWidth=1;
    ctx.beginPath();ctx.roundRect(cw*0.25,ch*0.82,cw*0.5,winStreak>1?50:36,10);ctx.fill();ctx.stroke();
    ctx.font=`bold ${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ffcc44';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('💰 +'+earnedGold+' 金币  (累计: '+playerGold+')',cw/2,ch*0.82+18);
    if(winStreak>1){
        ctx.font=`${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ff8844';
        ctx.fillText('🔥 '+winStreak+' 连胜',cw/2,ch*0.82+36+10);
    }

    const btnY=ch*0.92,btnW=S(160),btnH=S(40),btnGap=S(20);
    const btnsTotalW=btnW*2+btnGap;
    const btn1X=cw/2-btnsTotalW/2,btn2X=btn1X+btnW+btnGap;
    gameOverBtns.length=0;
    gameOverBtns.push({x:btn1X,y:btnY,w:btnW,h:btnH,type:'menu'});
    ctx.fillStyle='rgba(255,255,255,0.06)';ctx.strokeStyle='rgba(255,255,255,0.15)';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.roundRect(btn1X,btnY,btnW,btnH,10);ctx.fill();ctx.stroke();
    ctx.font=`${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ccc';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('🏠 返回主页',btn1X+btnW/2,btnY+btnH/2);
    gameOverBtns.push({x:btn2X,y:btnY,w:btnW,h:btnH,type:'restart'});
    ctx.fillStyle='#ff6644';ctx.shadowColor='#ff6644';ctx.shadowBlur=15;
    ctx.beginPath();ctx.roundRect(btn2X,btnY,btnW,btnH,10);ctx.fill();ctx.shadowBlur=0;ctx.shadowColor='transparent';
    ctx.font=`bold ${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('🔄 继续游戏',btn2X+btnW/2,btnY+btnH/2);
}function drawJoystick(){
    if(!isTouchDevice)return;
    ctx.beginPath();ctx.arc(JOYSTICK_X,JOYSTICK_Y,JOYSTICK_RADIUS,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,0.1)';ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.3)';ctx.lineWidth=2;ctx.stroke();
    const ka=joystick.active?0.8:0.4;
    ctx.beginPath();ctx.arc(joystick.knobX,joystick.knobY,JOYSTICK_KNOB,0,Math.PI*2);
    ctx.fillStyle=`rgba(200,200,255,${ka})`;ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.5)';ctx.lineWidth=2;ctx.stroke();
}
function drawAttackButton(){
    if(!isTouchDevice)return;
    const p=attackPressed;
    ctx.beginPath();ctx.arc(ATTACK_X,ATTACK_Y,ATTACK_RADIUS,0,Math.PI*2);
    ctx.fillStyle=p?'rgba(255,80,80,0.6)':'rgba(255,80,80,0.3)';ctx.fill();
    ctx.strokeStyle=p?'rgba(255,150,150,0.8)':'rgba(255,150,150,0.5)';ctx.lineWidth=3;ctx.stroke();
    ctx.font=`bold ${S(27)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle=p?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.6)';ctx.fillText('⚔️',ATTACK_X,ATTACK_Y);
}
function drawBoostButton(){
    if(!isTouchDevice||gameState==='menu')return;
    const ready=boostCooldown<=0;
    const active=balls.some(b=>b.isPlayer&&b.boostTimer>0);
    ctx.beginPath();ctx.arc(BOOST_X,BOOST_Y,BOOST_RADIUS,0,Math.PI*2);
    if(active){
        ctx.fillStyle='rgba(80,255,80,0.5)';ctx.fill();
        ctx.shadowColor='#44ff44';ctx.shadowBlur=18;
        ctx.strokeStyle='rgba(150,255,150,0.9)';ctx.lineWidth=3;ctx.stroke();
        ctx.shadowBlur=0;ctx.shadowColor='transparent';
    }else if(ready){
        ctx.fillStyle='rgba(80,255,80,0.25)';ctx.fill();
        ctx.strokeStyle='rgba(150,255,150,0.5)';ctx.lineWidth=2;ctx.stroke();
    }else{
        ctx.fillStyle='rgba(100,100,100,0.3)';ctx.fill();
        ctx.strokeStyle='rgba(150,150,150,0.3)';ctx.lineWidth=2;ctx.stroke();
        // 冷却动画：圆弧倒计时
        const pct=boostCooldown/BOOST_COOLDOWN;
        ctx.beginPath();ctx.arc(BOOST_X,BOOST_Y,BOOST_RADIUS,-Math.PI/2,-Math.PI/2+pct*Math.PI*2);
        ctx.strokeStyle='rgba(80,255,80,0.5)';ctx.lineWidth=3;ctx.stroke();
    }
    ctx.font=`bold ${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle=active?'#fff':(ready?'rgba(255,255,255,0.8)':'rgba(200,200,200,0.4)');
    ctx.fillText(active?'💨':'⚡',BOOST_X,BOOST_Y);
}
function drawMobileUI() {
    if (!isTouchDevice) return;
    if (gameState !== 'playing' && gameState !== 'countdown' && gameState !== 'menu') return;
    const btnSize = Math.max(S(54), 44);
    const btnY = S(26);
    // 静音按钮（左上角，内移避开系统按钮）
    const muteX = Math.max(SX(40), 12);
    ctx.fillStyle='rgba(0,0,0,0.4)';ctx.beginPath();
    ctx.roundRect(muteX,btnY,btnSize,btnSize,10);ctx.fill();
    ctx.font=`${S(39)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';
    ctx.fillText(soundEnabled?'🔊':'🔇',muteX+btnSize/2,btnY+btnSize/2);
    // 返回菜单按钮（右上角，内移避开系统按钮）
    if (gameState !== 'menu') {
        const closeMargin = Math.max(SX(150), 75);
        const mx = GAME_W - closeMargin;
        ctx.fillStyle='rgba(0,0,0,0.4)';ctx.beginPath();
        ctx.roundRect(mx,btnY,btnSize,btnSize,10);ctx.fill();
        ctx.font=`${S(36)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#fff';
        ctx.fillText('✕',mx+btnSize/2,btnY+btnSize/2);
    }
}
function drawGuide() {
    if (guideTimer<=0||(gameState!=='countdown'&&gameState!=='playing'))return;
    const pulse=0.5+0.5*Math.sin(Date.now()/200);
    const fade=Math.min(1,guideTimer*3);
    ctx.save();ctx.globalAlpha=pulse*fade;
    const jy=JOYSTICK_Y,ax=ATTACK_X;
    // 摇杆引导（左侧箭头→）
    ctx.strokeStyle='#44ff88';ctx.fillStyle='#44ff88';ctx.lineWidth=4;
    ctx.font=`bold ${S(36)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
    const jEnd=JOYSTICK_X-JOYSTICK_RADIUS-10;
    ctx.beginPath();ctx.moveTo(40,jy);ctx.lineTo(jEnd,jy);ctx.stroke();
    ctx.beginPath();ctx.moveTo(jEnd,jy);ctx.lineTo(jEnd-16,jy-10);ctx.lineTo(jEnd-16,jy+10);ctx.closePath();ctx.fill();
    ctx.fillText('← 摇杆移动',40+80,jy-24);
    // 攻击键引导（右侧箭头←）
    const aEnd=ATTACK_X+ATTACK_RADIUS+10;
    ctx.beginPath();ctx.moveTo(GAME_W-40,jy);ctx.lineTo(aEnd,jy);ctx.stroke();
    ctx.beginPath();ctx.moveTo(aEnd,jy);ctx.lineTo(aEnd+16,jy-10);ctx.lineTo(aEnd+16,jy+10);ctx.closePath();ctx.fill();
    ctx.fillText('攻击键 →',GAME_W-120,jy-24);
    // 顶部标题
    ctx.font=`bold ${S(42)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ffcc44';ctx.fillText('👆 点击任意处关闭',GAME_W/2,JOYSTICK_Y-90);
    ctx.restore();
}
function drawArena() {
    // 随机加速带
    if(speedZone.active){
        const z=speedZone;
        const grad=ctx.createRadialGradient(z.x,z.y,0,z.x,z.y,z.r);
        grad.addColorStop(0,'rgba(100,255,100,0.2)');grad.addColorStop(1,'rgba(100,255,100,0.05)');
        ctx.fillStyle=grad;ctx.beginPath();ctx.arc(z.x,z.y,z.r,0,Math.PI*2);ctx.fill();
        const pulse=0.5+Math.sin(Date.now()/200)*0.3;
        ctx.strokeStyle=`rgba(100,255,100,${pulse})`;ctx.lineWidth=2;ctx.setLineDash([6,6]);ctx.stroke();ctx.setLineDash([]);
        ctx.font=`bold ${S(20)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle=`rgba(255,255,255,${pulse})`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText('💨 加速',z.x,z.y);
    }
    // 外圈
    ctx.beginPath();ctx.arc(CENTER_X,CENTER_Y,ARENA_RADIUS,0,Math.PI*2);
    ctx.strokeStyle='rgba(100,200,255,0.8)';ctx.lineWidth=4;ctx.stroke();
    // 中线
    ctx.beginPath();ctx.moveTo(CENTER_X,CENTER_Y-ARENA_RADIUS+15);ctx.lineTo(CENTER_X,CENTER_Y+ARENA_RADIUS-15);
    ctx.strokeStyle='rgba(255,255,255,0.15)';ctx.lineWidth=1;ctx.stroke();
}
function drawDrop(d){
    if(d.isTrainingDrop&&d.respawnTimer>0)return;
    const x=d.x,y=d.y;
    const dScale = 1.3 * Math.sqrt(ARENA_RADIUS / 525);
    // 扩散光圈（武器红色 / 道具蓝色）
    const ringColor=d.type==='weapon'?'255,80,80':'80,150,255';
    const rn=Date.now();
    for(let ri=0;ri<4;ri++){
        const phase=((rn+ri*220)%900)/900;
        const rr=phase*38,ra=(1-phase)*0.9;
        ctx.beginPath();ctx.arc(x,y,rr,0,Math.PI*2);
        ctx.strokeStyle='rgba('+ringColor+','+ra+')';ctx.lineWidth=2.5;ctx.stroke();
    }
    ctx.save();
    ctx.lineWidth=1.5;ctx.strokeStyle='#222';
    if(d.type==='weapon'){const w=d.data;ctx.translate(x,y);ctx.scale(dScale,dScale);
        const rotDrop=Date.now()/300;
        switch(w.id){
            case'single_gun':
                ctx.fillStyle='#88aacc';ctx.beginPath();ctx.moveTo(0,1);ctx.lineTo(7,-3);ctx.lineTo(12,-3);ctx.lineTo(12,3);ctx.lineTo(7,3);ctx.closePath();ctx.fill();ctx.stroke();
                ctx.fillStyle='#667788';ctx.fillRect(9,-2,5,4);ctx.strokeRect(9,-2,5,4);
                ctx.fillStyle='#ffdd44';ctx.beginPath();ctx.arc(15,0,1.5,0,Math.PI*2);ctx.fill();ctx.stroke();
                ctx.fillStyle='#8B5E3C';ctx.fillRect(0,1,4,4);ctx.strokeRect(0,1,4,4);
                ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(5,-1,1,0,Math.PI*2);ctx.fill();break;
            case'triple_gun':
                ctx.fillStyle='#556677';ctx.fillRect(0,-3,6,6);ctx.strokeRect(0,-3,6,6);
                for(let i=-1;i<=1;i++){
                    ctx.fillStyle='#8899aa';ctx.beginPath();ctx.arc(8,i*3.5,2.5,0,Math.PI*2);ctx.fill();ctx.stroke();
                    ctx.fillStyle='#ff6633';ctx.beginPath();ctx.arc(8,i*3.5,1.2,0,Math.PI*2);ctx.fill();
                    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(7.5,i*3.5-0.5,0.6,0,Math.PI*2);ctx.fill();
                }break;
            case'brick':
                ctx.fillStyle='#cc8844';ctx.fillRect(-5,-6,11,11);ctx.strokeRect(-5,-6,11,11);
                ctx.strokeStyle='#996633';ctx.lineWidth=0.5;
                ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(0,5);ctx.moveTo(-5,-1);ctx.lineTo(6,-1);ctx.stroke();
                ctx.fillStyle='#ff4444';ctx.font=`bold ${S(12)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('!',0,0);
                ctx.strokeStyle='#222';ctx.lineWidth=1.5;break;
            case'dagger':
                ctx.fillStyle='#d0d8e8';ctx.beginPath();ctx.moveTo(10,0);ctx.lineTo(-2,-4);ctx.lineTo(-2,4);ctx.closePath();ctx.fill();ctx.stroke();
                ctx.fillStyle='#884466';ctx.fillRect(-2,-2,4,4);ctx.strokeRect(-2,-2,4,4);
                ctx.fillStyle='#ff88cc';ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fill();ctx.stroke();
                ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(6,-1,1.2,0,Math.PI*2);ctx.fill();break;
            case'big_sword':
                ctx.fillStyle='#88ccff';ctx.beginPath();ctx.moveTo(16,0);ctx.lineTo(-2,-6);ctx.lineTo(3,0);ctx.lineTo(-2,6);ctx.closePath();ctx.fill();ctx.stroke();
                ctx.fillStyle='#66aadd';ctx.beginPath();ctx.moveTo(16,0);ctx.lineTo(5,-2);ctx.lineTo(5,2);ctx.closePath();ctx.fill();
                ctx.fillStyle='#8B5E3C';ctx.fillRect(-2,-2,4,4);ctx.strokeRect(-2,-2,4,4);
                ctx.fillStyle='#ffcc44';ctx.fillRect(2,-1,2,2);
                ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(10,-1,1,0,Math.PI*2);ctx.fill();break;
            case'staff':
                ctx.fillStyle='#8B5E3C';ctx.fillRect(-6,-1.5,12,3);ctx.strokeRect(-6,-1.5,12,3);
                ctx.fillStyle='#44ff88';ctx.beginPath();ctx.arc(6,0,4.5,0,Math.PI*2);ctx.fill();ctx.stroke();
                ctx.fillStyle='#aaffcc';ctx.beginPath();ctx.arc(6,0,2.5,0,Math.PI*2);ctx.fill();
                ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(5,-1,1,0,Math.PI*2);ctx.fill();
                ctx.fillStyle='#44ff88';ctx.font=`${S(9)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillText('✦',8,-5);break;
            case'laser_gun':
                ctx.fillStyle='#778899';ctx.beginPath();ctx.moveTo(-2,0);ctx.lineTo(4,-3);ctx.lineTo(14,-3);ctx.lineTo(14,3);ctx.lineTo(4,3);ctx.closePath();ctx.fill();ctx.stroke();
                ctx.fillStyle='#ff3344';ctx.fillRect(11,-2,5,4);ctx.strokeRect(11,-2,5,4);
                ctx.fillStyle='#ffaa88';ctx.fillRect(11,-1,5,2);
                ctx.fillStyle='#445566';ctx.fillRect(2,-1,2,2);
                ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(7,-1,1,0,Math.PI*2);ctx.fill();break;
            case'shotgun':
                ctx.fillStyle='#8899aa';ctx.fillRect(-4,-5,8,10);ctx.strokeRect(-4,-5,8,10);
                for(let i=-1;i<=1;i+=2){
                    ctx.fillStyle='#667788';ctx.beginPath();ctx.arc(6,i*3,2.5,0,Math.PI*2);ctx.fill();ctx.stroke();
                    ctx.fillStyle='#ff8844';ctx.beginPath();ctx.arc(6,i*3,1.2,0,Math.PI*2);ctx.fill();
                }
                ctx.fillStyle='#8B5E3C';ctx.fillRect(-4,-1,4,2);ctx.strokeRect(-4,-1,4,2);
                ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(1,-3,1,0,Math.PI*2);ctx.fill();break;
            case'boomerang':
                ctx.translate(2,0);ctx.rotate(rotDrop);
                const bCols2=[{f:'#fff',s:'#ccc'},{f:'#222',s:'#444'},{f:'#fff',s:'#ccc'},{f:'#222',s:'#444'}];
                for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.fillStyle=bCols2[i].f;ctx.strokeStyle=bCols2[i].s;
                    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*9,Math.sin(a)*9);ctx.lineTo(Math.cos(a+0.5)*4,Math.sin(a+0.5)*4);ctx.closePath();ctx.fill();ctx.stroke();}
                ctx.fillStyle='#888';ctx.beginPath();ctx.arc(0,0,2,0,Math.PI*2);ctx.fill();ctx.stroke();
                break;
        }
    }else{const item=d.data;ctx.translate(x,y);ctx.scale(dScale,dScale);
        ctx.lineWidth=1.5;ctx.strokeStyle='#222';
        switch(item.type){
            case'heal':{
                // Apple body with top dimple
                ctx.fillStyle=item.color;ctx.beginPath();
                ctx.moveTo(0,-6);ctx.quadraticCurveTo(-7,-7,-6,0);
                ctx.quadraticCurveTo(-7,7,0,7);ctx.quadraticCurveTo(7,7,6,0);
                ctx.quadraticCurveTo(7,-7,0,-6);ctx.fill();ctx.stroke();
                // Stem
                ctx.strokeStyle='#5a3a1a';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(0,-9);ctx.stroke();
                // Leaf
                ctx.fillStyle='#44cc44';ctx.beginPath();ctx.ellipse(3,-8,3.5,1.5,-0.3,0,Math.PI*2);ctx.fill();ctx.stroke();
                // Shine highlight
                ctx.fillStyle='rgba(255,255,255,0.4)';ctx.beginPath();ctx.arc(-2.5,-2,1.8,0,Math.PI*2);ctx.fill();
                ctx.strokeStyle='#222';ctx.lineWidth=1.5;break;
            }
            case'shield':{
                ctx.strokeStyle='#222';ctx.lineWidth=1.5;
                // Outer shield
                ctx.fillStyle=item.color;ctx.beginPath();ctx.arc(0,0,9,0,Math.PI);ctx.closePath();ctx.fill();ctx.stroke();
                // Inner shield
                ctx.beginPath();ctx.arc(0,0,6,0,Math.PI);ctx.closePath();ctx.fill();ctx.stroke();
                // Star emblem
                ctx.fillStyle='rgba(255,255,255,0.5)';ctx.beginPath();
                for(let i=0;i<5;i++){const a=-Math.PI/2+i*2*Math.PI/5;ctx.lineTo(Math.cos(a)*4,Math.sin(a)*4);}
                ctx.closePath();ctx.fill();
                // Highlight
                ctx.fillStyle='rgba(255,255,255,0.25)';ctx.beginPath();ctx.arc(-2,-4,1.5,0,Math.PI*2);ctx.fill();break;
            }
            case'magnet':{
                // Horseshoe magnet body
                ctx.fillStyle=item.color;ctx.beginPath();
                ctx.moveTo(-7,-6);ctx.lineTo(-7,4);ctx.arc(0,4,7,Math.PI,0);
                ctx.lineTo(7,-6);ctx.lineTo(5,-6);ctx.lineTo(5,3);
                ctx.arc(0,3,5,Math.PI,0);ctx.lineTo(-5,-6);ctx.closePath();ctx.fill();ctx.stroke();
                // Silver ends
                ctx.fillStyle='#ddd';ctx.fillRect(-7,-7,3,4);ctx.strokeRect(-7,-7,3,4);
                ctx.fillStyle='#ddd';ctx.fillRect(4,-7,3,4);ctx.strokeRect(4,-7,3,4);
                // N/S labels
                ctx.fillStyle='#222';ctx.font=`bold ${S(6)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
                ctx.fillText('N',-5.5,-5);ctx.fillText('S',5.5,-5);
                ctx.lineWidth=1.5;break;
            }
            case'freeze':{
                // Six-pointed ice crystal
                ctx.fillStyle=item.color;ctx.beginPath();
                for(let i=0;i<6;i++){const a=i*Math.PI/3-Math.PI/2;const r=i%2===1?8:5;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}
                ctx.closePath();ctx.fill();ctx.stroke();
                // Inner crystal lines
                ctx.strokeStyle='rgba(255,255,255,0.5)';ctx.lineWidth=1;
                ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(0,8);ctx.moveTo(-7,0);ctx.lineTo(7,0);ctx.stroke();
                // Snowflake dots
                ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,-4,1,0,Math.PI*2);ctx.fill();
                ctx.beginPath();ctx.arc(0,4,1,0,Math.PI*2);ctx.fill();
                ctx.beginPath();ctx.arc(-4,0,1,0,Math.PI*2);ctx.fill();
                ctx.beginPath();ctx.arc(4,0,1,0,Math.PI*2);ctx.fill();
                ctx.strokeStyle='#222';ctx.lineWidth=1.5;break;
            }
            case'dodge':{
                // Five-pointed star
                ctx.fillStyle=item.color;ctx.beginPath();
                for(let i=0;i<5;i++){const a=-Math.PI/2+i*2*Math.PI/5;const r=i%2===0?8:3.5;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}
                ctx.closePath();ctx.fill();ctx.stroke();
                // Evasion symbol
                ctx.fillStyle='rgba(255,255,255,0.8)';ctx.font=`bold ${S(11)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
                ctx.fillText('↺',0,0);break;
            }
            case'slow':{
                // Poison apple (same shape as heal, purple)
                ctx.fillStyle=item.color;ctx.beginPath();
                ctx.moveTo(0,-6);ctx.quadraticCurveTo(-7,-7,-6,0);
                ctx.quadraticCurveTo(-7,7,0,7);ctx.quadraticCurveTo(7,7,6,0);
                ctx.quadraticCurveTo(7,-7,0,-6);ctx.fill();ctx.stroke();
                // Stem
                ctx.strokeStyle='#5a3a1a';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(0,-9);ctx.stroke();
                // Skull symbol
                ctx.fillStyle='rgba(255,255,255,0.4)';ctx.font=`bold ${S(9)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
                ctx.fillText('☠',0,0);
                // Poison drip
                ctx.fillStyle=item.color;ctx.beginPath();ctx.arc(4,7,1.5,0,Math.PI*2);ctx.fill();ctx.stroke();
                // Shine
                ctx.fillStyle='rgba(255,255,255,0.2)';ctx.beginPath();ctx.arc(-2,-2,1.5,0,Math.PI*2);ctx.fill();
                ctx.strokeStyle='#222';ctx.lineWidth=1.5;break;
            }
        }
    }
    ctx.restore();
}
function checkPickups(){
    for(let i=drops.length-1;i>=0;i--){
        const d=drops[i];
        for(const b of balls){if(!b.isAlive)continue;
            if(Math.sqrt(Math.pow(b.x-d.x,2)+Math.pow(b.y-d.y,2))<SP(30)){
                if(d.type==='weapon'){b.pickupWeapon(d.data);spawnPickupParticles(d.x,d.y,'#ffc832');}else{b.pickupItem(d.data);spawnPickupParticles(d.x,d.y,d.data.color||'#ffffff');}
                sound.pickup();
                if(d.isTrainingDrop){d.respawnTimer=1.5;d.x=-100;d.y=-100;}else{drops.splice(i,1);}
                break;
            }
        }
    }
}

// ═══════════════════════════════════════
//  HUD
// ═══════════════════════════════════════
function drawHUD() {
    // 连胜显示（右上角，所有模式通用）
    if (winStreak > 1 && (gameState === 'playing' || gameState === 'countdown')) {
        ctx.font=`bold ${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='right';ctx.textBaseline='top';
        ctx.fillStyle='#ff8844';ctx.fillText(`🔥 ${winStreak} 连胜`, GAME_W-20, 10);
    }

    if (selectedMode === 'training') {
        ctx.fillStyle='#44ff88';ctx.font=`bold ${S(24)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='right';
        ctx.fillText('🎯 训练场  |  [ESC] 返回',GAME_W-20,30);
        ctx.textAlign='center';ctx.font=`bold ${S(60)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#fff';
        ctx.fillText('∞',CENTER_X,50);
        return;
    }
    if (selectedMode === 'ffa') {
        ctx.font=`bold ${S(24)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
        for(let i=0;i<balls.length;i++){
            const b=balls[i];
            const col = Math.floor(i / 4);
            const row = i % 4;
            const x = col === 0 ? 20 : GAME_W - 200;
            const y = 30 + row * 26;
            ctx.textAlign='left';ctx.fillStyle=b.isAlive?b.color:'rgba(128,128,128,0.4)';
            ctx.fillText(`${b.isAlive?'':''}${b.name}: ${Math.floor(b.hp)}/${b.maxHp}`,x,y);
            if(b.isAlive){
                const bw=50,bh=4;ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(x,y+4,bw,bh);
                ctx.fillStyle=b.hp/b.maxHp>0.5?'#44ff44':(b.hp/b.maxHp>0.25?'#ff8800':'#ff3333');
                ctx.fillRect(x,y+4,bw*(b.hp/b.maxHp),bh);
            }
        }
        ctx.font=`bold ${S(60)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.fillStyle='#fff';
        ctx.fillText(`${Math.ceil(gameTime)}`,CENTER_X,50);
        return;
    }
    if (selectedMode === 'survival') {
        // 存活人数
        let alive = 0; for (const b of balls) { if (b.isAlive) alive++; }
        ctx.font=`bold ${S(27)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='left';ctx.fillStyle='#fff';
        ctx.fillText(`👥 ${alive}/12 存活`, 20, 30);
        // 毒圈信息
        const phaseName = zoneState.phase < 0 ? '准备中' : ZONE_PHASES[zoneState.phase].label;
        const dps = zoneState.phase < 0 ? 0 : ZONE_PHASES[zoneState.phase].dmgPerSec;
        ctx.fillStyle = zoneState.warning ? '#ff6666' : '#aaa';
        ctx.fillText(`☣️ ${phaseName}  |  💥 ${dps}/s`, 20, 55);
        // 缩圈倒计时（从准备阶段就开始显示）
        const nextPhaseIdx = zoneState.phase + 1;
        if (nextPhaseIdx < ZONE_PHASES.length) {
            const remain = Math.max(0, ZONE_PHASES[nextPhaseIdx].time - zoneState.timer);
            if (remain > 0) {
                ctx.fillStyle = remain <= 3 ? '#ff4444' : '#aaa';
                ctx.fillText(`⏱ 下次缩圈 ${Math.ceil(remain)}s`, 20, 80);
            }
        }
        // 倒计时
        ctx.font=`bold ${S(60)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.fillStyle='#fff';
        ctx.fillText(`${Math.ceil(gameTime)}`,CENTER_X,50);
        // 底部提示
        ctx.textAlign='left';ctx.font=`${S(20)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.35)';
        if(isTouchDevice)ctx.fillText('生存吃鸡  |  摇杆移动 · 攻击',20,GAME_H-16);
        else ctx.fillText('生存吃鸡  |  WASD · Space/J攻击  |  [ESC]菜单  |  [M]静音',20,GAME_H-16);
        return;
    }
    if (selectedMode === 'duo_survival') {
        let alive = 0; const aliveTeams = new Set();
        for (const b of balls) { if (b.isAlive) { alive++; aliveTeams.add(b.team); } }
        ctx.font=`bold ${S(27)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='left';ctx.fillStyle='#fff';
        ctx.fillText(`👥 ${alive}/12  |  队伍 ${aliveTeams.size}/6`, 20, 30);
        if (zoneState.phase >= 0) {
            const phaseName = ZONE_PHASES[zoneState.phase].label;
            const dps = ZONE_PHASES[zoneState.phase].dmgPerSec;
            ctx.fillStyle = zoneState.warning ? '#ff6666' : '#aaa';
            ctx.fillText(`☣️ ${phaseName}  |  💥 ${dps}/s`, 20, 55);
        } else {
            ctx.fillStyle='#aaa';ctx.fillText('☣️ 准备中', 20, 55);
        }
        const nextPhaseIdx = zoneState.phase + 1;
        if (nextPhaseIdx < ZONE_PHASES.length) {
            const remain = Math.max(0, ZONE_PHASES[nextPhaseIdx].time - zoneState.timer);
            if (remain > 0) {
                ctx.fillStyle = remain <= 3 ? '#ff4444' : '#aaa';
                ctx.fillText(`⏱ 下次缩圈 ${Math.ceil(remain)}s`, 20, 80);
            }
        }
        ctx.font=`bold ${S(60)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.fillStyle='#fff';
        ctx.fillText(`${Math.ceil(gameTime)}`,CENTER_X,50);
        ctx.textAlign='left';ctx.font=`${S(20)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.35)';
        if(isTouchDevice)ctx.fillText('组队吃鸡  |  摇杆移动 · 攻击',20,GAME_H-16);
        else ctx.fillText('组队吃鸡  |  WASD · Space/J攻击  |  [ESC]菜单  |  [M]静音',20,GAME_H-16);
        return;
    }
    // 2v2 / 4v4
    ctx.fillStyle='#fff';ctx.font=`bold ${S(60)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';
    ctx.fillText(isOvertime?`⚡ ${Math.ceil(gameTime)}`:`${Math.ceil(gameTime)}`,CENTER_X,50);

    ctx.font=`bold ${S(27)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
    let rHp=0,bHp=0;
    for(const b of balls){if(b.isAlive){if(b.team==='red')rHp+=b.hp;else bHp+=b.hp;}}
    ctx.textAlign='left';ctx.fillStyle='#ff8888';
    ctx.fillText(`🔴 ${Math.floor(rHp)}`,20,40);
    ctx.textAlign='right';ctx.fillStyle='#88bbff';
    ctx.fillText(`🔵 ${Math.floor(bHp)}`,GAME_W-20,40);

    // 回合数 & 大比分
    const isTeamMode = selectedMode === 'team2' || selectedMode === 'team4';
    const modeLabel = selectedMode === '4v4' || selectedMode === 'team4' ? '4v4' : (isTeamMode ? '组队' : '2v2');
    ctx.font=`${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='left';ctx.fillStyle='rgba(255,255,255,0.4)';
    const coopLabel = isTeamMode ? '🤝合作' : '';
    ctx.fillText(`${coopLabel}${modeLabel} 第 ${roundNum} 局  🔴 ${scores.red} : ${scores.blue} 🔵`,20,62);

    const hintLabel = isTeamMode ? `🤝组队${modeLabel}` : modeLabel;
    ctx.textAlign='left';ctx.font=`${S(20)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.35)';
    if(isTouchDevice)ctx.fillText(`${hintLabel}  |  摇杆移动 · 攻击`,20,GAME_H-16);
    else ctx.fillText(`${hintLabel}  |  WASD · Space/J  |  双人: 方向键+Enter  |  [ESC]菜单  |  [M]静音`,20,GAME_H-16);
}

function handleGameOverTabClick(mx, my) {
    const cw=GAME_W,ch=GAME_H;
    const tabs=['全局击杀','团队击杀','个人收益'];
    const tabW=S(130),tabGap=S(6);
    const tabsW=tabs.length*tabW+(tabs.length-1)*tabGap;
    const sx=(cw-tabsW)/2;
    const tabY=ch*0.07;
    let tsx=sx;
    for(let i=0;i<tabs.length;i++){
        if(mx>=tsx&&mx<=tsx+tabW&&my>=tabY&&my<=tabY+S(32)){gameOverTab=i;return;}
        tsx+=tabW+tabGap;
    }
}

function handleGameOverBtnClick(mx, my) {
    for (const btn of gameOverBtns) {
        if (mx >= btn.x && mx <= btn.x+btn.w && my >= btn.y && my <= btn.y+btn.h) {
            if (btn.type === 'menu') {
                if (menuTimer) { clearTimeout(menuTimer); menuTimer = null; }
                scores = { red:0, blue:0 }; roundNum = 1; matchHistory = [];
                gameState = 'menu';
            } else if (btn.type === 'restart') {
                if (menuTimer) { clearTimeout(menuTimer); menuTimer = null; }
                scores = { red:0, blue:0 }; roundNum = 1; matchHistory = [];
                initGame();
            }
            return;
        }
    }
}

function drawCountdown() {

  const t=countdownTimer;let text,tColor,stage;
    if(t>2.4){text='3';tColor='#ff6666';stage=0;}else if(t>1.6){text='2';tColor='#ffaa44';stage=1;}else if(t>0.8){text='1';tColor='#44ddff';stage=2;}else{text='GO!';tColor='#44ff88';stage=3;}
    if(stage!==lastCountdownStage){sound.countdown();lastCountdownStage=stage;}
    ctx.fillStyle='rgba(0,0,0,0.4)';ctx.fillRect(CENTER_X-60,CENTER_Y-70,120,100);
    ctx.font=`bold ${S(108)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=tColor;
    ctx.fillText(text,CENTER_X,CENTER_Y-20);
    ctx.font=`${S(27)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.5)';ctx.textAlign='center';ctx.fillText('准备战斗！',CENTER_X,CENTER_Y+45);
}

function drawGameOver() {
    const cw=GAME_W,ch=GAME_H;
    const grad=ctx.createRadialGradient(cw/2,ch/2,0,cw/2,ch/2,cw*0.7);
    grad.addColorStop(0,'rgba(20,15,30,0.85)');grad.addColorStop(1,'rgba(0,0,0,0.92)');
    ctx.fillStyle=grad;ctx.fillRect(0,0,cw,ch);

    const sorted=[...balls].sort((a,b)=>b.kills-a.kills);
    const player=balls.find(b=>b.isPlayer)||balls[0];
    const isSurvival=selectedMode==='survival'||selectedMode==='duo_survival';
    const isTeam=selectedMode==='2v2'||selectedMode==='4v4'||selectedMode==='team2'||selectedMode==='team4';

    if(gameOverTab===0){
        ctx.font=`bold ${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle='rgba(255,255,255,0.4)';
        ctx.fillText('— 击杀排行 —',cw/2,ch*0.15);
        let y=ch*0.20;
        const rowH=S(30);
        for(let i=0;i<sorted.length;i++){
            const b=sorted[i];
            const medal=i===0?'🥇':(i===1?'🥈':(i===2?'🥉':''));
            ctx.fillStyle=i%2===0?'rgba(255,255,255,0.05)':'rgba(255,255,255,0.02)';
            ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=0.5;
            const cardX=cw*0.12,cardW=cw*0.76;
            ctx.beginPath();ctx.roundRect(cardX,y,cardW,rowH,6);ctx.fill();ctx.stroke();
            ctx.textAlign='left';ctx.font=i<3?`${S(26)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`:`${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
            ctx.fillStyle=b.isAlive?'#fff':'rgba(150,150,150,0.4)';
            ctx.fillText(medal+' '+b.name,cardX+8,y+rowH/2);
            ctx.textAlign='right';ctx.font=`bold ${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ffcc44';
            ctx.fillText(b.kills+' 击杀',cardX+cardW-8,y+rowH/2);
            if(b.isAlive){
                const bw=50,bh=3,barX=cw/2-bw/2;
                ctx.fillStyle='rgba(0,0,0,0.3)';ctx.fillRect(barX,y+rowH/2-1.5,bw,bh);
                const hr=Math.max(0,b.hp/b.maxHp);
                const hg=ctx.createLinearGradient(barX,0,barX+bw,0);
                hg.addColorStop(0,hr>0.5?'#44ff44':(hr>0.25?'#ffaa00':'#ff4444'));
                hg.addColorStop(1,hr>0.5?'#22cc22':(hr>0.25?'#cc8800':'#cc2222'));
                ctx.fillStyle=hg;ctx.fillRect(barX,y+rowH/2-1.5,bw*hr,bh);
            }
            y+=rowH+4;
            if(i===7&&sorted.length>8){ctx.fillStyle='rgba(255,255,255,0.3)';ctx.textAlign='center';ctx.fillText('...',cw/2,y);break;}
        }
    }else if(gameOverTab===1){
        ctx.font=`bold ${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle='rgba(255,255,255,0.4)';
        if(isTeam){
            ctx.fillText('— 团队击杀 —',cw/2,ch*0.15);
            let y=ch*0.21;
            for(const team of ['red','blue']){
                const members=balls.filter(b=>b.team===team);
                const totalKills=members.reduce((s,b)=>s+b.kills,0);
                const tName=team==='red'?'🔴 红队':'🔵 蓝队';
                const tC=team==='red'?'rgba(255,80,80,0.12)':'rgba(60,140,255,0.12)';
                const tB=team==='red'?'rgba(255,80,80,0.25)':'rgba(60,140,255,0.25)';
                ctx.fillStyle=tC;ctx.strokeStyle=tB;ctx.lineWidth=1;
                ctx.beginPath();ctx.roundRect(cw*0.15,y,cw*0.7,28,8);ctx.fill();ctx.stroke();
                ctx.textAlign='left';ctx.font=`bold ${S(24)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
                ctx.fillStyle=team==='red'?'#ff8888':'#88bbff';
                ctx.fillText(tName,cw*0.2,y+14);
                ctx.textAlign='right';ctx.font=`bold ${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ffcc44';
                ctx.fillText('总击杀 '+totalKills,cw*0.8,y+14);
                y+=36;
                for(const b of members){
                    ctx.fillStyle='rgba(255,255,255,0.03)';ctx.strokeStyle='rgba(255,255,255,0.05)';ctx.lineWidth=0.5;
                    ctx.beginPath();ctx.roundRect(cw*0.2,y,cw*0.6,24,6);ctx.fill();ctx.stroke();
                    ctx.textAlign='left';ctx.font=`${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
                    ctx.fillStyle=b.isAlive?'#ddd':'rgba(150,150,150,0.4)';
                    ctx.fillText('  '+b.name,cw*0.22,y+12);
                    ctx.textAlign='right';ctx.fillStyle='#ff8844';
                    ctx.fillText(b.kills+' 击杀',cw*0.78,y+12);
                    y+=28;
                }
                y+=10;
            }
        }else{
            ctx.fillText('— 个人排行 —',cw/2,ch*0.15);
            let y=ch*0.21;const rowH=S(30);
            for(let i=0;i<sorted.length;i++){
                const b=sorted[i];
                const medal=i===0?'🥇':(i===1?'🥈':(i===2?'🥉':''));
                ctx.fillStyle=i%2===0?'rgba(255,255,255,0.05)':'rgba(255,255,255,0.02)';
                ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=0.5;
                ctx.beginPath();ctx.roundRect(cw*0.12,y,cw*0.76,rowH,6);ctx.fill();ctx.stroke();
                ctx.textAlign='left';ctx.font=i<3?`${S(26)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`:`${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
                ctx.fillStyle=b.isAlive?'#fff':'rgba(150,150,150,0.4)';
                ctx.fillText(medal+' '+b.name,cw*0.16,y+rowH/2);
                ctx.textAlign='right';ctx.font=`bold ${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ffcc44';
                ctx.fillText(b.kills+' 击杀',cw*0.84,y+rowH/2);
                y+=rowH+4;if(i>8)break;
            }
        }
    }else{
        const pk=player?player.kills:0;
        let aliveCount=0;for(const b of balls){if(b.isAlive)aliveCount++;}
        const placement=aliveCount>0?sorted.indexOf(player)+1:balls.length;
        const isWin=lastWinner&&player&&lastWinner===player.team;
        const baseGold=10,killGold=pk*5;
        const winGold=isWin?(isSurvival?50:20):0;
        const streakGold=isWin?winStreak*5:0;
        const totalGold=baseGold+killGold+winGold+streakGold;

        ctx.font=`bold ${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle='rgba(255,255,255,0.4)';ctx.fillText('— 个人战绩 —',cw/2,ch*0.15);

        ctx.fillStyle='rgba(255,255,255,0.04)';ctx.strokeStyle='rgba(255,255,255,0.08)';ctx.lineWidth=1;
        ctx.beginPath();ctx.roundRect(cw*0.15,ch*0.19,cw*0.7,36,10);ctx.fill();ctx.stroke();
        ctx.font=`bold ${S(24)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle=player?player.color:'#fff';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(player?player.name:'???',cw*0.3,ch*0.19+18);
        ctx.font=`${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.6)';
        ctx.fillText('排名 '+placement+'/'+balls.length,cw*0.5,ch*0.19+18);
        ctx.fillText('击杀 '+pk,cw*0.65,ch*0.19+18);
        ctx.fillStyle=player&&player.isAlive?'#44ff44':'#ff6666';
        ctx.fillText(player&&player.isAlive?'存活':'阵亡',cw*0.8,ch*0.19+18);

        const cardW=280,cardH=210,cardX=cw/2-cardW/2,cardY=ch*0.32;
        ctx.fillStyle='rgba(255,255,255,0.04)';ctx.strokeStyle='rgba(255,255,255,0.08)';ctx.lineWidth=1;
        ctx.beginPath();ctx.roundRect(cardX,cardY,cardW,cardH,12);ctx.fill();ctx.stroke();
        ctx.font=`bold ${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.fillStyle='#ffcc44';ctx.textBaseline='middle';
        ctx.fillText('💰 金币收益',cw/2,cardY+22);
        let gy=cardY+50;
        const lx=cardX+20,vx=cardX+cardW-20;
        ctx.font=`${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.7)';
        ctx.textAlign='left';ctx.fillText('💰 基础参与',lx,gy);
        ctx.textAlign='right';ctx.fillStyle='#ffcc44';ctx.fillText('+'+baseGold,vx,gy);gy+=24;
        ctx.textAlign='left';ctx.fillStyle='rgba(255,255,255,0.7)';
        ctx.fillText('⚔️ 击杀奖励',lx,gy);
        ctx.textAlign='right';ctx.fillStyle='#ffcc44';ctx.fillText('+'+killGold,vx,gy);gy+=24;
        if(winGold>0){
            ctx.textAlign='left';ctx.fillStyle='rgba(255,255,255,0.7)';
            ctx.fillText(isSurvival?'🏆 吃鸡胜利':'🏆 团队胜利',lx,gy);
            ctx.textAlign='right';ctx.fillStyle='#ffcc44';ctx.fillText('+'+winGold,vx,gy);gy+=24;
        }
        if(streakGold>0){
            ctx.textAlign='left';ctx.fillStyle='rgba(255,255,255,0.7)';
            ctx.fillText('🔥 连胜加成',lx,gy);
            ctx.textAlign='right';ctx.fillStyle='#ff8844';ctx.fillText('+'+streakGold+' (×'+winStreak+')',vx,gy);gy+=24;
        }
        gy+=4;
        const sep=ctx.createLinearGradient(cardX+20,0,cardX+cardW-20,0);
        sep.addColorStop(0,'transparent');sep.addColorStop(0.3,'rgba(255,255,255,0.15)');
        sep.addColorStop(0.7,'rgba(255,255,255,0.15)');sep.addColorStop(1,'transparent');
        ctx.fillStyle=sep;ctx.fillRect(cardX+20,gy,cardW-40,1);gy+=16;
        ctx.textAlign='left';ctx.font=`bold ${S(24)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ffcc44';
        ctx.fillText('本局获得',lx,gy);
        ctx.textAlign='right';ctx.fillText('+'+totalGold,vx,gy);gy+=24;
        ctx.font=`${S(20)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='rgba(255,255,255,0.4)';
        ctx.textAlign='center';ctx.fillText('累计金币: '+playerGold,cw/2,gy+8);
        if(winStreak>1){
            ctx.font=`bold ${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ff8844';ctx.textAlign='center';
            ctx.fillText('🔥 '+winStreak+' 连胜',cw/2,cardY+cardH+22);
        }
    }

    const btnY=ch*0.87,btnW=S(160),btnH=S(40),btnGap=S(20);
    const btnsTotalW=btnW*2+btnGap;
    const btn1X=cw/2-btnsTotalW/2,btn2X=btn1X+btnW+btnGap;
    gameOverBtns.length=0;
    gameOverBtns.push({x:btn1X,y:btnY,w:btnW,h:btnH,type:'menu'});
    ctx.fillStyle='rgba(255,255,255,0.06)';ctx.strokeStyle='rgba(255,255,255,0.15)';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.roundRect(btn1X,btnY,btnW,btnH,10);ctx.fill();ctx.stroke();
    ctx.font=`${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ccc';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('🏠 返回主页',btn1X+btnW/2,btnY+btnH/2);
    gameOverBtns.push({x:btn2X,y:btnY,w:btnW,h:btnH,type:'restart'});
    ctx.fillStyle='#ff6644';ctx.shadowColor='#ff6644';ctx.shadowBlur=15;
    ctx.beginPath();ctx.roundRect(btn2X,btnY,btnW,btnH,10);ctx.fill();ctx.shadowBlur=0;ctx.shadowColor='transparent';
    ctx.font=`bold ${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('🔄 继续游戏',btn2X+btnW/2,btnY+btnH/2);
}
// ─── 排行榜系统 ───
let lbTab = 0; // 0=国服, 1=市区, 2=好友
function drawLeaderboard() {
    const cw=GAME_W,ch=GAME_H;
    ctx.fillStyle='rgba(0,0,0,0.9)';ctx.fillRect(0,0,cw,ch);
    
    // 标题
    ctx.font=`bold ${S(42)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='#ffcc44';ctx.fillText('🏆 排行榜',cw/2,ch*0.06);
    
    // 标签页
    const tabs=['☆ 国服','◎ 市区','♥ 好友'];
    const tabW=S(110),tabH=S(32),tabGap=S(8);
    const tabsW=tabs.length*tabW+(tabs.length-1)*tabGap;
    let sx=(cw-tabsW)/2;
    const tabY=ch*0.12;
    for(let i=0;i<tabs.length;i++){
        const sel=i===lbTab;
        ctx.fillStyle=sel?'rgba(100,200,255,0.15)':'rgba(255,255,255,0.03)';
        ctx.strokeStyle=sel?'rgba(100,200,255,0.4)':'rgba(255,255,255,0.08)';
        ctx.lineWidth=1;
        ctx.beginPath();ctx.roundRect(sx,tabY,tabW,tabH,8);ctx.fill();ctx.stroke();
        if(sel){ctx.fillStyle='#64c8ff';ctx.beginPath();ctx.roundRect(sx+15,tabY+tabH-3,tabW-30,3,2);ctx.fill();}
        ctx.font=sel?`bold ${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`:`${S(20)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
        ctx.fillStyle=sel?'#64c8ff':'rgba(255,255,255,0.4)';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(tabs[i],sx+tabW/2,tabY+tabH/2);
        sx+=tabW+tabGap;
    }
    
    // 获取排行榜数据
    const all=getLeaderboard();
    let filtered = [];
    if(lbTab===0) filtered = all;
    else if(lbTab===1) filtered = all.filter(n => n.city===playerCity);
    else filtered = all.filter(n => n.isPlayer || friendList.includes(n.name));
    // 如果市区/好友为空则显示全部
    if(filtered.length===0) filtered = all;
    
    // 表头
    const listY=ch*0.20;
    ctx.font=`${S(18)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='rgba(255,255,255,0.3)';
    ctx.fillText('排名',cw*0.08,listY-6);
    ctx.fillText('玩家',cw*0.25,listY-6);
    ctx.fillText('段位',cw*0.50,listY-6);
    ctx.fillText('RP',cw*0.68,listY-6);
    ctx.fillText('胜场',cw*0.85,listY-6);
    
    // 分隔线
    ctx.fillStyle='rgba(255,255,255,0.08)';
    ctx.fillRect(cw*0.06,listY+4,cw*0.88,1);
    
    let y=listY+14;
    const rowH=S(28);
    const displayCount=Math.min(filtered.length,40);
    for(let i=0;i<displayCount;i++){
        const n=filtered[i];
        const rank=i+1;
        const medal=rank===1?'🥇':(rank===2?'🥈':(rank===3?'🥉':''));
        const t=getRankTier(n.rp);
        const lv=['I','II','III'][Math.min(2,Math.floor(getRankLevel(n.rp))-1)];
        
        // 行背景
        if(n.isPlayer){
            ctx.fillStyle='rgba(100,200,255,0.1)';
            ctx.strokeStyle='rgba(100,200,255,0.2)';ctx.lineWidth=1;
            ctx.beginPath();ctx.roundRect(cw*0.04,y-2,cw*0.92,rowH,6);ctx.fill();ctx.stroke();
        } else {
            ctx.fillStyle=i%2===0?'rgba(255,255,255,0.03)':'transparent';
            ctx.fillRect(cw*0.04,y-2,cw*0.92,rowH);
        }
        
        // 排名
        ctx.textAlign='center';ctx.font=medal?`${S(24)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`:`${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
        ctx.fillStyle=medal?'#fff':'rgba(255,255,255,0.5)';
        ctx.fillText(medal||rank,cw*0.08,y+rowH/2);
        
        // 名字
        ctx.textAlign='left';ctx.font=n.isPlayer?`bold ${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`:`${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
        ctx.fillStyle=n.isPlayer?'#64c8ff':'rgba(255,255,255,0.8)';
        ctx.fillText(n.name,cw*0.14,y+rowH/2);
        
        // 段位
        ctx.textAlign='center';ctx.font=`${S(20)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
        ctx.fillStyle=t.color;
        ctx.fillText(t.icon+' '+t.name+' '+lv,cw*0.50,y+rowH/2);
        
        // RP
        ctx.textAlign='center';ctx.font=`bold ${S(21)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
        ctx.fillStyle='#ffcc44';
        ctx.fillText(n.rp,cw*0.68,y+rowH/2);
        
        // 胜场
        ctx.textAlign='center';ctx.font=`${S(20)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
        ctx.fillStyle='rgba(255,255,255,0.5)';
        ctx.fillText(n.wins+'/'+n.matches,cw*0.85,y+rowH/2);
        
        y+=rowH+3;
    }
    
    // 返回按钮
    const btnY=ch*0.92,btnW=S(160),btnH=S(40);
    ctx.fillStyle='rgba(255,255,255,0.06)';ctx.strokeStyle='rgba(255,255,255,0.15)';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.roundRect(cw/2-btnW/2,btnY,btnW,btnH,10);ctx.fill();ctx.stroke();
    ctx.font=`${S(23)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.fillStyle='#ccc';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('🔙 返回主菜单',cw/2,btnY+btnH/2);
}
function handleLeaderboardClick(mx,my){
    const cw=GAME_W,ch=GAME_H;
    // 标签页
    const tabs=['☆ 国服','◎ 市区','♥ 好友'];
    const tabW=S(110),tabH=S(32),tabGap=S(8);
    const tabsW=tabs.length*tabW+(tabs.length-1)*tabGap;
    let sx=(cw-tabsW)/2;
    for(let i=0;i<tabs.length;i++){
        if(mx>=sx&&mx<=sx+tabW&&my>=ch*0.12&&my<=ch*0.12+tabH){lbTab=i;return;}
        sx+=tabW+tabGap;
    }
    // 返回按钮
    const btnW=S(160),btnH=S(40),btnY=ch*0.92;
    if(mx>=cw/2-btnW/2&&mx<=cw/2+btnW/2&&my>=btnY&&my<=btnY+btnH){gameState='menu';}
}

function checkWinner() {
    if(selectedMode==='ffa'||selectedMode==='survival'){
        let aliveCount=0,lastAlive=null;
        for(const b of balls){if(b.isAlive){aliveCount++;lastAlive=b;}}
        if(aliveCount<=1)return aliveCount===1?lastAlive.team:'draw';
        return null;
    }
    let rAlive=0,bAlive=0,rHp=0,bHp=0;
    for(const b of balls){
        if(b.team==='red'){if(b.isAlive){rAlive++;rHp+=b.hp;}}else{if(b.isAlive){bAlive++;bHp+=b.hp;}}
    }
    if(rAlive===0&&bAlive>0)return'blue';
    if(bAlive===0&&rAlive>0)return'red';
    if(gameTime<=0){if(rHp>bHp)return'red';if(bHp>rHp)return'blue';return null;}
    return null;
}

// ═══════════════════════════════════════
//  毒圈系统 (生存模式)
// ═══════════════════════════════════════
function updateSurvivalZone(dt) {
    if (selectedMode !== 'survival' && selectedMode !== 'duo_survival') return;
    zoneState.timer += dt;

    // 检查阶段切换
    const nextPhase = zoneState.phase + 1;
    if (nextPhase < ZONE_PHASES.length && zoneState.timer >= ZONE_PHASES[nextPhase].time) {
        // 记录当前值为下一阶段的起始值
        zoneState.startRadius = zoneState.curRadius;
        zoneState.startCenterX = zoneState.curCenterX;
        zoneState.startCenterY = zoneState.curCenterY;

        zoneState.phase = nextPhase;
        zoneState.warning = false;
        triggerShake(6);

        // 设置下一阶段的缩圈目标
        const nextTarget = nextPhase + 1;
        if (nextTarget < ZONE_PHASES.length) {
            zoneState.targetRadius = SP(ZONE_PHASES[nextTarget].radius);
            // 在当前圈内随机选一个中心点
            const maxDist = Math.max(0, zoneState.startRadius - zoneState.targetRadius - 15);
            if (maxDist > 5) {
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * maxDist;
                zoneState.targetCenterX = zoneState.startCenterX + Math.cos(angle) * dist;
                zoneState.targetCenterY = zoneState.startCenterY + Math.sin(angle) * dist;
            } else {
                zoneState.targetCenterX = zoneState.startCenterX;
                zoneState.targetCenterY = zoneState.startCenterY;
            }
        }
        return; // 切换帧不造成伤害
    }

    // 阶段间平滑插值（从 start 到 target）
    if (zoneState.phase >= 0 && zoneState.phase + 1 < ZONE_PHASES.length) {
        const currTime = ZONE_PHASES[zoneState.phase].time;
        const nextTime = ZONE_PHASES[zoneState.phase + 1].time;
        const elapsed = zoneState.timer - currTime;
        const duration = nextTime - currTime;
        const t = Math.min(1, Math.max(0, elapsed / duration));
        // smoothstep 缓动
        const s = t * t * (3 - 2 * t);

        zoneState.curRadius = zoneState.startRadius + (zoneState.targetRadius - zoneState.startRadius) * s;
        zoneState.curCenterX = zoneState.startCenterX + (zoneState.targetCenterX - zoneState.startCenterX) * s;
        zoneState.curCenterY = zoneState.startCenterY + (zoneState.targetCenterY - zoneState.startCenterY) * s;

        // 缩圈前 3 秒警告
        const timeToShrink = nextTime - zoneState.timer;
        zoneState.warning = timeToShrink <= 3 && timeToShrink > 0;
    } else if (zoneState.phase === -1) {
        // 准备阶段，圈保持最大
        zoneState.curRadius = ARENA_RADIUS;
        zoneState.curCenterX = CENTER_X;
        zoneState.curCenterY = CENTER_Y;
    }

    // 圈外伤害
    if (zoneState.phase >= 0) {
        const dps = ZONE_PHASES[zoneState.phase].dmgPerSec;
        if (dps > 0) {
            zoneState.dmgAccum += dt * dps;
            if (zoneState.dmgAccum >= 1) {
                const dmg = Math.floor(zoneState.dmgAccum);
                zoneState.dmgAccum -= dmg;
                for (const b of balls) {
                    if (!b.isAlive) continue;
                    const dx = b.x - zoneState.curCenterX;
                    const dy = b.y - zoneState.curCenterY;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    if (dist > zoneState.curRadius) {
                        b.takeDamage(dmg, 0, 0, '#ff4444');
                        spawnHitParticles(b.x, b.y, '#ff4444', 4);
                    }
                }
            }
        }
    }
}

function drawSurvivalZone() {
    if (selectedMode !== 'survival' && selectedMode !== 'duo_survival') return;

    const cx = zoneState.curCenterX;
    const cy = zoneState.curCenterY;

    // 圈外红色叠加
    if (zoneState.phase >= 0) {
        const r = zoneState.curRadius;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, GAME_W, GAME_H);
        ctx.arc(cx, cy, r, 0, Math.PI*2, true);
        ctx.closePath();
        const alpha = Math.min(0.4, 0.1 + zoneState.phase * 0.07);
        ctx.fillStyle = `rgba(255,0,0,${alpha})`;
        ctx.fill();
        ctx.restore();

        // 圈边界
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI*2);
        const pulse = 0.7 + Math.sin(Date.now()/200) * 0.3;
        ctx.strokeStyle = `rgba(100,200,255,${pulse})`;
        ctx.lineWidth = 3;
        ctx.stroke();

        // 警告预判圈 (虚线)
        if (zoneState.warning && zoneState.phase+1 < ZONE_PHASES.length) {
            const nr = zoneState.targetRadius;
            const tx = zoneState.targetCenterX;
            const ty = zoneState.targetCenterY;
            ctx.beginPath();
            ctx.arc(tx, ty, nr, 0, Math.PI*2);
            ctx.setLineDash([6, 8]);
            ctx.strokeStyle = `rgba(255,255,255,${0.3 + Math.sin(Date.now()/150)*0.3})`;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = `bold ${S(24)}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;
            ctx.textAlign = 'center';
            const textY = Math.max(30, ty - nr - 20);
            ctx.fillStyle = `rgba(255,100,100,${0.5 + Math.sin(Date.now()/150)*0.5})`;
            ctx.fillText('⚠️ 即将缩圈', tx, textY);
        }
    }
}

// 生存模式掉落（只掉武器，在场人数2倍上限）
function spawnSurvivalDrop() {
    let alive = 0; for (const b of balls) { if (b.isAlive) alive++; }
    if (drops.length >= alive * 2) return; // 已达上限
    const r = Math.max(zoneState.curRadius * 0.7, 30);
    const a = Math.random() * Math.PI * 2;
    const dist = Math.random() * r;
    const x = zoneState.curCenterX + Math.cos(a) * dist;
    const y = zoneState.curCenterY + Math.sin(a) * dist;
    const w = randomWeapon();
    drops.push({ x, y, type:'weapon', data:w, spawnTime:Date.now()/1000 });
}

function endGame(winner) {
    resetJoystick();attackPressed=false;sound.gameOver();
    lastWinner = winner;

    // 计算金币
    let gold = 10; // 基础参与
    const player = balls.find(b => b.isPlayer);
    if (player) gold += player.kills * 5; // 击杀奖励
    const isPlayerWin = (selectedMode === '2v2' || selectedMode === '4v4' || selectedMode === 'team2' || selectedMode === 'team4')
        ? (winner === 'red' && player && player.team === 'red') || (winner === 'blue' && player && player.team === 'blue')
        : (winner && player && (winner === player.team));
    if (isPlayerWin) {
        if (selectedMode === 'survival' || selectedMode === 'duo_survival') gold += 50; // 吃鸡
        else gold += 20; // 团队胜利
        winStreak++;
        if (winStreak > bestStreak) bestStreak = winStreak;
        gold += winStreak * 5; // 连胜加成
    } else {
        winStreak = 0;
    }
    earnedGold = gold;
    playerGold += gold;
    totalGoldEarned += gold;
    goldPopup = 3; // 3秒弹窗

    // 段位 RP 计算
    const kills = player ? player.kills : 0;
    if (selectedMode !== 'training') {
        totalMatches++;
        if (isPlayerWin) {
            let rpGain = 15 + kills; // 基础 + 击杀
            rpGain += winStreak * 2; // 连胜加成
            rankPoints += rpGain;
            totalWins++;
            // 记录模式胜利
            if (!modeWins[selectedMode]) modeWins[selectedMode] = 0;
            modeWins[selectedMode]++;
        } else {
            let rpLoss = 5;
            rankPoints = Math.max(0, rankPoints - rpLoss);
        }
    }

    // 通行证 XP 计算
    if (player && selectedMode !== 'training') {
        let xpGain = 10 + kills * 3;
        if (isPlayerWin) xpGain += 20;
        if (winStreak > 1) xpGain += winStreak * 5;
        xp += xpGain;
        totalXPEarned += xpGain;
        totalKills += kills;
        // 升级检查
        while (passLevel < 50) {
            const needed = 80 + passLevel * 20;
            if (xp >= needed) { xp -= needed; passLevel++; }
            else break;
        }
        // 连胜解锁纹章
        for (const e of EMBLEMS) {
            if (bestStreak >= e.unlockAt && !unlockedEmblems.includes(e.id)) {
                unlockedEmblems.push(e.id);
            }
        }
    }
    saveProgress();

    if (selectedMode === '2v2' || selectedMode === '4v4' || selectedMode === 'team2' || selectedMode === 'team4') {
        if (winner === 'red') scores.red++;
        else if (winner === 'blue') scores.blue++;
        matchHistory.push({ round:roundNum, winner, kills:balls.map(b=>({name:b.name,kills:b.kills,team:b.team})) });

        if (scores.red >= WINS_NEEDED || scores.blue >= WINS_NEEDED) {
            gameState = 'champion';
            triggerShake(12);
            menuTimer = setTimeout(() => {
                scores = { red:0, blue:0 }; roundNum = 1; matchHistory = [];
                gameState = 'menu';
            }, 6000);
        } else {
            gameState = 'roundEnd';
            menuTimer = setTimeout(() => {
                roundNum++;
                initGame();
            }, 4000);
        }
    } else if (selectedMode === 'survival' || selectedMode === 'duo_survival') {
        gameState = 'ended';
        triggerShake(16);
        menuTimer = setTimeout(() => { gameState = 'menu'; }, 5000);
    } else {
        gameState = 'ended';
        menuTimer = setTimeout(() => { gameState = 'menu'; }, 3000);
    }
}

// ═══════════════════════════════════════
//  主循环
// ═══════════════════════════════════════
let lastTime = 0;

function gameLoop(time) {
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    // 重置 Canvas 状态（iOS/微信上 globalAlpha/shadow 等会泄漏到下一帧导致偏色）
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 清屏
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ▸ 主菜单
    if (gameState === 'menu') {
        buildMenu();
        drawMenu();
        Platform.requestAnimationFrame(gameLoop);
        return;
    }
    // ▸ 升级页面
    if (gameState === 'upgrade') {
        drawUpgradeMenu();
        Platform.requestAnimationFrame(gameLoop);
        return;
    }
    // ▸ 排行榜页面
    if (gameState === 'leaderboard') {
        drawLeaderboard();
        Platform.requestAnimationFrame(gameLoop);
        return;
    }

    // 屏幕震动（只在游戏区域生效）
    let shakeActive = screenShake > 0.5;
    if (shakeActive) {
        ctx.save();
        const sx = (Math.random()-0.5)*screenShake*2;
        const sy = (Math.random()-0.5)*screenShake*2;
        ctx.translate(sx, sy);
        screenShake *= 0.9;
    } else { screenShake = 0; }

    // 倒计时
    if (gameState === 'countdown') {
        countdownTimer -= dt;
        if (countdownTimer <= 0) gameState = 'playing';
    }

    // 游戏进行中
    if (gameState === 'playing') {
        // 加速键处理
        if (boostPressed && boostCooldown <= 0) {
            for (const b of balls) {
                if (b.isPlayer || b.isPlayer2) b.boostTimer = BOOST_DURATION;
            }
            boostCooldown = BOOST_COOLDOWN;
        }
        boostPressed = false;
        if (boostCooldown > 0) boostCooldown -= dt;

        gameTime -= dt;
        if (gameTime <= 0) {
            if (!isOvertime) {
                const w = checkWinner();
                if (w) endGame(w);
                else { isOvertime=true; gameTime=30; for(const b of balls) b.speed=SP(220); }
            } else {
                endGame(checkWinner()||'draw');
            }
        }

        for (const b of balls) b.update(dt);
        projectiles = projectiles.filter(p => !p.update(dt));

        // 击杀连杀检测
        for (const b of balls) {
            if (b.kills > b._prevKills) {
                const streak = b.kills;
                const colors = {1:'#ffdd44',2:'#ffdd44',3:'#ff8800',4:'#ff8800',5:'#ff4444'};
                killNotifications.push({
                    x:b.x, y:b.y-SP(30),
                    text:`击杀×${streak}`,
                    color:colors[Math.min(streak,5)]||'#ff4444',
                    timer:1.5, maxTimer:1.5, size:SP(20)+Math.min(streak,5)*2
                });
                b._prevKills = b.kills;
            }
        }

        // FFA / 生存 提前结束检测
        if (selectedMode === 'ffa' || selectedMode === 'survival') {
            let aliveCount = 0, lastAlive = null;
            for (const b of balls) { if (b.isAlive) { aliveCount++; lastAlive = b; } }
            if (aliveCount <= 1) {
                endGame(aliveCount === 1 ? lastAlive.team : 'draw');
            }
        }
        // 组队吃鸡 队伍淘汰检测
        if (selectedMode === 'duo_survival') {
            const aliveTeams = new Set();
            for (const b of balls) { if (b.isAlive) aliveTeams.add(b.team); }
            if (aliveTeams.size <= 1) {
                const winner = aliveTeams.size === 1 ? [...aliveTeams][0] : 'draw';
                endGame(winner);
            }
        }

        // 毒圈更新
        if (selectedMode === 'survival' || selectedMode === 'duo_survival') {
            updateSurvivalZone(dt);
        }

        if (selectedMode === 'training') {
            for (const d of drops) {
                if (d.isTrainingDrop && d.respawnTimer > 0) {
                    d.respawnTimer -= dt;
                    if (d.respawnTimer <= 0) {
                        d.x = d.originX; d.y = d.originY;
                        d.respawnTimer = 0;
                        d.spawnTime = Date.now() / 1000;
                    }
                }
            }
            gameTime = 99;
        } else if (selectedMode === 'survival' || selectedMode === 'duo_survival') {
            spawnTimer += dt;
            if (spawnTimer >= 1.5) { spawnTimer = 0; spawnSurvivalDrop(); }
        } else {
            spawnTimer += dt;
            if (spawnTimer >= 5) { spawnTimer = 0; spawnDrop(); }
        }
        const now = Date.now()/1000;
        drops = drops.filter(d => d.isTrainingDrop || (now - d.spawnTime < 15));

        // 随机加速带刷新（10秒出现，持续5秒）
        speedZone.timer += dt;
        if (!speedZone.active) {
            if (speedZone.timer >= 10) {
                const a = Math.random() * Math.PI * 2;
                const r = 20 + Math.random() * (ARENA_RADIUS - 90);
                speedZone.x = CENTER_X + Math.cos(a) * r;
                speedZone.y = CENTER_Y + Math.sin(a) * r;
                speedZone.active = true;
                speedZone.timer = 0;
            }
        } else {
            if (speedZone.timer >= 5) {
                speedZone.active = false;
                speedZone.timer = 0;
            }
        }

        checkPickups();

        if (attackPressed || attackJustPressed) {
            const pb = balls.find(b => b.isPlayer);
            if (pb && pb.isAlive) pb.autoAttack();
            attackJustPressed = false;
        }
        if (p2AttackPressed || p2AttackJustPressed) {
            const p2b = balls.find(b => b.isPlayer2);
            if (p2b && p2b.isAlive) p2b.autoAttack();
            p2AttackJustPressed = false;
        }
        // 机器人自动攻击（根据难度递增）
        const atkProbs = [0.12, 0.22, 0.35];
        const atkProb = atkProbs[aiDifficulty] || 0.15;
        for (const b of balls) {
            if (!b.isPlayer && !b.isPlayer2 && b.isAlive && Math.random() < atkProb) {
                b.autoAttack();
            }
        }
    }

    // 粒子更新
    particles = particles.filter(p => { p.update(dt); return !p.dead; });

    // 新手引导计时
    if (guideTimer > 0) {
        guideTimer -= dt;
        if (guideTimer <= 0) { guideTimer = 0; Platform.setItem('guide_shown', '1'); }
    }

    // 绘制
    drawArena();
    drawSurvivalZone(); // 毒圈 (在半透明层上)
    for (const b of balls) b.draw();
    ctx.globalAlpha = 1; // 球体绘制可能遗留 globalAlpha=0.3，这里确保重置
    for (const p of projectiles) p.draw();
    for (const d of drops) drawDrop(d);
    for (const p of particles) p.draw();
    // 击杀通知
    for (let i=killNotifications.length-1;i>=0;i--){
        const kn=killNotifications[i];
        kn.timer-=dt;
        if(kn.timer<=0){killNotifications.splice(i,1);continue;}
        const a=Math.max(0,kn.timer/kn.maxTimer);
        const yOff=(1-a)*50;
        ctx.globalAlpha=Math.min(1,a*2);
        ctx.font=`bold ${kn.size}px Arial,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.strokeStyle='#000';ctx.lineWidth=3;
        ctx.strokeText(kn.text,kn.x,kn.y-yOff);
        ctx.fillStyle=kn.color;ctx.fillText(kn.text,kn.x,kn.y-yOff);
        ctx.globalAlpha=1;
    }

    if (shakeActive) ctx.restore(); // 震动恢复

    // UI 层（不受震动影响）
    if (gameState === 'countdown') drawCountdown();
    drawHUD();
    drawGuide();
    drawJoystick();
    drawAttackButton();
    drawBoostButton();
    drawMobileUI();

    if (gameState === 'roundEnd') drawRoundEnd();
    if (gameState === 'champion') drawChampion();
    if (gameState === 'ended') drawGameOver();

    // 受伤闪红
    if (damageFlash > 0.01) {
        ctx.fillStyle = `rgba(255,0,0,${damageFlash*0.3})`;
        ctx.fillRect(0, 0, GAME_W, GAME_H);
        damageFlash *= 0.85;
    } else damageFlash = 0;

    Platform.requestAnimationFrame(gameLoop);
}

// ═══════════════════════════════════════
//  启动
// ═══════════════════════════════════════
// ─── 自动启动（浏览器通过 script 加载，mini game 通过 require） ───
resizeCanvas();
loadProgress();
gameState = 'menu';
Platform.requestAnimationFrame(gameLoop);
