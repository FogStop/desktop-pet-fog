/**
 * dsh-pet desktop helper —— 宠物本体（PetSprite 类）。
 *
 * 播放 / 拖拽抛掷 / 跨窗碰撞 / 点击穿透 / 右键菜单 / 聊天弹窗 / 气泡渲染。
 * 事件联动（余额 / 碎碎念 / 广播 / 工作状态）不在此文件——见 events.js。
 * 依赖 constants.js 的全局（CONFIG / VIEW / BASE / S / config / sprites 等），须后加载。
 */
'use strict';

// 点击俏皮话池已搬进 shared/life.ts（CLICK_LINES，按连击情绪分档：俏皮→痒→烦→气→求饶），
// 浏览器端共用同一份——两端台词/情绪档位不会漂。本地不再维护字面量，见 sayCatchLine。

// ---- 活动状态感知（"主人正在干什么"）----
// 前台窗口探针推来进程名+标题 → 分类成状态 → 切换行为（安静/活泼）与台词池。
// 识别顺序有讲究：coding/watching 必须排在 browser 前（Code 是独立进程没问题，
// 但视频网站在浏览器里跑，标题含站名就得先认成 watching 而不是 browsing）。

/** 求关注/重逢台词的节流间隔（ms）：说过一次后至少隔这么久才再说，否则每 90s 撒一次娇 */
const ABSENCE_LINE_GAP_MS = 10 * 60_000;

const ACTIVITY_QUIET = new Set(['coding', 'watching', 'work']); // 安静型状态：不漫游不转身，乖乖待着
// 这三个场景主人一待就是很久，也最想听它碎嘴 → 自言自语间隔缩短一半（见 startLifeLines）
const ACTIVITY_CHATTY = new Set(['music', 'watching', 'chatting']);
const ACTIVITY_WELCOME = {
  coding: '哦？开始写代码啦，我不吵你～',
  music: '听歌啦？我也跟着晃两下～',
  watching: '看剧啦？我也蹭着看两眼～',
  chatting: '聊天呢？那我安静会儿…才怪～',
  browsing: '逛网页呢，带我一个～',
  gaming: '打游戏？给主人加油！',
  work: '干活啦？我陪你～',
  other: '',
};
const ACTIVITY_LINES = {
  coding: [
    '哇，主人敲代码的样子好帅～',
    '这堆代码我看不懂…但主人肯定搞得定！',
    '悄悄学几招，以后帮主人写脚本～',
    'Bug 什么的，交给主人就稳了～',
    '主人敲键盘的声音真好听～',
    '写累了记得起来走走哦～',
    '这缩进，强迫症表示很舒服～',
    '别 Ctrl+S 按那么猛，手会酸的～',
  ],
  music: [
    '前奏一响，我就知道是主人喜欢的那首～',
    '这个节奏，我尾巴想跟着晃～',
    '单曲循环第几遍啦？我帮你数着呢～',
    '副歌来了！（小小声跟着哼）',
    '主人是不是又把歌单听到底了？',
    '耳机分我一半好不好～',
    '这旋律好听，我偷偷记下来啦～',
    '音量再小一点点，耳朵会累的哦～',
    '听到这首就想起主人上次哼它的时候～',
    '歌单里藏了多少首呀，我猜一大堆～',
    '这歌手的声音好温柔～',
    '要不要切下一首？我帮你按～',
    '跟着节奏晃两下，不算捣乱吧？',
    '深夜听歌最有感觉了～',
    '这首歌适合下雨天听～',
    '主人听歌的时候，安安静静的好看～',
    '我也想学唱，可惜只会哼调调～',
    '这 bass 有点上头呀～',
    '循环到第三遍了哦，我记着呢～',
    '听见没，这段间奏超好听～',
    '别听太伤感的歌呀，我会心疼的～',
    '开心的时候听歌，快乐会翻倍～',
    '主人喜欢的歌，我都悄悄记下来了～',
    '这歌词写得好，像在讲一个小故事～',
    '要不要开外放？我也想听清楚点～',
    '歌单更新啦？快让我听听～',
    '这歌适合配一杯热饮～',
    '听到熟悉的歌，心情会不自觉地变好～',
    '主人今天听的歌，比昨天欢快～',
    '轻音乐的话，我陪主人安静待着～',
    '这段旋律，我给满分！',
    '听歌的时候不许想烦心事哦～',
    '要不要试试随机播放？惊喜感满满～',
    '先暂停一下，喝口水再听嘛～',
    '这歌我给主人留着，难过的时候听～',
    '主人跟着唱啦？跑调我也鼓掌～',
    '这节奏适合踩点，一二三四～',
    '歌放太久没切，是睡着了吗？',
  ],
  watching: [
    '这剧情好精彩，我也想搬个小板凳一起看～',
    '主人看剧都不带我，哼～',
    '（假装认真陪看）这个主角真好看呀～',
    '看累了记得歇歇眼睛哦～',
    '这剧我陪你一起追呀～',
    '广告时间，主人正好歇会儿～',
    '这音乐一响，我就知道要来了～',
    '一集看完记得起来活动活动～',
    '这集留着明天看吧，会困的～',
    '弹幕比剧情还好看哈哈哈～',
    '反派好像要搞事了，我好紧张！',
    '片头曲别跳过呀，其实很好听～',
    '倍速看剧是对好剧的浪费哦～',
    '主人看得好认真，我都不敢出声～',
    '这特效做得真漂亮～',
    '是不是又熬夜追剧啦？',
    '看到感人的地方，我也要纸巾～',
    '这个镜头构图好棒，截下来当壁纸～',
    '主角好惨，抱抱～',
    '下一集！下一集！（疯狂催更）',
    '主人笑得好开心，我也跟着笑～',
    '这个伏笔我早就发现了～',
    '追剧配零食，快乐会加倍～',
    '看到第几集啦？我帮你记着～',
    '这剧的 BGM 真上头～',
    '恐怖镜头的话，我先捂眼睛啦～',
    '纪录片也很好看，还能长知识～',
    '看累了就闭眼歇十秒钟～',
    '这个演员演得真好～',
    '主人是不是在二刷？我都认得啦～',
    '弹幕说得有道理哈哈～',
    '这剧情走向，完全没猜到！',
    '看剧的时候肩膀放松点哦～',
    '进度条怎么跑这么快，慢点看～',
    '我也想挤到沙发上一起看～',
    '这集看完就睡好不好？',
    '主人盯着屏幕都不眨眼啦～',
    '这剧情甜得我牙都要掉了～',
  ],
  chatting: [
    '主人又在和别人聊天，都不理我……',
    '聊这么久，我也想插句话～',
    '哼，那个对话框是谁呀？',
    '主人聊得开心就好，我乖乖趴着～',
    '说好的陪我玩呢！',
    '打字慢点，别把人吓跑啦～',
    '有没有聊到我呀？肯定没有……',
    '下次聊天带上我嘛，我超会接话的～',
    '是谁发消息来啦？我偷看一眼～',
    '群消息刷得好快呀～',
    '主人打字好快，我都看不清～',
    '表情包准备好了吗？关键时刻要用！',
    '是不是在等人回复呀？',
    '聊这么久，喝口水润润喉～',
    '对方是不是讲笑话了？主人笑得好甜～',
    '要不要回个表情包缓和气氛～',
    '这个对话框，我帮主人盯着～',
    '和喜欢的人聊天，尾音都会上扬～',
    '回消息别太急，想清楚再发～',
    '主人聊到开心的事啦？',
    '深夜聊天最容易说心里话呢～',
    '对方发了个长语音？我陪你听～',
    '聊天也要记得休息眼睛哦～',
    '要不要先忙完再回人家？',
    '主人是群里的活跃分子吧～',
    '这条消息要不要撤回？（小声）',
    '聊完记得和我说说话嘛～',
    '我在旁边安静听着，不打扰～',
    '是不是有人夸主人啦？肯定有！',
    '回得这么快，一定很重要～',
    '打字别太用力，键盘会疼的～',
    '视频通话吗？那我先躲一躲～',
    '和老朋友聊天最舒服啦～',
    '主人嘴角上扬了哦，我都看到啦～',
    '聊天记录是不是存了好多～',
    '别聊太晚，明天还要早起呢～',
    '对方回了个"嗯"？那我也"嗯"～',
    '要是可以，我也想钻进屏幕里说两句～',
  ],
  browsing: [
    '网上冲浪呢主人～',
    '看到什么好东西啦？',
    '别刷太久，歇歇眼睛呀～',
    '这网页我帮你盯着，放心～',
    '又在比价？划算就拿下！',
    '刷到好玩的记得讲给我听～',
    '购物车别加太多，我会吃醋的～',
    '收藏夹要爆炸啦主人～',
  ],
  gaming: [
    '主人打游戏好投入呀～',
    '赢了赢了？我猜一定赢了！',
    '打累了记得起来走走哦～',
    '我也想操作一下！（并不会）',
    '这波操作帅啊！',
    '输了也没关系，还有我陪你～',
    '连跪就歇会儿吧主人～',
    '这手速，我学都学不来～',
  ],
  work: [
    '认真工作的主人最棒啦～',
    '文档写得怎么样啦？',
    '忙完记得起来活动活动哦～',
    '我来给你加油打气！',
    '这表格我盯不动…靠主人了～',
    '做得差不多了就歇口气呀～',
    '老板要是问，就说我一直陪着呢～',
    '报告写累了，喝口水再战～',
  ],
  other: [
    '主人忙啥呢？带带我呗～',
    '我在这儿陪着你呢～',
    '坐久了记得起来伸个懒腰哦～',
    '要不要喝口水歇一下？',
    '主人累不累呀？我哄哄你～',
    '哼，又在弄什么好玩的？',
    '我一直都在，随时找我玩～',
    '眼睛累了吧？看看远处缓一缓～',
  ],
};

// ---- 活生生气息：为各工作状态扩充台词（追加进池，随机链自然抽到，零 token）----
Object.assign(ACTIVITY_LINES.coding, [
  '这报错长得像只小虫，我来帮主人抓住它！',
  '写到一半卡住了？深呼吸，重来一次～',
  '主人敲代码时的眼神，特别认真特别帅！',
  '要不要我帮你按 F5？（伸出小爪爪）',
  '缩进对齐，强迫症表示很满意～',
]);
Object.assign(ACTIVITY_LINES.watching, [
  '这反转我早猜到了！（其实没有）',
  '主人别哭，我递纸巾～',
  '这画面我能记一辈子～',
  '等下集！我等得起！（趴好）',
  '片尾曲一起，今天又追完一集啦～',
]);
Object.assign(ACTIVITY_LINES.chatting, [
  '提示音一响，主人又去聊天啦……',
  '聊到我了没？没有的话我再等等～',
  '主人打字好快，一定是老手！',
  '对面头像挺可爱……哼，没我可爱！',
  '聊完记得回来摸摸我呀～',
]);
Object.assign(ACTIVITY_LINES.browsing, [
  '刷到这个点了，眼睛要休息啦～',
  '这个帖子好有意思，念给我听听嘛～',
  '网购一时爽，月底火葬场，主人悠着点～',
  '网页加载中……我帮主人盯进度条！',
  '收藏夹快爆炸啦主人～',
]);
Object.assign(ACTIVITY_LINES.gaming, [
  '这走位！这意识！主人是天选之子！',
  '输了就输了，我陪主人再来一把～',
  '这 BOSS 也太肉了，加油磨！',
  '键盘都要被主人按冒烟啦～',
  '赢一局庆祝一下！输一局……也庆祝！',
]);
Object.assign(ACTIVITY_LINES.work, [
  '这文档排版真舒服，强迫症表示满意～',
  '摸鱼的时候记得小声点，我帮主人望风！',
  '老板的红色批注……主人稳住！',
  '快到下班点了，胜利在望！',
  '做完这页就喝口水歇歇吧～',
]);
Object.assign(ACTIVITY_LINES.other, [
  '主人伸懒腰的样子最可爱啦～',
  '我学了一招新的卖萌技巧，要看吗？',
  '天气这么好，适合晒晒太阳（虽然我是电子的）～',
  '主人是饿了还是困了呀？',
  '我在呢，随时找我玩～',
]);

// ---- 换装（形象染色）：素材只有小胖鱼一套，但可以用 CSS filter 实时给整套动画换配色。
// 换装立即生效、可来回切换（不落盘，重启恢复原装）。filter 为空 = 原装。----
const COSTUMES = [
  { id: '原装', filter: '' },
  { id: '草莓奶昔', filter: 'hue-rotate(-18deg) saturate(1.55) brightness(1.06)' },
  { id: '薄荷苏打', filter: 'hue-rotate(96deg) saturate(1.4) brightness(1.03)' },
  { id: '天空蓝莓', filter: 'hue-rotate(175deg) saturate(1.35) brightness(1.05)' },
  { id: '紫罗兰梦', filter: 'hue-rotate(235deg) saturate(1.35) brightness(1.02)' },
  { id: '黄金圣衣', filter: 'sepia(1) saturate(2.4) hue-rotate(-25deg) brightness(1.12)' },
  { id: '赛博霓虹', filter: 'hue-rotate(310deg) saturate(2.1) contrast(1.12) brightness(1.05)' },
  { id: '暗夜魅影', filter: 'brightness(0.78) contrast(1.25) saturate(1.1)' },
];

// ---- 形象（真实素材切换，不是染色）：同一只桌宠可以整套换成别的角色素材 ----
// 素材来自 dsh-pet 官方生态包（@linxin666/dsh-pet）：ouo-neko（OUO 猫咪，MIT）。
// 每个形象把 atlas 精灵图切成 9 个透明 webm（VP8 alpha），平铺放到
//   $DSH_HOME/dsh-pet/pet/<id>-animation/<动画名>.webm  （注意：没有 webm/ 子目录）
// 动画 URL 走 /thumb/<id>/<动画名>.webm，host 先查该目录。
// 形象只覆盖下面 9 个基础动作，config 里其余 ~97 个动画名经 SKIN_FALLBACK 语义映射到
// 本形象自有基础动作，全程不回退小胖鱼原版、也不 404。
// 形象清单：main = 小胖鱼原版（永不变）；其余为 Petdex 社区形象（petdex.dev，
// spritesheet 8x9 切成 9 个 VP8 alpha webm）。2026-10-16 由用户从 36 只候选里点选 20 只替换。
const SKINS = [
  { id: 'main', label: '小胖鱼（原版）' },
  { id: 'batmeme', label: '蝙蝠梗' },
  { id: 'gourmand-slugcat', label: '饕餮蛞蝓猫' },
  { id: 'glitchcat', label: '故障猫' },
  { id: 'brick-bat', label: '砖块蝙蝠' },
  { id: 'bumblebee', label: '大黄蜂' },
  { id: 'batrider-pixel', label: '蝙蝠骑士' },
  { id: 'bronya-silverwolfback', label: '布洛妮娅·银狼' },
  { id: 'ray-bunny', label: '雷光兔' },
  { id: 'bartholomew-bear', label: '巴塞洛缪熊' },
  { id: 'capybara-lulu', label: '水豚噜噜' },
  { id: 'mochi-final', label: '麻薯' },
  { id: 'blue-boba-axolotl', label: '波霸美西螈' },
  { id: 'pitty-pup', label: '小可怜狗' },
  { id: 'codex-silver-kitten', label: '银色小猫' },
  { id: 'momo-bunny', label: '桃桃兔' },
  { id: 'luffy-gear-5-chibi', label: '路飞五档' },
  { id: 'milk-tea-koala', label: '奶茶小考拉' },
  { id: 'star-trooper', label: '星际士兵' },
  { id: 'vanilla-chibi-accurate', label: '香草Q版' },
  { id: 'grassland-cow', label: '草地牛' },
];
// 默认 9 动作映射：Petdex 系形象统一按这 9 个动画名落盘
// （$DSH_HOME/dsh-pet/pet/<id>-animation/<动画名>.webm），无需逐形象重复声明。
const SKIN_TRACKS_DEFAULT = new Set([
  '待机呼吸休闲', // idle
  '原地小憩沉眠', // waiting
  '原地左转奔跑', // running
  '螃蟹走路', // running-right
  '原地漂浮踏步', // running-left
  '女仆屈膝礼仪', // waving
  '原地跳跃抓碎头顶物品', // jumping
  '打瞌睡被惊醒', // failed
  '深度思考碎碎念', // review
]);
// 逐形象自定义动作集合。当前全部形象都只有那 9 个基础动作，
// 统一走 SKIN_TRACKS_DEFAULT，故此处留空（需要个别形象特殊映射时再往里加）。
const SKIN_TRACKS = {};

// ---------- 大小档位（相对配置里 pets[].size 的缩放，右键菜单「大小」可实时切换） ----------
// 为什么需要它：小胖鱼素材是 640×360 且角色四周留白很多，而 Petdex 形象是 192×208 的
// **紧贴裁切**精灵表——同样按 462px 宽去摆，角色本体看起来会大一大截。所以切到形象时
// 自动降到 SKIN_DEFAULT_SCALE，用户随时可以在「大小」里改回或调更小。
const SIZE_STEPS = [
  { label: '特大 130%', scale: 1.3 },
  { label: '大 110%', scale: 1.1 },
  { label: '标准 100%', scale: 1.0 },
  { label: '中 85%', scale: 0.85 },
  { label: '小 70%', scale: 0.7 },
  { label: '迷你 55%', scale: 0.55 },
];
const SKIN_DEFAULT_SCALE = 0.7; // 非 main 形象的自动档（紧贴裁切，等比同宽会显大）
const SIZE_STORE_KEY = 'dsh-pet.sizeScale';

// 形象切换后的「未覆盖动画」兜底映射：Petdex 系形象只有上面 9 个基础动作，
// 但 config.jsonc 里还有 ~97 个交互/分类/事件动画名。原本这些会回退到小胖鱼原版（变回小胖鱼），
// 现在统一映射到该形象自有的某个基础动作（按语义近似），保证切换形象后任何动画都只播本形象、绝不回退。
// 键 = config.jsonc 里的动画名；值 = 该形象 <id>-animation/ 下真实存在的 9 基础名之一。
const SKIN_FALLBACK = {
  // —— 转向 / 拖拽 / 点击回应 ——
  '东张西望': '原地左转奔跑',
  '被鼠标拖拽悬空反馈': '原地小憩沉眠',
  '点击回应-开心跃动': '原地跳跃抓碎头顶物品',
  '点击回应-害羞惊讶': '女仆屈膝礼仪',
  '点击回应-傲娇生气': '打瞌睡被惊醒',
  '点击回应-挠痒咯咯笑': '原地跳跃抓碎头顶物品',
  '点击回应-元气挥手': '女仆屈膝礼仪',
  // —— 小动作 ——
  '悠闲哼歌': '待机呼吸休闲',
  '超大伸懒腰': '待机呼吸休闲',
  '原地敲击桌面互动': '待机呼吸休闲',
  '原地重力下蹲压缩': '待机呼吸休闲',
  '哈欠连天': '原地小憩沉眠',
  '被吓一跳': '打瞌睡被惊醒',
  '小幅度原地360度旋转展示': '原地左转奔跑',
  '偷吃零食被抓住': '待机呼吸休闲',
  '用鲸鱼尾巴拍打地面': '待机呼吸休闲',
  '照镜子': '女仆屈膝礼仪',
  '整体换装试色': '女仆屈膝礼仪',
  '轻快记录': '深度思考碎碎念',
  '写代码': '深度思考碎碎念',
  '摇扇纳凉': '待机呼吸休闲',
  '晨间刷牙': '待机呼吸休闲',
  // —— 玩耍 ——
  '原地专心玩魔方': '深度思考碎碎念',
  '原地蹲下玩玩具汽车': '待机呼吸休闲',
  '鲸鱼吐泡泡特效': '待机呼吸休闲',
  '玩游戏气急败坏': '打瞌睡被惊醒',
  '玩水枪': '原地跳跃抓碎头顶物品',
  '小提琴演奏': '女仆屈膝礼仪',
  '蓝鲸现世': '原地左转奔跑',
  '优雅女仆舞': '女仆屈膝礼仪',
  '轻快摇摆舞': '女仆屈膝礼仪',
  '可爱宅舞': '女仆屈膝礼仪',
  '吹气球': '待机呼吸休闲',
  '动物环绕': '原地左转奔跑',
  '放风筝': '待机呼吸休闲',
  '拆礼物': '女仆屈膝礼仪',
  '变鸽子': '原地跳跃抓碎头顶物品',
  '扑克魔术': '女仆屈膝礼仪',
  '抽陀螺': '原地跳跃抓碎头顶物品',
  '吹笛子': '女仆屈膝礼仪',
  '蝴蝶蜜蜂环绕头顶开花': '待机呼吸休闲',
  '撸猫': '待机呼吸休闲',
  '凭空生花': '女仆屈膝礼仪',
  '骑木马': '原地左转奔跑',
  '三球抛接': '原地跳跃抓碎头顶物品',
  '踢毽子': '原地跳跃抓碎头顶物品',
  '下五子棋': '深度思考碎碎念',
  '荡秋千': '原地左转奔跑',
  // —— 吃什么 ——
  '吃白饭': '原地小憩沉眠',
  '大口吃零食': '原地小憩沉眠',
  '吃Token': '原地小憩沉眠',
  '吃早餐': '原地小憩沉眠',
  '吃午餐': '原地小憩沉眠',
  '吃晚餐': '原地小憩沉眠',
  '吃冰淇淋融化': '原地小憩沉眠',
  '吃大闸蟹': '原地小憩沉眠',
  '吃糖葫芦': '原地小憩沉眠',
  '吃长寿面': '原地小憩沉眠',
  '吃西瓜': '原地小憩沉眠',
  '涮火锅': '原地小憩沉眠',
  // —— 时节 ——
  '被落叶淹没': '原地小憩沉眠',
  '中秋赏月吃月饼': '原地小憩沉眠',
  '堆雪人': '待机呼吸休闲',
  '放烟花': '原地跳跃抓碎头顶物品',
  '吃粽子': '原地小憩沉眠',
  '吃年糕': '原地小憩沉眠',
  '吃青团': '原地小憩沉眠',
  '吃腊八粥': '原地小憩沉眠',
  '吃重阳糕': '原地小憩沉眠',
  '收红包': '女仆屈膝礼仪',
  '写福字': '深度思考碎碎念',
  '穿针乞巧': '深度思考碎碎念',
  '舞狮头': '女仆屈膝礼仪',
  '讨糖南瓜灯': '原地小憩沉眠',
  '插茱萸赏菊': '待机呼吸休闲',
  '放河灯': '待机呼吸休闲',
  '萌化小幽灵': '原地小憩沉眠',
  '装点圣诞树': '女仆屈膝礼仪',
  '放孔明灯': '待机呼吸休闲',
  '吃汤圆': '原地小憩沉眠',
  '吃饺子': '原地小憩沉眠',
  // —— 文字 ——
  '是啊，吃什么': '待机呼吸休闲',
  // —— 事件：余额 ——
  '余额-钱袋满溢': '女仆屈膝礼仪',
  '余额-金袋叮当': '女仆屈膝礼仪',
  '余额-钱袋如常': '待机呼吸休闲',
  '余额-数金皱眉': '深度思考碎碎念',
  '余额-袋空如洗': '原地小憩沉眠',
  '余额-分文不剩': '原地小憩沉眠',
  // —— 事件：碎碎念 ——
  '碎碎念-擦桌碎碎念': '深度思考碎碎念',
  '碎碎念-发呆碎碎念': '深度思考碎碎念',
  '碎碎念-对屏碎碎念': '深度思考碎碎念',
  // —— 事件：工作状态 ——
  '工作状态-思考冒泡': '深度思考碎碎念',
  '工作状态-忙碌点按': '深度思考碎碎念',
  '工作状态-清点归档': '深度思考碎碎念',
  '工作状态-原地踱步张望': '原地左转奔跑',
  '工作状态-雀跃庆祝': '原地跳跃抓碎头顶物品',
  '工作状态-垂头叹气冒汗': '打瞌睡被惊醒',
};

// ---- 动作元形池：用现有素材编排出的复合行为原型（依次播完一串动画 + 一句台词）----
// 让宠物不只会"单动画随机"——偶尔会连贯地打盹、臭美、表演，像真的活物一样有自己的小剧场。
// 每个元形：anims=动画序列（按序播完）；line=开场台词（可选）；cooldown=冷却（同元形不连播）。
const META_ACTIONS = [
  {
    id: '打盹',
    anims: ['超大伸懒腰', '哈欠连天', '原地小憩沉眠'],
    line: '唔…困了，我先眯一小会儿～',
    cooldown: 300000,
  },
  {
    id: '求夸夸',
    anims: ['优雅女仆舞', '原地敲击桌面互动'],
    line: '主人主人，我今天是不是超可爱！',
    cooldown: 420000,
  },
  {
    id: '偷吃被抓',
    anims: ['偷吃零食被抓住', '被吓一跳'],
    line: '啊！我什么都没干！（把零食藏到身后）',
    cooldown: 600000,
  },
  {
    id: '自娱自乐',
    anims: ['三球抛接', '下五子棋'],
    line: '自己和自己下棋……嘿，这局我赢啦！',
    cooldown: 480000,
  },
  {
    id: '臭美时刻',
    anims: ['照镜子', '整体换装试色'],
    line: '这件小裙子配我尾巴刚刚好～',
    cooldown: 600000,
  },
  {
    id: '演奏会',
    anims: ['小提琴演奏', '吹笛子'],
    line: '献上一首曲子，请主人欣赏～',
    cooldown: 600000,
  },
  {
    id: '玩水',
    anims: ['玩水枪', '鲸鱼吐泡泡特效'],
    line: 'biu biu biu！滋你一下～（逃）',
    cooldown: 540000,
  },
  {
    id: '魔法时刻',
    anims: ['扑克魔术', '变鸽子'],
    line: '见证奇迹的时刻！……鸽子呢？！',
    cooldown: 600000,
  },
  {
    id: '舞会',
    anims: ['可爱宅舞', '轻快摇摆舞', '优雅女仆舞'],
    line: '音乐响起，舞台就是我的！',
    cooldown: 480000,
  },
  {
    id: '杂耍大师',
    anims: ['原地跳跃抓碎头顶物品', '骑木马', '抽陀螺'],
    line: '看好了，这波操作！',
    cooldown: 540000,
  },
  {
    id: '变身秀',
    anims: ['萌化小幽灵', '蓝鲸现世', '鲸鱼吐泡泡特效'],
    line: '咕噜咕噜……大变身！',
    cooldown: 600000,
  },
  {
    id: '小精灵',
    anims: ['凭空生花', '蝴蝶蜜蜂环绕头顶开花', '动物环绕'],
    line: '我是住在屏幕里的小精灵～',
    cooldown: 600000,
  },
  {
    id: '夏日甜品',
    anims: ['吃西瓜', '吃冰淇淋融化', '吃糖葫芦'],
    line: '甜品时间！谁也别跟我抢～',
    cooldown: 540000,
  },
  {
    id: '一日三餐',
    anims: ['吃早餐', '吃午餐', '吃晚餐'],
    line: '一日三餐，顿顿不落，好幸福～',
    cooldown: 600000,
  },
  {
    id: '勤快时刻',
    anims: ['晨间刷牙', '轻快记录'],
    line: '我也是有勤快一面的哦～',
    cooldown: 600000,
  },
  {
    id: '热闹庆典',
    anims: ['放烟花', '放孔明灯', '放风筝'],
    line: '今晚的夜空，归我承包啦！',
    cooldown: 600000,
  },
  {
    id: '宠物乐园',
    anims: ['撸猫', '荡秋千', '踢毽子'],
    line: '喵～谁在摸我？（挠痒痒）',
    cooldown: 540000,
  },
  {
    id: '打工人日常',
    anims: ['工作状态-原地踱步张望', '工作状态-忙碌点按', '工作状态-垂头叹气冒汗'],
    line: '打工魂打工魂……好累哦，但是还要撑住！',
    cooldown: 600000,
  },
  {
    id: '收工庆祝',
    anims: ['工作状态-清点归档', '工作状态-雀跃庆祝'],
    line: '搞定收工！今天也要好好表扬自己～',
    cooldown: 600000,
  },
  {
    id: '数钱时刻',
    anims: ['余额-钱袋满溢', '余额-金袋叮当', '余额-数金皱眉'],
    line: '数钱数到手抽筋……这笔账怎么对不上！',
    cooldown: 600000,
  },
  {
    id: '破产三连',
    anims: ['余额-袋空如洗', '余额-分文不剩', '余额-钱袋如常'],
    line: '余额告急……但是没关系，开心最重要！',
    cooldown: 600000,
  },
  {
    id: '碎碎念专场',
    anims: ['碎碎念-发呆碎碎念', '碎碎念-对屏碎碎念', '碎碎念-擦桌碎碎念'],
    line: '自言自语时间到～（小声）主人在干嘛呢……',
    cooldown: 600000,
  },
  {
    id: '夸夸反应',
    anims: ['点击回应-元气挥手', '点击回应-开心跃动', '点击回应-害羞惊讶'],
    line: '诶嘿，被夸得不好意思啦～',
    cooldown: 600000,
  },
];

// 趴在窗口顶端 / 底端时的专属台词（躺顶 / 趴底，零 token）
const PERCH_LINES = {
  top: [
    '躺这儿晒晒太阳～',
    '爬到最顶上啦，视野真好～',
    '嘘，我在房梁上眯一会儿～',
    '高处风景独好～',
    '这顶上躺着舒服～',
    '我就赖在顶上不下来了～',
  ],
  bottom: [
    '趴这儿陪主人～',
    '底下凉快，趴着正好～',
    '我就赖在这边不走了～',
    '趴着看主人干活～',
    '这角落归我啦～',
    '地板趴着也挺舒服的～',
  ],
};

// 趴窗台词扩充（活生生气息）
Object.assign(PERCH_LINES.top, [
  '这高度，整个桌面尽收眼底～',
  '躺平是最高级的放松～',
  '别拽我，我要在这里打盹儿～',
  '屋顶是我家的，主人是借住的～',
]);
Object.assign(PERCH_LINES.bottom, [
  '这位置不错，冬暖夏凉的～',
  '我趴这儿看主人，可别嫌我碍事哦～',
  '地上有小影子，陪它玩会儿～',
  '趴这儿正好够得着主人膝盖～',
]);

/** 前台窗口 → 活动状态分类（进程名/标题小写匹配关键词） */
function classifyActivity(processName, title) {
  const p = String(processName || '').toLowerCase();
  const t = String(title || '').toLowerCase();
  const has = (list) => list.some((k) => p.includes(k) || t.includes(k));
  // QQ 浏览器先于 QQ（聊天）特判，避免被 'qq' 关键词误认成聊天
  if (p.includes('qq浏览器') || p.includes('qqbrowser')) return 'browsing';
  if (has(['code', 'visual studio', 'cursor', 'webstorm', 'intellij', 'pycharm', 'goland', 'eclipse', 'sublime', 'notepad++', 'vscodium', 'trae', 'phpstorm', 'datagrip', 'rider', 'clion', 'android studio', 'xcode', 'vim', 'windows terminal', 'wt.exe', 'cmd.exe', 'powershell', 'xshell', 'putty', 'terminal', 'ubuntu', 'git bash'])) return 'coding';
  // 听歌：必须排在 watching/chatting 之前——QQ音乐、网易云里都含 'qq' / '云'，
  // 不先判就会被误认成聊天（'qq' 命中 chatting）。
  if (has(['cloudmusic', 'neteasemusic', '网易云', 'qqmusic', 'qq音乐', 'kugou', '酷狗', 'kuwo', '酷我', 'spotify', 'foobar2000', 'foobar', 'musicbee', 'aimp', 'winamp', 'apple music', 'itunes', 'migu', '咪咕', 'ximalaya', '喜马拉雅', 'listen1', 'tidal', 'deezer', 'groove', 'applemusic', 'music', '音乐'])) return 'music';
  if (has(['bilibili', '哔哩哔哩', 'iqiyi', '爱奇艺', 'youku', '优酷', 'tencent video', '腾讯视频', 'qq影院', 'youtube', 'netflix', 'potplayer', 'vlc', 'mpv', '迅雷影音', '暴风影音', '芒果tv', 'kodi', '抖音', 'douyin', 'tiktok', '播放', '追剧', '弹幕'])) return 'watching';
  if (has(['wechat', 'weixin', 'wxwork', '微信', 'qq', '钉钉', 'dingtalk', 'lark', '飞书', 'telegram', 'discord', '企业微信', 'wecom', 'slack', 'skype', 'whatsapp'])) return 'chatting';
  if (has(['steam', 'wegame', 'epic', '雷电', '模拟器', 'league of legends', '英雄联盟', 'csgo', 'counter-strike', 'genshin', '原神', 'dota', 'warcraft', 'minecraft', '我的世界', 'valorant', 'overwatch', 'apex', '王者荣耀', '和平精英', '崩坏', '星穹', '明日方舟', 'yuzu', 'ryujinx', 'starcraft', 'gta', 'steamdeck', 'xbox', 'playstation'])) return 'gaming';
  if (has(['wps', 'word', 'excel', 'powerpoint', 'typora', 'xmind', 'onenote', 'obsidian', 'notion', 'pdf', 'adobe acrobat', 'libreoffice'])) return 'work';
  if (has(['chrome', 'edge', 'firefox', 'opera', 'brave', 'safari', '360浏览器', 'qq浏览器', '夸克', 'uc浏览器', 'internet explorer'])) return 'browsing';
  return 'other';
}

// ---------- 单只宠物（行为与浏览器 PetCard 一致；纯逻辑来自 src/shared） ----------
class PetSprite {
  constructor(pet) {
    this.pet = pet; // 这只宠物的配置段（拍平后的成品实例，条目级字段已吹入：动画池/权重/周期）
    // 页面级缩放（main 对窗口 setZoomFactor(CONFIG.scale)，见 DESIGN.md §3.5）统一放大整窗：
    // pet.size 即 CSS 像素基准，**不再手工乘 CONFIG.scale**——固定 px UI（菜单/积分/聊天）
    // 随同一缩放自动恢复 DIP 观感；跨进程交换（bounds/几何/碰撞）由 constants.js 的
    // toScreen/toLocal 收口换算，这里与 shared 组件一样零乘除。
    this.sizeManual = false; // 用户是否手动调过「大小」（手动后切形象不再自动改档）
    this.computeSizeGeom(this.loadSizeScale());
    // 宠物包围盒左上角在【工作区】坐标系里的位置（本窗口的位置 = 宠物的位置）
    this.pos = { x: 0, y: 0 };

    // 播放状态（与浏览器同构）
    // 动画池与权重按宠物取：文件宠物（pet/ 目录定义，extra）自带**完整独立**动画池；
    // main 等常规宠物（无 anims 段）用全局 cfg.animations（与浏览器 pet.ts 同一语义）。
    this.animations = pet.animations || cfg.animations;
    this.weights = pet.animationWeights || cfg.animationWeights;
    // 拖拽抛掷物理参数（顶层全局；拍平已吹入实例，兜底回全局/默认）
    this.physics = pet.physics || config.physics || S.DEFAULT_PHYSICS;
    // 抛掷锁定在当前屏幕（根字段；拍平已吹入实例，兜底回主条目/默认）：
    // true = 甩出去只在松手时所在那块屏内弹（屏缝当墙），false = 照常跨屏飞行
    this.confineToScreen = pet.confineToScreen === true || config.confineToScreen === true;
    // 素材根按 assetRoot（文件宠物 = 配置文件前缀，多实例共享同一素材目录）或宠物 id 回落
    this.assetRoot = pet.assetRoot || pet.id;
    this.assetBase = BASE + '/thumb/' + encodeURIComponent(this.assetRoot) + '/';
    this.front = 0; // 0 = A, 1 = B
    this.pending = null;
    this.gen = 0;
    this.anim = this.animations.idle[0] ?? '';
    this.once = true;
    this.facing = 'left';
    // 交互/移动
    this.dragState = { active: false, dragging: false, sx: 0, sy: 0, petX: 0, petY: 0 };
    this.justDragged = false;
    this._interactive = null; // 已上报的可交互状态（setInteractive 去重用）
    this._inputBusy = null; // 已上报的"正在用输入"状态（syncInputBusy 去重用）
    // 拖拽抛掷物理（与浏览器 pet.ts 同构；纯计算在 shared-core S.*）：
    // 拖拽中弹簧跟随目标（包围盒左上角，工作区 px），松手按指针轨迹估速 → 抛掷（重力+边缘反弹）
    this.dragTrail = []; // 指针轨迹采样（screenX/Y + performance.now()，初速估算用）
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
    this.dragFollow = null; // 弹簧跟随 rAF handle
    this.dragFollowToken = 0;
    this.throwRef = null; // 抛掷 rAF handle
    this.throwToken = 0;
    this.space = null; // 抛掷空间（逐屏 AABB）缓存；显示器变化时由 relayout() 置空重建
    // Q 弹挤压（点击回应 / 抛掷落地）：rAF + 待压标记（等新动画成为前台再压，压新首帧）
    this.squashRef = null;
    this.squashToken = 0;
    this.pendingSquash = false;
    this._interactive = null; // 当前可交互状态（null=未定；只在变化时发 IPC，避免逐帧刷屏）
    this.moveRef = null;
    this.moveToken = 0;
    this.pendingMove = null;
    this.customPos = null; // 拖拽后的会话内位置（{rx, ry} 比例）；restart 回角落
    // ---- 趴窗/贴边巡逻（"半身躲起来，懒懒在边上玩"）----
    // 桌宠吸附到某条边（屏幕边或前台应用窗口边）后，半身藏在边外、沿边慢慢爬：
    // 爬到顶端 → 休息说俏皮话 → 像跳绳一样跳到底 → 再爬上去，循环。
    // 前台窗口边界由主进程探针推送（pet:target-window，屏幕物理像素），渲染端转成视口 CSS 系。
    this.targetRect = null; // 最近一次前台窗口矩形（CSS 视口系；null = 探针不可用/还没拿到）
    this.targetRectKey = ''; // 去重：矩形没明显变化不重吸附（避免前台窗口微动就打断巡逻）
    // ---- 活动状态感知（主人正在干什么：敲代码/看剧/聊天…）----
    // 由前台窗口进程名+标题分类而来；驱动：行为差异（安静不漫游/活泼自由）+ 状态台词池
    this.activity = { name: 'other', timer: null, seen: false };
    // ---- 活生生行为（逻辑全在 shared/life.ts：零 API 零 token 纯本地，浏览器端同一份）----
    // 连击情绪：窗口内连戳会从"俏皮"升到"痒→烦→气→求饶"，过 3.5s 不点就重新起算
    this.clickCombo = null; // 连击状态（shared/life 的 ClickComboState；null = 上一次已过窗）
    this.lastCatchLine = ''; // 上一句点击俏皮话（取句避开它，避免连续重复）
    // 动作元形（复合行为原型）：metaQueue=待播动画序列；metaCooldown=各元形冷却（不连播）
    this.metaQueue = []; // 元形动画队列（playOnce 依次播完，队列空回 idle 随机链）
    this.metaCooldown = {}; // id -> 上次播放时间戳（按 META_ACTIONS 的 cooldown 节流）
    // 姿势变换（新原型动作）：pose 叠加在视频元素的 transform 上（rotate/scale），
    // 用于倒挂金钩 / 缩成一团 等现有素材做不出来的新姿势；空串 = 正常站姿
    this.pose = '';
    this.hopRef = null; // 蹦跳位置驱动 rAF
    this.peekRef = null; // 探头位置驱动 rAF
    this.poseTimer = null; // 倒挂/缩团自动恢复站姿的定时器
    this.costume = null; // 当前换装 id（null=原装；COSTUMES 里的配色 filter）
    this.skin = 'main'; // 当前形象 id（main=小胖鱼原版；ouo-neko=OUO 猫咪等）
    // 记性与作息：最近一次"主人理我"的时刻 / 上一句求关注台词的时间 / 今天问候过没
    this.lastInteractionAt = Date.now(); // 启动即算"刚互动过"：开机 25 分钟内不会喊"主人不理我"
    this.lastAbsenceLineAt = 0; // 上一句求关注/重逢台词的时间戳（此类至少隔 10 分钟才再说）
    this.greetedDay = ''; // 已问过早安的日期（YYYY-MM-DD；一天只问候一次）
    // ---- 自动走向当前窗口（识别到新窗口 → 自然地走过去/爬过去，不瞬移）----
    // 到达后随机挑一条边（躺顶/趴底/左右）吸附趴下开始巡逻；walk 用散步速度 + move 动画
    this.autoDockWindow = true; // 识别到窗口就主动走过去趴窗（默认开）
    this.walkRef = null;
    this.walkToken = 0;
    this.lastWalkEdge = ''; // 避免连续趴在同一条边
    this.userPlaced = false; // 用户用鼠标放置过宠物：放哪儿就待哪儿，不被窗口强制拉回
    this.userPlacedAt = 0; // 放置时间点：90 秒内尊重放置位置，之后恢复"自己找窗口趴"的自然习惯
    this.dock = {
      active: false, // 是否正在趴窗/贴边（吸附后置 true；拖拽/菜单 home 立即退出）
      rect: null, // 巡逻边界（CSS 视口系）：前台窗口矩形，或当前屏工作区（右键「躲到边上去」）
      edge: 'right', // 吸附的边：left/right/top/bottom
      patrolRef: null, // 巡逻 rAF handle
      patrolToken: 0, // 巡逻代际（leaveDock/重进时 ++，旧帧立即失效）
      phase: 'rest', // 当前巡逻阶段：climb=沿边爬 / jump=跳绳式快速跳 / rest=停下趴着休息
      from: null, // 当前一段的起点（视口 CSS）
      to: null, // 当前一段的终点
      restUntil: 0, // rest 阶段结束时间（performance.now）
      edgeFlip: 0, // 换边计数（爬/跳循环到一定次数后换一条边，动作不呆板）
      lastAnim: '', // 巡逻当前播的动画名（爬/跳用 move 动画，休息用 idle，避免重复切换）
    };
    // 右键菜单（统一自绘组件，两端共用同一份：树+渲染均来自 shared-core）
    this.menuOpen = false; // 菜单开启期间强制整窗可交互（悬停菜单不触发穿透翻转）
    this.menuClose = null; // 当前菜单的 close()（打开时挂载，关闭后置空）
    // 余额气泡
    this.bubbleOn = false;
    this.bubbleTimer = null;
    // 悬浮提示（替代原生 title 属性）：显隐 + 最近一次光标位置（**视口坐标**，见 renderTip）
    this.tipOn = false;
    this.tipCursor = null;
    this.balanceView = null;
    this.balanceWrap = false; // true = 当前余额气泡是不可用的「文字说明」（多行，需换行变体）
    this.prevTick = 0;
    // 当前状况气泡（本机 CPU/内存/电量/专注时长；多行，与余额文字说明同款换行变体）
    this.statusOn = false;
    this.statusTimer = null;
    this.statusView = null;
    this.prevStatusLevel = null; // 上一拍的档位：周期采集只在档位变化时才打扰
    this.statusTick = 0;
    // 说话（碎碎念 / 命令气泡 / 对话回复三合一）：文本/配图由容器统一轮询 /state 后经
    // showWhisper 送进来，本精灵不再自己轮询（改造前的 whisperLoopTimer / broadcastLoopTimer 已删）
    this.whisperOn = false;
    this.whisperTimer = null;
    this.whisperView = null;
    this.whisperText = '';
    // 配图名称（配置 memes 的键；whisperImageEnabled 开启时由 host 随机抽定，随文本一起来）
    this.whisperImage = '';
    // 工作状态联动（DSH 会话状态）：容器 1s 轮询 /state 递增 workTick → 本宠物按档位播动画+气泡。
    // 气泡单槽优先级 终态任务 > whisper > balance > 非终态任务（见 renderBubble）；
    // workStatusEnabled 未启用时完全免疫（与浏览器一致）
    this.workOn = false;
    this.workTimer = null;
    this.workText = null;
    this.workState = null; // 最近一次工作状态（互动/事件动画播完恢复档位循环用）
    this.prevWorkState = null; // 上一档状态（气泡只在状态变化时点亮/收起，Bug 2）
    this.prevWorkTick = 0;
    // 对话弹窗（shared 组件）：当前挂载的 close() 句柄 + 开启标记
    // （chatOpen 是穿透守卫：弹窗是窗口内 DOM，期间整窗保持可交互，与 menuOpen 同语义——否则
    //   光标移到输入框（不在身体命中区）就会被 onMouseMove 翻回穿透，点击全被透传）
    this.chatClose = null;
    this.chatOpen = false;

    // DOM：sprite 钉在窗口内 (margin.l, margin.t)；宠物"位置"= sprite 位置，窗口随余量外扩
    this.el = document.createElement('div');
    this.el.className = 'pet-sprite';
    this.el.style.left = this.margin.l + 'px';
    this.el.style.top = this.margin.t + 'px';
    this.el.style.setProperty('--pet-size', this.size + 'px');
    const stage = document.createElement('div');
    stage.className = 'pet-stage';
    stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.stage = stage;
    this.videoA = document.createElement('video');
    this.videoA.className = 'pet-video is-front';
    this.videoB = document.createElement('video');
    this.videoB.className = 'pet-video';
    for (const v of [this.videoA, this.videoB]) {
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
    }
    this.hit = document.createElement('div');
    this.hit.className = 'pet-hit';
    this.hit.style.left = (S.HIT_BOX.x0 / 640) * 100 + '%';
    this.hit.style.top = (S.HIT_BOX.y0 / 360) * 100 + '%';
    this.hit.style.width = ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * 100 + '%';
    this.hit.style.height = ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * 100 + '%';
    // 原先这里挂 title（原生系统提示）：已换成自绘浮层，但无障碍名称不能跟着丢
    this.hit.setAttribute('aria-label', this.pet.name);
    this.bubble = document.createElement('div');
    this.bubble.className = 'pet-bubble';
    // 悬浮提示：与气泡同处 this.el 内的绝对定位浮层，位置/翻转由 renderTip 决定，
    // 样式走 shared 的 TOOLTIP_CSS（renderer.js 注入，与浏览器端同一份）
    this.tip = document.createElement('div');
    this.tip.className = S.TOOLTIP_CLASS;
    this.tip.setAttribute('aria-hidden', 'true');

    stage.appendChild(this.videoA);
    stage.appendChild(this.videoB);
    stage.appendChild(this.hit);
    this.el.appendChild(this.bubble);
    this.el.appendChild(this.tip);
    this.el.appendChild(stage);
    rootEl.appendChild(this.el);
    this.position();

    // 事件（与浏览器同一套：pointerdown/move、click、window pointerup/cancel）
    const ac = new AbortController();
    this.ac = ac;
    // 级联菜单新增面板、聊天输入增长都可能在鼠标停住时发生，不能只等下一次 mousemove。
    this.inputRegionResize = new ResizeObserver(() => this.syncInputRegions());
    this.inputRegionElements = new Set();
    this.inputRegionMutation = new MutationObserver(() => this.syncInputRegions());
    this.inputRegionMutation.observe(document.body, { childList: true, subtree: true });
    this.hit.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal: ac.signal });
    this.hit.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal: ac.signal });
    this.hit.addEventListener('click', () => this.onClick(), { signal: ac.signal });
    this.hit.addEventListener('contextmenu', (e) => this.onContextMenu(e), { signal: ac.signal });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal: ac.signal });
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal: ac.signal });
    this.hit.addEventListener('lostpointercapture', (e) => this.onPointerUp(e), { signal: ac.signal });
    // 点击穿透：窗口默认整窗穿透（main 设 setIgnoreMouseEvents(true, {forward:true})），
    // 光标进/出身体命中区时翻转可交互；穿透期间 mousemove 由 main 转发进来（forward:true），
    // mouseleave 保证光标离开窗口立即恢复穿透（透明像素不挡下层应用，与浏览器一致）。
    window.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal: ac.signal });
    window.addEventListener(
      'blur',
      () => {
        // 切到其它应用后旧菜单不应继续占着整个透明窗口；丢失松手时也释放拖拽。
        this.closeMenu();
        if (this.dragState.active) this.onPointerUp();
        if (!this.chatOpen) this.setInteractive(false);
      },
      { signal: ac.signal },
    );
    window.addEventListener(
      'mouseleave',
      () => {
        // 光标离开窗口：菜单若开着立刻收起（菜单是窗口内 DOM，离开即不可达），再恢复穿透。
        // 拖拽中与对话弹窗开着都不恢复：前者会绕过 busy 造成穿透并丢失 pointerup，
        // 后者要留光标回来点输入框。
        this.closeMenu();
        if (!this.chatOpen && !this.dragState.active) this.setInteractive(false);
      },
      { signal: ac.signal },
    );

    // 宠物间碰撞（跨窗 broker）：订阅其它宠物状态广播（碰撞检测用）+ 「被撞」事件 → onDeskHit。
    // 注意：退订由窗口销毁自然回收（webContents 销毁后 ipc 事件不再派发），无需显式取消。
    this.others = {}; // petId -> {x,y,vx,vy,size,bottomPad}（其它宠物的最新状态，来自主进程广播）
    this.throwState = null; // 飞行中的实时状态（被撞查询 / 其它窗碰撞检测时上报用）
    this.pressScoreFired = false; // 按下瞬间已触发过积分（pointerdown 即触发；click 据此不重复弹，同浏览器）
    this.lastFlightReport = 0;
    if (window.petBridge && window.petBridge.onFlightStates) {
      window.petBridge.onFlightStates((states) => {
        if (!states || typeof states !== 'object') return;
        const next = {};
        for (const pid of Object.keys(states)) {
          if (pid === this.pet.id) continue; // 排除自己
          const s = states[pid];
          next[pid] = {
            // 碰撞 broker 协议单位是物理像素（与窗口 bounds 一致）：÷scale 进本窗口 CSS 系（§3.5）
            x: toLocal(Number(s && s.x) || 0),
            y: toLocal(Number(s && s.y) || 0),
            vx: toLocal(Number(s && s.vx) || 0),
            vy: toLocal(Number(s && s.vy) || 0),
            size: toLocal(Number(s && s.size) || 0),
            bottomPad: toLocal(Number(s && s.bottomPad) || 0),
          };
        }
        this.others = next;
      });
      window.petBridge.onPetHit((payload) => {
        const vx = Number(payload && payload.vx);
        const vy = Number(payload && payload.vy);
        if (Number.isFinite(vx) && Number.isFinite(vy)) this.onDeskHit(toLocal(vx), toLocal(vy));
      });
    }
    // 系统锁屏/解锁（主进程 powerMonitor 推送）：主人锁屏离开 → "帮你看家"；解锁回来 →
    // "主人回来啦"，并把互动时间续期到解锁那一刻（否则一解锁就按"很久没理它"喊想你了）。
    // 锁屏时窗口本就不可见，这句话主要是给解锁那一刻一个自然的迎接。
    if (window.petBridge && window.petBridge.onPowerState) {
      window.petBridge.onPowerState((state) => this.onPowerState(state));
    }
    // 前台窗口边界（"当前的界面边框"+ 主人正在干什么）：主进程探针推来的前台应用窗口
    // 信息（屏幕物理像素 + 进程名 + 标题）。转成视口 CSS 系（-VIEW 原点 ÷scale，与 sendBounds
    // 相反方向）存起来，供吸附/巡逻使用；并按进程名/标题分类出活动状态驱动行为与台词。
    if (window.petBridge && window.petBridge.onTargetWindow) {
      window.petBridge.onTargetWindow((rect) => {
        if (!rect || typeof rect !== 'object') return;
        const x = Number(rect.x);
        const y = Number(rect.y);
        const w = Number(rect.width);
        const h = Number(rect.height);
        if (![x, y, w, h].every(Number.isFinite) || w < 40 || h < 40) return;
        const css = {
          x: toLocal(x) - VIEW.x,
          y: toLocal(y) - VIEW.y,
          width: toLocal(w),
          height: toLocal(h),
        };
        // 活动状态：进程名/标题分类（变化才处理，避免每 800ms 刷屏）
        const actName = classifyActivity(rect.process, rect.title);
        if (actName !== this.activity.name) this.setActivity(actName);
        const key = actName + '|' + Math.round(css.x / 20) + ',' + Math.round(css.y / 20) + ',' + Math.round(css.width / 40) + ',' + Math.round(css.height / 40);
        if (key === this.targetRectKey) return;
        // 前台窗口换了/动了 = 主人在操作电脑（探针每 800ms 推一次，人走了窗口就不再变）——
        // 这是"主人还在"最稳的本地信号，求关注/久别重逢判定用它续期。
        this.lastInteractionAt = Date.now();
        this.targetRectKey = key;
        this.targetRect = css;
        if (this.dock.active && this.dock.rect && this.dock.rect.winDock === true) {
          // 正在趴窗且贴的是前台窗口 → 窗口动了就重新吸附到新位置（半身藏的效果跟着窗口走）
          this.enterDock(this.dock.edge, css);
        } else if (this.autoDockWindow) {
          // 空闲（没在趴窗）：识别到新窗口 → 自然地走过去/爬过去趴着，不瞬移
          this.walkToWindow();
        }
      });
    }
    // 生活化台词定时器（活动台词/早安/深夜/求关注）：**构造时即启动**——不能等第一次
    // setActivity，活动名一直是 'other' 时它永远不会被调用（见 startLifeLines 注释）。
    this.startLifeLines();
  }

  dispose() {
    this.ac.abort();
    this.inputRegionMutation.disconnect();
    this.inputRegionResize.disconnect();
    this.inputRegionElements.clear();
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    if (this.whisperTimer !== null) window.clearTimeout(this.whisperTimer);
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    if (this.activity.timer !== null) window.clearTimeout(this.activity.timer);
    this.stopWalk();
    if (this.chatClose) {
      this.chatClose();
      this.chatClose = null;
    }
    this.closeMenu();
    this.stopThrow();
    this.stopDragFollow();
    this.stopSquash();
    this.stopMove();
    this.leaveDock();
    this.el.remove();
  }

  // 目标包围盒左上角（视口相对坐标）→ 移动窗口：窗口 = sprite + 四周外扩余量
  // （sprite 钉在窗口 (margin.l, margin.t)，气泡/弹窗显示在余量里）。
  // setContentBounds 要**屏幕**坐标：pos 是视口（桌面外接矩形）相对坐标，先加 VIEW.x/y
  // 再统一 ×scale 回物理像素（§3.5 IPC 收口）——主进程收到的数字与线性化旧行为逐位一致，
  // 主进程侧（bounds/去重/碰撞 broker）完全不用改。
  sendBounds(px, py) {
    this.pos = { x: Math.round(px), y: Math.round(py) };
    window.__dshPetDebug.dragPos = { x: this.pos.x, y: this.pos.y };
    if (window.petBridge) {
      // 完整状态一次捎带：size/bottomPad 让静止宠物从首帧起就登记进碰撞站场
      // （此前只有 report-flight 带尺寸，从没飞过的宠物 size=0 被碰撞检测直接跳过）；
      // vx/vy 带当前速度——飞行中实时值、静止/拖拽 = 0，避免落地后残留上次飞行速度干扰碰撞动量。
      const fly = this.throwState;
      window.petBridge.setBounds(
        toScreen(this.pos.x - this.margin.l + VIEW.x),
        toScreen(this.pos.y - this.margin.t + VIEW.y),
        toScreen(this.size + this.margin.l + this.margin.r),
        toScreen(this.winH + this.margin.t + this.margin.b),
        toScreen(this.pos.x), // 包围盒左上角（碰撞站场用：窗口坐标 ≠ 包围盒坐标）
        toScreen(this.pos.y),
        toScreen(this.size),
        toScreen(this.bottomPad),
        fly ? toScreen(fly.vx) : 0,
        fly ? toScreen(fly.vy) : 0,
      );
    }
    // 位置变了（宠物漫游/拖拽/飞行，窗口跟着动）：提示若正显示必须重摆一次——它跟的是光标，
    // 而光标存的是视口坐标，窗口一移，光标相对窗口的位置就变了，不重摆提示会跟着窗口漂走。
    // 只在显示时重摆：漫游逐帧调本函数，没显示提示时不做无谓的 DOM 写入。
    if (this.tipOn) this.renderTip();
  }

  // 角落/边距 → 窗口位置；拖拽后按会话内位置（比例）还原——**松手无任何边界夹取**，
  // 宠物停在哪就算哪（与浏览器一致：可以完全拖出工作区/屏幕；漫游仍有 planMove 边界检查兜底）
  position() {
    const W = VIEW.w;
    const H = VIEW.h;
    let x;
    let y;
    if (this.customPos) {
      x = this.customPos.rx * W - this.halfW;
      y = this.customPos.ry * H - this.halfH;
    } else {
      // 角落取**主屏**而不是外接矩形：不规则多屏布局下外接矩形的角落可能不属于任何显示器
      // （实测右倒 T 型双屏，top-left 落在主屏上方的空洞里），配了该角落的宠物开机即隐身。
      const anchor = S.anchorPixel({
        corner: this.pet.position.corner,
        // marginX/marginY 是配置里的绝对像素：页面级缩放（§3.5）已统一放大整窗，
        // 配置值不再手工乘 CONFIG.scale——150% 屏上与「线性化 + 旧 CONFIG.scale 补偿」观感一致
        marginX: this.pet.position.marginX,
        // macOS 顶部边距对齐身体命中盒，扣掉动画画布头顶留白。
        marginY:
          this.pet.position.marginY -
          (this.pet.position.corner.startsWith('top-') ? this.size * CONFIG.topInsetRatio : 0),
        size: this.size,
        W,
        H,
        area: PRIMARY_AREA || undefined,
      });
      x = anchor.x;
      y = anchor.y;
    }
    this.sendBounds(x, y);
  }

  /** 抛掷空间（逐屏 AABB）。AREAS/PANELS 变化时由 relayout() 置空重建——飞行中每帧重算太浪费 */
  throwSpaceOf() {
    if (!this.space || this.space.areas !== AREAS || this.space.panels !== PANELS) {
      this.space = S.throwSpace({ areas: AREAS, panels: PANELS, size: this.size, sideAllow: this.sideAllow });
      for (const b of this.space.bounds) b.minY -= this.size * CONFIG.topInsetRatio;
    }
    return this.space;
  }

  /**
   * 显示器几何变化（改分辨率/缩放、插拔屏、旋转）后就地重挂：
   * 抛掷空间作废，并把宠物从可能变成空洞的位置拉回可见区。
   * 拖拽中不动它（用户正握着，位置由指针决定）；飞行中也不动（下一帧物理自会按新边界夹取）。
   */
  relayout() {
    this.space = null;
    if (this.dragState.active || this.throwRef !== null) return;
    this.stopMove();
    const cx = this.pos.x + this.halfW;
    const cy = this.pos.y + this.halfH;
    const p = S.clampPointToRegion(AREAS, cx, cy);
    if (p.x !== cx || p.y !== cy) {
      this.customPos = { rx: p.x / VIEW.w, ry: p.y / VIEW.h };
    }
    this.position();
  }

  currentCenterX() {
    if (this.customPos) return this.customPos.rx * VIEW.w;
    return this.pos.x + this.halfW;
  }
  currentCenterY() {
    if (this.customPos) return this.customPos.ry * VIEW.h;
    return this.pos.y + this.halfH;
  }

  // 双缓冲切换（与浏览器同一套：前台 opacity 切换 + 降级视频清 handler 并停播，防残留 ended 雪崩）
  switchTo(next, nextOnce) {
    if (!next) return;
    const pending = this.pending;
    if (pending && pending.anim === next && pending.once === nextOnce) {
      // 防重命中（单动画点击时目标=当前动画，不重播）：仍消费 Q 弹标记，压当前前台视频，
      // 保证「点击唯一动画」时挤压反馈不丢（与浏览器同构）。
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(this.front === 0 ? this.videoA : this.videoB);
      }
      return;
    }
    const gen = ++this.gen;
    this.pending = { anim: next, once: nextOnce, gen };
    const target = this.front === 0 ? this.videoB : this.videoA;
    const el = target;
    if (!el) return;
    el.src = this.assetUrl(next);
    el.loop = !nextOnce;
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
    el.onended = nextOnce ? () => this.handleEnded() : null;
    // 加载兜底（与浏览器 web 端 fetch+blob 的 10s 超时同义）：素材加载失败或卡住时必须释放
    // pending，否则它永久挂起——之后相同目标会被防重分支吞掉、不同目标靠 gen 覆盖，
    // 表现就是"点了没反应"（#62 报告的就是 web 端同一类问题，桌面端此前完全没有兜底）。
    const loadGuard = (why) => {
      if (!this.pending || this.pending.gen !== gen) return;
      this.pending = null;
      console.warn('[dsh-pet] 素材加载失败 pet=' + this.pet.id + ' anim=' + next + '：' + why + '（已释放本次切换）');
    };
    const loadTimer = window.setTimeout(() => loadGuard('10s 超时'), 10000);
    el.onerror = () => {
      window.clearTimeout(loadTimer);
      loadGuard('video error');
    };
    el.load();
    const onReady = () => {
      el.removeEventListener('loadeddata', onReady);
      window.clearTimeout(loadTimer);
      el.onerror = null;
      if (this.pending && this.pending.gen !== gen) return;
      const old = this.front === 0 ? this.videoA : this.videoB;
      el.classList.add('is-front');
      if (old && old !== el) {
        old.classList.remove('is-front');
        old.onended = null;
        old.pause();
      }
      this.front = this.front === 0 ? 1 : 0;
      this.pending = null;
      // 朝向翻转 + 姿势变换（倒挂 rotate / 缩团 scale）叠加；姿势为空只留朝向翻转
      el.style.transform =
        (this.facing === 'right' ? 'scaleX(-1)' : '') + (this.pose ? ' ' + this.pose : '');
      el.play().catch(() => {});
      // 点击 Q 弹：等新动画就位后才压（压的是新点击动画的首帧，与浏览器一致）
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(el);
      }
      if (this.pendingMove) this.startMoveDrive(el);
    };
    el.addEventListener('loadeddata', onReady);
    if (el.readyState >= 2) onReady();
  }

  playOnce(name) {
    this.anim = name;
    this.once = true;
    this.switchTo(name, true);
  }

  // ---- 动作元形（复合行为原型）：待机链偶发触发，一段播完自动接下一段 ----
  // 让宠物像活物一样有自己的"小剧场"：打盹=伸懒腰→哈欠→趴睡；求夸夸=跳舞→敲桌…（零 token）

  /** 随机挑一个冷却已过的元形并开演；无可用 → false（调用方走原逻辑） */
  tryRandomMeta() {
    const now = Date.now();
    const ready = META_ACTIONS.filter(
      (m) => !this.metaCooldown[m.id] || now - this.metaCooldown[m.id] >= m.cooldown,
    );
    if (ready.length === 0) return false;
    return this.playMetaAction(ready[Math.floor(Math.random() * ready.length)].id);
  }

  /** 开演指定元形：入队动画序列 + 弹开场台词 + 播第一段。已在元形中 → false；
   *  ignoreCooldown=true 用于右键菜单点播（用户主动要看，跳过冷却） */
  playMetaAction(id, ignoreCooldown) {
    const meta = META_ACTIONS.find((m) => m.id === id);
    if (!meta || !meta.anims || meta.anims.length === 0) return false;
    if (this.metaQueue.length > 0) return false; // 上一场还没演完
    const now = Date.now();
    if (!ignoreCooldown && this.metaCooldown[id] && now - this.metaCooldown[id] < meta.cooldown)
      return false;
    this.metaCooldown[id] = now;
    this.metaQueue = meta.anims.slice();
    console.log(
      '[dsh-pet] ' +
        new Date().toTimeString().slice(0, 8) +
        ' pet=' +
        this.pet.id +
        ' 元形[' +
        meta.id +
        '] ' +
        meta.anims.join('→'),
    );
    if (meta.line && Math.random() < 0.75) this.showWhisperLocal(meta.line); // 台词气泡（不打断动画）
    return this.advanceMetaQueue();
  }

  /** 播队列下一段；队列空 → false（调用方回 idle 随机链） */
  advanceMetaQueue() {
    if (this.metaQueue.length === 0) return false;
    const next = this.metaQueue.shift();
    this.playOnce(next);
    return true;
  }

  /** 本地台词气泡：只弹气泡不换动画（元形开场白用；showWhisper 挂载在 events.js） */
  showWhisperLocal(text) {
    if (typeof this.showWhisper === 'function') this.showWhisper(String(text), '', true);
  }

  // ---- 新原型动作（姿势变换型：现有素材做不出的形态，靠 rotate/scale + 位置联动）----

  /** 把当前姿势变换同步到正在显示的视频元素（倒挂/缩团时朝向翻转也要叠加） */
  applyPose() {
    const el = this.front === 0 ? this.videoA : this.videoB;
    if (!el) return;
    el.style.transform = (this.facing === 'right' ? 'scaleX(-1)' : '') + (this.pose ? ' ' + this.pose : '');
  }

  /** 清除姿势变换，恢复正常站姿 */
  clearPose() {
    if (!this.pose) return;
    this.pose = '';
    this.applyPose();
  }

  /** 倒挂金钩：旋转 180° 挂住（loop 趴睡 = 挂在顶边睡觉）。hang 时长由 poseTimer 控制 */
  hangStart() {
    this.pose = 'rotate(180deg)';
    this.applyPose();
    this.switchTo('原地小憩沉眠', false);
  }

  /** 缩成一团：整体缩小趴着睡（loop 趴睡） */
  ballStart() {
    this.pose = 'scale(0.82)';
    this.applyPose();
    this.switchTo('原地小憩沉眠', false);
  }

  /** 蹦蹦跳跳：播放跳跃动画的同时，窗口同步上下跳动（真蹦跳，不是站桩放动画） */
  hopAround() {
    if (this.hopRef !== null) return;
    this.playOnce('原地跳跃抓碎头顶物品');
    const baseX = this.currentCenterX();
    const baseY = this.currentCenterY();
    const amp = this.size * 0.5; // 跳起高度（与动画的跳跃节奏匹配）
    const hops = 5; // 连跳 5 下
    let i = 0;
    const start = performance.now();
    const drive = (now) => {
      const t = (now - start) / 1000;
      const seg = Math.floor(t / 0.45); // 每 0.45s 一跳（与动画节奏接近）
      if (seg > i) {
        i = seg;
        this.dockPlace(baseX, baseY - amp); // 跳到顶点
        const token = this.hopRef;
        setTimeout(() => {
          if (this.hopRef === token) this.dockPlace(baseX, baseY); // 落回
        }, 220);
      }
      if (i < hops) {
        this.hopRef = requestAnimationFrame(drive);
      } else {
        this.hopRef = null;
        this.dockPlace(baseX, baseY);
      }
    };
    this.hopRef = requestAnimationFrame(drive);
  }

  /** 探头探脑：贴边时位置沿边小幅探出/缩回 2 次（配东张西望，做出"偷看"效果） */
  peekOut() {
    if (this.peekRef !== null) return;
    this.playOnce('东张西望');
    const baseX = this.currentCenterX();
    const baseY = this.currentCenterY();
    const amp = this.size * 0.28;
    const start = performance.now();
    const drive = (now) => {
      const t = (now - start) / 1000;
      const phase = Math.floor(t / 0.7); // 每 0.7s 一次探出/缩回
      if (phase >= 4) {
        this.peekRef = null;
        this.dockPlace(baseX, baseY);
        return;
      }
      const out = phase % 2 === 0; // 偶=探出，奇=缩回
      this.dockPlace(out ? baseX + amp : baseX, out ? baseY - amp * 0.4 : baseY);
      this.peekRef = requestAnimationFrame(drive);
    };
    this.peekRef = requestAnimationFrame(drive);
  }

  /** 换装：把 COSTUMES 里的配色 filter 应用到两个视频元素（切换动画时也保持，实时生效可来回改） */
  setCostume(id) {
    const c = COSTUMES.find((x) => x.id === id) || COSTUMES[0];
    this.costume = c.id === '原装' ? null : c.id;
    const f = c.filter;
    for (const v of [this.videoA, this.videoB]) if (v) v.style.filter = f;
  }

  /** 动画素材 URL：形象切换后，映射表内的动画走该形象的专属目录（host 命中），
   *  映射表外的动画按 SKIN_FALLBACK 语义映射到该形象自有的某个基础动作——绝不回退小胖鱼原版 */
  assetUrl(name) {
    const root = this.skin;
    if (root !== 'main') {
      const tracks = SKIN_TRACKS[root] || SKIN_TRACKS_DEFAULT;
      if (tracks && tracks.has(name)) {
        return BASE + '/thumb/' + encodeURIComponent(root) + '/' + encodeURIComponent(name) + '.webm';
      }
      // 未覆盖的动画（点击回应/拖拽/转向/分类/事件等）：映射到本形象自有基础动作，保持形象一致
      const mapped = (SKIN_FALLBACK && SKIN_FALLBACK[name]) || '待机呼吸休闲';
      return BASE + '/thumb/' + encodeURIComponent(root) + '/' + encodeURIComponent(mapped) + '.webm';
    }
    return this.assetBase + encodeURIComponent(name) + (S.ANIMATION_EXT || '.webm');
  }

  /** 切换形象（真实素材）：换素材根 + 当前动画按新形象重播（映射内=新形象动画，否则回退原版） */
  /** 读出上次保存的大小档（localStorage，重启后仍生效）；读不到/非法值按 1.0 */
  loadSizeScale() {
    try {
      const v = parseFloat(localStorage.getItem(SIZE_STORE_KEY));
      if (v && v >= 0.3 && v <= 2) return v;
    } catch {}
    return 1;
  }

  /** 尺寸派生量（纯几何，构造期与运行时改大小共用；不碰 DOM、不做定位） */
  computeSizeGeom(scale) {
    this.sizeScale = scale;
    const base = this.pet.size || 462;
    this.size = base * scale;
    this.height = (this.size * 9) / 16;
    this.halfW = this.size / 2;
    this.halfH = this.height / 2;
    this.bottomPad = (this.size * (9 / 16) * (S.CANVAS_H - S.FEET_Y)) / S.CANVAS_H;
    // 窗口高 = 舞台高 + 脚底垫高（stage 被 translateY(bottomPad) 下移的余量，防底部被窗口裁剪）
    this.winH = this.height + this.bottomPad;
    // 窗口内【可交互区域】= 身体命中区（像素，窗口坐标）。浏览器 overlay 只有 .dsh-pet-hit 是
    // pointer-events:auto（root/stage/气泡全 none）——桌面严格对齐：命中区外含透明像素一律穿透到下层应用。
    // HIT_BOX 是 640×360 舞台坐标：x 按窗口宽缩放；y 除舞台高外还要加 bottomPad（舞台被下移）。
    this.hitRect = {
      x: (S.HIT_BOX.x0 / 640) * this.size,
      y: this.bottomPad + (S.HIT_BOX.y0 / 360) * this.height,
      w: ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * this.size,
      h: ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * this.height,
    };
    // 左右透明边余量（视频盒内宠物身体居中）：让边界按"身体"贴边——宠物能走到屏幕边缘，
    // 但身体永不越界（漫游/拖拽都不会弄丢宠物）。与浏览器 overlay 的 sideAllow 同一套语义。
    this.sideAllow = (S.HIT_BOX.x0 / 640) * this.size;
    // 窗口四周外扩（= WINDOW_MARGIN_RATIO×宠物尺寸）：sprite 钉在 (margin.l, margin.t)，
    // 窗口 = sprite + 四边余量——气泡/未来弹窗显示在余量里；余量透明且点击穿透
    const m = this.size * WINDOW_MARGIN_RATIO;
    this.margin = { t: m, r: m, b: m, l: m };
    if (window.__dshPetDebug) {
      window.__dshPetDebug.hitRect = this.hitRect;
      window.__dshPetDebug.sideAllow = this.sideAllow;
      window.__dshPetDebug.winMargin = this.margin;
    }
  }

  /** 运行时改大小：重算几何 + 刷新 DOM/窗口/命中区（右键菜单「大小」走这里） */
  applySize(scale) {
    this.computeSizeGeom(scale);
    // 抛掷空间按尺寸算，尺寸一变必须作废重建，否则会按旧尺寸夹取边界
    this.space = null;
    if (this.el) {
      this.el.style.setProperty('--pet-size', this.size + 'px');
      this.el.style.left = this.margin.l + 'px';
      this.el.style.top = this.margin.t + 'px';
    }
    if (this.stage) this.stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.position();
    if (typeof this.syncInputRegions === 'function') this.syncInputRegions();
    try {
      localStorage.setItem(SIZE_STORE_KEY, String(scale));
    } catch {}
  }

  setSkin(id) {
    if (!SKINS.some((s) => s.id === id)) return;
    if (this.skin === id) return;
    this.skin = id;
    // 形象素材是紧贴裁切的精灵表，同宽下角色本体比小胖鱼大得多 →
    // 用户没手动调过大小时，切到形象自动降档、切回小胖鱼恢复 100%。
    if (!this.sizeManual) {
      const want = id === 'main' ? 1 : SKIN_DEFAULT_SCALE;
      if (Math.abs(want - this.sizeScale) > 0.001) this.applySize(want);
    }
    const name = this.anim || '待机呼吸休闲';
    this.once = true;
    this.switchTo(name, true);
  }

  /** 播放一个"原型动作"（菜单/自动触发入口）：返回 true = 已开演 */
  playPoseAction(id) {
    if (id === '倒挂金钩') {
      this.hangStart();
      // 挂睡一段时间后自动恢复站姿（与事件动画一致：播完回 idle）
      if (this.poseTimer !== null) window.clearTimeout(this.poseTimer);
      this.poseTimer = window.setTimeout(() => {
        this.clearPose();
        this.playIdle();
      }, 8000 + Math.random() * 6000);
      return true;
    }
    if (id === '缩成一团') {
      this.ballStart();
      if (this.poseTimer !== null) window.clearTimeout(this.poseTimer);
      this.poseTimer = window.setTimeout(() => {
        this.clearPose();
        this.playIdle();
      }, 8000 + Math.random() * 6000);
      return true;
    }
    if (id === '蹦蹦跳跳') {
      this.hopAround();
      return true;
    }
    if (id === '探头探脑') {
      this.peekOut();
      return true;
    }
    return false;
  }

  /** 原型动作是否正在播（避免连发/重复进入） */
  poseBusy() {
    return this.hopRef !== null || this.peekRef !== null || this.pose !== '';
  }

  // ---- 新作动画（FX 特效层）：canvas 实时绘制的全新动态效果，素材库 106 个里没有这些 ----
  // 爱心泡泡 / 音符舞 / 星光环绕 / 彩虹尾巴 / 花朵绽放 / 水波涟漪。
  // 与视频动画互相独立：特效播完自动消失，不打断/不替换当前动画。

  ensureFx() {
    if (this.fxCanvas) return this.fxCanvas;
    const c = document.createElement('canvas');
    c.className = 'pet-fx';
    c.width = Math.max(2, Math.round(this.size * 1.5));
    c.height = Math.max(2, Math.round(this.size * 1.5));
    c.style.cssText =
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
      'pointer-events:none;z-index:2;'; // z-index 低于气泡(3)：粒子在气泡下方，不挡台词文字
    this.stage.appendChild(c);
    this.fxCanvas = c;
    this.fxCtx = c.getContext('2d');
    this.fxParticles = [];
    this.fxRainbow = null;
    this.fxRainbowStart = 0;
    this.fxRef = null;
    return c;
  }

  /** 播一个"新作动画"特效（type: heart/note/sparkle/rainbow/flower/ripple） */
  fxRun(type) {
    const c = this.ensureFx();
    if (this.fxRef !== null) {
      cancelAnimationFrame(this.fxRef);
      this.fxRef = null;
    }
    const W = c.width;
    const H = c.height;
    const cx = W / 2;
    const cy = H * 0.46; // 身体中心（画布偏高一点，特效围绕身体）
    const parts = (this.fxParticles = []);
    const rnd = (a, b) => a + Math.random() * (b - a);
    if (type === 'heart') {
      for (let i = 0; i < 26; i++)
        parts.push({ kind: 'heart', x: cx + rnd(-45, 45), y: cy + rnd(-15, 40), vx: rnd(-30, 30), vy: rnd(-95, -55), g: 0.22, life: rnd(1.2, 2.3), t: 0, s: rnd(0.6, 1.3), hue: rnd(-18, 18) });
    } else if (type === 'note') {
      for (let i = 0; i < 24; i++)
        parts.push({ kind: 'note', x: cx + rnd(-18, 18), y: cy - 35, vx: rnd(-65, 65), vy: rnd(-170, -90), g: 0.4, life: rnd(1.2, 2.1), t: 0, s: rnd(0.8, 1.4), hue: rnd(-40, 40) });
    } else if (type === 'sparkle') {
      for (let i = 0; i < 14; i++)
        parts.push({ kind: 'star', x: cx, y: cy - 12, orbit: rnd(30, 72), ang: rnd(0, 6.28), spd: rnd(1.1, 2.2), s: rnd(0.5, 1.1), life: 3, t: 0 });
    } else if (type === 'flower') {
      for (let i = 0; i < 12; i++)
        parts.push({ kind: 'flower', x: cx + rnd(-55, 55), y: cy + H * 0.22, vx: rnd(-14, 14), vy: rnd(-48, -26), g: 0.16, life: rnd(1.4, 2.4), t: 0, s: rnd(0.7, 1.25), rot: rnd(0, 6.28) });
    } else if (type === 'ripple') {
      parts.push({ kind: 'ripple', x: cx, y: cy + H * 0.24, life: 2.4, t: 0 });
    } else if (type === 'rainbow') {
      this.fxRainbow = this.facing === 'right' ? 1 : -1; // 彩虹尾巴甩向身后
      this.fxRainbowStart = performance.now();
    } else {
      return false;
    }
    this.fxUntil = performance.now() + 3200;
    this.fxLoop();
    return true;
  }

  fxLoop() {
    const step = (now) => {
      const c = this.fxCanvas;
      if (!c) return;
      const ctx = this.fxCtx;
      const W = c.width;
      const H = c.height;
      ctx.clearRect(0, 0, W, H);
      const parts = this.fxParticles || [];
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += 0.016;
        if (p.life && p.t >= p.life) {
          parts.splice(i, 1);
          continue;
        }
        if (p.kind === 'heart') {
          p.x += p.vx * 0.016;
          p.y += p.vy * 0.016;
          p.vy += p.g;
          this.fxDrawHeart(ctx, p);
        } else if (p.kind === 'note') {
          p.x += p.vx * 0.016;
          p.y += p.vy * 0.016;
          p.vy += p.g;
          this.fxDrawNote(ctx, p);
        } else if (p.kind === 'star') {
          p.ang += p.spd * 0.016;
          this.fxDrawStar(ctx, p.x + Math.cos(p.ang) * p.orbit, p.y + Math.sin(p.ang) * p.orbit * 0.55, p.s, p.t * 3);
        } else if (p.kind === 'flower') {
          p.x += p.vx * 0.016;
          p.y += p.vy * 0.016;
          p.vy += p.g;
          this.fxDrawFlower(ctx, p);
        } else if (p.kind === 'ripple') {
          const r = 8 + p.t * 95;
          const a = Math.max(0, 0.55 * (1 - p.t / p.life));
          ctx.strokeStyle = 'rgba(120,205,255,' + a + ')';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r, r * 0.38, 0, 0, 6.29);
          ctx.stroke();
        }
      }
      if (this.fxRainbow) {
        const t = (now - this.fxRainbowStart) / 1000;
        if (t < 2.6) {
          const a = Math.max(0, 1 - t / 2.6);
          const colors = ['rgba(255,120,120,', 'rgba(255,200,90,', 'rgba(140,220,140,', 'rgba(120,190,255,'];
          for (let i = 0; i < colors.length; i++) {
            const rr = 34 + i * 8;
            ctx.strokeStyle = colors[i] + a + ')';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(W / 2, H * 0.92, rr, Math.PI * 1.05, Math.PI * 1.95, this.fxRainbow < 0);
            ctx.stroke();
          }
        } else {
          this.fxRainbow = null;
        }
      }
      const done =
        parts.length === 0 && !this.fxRainbow && performance.now() > this.fxUntil;
      if (done) {
        ctx.clearRect(0, 0, W, H);
        this.fxRef = null;
        return;
      }
      this.fxRef = requestAnimationFrame(step);
    };
    this.fxRef = requestAnimationFrame(step);
  }

  fxDrawHeart(ctx, p) {
    const s = p.s * 14;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(s / 14, s / 14);
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.bezierCurveTo(-7, -2, -5, -9, 0, -5);
    ctx.bezierCurveTo(5, -9, 7, -2, 0, 4);
    ctx.fillStyle = 'hsla(' + (345 + p.hue) + ',85%,66%,0.85)';
    ctx.fill();
    ctx.restore();
  }

  fxDrawNote(ctx, p) {
    const s = p.s * 13;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin(p.t * 4) * 0.3);
    ctx.scale(s / 13, s / 13);
    ctx.fillStyle = 'hsla(' + (45 + p.hue) + ',95%,60%,0.92)';
    ctx.beginPath();
    ctx.arc(-3, 0, 3, 0, 6.29);
    ctx.fill();
    ctx.fillRect(-1, -1, 2, 11);
    ctx.beginPath();
    ctx.moveTo(1, 9);
    ctx.quadraticCurveTo(8, 8, 7, 3);
    ctx.lineTo(6, 7);
    ctx.quadraticCurveTo(2, 9, 1, 6);
    ctx.fill();
    ctx.restore();
  }

  fxDrawStar(ctx, x, y, s, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(255,224,96,0.92)';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a1 = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const a2 = a1 + Math.PI / 5;
      ctx.lineTo(Math.cos(a1) * 7, Math.sin(a1) * 7);
      ctx.lineTo(Math.cos(a2) * 3.2, Math.sin(a2) * 3.2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  fxDrawFlower(ctx, p) {
    const s = p.s * 9;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.t * 2 + (p.rot || 0));
    ctx.scale(s / 9, s / 9);
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate((i * 2 * Math.PI) / 5);
      ctx.fillStyle = 'hsla(' + (120 + i * 42) + ',82%,72%,0.82)';
      ctx.beginPath();
      ctx.ellipse(3.5, 0, 5, 3, 0, 0, 6.29);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,205,70,0.95)';
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, 6.29);
    ctx.fill();
    ctx.restore();
  }

  // 动画链（与浏览器 pickNext 语义一致，纯逻辑在 shared）
  playIdle() {
    this.stopMove();
    const { animations, animationWeights } = { animations: this.animations, animationWeights: this.weights };
    const roll = Math.random();
    // 宠物固定（pets[].fixedEnabled）：掷骰时把「转向 / 移动」两档权重按 0 算（与浏览器同一份
    // 决策）——随机链不再让宠物自己翻朝向或走开。右键菜单点播与 /anim 接口不走这里，不受影响。
    const k = S.rollKind(roll, animationWeights, { fixed: this.pet.fixedEnabled });
    let next;
    if (k === 'idle') {
      // 活生生气息：待机时偶发触发动作元形（打盹/臭美/演奏…），序列播完再回随机链
      if (Math.random() < 0.14 && this.tryRandomMeta()) return;
      // 新作动画（FX 特效）：8% 概率随机来一段（爱心/音符/星光/花朵/水波），不打断待机
      if (Math.random() < 0.08) {
        const fxs = ['heart', 'note', 'sparkle', 'flower', 'ripple'];
        this.fxRun(fxs[Math.floor(Math.random() * fxs.length)]);
      }
      next = S.pick(animations.idle, this.anim);
    } else if (k === 'turn') {
      next = S.pick(animations.turn, this.anim);
    } else if (k === 'move') {
      const moved = this.tryMove();
      if (moved === false) {
        const act = S.pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
        next = act.name;
      } else if (typeof moved === 'string') {
        next = moved;
      } else {
        // 已有一场移动进行中（占用）：与浏览器一致，重播当前动画，不另设（绝不重复加载不存在的动作）
        this.playOnce(this.anim);
        return;
      }
    } else {
      const act = S.pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
      next = act.name;
    }
    this.playOnce(next);
  }

  handleEnded() {
    if (this.dragState.active) return;
    // 动作元形队列：一段播完接着播下一段（打盹=伸懒腰→哈欠→趴睡…）；队列空再走原逻辑
    if (this.metaQueue.length > 0) {
      if (this.advanceMetaQueue()) return;
    }
    // 趴窗/贴边巡逻中：动画由巡逻器统一管理（爬/跳用 move 动画 loop、休息用 idle loop），
    // 不进入随机链——否则 ended 会触发 playIdle 随机链，把贴边状态打断成漫游
    if (this.dock.active) return;
    const { animations } = { animations: this.animations };
    // 事件动画播完：回 idle（与 drag/clicks 同分支，不进随机链）；气泡由定时器自动消失，与动画解耦
    const isEvent = S.isEventAnim(animations.events, this.anim);
    if (isEvent) {
      // 工作状态多候选档位：播完一段自动轮换到下一候选（排除当前段，避免连抽），继续循环——
      // 长时间状态不单段重复（与浏览器 ended 护栏共用同一决策 nextWorkStatusAnim）。
      // 仅非终态档位轮换；终态（success/error）播完一次即结束，绝不轮换续播。单候选档位由
      // loop 无限循环（不触发 ended，不会走到这里）。
      const nonTerminal = this.workState && this.workState !== 'success' && this.workState !== 'error';
      const nextWork = nonTerminal ? S.nextWorkStatusAnim(animations.events?.workStatus ?? [], this.anim) : null;
      if (nextWork !== null) {
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' workStatus 档内轮换: ' +
            this.anim +
            ' -> ' +
            nextWork,
        );
        this.playOnce(nextWork); // 继续播一遍（once=true）→ ended 再轮换
        return;
      }
      // 非 workStatus 事件动画（余额/碎碎念）播完：workStatus 仍非终态 → 立即恢复档位循环动画，
      // 不进随机链（长事件期间状态不变，随机链会一直播到状态切换才被拉回）
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    if (animations.turn.includes(this.anim)) {
      const next = this.facing === 'left' ? 'right' : 'left';
      this.facing = next; // 立即同步：翻转后的 pickNext 用新朝向过滤 noMirror
    }
    if (animations.drag.includes(this.anim) || animations.clicks.includes(this.anim)) {
      // 互动动画播完：workStatus 非终态时恢复状态循环，否则回 idle（与浏览器同一语义）
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    this.playIdle();
  }

  // 互动/事件动画播完后恢复 workStatus 档位循环：非终态 → 按当前状态档位重选动画（多候选档内
  // 随机并避开当前段）；终态/空闲 → false 不接管，调用方走原逻辑（回 idle / 随机池，与浏览器一致）。
  resumeWorkStatusAnim() {
    const state = this.workState;
    if (!state || state === 'success' || state === 'error') return false;
    const pool = this.animations.events?.workStatus;
    if (!pool || pool.length === 0) return false;
    const idx = S.WORK_STATUS_INDEX[state];
    const slot = pool[idx];
    if (slot === undefined) return false;
    const name = S.pickSlot(slot, this.anim); // 避开当前正播动画（避免连续重复）
    console.log(
      '[dsh-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + this.pet.id + ' 恢复工作状态动画: ' + name,
    );
    const rotating = Array.isArray(slot) && slot.length > 1;
    if (rotating)
      this.playOnce(name); // 多候选：播完由 handleEnded 轮换
    else this.switchTo(name, false); // 单候选：无限循环
    return true;
  }

  // ---- 漫游（rAF 驱动，动画首尾各 leadSec/tailSec 秒原地不动；几何在 shared/planMove） ----
  // preferredName 传入时固定使用该动画（右键菜单点播移动动画），否则与随机链一致随机选
  tryMove(preferredName) {
    if (this.moveRef !== null || this.pendingMove || this.throwRef !== null) return true;
    const moves = this.animations.moves;
    const actions = moves.actions;
    if (!actions.length) return false;
    const chosen = preferredName
      ? actions.find((a) => a.name === preferredName) || null
      : actions[Math.floor(Math.random() * actions.length)];
    if (!chosen) return false;
    const mp = Object.assign({}, moves.default, chosen.params || {});
    const dir = (this.facing === 'right') !== this.animations.turn.includes(this.anim) ? 1 : -1;
    const W = VIEW.w;
    const H = VIEW.h;
    const distScale = this.size / S.PET_REF_WIDTH;
    const plan = S.planMove({
      cx: this.currentCenterX(),
      cy: this.currentCenterY(),
      W,
      H,
      dir,
      minDist: mp.minDist * distScale,
      maxDist: mp.maxDist * distScale,
      margin: mp.margin, // 同 position() 的 marginX/marginY：页面级缩放统一放大，配置值不再乘 scale（§3.5）
      halfW: this.halfW,
      sideAllow: this.sideAllow,
      // 落点按显示器并集判定：能骑缝跨屏走，但走不进外接矩形里的空洞
      areas: AREAS,
    });
    if (!plan) return false;
    this.pendingMove = { ...plan, dir, leadSec: mp.leadSec, tailSec: mp.tailSec };
    this.anim = chosen.name;
    this.once = true;
    this.switchTo(chosen.name, true);
    return chosen.name;
  }

  startMoveDrive(el) {
    const pm = this.pendingMove;
    if (!pm || this.moveRef !== null) return;
    this.pendingMove = null;
    const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
    const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
    const token = ++this.moveToken;
    const W = VIEW.w;
    const H = VIEW.h;
    const step = () => {
      if (this.moveToken !== token) return;
      const t = el.currentTime || 0;
      let ratioX;
      if (t <= leadSec) ratioX = startRatio;
      else if (t >= duration - tailSec) ratioX = targetRatio;
      else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);
      // 移动的是窗口（宠物包围盒跟随），sprite 在本窗口内不动
      this.sendBounds(ratioX * W - this.halfW, startYRatio * H - this.halfH);
      if (t < duration - tailSec) {
        this.moveRef = requestAnimationFrame(step);
      } else {
        this.moveRef = null;
        this.customPos = { rx: targetRatio, ry: startYRatio };
      }
    };
    this.moveRef = requestAnimationFrame(step);
  }

  stopMove() {
    this.pendingMove = null;
    this.moveToken++;
    if (this.moveRef !== null) {
      cancelAnimationFrame(this.moveRef);
      this.moveRef = null;
    }
  }

  /** 停止"走向窗口"（被抓起来 / 点击互动 / 销毁时打断走路） */
  stopWalk() {
    this.walkToken++;
    if (this.walkRef !== null) {
      cancelAnimationFrame(this.walkRef);
      this.walkRef = null;
    }
  }

  // ---- 拖拽抛掷物理（弹簧跟手 + 甩抛 + 重力反弹；与浏览器 pet.ts 同构）----
  stopDragFollow() {
    this.dragFollowToken++;
    if (this.dragFollow !== null) {
      cancelAnimationFrame(this.dragFollow);
      this.dragFollow = null;
    }
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
  }

  /** rAF 弹簧跟随：窗口朝拖拽目标过阻尼追赶（不再硬贴指针），抹平高频抖动 */
  startDragFollow() {
    if (this.dragFollow !== null) return;
    const token = ++this.dragFollowToken;
    let last = performance.now();
    const step = () => {
      if (this.dragFollowToken !== token) return;
      const target = this.dragTarget;
      if (!target) {
        this.dragFollow = null;
        return;
      }
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const vel = this.dragVel;
      let x = this.pos.x;
      let y = this.pos.y;
      vel.vx = S.springStep(vel.vx, x, target.x, dt, this.physics.throwPower);
      vel.vy = S.springStep(vel.vy, y, target.y, dt, this.physics.throwPower);
      x += vel.vx * dt;
      y += vel.vy * dt;
      this.sendBounds(x, y); // 移动的是窗口（this.pos 实时更新）；sprite 在本窗口内不动
      this.dragFollow = requestAnimationFrame(step);
    };
    this.dragFollow = requestAnimationFrame(step);
  }

  /** 停止抛掷（空中被抓/点菜单/回家时立即定格在当前落点）。
   *  同时清速度状态 throwState——否则「抓住后温柔放下」会残留最后一次飞行速度，
   *  静止的宠物点一下就误判为飞行中。点击积分用的飞行动态由 onPointerDown 提前记录。 */
  stopThrow() {
    this.throwToken++;
    if (this.throwRef !== null) {
      cancelAnimationFrame(this.throwRef);
      this.throwRef = null;
    }
    this.throwState = null;
  }

  /** 抛掷驱动：重力 + 边缘反弹 + 落地摩擦，落定后写入 customPos */
  startThrow(px, py, vx, vy) {
    this.stopDragFollow();
    this.stopMove();
    // 边界 = 显示器工作区**并集**：空洞是墙（宠物再也飞不进不可见区域），屏缝不是墙（跨屏弹跳照旧）
    // confineToScreen 开启时改为锁定**松手这一刻所在的那块屏**：屏缝同样当墙，只在目标屏内弹。
    // 锁定屏在抛掷开始时定下、飞行途中不重取；relayout 改了屏数时由 throwStepRegion 退回不锁定。
    const lockScreen = this.confineToScreen ? S.screenOfBox(this.throwSpaceOf(), px, py) : -1;
    const token = ++this.throwToken;
    let state = { x: px, y: py, vx, vy };
    let last = performance.now();
    let prevGrounded = false; // 落地 Q 弹：只在空中→地面转换帧触发一次
    const step = () => {
      if (this.throwToken !== token) return;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const fallingVy = state.vy; // 本帧积分前的竖直速度（正=下落）：即落地冲击速度
      // 每帧重取：显示器变化时 relayout() 会让缓存失效，res.screen 必须与这一份对应
      const sp = this.throwSpaceOf();
      const res = S.throwStepRegion(state, dt, sp, this.physics, lockScreen);
      state = { x: res.x, y: res.y, vx: res.vx, vy: res.vy };
      this.throwState = state;
      // 上报飞行状态（节流 ~30ms）：主进程 broker 汇聚后广播，其它窗口用它做跨窗碰撞检测；
      // broker 协议单位 = 物理像素，这里 ×scale（§3.5 收口）
      if (window.petBridge && window.petBridge.reportFlight && now - this.lastFlightReport > 30) {
        window.petBridge.reportFlight({
          x: toScreen(state.x),
          y: toScreen(state.y),
          vx: toScreen(state.vx),
          vy: toScreen(state.vy),
          size: toScreen(this.size),
          bottomPad: toScreen(this.bottomPad),
        });
        this.lastFlightReport = now;
      }
      // 宠物间碰撞（仅 petCollision 开启）：飞行中的自己撞到其它宠物 → 动量弹开
      if (this.physics && this.physics.petCollision) {
        const myBody = S.bodyPixelBox({ x: state.x, y: state.y, size: this.size, bottomPad: this.bottomPad });
        for (const pid of Object.keys(this.others)) {
          const o = this.others[pid];
          if (!o || !o.size) continue;
          const otherBody = S.bodyPixelBox({ x: o.x, y: o.y, size: o.size, bottomPad: o.bottomPad });
          if (!S.rectsOverlap(myBody, otherBody)) continue;
          const hit = S.collidePet(
            { x: state.x, y: state.y, vx: state.vx, vy: state.vy, size: this.size },
            { x: o.x, y: o.y, vx: o.vx, vy: o.vy, size: o.size },
          );
          if (hit) {
            // 飞行方：按动量结果继续弹开；被撞方：主进程转发给目标窗口 → 目标窗 startThrow
            state.vx = hit.fvx;
            state.vy = hit.fvy;
            this.throwState = state;
            if (window.petBridge && window.petBridge.reportCollide) {
              // 被撞方初速同为 broker 物理像素协议：×scale（§3.5 收口）
              window.petBridge.reportCollide(pid, toScreen(hit.hvx), toScreen(hit.hvy));
            }
            break; // 一帧只处理一次碰撞（避免连锁触发抖动）
          }
        }
      }
      this.sendBounds(res.x, res.y);
      // 落地 Q 弹：只在空中→地面转换帧触发一次，力度随冲击速度（轻落 0.8 ~ 重砸 0.55）。
      // 「地面」是**当前所在屏**的底边——多屏各有各的地面高度
      const curBounds = sp.bounds[res.screen] || sp.bounds[0];
      const grounded = curBounds ? res.y >= curBounds.maxY - 1 : false;
      if (res.bounced && grounded && !prevGrounded) {
        const frontEl = this.front === 0 ? this.videoA : this.videoB;
        this.startSquash(frontEl, S.landingSquash(fallingVy));
      }
      prevGrounded = grounded;
      if (res.atRest) {
        this.throwRef = null;
        this.throwState = null;
        this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
        return;
      }
      this.throwRef = requestAnimationFrame(step);
    };
    this.throwRef = requestAnimationFrame(step);
  }

  /** 被撞回调（跨窗碰撞 broker 转发）：停当前动作，从落点以新初速抛出去（全复用现有物理） */
  onDeskHit(vx, vy) {
    this.stopMove();
    this.stopDragFollow();
    this.stopThrow();
    this.startThrow(this.pos.x, this.pos.y, vx, vy);
  }

  /** Q 弹挤压：前台视频垂直压扁（贴地锚定，transform-origin:bottom）再回弹；
   *  与浏览器同构，曲线在 shared（S.squashScale）。depth = 下压幅度（点击固定 0.55；
   *  落地按冲击速度 S.landingSquash 动态取）。reduce-motion 时跳过。 */
  startSquash(el, depth = S.SQ_SQUASH) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const token = ++this.squashToken;
    if (this.squashRef !== null) cancelAnimationFrame(this.squashRef);
    const origin = el.style.transformOrigin;
    el.style.transformOrigin = 'bottom';
    const t0 = performance.now();
    const step = () => {
      if (this.squashToken !== token) return;
      const u = Math.min((performance.now() - t0) / S.SQ_DURATION_MS, 1);
      const scale = S.squashScale(u, depth);
      el.style.transform = (this.facing === 'right' ? 'scaleX(-1) ' : '') + 'scaleY(' + scale + ')';
      if (u < 1) {
        this.squashRef = requestAnimationFrame(step);
      } else {
        this.squashRef = null;
        el.style.transformOrigin = origin;
        // 恢复纯镜像（若期间 switchTo 重置过 transform，也以镜像为准）
        el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      }
    };
    this.squashRef = requestAnimationFrame(step);
  }

  stopSquash() {
    this.squashToken++;
    if (this.squashRef !== null) {
      cancelAnimationFrame(this.squashRef);
      this.squashRef = null;
    }
  }

  // ---- 点击 vs 拖拽（与浏览器一致：阈值/抓取偏移/释放回循环待机；移动的是窗口） ----
  onPointerDown(e) {
    // 只认左键：右键进入拖拽判定会与右键菜单打架（右键不拖拽，两端一致）
    if (e.button !== 0) return;
    this.lastInteractionAt = Date.now(); // 直接上手互动：求关注/重逢判定就此续期
    this.leaveDock(); // 用户抓住了：立即退出趴窗/巡逻（松手后再按位置决定要不要重新趴）
    this.stopWalk(); // 正在走向窗口 → 被打断，停在原地
    // 抓取速度日志：stopThrow 之前读，否则飞行速度就没了；静止时记录 0（与浏览器同构）
    const grabState = this.throwState;
    console.log(
      '[dsh-pet] ' +
        new Date().toTimeString().slice(0, 8) +
        ' pet=' +
        this.pet.id +
        ' grab vx=' +
        (grabState ? Math.round(grabState.vx) : 0) +
        ' vy=' +
        (grabState ? Math.round(grabState.vy) : 0) +
        ' |v|=' +
        (grabState ? Math.round(Math.hypot(grabState.vx, grabState.vy)) : 0),
    );
    // 点击积分：**按下瞬间即触发**（不等松开）。读取 stopThrow 之前的飞行速度，
    // 在飞行中且达标 → 立即粒子爆发 + 积分弹窗；pressScoreFired 标记本次按下已触发，
    // 松开的 click 据此不再重复弹、也不再播普通点击动画（与浏览器同构）。
    this.pressScoreFired = false;
    if (grabState) {
      const grabSpeed = Math.hypot(grabState.vx, grabState.vy);
      if (grabSpeed >= S.SCORE_MIN_SPEED) {
        this.pressScoreFired = true;
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' click-score speed=' +
            Math.round(grabSpeed) +
            ' size=' +
            this.size +
            ' -> +' +
            S.clickScore(grabSpeed, this.size),
        );
        S.spawnScoreBurst(e.clientX, e.clientY);
        S.mountScorePopup({
          x: e.clientX,
          y: e.clientY,
          score: S.clickScore(grabSpeed, this.size),
          speed: grabSpeed,
          size: this.pet.size,
        });
      }
    }
    this.stopThrow(); // 空中抓取：从当前落点开始新拖拽（this.pos 实时）
    this.stopDragFollow();
    this.stopMove();
    this.dragTrail = [];
    this.hit.classList.add('dragging');
    // 收起悬浮提示：拖拽期间窗口逐帧跟随光标，指针始终在身体内、onMouseMove 的 inBody 恒为真，
    // 不主动收就会让提示跟着宠物一路飘（松开后由 onPointerUp 按指针位置复位）
    this.setTip(false);
    this.stopMove();
    try {
      this.hit.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略捕获失败 */
    }
    // 记录【按下时的指针屏幕坐标】与【按下时的宠物窗口位置】——之后全部用 e.screenX/Y
    // 做增量：指针屏幕坐标与窗口位置无关，不受窗口被逐帧移动影响（window.screenX 会滞后/缓存）。
    // 屏幕坐标是物理像素，除以 CONFIG.scale 进 CSS 系（§3.5）——增量公式两边同一单位。
    this.dragState = {
      active: true,
      dragging: false,
      sx: toLocal(e.screenX),
      sy: toLocal(e.screenY),
      petX: this.pos.x,
      petY: this.pos.y,
    };
    // 拖拽信号（桌面端专有）：主进程的兜底穿透通道按**光标与窗口矩形**判定，而窗口比宠物身体大一圈；
    // 拖拽中宠物滞后于光标，光标可能跑到窗口外→窗口翻回穿透→本窗口收不到 pointermove/pointerup
    // （宠物"飞"出去，见 pointer-target.js）。这里上报"我正在用输入"，主进程据此绝不翻回穿透。
    this.syncInputBusy();
    // 注意：舞台「拍平」（去掉 translateY(bottomPad)）不能在这里做——
    // 纯点击（按下即松开）会让人物瞬移上移再落下。与浏览器一致：只有拖拽超过阈值才拍平。
  }

  onPointerMove(e) {
    const d = this.dragState;
    if (!d.active) return;
    // 阈值判定用屏幕坐标增量（clientX 会随窗口移动而变化，屏幕坐标稳定）；屏幕坐标 ÷scale 进 CSS 系
    const dx = toLocal(e.screenX) - d.sx;
    const dy = toLocal(e.screenY) - d.sy;
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < S.DRAG_THRESHOLD) return;
      d.dragging = true;
      // 真正开始拖拽才把舞台拍平（人物随光标拿起；与浏览器 dragging 语义一致）
      this.stage.style.transform = 'none';
      if (this.animations.drag.length) {
        this.playOnce(S.pick(this.animations.drag));
      }
      this.syncInputBusy(); // 拖拽成立：主进程兜底通道闭嘴（见 inputBusy）
    }
    // 记录指针轨迹（screenX/Y 采样：与视口坐标只差常数偏移，速度一致；初速估算用；÷scale 进 CSS 系）
    const now = performance.now();
    this.dragTrail.push({ t: now, x: toLocal(e.screenX), y: toLocal(e.screenY) });
    this.dragTrail = S.trimTrail(this.dragTrail, now);
    // 弹簧目标 = 按下时的宠物位置 + 指针屏幕增量（窗口怎么动都不影响坐标）——不再硬贴指针，
    // 由 rAF 弹簧跟随逐帧追赶（抹平高频抖动，与浏览器同构）
    this.dragTarget = { x: d.petX + dx, y: d.petY + dy };
    this.startDragFollow();
  }

  onPointerUp(e) {
    const d = this.dragState;
    const wasDragging = d.dragging;
    d.active = false;
    d.dragging = false;
    this.hit.classList.remove('dragging');
    this.stopDragFollow(); // 弹簧跟随立即停（位置定格在实时 this.pos）
    this.stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.syncInputBusy(); // 拖拽结束：交还给常规判定（幂等，非拖拽时多调一次不发 IPC）
    // 提示复位：点击/拖拽期间收起的悬浮提示，指针仍在命中区内就恢复（与浏览器 handlePointerUp 同一处理）。
    // 用 hitRect 几何判定而不是 getBoundingClientRect：命中区是窗口坐标里的权威几何，与 onMouseMove 同源。
    // 位置有讲究：必须留在 syncInputBusy() 之后——pointer-target.test.ts 只扫本函数开头 400 字符
    // 来找上报调用，插到它前面会把上报挤出窗口（该断言守的是"松手必上报，否则窗口粘在可交互"）。
    if (e && Number.isFinite(e.clientX)) {
      const r = this.hitRect;
      const px = e.clientX - this.margin.l;
      const py = e.clientY - this.margin.t;
      // 先按松手位置更新光标再摆位/显示，否则会重现拖拽前的位置（与浏览器 placeTip 同一处理）
      this.tipCursor = {
        x: this.pos.x - this.margin.l + e.clientX,
        y: this.pos.y - this.margin.t + e.clientY,
      };
      this.setTip(px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    }
    if (wasDragging) {
      this.justDragged = true;
      setTimeout(() => {
        this.justDragged = false;
      }, 100);
      if (e && Number.isFinite(e.screenX)) {
        // 原始输入留痕（实机排查用：验证指针屏幕坐标与窗口位移是否一致，如 DPI 缩放问题）
        window.__dshPetDebug.lastDragRaw = {
          petX: d.petX,
          petY: d.petY,
          sxDown: d.sx,
          syDown: d.sy,
          xUp: e.screenX,
          yUp: e.screenY,
        };
      }
      // 拖拽松手：workStatus 非终态时恢复状态循环，否则回 idle（与浏览器 handlePointerUp 一致）
      // 修复：旧实现 switchTo(idle,false)（loop=true，ended 永不触发）→ 随机链永远回不来，
      // 永远卡在同一段待机动画；改为 playOnce（once=true）播一遍 → ended → handleEnded → playIdle 随机链
      if (!this.resumeWorkStatusAnim()) {
        if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));
      }
      // 释放位置 = 弹簧跟随后的实际包围盒左上角（this.pos 实时；不是指针目标——
      // 跟手滞后时落点跟随宠物实际位置，与浏览器 boxPx 同语义）
      const px = this.pos.x;
      const py = this.pos.y;
      // 初速估算：够快就抛掷（重力+边缘反弹+落地摩擦），否则原地放下
      const vel = S.estimateReleaseVelocity(this.dragTrail, performance.now(), this.physics);
      this.dragTrail = [];
      if (vel) {
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' release vx=' +
            Math.round(vel.vx) +
            ' vy=' +
            Math.round(vel.vy) +
            ' |v|=' +
            Math.round(Math.hypot(vel.vx, vel.vy)),
        );
        this.startThrow(px, py, vel.vx, vel.vy);
        this.userPlaced = true; // 甩出去落哪儿算哪儿，90 秒内不被拉回
        this.userPlacedAt = performance.now();
      } else {
        // customPos 语义 = 宠物**中心**比例（position() 用 rx*W - halfW 还原左上角；
        // startThrow 落定也按同一公式存），松手无边界夹取
        this.customPos = { rx: (px + this.halfW) / VIEW.w, ry: (py + this.halfH) / VIEW.h };
        this.position();
        // 释放后的最终窗口位置（position() 换算后，松手无夹取），冒烟断言"释放不位移"用
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
        // 松手吸附：把宠物放到前台应用窗口边上 → 自动半身藏起来、趴在窗口上玩（"吊在窗口这里"）。
        // 贴边成功 = 用户主动让它趴窗，立即恢复自动跟随；否则 = 用户自由放置，90 秒内尊重放置位置
        const docked = this.tryEnterDock();
        this.userPlaced = !docked;
        this.userPlacedAt = performance.now();
      }
    }
  }

  // ---- 点击穿透（严格对齐浏览器：只有身体命中区可交互，透明像素穿透到下层应用） ----
  /**
   * 本窗口是否**必须保持可交互**（= "我正在用这个窗口的鼠标输入"）。
   *
   * 三个来源：拖拽中 / 右键菜单开着 / 对话弹窗开着——它们都是"窗口内的 DOM 或事件链正在被使用"，
   * 而它们的输入全部来自**窗口级鼠标事件**（pointermove/pointerup/click）：窗口一旦变回穿透，
   * 输入链就断了（拖拽会定格在最后一次采样上，松手也没人报 pointerup → 宠物按旧速度飞出去）。
   *
   * 这个信号是**渲染端专有的知识**：只有它知道"我正在用输入"，主进程无从推断（光看光标位置和窗口
   * 位移分不清"拖拽跟手"和"漫游/抛掷"）。同时上报控件矩形：菜单/聊天框外的透明区域继续穿透。
   */
  inputBusy() {
    return this.dragState.active || this.menuOpen || this.chatOpen;
  }

  /**
   * 上报一次"要不要保持可交互"。**所有**状态变化点都走这里（幂等：值没变不发 IPC）。
   * 与 setInteractive 的分工：setInteractive 表达"光标在不在身体上"（常规判定），
   * 本方法表达"我有没有在用输入"（优先级更高，覆写常规判定）。
   */
  syncInputBusy() {
    this.syncInputRegions();
    const busy = this.inputBusy();
    if (busy === this._inputBusy) return;
    this._inputBusy = busy;
    window.__dshPetDebug.inputBusy = busy;
    if (window.petBridge) window.petBridge.setInputBusy(busy);
  }

  syncInputRegions() {
    if (!window.petBridge || !window.petBridge.setInputRegions) return;
    const rects = [];
    const controls = [...document.querySelectorAll('.dsh-pet-menu-column, .dsh-pet-chat')];
    for (const el of this.inputRegionElements) {
      if (!controls.includes(el)) {
        this.inputRegionResize.unobserve(el);
        this.inputRegionElements.delete(el);
      }
    }
    for (const el of controls) {
      if (!this.inputRegionElements.has(el)) {
        this.inputRegionElements.add(el);
        this.inputRegionResize.observe(el);
      }
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        rects.push({ x: toScreen(r.x), y: toScreen(r.y), width: toScreen(r.width), height: toScreen(r.height) });
      }
    }
    const input = { dragging: this.dragState.active, rects };
    const key = JSON.stringify(input);
    if (key === this._inputRegions) return;
    this._inputRegions = key;
    window.petBridge.setInputRegions(input);
  }

  setInteractive(flag) {
    const next = !!flag;
    if (next === this._interactive) return; // 只在状态变化时发 IPC，避免逐帧刷屏
    this._interactive = next;
    window.__dshPetDebug.interactive = next;
    if (window.petBridge) window.petBridge.setInteractive(next);
  }

  /**
   * 悬浮提示显隐（替代原先挂在命中层 title 上的原生系统提示）。
   *
   * 由 onMouseMove 的「光标在不在身体命中区」驱动，而不是 pointerenter/pointerleave：
   * 身体外整窗是穿透的（main 的 setIgnoreMouseEvents(true, {forward:true})），光标离开身体时
   * pointerleave 未必派发，提示会赖在屏幕上不走；几何判定与点击穿透翻转同源，才不会有第二种口径。
   */
  setTip(on) {
    const next = !!on;
    if (next === this.tipOn) return;
    this.tipOn = next;
    this.renderTip();
  }

  /**
   * 悬浮提示渲染：文本 = 宠物显示名（host 已保证 name = rawName || id，不会空）；
   * 位置 = 光标右下（装不下自动翻边），摆位判据与浏览器端共用 shared 的 tooltipPlacement。
   *
   * 坐标要绕一次：光标存的是**视口坐标**（this.tipCursor），而提示是 position:fixed、
   * DOM 坐标相对**窗口**，所以这里减掉窗口原点（= 宠物包围盒左上角 − 四周余量）。
   * 为什么要存视口坐标而不是窗口坐标：宠物自己走动/被抛出时窗口会移动，存视口坐标就只需
   * 在这里按当前窗口原点重算一次，贴光标不会漂（sendBounds 每帧会调本函数）。
   */
  renderTip() {
    if (this.tip.textContent !== this.pet.name) this.tip.textContent = this.pet.name;
    const cursor = this.tipCursor;
    if (cursor) {
      const winX = this.pos.x - this.margin.l;
      const winY = this.pos.y - this.margin.t;
      const winW = this.size + this.margin.l + this.margin.r;
      const winH = this.winH + this.margin.t + this.margin.b;
      // 允许显示范围 = 窗口 ∩ 光标所在屏的工作区，两者必须取交集：
      // 只按窗口夹，窗口能贴到屏幕外，提示会被画到看不见的地方；只按工作区夹，提示会落到窗口外
      // （index.html 的 html,body 是 overflow:hidden，一样看不见）。
      const area = S.resolveRect(WORK_AREAS, cursor.x, cursor.y) ?? { x: winX, y: winY, width: winW, height: winH };
      const x0 = Math.max(winX, area.x);
      const y0 = Math.max(winY, area.y);
      const x1 = Math.min(winX + winW, area.x + area.width);
      const y1 = Math.min(winY + winH, area.y + area.height);
      const p = S.tooltipPlacement(
        { x: cursor.x - winX, y: cursor.y - winY },
        { w: this.tip.offsetWidth, h: this.tip.offsetHeight },
        { x: x0 - winX, y: y0 - winY, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) },
        this.size * S.TOOLTIP_GAP_RATIO,
      );
      this.tip.style.left = p.x + 'px';
      this.tip.style.top = p.y + 'px';
    }
    this.tip.classList.toggle('is-on', this.tipOn);
    window.__dshPetDebug.tooltipOn = this.tipOn;
  }

  onMouseMove(e) {
    // 拖拽态下所有按键已松开：说明 pointerup/pointercancel/lostpointercapture 全部丢失，
    // 就地按松手收尾，否则 dragState.active 与 inputBusy 永久为 true（穿透永不恢复）。
    if (this.dragState.active && e.buttons === 0) {
      this.onPointerUp(e);
      return;
    }
    // 拖拽中窗口逐帧跟随光标、指针相对窗口坐标会有帧级抖动——强制保持可交互，绝不翻转（翻转会断拖拽）
    if (this.dragState.active) {
      this.setInteractive(true);
      return;
    }
    // 右键菜单/对话弹窗开启：整窗保持可交互（悬停菜单项/点输入框都不触发穿透翻转）；关闭后恢复命中区判定
    if (this.menuOpen || this.chatOpen) {
      this.syncInputRegions(); // 级联菜单按悬停增减面板，及时更新其真实占用区域
      this.setInteractive(true);
      this.setTip(false); // 菜单/弹窗期间提示让位：光标已不在身体上，也不该跟浮层抢注意力
      return;
    }
    const r = this.hitRect;
    // forwarded 事件坐标以窗口为原点（与页坐标一致）；转换到 sprite 坐标需扣减窗口余量；
    // 异常时退回屏幕坐标 − 窗口屏幕位置推导（hitRect/pos 均为 CSS 系）：屏幕坐标 ÷scale 后
    // 减去窗口屏幕原点（CSS 系）即窗口内坐标
    const wx = Number.isFinite(e.clientX) ? e.clientX : toLocal(e.screenX) - (this.pos.x + VIEW.x - this.margin.l);
    const wy = Number.isFinite(e.clientY) ? e.clientY : toLocal(e.screenY) - (this.pos.y + VIEW.y - this.margin.t);
    const px = wx - this.margin.l;
    const py = wy - this.margin.t;
    const inBody = px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    // 光标位置存**视口坐标**（窗口原点 + 窗口内坐标）：窗口随宠物移动时贴光标不会漂，见 renderTip。
    // 必须在 setTip 之前更新：setTip 变显隐时会立刻渲染一次，晚一步就会用上一次的光标摆位。
    if (inBody) this.tipCursor = { x: this.pos.x - this.margin.l + wx, y: this.pos.y - this.margin.t + wy };
    this.setInteractive(inBody);
    // 悬浮提示与可交互判定同源（同一个 inBody）：光标进身体 → 提示出现，离开 → 收起
    this.setTip(inBody);
    // 跟随光标：位置依赖光标，所以每次移动都得重摆一次（setTip 只在显隐变化时才渲染）
    if (this.tipOn) this.renderTip();
  }

  // 锁屏/解锁台词（零 API 零 token，纯系统事件驱动）：
  //   locked   主人锁屏离开（Win+L/合盖/自动锁屏）→ "帮你看家"；
  //   unlocked 人回来了 → "主人回来啦"，同时把"最近互动"续期到此刻——
  //             不续期的话，解锁后定时器一算"两小时没理它"，开口就是"想你了"，很尬。
  onPowerState(state) {
    if (!this.showWhisper) return;
    if (state === 'locked') {
      this.showWhisper('主人先去忙啦，我帮你看家～', '', true);
      return;
    }
    if (state === 'unlocked') {
      this.lastInteractionAt = Date.now();
      this.showWhisper('主人回来啦！', '', true);
    }
  }

  onClick() {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;
    // 积分判定已在 onPointerDown（按下即触发）完成：
    // 本次按下已触发过积分 → 只收手停住、**不**再播普通点击动画（粒子+弹窗即反馈，与浏览器同构）
    if (this.pressScoreFired) {
      this.pressScoreFired = false;
      this.stopThrow();
      this.stopMove();
      return;
    }
    this.stopThrow(); // 点击飞行中的宠物 = 收手停住（再播点击回应）
    this.stopMove();
    this.stopWalk(); // 正在走向窗口 → 停下来先回应你
    // 点击俏皮话（零 token）：点一下，它俏皮/调皮/整蛊地说一句（只弹气泡，不打断点击动画）
    this.sayCatchLine();
    // 趴在窗口上被点：停下来趴着回个话，随后自动续爬（不退出趴窗状态）
    if (this.dock.active) this.pauseDock(2600);
    if (!this.animations.clicks.length) return;
    this.pendingSquash = true; // 等新点击动画切到前台后 Q 弹（压新首帧，与浏览器一致）
    this.playOnce(S.pick(this.animations.clicks));
  }

  // 点击俏皮话：按连击情绪从 shared/life 的分档池取一句（零 API 零 token，与浏览器同一份）。
  // 连戳会惹毛它（痒→烦→气→求饶），停手几秒再点又变回俏皮——"当下有脾气、记性不长"。
  sayCatchLine() {
    if (!this.showWhisper) return;
    const now = Date.now();
    this.lastInteractionAt = now;
    this.clickCombo = S.nextClickCombo(this.clickCombo, now);
    const text = S.clickLineFor(this.clickCombo.mood, this.lastCatchLine);
    if (!text) return;
    this.lastCatchLine = text;
    this.showWhisper(text, '', true);
  }

  // 趴在窗口顶端/底端的专属台词（躺顶 / 趴底，零 token）
  sayPerchLine(edge) {
    const pool = PERCH_LINES[edge === 'top' || edge === 'bottom' ? edge : 'bottom'];
    if (!pool || !pool.length || !this.showWhisper) return;
    this.showWhisper(pool[Math.floor(Math.random() * pool.length)], '', true);
  }

  // 活动状态切换（"主人正在干什么"）：行为差异 + 欢迎语 + 状态台词定时器
  setActivity(name) {
    const act = this.activity;
    const prev = act.name;
    if (name === prev) return;
    act.name = name;
    if (window.__dshPetDebug) window.__dshPetDebug.activity = name;
    // 行为差异：安静型状态（敲代码/看剧/办公）固定不漫游不转身，乖乖待在边上陪主人；
    // 活泼型（聊天/浏览/游戏/其他）恢复自由漫游——复用 fixedEnabled（随机链 turn/move 权重归 0）
    this.pet.fixedEnabled = ACTIVITY_QUIET.has(name);
    // 状态变化欢迎语（开机第一次见真实状态不弹，避免刚启动就话痨；other 无欢迎语）
    act.seen = act.seen || name !== 'other';
    if (act.seen && prev !== name && ACTIVITY_WELCOME[name] && this.showWhisper) {
      this.showWhisper(ACTIVITY_WELCOME[name], '', true);
    }
    // 状态台词定时器：状态变了就重置（每 90~150s 按当前状态池弹一句，零 token）。
    // 生活化分流见 sayLifeLine：深夜切深夜池且间隔拉长 2.5 倍（它还困着）、当天第一次开口先问早安、
    // 好久没人理它先说求关注/重逢——这些都与状态台词同一个定时器，不另起炉灶。
    this.startLifeLines();
  }

  /**
   * 生活化台词定时器（活动台词 / 早安 / 深夜 / 求关注重逢共用同一套调度）。
   *
   * 为什么启动就要跑、而不是等第一次 setActivity：活动名从始至终是 'other' 时
   * （桌面、资源管理器这类认不出分类的前台窗口）setActivity 会因 name===prev 直接返回，
   * 定时器永远建不起来——早安、深夜犯困、求关注就全哑火了。活动切换时由 setActivity
   * 调它重置（换状态重新计时，不等上一档的剩余时间）。
   */
  startLifeLines() {
    const act = this.activity;
    if (act.timer !== null) {
      window.clearTimeout(act.timer);
      act.timer = null;
    }
    const schedule = () => {
      act.timer = window.setTimeout(
        () => {
          // 拖拽/菜单/聊天开着不弹（别在操作中打扰）
          if (this.dragState.active || this.menuOpen || this.chatOpen) {
            schedule();
            return;
          }
          this.sayLifeLine(this.activity.name);
          schedule();
        },
        // 安静时段拉长间隔：深夜还按白天的频率自言自语，只会显得吵。
        // 听歌/看剧/聊天这三个场景主人一待就是很久，也想听它碎嘴 → 基础间隔缩短一半。
        S.lifeDelay(
          ACTIVITY_CHATTY.has(this.activity.name)
            ? 45000 + Math.random() * 45000
            : 90000 + Math.random() * 60000,
          new Date().getHours(),
        ),
      );
    };
    schedule();
  }

  /**
   * 生活化台词一句（shared/life.ts，零 API 零 token）——优先级从高到低：
   *   ① 久别重逢 / 求关注：好久没人理它（安静时段不主动撒娇，它都困了）；
   *   ② 当天早安：5–11 点、今天还没问过（一天只问候一次，不絮叨）；
   *   ③ 深夜犯困：安静时段用深夜池（它也没睡 / 困得睁不开眼）；
   *   ④ 当前活动状态池（原"主人在干什么"的台词）。
   * 与活动台词共用 setActivity 的定时器：一次调度、四路分流，不额外起定时器。
   */
  sayLifeLine(activityName) {
    if (!this.showWhisper) return;
    const now = Date.now();
    const hour = new Date().getHours();
    const day = new Date().toDateString();
    // ① 缺席：按"距上次互动"判定求关注/重逢（带节流：说过一次 10 分钟内不重复）
    const absence = S.absenceMoodOf(now - this.lastInteractionAt, hour);
    if (absence && now - this.lastAbsenceLineAt >= ABSENCE_LINE_GAP_MS) {
      this.lastAbsenceLineAt = now;
      this.showWhisper(S.absenceLineFor(absence), '', true);
      return;
    }
    // ② 早安（当天第一次开口；问完就记账，同一天不再絮叨）
    if (hour >= 5 && hour < 11 && this.greetedDay !== day) {
      this.greetedDay = day;
      this.showWhisper(S.morningLineFor(), '', true);
      return;
    }
    // ③ 深夜：安静时段只说深夜池（它也没睡 / 困得睁不开眼）
    if (S.isQuietHour(hour)) {
      this.showWhisper(S.nightLineFor(), '', true);
      return;
    }
    // ④ 活动状态池（原逻辑：主人在干什么就说什么）
    const pool = ACTIVITY_LINES[activityName];
    if (!pool || !pool.length) return;
    this.showWhisper(pool[Math.floor(Math.random() * pool.length)], '', true);
  }

  // ---- 右键菜单（统一自绘组件：树+渲染都来自 shared-core 的同一份 menu 模块） ----
  // 菜单/弹窗可视矩形（窗口局部坐标）= 窗口 ∩ 工作区（#41）：宠物贴屏幕底/右时窗口外扩余量
  // 伸出屏幕，窗口内固定定位的菜单/弹窗会走进被屏幕裁掉的部分。把菜单/弹窗约束到这个矩形内
  // 即可完整显示——**窗口和宠物零移动**，不存在跨进程位移竞态，也就不会瞬移闪帧。
  // 退化（可视区过小/窗口整体出屏，光标也点不到宠物）返回 null → 调用方按窗口视口兜底。
  visibleClampRect() {
    // pos 是视口相对坐标，窗口屏幕位置 = pos + VIEW 原点 − 外扩余量（见 sendBounds）；
    // 比较双方都用屏幕坐标（坐标系不混），返回的夹取矩形仍是窗口局部坐标。
    // 夹取用**宠物所在的那块屏**而不是外接矩形：外接矩形含空洞，按它夹菜单会伸进
    // 不属于任何显示器的区域（看不见）；菜单本来也不该跨屏显示。
    const area = S.resolveRect(WORK_AREAS, this.pos.x + this.halfW, this.pos.y + this.halfH);
    if (!area) return null;
    const winX = this.pos.x + VIEW.x - this.margin.l;
    const winY = this.pos.y + VIEW.y - this.margin.t;
    const winW = this.size + this.margin.l + this.margin.r;
    const winH = this.winH + this.margin.t + this.margin.b;
    const ax = area.x + VIEW.x;
    const ay = area.y + VIEW.y;
    const vx0 = Math.max(ax, winX);
    const vy0 = Math.max(ay, winY);
    const vx1 = Math.min(ax + area.width, winX + winW);
    const vy1 = Math.min(ay + area.height, winY + winH);
    const w = vx1 - vx0;
    const h = vy1 - vy0;
    if (w < 40 || h < 40) return null;
    return { x: vx0 - winX, y: vy0 - winY, w, h };
  }

  onContextMenu(e) {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged || this.menuOpen) return;
    e.preventDefault();
    this.stopThrow(); // 菜单弹出前停住飞行中的宠物
    this.stopMove(); // 菜单悬停期间宠物不漫游
    // 桌面专属工具根项（中转站设置 / 打开网站 / 查看余额 / 碎碎念 / 对话 / 回到初始位置 / 重载配置）+ 共享菜单树（动作→分类→具体动画）
    // 碎碎念/对话项无条件显示：手动触发不受 whisperEnabled 限制（该字段只影响自动周期轮询）
    // 「中转站设置」固定第一项：打开本地中转站面板（系统默认浏览器），放最前便于随时改配置
    // 首项文案随宿主形态变（OPEN_TARGET）：宿主是 DSH 桌面应用时点是"唤起桌面应用窗口"，仍叫「打开网站」会误导
    const tools = [
      { label: '中转站设置', action: 'relay-panel' },
      { label: OPEN_TARGET === 'desktop' ? '打开 DeepSeek Harness' : '打开网站', action: 'open-site' },
      { label: '躲到边上去', action: 'dock-edge' },
    ];
    if (this.pet.balanceEnabled) tools.push({ label: '查看余额', action: 'show-balance' });
    tools.push(
      // 当前状况：立刻采一次本机的 CPU/内存/电量/已工作多久并弹气泡（零 token，纯本地采集）
      { label: '当前状况', action: 'show-status' },
      { label: '碎碎念', action: 'whisper' },
      { label: '对话', action: 'chat' },
      { label: '回到初始位置', action: 'home' },
      // 显示位置（仅网页/仅桌面/两者/都不）：改这只宠物的 display 配置 + 宿主重载生效。
      // 与浏览器端注入的是**同一份**子菜单（shared 的 displayMenuBranch），两端文案/取值不会漂移。
      // 为什么不就地关窗/开窗：桌面宠物共用一个 Electron 进程，窗口是进程启动时按 DSH_PET_PETS
      // 一次性建的——就地增删窗口既改不了磁盘配置（下次启动又回来）也改不了窗口数量。
      S.displayMenuBranch(),
      // 改配置文件后免去回设置页点保存：请宿主重启桌面 Helper（全部桌面宠物窗口按最新配置重建）。
      // 放在最后：它是"重新加载"这类维护动作，与上面几个宠物互动项语义不同。
      { label: '重载配置', action: 'reload' },
    );
    // 表演（动作元形点播）：META_ACTIONS 平时只在待机随机触发，这里直接点播。
    // 含工作状态-*/余额-*/碎碎念-*/点击回应-* 等场景专属动画的编排（平时难得一见）。
    tools.push({
      label: '表演',
      children: META_ACTIONS.map((m) => ({ label: m.id, action: '表演:' + m.id })),
    });
    // 新作动画（FX 特效）：canvas 实时绘制的全新动态效果——素材库 106 个素材里没有这些，
    // 全部由代码逐帧画出来（爱心/音符/星光/彩虹/花朵/水波）。点播即看，3 秒后自动消失。
    tools.push({
      label: '新作动画',
      children: [
        { label: '爱心泡泡', action: '新作:heart' },
        { label: '音符舞', action: '新作:note' },
        { label: '星光环绕', action: '新作:sparkle' },
        { label: '彩虹尾巴', action: '新作:rainbow' },
        { label: '花朵绽放', action: '新作:flower' },
        { label: '水波涟漪', action: '新作:ripple' },
      ],
    });
    // 形象：整套换成别的角色素材（OUO 猫咪等，真实素材不是染色）。立即生效可来回切换，重启恢复小胖鱼。
    tools.push({
      label: '形象',
      children: SKINS.map((s) => ({ label: s.label, action: '形象:' + s.id })),
    });
    // 大小：实时缩放整只宠物（窗口/命中区/气泡字号都跟着 --pet-size 等比缩放）。
    // 选过一次后就记为"手动"，之后切形象不再自动改档。
    tools.push({
      label: '大小',
      children: SIZE_STEPS.map((s) => ({ label: s.label, action: '大小:' + s.scale })),
    });
    // 换装：CSS filter 实时染色整套动画（素材只有小胖鱼一套，染色模拟不同服装配色）。
    // 立即生效、可来回切换；重启恢复原装。
    tools.push({
      label: '换装',
      children: COSTUMES.map((c) => ({ label: c.id, action: '换装:' + c.id })),
    });
    const tree = tools.concat(S.buildMenuTree(this.animations));
    if (!tree.length) return;
    this.menuOpen = true;
    this.setInteractive(true); // 菜单是窗口内 DOM：悬停期间整窗保持可交互，关闭后恢复命中区穿透
    this.syncInputBusy();
    window.__dshPetDebug.menuOpen = true;
    const m = S.mountContextMenu({
      tree,
      x: e.clientX,
      y: e.clientY,
      // 只允许在「窗口 ∩ 工作区」内显示：宠物贴边时外扩余量伸出屏幕，菜单走进那里会被 OS 裁掉（#41）
      clamp: this.visibleClampRect(),
      onAction: (leaf) => this.onMenuAction(leaf),
      // 菜单被点外/Esc 关闭（非菜单项路径）：同样复位可交互标记，恢复命中区判定
      onClose: () => {
        this.menuOpen = false;
        window.__dshPetDebug.menuOpen = false;
        this.syncInputBusy();
        if (!this.inputBusy()) this.setInteractive(false);
      },
    });
    this.menuClose = m.close;
    this.syncInputRegions(); // mountContextMenu 完成布局后才能读取菜单矩形
  }

  onMenuAction(leaf) {
    this.closeMenu();
    if (!leaf || typeof leaf !== 'object') return;
    if (leaf.action && leaf.action.indexOf('表演:') === 0) {
      // 表演（动作元形点播）：立即开演指定元形（跳过冷却），演完自动回随机链
      this.playMetaAction(leaf.action.slice('表演:'.length), true);
      return;
    }
    if (leaf.action && leaf.action.indexOf('新作:') === 0) {
      // 新作动画（FX 特效）：canvas 实时绘制，素材库没有的全新动态效果
      this.fxRun(leaf.action.slice('新作:'.length));
      return;
    }
    if (leaf.action && leaf.action.indexOf('换装:') === 0) {
      // 换装：CSS filter 实时染色整套动画（立即生效，可来回切换）
      this.setCostume(leaf.action.slice('换装:'.length));
      return;
    }
    if (leaf.action && leaf.action.indexOf('形象:') === 0) {
      // 形象：整套切换真实角色素材（OUO 猫咪等，立即生效，可来回切换）
      this.setSkin(leaf.action.slice('形象:'.length));
      return;
    }
    if (leaf.action && leaf.action.indexOf('大小:') === 0) {
      // 大小：按比例缩放整只宠物（重算窗口/命中区/抛掷空间，立即生效）
      const sc = parseFloat(leaf.action.slice('大小:'.length));
      if (sc > 0) {
        this.sizeManual = true; // 手动选过 → 之后切形象不再自动改档
        this.applySize(sc);
      }
      return;
    }
    if (leaf.action === 'dock-edge') {
      // 躲到屏幕边上：停漫游/移动，吸附到当前屏工作区的右缘，半身藏起 + 沿边巡逻
      // （爬到顶 → 跳到底 → 再爬上去；rest 时懒懒趴着说俏皮话）
      this.leaveDock();
      this.userPlaced = false; // 用户主动命令趴窗 → 恢复自动跟随
      const area = S.resolveRect(WORK_AREAS, this.currentCenterX(), this.currentCenterY());
      this.enterDock('right', area || { x: 0, y: 0, width: VIEW.w, height: VIEW.h });
      return;
    }
    if (leaf.action === 'relay-panel') {
      // 中转站设置：系统默认浏览器打开本地面板（无条件，不走 OPEN_TARGET 分叉）
      if (window.petBridge && window.petBridge.openExternal) window.petBridge.openExternal('http://127.0.0.1:3081/');
      else window.open('http://127.0.0.1:3081/', '_blank');
      return;
    }
    if (leaf.action === 'open-site') {
      if (window.petBridge) window.petBridge.openDshSite(ORIGIN); // 系统默认浏览器打开（等效 Ctrl+点击链接）
      return;
    }
    if (leaf.action === 'show-balance') {
      this.showBalanceFromMenu(); // 立即拉余额并展示（无需等 1s 触发轮询，展示路径与周期触发一致）
      return;
    }
    if (leaf.action === 'show-status') {
      this.showStatusFromMenu(); // 立即采一次本机状况并展示（手动：状况没变也播报）
      return;
    }
    if (leaf.action === 'whisper') {
      this.showWhisperFromMenu(); // 立即让 host 强制新生成一句并展示（绕过节流；展示路径与周期触发一致）
      return;
    }
    if (leaf.action === 'chat') {
      this.showChatFromMenu(); // 打开对话弹窗（记忆经 host /chat 读写，浏览器/桌面同一实例共享）
      return;
    }
    if (leaf.action === 'home') {
      this.goHome(); // 停漫游/移动，清会话位置，回配置角落
      this.userPlaced = false; // 回到初始点后继续默认行为（识别到窗口就自己走过去趴）
      return;
    }
    if (leaf.action === 'set-display') {
      this.setPetDisplay(leaf.display); // 改这只宠物的显示位置：写 display 配置，由宿主重载生效
      return;
    }
    if (leaf.action === 'reload') {
      this.reloadDesktop(); // 请宿主重启桌面 Helper：全部桌面宠物窗口按最新配置重建
      return;
    }
    if (!leaf.anim) return;
    // 文字类（noMirror）朝右站姿是镜像的：点播前强制朝左，避免文字镜像（与浏览器随机链"朝右不选文字"同语义）
    if (S.isNoMirrorAnimation(this.animations.categories, leaf.anim) && this.facing === 'right') {
      this.facing = 'left';
    }
    // 点播移动动画：走真实移动（与随机游走同一套：边界检查 / 随机距离 / leadSec·tailSec / dir），
    // 仅"选哪个动画"由菜单决定；挪不动（false）退化纯播放
    if (this.animations.moves.actions.some((a) => a.name === leaf.anim)) {
      if (this.tryMove(leaf.anim) === false) this.playOnce(leaf.anim);
      return;
    }
    this.playOnce(leaf.anim);
  }

  // ---- 趴窗/贴边巡逻（半身藏 + 沿边爬/跳/趴，动作自然不呆板）----
  // 触发：①松手时把宠物放到前台应用窗口边上（tryEnterDock 自动吸附）；
  //       ②右键菜单「躲到边上去」（贴屏幕边）。
  // 巡逻循环：爬到顶 → 休息趴着说俏皮话 → 像跳绳一样跳到底 → 再爬上来；
  // 每两个来回换一条边（竖边↔顶/底边），让动作有变化。

  /** 吸附：把宠物身体中心放到 rect 的 edge 边界线上（一半在界内可见、一半藏在界外），
   *   朝向屏幕内（趴在窗口边上往里看）。edge: left/right/top/bottom */
  dockSnap(edge) {
    const r = this.dock.rect;
    if (!r) return;
    let cx = this.currentCenterX();
    let cy = this.currentCenterY();
    if (edge === 'left') cx = r.x;
    else if (edge === 'right') cx = r.x + r.width;
    else cx = Math.min(Math.max(cx, r.x + this.halfW * 0.5), r.x + r.width - this.halfW * 0.5);
    if (edge === 'top') cy = r.y;
    else if (edge === 'bottom') cy = r.y + r.height;
    else cy = Math.min(Math.max(cy, r.y + this.halfH * 0.5), r.y + r.height - this.halfH * 0.5);
    if (edge === 'right') this.facing = 'left';
    else if (edge === 'left') this.facing = 'right';
    this.dockPlace(cx, cy);
  }

  /** 把身体中心放到 (cx, cy)（写 customPos 并重摆窗口） */
  dockPlace(cx, cy) {
    this.customPos = { rx: cx / VIEW.w, ry: cy / VIEW.h };
    this.position();
  }

  /** 一段巡逻的终点：竖边爬到顶/跳到底；顶底边横向爬，方向随机 */
  patrolTarget(edge) {
    const r = this.dock.rect;
    const cx = this.currentCenterX();
    const cy = this.currentCenterY();
    if (!r) return { x: cx, y: cy };
    if (edge === 'right' || edge === 'left') {
      // 竖边：上一段是爬 → 这一段跳；上一段是跳 → 这一段爬（跳绳式交替）
      const goingUp = this.dock.phase !== 'jump';
      this.dock.phase = goingUp ? 'climb' : 'jump';
      return {
        x: cx,
        y: goingUp ? r.y + this.halfH * 0.45 : r.y + r.height - this.halfH * 0.45,
      };
    }
    const goingRight = Math.random() < 0.5;
    this.facing = goingRight ? 'right' : 'left'; // 顶/底边横爬也要朝着爬的方向，别背对
    return {
      x: goingRight ? r.x + r.width - this.halfW * 0.45 : r.x + this.halfW * 0.45,
      y: cy,
    };
  }

  /** 巡逻动画：爬/跳用 move 动画（loop），休息用 idle（loop）——只在需要时切换 */
  patrolAnim(kind) {
    const d = this.dock;
    const want = kind === 'idle' ? 'idle' : 'move';
    if (d.lastAnim === want) return;
    d.lastAnim = want;
    const { animations } = { animations: this.animations };
    if (want === 'idle' && animations.idle.length) {
      this.switchTo(S.pick(animations.idle, this.anim), false);
    } else {
      const moves = animations.moves && animations.moves.actions ? animations.moves.actions : [];
      if (moves.length) this.switchTo(moves[Math.floor(Math.random() * moves.length)].name, false);
    }
  }

  /** 进入趴窗/贴边：停漫游/抛掷 → 吸附到边 → 开始巡逻。
   *  rect 缺省 = 前台窗口矩形（探针推来）；菜单「躲到边上去」传 null 用当前屏工作区 */
  enterDock(edge, rect) {
    this.stopMove();
    this.stopThrow();
    this.stopDragFollow();
    const d = this.dock;
    d.patrolToken++;
    if (d.patrolRef !== null) {
      cancelAnimationFrame(d.patrolRef);
      d.patrolRef = null;
    }
    // 巡逻边界：优先传入的矩形；没有则用最近一次前台窗口矩形；再没有用当前屏工作区
    let box = rect || this.targetRect;
    let winDock = !!rect || this.targetRect !== null;
    if (!box) {
      const area = S.resolveRect(WORK_AREAS, this.currentCenterX(), this.currentCenterY());
      box = area || { x: 0, y: 0, width: VIEW.w, height: VIEW.h };
      winDock = false;
    }
    d.rect = { x: box.x, y: box.y, width: box.width, height: box.height, winDock: winDock };
    d.edge = edge || 'right';
    d.phase = 'climb';
    d.restUntil = 0;
    d.edgeFlip = 0;
    d.lastAnim = '';
    d.active = true;
    this.dockSnap(d.edge);
    // 顶/底边：趴上去先好好趴一会儿（长休息 + 趴姿），不急着爬——"躺在最顶端 / 趴在最下面"；
    // 竖边：首段直接定好，从吸附位置爬向边的一端（吸附后趴一下再动，动作自然）
    if (d.edge === 'top' || d.edge === 'bottom') {
      d.phase = 'rest';
      d.restUntil = performance.now() + 15000 + Math.random() * 10000;
      if (Math.random() < 0.7) this.sayPerchLine(d.edge); // 趴上去先报个到："躺这儿晒晒太阳～"
    } else {
      d.phase = 'climb';
      d.from = { x: this.currentCenterX(), y: this.currentCenterY() };
      d.to = this.patrolTarget(d.edge);
    }
    this.patrolLoop();
  }

  /** 退出趴窗/贴边（拖拽抓起 / 菜单 home / 销毁时）：停巡逻，位置保持不动 */
  leaveDock() {
    const d = this.dock;
    if (!d.active) return;
    d.active = false;
    d.patrolToken++;
    if (d.patrolRef !== null) {
      cancelAnimationFrame(d.patrolRef);
      d.patrolRef = null;
    }
    d.phase = 'rest';
    d.lastAnim = '';
    this.clearPose(); // 离开趴窗：恢复正常站姿（倒挂/缩团等姿势变换一并清掉）
  }

  /** 点击时短暂停一下：趴在原地回个话，之后自动续爬（不打断趴窗状态） */
  pauseDock(ms) {
    const d = this.dock;
    if (!d.active) return;
    d.patrolToken++;
    if (d.patrolRef !== null) {
      cancelAnimationFrame(d.patrolRef);
      d.patrolRef = null;
    }
    d.phase = 'rest';
    d.restUntil = performance.now() + ms;
    const token = d.patrolToken;
    setTimeout(() => {
      if (this.dock.active && this.dock.patrolToken === token && this.dock.patrolRef === null) this.patrolLoop();
    }, ms);
  }

  /** 巡逻主循环（rAF）：爬/跳逐帧移动窗口；到点休息趴着，随机说俏皮话 */
  patrolLoop() {
    const d = this.dock;
    if (!d.active) return;
    const token = d.patrolToken;
    const r = d.rect;
    if (!r) return;
    let last = performance.now();
    const step = (now) => {
      if (!this.dock.active || this.dock.patrolToken !== token) return;
      const dt = Math.min((now - last) / 1000, 0.12);
      last = now;
      // 休息：停住趴着，随机说俏皮话；时间到 → 定下一段继续爬/跳
      if (d.phase === 'rest') {
        const perched = d.edge === 'top' || d.edge === 'bottom';
        if (perched) {
          // 趴在顶/底：播放「原地小憩沉眠」——真实的趴着/蜷着睡觉姿势（loop 一直趴睡），
          // 而不是站着待机。动画切换时机由 lastAnim 管理，离开趴姿切回移动/待机时自动恢复。
          if (d.lastAnim !== 'perch') {
            d.lastAnim = 'perch';
            this.switchTo('原地小憩沉眠', false);
          }
        } else {
          // 竖边休息：不再只是站着待机——随机换成趴睡/伸懒腰/打哈欠/敲桌/玩魔方等小动作歇一会儿，
          // 每段休息换一个（同段内 loop 保持），离开切回移动时自动恢复
          if (d.lastAnim !== 'sideRest') {
            d.lastAnim = 'sideRest';
            const sideIdle = [
              '原地小憩沉眠', '超大伸懒腰', '哈欠连天', '原地敲击桌面互动',
              '待机呼吸休闲', '原地专心玩魔方', '原地蹲下玩玩具汽车',
              '悠闲哼歌', '小幅度原地360度旋转展示', '用鲸鱼尾巴拍打地面'
            ];
            this.switchTo(sideIdle[Math.floor(Math.random() * sideIdle.length)], false);
          }
        }
        if (now < d.restUntil) {
          d.patrolRef = requestAnimationFrame(step);
          return;
        }
        d.edgeFlip++;
        // 每完成两个来回换一条边（竖边 ↔ 顶/底边），动作不呆板；顶/底换边时少去左侧
        if (d.edgeFlip % 2 === 0 && d.edgeFlip > 0) {
          const edges = d.edge === 'right' || d.edge === 'left' ? ['top', 'bottom'] : ['right', 'right', 'left'];
          const next = edges[Math.floor(Math.random() * edges.length)];
          d.edge = next;
          this.dockSnap(next);
          d.phase = 'climb';
          // 换到顶/底：趴上去先好好趴一会儿（长休息 + 趴姿），不急着爬
          if (next === 'top' || next === 'bottom') {
            d.phase = 'rest';
            d.restUntil = now + 15000 + Math.random() * 10000;
            if (Math.random() < 0.6) this.sayPerchLine(next);
            d.patrolRef = requestAnimationFrame(step);
            return;
          }
        }
        d.from = { x: this.currentCenterX(), y: this.currentCenterY() };
        d.to = this.patrolTarget(d.edge);
        this.clearPose(); // 离开趴姿去爬/跳：恢复正常站姿
        if (Math.random() < 0.3) this.sayCatchLine(); // 休息时也偶尔俏皮一句
        this.patrolAnim('move');
        d.patrolRef = requestAnimationFrame(step);
        return;
      }
      // 爬/跳：朝终点移动（爬慢、跳快），到达 → 转休息
      const from = d.from;
      const to = d.to;
      const speed = d.phase === 'jump' ? this.size * 3.4 : this.size * 0.5;
      if (!from || !to) {
        d.phase = 'rest';
        d.restUntil = now + 800;
        d.patrolRef = requestAnimationFrame(step);
        return;
      }
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.hypot(dx, dy);
      let x = this.pos.x + this.halfW;
      let y = this.pos.y + this.halfH;
      const traveled = Math.hypot(x - from.x, y - from.y);
      if (dist <= 1 || traveled >= dist) {
        this.dockPlace(to.x, to.y);
        d.phase = 'rest';
        // 顶/底边到点：长趴（躺在顶/趴底）；竖边到点：歇久一点（玩小动作/趴睡），不再一直爬跳
        const perched = d.edge === 'top' || d.edge === 'bottom';
        d.restUntil = now + (perched ? 15000 + Math.random() * 10000 : 4000 + Math.random() * 5000);
        if (perched) {
          if (Math.random() < 0.6) this.sayPerchLine(d.edge); // 趴在顶/底说一句专属台词
        } else if (Math.random() < 0.35) {
          this.sayCatchLine(); // 爬到顶/跳到底，趴着说一句
        }
        // 休息动画由 rest 分支统一切换（顶/底=趴睡，竖边=随机小动作），这里不切，避免闪一下
      } else {
        const u = Math.min(traveled + speed * dt, dist) / dist;
        this.dockPlace(from.x + dx * u, from.y + dy * u);
        this.patrolAnim('move');
      }
      d.patrolRef = requestAnimationFrame(step);
    };
    d.patrolRef = requestAnimationFrame(step);
  }

  /** 自然走到前台窗口边（识别到窗口后不瞬移，走过去/爬过去）：
   *  随机挑一条边（顶 30% 躺着 / 底 30% 趴着 / 左 20% / 右 20%），
   *  用散步速度（≈1.2×身体大小每秒）直线走过去（move 动画 loop，面向目标），
   *  到达后吸附到边线（半身藏）、开始沿边巡逻。已经离得很近就直接吸附。
   *  打断：拖拽抓起 / 点击互动 / 菜单 / 对话。 */
  walkToWindow() {
    if (!this.targetRect) return;
    // 用户刚用鼠标放过它（90 秒内）：尊重放置位置，不强制拉回窗口；超时后恢复自然习惯，
    // 自己找当前窗口走过去趴（陪伴感：你忙你的，它自己找地方待着）
    if (this.userPlaced && performance.now() - this.userPlacedAt < 90000) return;
    if (this.dock.active || this.dragState.active || this.menuOpen || this.chatOpen) return;
    if (this.throwRef !== null) return; // 抛掷中是用户甩的，不打断，让它飞完
    this.stopWalk(); // 有旧的在走 → 窗口又变了，重新规划
    this.stopMove(); // 漫游中切了窗口 → 停掉漫游改道走过去
    const r = this.targetRect;
    // 选边（加权：顶/底更常去趴着歇，左右竖边少去，不一直贴着窗口左侧）
    const edges = ['top', 'bottom', 'top', 'bottom', 'top', 'bottom', 'left', 'right'];
    let edge = edges[Math.floor(Math.random() * edges.length)];
    if (edge === this.lastWalkEdge && Math.random() < 0.75) {
      edge = edges[Math.floor(Math.random() * edges.length)];
    }
    this.lastWalkEdge = edge;
    // 目标点：沿边线的位置随机一点（不要每次都趴正中间）
    let tx;
    let ty;
    if (edge === 'left') {
      tx = r.x;
      ty = r.y + r.height * (0.25 + Math.random() * 0.5);
    } else if (edge === 'right') {
      tx = r.x + r.width;
      ty = r.y + r.height * (0.25 + Math.random() * 0.5);
    } else if (edge === 'top') {
      tx = r.x + r.width * (0.15 + Math.random() * 0.7);
      ty = r.y;
    } else {
      tx = r.x + r.width * (0.15 + Math.random() * 0.7);
      ty = r.y + r.height;
    }
    const cx = this.currentCenterX();
    const cy = this.currentCenterY();
    // 目标窗口在别的屏（超出本宠物窗口的视口）→ 不扑过去，让那个屏的宠物去
    if (tx < -this.halfW || tx > VIEW.w + this.halfW || ty < -this.halfH || ty > VIEW.h + this.halfH) return;
    const dist = Math.hypot(tx - cx, ty - cy);
    // 只有已经紧贴窗边（不到 1/3 身长）才直接吸附；稍远一律走过去，保证有过渡动画
    const closeEnough = this.size * 0.3;
    if (dist < closeEnough) {
      // 已经在边上：直接吸附趴下，不用走
      this.enterDock(edge, r);
      return;
    }
    // 走过去：面向目标 + move 动画 loop + 散步匀速（不急不冲，接近时减速缓停）
    this.facing = tx < cx ? 'left' : 'right';
    const moves = this.animations.moves && this.animations.moves.actions ? this.animations.moves.actions : [];
    if (moves.length) this.switchTo(moves[Math.floor(Math.random() * moves.length)].name, false);
    const token = ++this.walkToken;
    const walkSpeed = this.size * 0.95;
    let last = performance.now();
    const step = (now) => {
      if (this.walkToken !== token) return;
      if (this.dragState.active || this.menuOpen || this.chatOpen) {
        this.walkRef = null;
        return;
      }
      const dt = Math.min((now - last) / 1000, 0.12);
      last = now;
      const x = this.currentCenterX();
      const y = this.currentCenterY();
      const d = Math.hypot(tx - x, ty - y);
      if (d <= walkSpeed * dt * 1.6) {
        // 到达：停走路，吸附趴窗开始巡逻（用最新窗口矩形，防途中窗口动过）
        this.walkRef = null;
        this.enterDock(edge, this.targetRect || r);
        return;
      }
      // 接近最后一段减速，落位自然不冲
      const spd = d < this.size * 2 ? walkSpeed * 0.5 : walkSpeed;
      this.dockPlace(x + ((tx - x) / d) * spd * dt, y + ((ty - y) / d) * spd * dt);
      this.walkRef = requestAnimationFrame(step);
    };
    this.walkRef = requestAnimationFrame(step);
  }

  /** 松手吸附：把宠物放到前台应用窗口边上 → 自动半身藏起来、趴在窗口上玩。
   *  探针不可用（无前台窗口矩形）时返回 false，不打扰正常停靠 */
  tryEnterDock() {    if (!this.targetRect) return false;
    const cx = this.currentCenterX();
    const cy = this.currentCenterY();
    const r = this.targetRect;
    // 只有真正紧贴窗口边（不到半个身长）才吸附趴窗；放远一点就留在放置位置，不被吸回去
    const th = Math.max(this.size * 0.45, this.halfW * 0.6);
    const dl = Math.abs(cx - r.x);
    const dr = Math.abs(cx - (r.x + r.width));
    const dt = Math.abs(cy - r.y);
    const db = Math.abs(cy - (r.y + r.height));
    let best = null;
    if (dl < th) best = ['left', dl];
    if (dr < th && (!best || dr < best[1])) best = ['right', dr];
    if (dt < th && (!best || dt < best[1])) best = ['top', dt];
    if (db < th && (!best || db < best[1])) best = ['bottom', db];
    if (!best) return false;
    this.enterDock(best[0], r);
    return true;
  }

  closeMenu() {
    if (this.menuClose) {
      this.menuClose();
      this.menuClose = null;
    }
    this.menuOpen = false;
    window.__dshPetDebug.menuOpen = false;
    this.syncInputBusy(); // 菜单关：若没有别的占用（拖拽/弹窗）则交还常规判定
    if (!this.inputBusy()) this.setInteractive(false);
  }

  // 「查看余额」菜单：POST 动作让 host 刷新余额（写进 S），随即**立刻跑一拍 /state** 拿结果展示
  // （0 延迟，不用等下一个 1s；展示走 showBalanceNow/showBalanceNotice 同一路径）。
  // 注意这里不再直接拉余额：数据只有一个出口（S），菜单只负责"让它刷新"。
  showBalanceFromMenu() {
    if (!this.pet.balanceEnabled) return;
    S.postAction(BALANCE_URL)
      .then((ok) => {
        if (!ok) console.warn('[dsh-pet] 菜单查看余额：刷新动作未成功');
        pollStateNow(); // 立即拉一拍：结果 0 延迟可见（失败也会由 /state 里的 ok:false 弹文字说明）
      })
      .catch((e) => {
        console.error('[dsh-pet] 菜单查看余额异常', e);
      });
  }

  // 「当前状况」菜单：POST 动作让 host 立刻采一次本机状况（写进 S，标 manual=状况没变也播报），
  // 随即立刻跑一拍 /state 拿结果展示（0 延迟）。与「查看余额」同一套：菜单只负责"让它刷新"。
  showStatusFromMenu() {
    S.postAction(STATUS_URL)
      .then((ok) => {
        if (!ok) console.warn('[dsh-pet] 菜单当前状况：采集动作未成功');
        pollStateNow();
      })
      .catch((e) => {
        console.warn('[dsh-pet] 菜单当前状况异常', e);
      });
  }

  // 「碎碎念」菜单：POST 动作让 host 立即新生成一句（写进 S），随即立刻跑一拍 /state 拿文本展示
  // （0 延迟，不用等下一个 1s）。动作不回文本——文本只有一个出口（S）。
  // 手动触发不受 whisperEnabled 限制——该字段只关自动周期，手动永远可用。
  showWhisperFromMenu() {
    S.postAction(WHISPER_URL + '?pet=' + encodeURIComponent(this.pet.id))
      .then((ok) => {
        if (!ok) console.warn('[dsh-pet] 菜单碎碎念：生成动作未成功 pet=' + this.pet.id);
        pollStateNow(); // 立即拉一拍：文本随这一拍到达并展示
      })
      .catch((e) => {
        console.warn('[dsh-pet] 菜单碎碎念异常', e);
      });
  }

  // 「对话」菜单：最简输入框（shared 组件，与浏览器同一份）——回车发送后弹窗消失，
  // 回复用**碎碎念同款显示**（说话动画 + 白色气泡 10s），只多一步用户输入。
  // 记忆经 host /chat 读写（memory.json，同一实例的浏览器/桌面共享同一份）。
  // 弹窗跟随宠物：基准是**身体命中区** this.hit（与气泡同一定位源——桌宠在视频中间，
  // 视频框右上角 ≠ 宠物右上角），取身体右上角，超出视口自动夹回（窗口右侧外扩区容纳）；
  // 弹窗是窗口内 DOM，期间整窗保持可交互（可点输入框），关闭后恢复命中区穿透。
  showChatFromMenu() {
    if (this.chatClose) {
      this.chatClose();
      this.chatClose = null;
      return; // 已开着：先关旧的
    }
    const m = S.mountChatDialog({
      petId: this.pet.id,
      baseUrl: BASE + '/chat',
      x: Math.max(4, this.hit.getBoundingClientRect().right + 6),
      y: Math.max(4, this.hit.getBoundingClientRect().top + 6),
      // 弹窗同菜单：只允许在「窗口 ∩ 工作区」内显示，贴边时不被屏幕裁掉（#41）
      clamp: this.visibleClampRect(),
      onSent: () => {
        // 发送成功：回复已写进 S，立刻跑一拍 /state 让气泡 0 延迟出现（不必等下一个 1s）
        console.info('[dsh-pet] 对话已发送 pet=' + this.pet.id);
        pollStateNow();
      },
      onClose: () => {
        this.chatClose = null;
        this.chatOpen = false;
        window.__dshPetDebug.chatOpen = false;
        this.syncInputBusy(); // 弹窗关：交还常规判定（菜单还开着的话仍保持忙，见 inputBusy）
        if (!this.menuOpen) this.setInteractive(false); // 弹窗关了且无菜单：恢复命中区穿透
      },
    });
    this.chatClose = m.close;
    this.chatOpen = true; // 穿透守卫：弹窗期间整窗保持可交互，光标移到输入框不被翻回穿透
    window.__dshPetDebug.chatOpen = true;
    this.syncInputBusy();
    this.setInteractive(true);
  }

  // 「回到初始位置」菜单：停掉漫游/移动，清掉拖拽/漫游留下的会话位置，回到配置角落
  goHome() {
    this.stopThrow();
    this.stopMove();
    this.customPos = null;
    this.position();
  }

  // 「重载配置」菜单：请宿主重启桌面 Helper —— 与设置页「保存」**同一条**重启路径
  // （宿主 POST /reload → syncDesktop：串行队列 + 等旧进程真正退出再起新的）。
  // 为什么不在渲染端就地重拉配置：① 每只宠物一个窗口是宿主按 DSH_PET_PETS 建的，
  // 就地重拉改不了宠物数量/display/size；② 本页的余额/工作状态等全局轮询是一次性启动的
  // （events.js 的 loopsStarted 门控），就地重建 sprite 会漏启新循环或留下旧定时器。
  // 本请求由**即将被重启的这个进程**发出：响应可能永远不回（宿主杀进程时回调地址已失效），
  // 故不 await、不重试，失败只记日志——重载本身就是把本进程换掉。
  reloadDesktop() {
    fetch(BASE + '/reload', { method: 'POST' }).catch((e) => {
      console.warn('[dsh-pet] 重载配置请求失败（宿主不可达？）', e);
    });
  }

  // 「显示位置」菜单：改**这一只**宠物的 display（仅网页/仅桌面/两者/都不）—— 写它自己的配置，
  // 再由宿主重载生效。取值直接来自菜单项（shared 的 displayMenuBranch），渲染端不做任何推导：
  // 当前状态以配置为准，推导只会多一处可能与真相不符的猜测（旧实现的 both→web 就是这种猜测）。
  // 为什么不在渲染端就地关窗/开窗：桌面宠物共用一个 Electron 进程，窗口是进程启动时按 DSH_PET_PETS
  // 一次性建的——就地增删窗口既改不了磁盘配置（宿主下次重载它又回来），也改不了窗口数量。
  // 与 reloadDesktop 同一处境：选"仅网页/都不"时本进程就会在重载中被换掉，响应可能永远不回
  // （宿主杀进程时回调地址已失效），故不 await、不重试，失败只记日志。
  setPetDisplay(display) {
    if (!display) return;
    fetch(BASE + '/pet-display', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: this.pet.id, display }),
    }).catch((e) => {
      console.warn('[dsh-pet] 显示位置请求失败（宿主不可达？）', e);
    });
  }

  renderBubble() {
    // 气泡单槽：同一时刻只显示一个（优先级：终态任务 > 碎碎念/对话 > 余额 > 非终态任务）。
    // 为什么终态任务不让位：完成/失败气泡只活 10s，被事件顶掉就彻底看不到了；非终态任务气泡
    // 常驻（不设自动收起），让位 10s 零损失。与浏览器 src/client/pet.ts 的单槽优先级同一套。
    // 工作气泡与碎碎念同款弹窗样式：宽度自适应 + 自动换行（is-whisper：正常 white-space、宽随内容）
    // 配图标记交给 CSS：带图时取消 min-width（样式在 shared 的 MEME_BUBBLE_CSS，两端同一份）。
    // 图片 URL 与视频同规则：传 BASE 前缀（桌面是 file:// 页面，必须绝对地址）
    // 素材根同理（配图的归属与动画一致：pet/<素材根>-memes/ 独占 → 用户目录 → 包内）
    const workOn = !!(this.workOn && this.workText);
    const whisperOn = !!(this.whisperOn && this.whisperView);
    const balanceOn = !!(this.bubbleOn && this.balanceView);
    const statusOn = !!(this.statusOn && this.statusView && this.statusView.length > 0);
    const workTerminal = this.workState === 'success' || this.workState === 'error';
    // 优先级：终态任务 > 碎碎念/对话 > 当前状况 > 余额 > 非终态任务
    // （当前状况排在余额之前：它是"当下"的即时信息，手动点菜单一定看得见，与浏览器同一套）
    const slot =
      workTerminal && workOn
        ? 'work'
        : whisperOn
          ? 'whisper'
          : statusOn
            ? 'status'
            : balanceOn
              ? 'balance'
              : workOn
                ? 'work'
                : 'none';
    // 配图取自 assets/memes（小胖鱼/鲸鱼那一套表情包）。切了别的形象再配一张鱼图很出戏，
    // 所以非 main 形象一律不配图，只留文字气泡——保证气泡内容与当前形象一致。
    const whisperImg =
      slot === 'whisper' && this.skin === 'main'
        ? S.createMemeImage(this.whisperImage, BASE, this.assetRoot)
        : null;
    this.bubble.classList.toggle(
      'is-whisper',
      // 余额「文字说明」（不可用状态）同样要换行变体：默认 nowrap 会把长文案顶出宠物宽度
      // 当前状况天然是多行（CPU/内存/电量各一行），同样要换行变体
      slot === 'whisper' || slot === 'work' || slot === 'status' || (slot === 'balance' && this.balanceWrap),
    );
    this.bubble.classList.toggle(S.MEME_BUBBLE_CLASS, !!whisperImg);
    if (slot === 'none') {
      // 三者都没有可显示的内容：隐藏（不占位，也就不会挡住任何一层）
      this.bubble.classList.remove('is-on');
      window.__dshPetDebug.lastBubbleTitle = '';
      return;
    }
    this.bubble.innerHTML = '';
    if (slot === 'work') {
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.workText;
      this.bubble.appendChild(line);
    } else if (slot === 'whisper') {
      // 配图（shared 生成的 <img> + 共用样式）：先看图再读话，符合"配图"的阅读顺序
      if (whisperImg) this.bubble.appendChild(whisperImg);
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.whisperView[0]?.text ?? '';
      this.bubble.appendChild(line);
    } else {
      // 余额与当前状况共用同一套行渲染（role: label/sub/error/tier → 类名与配色）
      const rows = slot === 'status' ? this.statusView : this.balanceView;
      const hasTier = rows.some((r) => r.role === 'tier');
      if (hasTier) {
        // deepseek 余额单行：余额（峰/谷）¥x — 档位字着色
        const line = document.createElement('div');
        line.className = 'pet-bub-row';
        for (const r of rows) {
          const span = document.createElement('span');
          if (r.role === 'tier') span.className = 'pet-bub-tier pet-bub-tier-' + r.tier;
          span.textContent = r.text;
          line.appendChild(span);
        }
        this.bubble.appendChild(line);
      } else {
        for (const r of rows) {
          const div = document.createElement('div');
          if (r.role === 'error') div.className = 'pet-bub-err';
          else if (r.role === 'sub') div.className = 'pet-bub-row pet-bub-sub';
          else div.className = 'pet-bub-row';
          div.textContent = r.text;
          this.bubble.appendChild(div);
        }
      }
    }
    this.bubble.classList.add('is-on');
    window.__dshPetDebug.lastBubbleTitle = this.bubble.textContent.slice(0, 60);
  }
}
