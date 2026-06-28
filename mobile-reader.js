(() => {
  const library = window.FRENCH_LIBRARY || { articles: [], generatedAt: '' };
  const state = {
    article: null,
    articles: library.articles || [],
    filtered: library.articles || [],
    voices: [],
    queue: [],
    cursor: 0,
    activeSentence: null,
    paused: false,
    selectedText: ''
  };

  const $ = id => document.getElementById(id);
  const synth = window.speechSynthesis;
  const segmenter = 'Segmenter' in Intl ? new Intl.Segmenter('fr', { granularity: 'sentence' }) : null;

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeWord(text) {
    return clean(text).toLocaleLowerCase('fr').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  }

  function splitSentences(text) {
    const source = clean(text);
    if (!source) return [];
    if (segmenter) return [...segmenter.segment(source)].map(item => clean(item.segment)).filter(Boolean);
    return source.match(/[^.!?…]+[.!?…»"]*/g)?.map(clean).filter(Boolean) || [source];
  }

  function splitWords(sentence) {
    return sentence.split(/([\p{L}][\p{L}'’.-]*|\s+|[^\p{L}\s]+)/gu).filter(part => part !== '');
  }

  function loadVoices() {
    const all = synth ? synth.getVoices() : [];
    state.voices = all.filter(v => /^fr([_-]|$)/i.test(v.lang));
    state.voices.sort((a, b) => scoreVoice(b) - scoreVoice(a));
  }

  function scoreVoice(voice) {
    let score = 0;
    if (/fr-CH/i.test(voice.lang)) score += 50;
    if (/Ariane/i.test(voice.name)) score += 80;
    if (/female|Amelie|Audrey|Marie|Ariane|Lea/i.test(voice.name)) score += 10;
    if (voice.default) score += 1;
    return score;
  }

  function speak(text, onend) {
    if (!synth || !text) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fr-CH';
    utterance.rate = Number($('rateInput').value || 0.9);
    const voice = state.voices[0];
    if (voice) utterance.voice = voice;
    utterance.onend = () => onend && onend();
    synth.speak(utterance);
  }

  function renderList() {
    $('articleCount').textContent = `${state.filtered.length} 篇`;
    $('cacheDate').textContent = library.generatedAt ? `缓存 ${library.generatedAt}` : '';
    const list = $('articleList');
    list.innerHTML = '';
    state.filtered.forEach((article, index) => {
      const button = document.createElement('button');
      button.className = 'article-card';
      button.innerHTML = `<strong></strong><small></small>`;
      button.querySelector('strong').textContent = article.title;
      button.querySelector('small').textContent = `${article.paragraphs?.length || 0} 段 · ${article.modified || ''}`;
      button.onclick = () => openArticle(article, index);
      list.appendChild(button);
    });
  }

  function showScreen(name) {
    $('libraryView').classList.toggle('active', name === 'library');
    $('readerView').classList.toggle('active', name === 'reader');
  }

  function openArticle(article) {
    stop();
    state.article = article;
    $('articleTitle').textContent = article.title;
    $('articleMeta').textContent = `${article.fileName || ''} · ${article.modified || ''}`;
    renderArticle(article);
    showScreen('reader');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderArticle(article) {
    const content = $('content');
    content.innerHTML = '';
    (article.paragraphs || []).forEach((paragraph, paragraphIndex) => {
      const p = document.createElement('p');
      p.className = 'paragraph';
      const text = paragraph.text || '';
      const sentences = splitSentences(text);
      sentences.forEach((sentence, sentenceIndex) => {
        const span = document.createElement('span');
        span.className = 'sentence';
        span.dataset.text = sentence;
        span.dataset.key = `${paragraphIndex}-${sentenceIndex}`;
        splitWords(sentence).forEach(part => {
          if (/^[\p{L}][\p{L}'’.-]*$/u.test(part)) {
            const word = document.createElement('span');
            word.className = 'word';
            word.textContent = part;
            word.dataset.word = part;
            word.onclick = event => {
              event.stopPropagation();
              showLookup(part, 'word');
            };
            span.appendChild(word);
          } else {
            span.appendChild(document.createTextNode(part));
          }
        });
        span.onclick = () => {
          showLookup(sentence, 'sentence');
          playFromSentence(span);
        };
        p.appendChild(span);
        p.appendChild(document.createTextNode(' '));
      });
      content.appendChild(p);
    });
  }

  function allSentenceSpans() {
    return [...document.querySelectorAll('.sentence')];
  }

  function buildQueue(startSpan) {
    const spans = allSentenceSpans();
    const start = startSpan ? Math.max(0, spans.indexOf(startSpan)) : 0;
    state.queue = spans.slice(start).map(span => ({ span, text: span.dataset.text }));
    state.cursor = 0;
  }

  function markActive(span) {
    if (state.activeSentence) state.activeSentence.classList.remove('active');
    state.activeSentence = span;
    if (span) {
      span.classList.add('active');
      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function playNext() {
    if (state.cursor >= state.queue.length) {
      markActive(null);
      return;
    }
    const item = state.queue[state.cursor++];
    markActive(item.span);
    speak(item.text, playNext);
  }

  function playFromSentence(span) {
    buildQueue(span);
    playNext();
  }

  function playAll() {
    buildQueue(null);
    playNext();
  }

  function pauseResume() {
    if (!synth) return;
    if (synth.paused) {
      synth.resume();
      $('pauseButton').textContent = '暂停';
    } else {
      synth.pause();
      $('pauseButton').textContent = '继续';
    }
  }

  function stop() {
    if (synth) synth.cancel();
    state.queue = [];
    state.cursor = 0;
    $('pauseButton').textContent = '暂停';
    markActive(null);
  }

  async function translate(text, type) {
    const target = 'zh-CN';
    const key = `mobile-translation:${target}:${type}:${normalizeWord(text) || text}`;
    const cached = localStorage.getItem(key);
    if (cached) return cached;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=fr&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    const data = await response.json();
    const translated = data?.[0]?.map(part => part?.[0] || '').join('').trim();
    if (!translated) throw new Error('No translation');
    localStorage.setItem(key, translated);
    return translated;
  }

  function showLookup(text, type) {
    const normalized = type === 'word' ? normalizeWord(text) : clean(text);
    if (!normalized) return;
    state.selectedText = normalized;
    $('sheetType').textContent = type === 'word' ? '单词' : '句子';
    $('sheetTitle').textContent = normalized;
    $('translation').textContent = '正在查询...';
    const encoded = encodeURIComponent(normalized);
    $('openTranslate').href = `https://translate.google.com/?sl=fr&tl=zh-CN&text=${encoded}&op=translate`;
    $('openDictionary').href = type === 'word'
      ? `https://www.wordreference.com/fren/${encoded}`
      : `https://context.reverso.net/translation/french-english/${encoded}`;
    $('sheet').classList.add('visible');
    $('sheet').setAttribute('aria-hidden', 'false');
    translate(normalized, type)
      .then(result => { $('translation').textContent = result; })
      .catch(() => { $('translation').textContent = '暂时无法自动翻译，请点上方翻译或词典链接。'; });
  }

  function closeSheet() {
    $('sheet').classList.remove('visible');
    $('sheet').setAttribute('aria-hidden', 'true');
  }

  function bindEvents() {
    $('searchInput').oninput = event => {
      const q = clean(event.target.value).toLocaleLowerCase('fr');
      state.filtered = !q ? state.articles : state.articles.filter(article => {
        const body = (article.paragraphs || []).map(p => p.text).join(' ');
        return `${article.title} ${body}`.toLocaleLowerCase('fr').includes(q);
      });
      renderList();
    };
    $('backButton').onclick = () => { stop(); showScreen('library'); };
    $('playButton').onclick = playAll;
    $('pauseButton').onclick = pauseResume;
    $('stopButton').onclick = stop;
    $('focusButton').onclick = () => state.activeSentence?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('rateInput').oninput = () => { $('rateValue').textContent = `${Number($('rateInput').value).toFixed(2)}x`; };
    $('closeSheet').onclick = closeSheet;
    $('sheet').onclick = event => { if (event.target.id === 'sheet') closeSheet(); };
    $('speakSelection').onclick = () => speak(state.selectedText);
    $('installHint').onclick = () => alert('在 iPhone Safari 中点“分享”按钮，然后选择“添加到主屏幕”。');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('mobile-sw.js').catch(() => {});
  }
  if (synth) {
    loadVoices();
    synth.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 500);
  }
  bindEvents();
  renderList();
})();
