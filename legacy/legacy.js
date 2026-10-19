/* Optional live readings. All reading and navigation work without this file.
 * ES5 only: iOS 9 has XMLHttpRequest, but no fetch, modules or Proxy. */
(function () {
  'use strict';
  var zh = document.documentElement.lang === 'zh-CN';
  var runtime = document.querySelector('script[src*="_assets/legacy.js"]');
  var assetBase = runtime ? runtime.src.replace(/legacy\.js(?:\?.*)?$/, '') : '/_assets/';
  var redirected = /(?:[?&])redirected=older-browser(?:&|$)/.test(window.location.search);
  try {
    if (redirected) window.sessionStorage.setItem('classic-redirected', 'yes');
    redirected = redirected || window.sessionStorage.getItem('classic-redirected') === 'yes';
  } catch (_) {}
  var reason = document.getElementById('edition-reason');
  if (reason && redirected) reason.textContent = zh ? '你使用的设备或浏览器较旧，因此已从主站自动跳转到经典版网站。' : 'You have been redirected from the main site because you are using an older device or browser.';
  var agent = document.getElementById('browser-agent');
  if (agent) agent.textContent = navigator.userAgent;
  function text(value) { return value == null ? (zh ? '暂无数据' : 'Unavailable') : String(value); }
  function node(tag, value) { var element = document.createElement(tag); element.textContent = text(value); return element; }
  function clear(element) { while (element.firstChild) element.removeChild(element.firstChild); }
  function number(value) { return value == null ? text(null) : String(Math.round(Number(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function metrics(element, entries) {
    var group = node('div', ''); group.className = 'metric-grid';
    for (var i = 0; i < entries.length; i++) {
      var box = node('div', ''); box.className = 'metric-box';
      box.appendChild(node('span', entries[i][0])); box.appendChild(node('strong', entries[i][1])); group.appendChild(box);
    }
    element.insertBefore(group, element.firstChild);
  }
  function bars(element, title, entries, maximum) {
    var box = node('section', ''); box.className = 'usage-chart'; box.appendChild(node('h3', title));
    for (var i = 0; i < entries.length; i++) {
      var row = node('div', ''); row.className = 'usage-row';
      var label = node('p', entries[i][0]); label.appendChild(node('strong', entries[i][2])); row.appendChild(label);
      var track = node('div', ''); track.className = 'usage-track';
      var fill = node('span', ''); fill.style.width = Math.max(0, Math.min(100, maximum ? Number(entries[i][1]) / maximum * 100 : 0)) + '%';
      track.appendChild(fill); row.appendChild(track); box.appendChild(row);
    }
    element.appendChild(box);
  }
  function table(element, rows) {
    clear(element);
    var result = document.createElement('table');
    var body = document.createElement('tbody');
    for (var i = 0; i < rows.length; i++) {
      var row = document.createElement('tr'); row.appendChild(node('th', rows[i][0])); row.appendChild(node('td', rows[i][1])); body.appendChild(row);
    }
    result.appendChild(body); element.appendChild(result);
    var caption = node('p', zh ? '载入时的最新读数。刷新页面可更新。' : 'Latest reading at page load. Refresh this page to update.');
    caption.className = 'live-caption'; element.appendChild(caption);
  }
  function get(endpoint, done) {
    var request = new XMLHttpRequest();
    request.open('GET', endpoint, true); request.timeout = 8000;
    request.onload = function () {
      var payload = null;
      if (request.status === 200) { try { payload = JSON.parse(request.responseText); } catch (_) {} }
      done(payload);
    };
    request.onerror = request.ontimeout = function () { done(null); };
    request.send(null);
  }
  function failure(element) { clear(element); element.appendChild(node('p', zh ? '暂时无法获取最新数据，请稍后刷新。' : 'The latest reading is unavailable. Try refreshing later.')); }
  function reading(kind, element, data) {
    if (!data) { failure(element); return; }
    if (kind === 'homelab') {
      var current = data.current || {};
      table(element, [[zh ? '状态' : 'Status', data.online ? (zh ? '在线' : 'Online') : (zh ? '没有近期心跳' : 'No recent heartbeat')],
        [zh ? '运行时间' : 'Uptime', current.uptime == null ? null : Math.floor(current.uptime / 3600) + ' h'],
        [zh ? 'CPU 核心' : 'CPU cores', current.cpus], [zh ? '平均负载' : 'Load average', current.load1],
        [zh ? '内存占用' : 'Memory used', current.memTotal ? Math.round(current.memUsed / current.memTotal * 100) + '%' : null],
        [zh ? '温度' : 'Temperature', current.temp == null ? null : current.temp + ' °C']]);
      metrics(element, [[zh ? '服务器状态' : 'Server status', data.online ? (zh ? '在线' : 'ONLINE') : (zh ? '离线' : 'OFFLINE')],
        [zh ? '连续运行' : 'Uptime', current.uptime == null ? text(null) : Math.floor(current.uptime / 86400) + 'd ' + Math.floor(current.uptime % 86400 / 3600) + 'h']]);
      bars(element, zh ? '当前资源占用' : 'Current resource usage', [
        [zh ? '内存' : 'Memory', current.memTotal ? current.memUsed / current.memTotal * 100 : 0, current.memTotal ? Math.round(current.memUsed / current.memTotal * 100) + '%' : text(null)],
        [zh ? 'CPU 负载 / 核心数' : 'CPU load / core count', current.cpus ? current.load1 / current.cpus * 100 : 0, current.load1 == null ? text(null) : current.load1 + ' / ' + current.cpus]
      ], 100);
      if (data.lastSeen) element.appendChild(node('p', (zh ? '最新心跳：' : 'Last heartbeat: ') + new Date(data.lastSeen * 1000).toUTCString()));
    } else if (kind === 'tokens') {
      var totals = data.totals || {};
      table(element, [[zh ? 'Token 总量' : 'Total tokens', totals.tokens], [zh ? '会话' : 'Sessions', totals.sessions],
        [zh ? '首次记录' : 'First recorded day', totals.firstDay], [zh ? '最近记录' : 'Latest recorded day', totals.lastDay],
        [zh ? '估算标价' : 'Equivalent list price', data.cost == null ? null : '$' + Number(data.cost).toFixed(2)]]);
      element.appendChild(node('p', zh ? '金额按公开标价估算，不是实际账单。' : 'The dollar amount estimates list price, rather than an actual bill.'));
      metrics(element, [[zh ? '累计 Token' : 'Total tokens', number(totals.tokens)], [zh ? '会话' : 'Sessions', number(totals.sessions)],
        [zh ? '响应数' : 'Responses', number(totals.messages)], [zh ? '等价标价' : 'Equivalent list price', data.cost == null ? text(null) : '$' + Number(data.cost).toFixed(2)]]);
      var models = data.byModel || [], modelBars = [], maxModel = 0;
      for (var m = 0; m < models.length; m++) {
        modelBars.push([models[m].label || models[m].model, models[m].tokens, number(models[m].tokens)]);
        maxModel = Math.max(maxModel, models[m].tokens);
      }
      if (modelBars.length) bars(element, zh ? '按模型统计' : 'Tokens by model', modelBars, maxModel);
      var daily = (data.daily || []).slice(-14), dailyBars = [], maxDay = 0;
      for (var d = 0; d < daily.length; d++) {
        dailyBars.push([daily[d].day, daily[d].tokens, number(daily[d].tokens)]); maxDay = Math.max(maxDay, daily[d].tokens);
      }
      if (dailyBars.length) bars(element, zh ? '最近 14 个记录日' : 'Last 14 recorded days', dailyBars, maxDay);
    } else if (kind === 'time') {
      table(element, [[zh ? 'GPS 参考时间 (UTC)' : 'GPS reference time (UTC)', data.sentAtMs == null ? null : new Date(data.sentAtMs).toUTCString()],
        [zh ? '你的时区' : 'Your timezone', data.sentAtMs == null ? null : new Date(data.sentAtMs).toLocaleString()],
        [zh ? '北京时间' : 'Beijing time', data.sentAtMs == null ? null : new Date(data.sentAtMs + 28800000).toUTCString().replace('GMT', 'UTC+08:00')],
        [zh ? '时间源' : 'Source', 'GPS/PPS'], ['Stratum', data.stratum], [zh ? '同步' : 'Synchronized', data.synchronized ? (zh ? '是' : 'Yes') : (zh ? '否' : 'No')]]);
      if (data.synchronized && data.sentAtMs != null) {
        var snapshot = new Date(data.sentAtMs);
        var display = node('div', ''); display.className = 'reference-clock';
        display.appendChild(node('span', zh ? 'GPS 参考时间 / UTC' : 'GPS REFERENCE / UTC'));
        function pad(value) { return value < 10 ? '0' + value : String(value); }
        display.appendChild(node('strong', pad(snapshot.getUTCHours()) + ':' + pad(snapshot.getUTCMinutes()) + ':' + pad(snapshot.getUTCSeconds())));
        display.appendChild(node('p', snapshot.getUTCFullYear() + '-' + pad(snapshot.getUTCMonth() + 1) + '-' + pad(snapshot.getUTCDate())));
        display.appendChild(node('small', zh ? '载入时的时间快照' : 'SNAPSHOT AT PAGE LOAD'));
        element.insertBefore(display, element.firstChild);
      }
    } else if (kind === 'ip') {
      var connection = data.connection || {};
      var network = data.network || {};
      table(element, [['IP', data.ip], [zh ? '国家或地区' : 'Country or region', data.countryCode], [zh ? '城市' : 'City', data.city],
        [zh ? '网络' : 'Network', network.organization], ['TLS', connection.tlsVersion], ['HTTP', connection.httpProtocol]]);
    }
  }
  var panels = document.querySelectorAll('[data-live]');
  for (var i = 0; i < panels.length; i++) {
    (function (element) {
      var kind = element.getAttribute('data-live');
      if (kind !== 'now-playing') { get('/api/' + kind, function (data) { reading(kind, element, data); }); return; }
      function refresh() {
        get('/api/now-playing', function (data) {
          if (!data || !data.playing || !data.observedAt || Date.now() - data.observedAt > 35000) { element.setAttribute('hidden', 'hidden'); }
          else {
            var content = document.getElementById('now-playing-content'); clear(content);
            var artwork = typeof data.artworkUrl === 'string' && data.artworkUrl.match(/^https:\/\/media\.leodeng\.dev\/now-playing\/artwork\/([a-f0-9]{64}\.(?:jpg|png))$/);
            if (artwork) {
              var cover = document.createElement('img'); cover.src = assetBase + 'playing/' + artwork[1]; cover.alt = ''; cover.width = 64; cover.height = 64; content.appendChild(cover);
            }
            content.appendChild(node('strong', data.title)); content.appendChild(node('p', data.artist));
            if (data.album) content.appendChild(node('p', data.album)); element.removeAttribute('hidden');
          }
          window.setTimeout(refresh, 10000);
        });
      }
      refresh();
    })(panels[i]);
  }
})();
