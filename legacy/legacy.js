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
  function table(element, rows, showCaption) {
    clear(element);
    var result = document.createElement('table');
    var body = document.createElement('tbody');
    for (var i = 0; i < rows.length; i++) {
      var row = document.createElement('tr'); row.appendChild(node('th', rows[i][0])); row.appendChild(node('td', rows[i][1])); body.appendChild(row);
    }
    result.appendChild(body); element.appendChild(result);
    if (showCaption === false) return;
    var caption = node('p', zh ? '载入时的最新读数。刷新页面可更新。' : 'Latest reading at page load. Refresh this page to update.');
    caption.className = 'live-caption'; element.appendChild(caption);
  }
  function get(endpoint, done, timeout, plain) {
    var request = new XMLHttpRequest();
    request.open('GET', endpoint, true); request.timeout = timeout || 8000;
    request.onload = function () {
      var payload = null;
      if (request.status === 200) { try { payload = plain ? request.responseText : JSON.parse(request.responseText); } catch (_) {} }
      done(payload, request);
    };
    request.onerror = request.ontimeout = function () { done(null, request); };
    request.send(null);
    return request;
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

    }
  }
  function setupStats(element) {
    clear(element);
    function box(title) {
      var section = node('section', ''); section.className = 'connection-section';
      section.appendChild(node('h2', title));
      var body = node('div', zh ? '正在加载...' : 'Loading...'); section.appendChild(body); element.appendChild(section); return body;
    }
    var github = box('GitHub'), commits = box(zh ? '最近的公开提交' : 'Recent public commits'), monkey = box('Monkeytype');
    get('https://api.github.com/users/leodenglovescode', function (data) {
      if (!data || typeof data.public_repos !== 'number') { failure(github); return; }
      table(github, [[zh ? '公开仓库' : 'Public repositories', data.public_repos], [zh ? '关注者' : 'Followers', data.followers]], false);
    });
    get('https://api.github.com/search/commits?q=author%3Aleodenglovescode&sort=committer-date&order=desc&per_page=3', function (data) {
      if (!data || !Array.isArray(data.items)) { failure(commits); return; }
      clear(commits);
      commits.appendChild(node('p', zh ? 'GitHub 索引的公开提交，并非终身提交总数。' : 'Public commits indexed by GitHub, rather than a lifetime total.'));
      var list = node('ul', '');
      for (var i = 0; i < Math.min(3, data.items.length); i++) {
        var item = data.items[i];
        if (typeof item.html_url !== 'string' || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/commit\/[a-f0-9]{40}$/.test(item.html_url)) continue;
        var row = node('li', ''), link = node('a', item.commit.message.split('\n')[0]); link.href = item.html_url; row.appendChild(link); list.appendChild(row);
      }
      commits.appendChild(list);
    });
    get('/api/stats/monkeytype', function (data) {
      if (!data) { failure(monkey); return; }
      clear(monkey);
      if (data.profile) {
        var best10Words = null, saved = data.history && data.history.results || [];
        for (var test = 0; test < saved.length; test++) {
          if (saved[test].mode === 'words' && saved[test].mode2 === '10' && (best10Words === null || saved[test].wpm > best10Words)) best10Words = saved[test].wpm;
        }
        var profile = node('div', ''); monkey.appendChild(profile);
        table(profile, [[zh ? '完成测试' : 'Completed tests', data.profile.completedTests],
          [zh ? '打字时间' : 'Typing time', data.profile.timeTyping == null ? null : Math.round(data.profile.timeTyping / 3600 * 10) / 10 + ' h'],
          [zh ? '10 词测试最佳成绩' : 'Best 10-word test', best10Words === null ? null : Math.round(best10Words * 10) / 10 + ' WPM']], false);
        monkey.appendChild(node('p', zh ? '最佳成绩：英语、普通难度，不含标点和数字。' : 'Personal bests: English, normal difficulty, without punctuation or numbers.'));
        var bests = [], bestBox = node('div', '');
        for (var b = 0; b < data.profile.bests.length; b++) bests.push([data.profile.bests[b].seconds + 's', data.profile.bests[b].wpm + ' WPM']);
        if (bests.length) { table(bestBox, bests, false); monkey.appendChild(bestBox); }
      } else monkey.appendChild(node('p', zh ? '公开统计暂时不可用。' : 'Public stats are temporarily unavailable.'));
      monkey.appendChild(node('h3', zh ? '已保存测试记录' : 'Saved test history'));
      if (data.history && data.history.state === 'ready') {
        var results = data.history.results.slice(-12).reverse(), rows = [], historyBox = node('div', '');
        monkey.appendChild(node('p', zh ? '最近 12 条已保存测试，约每小时更新一次。' : 'Latest 12 saved tests, refreshed about once an hour.'));
        if (data.history.stale) monkey.appendChild(node('p', zh ? '当前显示上次成功更新的数据。' : 'Showing the last successful update.'));
        for (var r = 0; r < results.length; r++) rows.push([new Date(results[r].timestamp).toLocaleDateString() + ' / ' + results[r].mode + ' ' + results[r].mode2 + ' / ' + results[r].language, results[r].wpm + ' WPM / ' + results[r].accuracy + '%']);
        if (rows.length) { table(historyBox, rows, false); monkey.appendChild(historyBox); }
        else monkey.appendChild(node('p', zh ? '暂无已保存测试。' : 'No saved tests yet.'));
      } else monkey.appendChild(node('p', data.history && data.history.state === 'not-connected'
        ? (zh ? '这里暂未分享我的测试记录。' : 'My saved test history is not shared here yet.')
        : (zh ? '测试记录暂时不可用。' : 'Test history is temporarily unavailable.')));
    });
  }
  function setupConnection(element) {
    var data = null, probe = null, pending = 0, requests = [], version = 0;
    function section(title, rows) {
      var box = node('section', ''); box.className = 'connection-section';
      box.appendChild(node('h2', title));
      var body = node('div', ''); table(body, rows, false); box.appendChild(body); element.appendChild(box);
      return box;
    }
    function render() {
      clear(element); element.className = 'live-panel connection-report';
      var tools = node('p', ''); tools.className = 'connection-tools';
      var refresh = node('button', zh ? '重新检测' : 'Check again'); refresh.type = 'button'; refresh.disabled = pending > 0; refresh.onclick = load;
      tools.appendChild(refresh);
      var json = node('a', zh ? '查看 JSON' : 'View JSON'); json.href = '/api/ip'; tools.appendChild(json); element.appendChild(tools);
      var address = node('section', ''); address.className = 'connection-address';
      address.appendChild(node('h2', zh ? '你的公网地址' : 'Your public address'));
      var ip = node('strong', data && data.ip); ip.className = 'connection-ip'; address.appendChild(ip);
      address.appendChild(node('p', data && data.ipVersion ? 'IPv' + data.ipVersion : (zh ? '地址类型未知' : 'Address type unknown'))); element.appendChild(address);
      var connection = data && data.connection || {}, network = data && data.network || {};
      var tls = connection.tlsVersion;
      var strength = tls === 'TLSv1.3' ? (zh ? '强' : 'Strong') : tls === 'TLSv1.2' ? (zh ? '现代' : 'Modern')
        : /^(TLSv1(?:\.0|\.1)?|SSLv[23])$/.test(tls || '') ? (zh ? '较弱' : 'Weak') : null;
      var rows = [[zh ? 'TLS 版本' : 'TLS version', tls], [zh ? '协议强度' : 'Protocol strength', strength],
        [zh ? '加密套件' : 'Cipher suite', connection.cipher], [zh ? 'HTTP 协议' : 'HTTP protocol', connection.httpProtocol],
        [zh ? '密钥交换（独立探测）' : 'Key exchange (separate probe)', probe && probe.kex]];
      if (probe && probe.tls !== tls) rows.push([zh ? '探测连接 TLS' : 'Probe TLS version', probe.tls]);
      var security = section(zh ? '01. 连接加密报告' : '01. Connection security', rows);
      var hybrid = probe && probe.tls === 'TLSv1.3' && probe.kex === 'X25519MLKEM768';
      var classical = probe && /^(X25519|P-256|P-384|P-521)$/.test(probe.kex || '');
      var report = node('p', hybrid ? (zh ? '已确认混合后量子密钥交换。' : 'Hybrid post-quantum key exchange confirmed.')
        : classical ? (zh ? '探测连接使用经典密钥交换。' : 'The probe uses classical key exchange.')
        : pending ? (zh ? '正在检测连接...' : 'Checking your connection...')
        : (zh ? '密钥交换探测不可用，无法确认后量子状态。' : 'Key-exchange probe unavailable. Post-quantum status is unknown.'));
      report.className = hybrid ? 'connection-result connection-confirmed' : 'connection-result'; security.appendChild(report);
      security.appendChild(node('p', zh ? '加密套件来自 API 请求。密钥交换由同站点的独立连接探测，结果可能不同。' : 'The cipher suite describes the API request. Key exchange is checked with a separate same-site connection and may differ.'));
      var route = section(zh ? '02. 请求路径' : '02. Request path', [
        [zh ? '你的浏览器' : 'Your browser', data && data.userAgent || navigator.userAgent],
        [zh ? 'Cloudflare 边缘节点' : 'Cloudflare edge', connection.colo],
        [zh ? '网站' : 'Website', 'old.leodeng.dev']]); route.className += ' connection-route';
      section(zh ? '03. 网络资料' : '03. Network information', [
        [zh ? '网络运营商' : 'Network organization', network.organization], ['ASN', network.asn ? 'AS' + network.asn : null],
        [zh ? '国家或地区' : 'Country or region', data && data.countryCode], [zh ? '区域' : 'Region', data && data.region],
        [zh ? '大致城市' : 'Approximate city', data && data.city]]);
      var note = node('p', pending ? (zh ? '正在获取最新读数...' : 'Retrieving current readings...')
        : !data ? (zh ? '无法获取网络资料。请重新检测。' : 'Network details are unavailable. Try checking again.')
        : (zh ? '以上为检测时的连接信息。位置为近似值。' : 'Connection details at the time of this check. Location is approximate.'));
      note.className = 'live-caption'; note.setAttribute('role', 'status'); element.appendChild(note);
    }
    function load() {
      var current = ++version;
      for (var i = 0; i < requests.length; i++) requests[i].abort();
      requests = []; data = null; probe = null; pending = 2; render();
      requests.push(get('/api/ip', function (value) {
        if (version !== current) return;
        data = value; pending--; render();
      }));
      requests.push(get('/cdn-cgi/trace', function (value) {
        if (version !== current) return;
        if (typeof value === 'string' && value.length <= 8192) {
          var lines = value.split(/\r?\n/), fields = {};
          for (var l = 0; l < lines.length; l++) {
            var match = /^(tls|kex)=(.{1,200})$/.exec(lines[l]);
            if (match) fields[match[1]] = match[2].replace(/^\s+|\s+$/g, '');
          }
          if (fields.tls || fields.kex) probe = fields;
        }
        pending--; render();
      }, 8000, true));
    }
    load();
  }
  function monotonic() { return window.performance && window.performance.now ? window.performance.now() : Date.now(); }
  function finite(value) { return typeof value === 'number' && isFinite(value); }
  function pad(value, width) { var result = String(value); while (result.length < (width || 2)) result = '0' + result; return result; }
  function parseLyrics(source) {
    if (typeof source !== 'string' || source.length > 100000) return [];
    var offsetMatch = source.match(/^\s*\[offset:([+-]?\d+)\]\s*$/im);
    var offset = offsetMatch ? Number(offsetMatch[1]) : 0, lines = [], rows = source.split(/\r?\n/);
    for (var r = 0; r < rows.length; r++) {
      var pattern = /\[(\d{1,3}):([0-5]\d)(?:\.(\d{1,3}))?\]/g, match;
      var words = rows[r].replace(/\[[^\]]*\]/g, '').replace(/^\s+|\s+$/g, '');
      while ((match = pattern.exec(rows[r]))) {
        var fraction = Number(((match[3] || '') + '000').slice(0, 3));
        lines.push({ time: Math.max(0, Number(match[1]) * 60000 + Number(match[2]) * 1000 + fraction - offset), words: words, order: lines.length });
        if (lines.length > 2000) return [];
      }
    }
    return lines.sort(function (a, b) { return a.time - b.time || a.order - b.order; });
  }
  function lyricIndex(lines, position) {
    var low = 0, high = lines.length;
    while (low < high) { var middle = (low + high) >>> 1; if (lines[middle].time <= position) low = middle + 1; else high = middle; }
    return low - 1;
  }
  function setupPlayer(element) {
    var content = document.getElementById('now-playing-content');
    var track = null, key = '', lines = [], cache = [], poll = null, ticker = null, request = null, lyricRequest = null, lyricRetry = null, generation = 0, lastSuccess = null;
    var title, artist, album, image, fill, progress, elapsed, total, lyrics, lyricRows, lyricStatus, lastLine = -999;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function hide() {
      track = null; key = ''; lines = []; generation++;
      window.clearTimeout(lyricRetry);
      if (lyricRequest) lyricRequest.abort(); lyricRequest = null;
      element.setAttribute('hidden', 'hidden');
    }
    function position() { return track ? Math.min(track.durationMs, Math.max(0, track.position + monotonic() - track.at)) : 0; }
    function time(value) { var seconds = Math.max(0, Math.floor(value / 1000)); return Math.floor(seconds / 60) + ':' + pad(seconds % 60); }
    function tick() {
      if (!track) return;
      if (lastSuccess !== null && monotonic() - lastSuccess > 35000) { hide(); return; }
      var value = position();
      fill.style.width = Math.min(100, value / track.durationMs * 100) + '%';
      elapsed.textContent = time(value); progress.setAttribute('aria-valuenow', String(Math.round(value / 1000)));
      var active = lyricIndex(lines, value);
      if (active !== lastLine) {
        for (var n = 0; n < 3; n++) {
          var line = lines[active + n - 1];
          lyricRows[n].textContent = line ? line.words : '';
        }
        lastLine = active;
      }
    }
    function loadLyrics(signature) {
      var version = ++generation;
      window.clearTimeout(lyricRetry);
      if (lyricRequest) lyricRequest.abort(); lyricRequest = null;
      lines = []; lastLine = -999; lyrics.setAttribute('hidden', 'hidden');
      function status(message) { lyricStatus.textContent = message; if (message) lyricStatus.removeAttribute('hidden'); else lyricStatus.setAttribute('hidden', 'hidden'); }
      status(zh ? '正在查找歌词...' : 'Loading lyrics...');
      for (var c = 0; c < cache.length; c++) if (cache[c].key === signature && cache[c].expires > Date.now()) {
        lines = cache[c].lines; if (lines.length) lyrics.removeAttribute('hidden');
        status(lines.length ? '' : (zh ? '此版本暂无同步歌词。' : 'No synced lyrics for this recording.')); tick(); return;
      }
      var query = 'track_name=' + encodeURIComponent(track.title) + '&artist_name=' + encodeURIComponent(track.artist) + '&duration=' + encodeURIComponent(track.durationMs / 1000);
      if (track.album) query += '&album_name=' + encodeURIComponent(track.album);
      var duration = track.durationMs, edgeResponse = null;
      function received(data, response) {
        if (generation !== version || key !== signature || document.hidden) return;
        lyricRequest = null;
        if (!data) {
          status(zh ? '歌词暂时不可用，稍后重试。' : 'Lyrics unavailable. Retrying shortly.');
          var delay = 30000, responses = [edgeResponse, response];
          for (var r = 0; r < responses.length; r++) {
            var retry = responses[r] && responses[r].getResponseHeader('Retry-After');
            var wait = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
            if (isFinite(wait)) delay = Math.max(delay, wait);
          }
          lyricRetry = window.setTimeout(function () { if (key === signature && !document.hidden) loadLyrics(signature); }, Math.min(2147483647, delay));
          return;
        }
        lines = !data.instrumental && finite(data.duration) && Math.abs(data.duration * 1000 - duration) <= 2000 ? parseLyrics(data.syncedLyrics) : [];
        var nonempty = false;
        for (var l = 0; l < lines.length; l++) if (lines[l].words) nonempty = true;
        if (!nonempty) lines = [];
        cache.push({ key: signature, lines: lines, expires: Date.now() + (lines.length ? 86400000 : 600000) });
        if (cache.length > 20) cache.shift();
        if (lines.length) lyrics.removeAttribute('hidden');
        status(lines.length ? '' : (zh ? '此版本暂无同步歌词。' : 'No synced lyrics for this recording.'));
        lastLine = -999; tick();
      }
      lyricRequest = get('/api/lyrics?' + query, function (data, response) {
        if (generation !== version || key !== signature || document.hidden) return;
        if (data) { received(data, response); return; }
        edgeResponse = response;
        // LRCLIB permits browser CORS requests. Shared edge IPs can be rate
        // limited even when a visitor's own connection works, as on the main
        // site. Keep the proxy first for devices with older TLS support.
        lyricRequest = get('https://lrclib.net/api/get?' + query, function (direct, directResponse) {
          if (directResponse.status === 404) direct = { syncedLyrics: null };
          received(direct, directResponse);
        });
      });
    }
    function build() {
      clear(content);
      var info = node('div', ''); info.className = 'player-info';
      image = node('img', ''); image.alt = ''; image.width = 56; image.height = 56; image.setAttribute('hidden', 'hidden');
      image.onerror = function () { image.setAttribute('hidden', 'hidden'); };
      title = node('strong', ''); artist = node('p', ''); album = node('p', '');
      info.appendChild(image); info.appendChild(title); info.appendChild(artist); info.appendChild(album); content.appendChild(info);
      progress = node('div', ''); progress.className = 'player-progress'; progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', zh ? '歌曲进度' : 'Song progress'); progress.setAttribute('aria-valuemin', '0');
      fill = node('span', ''); progress.appendChild(fill); content.appendChild(progress);
      var times = node('div', ''); times.className = 'player-times'; elapsed = node('span', ''); total = node('span', ''); times.appendChild(elapsed); times.appendChild(total); content.appendChild(times);
      lyricStatus = node('p', ''); lyricStatus.className = 'player-lyric-status'; lyricStatus.setAttribute('hidden', 'hidden'); content.appendChild(lyricStatus);
      lyrics = node('section', ''); lyrics.className = 'player-lyrics'; lyrics.setAttribute('aria-label', zh ? '同步歌词' : 'Synced lyrics'); lyrics.setAttribute('hidden', 'hidden');
      lyricRows = [];
      for (var r = 0; r < 3; r++) {
        var row = node('p', ''); row.className = r === 1 ? 'legacy-lyric lyric-active' : 'legacy-lyric';
        if (r === 1) row.setAttribute('aria-current', 'true');
        var cell = node('span', ''); cell.className = 'lyric-cell';
        var words = node('span', ''); cell.appendChild(words); row.appendChild(cell); lyricRows.push(words); lyrics.appendChild(row);
      }
      var credit = node('a', zh ? '歌词来自 LRCLIB' : 'Lyrics via LRCLIB'); credit.href = 'https://lrclib.net'; credit.className = 'lyrics-credit'; lyrics.appendChild(credit); content.appendChild(lyrics);
    }
    function refresh() {
      if (document.hidden) return;
      window.clearTimeout(poll);
      var started = monotonic();
      request = get('/api/now-playing', function (data, response) {
        request = null;
        if (document.hidden) return;
        if (response.status === 204) { lastSuccess = monotonic(); hide(); }
        else if (data) {
          lastSuccess = monotonic();
          if (data.playing !== true || typeof data.title !== 'string' || !data.title || typeof data.artist !== 'string' || !data.artist || !finite(data.durationMs) || data.durationMs <= 0 || !finite(data.positionMs) || !finite(data.observedAt)) hide();
          else {
            var responseDate = Date.parse(response.getResponseHeader('date') || '');
            var serverNow = isFinite(responseDate) ? responseDate : Number(data.serverNow) || data.observedAt;
            var age = Math.max(0, serverNow - data.observedAt);
            if (age > 35000) hide();
            else {
              var signature = JSON.stringify([data.title, data.artist, data.album || '', data.durationMs]);
              var changed = signature !== key;
              track = { title: data.title, artist: data.artist, album: data.album || '', durationMs: data.durationMs, position: Math.max(0, Math.min(data.durationMs, data.positionMs + age)), at: monotonic() };
              if (!title) build();
              title.textContent = track.title; artist.textContent = track.artist; album.textContent = track.album;
              total.textContent = time(track.durationMs); progress.setAttribute('aria-valuemax', String(Math.round(track.durationMs / 1000)));
              var artwork = typeof data.artworkUrl === 'string' && data.artworkUrl.match(/^https:\/\/media\.leodeng\.dev\/now-playing\/artwork\/([a-f0-9]{64}\.(?:jpg|png))$/);
              var source = artwork ? assetBase + 'playing/' + artwork[1] : '';
              if (source && image.getAttribute('src') !== source) { image.src = source; image.removeAttribute('hidden'); }
              if (!source) { image.removeAttribute('src'); image.setAttribute('hidden', 'hidden'); }
              key = signature;
              if (changed) loadLyrics(signature);
              element.removeAttribute('hidden'); tick();
            }
          }
        } else if (lastSuccess === null || monotonic() - lastSuccess > 35000) hide();
        poll = window.setTimeout(refresh, Math.max(0, (track ? 2000 : 5000) - (monotonic() - started)));
      }, 5000);
    }
    function visibility() {
      window.clearTimeout(poll); window.clearInterval(ticker);
      if (document.hidden) { if (request) request.abort(); request = null; hide(); }
      else { refresh(); ticker = window.setInterval(tick, reduced ? 1000 : 250); }
    }
    document.addEventListener('visibilitychange', visibility);
    visibility();
  }
  function setupClock(element) {
    var anchor = null, busy = false, request = null, animation = null, retryAt = 0, sequence = 0, lastSecond = null;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var useFrames = !reduced && !!window.requestAnimationFrame && !!window.cancelAnimationFrame;
    clear(element);
    var display = node('div', ''); display.className = 'reference-clock';
    var source = node('span', ''); var digits = node('strong', ''); var date = node('p', ''); var detail = node('small', '');
    display.appendChild(source); display.appendChild(digits); display.appendChild(date); display.appendChild(detail); element.appendChild(display);
    var values = [], labels = [zh ? '你的时区' : 'Your timezone', zh ? '北京时间' : 'Beijing time', zh ? '时间源' : 'Source', 'Stratum', zh ? '往返延迟' : 'Round trip', zh ? '网络不确定性估计' : 'Estimated network uncertainty', zh ? '最近同步' : 'Last synchronized'];
    var grid = node('table', ''), body = node('tbody', '');
    for (var r = 0; r < labels.length; r++) { var row = node('tr', ''); var value = node('td', ''); row.appendChild(node('th', labels[r])); row.appendChild(value); body.appendChild(row); values.push(value); }
    grid.appendChild(body); element.appendChild(grid);
    var caption = node('p', zh ? '页面可见时每 60 秒获取 3 次读数。毫秒是显示精度，不代表实际准确度。' : 'Three samples every 60 seconds while visible. Milliseconds show display precision, not guaranteed accuracy.'); caption.className = 'live-caption'; element.appendChild(caption);
    function tick() {
      var current = anchor ? anchor.now + Math.max(0, monotonic() - anchor.at) : Date.now();
      var instant = new Date(current);
      digits.textContent = pad(instant.getUTCHours()) + ':' + pad(instant.getUTCMinutes()) + ':' + pad(instant.getUTCSeconds()) + '.' + pad(instant.getUTCMilliseconds(), 3);
      var second = Math.floor(current / 1000);
      if (second !== lastSecond) {
        date.textContent = instant.getUTCFullYear() + '-' + pad(instant.getUTCMonth() + 1) + '-' + pad(instant.getUTCDate());
        values[0].textContent = instant.toLocaleString();
        values[1].textContent = new Date(current + 28800000).toUTCString().replace('GMT', 'UTC+08:00');
        lastSecond = second;
      }
    }
    function fallback() {
      anchor = null;
      source.textContent = zh ? '设备时间 / UTC（备用）' : 'YOUR DEVICE CLOCK / UTC (FALLBACK)';
      detail.textContent = zh ? '未与 GPS 同步' : 'NOT SYNCHRONIZED TO GPS';
      values[2].textContent = zh ? '设备时间（备用）' : 'Your device clock (fallback)';
      for (var v = 3; v < values.length; v++) values[v].textContent = text(null);
      tick();
    }
    function synchronize() {
      if (busy || document.hidden || monotonic() < retryAt) return;
      busy = true;
      var version = ++sequence, count = 0, best = null;
      function sample() {
        var started = monotonic(), wall = Date.now();
        request = get('/api/time', function (data, response) {
          if (version !== sequence || document.hidden) return;
          request = null;
          var received = monotonic(), elapsedMs = received - started;
          var healthy = data && data.synchronized === true && data.source === 'gps-pps' && data.stratum === 1 && finite(data.receivedAtMs) && finite(data.sentAtMs) && data.receivedAtMs > 0 && data.sentAtMs < 8640000000000000 && data.sentAtMs >= data.receivedAtMs && data.sentAtMs - data.receivedAtMs <= 2000;
          var network = healthy ? elapsedMs - (data.sentAtMs - data.receivedAtMs) : -1;
          if (!healthy || network < 0 || elapsedMs > 3000) {
            var raw = response.getResponseHeader('retry-after');
            var seconds = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : raw ? Date.parse(raw) - Date.now() : 60000;
            retryAt = received + (isFinite(seconds) ? Math.min(3600000, Math.max(60000, seconds)) : 60000);
            busy = false; fallback(); return;
          }
          var result = { now: data.sentAtMs + network / 2, at: received, network: network, roundTrip: elapsedMs, offset: (data.receivedAtMs + data.sentAtMs) / 2 - wall - elapsedMs / 2 };
          if (!best || result.network < best.network) best = result;
          if (++count < 3) { sample(); return; }
          anchor = best; busy = false; retryAt = received + 10000;
          source.textContent = zh ? 'GPS / PPS 参考时间 / UTC' : 'GPS / PPS REFERENCE / UTC';
          detail.textContent = zh ? '3 次采样，使用网络延迟最低的一次' : '3 SAMPLES, LOWEST NETWORK DELAY USED';
          values[2].textContent = 'GPS/PPS'; values[3].textContent = '1'; values[4].textContent = Math.round(best.roundTrip) + ' ms'; values[5].textContent = '±' + Math.round(best.network / 2) + ' ms'; values[6].textContent = new Date(best.now).toUTCString(); tick();
        }, 3000);
      }
      sample();
    }
    function animate() {
      if (document.hidden) return;
      tick();
      animation = useFrames ? window.requestAnimationFrame(animate) : window.setTimeout(animate, reduced ? 1000 : 16);
    }
    function visibility() {
      if (animation !== null) {
        if (useFrames) window.cancelAnimationFrame(animation);
        else window.clearTimeout(animation);
        animation = null;
      }
      if (document.hidden) { sequence++; if (request) request.abort(); request = null; busy = false; fallback(); }
      else { animate(); synchronize(); }
    }
    fallback();
    window.setInterval(synchronize, 60000);
    document.addEventListener('visibilitychange', visibility);
    visibility();
  }
  // A plain JPEG and native scrolling work even without WebGL or modern JS.
  var panoramaLinks = document.querySelectorAll('[data-panorama]');
  for (var photoIndex = 0; photoIndex < panoramaLinks.length; photoIndex++) {
    (function (link) {
      link.addEventListener('click', function (event) {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        var overlay = node('div', ''); overlay.className = 'legacy-panorama-overlay';
        overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', zh ? '全景照片' : 'Panorama');
        var toolbar = node('div', ''); toolbar.className = 'legacy-panorama-toolbar';
        var close = node('button', zh ? '关闭' : 'Close'); close.type = 'button'; toolbar.appendChild(close);
        var fullscreen = node('button', zh ? '全屏查看' : 'Fullscreen'); fullscreen.type = 'button'; toolbar.appendChild(fullscreen);
        var original = node('a', zh ? '打开原图' : 'Open original'); original.href = link.href; toolbar.appendChild(original);
        var hint = node('span', zh ? '左右滚动查看' : 'Scroll sideways to explore'); toolbar.appendChild(hint);
        var viewport = node('div', ''); viewport.className = 'legacy-panorama-scroll'; viewport.tabIndex = 0;
        var image = document.createElement('img'); image.alt = zh ? '全景照片' : 'Panorama';
        viewport.appendChild(image); overlay.appendChild(toolbar); overlay.appendChild(viewport);
        var oldOverflow = document.body.style.overflow;
        function resize() { image.style.height = Math.max(100, window.innerHeight - 100) + 'px'; }
        function exit() {
          var leave = document.exitFullscreen || document.webkitExitFullscreen;
          if ((document.fullscreenElement || document.webkitFullscreenElement) === overlay && leave) {
            var result = leave.call(document); if (result && result['catch']) result['catch'](function () {});
          }
          window.removeEventListener('resize', resize); document.removeEventListener('keydown', keydown);
          document.body.style.overflow = oldOverflow; image.src = ''; document.body.removeChild(overlay); link.focus();
        }
        function keydown(event) {
          if (event.keyCode === 27) { event.preventDefault(); exit(); }
          if (event.keyCode === 9) {
            if (event.shiftKey && document.activeElement === close) { event.preventDefault(); viewport.focus(); }
            else if (!event.shiftKey && document.activeElement === viewport) { event.preventDefault(); close.focus(); }
          }
        }
        close.addEventListener('click', exit);
        var enter = overlay.requestFullscreen || overlay.webkitRequestFullscreen;
        var leave = document.exitFullscreen || document.webkitExitFullscreen;
        if (!enter) fullscreen.style.display = 'none';
        fullscreen.addEventListener('click', function () {
          var active = (document.fullscreenElement || document.webkitFullscreenElement) === overlay;
          var result = active && leave ? leave.call(document) : enter.call(overlay);
          if (result && result['catch']) result['catch'](function () {});
        });
        function fullscreenChanged() { fullscreen.textContent = (document.fullscreenElement || document.webkitFullscreenElement) === overlay ? (zh ? '退出全屏' : 'Exit fullscreen') : (zh ? '全屏查看' : 'Fullscreen'); }
        overlay.addEventListener('fullscreenchange', fullscreenChanged); overlay.addEventListener('webkitfullscreenchange', fullscreenChanged);
        image.onload = function () { viewport.scrollLeft = Math.max(0, (image.offsetWidth - viewport.clientWidth) / 2); };
        document.body.appendChild(overlay); document.body.style.overflow = 'hidden'; resize(); image.src = link.href; close.focus();
        window.addEventListener('resize', resize); document.addEventListener('keydown', keydown);
      });
    })(panoramaLinks[photoIndex]);
  }
  var panels = document.querySelectorAll('[data-live]');
  for (var i = 0; i < panels.length; i++) {
    (function (element) {
      var kind = element.getAttribute('data-live');
      if (kind === 'now-playing') { setupPlayer(element); return; }
      if (kind === 'time') { setupClock(element); return; }
      if (kind === 'ip') { setupConnection(element); return; }
      if (kind === 'stats') { setupStats(element); return; }
      get('/api/' + kind, function (data) { reading(kind, element, data); });
    })(panels[i]);
  }
})();
