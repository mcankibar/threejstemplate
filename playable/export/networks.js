// Packaging profiles. Runtime behavior lives in playable/kit/networks.js.
// Google App campaigns and TikTok SDK references checked 2026-09-25:
// https://support.google.com/google-ads/answer/9981650?hl=en
// https://ads.tiktok.com/resources/help/article/playable-ads?lang=en
// Other profiles retain inherited packaging rules and require network-device QA.
// container: "zip" or a single HTML; maxMb is enforced on final package bytes (MiB).
// beforeGame: SDK script inserted before the game; head: tags inserted in the head.
// assetFiles: externalize declared assets inside the ZIP; inline:false: separate game JS.

export const NETWORK_PROFILE_VERSION = 1;

const MINTEGRAL_HEAD = `<script>window.__PL_HOST_STARTED__=false;function gameStart(){window.__PL_HOST_STARTED__=true;window.dispatchEvent(new Event("pl:host-start"))}function gameClose(){window.__PL_HOST_STARTED__=false;window.dispatchEvent(new Event("pl:host-close"))}</script>`;

// AppGrowth DAPI shim, as shipped by @common-packages/ad-network-settings.
const APPGROWTH_HEAD = `<script>var dapi={},dapiData={screenSize:{width:window.innerWidth,height:window.innerHeight},state:"loading",isViewable:!1},listenersPool={};dapi.addEventListener=function(e,i){listenersPool.hasOwnProperty(e)?listenersPool[e].push(i):listenersPool[e]=[i],"viewableChange"===e&&dapi.sendEvent("adLoaded")},dapi.removeEventListener=function(i,a){listenersPool.hasOwnProperty(i)&&listenersPool[i].forEach(function(e){e.toString()===a.toString()&&delete listenersPool[i]})},dapi.isSingle=function(){return window.self===window.top};var dapiEvents={ready:"ready",viewableChange:"viewableChange",adResized:"adResized"};dapi.openStoreUrl=function(){dapi.sendEvent("openStoreUrl"),dapi.isSingle()&&console.log("ad clicked")},dapi.triggerEvent=function(e,i){listenersPool.hasOwnProperty(e)&&listenersPool[e].forEach(function(e){e(i)})},dapi.getScreenSize=function(){return dapi.isSingle()&&dapi.updateSize(),dapiData.screenSize},dapi.updateSize=function(){var e=document.documentElement.clientWidth,i=document.documentElement.clientHeight;e!==i&&0!==e&&0!==i||(e=window.innerWidth,i=window.innerHeight),dapiData.screenSize.width=e,dapiData.screenSize.height=i},dapi.getAudioVolume=function(){return dapiData.isViewable?1:0},dapi.sendEvent=function(e,i){dapi.isSingle()||(i?window.parent.postMessage(JSON.stringify({name:e,value:i}),"*"):window.parent.postMessage(JSON.stringify({name:e}),"*"))},dapi.isViewable=function(){return dapi.isSingle()||dapiData.isViewable},dapi.isReady=function(){return dapi.isSingle()||dapiData.state===dapiEvents.ready},window.addEventListener("message",function(e){var i={name:"default"};try{i=JSON.parse(e.data)}catch(e){}switch(i.name){case dapiEvents.ready:dapiData.state=dapiEvents.ready,dapi.triggerEvent(dapiEvents.ready);break;case dapiEvents.adResized:dapiData.screenSize.width=i.value.width,dapiData.screenSize.height=i.value.height,dapi.triggerEvent(dapiEvents.adResized);break;case dapiEvents.viewableChange:dapiData.isViewable=i.value,dapi.triggerEvent(dapiEvents.viewableChange,{isViewable:!!i.value})}}),dapi.sendEvent("dapiInited");</script>
<script>
function getScript(e, i) { var n = document.createElement("script"); n.type = "text/javascript", n.async = !0, i && (n.onload = i), n.src = e, document.head.appendChild(n) }
function parseMessage(e) { var i = e.data; if (typeof i.indexOf === "function") { var n = i.indexOf(DOLLAR_PREFIX + RECEIVE_MSG_PREFIX); } if (-1 !== n) { if (typeof i.slice === "function") { var t = i.slice(n + 2); } return getMessageParams(t) } return {} }
function getMessageParams(e) { var i, n = []; if (!(typeof e === "undefined")) { var t = e.split("/"); var a = t.length; if (-1 === e.indexOf(RECEIVE_MSG_PREFIX)) { if (a >= 2 && a % 2 === 0) for (i = 0; a > i; i += 2) n[t[i]] = t.length < i + 1 ? null : decodeURIComponent(t[i + 1]) } else { var o = e.split(RECEIVE_MSG_PREFIX); void 0 !== o[1] && (n = JSON && JSON.parse(o[1])) } } return n }
function getDapi(e) { var i = parseMessage(e); if (!i || i.name === GET_DAPI_URL_MSG_NAME) { var n = i.data; getScript(n, onDapiReceived) } }
function invokeDapiListeners() { for (var e in dapiEventsPool) dapiEventsPool.hasOwnProperty(e) && dapi.addEventListener(e, dapiEventsPool[e]) }
function onDapiReceived() { dapi = window.dapi, window.removeEventListener("message", getDapi), invokeDapiListeners() }
var DOLLAR_PREFIX = "$$", RECEIVE_MSG_PREFIX = "DAPI_SERVICE:", SEND_MSG_PREFIX = "DAPI_AD:", GET_DAPI_URL_MSG_NAME = "connection.getDapiUrl", dapiEventsPool = {}, dapi = window.dapi || undefined;
</script>`;

// Runtime behavior belongs in kit/networks.js; never rewrite bundled JavaScript.

export const EXPORT_NETWORKS = {
  default: { maxMb: 5 },
  applovin: { maxMb: 5 },
  ironsource: { maxMb: 5 },
  smadex: { maxMb: 5 },
  unity: { head: '<script src="mraid.js"></script>', maxMb: 5 },
  mintegral: { head: MINTEGRAL_HEAD, htmlName: "mintegral.html", maxMb: 5 },
  appgrowth: { head: APPGROWTH_HEAD, maxMb: 5 },
  moloco: { maxMb: 5 },
  facebook: { container: "zip", inline: false, script: "game.js", maxMb: 2 },
  google: {
    container: "zip",
    maxFiles: 512,
    inline: false,
    script: "main.js",
    head: '<meta name="ad.orientation" content="portrait,landscape">\n<script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>',
    maxMb: 5
  },
  liftoff: {
    container: "zip",
    inline: false,
    script: "main.js",
    maxMb: 5
  },
  tiktok: {
    container: "zip",
    beforeGame:
      '<script src="https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js"></script>',
    assetFiles: true,
    extraFiles: { "config.json": '{"playable_orientation":0}' },
    maxMb: 5
  }
};

export const EXPORT_NETWORK_NAMES = Object.keys(EXPORT_NETWORKS);
