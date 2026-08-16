    /* ================================================
       KONFIGURACJA SUPABASE
       ================================================ */

    const CONFIG = {
      supabaseUrl: 'https://oypcxvvlrgoeugtnwzpr.supabase.co',
      supabaseKey: 'sb_publishable_bcLT02UuG5OkUXB4bKaLqg_CguRWD4a',
      userId: '00000000-0000-0000-0000-000000000001',
    };

    let supabaseClient = null;
    try {
      if (window.supabase) {
        supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
      } else {
        console.warn('Biblioteka Supabase nie załadowała się — działam tylko lokalnie.');
      }
    } catch (e) {
      console.warn('Nie udało się połączyć z Supabase — działam tylko lokalnie:', e);
    }

    /* ================================================
       DANE — zapis i odczyt z localStorage + Supabase
       ================================================ */

    const STORAGE_KEY = 'dziennik-journal-v1';
    let journalData = {};

    function loadJournal() {
      try { journalData = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
      catch (e) { journalData = {}; }
    }

    function saveJournal() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(journalData));
    }

    // Pobiera wszystkie dni z Supabase i scala je z danymi lokalnymi
    // (Supabase wygrywa tylko jeśli jego wersja jest nowsza niż lokalna)
    async function syncFromSupabase() {
      if (!supabaseClient) return;
      try {
        const { data, error } = await supabaseClient
          .from('journal')
          .select('*')
          .eq('user_id', CONFIG.userId);

        if (error) { console.warn('Supabase odczyt nieudany:', error.message); return; }

        data.forEach(row => {
          const key = row.date;
          const remoteTime = new Date(row.updated_at).getTime();
          const local = journalData[key];
          const localTime = local && local.updatedAt ? new Date(local.updatedAt).getTime() : 0;

          if (!local || remoteTime > localTime) {
            journalData[key] = {
              text: row.text || '',
              energyEntries: row.energy_entries || [],
              updatedAt: row.updated_at,
            };
          }
        });

        saveJournal();
        buildCalendar();
        buildStream();
      } catch (e) {
        console.warn('Supabase niedostępny, działam offline:', e);
      }
    }

    // Wysyła dany dzień do Supabase (upsert — nadpisuje lub tworzy wiersz)
    async function syncDayToSupabase(key) {
      const day = journalData[key];
      if (!day) return;
      const nowIso = new Date().toISOString();
      day.updatedAt = nowIso;
      saveJournal();

      if (!supabaseClient) return;

      try {
        const { error } = await supabaseClient
          .from('journal')
          .upsert({
            user_id: CONFIG.userId,
            date: key,
            text: day.text || '',
            energy_entries: day.energyEntries || [],
            updated_at: nowIso,
          }, { onConflict: 'user_id,date' });

        if (error) console.warn('Supabase zapis nieudany:', error.message);
      } catch (e) {
        console.warn('Supabase niedostępny, zapisano tylko lokalnie:', e);
      }
    }

    /* ================================================
       AKTYWNY MIESIĄC — który miesiąc jest aktualnie wyświetlany
       ================================================ */

    const _now = new Date();
    let viewYear  = _now.getFullYear();
    let viewMonth = _now.getMonth() + 1; // 1-12

    /* ================================================
       POMOCNICZE FUNKCJE DATY
       ================================================ */

    const WEEKDAYS = ['Niedziela','Poniedziałek','Wtorek','Środa','Czwartek','Piątek','Sobota'];
    const MONTHS   = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec',
                      'Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];

    // Zwraca klucz dzisiejszej daty w formacie YYYY-MM-DD
    function todayKey() {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    // Tworzy klucz daty z podanych wartości
    function dateKey(year, month, day) {
      return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }

    // Zwraca liczbę dni w miesiącu
    function daysInMonth(year, month) {
      return new Date(year, month, 0).getDate();
    }

    // Formatuje klucz do polskiej nazwy daty np. "Poniedziałek, 1 Czerwiec 2026"
    function formatDate(key) {
      const date = new Date(key + 'T12:00:00');
      return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    }

    // Zwraca rok, miesiąc, dzień i liczbę dni w bieżącym miesiącu
    function currentDate() {
      const now = new Date();
      const year  = now.getFullYear();
      const month = now.getMonth() + 1;
      return { year, month, today: now.getDate(), total: daysInMonth(year, month) };
    }

    /* ================================================
       KALENDARZ
       ================================================ */

    // Buduje siatkę kalendarza dla viewYear/viewMonth
    function buildCalendar() {
      const { today, year: todayYear, month: todayMonth } = currentDate();
      const total   = daysInMonth(viewYear, viewMonth);
      const isToday = viewYear === todayYear && viewMonth === todayMonth;
      const grid    = document.getElementById('cal-grid');
      grid.innerHTML = '';

      document.getElementById('header-title').textContent =
        MONTHS[viewMonth - 1].toUpperCase() + ' ' + viewYear;

      document.getElementById('cal-nav-label').textContent =
        MONTHS[viewMonth - 1] + ' ' + viewYear;

      for (let d = 1; d <= total; d++) {
        const key = dateKey(viewYear, viewMonth, d);
        const btn = document.createElement('button');
        btn.className   = 'cal-btn';
        btn.textContent = d;
        btn.dataset.day = d;
        if (isToday && d === today) btn.classList.add('today', 'selected');
        if (journalData[key] && journalData[key].text) btn.classList.add('has-entry');
        btn.addEventListener('click', () => scrollToDay(key, btn));
        grid.appendChild(btn);
      }
    }

    // Przechodzi o jeden miesiąc do przodu lub do tyłu (delta = 1 lub -1)
    function changeMonth(delta) {
      viewMonth += delta;
      if (viewMonth > 12) { viewMonth = 1;  viewYear++; }
      if (viewMonth < 1)  { viewMonth = 12; viewYear--; }
      buildCalendar();
      buildStream();
    }

    // Scrolluje dziennik do wybranego dnia i zaznacza go w kalendarzu
    function scrollToDay(key, calBtn) {
      const block  = document.getElementById('block-' + key);
      const stream = document.getElementById('stream');
      if (block && stream) {
        const diff = block.getBoundingClientRect().top - stream.getBoundingClientRect().top - 16;
        stream.scrollBy({ top: diff, behavior: 'smooth' });
      }
      document.querySelectorAll('.cal-btn').forEach(b => b.classList.remove('selected'));
      if (calBtn) {
        calBtn.classList.add('selected');
        const { today } = currentDate();
        if (parseInt(calBtn.dataset.day) === today) calBtn.classList.add('today');
      }
    }

    /* ================================================
       STREAM DZIENNIKA
       ================================================ */

    let autosaveTimer = null;

    // Dopasowuje wysokość textarea do zawartości
    function autoResize(textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }

    // Buduje strumień dziennika dla viewYear/viewMonth
    function buildStream() {
      const { today, year: todayYear, month: todayMonth } = currentDate();
      const isToday = viewYear === todayYear && viewMonth === todayMonth;
      const total   = daysInMonth(viewYear, viewMonth);
      const stream  = document.getElementById('stream');
      stream.innerHTML = '';

      for (let d = 1; d <= total; d++) {
        const key = dateKey(viewYear, viewMonth, d);
        // Przyszłe dni bieżącego miesiąca pomijamy jeśli nie mają wpisu
        if (isToday && d > today && !journalData[key]) continue;
        if (!journalData[key]) journalData[key] = { text: '' };
        stream.appendChild(buildDayBlock(key, d, isToday ? today : -1));
      }
    }

    // Tworzy pojedynczy blok dnia (data + znaczki energii + textarea)
    function buildDayBlock(key, dayNumber, todayNumber) {
      const block = document.createElement('div');
      block.className = 'day-block';
      block.id = 'block-' + key;

      const header = document.createElement('div');
      header.className = 'day-header';

      const dateLabel = document.createElement('span');
      dateLabel.className   = 'day-date';
      dateLabel.textContent = formatDate(key);
      header.appendChild(dateLabel);

      // Wiersz na kolorowe znaczki energii (godzina [liczba])
      const energyRow = document.createElement('div');
      energyRow.className = 'energy-row';
      energyRow.id = 'energy-row-' + key;

      const textarea = document.createElement('textarea');
      textarea.className   = 'day-textarea';
      textarea.value       = journalData[key].text || '';
      textarea.placeholder = (dayNumber === todayNumber) ? 'pisz...' : '';

      textarea.addEventListener('input', function () {
        autoResize(this);
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
          journalData[key] = journalData[key] || {};
          journalData[key].text = this.value;
          saveJournal();
          syncDayToSupabase(key);
          const btn = document.querySelector(`.cal-btn[data-day="${dayNumber}"]`);
          if (btn) btn.classList.toggle('has-entry', !!this.value);
        }, 500);
      });

      block.appendChild(header);
      block.appendChild(energyRow);
      block.appendChild(textarea);
      renderEnergyRow(key);
      requestAnimationFrame(() => autoResize(textarea));
      return block;
    }

    // Śledzi scroll i aktualizuje zaznaczenie w kalendarzu
    function initScrollSync() {
      const stream = document.getElementById('stream');
      stream.addEventListener('scroll', function () {
        let activeDay = null;
        document.querySelectorAll('.day-block').forEach(block => {
          if (block.getBoundingClientRect().top <= stream.getBoundingClientRect().top + 50) {
            activeDay = block.id.replace('block-', '');
          }
        });
        if (!activeDay) return;
        const dayNumber = parseInt(activeDay.split('-')[2], 10);
        document.querySelectorAll('.cal-btn').forEach(btn => {
          btn.classList.toggle('selected', parseInt(btn.dataset.day) === dayNumber);
        });
      });
    }

    /* ================================================
       ZEGAR
       ================================================ */

    // Aktualizuje zegar w kolumnie kalendarza
    function updateClock() {
      const now = new Date();
      const el  = document.getElementById('clock');
      if (el) el.textContent =
        `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    }

    // Kolory energii: 4 kolory przypisane do zakresów 0-1, 2-4, 5-8, 9-10
    const ENERGY_COLORS = ['#f4511e','#f4511e','#fb8c00','#fb8c00','#fb8c00','#7cb342','#7cb342','#7cb342','#7cb342','#2e7d32','#2e7d32'];

    // Aktualizuje cyfrę i jej kolor na suwaku
    function updateEnergyDisplay(val) {
      const el = document.getElementById('energy-value-display');
      el.textContent = val;
      el.style.color = ENERGY_COLORS[parseInt(val)];
    }

    // Otwiera popup z pytaniem o energię po kliknięciu zegara
    function insertTime() {
      // Na mobile — najpierw scrolluj do dziennika
      if (window.innerWidth <= 768) {
        const layout     = document.querySelector('.layout');
        const colJournal = document.querySelector('.col-journal');
        if (layout && colJournal) {
          layout.scrollTo({ top: colJournal.offsetTop, behavior: 'smooth' });
        }
      }
      // Reset suwaka i otwórz popup
      document.getElementById('energy-slider').value = 5;
      updateEnergyDisplay(5);
      document.getElementById('energy-overlay').classList.add('open');
    }

    // Zamyka popup energii bez wstawiania czegokolwiek
    function closeEnergyPopup() {
      document.getElementById('energy-overlay').classList.remove('open');
    }

    // Zapisuje godzinę i poziom energii jako osobny znaczek (nie dotyka textarea)
    function confirmEnergy() {
      const now    = new Date();
      const time   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const energy = parseInt(document.getElementById('energy-slider').value);
      const color  = ENERGY_COLORS[energy];
      const key    = todayKey();

      closeEnergyPopup();

      journalData[key] = journalData[key] || {};
      journalData[key].energyEntries = journalData[key].energyEntries || [];
      journalData[key].energyEntries.push({ time, energy, color });
      saveJournal();
      syncDayToSupabase(key);
      renderEnergyRow(key);

      // Przenieś focus do textarea żeby można było od razu pisać
      const ta = document.querySelector('#block-' + key + ' .day-textarea');
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
      }
    }

    // Renderuje kolorowe znaczki energii (godzina [liczba]) nad textarea danego dnia
    function renderEnergyRow(key) {
      const row = document.getElementById('energy-row-' + key);
      if (!row) return;
      const entries = (journalData[key] && journalData[key].energyEntries) || [];

      row.innerHTML = '';
      entries.forEach(({ time, energy, color }) => {
        const badge = document.createElement('span');
        badge.className = 'energy-badge';
        badge.innerHTML = `<span class="eb-time">${time}</span> <span class="eb-energy" style="color:${color}">[${energy}]</span>`;
        row.appendChild(badge);
      });
    }

    // Zamknij popup klikając w tło
    document.getElementById('energy-overlay').addEventListener('click', function (e) {
      if (e.target === this) closeEnergyPopup();
    });

    /* ================================================
       USTAWIENIA — eksport i import
       ================================================ */

    // Otwiera/zamyka menu ustawień
    function toggleSettings() {
      const menu = document.getElementById('settings-menu');
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }

    // Zamyka menu gdy klikniesz gdzieś indziej na stronie
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#settings-wrap')) {
        const menu = document.getElementById('settings-menu');
        if (menu) menu.style.display = 'none';
      }
    });

    // Eksportuje dane dziennika do pliku JSON
    function exportData() {
      const backup = {
        version:    1,
        exportedAt: new Date().toISOString(),
        journal:    journalData,
      };
      const json = JSON.stringify(backup, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `dziennik-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }

    // Importuje dane z pliku JSON
    function importData(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const backup = JSON.parse(e.target.result);
          if (!backup.journal) { alert('Nieprawidłowy plik backupu.'); return; }
          if (!confirm('Czy na pewno chcesz wczytać backup? Aktualne dane zostaną zastąpione.')) return;
          journalData = backup.journal;
          saveJournal();
          buildCalendar();
          buildStream();
          setTimeout(() => {
            const key    = todayKey();
            const block  = document.getElementById('block-' + key);
            const stream = document.getElementById('stream');
            if (block && stream) {
              const diff = block.getBoundingClientRect().top - stream.getBoundingClientRect().top - 16;
              stream.scrollBy({ top: diff, behavior: 'instant' });
            }
          }, 100);
        } catch (err) { alert('Błąd podczas wczytywania pliku.'); }
      };
      reader.readAsText(file);
      event.target.value = '';
    }

    /* ================================================
       MOTYWY
       ================================================ */

    const THEMES = {
      jasny: {
        label: 'Jasny',
        bg: '#ffffff', bgSide: '#e8e8e8',
        accent: '#1a1a1a', accentFg: '#ffffff',
        text: 'rgba(26,26,26,0.75)', textDim: 'rgba(26,26,26,0.45)',
        textFaint: 'rgba(26,26,26,0.18)',
        border: 'rgba(26,26,26,0.07)', calDot: 'rgba(26,26,26,0.12)',
        calText: 'rgba(26,26,26,0.45)',
      },
      ciemny: {
        label: 'Ciemny',
        bg: '#1e1e1e', bgSide: '#2a2a2a',
        accent: '#141414', accentFg: '#e0e0e0',
        text: 'rgba(224,224,224,0.85)', textDim: 'rgba(224,224,224,0.5)',
        textFaint: 'rgba(224,224,224,0.2)',
        border: 'rgba(255,255,255,0.07)', calDot: 'rgba(255,255,255,0.15)',
        calText: 'rgba(224,224,224,0.5)',
      },
    };

    let activeTheme = localStorage.getItem('dziennik-theme') || 'jasny';

    // Aplikuje motyw — ustawia zmienne CSS na :root
    function applyTheme(key) {
      const t = THEMES[key];
      if (!t) return;
      const root = document.documentElement.style;
      root.setProperty('--bg',          t.bg);
      root.setProperty('--bg-side',     t.bgSide);
      root.setProperty('--accent',      t.accent);
      root.setProperty('--accent-fg',   t.accentFg);
      root.setProperty('--text',        t.text);
      root.setProperty('--text-dim',    t.textDim);
      root.setProperty('--text-faint',  t.textFaint);
      root.setProperty('--border',      t.border);
      root.setProperty('--cal-dot',     t.calDot);
      root.setProperty('--cal-text',    t.calText);
      activeTheme = key;
      localStorage.setItem('dziennik-theme', key);
    }

    // Buduje przyciski motywów w menu
    function buildThemeGrid() {
      const grid = document.getElementById('theme-grid');
      grid.innerHTML = '';
      Object.keys(THEMES).forEach(key => {
        const btn = document.createElement('button');
        btn.className = 'theme-btn' + (key === activeTheme ? ' active' : '');
        btn.dataset.theme = key;
        btn.textContent = (key === activeTheme ? '✓ ' : '') + THEMES[key].label;
        btn.addEventListener('click', () => {
          applyTheme(key);
          buildThemeGrid();
        });
        grid.appendChild(btn);
      });
    }

    /* ================================================
       INICJALIZACJA
       ================================================ */

    loadJournal();
    applyTheme(activeTheme);
    buildThemeGrid();
    buildCalendar();
    buildStream();
    updateClock();
    setInterval(updateClock, 60000);
    initScrollSync();
    syncFromSupabase();

    // Przewiń do dzisiejszego dnia po załadowaniu
    setTimeout(() => {
      const key    = todayKey();
      const block  = document.getElementById('block-' + key);
      const stream = document.getElementById('stream');
      if (block && stream) {
        const diff = block.getBoundingClientRect().top - stream.getBoundingClientRect().top - 16;
        stream.scrollBy({ top: diff, behavior: 'instant' });
      }
    }, 100);

