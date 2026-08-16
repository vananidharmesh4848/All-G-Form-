/* ==========================================================
   MULTI-FORM CENTRAL DASHBOARD - DYNAMIC AGGREGATOR ENGINE
   ========================================================== */

// Application State
let appData = {
  activeTab: 'dash', // 'dash', 'details', 'linker', 'analytics'
  selectedFormId: '', // selected form ID for details tab
  summaryTimeframe: 'current_month', // '24h', 'last_week', 'current_month'
  analyticsTimeframe: 'current_month', // '24h', 'last_week', 'current_month'
  registeredForms: [], // dynamic list of connected forms: { id, name, formUrl, url, status, lastSync }
  submissions: {}, // parsed entries map: { [formId]: { headers: [], rows: [[]] } }
  chartInstanceVolume: null,
  chartInstanceShare: null
};

// Default preloaded forms list if registry is empty
const defaultPreloadedForms = [
  {
    id: 'form_cleaning_audit',
    name: 'હાજરી/સફાઈ ઓડિટ (Example Cleaning Checklist)',
    formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSf93kuoy-BdcI7PyoWexQCZyXHgAof8eKGxxQ_hFbJHXl8ftQ/viewform?usp=dialog',
    url: 'https://docs.google.com/spreadsheets/d/1YP2cycpq_e_jYITqL3h-dkCzxq_yQhEO3MYdaCqCnrc/edit?usp=sharing',
    status: 'Pending / બાકી',
    lastSync: null
  }
];

// Toast Notifications Helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);

  // Remove toast after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Format Date objects cleanly
function formatDateTime(date) {
  if (!date || isNaN(date.getTime())) return 'No Data / કોઈ એન્ટ્રી નથી';
  
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

// Relative time string helper
function getRelativeTimeString(date) {
  if (!date || isNaN(date.getTime())) return '';
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 60) return 'હમણાં જ';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} મિનિટ પહેલાં`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} કલાક પહેલાં`;
  const days = Math.floor(hours / 24);
  return `${days} દિવસ પહેલાં`;
}

// Parse CSV output exported from Google Sheet URLs
function parseCSV(csvText) {
  const lines = csvText.split(/\r?\n/);
  const result = { headers: [], rows: [] };
  if (lines.length === 0 || !lines[0].trim()) return result;
  
  // Custom CSV parser handling quotes and commas
  function parseCSVLine(line) {
    const arr = [];
    let quote = false;
    let val = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        quote = !quote;
      } else if (c === ',' && !quote) {
        arr.push(val);
        val = '';
      } else {
        val += c;
      }
    }
    arr.push(val);
    return arr.map(v => v.trim().replace(/^"|"$/g, ''));
  }

  result.headers = parseCSVLine(lines[0]);
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseCSVLine(lines[i]);
    if (row.length > 0) {
      result.rows.push(row);
    }
  }
  return result;
}

// Connect a new Google Sheet to the Dashboard registry
function bindGoogleSheet(event) {
  if (event) event.preventDefault();
  
  const name = document.getElementById('linkName').value.trim();
  const formUrl = document.getElementById('linkFormUrl').value.trim();
  const url = document.getElementById('linkSheetUrl').value.trim();

  if (!url.includes('docs.google.com/spreadsheets')) {
    alert('ગૂગલ સ્પ્રેડશીટની સાચી લિંક દાખલ કરો! / Please paste a valid Google Sheets URL');
    return;
  }

  const formId = 'form_' + Date.now();

  const newForm = {
    id: formId,
    name: name,
    formUrl: formUrl || '',
    url: url,
    status: 'Syncing... / અપડેટ થાય છે',
    lastSync: null
  };

  appData.registeredForms.push(newForm);
  appData.submissions[formId] = { headers: [], rows: [] };
  
  if (!appData.selectedFormId) {
    appData.selectedFormId = formId;
  }

  saveRegistryToStorage();

  // Clear inputs
  document.getElementById('linkName').value = '';
  document.getElementById('linkFormUrl').value = '';
  document.getElementById('linkSheetUrl').value = '';

  showToast(`Linking form "${name}"...`);

  // Sync and reload views
  syncGoogleSheet(formId).then(() => {
    renderActiveConnectionsTable();
    renderDashboardTable();
    renderFormSelector();
  });
}

// Sync a single Google Sheet via server CORS proxy
async function syncGoogleSheet(formId, quiet = false) {
  const form = appData.registeredForms.find(f => f.id === formId);
  if (!form) return;

  form.status = 'Syncing... / અપડેટ થાય છે';
  renderActiveConnectionsTable();

  try {
    const sheetIdMatch = form.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) throw new Error('Invalid Google Sheets URL');
    const spreadsheetId = sheetIdMatch[1];

    const gidMatch = form.url.match(/[#&?]gid=([0-9]+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';

    const directExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gidParam}`;
    let proxyUrl = `/api/proxy-sheet?url=${encodeURIComponent(directExportUrl)}`;
    
    // Automatically switch to public CORS proxy if hosted statically (e.g. GitHub Pages)
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && window.location.protocol !== 'file:') {
      proxyUrl = `https://corsproxy.io/?${encodeURIComponent(directExportUrl)}`;
    }
    
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`Google Sheet returned HTTP ${response.status}`);
    }

    const csvText = await response.text();
    const parsedData = parseCSV(csvText);

    appData.submissions[formId] = parsedData;
    form.status = 'Success / ચાલુ છે';
    form.lastSync = new Date();

    // Cache results in localStorage for instant offline loads
    localStorage.setItem(`cached_dynamic_subs_headers_${formId}`, JSON.stringify(parsedData.headers));
    localStorage.setItem(`cached_dynamic_subs_rows_${formId}`, JSON.stringify(parsedData.rows));

    if (!quiet) {
      showToast(`"${form.name}" updated!`);
    }
  } catch (err) {
    console.error(err);
    form.status = 'Failed / નિષ્ફળ';
    if (!quiet) {
      alert(`ભૂલ: "${form.name}" અપડેટ કરવામાં નિષ્ફળતા મળી.\nError: ${err.message}`);
    }
  }

  saveRegistryToStorage();
}

// Sync all connected Google Sheets sequentially
async function syncAllGoogleSheets() {
  if (appData.registeredForms.length === 0) return;

  const btn = document.getElementById('syncAllBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '🔄 અપડેટ થાય છે...';
  }

  showToast('Updating all dynamic forms...');

  for (const form of appData.registeredForms) {
    await syncGoogleSheet(form.id, true);
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = '🔄 લાઈવ અપડેટ કરો / Sync Sheets';
  }

  // Redraw dashboard views
  renderDashboardTable();
  if (appData.activeTab === 'details') renderFormDetailsPanel();
  if (appData.activeTab === 'analytics') updateAnalyticsCharts();

  showToast('All forms successfully updated!');
}

// Delete form link from Registry
function deleteBinding(formId) {
  const form = appData.registeredForms.find(f => f.id === formId);
  if (!form) return;

  if (!confirm(`શું તમે ખરેખર "${form.name}" ની લિંક કાઢી નાખવા માંગો છો? / Are you sure?`)) return;

  appData.registeredForms = appData.registeredForms.filter(f => f.id !== formId);
  delete appData.submissions[formId];

  // Clean caches
  localStorage.removeItem(`cached_dynamic_subs_headers_${formId}`);
  localStorage.removeItem(`cached_dynamic_subs_rows_${formId}`);
  saveRegistryToStorage();

  if (appData.selectedFormId === formId) {
    appData.selectedFormId = appData.registeredForms.length > 0 ? appData.registeredForms[0].id : '';
  }

  showToast(`"${form.name}" unlinked.`);

  renderActiveConnectionsTable();
  renderDashboardTable();
  renderFormSelector();
  renderFormDetailsPanel();
}

// Save Registry to localStorage
function saveRegistryToStorage() {
  localStorage.setItem('dynamic_registered_forms_v4', JSON.stringify(appData.registeredForms));
}

// Load Registry and cache on boot
function loadRegistryAndCache() {
  let saved = localStorage.getItem('dynamic_registered_forms_v4');
  
  if (!saved || saved === '[]') {
    appData.registeredForms = [...defaultPreloadedForms];
    saveRegistryToStorage();
  } else {
    try {
      appData.registeredForms = JSON.parse(saved);
      if (!appData.registeredForms || appData.registeredForms.length === 0) {
        appData.registeredForms = [...defaultPreloadedForms];
        saveRegistryToStorage();
      }
    } catch (e) {
      appData.registeredForms = [...defaultPreloadedForms];
    }
  }

  if (appData.registeredForms.length > 0) {
    appData.selectedFormId = appData.registeredForms[0].id;
  }

  // Load cached submissions for each form
  appData.registeredForms.forEach(form => {
    const cachedHeaders = localStorage.getItem(`cached_dynamic_subs_headers_${form.id}`);
    const cachedRows = localStorage.getItem(`cached_dynamic_subs_rows_${form.id}`);
    
    if (cachedHeaders && cachedRows) {
      try {
        const headers = JSON.parse(cachedHeaders);
        const rows = JSON.parse(cachedRows);
        appData.submissions[form.id] = {
          headers: headers,
          rows: rows
        };
      } catch (e) {
        console.error("Cache load error", e);
        appData.submissions[form.id] = { headers: [], rows: [] };
      }
    } else {
      appData.submissions[form.id] = { headers: [], rows: [] };
    }
  });
}

// Switch tabs and trigger view updates
function switchTab(tabId) {
  appData.activeTab = tabId;

  // Toggle active tab buttons
  document.querySelectorAll('.tab-link').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  // Toggle active panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.getAttribute('id') === `tab-${tabId}`);
  });

  // Load and refresh contents based on active tab
  if (tabId === 'dash') {
    renderDashboardTable();
  } else if (tabId === 'details') {
    resetDateFilter();
    renderFormSelector();
    renderFormDetailsPanel();
  } else if (tabId === 'linker') {
    renderActiveConnectionsTable();
  } else if (tabId === 'analytics') {
    // Populate analytics form selector
    const sel = document.getElementById('analyticsFormSelect');
    if (sel) {
      sel.innerHTML = '';
      appData.registeredForms.forEach(form => {
        const opt = document.createElement('option');
        opt.value = form.id;
        opt.textContent = form.name;
        opt.selected = form.id === appData.selectedFormId;
        sel.appendChild(opt);
      });
    }
    updateAnalyticsCharts();
  }
}

// Parse custom dates from various string formats (MDY or DMY)
function parseDateCell(dateStr) {
  if (!dateStr) return null;
  let d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  
  const parts = dateStr.split(/[\/\-\s:]/);
  if (parts.length >= 3) {
    const m = parseInt(parts[0]) - 1;
    const day = parseInt(parts[1]);
    const y = parseInt(parts[2]);
    const hr = parts[3] ? parseInt(parts[3]) : 0;
    const min = parts[4] ? parseInt(parts[4]) : 0;
    const sec = parts[5] ? parseInt(parts[5]) : 0;
    
    d = new Date(y, m, day, hr, min, sec);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// Helper to get active DOM filter parameters
function getCurrentFilterRange() {
  const fromVal = document.getElementById('dateFrom') ? document.getElementById('dateFrom').value : '';
  const toVal = document.getElementById('dateTo') ? document.getElementById('dateTo').value : '';

  const filterFrom = fromVal ? new Date(fromVal + 'T00:00:00') : null;
  const filterTo = toVal ? new Date(toVal + 'T23:59:59') : null;

  return { filterFrom, filterTo, isActive: (filterFrom !== null || filterTo !== null) };
}

// Calculate and render Master Dashboard grid table
function renderDashboardTable() {
  const tbody = document.getElementById('dashboardTableBody');
  const emptyState = document.getElementById('dashboardEmptyState');
  const tableContainer = document.getElementById('dashboardTableContainer');
  const syncAllBtn = document.getElementById('syncAllBtn');

  if (!tbody) return;

  const formsCount = appData.registeredForms.length;
  document.getElementById('statTotalForms').textContent = formsCount;

  if (formsCount === 0) {
    if (emptyState) emptyState.style.display = 'block';
    if (tableContainer) tableContainer.style.display = 'none';
    if (syncAllBtn) syncAllBtn.style.display = 'none';
    
    document.getElementById('statActive24h').textContent = '0';
    document.getElementById('statTotal24h').textContent = '0';
    document.getElementById('statTotalSubmissions').textContent = '0';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (tableContainer) tableContainer.style.display = 'block';
  if (syncAllBtn) syncAllBtn.style.display = 'inline-block';

  tbody.innerHTML = '';

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let activeFormsInPeriod = 0;
  let total24hSubmissions = 0;
  let grandTotalSubmissions = 0;

  const { filterFrom, filterTo, isActive: isCustomFilterActive } = getCurrentFilterRange();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  appData.registeredForms.forEach(form => {
    const subData = appData.submissions[form.id] || { headers: [], rows: [] };
    const rows = subData.rows || [];

    // Filter rows based on selected timeframe or custom date filters
    const filteredRows = rows.filter(row => {
      const ts = parseDateCell(row[0]);
      if (ts) {
        if (isCustomFilterActive) {
          if (filterFrom && ts < filterFrom) return false;
          if (filterTo && ts > filterTo) return false;
        } else {
          // Filter by summaryTimeframe
          if (appData.summaryTimeframe === '24h') {
            if (ts < oneDayAgo) return false;
          } else if (appData.summaryTimeframe === 'last_week') {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            if (ts < sevenDaysAgo) return false;
          } else {
            // Default: current_month
            if (ts.getFullYear() !== currentYear || ts.getMonth() !== currentMonth) return false;
          }
        }
        return true;
      }
      return !isCustomFilterActive;
    });

    grandTotalSubmissions += filteredRows.length;

    // Filter submissions in last 24h for the 24h column
    let count24h = 0;
    let lastTime = null;
    let lastSubmitter = '-';

    rows.forEach(row => {
      if (row[0]) {
        const ts = parseDateCell(row[0]);
        if (ts) {
          if (ts >= oneDayAgo) {
            count24h++;
          }
          if (!lastTime || ts > lastTime) {
            lastTime = ts;
            lastSubmitter = row[1] || '-';
          }
        }
      }
    });

    total24hSubmissions += count24h;
    if (filteredRows.length > 0) {
      activeFormsInPeriod++;
    }

    const statusBadge = form.status.includes('Success') 
      ? '<span class="badge badge-success">ચાલુ છે (Live)</span>'
      : (form.status.includes('Failed') ? '<span class="badge badge-danger">ભૂલ (Failed)</span>' : '<span class="badge badge-warning">બાકી (Pending)</span>');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="ફોર્મ / પ્રોજેક્ટ નામ"><strong>${form.name}</strong></td>
      <td data-label="છેલ્લો સમય">${lastTime ? formatDateTime(lastTime) + ` (${getRelativeTimeString(lastTime)})` : '<span class="muted">-</span>'}</td>
      <td data-label="છેલ્લા ૨૪ કલાક">
        <span class="badge ${count24h > 0 ? 'badge-success' : 'badge-neutral'}">
          ${count24h} વાર / times
        </span>
      </td>
      <td data-label="છેલ્લો ઓપરેટર"><code>${lastSubmitter}</code></td>
      <td data-label="સ્થિતિ">${statusBadge}</td>
      <td style="text-align: center;" class="no-print" data-label="ઍક્શન">
        <div style="display: flex; gap: 6px; justify-content: center;">
          <button class="btn btn-secondary btn-sm" onclick="syncGoogleSheet('${form.id}').then(renderDashboardTable)">🔄 Sync</button>
          <button class="btn btn-danger btn-sm" onclick="deleteBinding('${form.id}')">🗑 Unlink</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Update master summary indicators
  document.getElementById('statActive24h').textContent = activeFormsInPeriod;
  document.getElementById('statTotal24h').textContent = total24hSubmissions;
  document.getElementById('statTotalSubmissions').textContent = grandTotalSubmissions;
}

// Populate selectors in Details dropdown
function renderFormSelector() {
  const select = document.getElementById('detailsFormSelect');
  if (!select) return;
  select.innerHTML = '';

  appData.registeredForms.forEach(form => {
    const opt = document.createElement('option');
    opt.value = form.id;
    opt.textContent = form.name;
    opt.selected = form.id === appData.selectedFormId;
    select.appendChild(opt);
  });
}

// Render Form Submissions history table dynamically using actual headers of the sheet!
function renderFormDetailsPanel() {
  const select = document.getElementById('detailsFormSelect');
  const table = document.querySelector('#tab-details table');
  if (!table) return;

  const tbody = document.getElementById('detailsTableBody');
  const thead = table.querySelector('thead');
  if (!tbody || !thead) return;

  const formId = select ? select.value : appData.selectedFormId;
  appData.selectedFormId = formId;

  const customPanel = document.getElementById('customAuditSummaryPanel');
  if (customPanel) {
    if (formId === 'form_cleaning_audit') {
      customPanel.style.display = 'block';
      renderCustomCleaningAuditSummary(customPanel);
    } else {
      customPanel.style.display = 'none';
      customPanel.innerHTML = '';
    }
  }

  tbody.innerHTML = '';

  if (!formId) {
    thead.innerHTML = `<tr><th>No</th><th>Timestamp</th><th>Submitter</th></tr>`;
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">No forms connected / કોઈ લિંક કરેલ ફોર્મ નથી</td></tr>`;
    return;
  }

  const subData = appData.submissions[formId] || { headers: [], rows: [] };
  const headers = subData.headers || [];
  const rows = subData.rows || [];
  
  // Set headers dynamically
  if (headers.length > 0) {
    thead.innerHTML = `
      <tr>
        <th style="width: 80px;">No</th>
        ${headers.map(h => `<th>${h}</th>`).join('')}
      </tr>
    `;
  } else {
    thead.innerHTML = `<tr><th>No</th><th>Timestamp</th><th>Data Log</th></tr>`;
  }

  // Get date range inputs and search text
  const searchInput = document.getElementById('detailsSearchInput');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const { filterFrom, filterTo, isActive: isCustomFilterActive } = getCurrentFilterRange();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // Filter based on Date Range or Timeframe
  let filtered = rows.filter(row => {
    // 1. Date filter
    const ts = parseDateCell(row[0]);
    if (ts) {
      if (isCustomFilterActive) {
        if (filterFrom && ts < filterFrom) return false;
        if (filterTo && ts > filterTo) return false;
      } else {
        // Filter by summaryTimeframe
        if (appData.summaryTimeframe === '24h') {
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          if (ts < oneDayAgo) return false;
        } else if (appData.summaryTimeframe === 'last_week') {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (ts < sevenDaysAgo) return false;
        } else {
          // Default: current_month
          if (ts.getFullYear() !== currentYear || ts.getMonth() !== currentMonth) return false;
        }
      }
    } else if (isCustomFilterActive) {
      return false;
    }

    // 2. Search query filter
    if (!query) return true;
    return row.some(cell => String(cell || '').toLowerCase().includes(query));
  });

  // Sort newest first based on Timestamp
  filtered.sort((a, b) => {
    const da = parseDateCell(a[0]);
    const db = parseDateCell(b[0]);
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });

  if (filtered.length === 0) {
    const colCount = headers.length > 0 ? headers.length + 1 : 3;
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align: center; color: var(--text-muted); padding: 20px;">No matching records found / કોઈ પરિણામ મળ્યું નથી</td></tr>`;
    
    // Also sync master dashboard stats
    renderDashboardTable();
    return;
  }

  // If no custom date filter is active, only show the last 5 entries in the list
  const displayLimit = isCustomFilterActive ? filtered.length : 5;
  const displayRows = filtered.slice(0, displayLimit);

  displayRows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="No"><strong>${idx + 1}</strong></td>
      ${row.map((cell, cIdx) => {
        const headerLabel = headers[cIdx] || 'Data';
        if (cIdx === 0) {
          const d = parseDateCell(cell);
          if (d) {
            return `<td data-label="${headerLabel}">${cell} <span style="font-size:0.7rem; color:var(--text-muted); display:block;">(${getRelativeTimeString(d)})</span></td>`;
          }
        }
        return `<td data-label="${headerLabel}">${cell || ''}</td>`;
      }).join('')}
    `;
    tbody.appendChild(tr);
  });

  // Update the top master stats cards dynamically to reflect selected date/timeframe filter
  renderDashboardTable();
}

// Render dynamic forms registry under the Connect tab
function renderActiveConnectionsTable() {
  const tbody = document.getElementById('activeConnectionsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (appData.registeredForms.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No sheets linked yet / હજુ કોઈ ફોર્મ જોડેલ નથી</td></tr>`;
    return;
  }

  appData.registeredForms.forEach(form => {
    const syncTimeStr = form.lastSync ? formatDateTime(new Date(form.lastSync)) : 'Never / ક્યારેય નહિ';
    const statusBadge = form.status.includes('Success') 
      ? '<span class="badge badge-success">ચાલુ છે (Live)</span>'
      : (form.status.includes('Failed') ? '<span class="badge badge-danger">ભૂલ (Failed)</span>' : '<span class="badge badge-warning">બાકી (Pending)</span>');

    const formLinkMarkup = form.formUrl 
      ? `<a href="${form.formUrl}" target="_blank" class="btn btn-secondary btn-sm" style="font-size:0.75rem;">📋 Fill Form</a>`
      : `<span class="muted" style="font-size:0.75rem;">-</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="ફોર્મ / પ્રોજેક્ટ નામ"><strong>${form.name}</strong></td>
      <td data-label="ફોર્મ લિંક" style="text-align:center;">${formLinkMarkup}</td>
      <td data-label="શીટ લિંક">
        <a href="${form.url}" target="_blank" style="color:var(--primary); font-size:0.8rem; word-break:break-all;">🔗 View Responses</a>
      </td>
      <td data-label="સ્થિતિ (Sync Status)">
        ${statusBadge}
        <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">Last Sync: ${syncTimeStr}</div>
      </td>
      <td style="text-align: center;" data-label="ઍક્શન">
        <div class="btn-group no-print" style="display:flex; gap:6px; justify-content:center;">
          <button class="btn btn-secondary btn-sm" onclick="syncGoogleSheet('${form.id}').then(() => { renderActiveConnectionsTable(); renderDashboardTable(); })">🔄 Sync</button>
          <button class="btn btn-danger btn-sm" onclick="deleteBinding('${form.id}')">🗑 Remove</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Re-render Volume and Distribution charts dynamically using Chart.js
function updateAnalyticsCharts() {
  const volCtx = document.getElementById('analyticsVolumeChart');
  const shareCtx = document.getElementById('analyticsShareChart');
  if (!volCtx || !shareCtx) return;

  // Toggle active styling on chart timeframe buttons
  const activeStyle = 'background-color: var(--primary) !important; color: #ffffff !important; font-weight:700;';
  const inactiveStyle = 'background-color: var(--card-bg) !important; color: var(--text-main) !important; font-weight:normal; border: 1px solid var(--border-color);';
  
  const btn24h = document.getElementById('btnChart24h');
  const btnWeek = document.getElementById('btnChartWeek');
  const btnMonth = document.getElementById('btnChartMonth');
  
  if (btn24h && btnWeek && btnMonth) {
    btn24h.setAttribute('style', `font-size:0.75rem; padding:6px 12px; border:none; ${appData.analyticsTimeframe === '24h' ? activeStyle : inactiveStyle}`);
    btnWeek.setAttribute('style', `font-size:0.75rem; padding:6px 12px; border:none; ${appData.analyticsTimeframe === 'last_week' ? activeStyle : inactiveStyle}`);
    btnMonth.setAttribute('style', `font-size:0.75rem; padding:6px 12px; border:none; ${appData.analyticsTimeframe === 'current_month' ? activeStyle : inactiveStyle}`);
  }

  // Clear existing instances
  if (appData.chartInstanceVolume) appData.chartInstanceVolume.destroy();
  if (appData.chartInstanceShare) appData.chartInstanceShare.destroy();

  const sel = document.getElementById('analyticsFormSelect');
  const formId = sel ? sel.value : (appData.selectedFormId || (appData.registeredForms[0] ? appData.registeredForms[0].id : ''));

  if (!formId) {
    document.getElementById('chart1Title').textContent = '📊 વિશ્લેષણ ચાર્ટ ૧';
    document.getElementById('chart2Title').textContent = '📊 વિશ્લેષણ ચાર્ટ ૨';
    return;
  }

  const subData = appData.submissions[formId] || { headers: [], rows: [] };
  const headers = subData.headers || [];
  const rows = subData.rows || [];

  const isDarkMode = document.body.classList.contains('dark-mode');
  const textColor = isDarkMode ? '#e2e8f0' : '#1e293b';
  const gridColor = isDarkMode ? '#334155' : '#e2e8f0';

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Filter rows based on selected analyticsTimeframe
  const filteredRows = rows.filter(row => {
    const ts = parseDateCell(row[0]);
    if (ts) {
      if (appData.analyticsTimeframe === '24h') {
        if (ts < oneDayAgo) return false;
      } else if (appData.analyticsTimeframe === 'last_week') {
        if (ts < sevenDaysAgo) return false;
      } else {
        // Default: current_month
        if (ts.getFullYear() !== currentYear || ts.getMonth() !== currentMonth) return false;
      }
      return true;
    }
    return false; // Skip rows without valid timestamps
  });

  if (filteredRows.length === 0) {
    document.getElementById('chart1Title').textContent = '📊 ચાર્ટ માટે પૂરતો ડેટા નથી (No Data in selected period)';
    document.getElementById('chart2Title').textContent = '📊 ચાર્ટ માટે પૂરતો ડેટા નથી (No Data in selected period)';
    return;
  }

  if (formId === 'form_cleaning_audit') {
    // -------------------------------------------------------------
    // SPECIALIZED CHARTS FOR CLEANING CHECKLIST
    // -------------------------------------------------------------
    document.getElementById('chart1Title').textContent = '🧹 કયા સેક્શન/વિસ્તારમાં વધુ સમસ્યાઓ મળી? (Room-wise Issues)';
    document.getElementById('chart2Title').textContent = '📈 દૈનિક ઓડિટ અને ખામીઓનો ટ્રેન્ડ (Daily Audit & Issues Trend)';

    // Chart 1: Room-wise problems counts
    const roomIssues = [];
    headers.forEach((header, index) => {
      if (index > 0 && header.trim()) {
        let count = 0;
        filteredRows.forEach(row => {
          const cellVal = String(row[index] || '');
          if (cellVal.includes('પાણી લીકેજ') || cellVal.includes('કચરું જોવું')) {
            count++;
          }
        });
        roomIssues.push({ name: header.trim(), count: count });
      }
    });

    // Sort roomIssues descending by count
    roomIssues.sort((a, b) => b.count - a.count);

    const roomLabels = roomIssues.map(r => r.name);
    const roomCounts = roomIssues.map(r => r.count);

    appData.chartInstanceVolume = new Chart(volCtx, {
      type: 'bar',
      data: {
        labels: roomLabels,
        datasets: [{
          label: 'સમસ્યા ગણતરી (Total Issues)',
          data: roomCounts,
          backgroundColor: '#ef4444',
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y', // HORIZONTAL BAR CHART!
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: textColor, precision: 0 },
            grid: { color: gridColor }
          },
          y: {
            ticks: { color: textColor },
            grid: { color: gridColor }
          }
        }
      }
    });

    // Chart 2: Daily audit & issues trend
    const dailyData = {};
    filteredRows.forEach(row => {
      const ts = parseDateCell(row[0]);
      if (ts) {
        const dd = String(ts.getDate()).padStart(2, '0');
        const mm = String(ts.getMonth() + 1).padStart(2, '0');
        const yyyy = ts.getFullYear();
        const dateKey = `${yyyy}-${mm}-${dd}`; // YYYY-MM-DD for sorting

        if (!dailyData[dateKey]) {
          dailyData[dateKey] = {
            displayDate: `${dd}-${mm}-${yyyy}`,
            audits: 0,
            issues: 0
          };
        }

        dailyData[dateKey].audits++;

        // Count issues in this row
        headers.forEach((header, index) => {
          if (index > 0) {
            const cellVal = String(row[index] || '');
            if (cellVal.includes('પાણી લીકેજ') || cellVal.includes('કચરું જોવું')) {
              dailyData[dateKey].issues++;
            }
          }
        });
      }
    });

    // Sort chronologically
    const sortedDateKeys = Object.keys(dailyData).sort();
    const trendLabels = sortedDateKeys.map(k => dailyData[k].displayDate);
    const trendAudits = sortedDateKeys.map(k => dailyData[k].audits);
    const trendIssues = sortedDateKeys.map(k => dailyData[k].issues);

    appData.chartInstanceShare = new Chart(shareCtx, {
      type: 'line',
      data: {
        labels: trendLabels,
        datasets: [
          {
            label: 'ઓડિટ સંખ્યા (Total Audits)',
            data: trendAudits,
            borderColor: '#0d9488',
            backgroundColor: 'rgba(13, 148, 136, 0.1)',
            tension: 0.3,
            fill: true
          },
          {
            label: 'મળેલી ખામીઓ (Issues Found)',
            data: trendIssues,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            tension: 0.3,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { color: textColor }
          }
        },
        scales: {
          x: {
            ticks: { color: textColor },
            grid: { color: gridColor }
          },
          y: {
            beginAtZero: true,
            ticks: { color: textColor, precision: 0 },
            grid: { color: gridColor }
          }
        }
      }
    });

  } else {
    // -------------------------------------------------------------
    // GENERIC CHARTS FOR DYNAMICALLY CONNECTED FORMS
    // -------------------------------------------------------------
    document.getElementById('chart1Title').textContent = '📈 દૈનિક સબમિશન સંખ્યા ટ્રેન્ડ (Daily Submissions)';
    document.getElementById('chart2Title').textContent = '🍰 ઓપરેટર્સ વાઇઝ એન્ટ્રી શેર % (Operator Share %)';

    // Chart 1: Daily Submission Counts
    const dailyVolume = {};
    filteredRows.forEach(row => {
      const ts = parseDateCell(row[0]);
      if (ts) {
        const dd = String(ts.getDate()).padStart(2, '0');
        const mm = String(ts.getMonth() + 1).padStart(2, '0');
        const yyyy = ts.getFullYear();
        const dateKey = `${yyyy}-${mm}-${dd}`;

        if (!dailyVolume[dateKey]) {
          dailyVolume[dateKey] = {
            displayDate: `${dd}-${mm}-${yyyy}`,
            count: 0
          };
        }
        dailyVolume[dateKey].count++;
      }
    });

    const sortedVolKeys = Object.keys(dailyVolume).sort();
    const volLabels = sortedVolKeys.map(k => dailyVolume[k].displayDate);
    const volCounts = sortedVolKeys.map(k => dailyVolume[k].count);

    appData.chartInstanceVolume = new Chart(volCtx, {
      type: 'line',
      data: {
        labels: volLabels,
        datasets: [{
          label: 'સબમિશન સંખ્યા (Submissions)',
          data: volCounts,
          borderColor: '#0d9488',
          backgroundColor: 'rgba(13, 148, 136, 0.1)',
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            ticks: { color: textColor },
            grid: { color: gridColor }
          },
          y: {
            beginAtZero: true,
            ticks: { color: textColor, precision: 0 },
            grid: { color: gridColor }
          }
        }
      }
    });

    // Chart 2: Submitter Share Doughnut
    const submitterShare = {};
    filteredRows.forEach(row => {
      const operator = String(row[1] || 'Unknown / અજ્ઞાત').trim();
      submitterShare[operator] = (submitterShare[operator] || 0) + 1;
    });

    const opLabels = Object.keys(submitterShare);
    const opCounts = Object.values(submitterShare);

    const colors = [
      '#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4',
      '#f59e0b', '#fbbf24', '#fcd34d', '#fde68a', '#fef3c7',
      '#b45309', '#d97706', '#f59e0b', '#fbbf24'
    ];

    appData.chartInstanceShare = new Chart(shareCtx, {
      type: 'doughnut',
      data: {
        labels: opLabels,
        datasets: [{
          data: opCounts,
          backgroundColor: colors.slice(0, opLabels.length)
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: textColor }
          }
        }
      }
    });
  }
}

// Switch timeframe for charts
function changeAnalyticsTimeframe(timeframe) {
  appData.analyticsTimeframe = timeframe;
  updateAnalyticsCharts();
}

// Toggle Theme (Light vs. Dark Mode)
function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('central_dashboard_darkmode_v4', isDark ? 'true' : 'false');
  updateAnalyticsCharts();
}

// Load theme settings from local storage
function loadThemeFromStorage() {
  const saved = localStorage.getItem('central_dashboard_darkmode_v4');
  if (saved === 'true') {
    document.body.classList.add('dark-mode');
  }
}

// Toggle View Mode (PC vs Mobile)
function toggleViewMode() {
  const body = document.body;
  body.classList.toggle('mobile-view-active');
  const isActive = body.classList.contains('mobile-view-active');
  localStorage.setItem('central_dashboard_mobileview_v4', isActive ? 'true' : 'false');
  
  const btn = document.getElementById('viewToggleBtn');
  if (btn) {
    btn.innerHTML = isActive ? '📱 Mobile View' : '💻 PC View';
  }
  updateAnalyticsCharts();
}

function loadViewModeFromStorage() {
  const saved = localStorage.getItem('central_dashboard_mobileview_v4');
  const btn = document.getElementById('viewToggleBtn');
  if (saved === 'true') {
    document.body.classList.add('mobile-view-active');
    if (btn) btn.innerHTML = '📱 Mobile View';
  } else {
    document.body.classList.remove('mobile-view-active');
    if (btn) btn.innerHTML = '💻 PC View';
  }
}

// Reset Date Filter back to current month
function resetDateFilter() {
  const fromInput = document.getElementById('dateFrom');
  const toInput = document.getElementById('dateTo');
  const searchInput = document.getElementById('detailsSearchInput');
  
  if (fromInput) fromInput.value = '';
  if (toInput) toInput.value = '';
  if (searchInput) searchInput.value = '';
  
  renderFormDetailsPanel();
}

// Setup Event Listeners
function initEventBindings() {
  const searchInput = document.getElementById('detailsSearchInput');
  if (searchInput) {
    searchInput.oninput = () => {
      renderFormDetailsPanel();
    };
  }
}

// Timeframe selector switcher
function changeSummaryTimeframe(timeframe) {
  appData.summaryTimeframe = timeframe;
  const fromInput = document.getElementById('dateFrom');
  const toInput = document.getElementById('dateTo');
  if (fromInput) fromInput.value = '';
  if (toInput) toInput.value = '';
  renderFormDetailsPanel();
}

// Render custom dashboard widgets for the preloaded Cleaning Checklist form
function renderCustomCleaningAuditSummary(container) {
  const subData = appData.submissions['form_cleaning_audit'] || { headers: [], rows: [] };
  const headers = subData.headers || [];
  const rows = subData.rows || [];

  if (headers.length === 0 || rows.length === 0) {
    container.innerHTML = `
      <div class="card" style="border: 1px solid var(--warning); background-color: var(--warning-light); text-align: center; padding: 20px;">
        <strong>માહિતી લોડ થાય છે, કૃપા કરીને થોડીવાર પ્રતીક્ષા કરો... / Syncing data...</strong>
      </div>
    `;
    return;
  }

  // Get date range filters from DOM to align stats with user selection
  const { filterFrom, filterTo, isActive: isCustomFilterActive } = getCurrentFilterRange();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // Filter rows based on date parameters (defaults to active timeframe)
  const filteredRows = rows.filter(row => {
    const ts = parseDateCell(row[0]);
    if (ts) {
      if (isCustomFilterActive) {
        if (filterFrom && ts < filterFrom) return false;
        if (filterTo && ts > filterTo) return false;
      } else {
        if (appData.summaryTimeframe === '24h') {
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          if (ts < oneDayAgo) return false;
        } else if (appData.summaryTimeframe === 'last_week') {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (ts < sevenDaysAgo) return false;
        } else {
          // Default: current_month
          if (ts.getFullYear() !== currentYear || ts.getMonth() !== currentMonth) return false;
        }
      }
      return true;
    }
    return !isCustomFilterActive;
  });

  // 1. Current Month & Submission stats
  let submissionsCount = filteredRows.length;
  let lastTime = null;
  const dateCounts = {};

  filteredRows.forEach(row => {
    const ts = parseDateCell(row[0]);
    if (ts) {
      if (!lastTime || ts > lastTime) {
        lastTime = ts;
      }
      const dd = String(ts.getDate()).padStart(2, '0');
      const mm = String(ts.getMonth() + 1).padStart(2, '0');
      const yyyy = ts.getFullYear();
      const dateKey = `${dd}-${mm}-${yyyy}`;
      dateCounts[dateKey] = (dateCounts[dateKey] || 0) + 1;
    }
  });

  const sortedDates = Object.keys(dateCounts).sort((a, b) => {
    const partsA = a.split('-');
    const partsB = b.split('-');
    const dateA = new Date(partsA[2], partsA[1] - 1, partsA[0]);
    const dateB = new Date(partsB[2], partsB[1] - 1, partsB[0]);
    return dateB - dateA;
  });

  // 2. Room Columns mapping (skipping Timestamp at index 0)
  const roomIndices = [];
  headers.forEach((header, index) => {
    if (index > 0 && header.trim()) {
      roomIndices.push({ name: header.trim(), index: index });
    }
  });
  const totalQuestions = roomIndices.length;

  // 3. Scan room statuses & tick marks for the most recent submission row
  let latestRow = null;
  let latestRowTime = null;
  filteredRows.forEach(row => {
    const ts = parseDateCell(row[0]);
    if (ts) {
      if (!latestRowTime || ts > latestRowTime) {
        latestRowTime = ts;
        latestRow = row;
      }
    }
  });

  const roomTickMarks = roomIndices.map(room => {
    const cellVal = latestRow ? String(latestRow[room.index] || '').trim() : '';
    const hasData = cellVal && cellVal !== '-' && cellVal.length > 0;
    
    let isOk = true;
    let issuesList = [];
    if (hasData) {
      if (cellVal.includes('પાણી લીકેજ')) {
        isOk = false;
        issuesList.push('💧 પાણી લીકેજ');
      }
      if (cellVal.includes('કચરું જોવું')) {
        isOk = false;
        issuesList.push('🗑️ કચરું જોવું');
      }
    }

    return {
      name: room.name,
      checked: hasData,
      isOk: isOk,
      issues: issuesList,
      rawText: cellVal
    };
  });

  const checkedCountLatest = roomTickMarks.filter(r => r.checked).length;

  // 4. Submission Question Completion details
  let totalQuestionsCheckedAcrossAll = 0;
  let totalProblemsFoundAcrossAll = 0;

  filteredRows.forEach(row => {
    roomIndices.forEach(room => {
      const cellVal = String(row[room.index] || '').trim();
      if (cellVal && cellVal !== '-' && cellVal.length > 0) {
        totalQuestionsCheckedAcrossAll++;
        if (cellVal.includes('પાણી લીકેજ') || cellVal.includes('કચરું જોવું')) {
          totalProblemsFoundAcrossAll++;
        }
      }
    });
  });

  // 5. Problems & Issues Frequency Summary & Comparison
  const problemFrequency = {
    '💧 પાણી લીકેજ': { count: 0, locations: {} },
    '🗑️ કચરું જોવું': { count: 0, locations: {} }
  };

  filteredRows.forEach(row => {
    roomIndices.forEach(room => {
      const cellVal = String(row[room.index] || '');
      if (cellVal.includes('પાણી લીકેજ')) {
        problemFrequency['💧 પાણી લીકેજ'].count++;
        problemFrequency['💧 પાણી લીકેજ'].locations[room.name] = (problemFrequency['💧 પાણી લીકેજ'].locations[room.name] || 0) + 1;
      }
      if (cellVal.includes('કચરું જોવું')) {
        problemFrequency['🗑️ કચરું જોવું'].count++;
        problemFrequency['🗑️ કચરું જોવું'].locations[room.name] = (problemFrequency['🗑️ કચરું જોવું'].locations[room.name] || 0) + 1;
      }
    });
  });

  // Compare which problem is more frequent
  const leakageCount = problemFrequency['💧 પાણી લીકેજ'].count;
  const trashCount = problemFrequency['🗑️ કચરું જોવું'].count;
  let comparisonBanner = '';

  if (leakageCount === 0 && trashCount === 0) {
    comparisonBanner = '<div style="background:var(--success-light); color:var(--success); padding:10px; border-radius:6px; font-weight:600; font-size:0.75rem; text-align:center;">👍 કોઈ સમસ્યા નોંધાઈ નથી! (No problems reported)</div>';
  } else if (leakageCount > trashCount) {
    comparisonBanner = `<div style="background:var(--warning-light); color:var(--warning); padding:10px; border-radius:6px; font-weight:600; font-size:0.75rem; text-align:center; border: 1px solid var(--warning);">⚠️ <strong>મુખ્ય સમસ્યા:</strong> પાણી લીકેજ છે (તે ${leakageCount} વાર નોંધાઈ છે, જે કચરા કરતાં વધુ છે).</div>`;
  } else if (trashCount > leakageCount) {
    comparisonBanner = `<div style="background:var(--warning-light); color:var(--warning); padding:10px; border-radius:6px; font-weight:600; font-size:0.75rem; text-align:center; border: 1px solid var(--warning);">⚠️ <strong>મુખ્ય સમસ્યા:</strong> કચરું જોવા મળવું છે (તે ${trashCount} વાર નોંધાઈ છે, જે પાણી લીકેજ કરતાં વધુ છે).</div>`;
  } else {
    comparisonBanner = `<div style="background:var(--warning-light); color:var(--warning); padding:10px; border-radius:6px; font-weight:600; font-size:0.75rem; text-align:center; border: 1px solid var(--warning);">⚠️ <strong>બંને સમસ્યા સમાન છે:</strong> પાણી લીકેજ અને કચરું બંને સરખી વાર (${leakageCount} વાર) નોંધાયેલ છે.</div>`;
  }

  const activeStyle = 'background-color: var(--primary) !important; color: #ffffff !important; font-weight:700;';
  const pill24hStyle = (!isCustomFilterActive && appData.summaryTimeframe === '24h') ? activeStyle : '';
  const pillWeekStyle = (!isCustomFilterActive && appData.summaryTimeframe === 'last_week') ? activeStyle : '';
  const pillMonthStyle = (!isCustomFilterActive && appData.summaryTimeframe === 'current_month') ? activeStyle : '';

  // Render Layout
  container.innerHTML = `
    <!-- Timeframe Selection Bar -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px; border-bottom:1px solid var(--border-color); padding-bottom:12px;">
      <h3 style="margin:0; font-size:1.1rem; color:var(--text-main); font-weight:700;">
        📊 સફાઈ ઓડિટ વિશ્લેષણ (Audit Summary Dashboard)
      </h3>
      <div class="timeframe-buttons no-print" style="display:flex; gap:6px; background-color:var(--card-bg); padding:4px; border-radius:6px; border:1px solid var(--border-color);">
        <button class="btn btn-secondary btn-sm" style="font-size:0.75rem; padding:4px 10px; border:none; ${pill24hStyle}" onclick="changeSummaryTimeframe('24h')">૨૪ કલાક (24h)</button>
        <button class="btn btn-secondary btn-sm" style="font-size:0.75rem; padding:4px 10px; border:none; ${pillWeekStyle}" onclick="changeSummaryTimeframe('last_week')">છેલ્લા ૭ દિવસ (Week)</button>
        <button class="btn btn-secondary btn-sm" style="font-size:0.75rem; padding:4px 10px; border:none; ${pillMonthStyle}" onclick="changeSummaryTimeframe('current_month')">ચાલુ મહિનો (Month)</button>
      </div>
    </div>

    <!-- Top summary alert banner about active issue comparison -->
    <div style="margin-bottom: 20px;">
      ${comparisonBanner}
    </div>

    <div class="grid-3" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 20px;">
      
      <!-- Card 1: Submissions stats -->
      <div class="card" style="border-top: 4px solid var(--primary); margin-bottom: 0;">
        <h3 style="color: var(--primary); font-size: 1.05rem; margin-bottom: 12px; font-weight: 700;">
          📅 સબમિશન એનાલિસિસ (Submissions Stats)
        </h3>
        
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom: 15px; font-size: 0.8rem;">
          <div style="display:flex; justify-content:space-between; border-bottom:1px dashed var(--border-color); padding-bottom:6px;">
            <span class="text-muted">કુલ કેટલી વાર ભરાયું (Filled Count):</span>
            <strong>${submissionsCount} વાર (Times)</strong>
          </div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px dashed var(--border-color); padding-bottom:6px;">
            <span class="text-muted">છેલ્લે ભરાયેલ તારીખ/સમય:</span>
            <strong>${lastTime ? formatDateTime(lastTime) : 'કોઈ એન્ટ્રી નથી'}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px dashed var(--border-color); padding-bottom:6px;">
            <span class="text-muted">કુલ ભરાયેલા પ્રશ્નો (Total Checks):</span>
            <strong>${totalQuestionsCheckedAcrossAll} પ્રશ્નો (Answers)</strong>
          </div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px dashed var(--border-color); padding-bottom:6px;">
            <span class="text-muted">તેમાંથી ખામીયુક્ત (With Problems):</span>
            <strong style="color:var(--danger);">${totalProblemsFoundAcrossAll} એરિયા (Areas)</strong>
          </div>
        </div>

        <h4 style="font-size: 0.8rem; margin-bottom: 6px; font-weight:600;">📅 તારીખ વાઇઝ વિગત:</h4>
        <div style="max-height: 100px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px;">
          <table style="width:100%; font-size:0.75rem; border-collapse:collapse; text-align:left;">
            <thead>
              <tr style="background:var(--card-bg); border-bottom: 1px solid var(--border-color);">
                <th style="padding:6px 10px;">તારીખ (Date)</th>
                <th style="padding:6px 10px; text-align:right;">ગણતરી</th>
              </tr>
            </thead>
            <tbody>
              ${sortedDates.length === 0 ? '<tr><td colspan="2" style="text-align:center; padding:10px;">No entries</td></tr>' : sortedDates.map(d => `
                <tr style="border-bottom:1px solid var(--border-color);">
                  <td style="padding:6px 10px;">${d}</td>
                  <td style="padding:6px 10px; text-align:right; font-weight:700;">${dateCounts[d]} વાર</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Card 2: Question Checklist Ticks (Latest check list) -->
      <div class="card" style="border-top: 4px solid var(--success); margin-bottom: 0;">
        <h3 style="color: var(--success); font-size: 1.05rem; margin-bottom: 8px; font-weight: 700; display:flex; justify-content:space-between; align-items:center;">
          <span>📋 છેલ્લી ચેકલિસ્ટ સ્થિતિ</span>
          <span style="font-size:0.8rem; background:rgba(16,185,129,0.1); color:var(--success); padding:3px 8px; border-radius:4px; font-weight:600;">
            ${checkedCountLatest}/${totalQuestions} પૂર્ણ
          </span>
        </h3>
        <p class="text-muted" style="font-size:0.75rem; margin-bottom: 12px;">છેલ્લા નિરીક્ષણ દરમિયાન પ્રશ્નો અને ચેકલિસ્ટનું વિશ્લેષણ (✔️ OK / ❌ સમસ્યા):</p>
        
        <div style="max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
          ${roomTickMarks.length === 0 ? '<div style="text-align:center; padding:10px;">No rooms data</div>' : roomTickMarks.map(room => {
            let statusBadge = '';
            if (room.checked) {
              if (room.isOk) {
                statusBadge = '<span style="color: var(--success); font-weight: bold; font-size: 1rem;">✔️ OK / વ્યવસ્થિત</span>';
              } else {
                statusBadge = `<span style="color: var(--danger); font-size: 0.75rem; font-weight: bold; display:block; text-align:right;">❌ ${room.issues.join(', ')}</span>`;
              }
            } else {
              statusBadge = '<span class="text-muted" style="font-size: 0.75rem;">- બાકી -</span>';
            }
            return `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background-color: var(--card-bg); border-radius: 6px; border:1px solid var(--border-color); font-size:0.8rem;">
                <strong>${room.name}</strong>
                <div>${statusBadge}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Card 3: Problems & Issues Frequency Summary -->
      <div class="card" style="border-top: 4px solid var(--danger); margin-bottom: 0;">
        <h3 style="color: var(--danger); font-size: 1.05rem; margin-bottom: 10px; font-weight: 700;">
          🚨 સમસ્યા વિશ્લેષણ (Problem Analytics)
        </h3>
        <p class="text-muted" style="font-size: 0.75rem; margin-bottom: 12px;">કઈ સમસ્યા કઈ જગ્યાએ કેટલી વાર નોંધાઈ:</p>

        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 220px; overflow-y: auto;">
          ${Object.keys(problemFrequency).map(key => {
            const data = problemFrequency[key];
            const locations = Object.keys(data.locations);
            
            const locDetails = locations.map(loc => {
              return `${loc} (${data.locations[loc]} વાર)`;
            }).join(', ');

            return `
              <div style="background: rgba(239, 68, 68, 0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
                  <strong style="color: var(--danger); font-size:0.8rem;">${key}</strong>
                  <span class="badge badge-danger" style="font-size: 0.75rem; padding: 2px 6px; font-weight:600;">${data.count} વાર</span>
                </div>
                <div style="font-size:0.75rem; color:var(--text-muted); line-height: 1.3;">
                  <strong>વિગતવાર સ્થાનો:</strong> ${locations.length > 0 ? locDetails : 'કોઈ નહિ'}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

    </div>
  `;
}

// App Bootstrapper
document.addEventListener('DOMContentLoaded', () => {
  loadThemeFromStorage();
  loadViewModeFromStorage(); // Initialize view state on boot (PC vs Mobile)
  loadRegistryAndCache(); // Load registered sheets and caches
  initEventBindings();
  
  // Default render
  renderFormDetailsPanel();

  // Background Live Sync on boot
  setTimeout(() => {
    syncAllGoogleSheets();
  }, 1000);

  // Setup periodic sync interval every 60 seconds (Auto-Sync)
  setInterval(() => {
    syncAllGoogleSheets();
  }, 60000);
});
