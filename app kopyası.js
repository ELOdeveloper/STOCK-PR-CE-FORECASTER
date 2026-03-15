

const GROQ_API_KEY    = 'YOUR_GROQ_API_KEY';
const TWELVE_DATA_KEY = 'YOUR_TWELVEDATA_KEY';

const TD_BASE      = 'https://api.twelvedata.com';
const CHART_COLORS = ['#3b82f6','#22c55e','#f59e0b','#a78bfa','#2dd4bf','#fb7185'];

const POPULAR = [
  { sym:'AAPL',    name:'Apple' },
  { sym:'MSFT',    name:'Microsoft' },
  { sym:'GOOGL',   name:'Alphabet' },
  { sym:'AMZN',    name:'Amazon' },
  { sym:'TSLA',    name:'Tesla' },
  { sym:'NVDA',    name:'NVIDIA' },
  { sym:'META',    name:'Meta' },
  { sym:'NFLX',    name:'Netflix' },
  { sym:'JPM',     name:'JPMorgan' },
  { sym:'V',       name:'Visa' },
  { sym:'GLD',     name:'Gold ETF' },
  { sym:'SPY',     name:'S&P 500 ETF' },
  { sym:'QQQ',     name:'Nasdaq ETF' },
  { sym:'BTC/USD', name:'Bitcoin' },
  { sym:'ETH/USD', name:'Ethereum' },
];

let state = {
  ticker:      'AAPL',
  range:       '6mo',
  horizon:     90,
  rawData:     null,
  forecast:    null,
  charts:      {},
  compareList: ['AAPL','MSFT','TSLA'],
  watchlist:   JSON.parse(localStorage.getItem('wl') || '["AAPL","TSLA","NVDA"]'),
};

const $        = id => document.getElementById(id);
const tickerInput  = $('ticker-input');
const suggestions  = $('suggestions');
const runBtn       = $('run-btn');
const dashboard    = $('dashboard');
const loadingState = $('loading-state');
const loadingMsg   = $('loading-msg');
const errorBanner  = $('error-banner');

// ─── Navigation ───────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    $('view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'watchlist') refreshWatchlist();
  });
});

function bindPills(groupId, key) {
  document.querySelectorAll('#' + groupId + ' .pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#' + groupId + ' .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      state[key] = p.dataset[key === 'range' ? 'range' : 'horizon'];
    });
  });
}
bindPills('range-group',   'range');
bindPills('horizon-group', 'horizon');

// ─── Autocomplete ─────────────────────────────────────────────────────────────
function renderSuggestions(val) {
  if (!val) { suggestions.classList.remove('open'); return; }
  const q = val.toUpperCase();
  const matches = POPULAR.filter(p => p.sym.startsWith(q) || p.name.toUpperCase().includes(q)).slice(0, 6);
  if (!matches.length) { suggestions.classList.remove('open'); return; }
  suggestions.innerHTML = matches.map(m =>
    '<div class="suggestion-item" data-sym="' + m.sym + '">' +
    '<span class="sug-sym">' + m.sym + '</span>' +
    '<span class="sug-name">' + m.name + '</span></div>'
  ).join('');
  suggestions.classList.add('open');
}
tickerInput.addEventListener('input', e => renderSuggestions(e.target.value));
tickerInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { suggestions.classList.remove('open'); runForecast(); }
  if (e.key === 'Escape') suggestions.classList.remove('open');
});
suggestions.addEventListener('click', e => {
  const item = e.target.closest('.suggestion-item');
  if (!item) return;
  tickerInput.value = item.dataset.sym;
  suggestions.classList.remove('open');
  runForecast();
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) suggestions.classList.remove('open');
});

// ─── Run Forecast ─────────────────────────────────────────────────────────────
runBtn.addEventListener('click', runForecast);
$('refresh-btn').addEventListener('click', runForecast);

async function runForecast() {
  const raw = (tickerInput.value || state.ticker).trim().toUpperCase();
  if (!raw) return;

  if (!GROQ_API_KEY || GROQ_API_KEY === 'YOUR_GROQ_API_KEY_HERE') {
    showError('Groq API key eksik! app.js dosyasını aç, 14. satırda GROQ_API_KEY değerini gir → https://console.groq.com (ücretsiz)');
    return;
  }
  if (!TWELVE_DATA_KEY || TWELVE_DATA_KEY === 'YOUR_TWELVEDATA_KEY_HERE') {
    showError('Twelve Data API key eksik! app.js dosyasını aç, 15. satırda TWELVE_DATA_KEY değerini gir → https://twelvedata.com/account/new (ücretsiz)');
    return;
  }

  state.ticker = raw;
  tickerInput.value = raw;
  suggestions.classList.remove('open');
  showLoading(raw + ' verisi yükleniyor…');
  hideError();
  destroyAllCharts();
  dashboard.style.display = 'none';

  try {
    loadingMsg.textContent = raw + ' geçmiş fiyatları çekiliyor…';
    const data = await fetchHistory(raw, state.range);
    state.rawData = data;

    loadingMsg.textContent = 'Canlı fiyat alınıyor…';
    const quote = await fetchQuote(raw, data);

    loadingMsg.textContent = 'AI tahmin modeli çalışıyor…';
    const forecast = await runAIForecast(raw, data, parseInt(state.horizon), quote);
    state.forecast = forecast;

    loadingMsg.textContent = 'AI analiz üretiliyor…';
    const analysis = await getAIAnalysis(raw, data, forecast, quote);

    hideLoading();
    renderDashboard(raw, data, quote, forecast, analysis);
  } catch(err) {
    hideLoading();
    showError(err.message || 'Bir hata oluştu. Tekrar deneyin.');
    console.error(err);
  }
}

// ─── Twelve Data: History ─────────────────────────────────────────────────────
function rangeToOutputsize(range) {
  var map = { '1mo':30, '3mo':90, '6mo':180, '1y':365, '2y':730, '5y':1825 };
  return map[range] || 180;
}

async function fetchHistory(ticker, range) {
  var outputsize = rangeToOutputsize(range);
  var url = TD_BASE + '/time_series?symbol=' + encodeURIComponent(ticker) +
            '&interval=1day&outputsize=' + outputsize + '&apikey=' + TWELVE_DATA_KEY;
  var res = await fetch(url);
  if (!res.ok) throw new Error('Veri sunucusu hatası: ' + res.status);
  var json = await res.json();

  if (json.status === 'error') {
    if (json.code === 400) throw new Error('"' + ticker + '" bulunamadı. Ticker sembolünü kontrol edin.');
    if (json.code === 429) throw new Error('Twelve Data rate limit. Birkaç saniye bekleyip tekrar deneyin.');
    throw new Error(json.message || 'Twelve Data API hatası.');
  }

  var values = json.values;
  if (!values || !values.length) throw new Error('"' + ticker + '" için veri bulunamadı.');

  var points = values.reverse().map(function(v) {
    return {
      date:   new Date(v.datetime),
      open:   parseFloat(v.open),
      high:   parseFloat(v.high),
      low:    parseFloat(v.low),
      close:  parseFloat(v.close),
      volume: parseInt(v.volume) || 0,
    };
  });
  return points;
}

// ─── Twelve Data: Quote ───────────────────────────────────────────────────────
async function fetchQuote(ticker, histData) {
  try {
    var url  = TD_BASE + '/quote?symbol=' + encodeURIComponent(ticker) + '&apikey=' + TWELVE_DATA_KEY;
    var res  = await fetch(url);
    var json = await res.json();
    if (json.status === 'error') throw new Error(json.message);
    return {
      price:        parseFloat(json.close)          || histData[histData.length-1].close,
      prevClose:    parseFloat(json.previous_close) || null,
      open:         parseFloat(json.open)           || null,
      dayHigh:      parseFloat(json.high)           || null,
      dayLow:       parseFloat(json.low)            || null,
      fiftyTwoHigh: parseFloat(json.fifty_two_week && json.fifty_two_week.high) || null,
      fiftyTwoLow:  parseFloat(json.fifty_two_week && json.fifty_two_week.low)  || null,
      volume:       parseInt(json.volume)           || null,
      currency:     json.currency  || 'USD',
      exchange:     json.exchange  || '',
      name:         json.name      || ticker,
      symbol:       json.symbol    || ticker,
    };
  } catch(e) {
    var last = histData[histData.length-1];
    return {
      price:     last ? last.close : null,
      prevClose: histData.length >= 2 ? histData[histData.length-2].close : null,
      currency:  'USD', exchange: '', name: ticker, symbol: ticker,
    };
  }
}

// ─── AI Forecast ──────────────────────────────────────────────────────────────
async function runAIForecast(ticker, data, horizonDays, quote) {
  var recent = data.slice(-60).map(function(d) {
    return { date: d.date.toISOString().slice(0,10), close: +d.close.toFixed(4) };
  });
  var lastPrice = quote.price || data[data.length-1].close;
  var today     = new Date().toISOString().slice(0,10);
  var weeks     = Math.ceil(horizonDays / 5);

  var prompt = 'You are a quantitative financial analyst. Generate a ' + horizonDays + '-trading-day stock forecast for ' + ticker + ' using Prophet-style decomposition.\n\n' +
    'Current date: ' + today + '\n' +
    'Last close: ' + lastPrice + ' ' + (quote.currency || 'USD') + '\n' +
    'Recent 60 trading days (oldest first):\n' + JSON.stringify(recent) + '\n\n' +
    'Return ONLY valid JSON, no markdown, no explanation:\n' +
    '{\n' +
    '  "ticker": "' + ticker + '",\n' +
    '  "last_price": ' + lastPrice + ',\n' +
    '  "target_price": <number>,\n' +
    '  "change_pct": <number>,\n' +
    '  "ci_lower": <number>,\n' +
    '  "ci_upper": <number>,\n' +
    '  "trend_direction": "up" or "down" or "sideways",\n' +
    '  "confidence": "low" or "medium" or "high",\n' +
    '  "weekly_pattern": [\n' +
    '    {"day":"Mon","effect":<float>},\n' +
    '    {"day":"Tue","effect":<float>},\n' +
    '    {"day":"Wed","effect":<float>},\n' +
    '    {"day":"Thu","effect":<float>},\n' +
    '    {"day":"Fri","effect":<float>}\n' +
    '  ],\n' +
    '  "forecast_table": [\n' +
    '    {"date":"YYYY-MM-DD","yhat":<number>,"lower":<number>,"upper":<number>}\n' +
    '  ]\n' +
    '}\n' +
    'Rules: forecast_table must have exactly ' + weeks + ' entries (one per week, Mon-Fri only). Prices must be realistic.';

  var response = await callGroq(prompt, 2000);
  var text = response.content[0].text;

  var parsed;
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch(e) {
    var match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI yanıtı parse edilemedi. Tekrar deneyin.');
    parsed = JSON.parse(match[0]);
  }
  return parsed;
}

// ─── AI Analysis ──────────────────────────────────────────────────────────────
async function getAIAnalysis(ticker, data, forecast, quote) {
  var lastPrice = quote.price || data[data.length-1].close;
  var pct30d    = calcChange(data, 30);
  var pct90d    = calcChange(data, 90);

  var prompt = 'Concise financial analysis for ' + ticker + ' (price: $' + lastPrice + '):\n' +
    '- 30d change: ' + pct30d.toFixed(1) + '%\n' +
    '- 90d change: ' + pct90d.toFixed(1) + '%\n' +
    '- Forecast: $' + forecast.target_price + ' (' + (forecast.change_pct > 0 ? '+' : '') + (forecast.change_pct || 0).toFixed(1) + '%)\n' +
    '- Trend: ' + forecast.trend_direction + ', Confidence: ' + forecast.confidence + '\n\n' +
    'Return ONLY JSON, no markdown:\n' +
    '{"signal":"BUY or HOLD or SELL","trend":"1-2 sentences","momentum":"1-2 sentences","risk":"1-2 sentences","outlook":"1-2 sentences"}';

  try {
    var response = await callGroq(prompt, 500);
    var text = response.content[0].text;
    var match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch(e) { return null; }
}

// ─── Groq API ─────────────────────────────────────────────────────────────────
async function callGroq(prompt, maxTokens, retries) {
  maxTokens = maxTokens || 1000;
  retries   = retries   || 3;
  var url = 'https://api.groq.com/openai/v1/chat/completions';

  for (var attempt = 0; attempt < retries; attempt++) {
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY,
      },
      body: JSON.stringify({
        model:      'llama-3.3-70b-versatile',
        messages:   [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });

    if (res.status === 429) {
      var wait = (attempt + 1) * 10000;
      loadingMsg.textContent = 'Rate limit: ' + (wait/1000) + 'sn bekleniyor... (' + (attempt+1) + '/' + retries + ')';
      await new Promise(function(r) { setTimeout(r, wait); });
      continue;
    }
    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      if (res.status === 401) throw new Error('Groq: Geçersiz API key. https://console.groq.com adresinden kontrol et.');
      throw new Error((err.error && err.error.message) || ('Groq API hatası: ' + res.status));
    }
    var data = await res.json();
    var text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    return { content: [{ type: 'text', text: text }] };
  }
  throw new Error('Groq rate limit aşıldı. 1 dakika bekleyip tekrar deneyin.');
}

// ─── Render Dashboard ─────────────────────────────────────────────────────────
function renderDashboard(ticker, data, quote, forecast, analysis) {
  renderHero(ticker, data, quote);
  renderMetrics(data, quote, forecast);
  renderMainChart(data, forecast);
  renderTrendChart(data);
  renderSeasChart(forecast.weekly_pattern);
  renderVolumeChart(data);
  renderAnalysis(analysis);
  renderForecastTable(forecast, quote);
  dashboard.style.display = 'block';
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function renderHero(ticker, data, quote) {
  var price  = quote.price || data[data.length-1].close;
  var prev   = quote.prevClose || (data.length >= 2 ? data[data.length-2].close : price);
  var change = price - prev;
  var pct    = change / prev * 100;
  var up     = change >= 0;
  var now    = new Date().toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' });

  $('ticker-hero').innerHTML =
    '<div><span class="hero-symbol">' + ticker + '</span>' +
    '<span class="hero-exchange">' + (quote.exchange || '') + '</span></div>' +
    '<span class="hero-name">' + (quote.name || ticker) + '</span>' +
    '<span class="hero-price">' + fmtPrice(price, quote.currency) + '</span>' +
    '<span class="hero-change ' + (up ? 'up' : 'down') + '">' +
    (up ? '+' : '') + fmtPrice(change, quote.currency) + ' (' + (up ? '+' : '') + pct.toFixed(2) + '%)</span>' +
    '<span class="hero-updated">Güncellendi: ' + now + '</span>';
}

// ─── Metrics ──────────────────────────────────────────────────────────────────
function renderMetrics(data, quote, forecast) {
  var pct = forecast.change_pct || 0;
  var up  = pct >= 0;
  var cur = quote.currency;
  var metrics = [
    { label:'Hedef Fiyat', value: fmtPrice(forecast.target_price, cur), sub: (forecast.forecast_table ? forecast.forecast_table.length : 0) + ' hafta', cls: up?'up':'down' },
    { label:'Beklenen Δ',  value: (up?'+':'') + pct.toFixed(1) + '%', sub: 'bugüne göre', cls: up?'up':'down' },
    { label:'80% CI Alt',  value: fmtPrice(forecast.ci_lower, cur), sub: 'alt sınır' },
    { label:'80% CI Üst',  value: fmtPrice(forecast.ci_upper, cur), sub: 'üst sınır' },
    { label:'Dönem Yüksek',value: fmtPrice(quote.fiftyTwoHigh || calcMax(data), cur) },
    { label:'Dönem Düşük', value: fmtPrice(quote.fiftyTwoLow  || calcMin(data), cur) },
    { label:'Hacim',       value: fmtVol(quote.volume || data[data.length-1].volume) },
    { label:'Trend',       value: (forecast.trend_direction || 'n/a').toUpperCase() },
  ];
  $('metrics-grid').innerHTML = metrics.map(function(m) {
    return '<div class="metric-card">' +
      '<div class="m-label">' + m.label + '</div>' +
      '<div class="m-value ' + (m.cls||'') + '">' + m.value + '</div>' +
      (m.sub ? '<div class="m-sub">' + m.sub + '</div>' : '') +
      '</div>';
  }).join('');
}

// ─── Main Chart ───────────────────────────────────────────────────────────────
function renderMainChart(data, forecast) {
  $('main-chart-title').textContent = state.ticker + ' — Fiyat Geçmişi & Tahmin';
  var histLabels = data.map(function(d) { return d.date; });
  var histPrices = data.map(function(d) { return d.close; });
  var lastClose  = histPrices[histPrices.length - 1];
  var fcRows     = forecast.forecast_table || [];
  var fcDates    = fcRows.map(function(r) { return new Date(r.date); });
  var fcYhat     = fcRows.map(function(r) { return r.yhat; });
  var fcLow      = fcRows.map(function(r) { return r.lower; });
  var fcHigh     = fcRows.map(function(r) { return r.upper; });
  var allLabels  = histLabels.concat(fcDates);

  var histDs = allLabels.map(function(_, i) { return i < histLabels.length ? histPrices[i] : null; });
  var fcDs   = allLabels.map(function(_, i) {
    var idx = i - histLabels.length;
    if (i === histLabels.length - 1) return lastClose;
    if (idx >= 0 && idx < fcYhat.length) return fcYhat[idx];
    return null;
  });
  var ciHiDs = allLabels.map(function(_, i) {
    var idx = i - histLabels.length;
    return (idx >= 0 && idx < fcHigh.length) ? fcHigh[idx] : null;
  });
  var ciLoDs = allLabels.map(function(_, i) {
    var idx = i - histLabels.length;
    return (idx >= 0 && idx < fcLow.length) ? fcLow[idx] : null;
  });

  destroyChart('main');
  state.charts.main = new Chart($('mainChart').getContext('2d'), {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        { label:'Gerçek', data:histDs, borderColor:'#3b82f6', borderWidth:1.5, pointRadius:0, tension:0.2, fill:false },
        { label:'Tahmin', data:fcDs,   borderColor:'#22c55e', borderWidth:2.5, pointRadius:0, tension:0.3, fill:false },
        { label:'CI Üst', data:ciHiDs, borderColor:'rgba(34,197,94,0.2)', borderWidth:1, pointRadius:0, tension:0.3, fill:false },
        { label:'CI Alt', data:ciLoDs, borderColor:'rgba(34,197,94,0.2)', borderWidth:1, pointRadius:0, tension:0.3, fill:'-1', backgroundColor:'rgba(34,197,94,0.07)' },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false, animation:{ duration:600 },
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ display:false },
        tooltip:{ backgroundColor:'#1e2330', borderColor:'rgba(255,255,255,0.1)', borderWidth:1, padding:10,
          callbacks:{
            title: function(i) { return fmtDate(i[0] && i[0].label); },
            label: function(c) { return c.raw == null ? null : ' ' + c.dataset.label + ': ' + fmtPrice(c.raw); }
          }
        },
      },
      scales:{
        x:{ type:'time', time:{ unit:'month', displayFormats:{ month:'MMM yy' } }, grid:{ color:'rgba(255,255,255,0.05)' }, ticks:{ color:'#556070', font:{ size:11 }, maxTicksLimit:10 } },
        y:{ grid:{ color:'rgba(255,255,255,0.05)' }, ticks:{ color:'#556070', font:{ size:11 }, callback: function(v) { return fmtPrice(v); } } },
      },
    },
  });
  $('chart-legend').innerHTML =
    '<div class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span>Gerçek</div>' +
    '<div class="legend-item"><span class="legend-dot" style="background:#22c55e"></span>Tahmin</div>' +
    '<div class="legend-item"><span class="legend-dot" style="background:rgba(34,197,94,0.3);height:8px"></span>%80 CI</div>';
}

// ─── Trend Chart ──────────────────────────────────────────────────────────────
function renderTrendChart(data) {
  var period = Math.min(30, Math.floor(data.length / 4));
  var prices = data.map(function(d) { return d.close; });
  var sma    = prices.map(function(_, i) {
    if (i < period - 1) return null;
    var slice = prices.slice(i - period + 1, i + 1);
    return slice.reduce(function(a, b) { return a + b; }, 0) / period;
  });
  destroyChart('trend');
  state.charts.trend = new Chart($('trendChart').getContext('2d'), {
    type:'line',
    data:{ labels: data.map(function(d){return d.date;}), datasets:[
      { data:prices, borderColor:'rgba(59,130,246,0.3)', borderWidth:1, pointRadius:0, fill:false, tension:0.2 },
      { data:sma,    borderColor:'#3b82f6',              borderWidth:2, pointRadius:0, fill:false, tension:0.4 },
    ]},
    options: chartBase({ yFmt: function(v) { return fmtPrice(v); } }),
  });
}

// ─── Seasonality Chart ────────────────────────────────────────────────────────
function renderSeasChart(wp) {
  if (!wp || !wp.length) return;
  var values = wp.map(function(p) { return +(p.effect * 100).toFixed(3); });
  var colors = values.map(function(v) { return v >= 0 ? '#22c55e' : '#ef4444'; });
  destroyChart('seas');
  state.charts.seas = new Chart($('seasChart').getContext('2d'), {
    type:'bar',
    data:{ labels: wp.map(function(p){return p.day;}), datasets:[{ data:values, backgroundColor:colors, borderRadius:4 }] },
    options:{ responsive:true, maintainAspectRatio:false, animation:{ duration:400 },
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ grid:{ display:false }, ticks:{ color:'#556070', font:{ size:12 } } },
        y:{ grid:{ color:'rgba(255,255,255,0.05)' }, ticks:{ color:'#556070', font:{ size:11 }, callback: function(v){ return v.toFixed(1)+'%'; } } },
      },
    },
  });
}

// ─── Volume Chart ─────────────────────────────────────────────────────────────
function renderVolumeChart(data) {
  var colors = data.map(function(d, i) { return i > 0 && d.close >= data[i-1].close ? '#22c55e' : '#ef4444'; });
  destroyChart('vol');
  state.charts.vol = new Chart($('volChart').getContext('2d'), {
    type:'bar',
    data:{ labels: data.map(function(d){return d.date;}), datasets:[{ data: data.map(function(d){return d.volume;}), backgroundColor:colors, borderRadius:1 }] },
    options:{ responsive:true, maintainAspectRatio:false, animation:{ duration:400 },
      plugins:{ legend:{ display:false },
        tooltip:{ backgroundColor:'#1e2330', borderColor:'rgba(255,255,255,0.1)', borderWidth:1,
          callbacks:{ title: function(i){ return fmtDate(i[0]&&i[0].label); }, label: function(c){ return ' Hacim: '+fmtVol(c.raw); } }
        }
      },
      scales:{
        x:{ type:'time', time:{ unit:'month', displayFormats:{ month:'MMM yy' } }, grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#556070', font:{ size:10 }, maxTicksLimit:8 } },
        y:{ grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#556070', font:{ size:11 }, callback: function(v){ return fmtVol(v); } } },
      },
    },
  });
}

// ─── Chart base options ───────────────────────────────────────────────────────
function chartBase(opts) {
  opts = opts || {};
  return {
    responsive:true, maintainAspectRatio:false, animation:{ duration:400 },
    plugins:{ legend:{ display:false }, tooltip:{ backgroundColor:'#1e2330', borderColor:'rgba(255,255,255,0.1)', borderWidth:1,
      callbacks: opts.yFmt ? { label: function(c){ return ' '+opts.yFmt(c.raw); } } : {}
    }},
    scales:{
      x:{ type:'time', time:{ unit:'month', displayFormats:{ month:'MMM yy' } }, grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#556070', font:{ size:10 }, maxTicksLimit:8 } },
      y:{ grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#556070', font:{ size:11 }, callback: opts.yFmt || function(v){ return v; } } },
    },
  };
}

// ─── AI Analysis Render ───────────────────────────────────────────────────────
function renderAnalysis(analysis) {
  var el = $('ai-analysis');
  if (!analysis) { el.innerHTML = '<p style="color:var(--text3);font-size:13px">Analiz mevcut değil.</p>'; return; }
  var signalClass = { BUY:'signal-buy', SELL:'signal-sell', HOLD:'signal-hold' }[analysis.signal] || 'signal-hold';
  var html = '<div class="analysis-section"><span class="signal-badge ' + signalClass + '">' + (analysis.signal || 'HOLD') + '</span></div>';
  [['Trend', analysis.trend], ['Momentum', analysis.momentum], ['Risk', analysis.risk], ['Görünüm', analysis.outlook]].forEach(function(pair) {
    if (pair[1]) html += '<div class="analysis-section"><h4>' + pair[0] + '</h4><p>' + pair[1] + '</p></div>';
  });
  html += '<p style="font-size:11px;color:var(--text3);margin-top:12px">⚠ AI tarafından üretildi. Yatırım tavsiyesi değildir.</p>';
  el.innerHTML = html;
}

// ─── Forecast Table ───────────────────────────────────────────────────────────
function renderForecastTable(forecast, quote) {
  var rows = forecast.forecast_table || [];
  var last = forecast.last_price;
  var cur  = quote.currency;
  $('fc-count-badge').textContent = rows.length + ' hafta';
  $('fc-tbody').innerHTML = rows.map(function(row) {
    var pct = (row.yhat - last) / last * 100;
    var up  = pct >= 0;
    return '<tr>' +
      '<td>' + row.date + '</td>' +
      '<td>' + fmtPrice(row.yhat, cur) + '</td>' +
      '<td style="color:var(--text2)">' + fmtPrice(row.lower, cur) + '</td>' +
      '<td style="color:var(--text2)">' + fmtPrice(row.upper, cur) + '</td>' +
      '<td class="' + (up?'td-up':'td-down') + '">' + (up?'▲':'▼') + ' ' + Math.abs(pct).toFixed(1) + '%</td>' +
      '</tr>';
  }).join('');
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
$('export-btn').addEventListener('click', function() {
  if (!state.forecast || !state.forecast.forecast_table) return;
  var rows = state.forecast.forecast_table;
  var csv  = ['Date,Forecast,Lower_80,Upper_80,Change_Pct'].concat(rows.map(function(r) {
    var pct = ((r.yhat - state.forecast.last_price) / state.forecast.last_price * 100).toFixed(2);
    return r.date + ',' + r.yhat.toFixed(4) + ',' + r.lower.toFixed(4) + ',' + r.upper.toFixed(4) + ',' + pct;
  })).join('\n');
  downloadFile(state.ticker + '_forecast.csv', csv, 'text/csv');
});

// ─── Compare ──────────────────────────────────────────────────────────────────
var compareInput  = $('compare-input');
var compareChips  = $('compare-chips');
var compareRunBtn = $('compare-run-btn');

function renderCompareChips() {
  compareChips.innerHTML = state.compareList.map(function(sym, i) {
    var color = CHART_COLORS[i % CHART_COLORS.length];
    return '<div class="compare-chip" style="border-color:' + color + '44">' +
      '<span style="color:' + color + '">' + sym + '</span>' +
      '<button class="chip-remove" data-sym="' + sym + '">×</button></div>';
  }).join('');
}
renderCompareChips();

compareChips.addEventListener('click', function(e) {
  var btn = e.target.closest('.chip-remove');
  if (!btn) return;
  state.compareList = state.compareList.filter(function(s) { return s !== btn.dataset.sym; });
  renderCompareChips();
});
compareInput.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  var sym = e.target.value.trim().toUpperCase();
  if (sym && state.compareList.indexOf(sym) === -1) { state.compareList.push(sym); renderCompareChips(); }
  e.target.value = '';
});
bindPills('compare-range-group', 'compareRange');
compareRunBtn.addEventListener('click', async function() {
  if (!state.compareList.length) return;
  compareRunBtn.disabled = true; compareRunBtn.textContent = 'Yükleniyor…';
  try {
    var range   = (document.querySelector('#compare-range-group .pill.active') || {}).dataset && document.querySelector('#compare-range-group .pill.active').dataset.range || '6mo';
    var results = await Promise.all(state.compareList.map(function(sym) { return fetchHistory(sym, range); }));
    renderCompareChart(state.compareList, results);
  } catch(e) { alert('Hata: ' + e.message); }
  finally {
    compareRunBtn.disabled = false;
    compareRunBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Karşılaştır';
  }
});

function renderCompareChart(tickers, datasets) {
  destroyChart('compare');
  var allDates = Array.from(new Set(datasets.reduce(function(acc, d) { return acc.concat(d.map(function(p) { return p.date.getTime(); })); }, []))).sort();
  var labels   = allDates.map(function(t) { return new Date(t); });
  var chartDs  = tickers.map(function(sym, i) {
    var map  = {};
    datasets[i].forEach(function(p) { map[p.date.getTime()] = p.close; });
    var base = datasets[i][0] ? datasets[i][0].close : 1;
    return {
      label: sym,
      data:  allDates.map(function(t) { return map[t] != null ? +(map[t] / base * 100).toFixed(2) : null; }),
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      borderWidth: 2, pointRadius: 0, tension: 0.2, fill: false,
    };
  });
  state.charts.compare = new Chart($('compareChart').getContext('2d'), {
    type:'line', data:{ labels:labels, datasets:chartDs },
    options:{
      responsive:true, maintainAspectRatio:false, interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{ display:false }, tooltip:{ backgroundColor:'#1e2330', borderColor:'rgba(255,255,255,0.1)', borderWidth:1,
        callbacks:{ title: function(i){ return fmtDate(i[0]&&i[0].label); }, label: function(c){ return ' '+c.dataset.label+': '+(c.raw||0).toFixed(1); } }
      }},
      scales:{
        x:{ type:'time', time:{ unit:'month', displayFormats:{ month:'MMM yy' } }, grid:{ color:'rgba(255,255,255,0.05)' }, ticks:{ color:'#556070', font:{ size:11 } } },
        y:{ grid:{ color:'rgba(255,255,255,0.05)' }, ticks:{ color:'#556070', font:{ size:11 }, callback: function(v){ return v.toFixed(0); } } },
      },
    },
  });
  $('compare-legend').innerHTML = tickers.map(function(sym, i) {
    return '<div class="legend-item"><span class="legend-dot" style="background:' + CHART_COLORS[i%CHART_COLORS.length] + '"></span>' + sym + '</div>';
  }).join('');
}

// ─── Watchlist ────────────────────────────────────────────────────────────────
var watchInput  = $('watchlist-input');
var watchAddBtn = $('watchlist-add-btn');

watchAddBtn.addEventListener('click', function() {
  var sym = watchInput.value.trim().toUpperCase();
  if (sym && state.watchlist.indexOf(sym) === -1) { state.watchlist.push(sym); saveWatchlist(); refreshWatchlist(); }
  watchInput.value = '';
});
watchInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') watchAddBtn.click(); });

async function refreshWatchlist() {
  var grid = $('watchlist-grid');
  if (!state.watchlist.length) { grid.innerHTML = '<div class="empty-state">Yukarıdan ticker ekleyin</div>'; return; }
  grid.innerHTML = state.watchlist.map(function(sym) {
    var id = sym.replace('/','_');
    return '<div class="watch-card" id="wc-' + id + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
      '<div><div class="w-sym">' + sym + '</div><div class="w-name">Yükleniyor…</div></div>' +
      '<button class="watch-remove" data-sym="' + sym + '">×</button></div>' +
      '<div class="w-price">—</div><div class="w-delta">—</div>' +
      '<div class="watch-mini-chart"><canvas id="wmc-' + id + '"></canvas></div></div>';
  }).join('');

  grid.querySelectorAll('.watch-remove').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      state.watchlist = state.watchlist.filter(function(s) { return s !== btn.dataset.sym; });
      saveWatchlist(); refreshWatchlist();
    });
  });
  grid.querySelectorAll('.watch-card').forEach(function(card) {
    card.addEventListener('click', function(e) {
      if (e.target.closest('.watch-remove')) return;
      tickerInput.value = card.querySelector('.w-sym').textContent;
      document.querySelector('[data-view="forecast"]').click();
      runForecast();
    });
  });
  await Promise.allSettled(state.watchlist.map(function(sym) { return loadWatchCard(sym); }));
}

async function loadWatchCard(sym) {
  try {
    var data  = await fetchHistory(sym, '3mo');
    var quote = await fetchQuote(sym, data);
    var id    = sym.replace('/','_');
    var card  = $('wc-' + id);
    if (!card) return;
    var price = quote.price || (data[data.length-1] && data[data.length-1].close) || 0;
    var prev  = quote.prevClose || (data.length >= 2 ? data[data.length-2].close : price);
    var pct   = (price - prev) / prev * 100;
    var up    = pct >= 0;
    card.querySelector('.w-name').textContent  = quote.name || sym;
    card.querySelector('.w-price').textContent = fmtPrice(price, quote.currency);
    var d = card.querySelector('.w-delta');
    d.textContent = (up ? '▲ +' : '▼ ') + Math.abs(pct).toFixed(2) + '%';
    d.className = 'w-delta ' + (up ? 'up' : 'down');
    var prices = data.map(function(d) { return d.close; });
    var ctx = document.getElementById('wmc-' + id);
    if (!ctx) return;
    new Chart(ctx.getContext('2d'), {
      type:'line',
      data:{ labels: prices.map(function(_,i){ return i; }), datasets:[{ data:prices, borderColor:up?'#22c55e':'#ef4444', borderWidth:1.5, pointRadius:0, fill:false, tension:0.3 }] },
      options:{ responsive:true, maintainAspectRatio:false, animation:false, plugins:{ legend:{ display:false }, tooltip:{ enabled:false } }, scales:{ x:{ display:false }, y:{ display:false } } },
    });
  } catch(e) { /* sessizce atla */ }
}

function saveWatchlist() { localStorage.setItem('wl', JSON.stringify(state.watchlist)); }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtPrice(v, currency) {
  if (v == null || isNaN(v)) return '—';
  var s = (currency && currency !== 'USD') ? currency + ' ' : '$';
  if (v < 1)     return s + v.toFixed(4);
  if (v < 100)   return s + v.toFixed(2);
  if (v < 10000) return s + v.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
  return s + Math.round(v).toLocaleString();
}
function fmtVol(v) {
  if (!v) return '—';
  if (v >= 1e9) return (v/1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v/1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v/1e3).toFixed(0) + 'K';
  return String(v);
}
function fmtDate(d) {
  if (!d) return '';
  var dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString('tr-TR', { month:'short', day:'numeric', year:'numeric' });
}
function calcChange(data, days) {
  if (data.length < 2) return 0;
  var end   = data[data.length-1].close;
  var start = data[Math.max(0, data.length-1-days)].close;
  return (end - start) / start * 100;
}
function calcMax(data) { return Math.max.apply(null, data.map(function(d){ return d.high || d.close; })); }
function calcMin(data) { return Math.min.apply(null, data.map(function(d){ return d.low  || d.close; })); }
function destroyChart(key) { if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; } }
function destroyAllCharts() { Object.keys(state.charts).forEach(function(k) { destroyChart(k); }); }
function showLoading(msg) { loadingMsg.textContent = msg || 'Yükleniyor…'; loadingState.style.display = 'flex'; dashboard.style.display = 'none'; }
function hideLoading() { loadingState.style.display = 'none'; }
function hideError()   { errorBanner.style.display  = 'none'; }
function showError(msg){ errorBanner.textContent = '⚠ ' + msg; errorBanner.style.display = 'block'; }
function downloadFile(filename, content, type) {
  var blob = new Blob([content], { type: type });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
(function() {
  tickerInput.value = state.ticker;
  var keysOk = GROQ_API_KEY    !== 'YOUR_GROQ_API_KEY_HERE'
            && TWELVE_DATA_KEY !== 'YOUR_TWELVEDATA_KEY_HERE';
  if (keysOk) {
    runForecast();
  } else {
    showError('Hoş geldiniz! app.js dosyasını açın: GROQ_API_KEY (console.groq.com) ve TWELVE_DATA_KEY (twelvedata.com/account/new) değerlerini girin. Her ikisi de ücretsizdir.');
  }
})();
