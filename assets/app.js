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

// Parse CSV output exported from Google Sheet URLs with support for quoted newlines
function parseCSV(csvText) {
  const result = { headers: [], rows: [] };
  if (!csvText || !csvText.trim()) return result;

  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const c = csvText[i];
    const nextC = csvText[i + 1];

    if (c === '"') {
      if (inQuotes && nextC === '"') {
        // Escaped quote
        currentVal += '"';
        i++; // skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      // Cell separator
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      // Row separator
      currentRow.push(currentVal.trim());
      if (currentRow.length > 0 && (currentRow.length > 1 || currentRow[0] !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
      if (c === '\r' && nextC === '\n') {
        i++; // skip \n
      }
    } else {
      currentVal += c;
    }
  }

  // Push final cell and row
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.length > 0 && (currentRow.length > 1 || currentRow[0] !== '')) {
      rows.push(currentRow);
    }
  }

  if (rows.length > 0) {
    // Clean up headers from linebreaks or double spaces
    result.headers = rows[0].map(h => h.replace(/\s+/g, ' ').trim());
    result.rows = rows.slice(1);
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

// Fetch with custom timeout helper to prevent hanging requests
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 6000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
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
    
    // Prioritized list of proxy attempts to bypass CORS blocks.
    // Try the direct URL first (Google Sheets CSV export natively supports CORS).
    const proxyAttempts = [directExportUrl];
    
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      // Local development server environment
      proxyAttempts.push(`/api/proxy-sheet?url=${encodeURIComponent(directExportUrl)}`);
    } else if (window.location.protocol === 'file:') {
      // Opened directly via file:/// -> try local port 4343 proxy server next, then try public online proxies
      proxyAttempts.push(`http://localhost:4343/api/proxy-sheet?url=${encodeURIComponent(directExportUrl)}`);
      proxyAttempts.push(`https://corsproxy.io/?url=${encodeURIComponent(directExportUrl)}`);
      proxyAttempts.push(`https://api.allorigins.win/raw?url=${encodeURIComponent(directExportUrl)}`);
    } else {
      // Static remote hosting (e.g. GitHub Pages) -> try public online proxies
      proxyAttempts.push(`https://corsproxy.io/?url=${encodeURIComponent(directExportUrl)}`);
      proxyAttempts.push(`https://api.allorigins.win/raw?url=${encodeURIComponent(directExportUrl)}`);
    }

    let response = null;
    let lastError = null;

    for (const url of proxyAttempts) {
      try {
        console.log("Attempting fetch from:", url);
        response = await fetchWithTimeout(url, { timeout: 6000 });
        if (response.ok) {
          break; // Fetch succeeded!
        } else {
          lastError = new Error(`HTTP error ${response.status}`);
        }
      } catch (e) {
        lastError = e;
      }
    }

    if (!response || !response.ok) {
      throw lastError || new Error("Failed to connect to Google Sheet");
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

  // Proactively check and inject the new 10-7 Setup Machine Check form if it is missing from the registry
  const newFormId = 'form_10_7_setup_check';
  const hasNewForm = appData.registeredForms.some(f => f.id === newFormId || f.url.includes('1OO-APd3ydEE-s2spedToZu1Kp-UdxfE-2c8BAefHVVg'));
  if (!hasNewForm) {
    appData.registeredForms.push({
      id: newFormId,
      name: '10-7  સેટઅપ મશીન ચેક',
      formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSdRZHnpGShQnVN1gH6Gvwa73KI8CfNarsppaPCcTNi_AiEG1Q/viewform?usp=sharing&ouid=101335515224207199352',
      url: 'https://docs.google.com/spreadsheets/d/1OO-APd3ydEE-s2spedToZu1Kp-UdxfE-2c8BAefHVVg/edit?usp=sharing',
      status: 'Pending / બાકી',
      lastSync: null
    });
    appData.submissions[newFormId] = { headers: [], rows: [] };
    saveRegistryToStorage();
  }

  // Proactively check and inject the new 21-4 Multi Stitching Camera Check SAIAMBE form if missing
  const stitchFormId = 'form_multi_stitch_camera_saiambe';
  const hasStitchForm = appData.registeredForms.some(f => f.id === stitchFormId || f.url.includes('1c4p8haoOVdDd2T1xJsUt_VktELVBPw8e3s5VPWQNcQ0'));
  if (!hasStitchForm) {
    appData.registeredForms.push({
      id: stitchFormId,
      name: '21-4 મલ્ટી સ્ટીચીંગ કેમેરા ચેક SAIAMBE',
      formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSdPuzmFABmJ4xhGntVrN3agDD7pgXJLMwNE8HWsfLnjOq19Ww/viewform?usp=sharing&ouid=101335515224207199352',
      url: 'https://docs.google.com/spreadsheets/d/1c4p8haoOVdDd2T1xJsUt_VktELVBPw8e3s5VPWQNcQ0/edit?usp=sharing',
      status: 'Pending / બાકી',
      lastSync: null
    });
    appData.submissions[stitchFormId] = { headers: [], rows: [] };
    saveRegistryToStorage();
  }

  // Load cached submissions for each form
  appData.registeredForms.forEach(form => {
    const cachedHeaders = localStorage.getItem(`cached_dynamic_subs_headers_${form.id}`);
    const cachedRows = localStorage.getItem(`cached_dynamic_subs_rows_${form.id}`);
    
    if (cachedHeaders && cachedRows) {
      try {
        const headers = JSON.parse(cachedHeaders);
        const rows = JSON.parse(cachedRows);
        
        // Sanity check: Clear corrupt cache if headers contain cleaning checklist labels (uses trim + includes for maximum robustness)
        if (headers.some(h => typeof h === 'string' && h.trim().includes('મેઈન ઓફીસ'))) {
          if (form.id !== 'form_cleaning_audit' && !form.url.includes('1YP2cycpq_e_jYITqL3h-dkCzxq_yQhEO3MYdaCqCnrc')) {
            console.warn('Clearing corrupt cache for form:', form.id);
            localStorage.removeItem(`cached_dynamic_subs_headers_${form.id}`);
            localStorage.removeItem(`cached_dynamic_subs_rows_${form.id}`);
            appData.submissions[form.id] = { headers: [], rows: [] };
            return;
          }
        }

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
    changeSummaryTimeframe(appData.summaryTimeframe);
  } else if (tabId === 'linker') {
    renderActiveConnectionsTable();
  } else if (tabId === 'analytics') {
    // Populate analytics form selector
    const sel = document.getElementById('analyticsFormSelect');
    if (sel) {
      sel.innerHTML = '';
      
      const optAll = document.createElement('option');
      optAll.value = 'all_forms';
      optAll.textContent = 'બધા ફોર્મ્સ (All Forms)';
      optAll.selected = !appData.selectedFormId || appData.selectedFormId === 'all_forms';
      sel.appendChild(optAll);

      appData.registeredForms.forEach(form => {
        const opt = document.createElement('option');
        opt.value = form.id;
        opt.textContent = form.name;
        opt.selected = form.id === appData.selectedFormId && appData.selectedFormId !== 'all_forms';
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
    
    const active24hEl = document.getElementById('statActive24h');
    if (active24hEl) active24hEl.textContent = '0';
    
    const total24hEl = document.getElementById('statTotal24h');
    if (total24hEl) total24hEl.textContent = '0';
    
    const totalSubsEl = document.getElementById('statTotalSubmissions');
    if (totalSubsEl) totalSubsEl.textContent = '0';
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
    const headers = subData.headers || [];
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

    // Identify submitter column dynamically to prevent mixing numeric measurements as operator names
    let submitterColIdx = -1;
    const submitterKeywords = ['email', 'username', 'submitter', 'operator', 'નામ', 'ઇમેઇલ', 'ઓપરેટર', 'નામ/ઈમેલ', 'email address'];
    if (Array.isArray(headers)) {
      headers.forEach((h, idx) => {
        if (typeof h === 'string') {
          const lowerH = h.toLowerCase();
          if (submitterKeywords.some(kw => lowerH.includes(kw))) {
            if (submitterColIdx === -1 || lowerH.includes('email') || lowerH.includes('ઓપરેટર')) {
              submitterColIdx = idx;
            }
          }
        }
      });
    }

    if (submitterColIdx === -1 && Array.isArray(rows) && rows.length > 0) {
      let numericCount = 0;
      let checkCount = 0;
      rows.forEach(r => {
        if (r && r[1] !== undefined && r[1] !== null) {
          const val = String(r[1]).trim();
          if (val !== '') {
            checkCount++;
            if (!isNaN(val)) {
              numericCount++;
            }
          }
        }
      });
      if (checkCount === 0 || numericCount / checkCount <= 0.5) {
        submitterColIdx = 1; // Default fallback to column 2 if it is not numeric
      }
    }

    rows.forEach(row => {
      if (row[0]) {
        const ts = parseDateCell(row[0]);
        if (ts) {
          if (ts >= oneDayAgo) {
            count24h++;
          }
          if (!lastTime || ts > lastTime) {
            lastTime = ts;
            lastSubmitter = (submitterColIdx !== -1 && row[submitterColIdx]) ? row[submitterColIdx] : '-';
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

  // Calculate dynamic status categories for top forms stats
  let activeCount = 0;
  let inactiveCount = 0;
  let unlinkedCount = 0;
  appData.registeredForms.forEach(form => {
    if (!form.url || form.url.trim() === '') {
      unlinkedCount++;
    } else if (form.status.includes('Failed')) {
      inactiveCount++;
    } else if (form.status.includes('Success')) {
      activeCount++;
    } else {
      unlinkedCount++;
    }
  });

  const formsDetailEl = document.getElementById('statFormsDetail');
  if (formsDetailEl) {
    formsDetailEl.innerHTML = `(🟢 ${activeCount} active | 🔴 ${inactiveCount} inactive | 🔗 ${unlinkedCount} unlinked)`;
  }

  // Update master summary indicators
  const active24hEl = document.getElementById('statActive24h');
  if (active24hEl) active24hEl.textContent = activeFormsInPeriod;
  
  const total24hEl = document.getElementById('statTotal24h');
  if (total24hEl) total24hEl.textContent = total24hSubmissions;
  
  const totalSubsEl = document.getElementById('statTotalSubmissions');
  if (totalSubsEl) totalSubsEl.textContent = grandTotalSubmissions;
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

  tbody.innerHTML = '';

  if (!formId) {
    thead.innerHTML = `<tr><th>No</th><th>Timestamp</th><th>Submitter</th></tr>`;
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">No forms connected / કોઈ લિંક કરેલ ફોર્મ નથી</td></tr>`;
    
    const customPanel = document.getElementById('customAuditSummaryPanel');
    if (customPanel) {
      customPanel.style.display = 'none';
      customPanel.innerHTML = '';
    }
    return;
  }

  const subData = appData.submissions[formId] || { headers: [], rows: [] };
  const headers = subData.headers || [];
  const rows = subData.rows || [];

  const customPanel = document.getElementById('customAuditSummaryPanel');
  if (customPanel) {
    const isActivePartSheet = headers.some(h => typeof h === 'string' && h.includes('મશીન')) && headers.some(h => typeof h === 'string' && h.includes('હાઈટ'));
    
    if (formId === 'form_cleaning_audit') {
      customPanel.style.display = 'block';
      renderCustomCleaningAuditSummary(customPanel);
    } else if (formId === 'form_10_7_setup_check' || formId.includes('setup_check')) {
      customPanel.style.display = 'block';
      renderCustomSetupAuditSummary(customPanel);
    } else if (formId === 'form_multi_stitch_camera_saiambe' || formId.includes('camera')) {
      customPanel.style.display = 'block';
      renderCustomCameraAuditSummary(customPanel);
    } else if (isActivePartSheet) {
      customPanel.style.display = 'block';
      renderCustomActivePartSummary(customPanel, formId);
    } else {
      customPanel.style.display = 'none';
      customPanel.innerHTML = '';
    }
  }
  
  // Set headers dynamically
  if (headers.length > 0) {
    let headerHtml = '';
    headers.forEach((h, idx) => {
      headerHtml += `<th>${h}</th>`;
      if (idx === 3 && (formId === 'form_10_7_setup_check' || formId === 'form_multi_stitch_camera_saiambe')) {
        headerHtml += `<th style="color:#ef4444; font-weight:700; background:rgba(239,68,68,0.03);">બાકી ઓડિટ (Missed Checks)</th>`;
      }
    });
    thead.innerHTML = `
      <tr>
        <th style="width: 80px;">No</th>
        ${headerHtml}
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

  const isActivePartSheet = headers.some(h => typeof h === 'string' && h.includes('મશીન')) && headers.some(h => typeof h === 'string' && h.includes('હાઈટ'));
  const detailsTableContainer = document.querySelector('#tab-details .table-responsive');
  let detailsCardFeed = document.getElementById('detailsCardFeed');
  if (!detailsCardFeed && detailsTableContainer) {
    detailsCardFeed = document.createElement('div');
    detailsCardFeed.id = 'detailsCardFeed';
    detailsCardFeed.style.marginTop = '20px';
    detailsTableContainer.parentNode.insertBefore(detailsCardFeed, detailsTableContainer.nextSibling);
  }

  if (detailsTableContainer) detailsTableContainer.style.display = 'block';
  if (detailsCardFeed) detailsCardFeed.style.display = 'none';

  // If no custom date filter is active, only show the last 5 entries in the list
  const displayLimit = isCustomFilterActive ? filtered.length : 5;
  const displayRows = filtered.slice(0, displayLimit);

  displayRows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    
    let cellsHtml = '';
    row.forEach((cell, cIdx) => {
      const headerLabel = headers[cIdx] || 'Data';
      
      let cellContent = '';
      if (cIdx === 0) {
        const d = parseDateCell(cell);
        if (d) {
          cellContent = `${cell} <span style="font-size:0.7rem; color:var(--text-muted); display:block;">(${getRelativeTimeString(d)})</span>`;
        } else {
          cellContent = cell || '';
        }
      } else if (formId === 'form_cleaning_audit' && cIdx > 1) {
        cellContent = formatCleaningCell(cell);
      } else if (formId === 'form_10_7_setup_check' && cIdx > 3) {
        cellContent = formatSetupCell(cell);
      } else if ((formId === 'form_multi_stitch_camera_saiambe' || formId.includes('camera')) && cIdx > 3) {
        cellContent = formatCameraCell(cell);
      } else if (isActivePartSheet && cIdx > 3) {
        cellContent = formatActivePartCell(cell);
      } else {
        cellContent = cell || '';
      }
      
      cellsHtml += `<td data-label="${headerLabel}">${cellContent}</td>`;
      
      if (cIdx === 3 && (formId === 'form_10_7_setup_check' || formId === 'form_multi_stitch_camera_saiambe' || isActivePartSheet)) {
        const stats = getMissedCountInRow(row, headers, formId);
        const badgeColor = stats.missed > 0 ? '#ef4444' : '#10b981';
        const bgLight = stats.missed > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)';
        cellsHtml += `
          <td data-label="બાકી ઓડિટ" style="text-align:center; background:${bgLight};">
            <span style="color:${badgeColor}; font-weight:800; font-size:0.8rem; padding:3px 8px; border-radius:6px; border: 1px solid ${badgeColor};">
              ${stats.missed} / ${stats.total} બાકી
            </span>
          </td>
        `;
      }
    });

    tr.innerHTML = `
      <td data-label="No"><strong>${idx + 1}</strong></td>
      ${cellsHtml}
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
          <button class="btn btn-secondary btn-sm" onclick="editFormBinding('${form.id}')" style="background:#f59e0b; color:white; border:none;">✏️ Edit</button>
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
  const btnAll = document.getElementById('btnChartAllTime');
  
  if (btn24h && btnWeek && btnMonth && btnAll) {
    btn24h.setAttribute('style', `font-size:0.75rem; padding:6px 12px; border:none; ${appData.analyticsTimeframe === '24h' ? activeStyle : inactiveStyle}`);
    btnWeek.setAttribute('style', `font-size:0.75rem; padding:6px 12px; border:none; ${appData.analyticsTimeframe === 'last_week' ? activeStyle : inactiveStyle}`);
    btnMonth.setAttribute('style', `font-size:0.75rem; padding:6px 12px; border:none; ${appData.analyticsTimeframe === 'current_month' ? activeStyle : inactiveStyle}`);
    btnAll.setAttribute('style', `font-size:0.75rem; padding:6px 12px; border:none; ${appData.analyticsTimeframe === 'all_time' ? activeStyle : inactiveStyle}`);
  }

  // Clear existing instances
  if (appData.chartInstanceVolume) appData.chartInstanceVolume.destroy();
  if (appData.chartInstanceShare) appData.chartInstanceShare.destroy();

  const sel = document.getElementById('analyticsFormSelect');
  const formId = sel ? sel.value : 'all_forms';

  if (!formId) {
    document.getElementById('chart1Title').textContent = '📊 વિશ્લેષણ ચાર્ટ ૧';
    document.getElementById('chart2Title').textContent = '📊 વિશ્લેષણ ચાર્ટ ૨';
    return;
  }

  const isDarkMode = document.body.classList.contains('dark-mode');
  const textColor = isDarkMode ? '#e2e8f0' : '#1e293b';
  const gridColor = isDarkMode ? '#334155' : '#e2e8f0';

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // -------------------------------------------------------------
  // ALL FORMS PLOTTING (DAILY PROPORTION STACKED BAR + DOUGHNUT)
  // -------------------------------------------------------------
  if (formId === 'all_forms') {
    document.getElementById('chart1Title').textContent = '📊 ફોર્મ વાઇઝ દૈનિક એન્ટ્રી પ્રમાણ (Daily Submissions per Form)';
    document.getElementById('chart2Title').textContent = '📊 કુલ સબમિશન શેર વિશ્લેષણ (Total Submissions Share per Form)';

    const formDatasets = {};
    const allDatesSet = new Set();

    appData.registeredForms.forEach(f => {
      formDatasets[f.id] = {};
      const fSub = appData.submissions[f.id] || { headers: [], rows: [] };
      const fRows = fSub.rows || [];

      fRows.forEach(row => {
        const ts = parseDateCell(row[0]);
        if (ts) {
          let keep = true;
          if (appData.analyticsTimeframe === '24h') {
            if (ts < oneDayAgo) keep = false;
          } else if (appData.analyticsTimeframe === 'last_week') {
            if (ts < sevenDaysAgo) keep = false;
          } else if (appData.analyticsTimeframe === 'current_month') {
            if (ts.getFullYear() !== currentYear || ts.getMonth() !== currentMonth) keep = false;
          }
          if (keep) {
            const dateStr = ts.toLocaleDateString('en-GB');
            allDatesSet.add(dateStr);
            formDatasets[f.id][dateStr] = (formDatasets[f.id][dateStr] || 0) + 1;
          }
        }
      });
    });

    const sortedDates = Array.from(allDatesSet).sort((a, b) => {
      const partsA = a.split('/');
      const partsB = b.split('/');
      return new Date(partsA[2], partsA[1] - 1, partsA[0]) - new Date(partsB[2], partsB[1] - 1, partsB[0]);
    });

    const colors = [
      'rgba(59, 130, 246, 0.75)',
      'rgba(16, 185, 129, 0.75)',
      'rgba(245, 158, 11, 0.75)',
      'rgba(239, 68, 68, 0.75)',
      'rgba(139, 92, 246, 0.75)',
      'rgba(236, 72, 153, 0.75)'
    ];

    const borderColors = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'
    ];

    const datasets = appData.registeredForms.map((f, idx) => {
      const dataPoints = sortedDates.map(d => formDatasets[f.id][d] || 0);
      return {
        label: f.name,
        data: dataPoints,
        backgroundColor: colors[idx % colors.length],
        borderColor: borderColors[idx % borderColors.length],
        borderWidth: 2,
        tension: 0.3,
        fill: false
      };
    });

    appData.chartInstanceVolume = new Chart(volCtx, {
      type: 'bar',
      data: {
        labels: sortedDates,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor } }
        },
        scales: {
          x: { 
            stacked: true,
            grid: { color: gridColor },
            ticks: { color: textColor }
          },
          y: { 
            stacked: true,
            grid: { color: gridColor },
            ticks: { color: textColor }
          }
        }
      }
    });

    const totalShares = appData.registeredForms.map(f => {
      const fSub = appData.submissions[f.id] || { headers: [], rows: [] };
      const fRows = fSub.rows || [];
      let count = 0;
      fRows.forEach(row => {
        const ts = parseDateCell(row[0]);
        if (ts) {
          let keep = true;
          if (appData.analyticsTimeframe === '24h') {
            if (ts < oneDayAgo) keep = false;
          } else if (appData.analyticsTimeframe === 'last_week') {
            if (ts < sevenDaysAgo) keep = false;
          } else if (appData.analyticsTimeframe === 'current_month') {
            if (ts.getFullYear() !== currentYear || ts.getMonth() !== currentMonth) keep = false;
          }
          if (keep) count++;
        }
      });
      return count;
    });

    appData.chartInstanceShare = new Chart(shareCtx, {
      type: 'doughnut',
      data: {
        labels: appData.registeredForms.map(f => f.name),
        datasets: [{
          data: totalShares,
          backgroundColor: colors.slice(0, appData.registeredForms.length)
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: textColor } }
        }
      }
    });

    return;
  }

  const subData = appData.submissions[formId] || { headers: [], rows: [] };
  const headers = subData.headers || [];
  const rows = subData.rows || [];

  // Filter rows based on selected analyticsTimeframe
  const filteredRows = rows.filter(row => {
    const ts = parseDateCell(row[0]);
    if (ts) {
      if (appData.analyticsTimeframe === '24h') {
        if (ts < oneDayAgo) return false;
      } else if (appData.analyticsTimeframe === 'last_week') {
        if (ts < sevenDaysAgo) return false;
      } else if (appData.analyticsTimeframe === 'current_month') {
        if (ts.getFullYear() !== currentYear || ts.getMonth() !== currentMonth) return false;
      }
      return true;
    }
    return false;
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
    let submitterColIdx = -1;
    const submitterKeywords = ['email', 'username', 'submitter', 'operator', 'નામ', 'ઇમેઇલ', 'ઓપરેટર', 'નામ/ઈમેલ'];
    if (Array.isArray(headers)) {
      headers.forEach((h, idx) => {
        if (typeof h === 'string') {
          const lowerH = h.toLowerCase();
          if (submitterKeywords.some(kw => lowerH.includes(kw))) {
            if (submitterColIdx === -1 || lowerH.includes('email') || lowerH.includes('ઓપરેટર')) {
              submitterColIdx = idx;
            }
          }
        }
      });
    }

    if (submitterColIdx === -1 && Array.isArray(filteredRows) && filteredRows.length > 0) {
      let numericCount = 0;
      let checkCount = 0;
      filteredRows.forEach(r => {
        if (r && r[1] !== undefined && r[1] !== null) {
          const val = String(r[1]).trim();
          if (val !== '') {
            checkCount++;
            if (!isNaN(val)) {
              numericCount++;
            }
          }
        }
      });
      if (checkCount === 0 || numericCount / checkCount <= 0.5) {
        submitterColIdx = 1;
      }
    }

    const submitterShare = {};
    filteredRows.forEach(row => {
      const operator = (submitterColIdx !== -1 && row[submitterColIdx])
        ? String(row[submitterColIdx]).trim()
        : 'System / ડેટા એન્ટ્રી';
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

  const activeStyle = 'background-color: var(--primary) !important; color: #ffffff !important; font-weight:700;';
  const inactiveStyle = 'background-color: var(--bg-main) !important; color: var(--text-main) !important; font-weight:600; border: none;';
  
  const tfBtns = ['tf-24h', 'tf-last_week', 'tf-current_month', 'tf-all_time'];
  tfBtns.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      if (id === `tf-${timeframe}`) {
        btn.setAttribute('style', `font-size: 0.7rem; padding: 4px 4px; flex-grow: 1; height: 100%; border-radius:4px; ${activeStyle}`);
      } else {
        btn.setAttribute('style', `font-size: 0.7rem; padding: 4px 4px; flex-grow: 1; height: 100%; border-radius:4px; ${inactiveStyle}`);
      }
    }
  });

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
        } else if (appData.summaryTimeframe === 'current_month') {
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

// Force clear cache and sync all sheets cleanly
function forceClearCache() {
  if (!confirm("શું તમે ખરેખર બધી કેશ મેમરી સાફ કરવા માંગો છો? આનાથી નવેસરથી બધો ડેટા સિંક થશે. / Are you sure you want to clear cache?")) return;
  
  appData.registeredForms.forEach(form => {
    localStorage.removeItem(`cached_dynamic_subs_headers_${form.id}`);
    localStorage.removeItem(`cached_dynamic_subs_rows_${form.id}`);
    appData.submissions[form.id] = { headers: [], rows: [] };
  });
  
  showToast("Cache cleared! Syncing sheets...");
  
  syncAllGoogleSheets().then(() => {
    setTimeout(() => {
      location.reload();
    }, 1500);
  });
}

// Render custom active part metrics summary for 74 machines
function renderCustomActivePartSummary(container, formId) {
  const subData = appData.submissions[formId] || { headers: [], rows: [] };
  const headers = subData.headers || [];
  const rows = subData.rows || [];

  if (rows.length === 0) {
    container.innerHTML = `
      <div class="card" style="border-top: 4px solid var(--accent); padding: 20px; text-align: center;">
        <p class="text-muted">આ શીટ માટે કોઈ એન્ટ્રી નથી / No entries to summarize</p>
      </div>
    `;
    return;
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const { filterFrom, filterTo, isActive: isCustomFilterActive } = getCurrentFilterRange();

  const filteredRows = rows.filter(row => {
    const ts = parseDateCell(row[0]);
    if (ts) {
      if (isCustomFilterActive) {
        if (filterFrom && ts < filterFrom) return false;
        if (filterTo && ts > filterTo) return false;
      } else {
        if (appData.summaryTimeframe === '24h') {
          if (ts < oneDayAgo) return false;
        } else if (appData.summaryTimeframe === 'last_week') {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (ts < sevenDaysAgo) return false;
        } else if (appData.summaryTimeframe === 'current_month') {
          if (ts.getFullYear() !== currentYear || ts.getMonth() !== currentMonth) return false;
        }
      }
      return true;
    }
    return false;
  });

  if (filteredRows.length === 0) {
    container.innerHTML = `
      <div class="card" style="border-top: 4px solid var(--accent); padding: 20px; text-align: center;">
        <p class="text-muted">પસંદ કરેલા સમયગાળામાં કોઈ ડેટા નથી / No data in selected timeframe</p>
      </div>
    `;
    return;
  }

  // Sort newest first
  filteredRows.sort((a, b) => {
    const da = parseDateCell(a[0]);
    const db = parseDateCell(b[0]);
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });

  const machineDeviations = {};
  const propertyDeviations = {
    'હાઈટ': 0,
    'વિથ': 0,
    'લેન્થ': 0,
    'વજન': 0
  };
  let totalDeviations = 0;

  // Track dimension problems per machine for top-3 by dimension lists
  const dimensionProblems = {
    'હાઈટ': {},
    'વિથ': {},
    'લેન્થ_વજન': {}
  };

  filteredRows.forEach(row => {
    headers.forEach((h, idx) => {
      if (idx > 1 && h.includes('મશીન')) {
        const valStr = String(row[idx] || '').trim();
        if (valStr !== '' && valStr !== '0' && valStr !== 'ok' && valStr !== 'OK') {
          const mMatch = h.match(/મશીન\s*\d+/);
          const mKey = mMatch ? mMatch[0] : 'અન્ય મશીન';
          
          machineDeviations[mKey] = (machineDeviations[mKey] || 0) + 1;
          totalDeviations++;

          if (h.includes('હાઈટ')) {
            propertyDeviations['હાઈટ']++;
            dimensionProblems['હાઈટ'][mKey] = (dimensionProblems['હાઈટ'][mKey] || 0) + 1;
          } else if (h.includes('વિથ')) {
            propertyDeviations['વિથ']++;
            dimensionProblems['વિથ'][mKey] = (dimensionProblems['વિથ'][mKey] || 0) + 1;
          } else if (h.includes('લેન્થ')) {
            propertyDeviations['લેન્થ']++;
            dimensionProblems['લેન્થ_વજન'][mKey] = (dimensionProblems['લેન્થ_વજન'][mKey] || 0) + 1;
          } else if (h.includes('વજન')) {
            propertyDeviations['વજન']++;
            dimensionProblems['લેન્થ_વજન'][mKey] = (dimensionProblems['લેન્થ_વજન'][mKey] || 0) + 1;
          }
        }
      }
    });
  });

  const getTop3 = (probObj) => {
    return Object.entries(probObj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  };

  const top3Height = getTop3(dimensionProblems['હાઈટ']);
  const top3Width = getTop3(dimensionProblems['વિથ']);
  const top3LenWt = getTop3(dimensionProblems['લેન્થ_વજન']);

  const sortedMachines = Object.entries(machineDeviations)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5); // top 5 problematic machines only

  let nameColIdx = 1;
  headers.forEach((h, idx) => {
    if (h.toLowerCase().includes('name') || h.includes('નામ')) {
      nameColIdx = idx;
    }
  });

  // Calculate overall checker activity shares in the selected timeframe
  const checkerActivity = {};
  filteredRows.forEach(row => {
    const checker = String(row[nameColIdx] || 'System / ડેટા એન્ટ્રી').trim();
    checkerActivity[checker] = (checkerActivity[checker] || 0) + 1;
  });
  const sortedActivity = Object.entries(checkerActivity).sort((a, b) => b[1] - a[1]);

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px;">
      
      <!-- Card 1: Main Stats -->
      <div class="card" style="border-left: 6px solid var(--primary); background: var(--card-bg); display:flex; flex-direction:column; justify-content:space-between; padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <div>
          <h3 style="color: var(--primary); font-size: 1.1rem; margin-bottom: 4px; font-weight:700;">📊 ઓવરઓલ એનાલિસિસ (Overall Stats)</h3>
          <p class="text-muted" style="font-size:0.8rem; margin-bottom: 16px;">પસંદ કરેલ સમયમાં કુલ એન્ટ્રી અને રીડીંગ વિગત</p>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div style="background:var(--bg-main); padding:14px; border-radius:8px; text-align:center; border: 1px solid var(--border-color);">
            <div style="font-size:0.75rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">કુલ એન્ટ્રીઓ</div>
            <div style="font-size:1.8rem; font-weight:800; color:var(--text-main); margin-top:4px;">${filteredRows.length}</div>
          </div>
          <div style="background:rgba(239, 68, 68, 0.05); padding:14px; border-radius:8px; text-align:center; border: 1px solid rgba(239, 68, 68, 0.15);">
            <div style="font-size:0.75rem; color:#ef4444; font-weight:600; text-transform:uppercase;">કુલ ખામીઓ</div>
            <div style="font-size:1.8rem; font-weight:800; color:#ef4444; margin-top:4px;">${totalDeviations}</div>
          </div>
        </div>
      </div>

      <!-- Card 2: Property-wise Errors with Expandable Pop-up Trigger -->
      <div class="card" style="border-left: 6px solid var(--warning); background: var(--card-bg); padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
          <h3 style="color: var(--warning); font-size: 1.1rem; font-weight:700; margin:0;">📐 ગુણધર્મ મુજબ ખામીઓ</h3>
          <span onclick="showDetailedActivePartBreakdown('${formId}')" style="cursor:pointer; font-size: 1.25rem; background: rgba(245, 158, 11, 0.1); padding: 2px 8px; border-radius: 6px;" title="ક્લિક કરો વિગતવાર પત્રક માટે">📂</span>
        </div>
        <p class="text-muted" style="font-size:0.8rem; margin-bottom: 16px;">કયા માપમાં કેટલી વાર ખામી મળી:</p>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:0.8rem;">
          ${Object.entries(propertyDeviations).map(([prop, count]) => {
            const pct = totalDeviations > 0 ? Math.round((count / totalDeviations) * 100) : 0;
            return `
              <div>
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                  <span style="font-weight:700; color:var(--text-main);">${prop}</span>
                  <span style="font-weight:600; color:var(--text-main);">${count} વાર (${pct}%)</span>
                </div>
                <div style="height:8px; background:var(--border-color); border-radius:4px; overflow:hidden;">
                  <div style="width:${pct}%; height:100%; background:var(--warning); border-radius:4px;"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        
        <div style="margin-top: 14px; font-size: 0.75rem; border-top: 1px solid var(--border-color); padding-top: 10px; line-height:1.45;">
          <strong style="color:var(--text-main); display:block; margin-bottom:6px;">🚨 ટોપ-૩ ખામી વાળા મશીનો (by Dimension):</strong>
          <div style="margin-bottom:4px;">
            <span style="color:#ef4444; font-weight:700;">હાઈટ:</span> ${top3Height.length > 0 ? top3Height.map(([m, c]) => `<strong>${m}</strong> (${c} વાર)`).join(', ') : 'કોઈ નહિ'}
          </div>
          <div style="margin-bottom:4px;">
            <span style="color:#f59e0b; font-weight:700;">વિથ:</span> ${top3Width.length > 0 ? top3Width.map(([m, c]) => `<strong>${m}</strong> (${c} વાર)`).join(', ') : 'કોઈ નહિ'}
          </div>
          <div>
            <span style="color:#3b82f6; font-weight:700;">લેન્થ/વજન:</span> ${top3LenWt.length > 0 ? top3LenWt.map(([m, c]) => `<strong>${m}</strong> (${c} વાર)`).join(', ') : 'કોઈ નહિ'}
          </div>
        </div>
      </div>

      <!-- Card 3: Top 5 Problematic Machines (Compact & Clickable) -->
      <div class="card" style="border-left: 6px solid var(--danger); background: var(--card-bg); padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <h3 style="color: var(--danger); font-size: 1.1rem; margin-bottom: 4px; font-weight:700;">🚨 સૌથી વધુ ખામી વાળા મશીનો (Top 5 Problematic)</h3>
        <p class="text-muted" style="font-size:0.8rem; margin-bottom: 16px;">સૌથી વધુ ખામી વાળા મશીન (બ્રેકડાઉન માટે ક્લિક કરો):</p>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:0.8rem;">
          ${sortedMachines.length > 0 ? sortedMachines.map(([m, count]) => {
            return `
              <div style="display:flex; justify-content:space-between; padding:6px 10px; background:rgba(239, 68, 68, 0.04); border-radius:6px; border:1px solid var(--border-color); align-items:center;">
                <strong style="color:var(--text-main);">${m}</strong>
                <span onclick="showMachineProblemsBreakdown('${m}', '${formId}')" style="color:#ef4444; font-weight:700; background:rgba(239, 68, 68, 0.08); padding:2px 8px; border-radius:4px; font-size:0.75rem; cursor:pointer;" title="ક્લિક કરો બ્રેકડાઉન એનાલિસિસ માટે">
                  ${count} વાર ભૂલ 🔍
                </span>
              </div>
            `;
          }).join('') : '<p class="text-muted" style="text-align:center; padding-top:20px;">કોઈ ખામી મળી નથી / No errors</p>'}
        </div>
      </div>

      <!-- Card 4: Checker Submissions share activity grid -->
      <div class="card" style="border-left: 6px solid #0f766e; background: var(--card-bg); padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <h3 style="color: #0f766e; font-size: 1.1rem; margin-bottom: 4px; font-weight:700;">👤 ચેકર ફોર્મ સબમિશન શેર (Checker Activity)</h3>
          <p class="text-muted" style="font-size:0.8rem; margin-bottom: 16px;">કોણે કેટલી એન્ટ્રી કરી અને તેનો હિસ્સો (Percentage Share):</p>
        </div>
        <div style="max-height: 140px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; font-size:0.8rem; padding-right:4px;">
          ${sortedActivity.length > 0 ? sortedActivity.map(([checker, count]) => {
            const share = filteredRows.length > 0 ? Math.round((count / filteredRows.length) * 100) : 0;
            return `
              <div>
                <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-weight:600;">
                  <span>👤 ${checker}</span>
                  <span>${count} એન્ટ્રી (${share}%)</span>
                </div>
                <div style="height:6px; background:var(--border-color); border-radius:3px; overflow:hidden;">
                  <div style="width:${share}%; height:100%; background:#0f766e; border-radius:3px;"></div>
                </div>
              </div>
            `;
          }).join('') : '<p class="text-muted" style="text-align:center; padding-top:20px;">કોઈ ડેટા નથી / No checker data</p>'}
        </div>
      </div>

    </div>
  `;
}

// Modal popup helper window logic
function showCustomModal(htmlContent) {
  const modal = document.getElementById('customModal');
  const content = document.getElementById('modalContent');
  if (modal && content) {
    content.innerHTML = htmlContent;
    modal.style.display = 'flex';
  }
}

function closeCustomModal() {
  const modal = document.getElementById('customModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Show detailed breakdown statistics for a specific machine in active part audits
function showMachineProblemsBreakdown(machineName, formId) {
  const subData = appData.submissions[formId] || { headers: [], rows: [] };
  const headers = subData.headers || [];
  const rows = subData.rows || [];

  const counts = {
    'હાઈટ (Height)': 0,
    'વિથ (Width)': 0,
    'લેન્થ (Length)': 0,
    'વજન (Weight)': 0
  };
  let total = 0;

  rows.forEach(row => {
    headers.forEach((h, idx) => {
      if (idx > 1 && h.includes(machineName)) {
        const valStr = String(row[idx] || '').trim();
        if (valStr !== '' && valStr !== '0' && valStr !== 'ok' && valStr !== 'OK') {
          if (h.includes('હાઈટ')) counts['હાઈટ (Height)']++;
          else if (h.includes('વિથ')) counts['વિથ (Width)']++;
          else if (h.includes('લેન્થ')) counts['લેન્થ (Length)']++;
          else if (h.includes('વજન')) counts['વજન (Weight)']++;
          total++;
        }
      }
    });
  });

  const breakdownHtml = `
    <h3 style="margin: 0 0 10px 0; color: var(--danger); font-size: 1.25rem; font-weight:700;">
      🚨 ${machineName} ખામી વિગત (Error Breakdown)
    </h3>
    <p class="text-muted" style="font-size:0.85rem; margin-bottom:18px;">
      કુલ રિપોર્ટ થયેલી ખામીઓ: <strong>${total} વાર</strong>
    </p>
    <div style="display:flex; flex-direction:column; gap:12px; margin-bottom: 20px;">
      ${Object.entries(counts).map(([prop, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return `
          <div>
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:4px; font-weight:600;">
              <span>${prop}</span>
              <span>${count} વાર (${pct}%)</span>
            </div>
            <div style="height:10px; background:var(--border-color); border-radius:5px; overflow:hidden;">
              <div style="width:${pct}%; height:100%; background:var(--danger); border-radius:5px;"></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <div style="text-align:right;">
      <button class="btn btn-secondary btn-sm" onclick="closeCustomModal()">બંધ કરો / Close</button>
    </div>
  `;

  showCustomModal(breakdownHtml);
}

// Show detailed list of all machines deviations tally in active part audits
function showDetailedActivePartBreakdown(formId) {
  const subData = appData.submissions[formId] || { headers: [], rows: [] };
  const headers = subData.headers || [];
  const rows = subData.rows || [];

  const machineDeviations = {};
  rows.forEach(row => {
    headers.forEach((h, idx) => {
      if (idx > 1 && h.includes('મશીન')) {
        const valStr = String(row[idx] || '').trim();
        if (valStr !== '' && valStr !== '0' && valStr !== 'ok' && valStr !== 'OK') {
          const mMatch = h.match(/મશીન\s*\d+/);
          const mKey = mMatch ? mMatch[0] : 'અન્ય મશીન';
          machineDeviations[mKey] = (machineDeviations[mKey] || 0) + 1;
        }
      }
    });
  });

  const sortedAll = Object.entries(machineDeviations).sort((a, b) => {
    const numA = parseInt(a[0].replace(/\D/g, '')) || 0;
    const numB = parseInt(b[0].replace(/\D/g, '')) || 0;
    return numA - numB;
  });

  const detailsHtml = `
    <h3 style="margin: 0 0 10px 0; color: var(--primary); font-size: 1.25rem; font-weight:700;">
      📐 મશીન વાઇઝ ખામીઓનું સંપૂર્ણ પત્રક (All Machines Deviations Tally)
    </h3>
    <p class="text-muted" style="font-size:0.85rem; margin-bottom:15px;">
      ખામી વાળા મશીનોની યાદી (બ્રેકડાઉન માટે કાઉન્ટ પર ક્લિક કરો):
    </p>
    <div style="max-height: 350px; overflow-y: auto; padding-right: 5px; margin-bottom: 20px; border: 1px solid var(--border-color); border-radius: 8px; padding: 10px;">
      <table style="width:100%; font-size:0.85rem; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 2px solid var(--border-color); text-align: left;">
            <th style="padding:8px 0; color: var(--text-muted);">મશીન નામ (Machine)</th>
            <th style="padding:8px 0; text-align:right; color: var(--text-muted);">કુલ ખામીઓ (Deviations)</th>
          </tr>
        </thead>
        <tbody>
          ${sortedAll.length > 0 ? sortedAll.map(([m, count]) => `
            <tr style="border-bottom:1px solid var(--border-color);">
              <td style="padding:8px 0; font-weight:700; color: var(--text-main);">${m}</td>
              <td style="padding:8px 0; text-align:right; color:#ef4444; font-weight:700;">
                <span onclick="closeCustomModal(); showMachineProblemsBreakdown('${m}', '${formId}');" style="cursor:pointer; background:rgba(239, 68, 68, 0.08); padding:4px 10px; border-radius:6px; font-size: 0.75rem;">
                  ${count} વાર ભૂલ 🔍
                </span>
              </td>
            </tr>
          `).join('') : `<tr><td colspan="2" style="text-align:center; padding:15px; color:var(--text-muted);">કોઈ ખામી મળી નથી</td></tr>`}
        </tbody>
      </table>
    </div>
    <div style="text-align:right;">
      <button class="btn btn-secondary btn-sm" onclick="closeCustomModal()">બંધ કરો / Close</button>
    </div>
  `;

  showCustomModal(detailsHtml);
}

// Render custom widgets summary for 10-7 Setup Machine Check form
function renderCustomSetupAuditSummary(container) {
  const subData = appData.submissions['form_10_7_setup_check'] || { headers: [], rows: [] };
  const headers = subData.headers || [];
  const rows = subData.rows || [];

  if (rows.length === 0) {
    container.innerHTML = `
      <div class="card" style="border-top: 4px solid var(--accent); padding: 20px; text-align: center;">
        <p class="text-muted">આ શીટ માટે કોઈ એન્ટ્રી નથી / No entries to summarize</p>
      </div>
    `;
    return;
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const { filterFrom, filterTo, isActive: isCustomFilterActive } = getCurrentFilterRange();

  const filteredRows = rows.filter(row => {
    const ts = parseDateCell(row[0]);
    if (ts) {
      if (isCustomFilterActive) {
        if (filterFrom && ts < filterFrom) return false;
        if (filterTo && ts > filterTo) return false;
      } else {
        if (appData.summaryTimeframe === '24h') {
          if (ts < oneDayAgo) return false;
        } else if (appData.summaryTimeframe === 'last_week') {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (ts < sevenDaysAgo) return false;
        } else if (appData.summaryTimeframe === 'current_month') {
          if (ts.getFullYear() !== currentYear || ts.getMonth() !== currentMonth) return false;
        }
      }
      return true;
    }
    return false;
  });

  if (filteredRows.length === 0) {
    container.innerHTML = `
      <div class="card" style="border-top: 4px solid var(--accent); padding: 20px; text-align: center;">
        <p class="text-muted">પસંદ કરેલા સમયગાળામાં કોઈ ડેટા નથી / No data in selected timeframe</p>
      </div>
    `;
    return;
  }

  let totalIssuesFound = 0;
  const machineIssueCounts = {};

  filteredRows.forEach(row => {
    headers.forEach((h, idx) => {
      if (idx > 3 && h.includes('મશીન')) {
        const valStr = String(row[idx] || '').trim();
        // Blank means not okay (setup issue!)
        if (valStr === '') {
          const mMatch = h.match(/મશીન\s*(નંબર)?\s*\d+/);
          const mKey = mMatch ? mMatch[0] : h;
          machineIssueCounts[mKey] = (machineIssueCounts[mKey] || 0) + 1;
          totalIssuesFound++;
        }
      }
    });
  });

  const sortedIssues = Object.entries(machineIssueCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  let nameColIdx = 3;
  headers.forEach((h, idx) => {
    if (h.toLowerCase().includes('name') || h.includes('નામ') || h.includes('ચેકર')) {
      nameColIdx = idx;
    }
  });

  const checkerActivity = {};
  filteredRows.forEach(row => {
    const checker = String(row[nameColIdx] || 'System / ડેટા એન્ટ્રી').trim();
    checkerActivity[checker] = (checkerActivity[checker] || 0) + 1;
  });
  const sortedActivity = Object.entries(checkerActivity).sort((a, b) => b[1] - a[1]);

  filteredRows.sort((a, b) => {
    const da = parseDateCell(a[0]);
    const db = parseDateCell(b[0]);
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });

  const latestRow = filteredRows[0];
  const missedMachinesInLatest = [];
  headers.forEach((h, idx) => {
    if (idx > 3 && h.includes('મશીન')) {
      const mMatch = h.match(/મશીન\s*(નંબર)?\s*\d+/);
      const mKey = mMatch ? mMatch[0] : h;
      const valStr = String(latestRow[idx] || '').trim();
      if (valStr === '') {
        missedMachinesInLatest.push(mKey);
      }
    }
  });

  const missedHtml = missedMachinesInLatest.length > 0
    ? `<div style="background:rgba(239, 68, 68, 0.04); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.15); padding:10px 14px; border-radius:8px; font-size:0.8rem; margin-top:12px;">
        <strong>⚠️ છેલ્લી એન્ટ્રીમાં સેટઅપ કરવાના બાકી રહી ગયેલા મશીનો (${missedMachinesInLatest.length}):</strong>
        <div style="margin-top:8px; font-weight:600; display:flex; flex-wrap:wrap; gap:6px; max-height:85px; overflow-y:auto;">
          ${missedMachinesInLatest.map(m => `<span style="background:rgba(239, 68, 68, 0.08); padding:3px 8px; border-radius:6px; font-size:0.75rem;">${m}</span>`).join('')}
        </div>
       </div>`
    : `<div style="background:rgba(13, 148, 136, 0.05); color:#0d9488; border:1px solid rgba(13, 148, 136, 0.15); padding:10px 14px; border-radius:8px; font-size:0.8rem; margin-top:12px; font-weight:700; display:flex; align-items:center; gap:6px;">
        🟢 છેલ્લી એન્ટ્રીમાં બધા જ મશીન સેટઅપ કમ્પ્લીટ છે (All machines setup checked and OK)
       </div>`;

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px;">
      
      <!-- Card 1: Main Stats -->
      <div class="card" style="border-left: 6px solid var(--primary); background: var(--card-bg); display:flex; flex-direction:column; justify-content:space-between; padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <div>
          <h3 style="color: var(--primary); font-size: 1.1rem; margin-bottom: 4px; font-weight:700;">📊 ઓવરઓલ એનાલિસિસ (Setup Stats)</h3>
          <p class="text-muted" style="font-size:0.8rem; margin-bottom: 16px;">પસંદ કરેલ સમયમાં મશીન સેટઅપ ચેકિંગ વિગત</p>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div style="background:var(--bg-main); padding:14px; border-radius:8px; text-align:center; border: 1px solid var(--border-color);">
            <div style="font-size:0.75rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">કુલ એન્ટ્રીઓ</div>
            <div style="font-size:1.8rem; font-weight:800; color:var(--text-main); margin-top:4px;">${filteredRows.length}</div>
          </div>
          <div style="background:rgba(239, 68, 68, 0.05); padding:14px; border-radius:8px; text-align:center; border: 1px solid rgba(239, 68, 68, 0.15);">
            <div style="font-size:0.75rem; color:#ef4444; font-weight:600; text-transform:uppercase;">સેટઅપ ખામીઓ</div>
            <div style="font-size:1.8rem; font-weight:800; color:#ef4444; margin-top:4px;">${totalIssuesFound}</div>
          </div>
        </div>
      </div>

      <!-- Card 2: Setup Issues Tally -->
      <div class="card" style="border-left: 6px solid var(--danger); background: var(--card-bg); padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <h3 style="color: var(--danger); font-size: 1.1rem; margin-bottom: 4px; font-weight:700;">🚨 રિપોર્ટ થયેલી ખામીઓ (Setup Issues)</h3>
        <p class="text-muted" style="font-size:0.8rem; margin-bottom: 16px;">કયા મશીનમાં કેટલી વાર ખામી (Blank) મળી:</p>
        <div style="max-height: 140px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; font-size:0.8rem; padding-right:4px;">
          ${sortedIssues.length > 0 ? sortedIssues.map(([m, count]) => {
            return `
              <div style="display:flex; justify-content:space-between; padding:6px 10px; background:rgba(239, 68, 68, 0.04); border-radius:6px; border:1px solid var(--border-color); align-items:center;">
                <strong style="color:var(--text-main);">${m}</strong>
                <span style="color:#ef4444; font-weight:700; background:rgba(239, 68, 68, 0.08); padding:2px 8px; border-radius:4px; font-size:0.75rem;">
                  ${count} વાર બાકી
                </span>
              </div>
            `;
          }).join('') : '<p class="text-muted" style="text-align:center; padding-top:20px;">બધા મશીન સેટઅપ ઓકે છે / All setups OK</p>'}
        </div>
      </div>

      <!-- Card 3: Checker Tally -->
      <div class="card" style="border-left: 6px solid #0f766e; background: var(--card-bg); padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <h3 style="color: #0f766e; font-size: 1.1rem; margin-bottom: 4px; font-weight:700;">👤 ચેકર ફોર્મ સબમિશન શેર (Checker Activity)</h3>
          <p class="text-muted" style="font-size:0.8rem; margin-bottom: 16px;">કોણે કેટલી એન્ટ્રી કરી અને તેનો હિસ્સો (Percentage Share):</p>
        </div>
        <div style="max-height: 140px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; font-size:0.8rem; padding-right:4px;">
          ${sortedActivity.length > 0 ? sortedActivity.map(([checker, count]) => {
            const share = filteredRows.length > 0 ? Math.round((count / filteredRows.length) * 100) : 0;
            return `
              <div>
                <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-weight:600;">
                  <span>👤 ${checker}</span>
                  <span>${count} એન્ટ્રી (${share}%)</span>
                </div>
                <div style="height:6px; background:var(--border-color); border-radius:3px; overflow:hidden;">
                  <div style="width:${share}%; height:100%; background:#0f766e; border-radius:3px;"></div>
                </div>
              </div>
            `;
          }).join('') : '<p class="text-muted" style="text-align:center; padding-top:20px;">કોઈ ડેટા નથી / No checker data</p>'}
        </div>
      </div>

    </div>
    ${missedHtml}
  `;
}

// Edit connected sheet and form parameters
function editFormBinding(formId) {
  const form = appData.registeredForms.find(f => f.id === formId);
  if (!form) return;

  const html = `
    <h3 style="margin: 0 0 10px 0; color: var(--primary); font-size: 1.2rem; font-weight:700;">
      ✏️ ફોર્મ માહિતી સુધારો (Edit Form Details)
    </h3>
    <p class="text-muted" style="font-size:0.8rem; margin-bottom:18px;">
      નીચે આપેલી માહિતી સુધારીને સેવ કરો:
    </p>
    <div style="display:flex; flex-direction:column; gap:12px; text-align: left; margin-bottom: 20px;">
      <div class="form-group">
        <label style="font-weight: 600; font-size:0.85rem; margin-bottom:4px; display:block;">૧. ફોર્મ અથવા પ્રોજેક્ટનું નામ (Form Title)</label>
        <input type="text" id="editFormName" value="${form.name}" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-main); font-weight:600;">
      </div>
      <div class="form-group">
        <label style="font-weight: 600; font-size:0.85rem; margin-bottom:4px; display:block;">૨. ગૂગલ ફોર્મ લિંક (Google Form Link) [વૈકલ્પિક]</label>
        <input type="url" id="editFormUrl" value="${form.formUrl || ''}" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-main);">
      </div>
      <div class="form-group">
        <label style="font-weight: 600; font-size:0.85rem; margin-bottom:4px; display:block;">૩. ગૂગલ શીટ લિંક (Response Sheet Link)</label>
        <input type="url" id="editSheetUrl" value="${form.url}" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-main);">
      </div>
    </div>
    <div style="text-align:right; display:flex; gap:10px; justify-content:flex-end;">
      <button class="btn btn-secondary btn-sm" onclick="closeCustomModal()">રદ કરો / Cancel</button>
      <button class="btn btn-sm" onclick="saveEditedFormBinding('${formId}')" style="background:var(--primary); color:white; font-weight:600; padding:6px 14px;">💾 સેવ કરો / Save</button>
    </div>
  `;

  showCustomModal(html);
}

function saveEditedFormBinding(formId) {
  const nameInput = document.getElementById('editFormName');
  const formUrlInput = document.getElementById('editFormUrl');
  const sheetUrlInput = document.getElementById('editSheetUrl');

  if (!nameInput || !sheetUrlInput) return;

  const newName = nameInput.value.trim();
  const newFormUrl = formUrlInput ? formUrlInput.value.trim() : '';
  const newSheetUrl = sheetUrlInput.value.trim();

  if (!newName || !newSheetUrl) {
    showToast('Name and Sheet URL are required!', 'danger');
    return;
  }

  const formIndex = appData.registeredForms.findIndex(f => f.id === formId);
  if (formIndex !== -1) {
    const prevUrl = appData.registeredForms[formIndex].url;
    appData.registeredForms[formIndex].name = newName;
    appData.registeredForms[formIndex].formUrl = newFormUrl;
    appData.registeredForms[formIndex].url = newSheetUrl;

    if (prevUrl !== newSheetUrl) {
      // Clear old cached responses to force a clean sync
      localStorage.removeItem(`cached_dynamic_subs_headers_${formId}`);
      localStorage.removeItem(`cached_dynamic_subs_rows_${formId}`);
      appData.submissions[formId] = { headers: [], rows: [] };
      
      showToast('Sheet URL changed, syncing new data...', 'warning');
      syncGoogleSheet(formId).then(() => {
        renderActiveConnectionsTable();
        renderDashboardTable();
      });
    } else {
      showToast('ફોર્મ સફળતાપૂર્વક અપડેટ થયું! / Form updated!');
    }

    saveRegistryToStorage();
    closeCustomModal();
    renderActiveConnectionsTable();
    renderDashboardTable();
    renderFormSelector();
  }
}

// Custom formatters for cleaning checklists in response table
function formatCleaningCell(cellVal) {
  const val = String(cellVal || '').trim();
  if (val === '' || val === '-') {
    return `<span style="color:#ef4444; font-size:0.75rem; font-weight:600;">⚠️ Not Checked</span>`;
  }
  
  const issues = [];
  if (val.includes('પાણી લીકેજ')) {
    issues.push('💧 પાણી લીકેજ');
  }
  if (val.includes('કચરું જોવું')) {
    issues.push('🗑️ કચરું જોવું');
  }
  
  if (issues.length > 0) {
    return `<div style="color:#ef4444; font-size:0.75rem; font-weight:700; line-height:1.35;">
      ${issues.map(iss => `❌ ${iss}`).join('<br>')}
    </div>`;
  }
  
  return `<span style="color:#10b981; font-weight:700; font-size:0.8rem;">🟢 All OK</span>`;
}

// Custom formatters for camera checklists in response table
function formatCameraCell(cellVal) {
  const val = String(cellVal || '').trim();
  if (val === '' || val === '-') {
    return `<span style="color:#ef4444; font-size:0.75rem; font-weight:600;">⚠️ Not Checked</span>`;
  }
  
  const standardParams = [
    'સેન્ટર લાઈન',
    'ગોળી ની સાઈઝ',
    'ટીચિંગ સ્ટોન 1',
    'ટીચિંગ સ્ટોન 2',
    'ટીચિંગ સ્ટોન 3',
    'સાફસફાઈ'
  ];
  
  const missing = [];
  standardParams.forEach(p => {
    if (!val.includes(p)) {
      missing.push(p);
    }
  });
  
  if (missing.length > 0) {
    return `<div style="color:#ef4444; font-size:0.75rem; font-weight:700; line-height:1.35;">
      ${missing.map(p => `❌ ${p} બાકી`).join('<br>')}
    </div>`;
  }
  
  return `<span style="color:#10b981; font-weight:700; font-size:0.8rem;">🟢 All OK</span>`;
}

// Render custom summary dashboard for Multi Stitching Camera Check form
function renderCustomCameraAuditSummary(container) {
  const subData = appData.submissions['form_multi_stitch_camera_saiambe'] || { headers: [], rows: [] };
  const headers = subData.headers || [];
  const rows = subData.rows || [];

  if (rows.length === 0) {
    container.innerHTML = `
      <div class="card" style="border-top: 4px solid var(--accent); padding: 20px; text-align: center;">
        <p class="text-muted">આ શીટ માટે કોઈ એન્ટ્રી નથી / No entries to summarize</p>
      </div>
    `;
    return;
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const { filterFrom, filterTo, isActive: isCustomFilterActive } = getCurrentFilterRange();

  const filteredRows = rows.filter(row => {
    const ts = parseDateCell(row[0]);
    if (ts) {
      if (isCustomFilterActive) {
        if (filterFrom && ts < filterFrom) return false;
        if (filterTo && ts > filterTo) return false;
      } else {
        if (appData.summaryTimeframe === '24h') {
          if (ts < oneDayAgo) return false;
        } else if (appData.summaryTimeframe === 'last_week') {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (ts < sevenDaysAgo) return false;
        } else if (appData.summaryTimeframe === 'current_month') {
          if (ts.getFullYear() !== currentYear || ts.getMonth() !== currentMonth) return false;
        }
      }
      return true;
    }
    return false;
  });

  if (filteredRows.length === 0) {
    container.innerHTML = `
      <div class="card" style="border-top: 4px solid var(--accent); padding: 20px; text-align: center;">
        <p class="text-muted">પસંદ કરેલા સમયગાળામાં કોઈ ડેટા નથી / No data in selected timeframe</p>
      </div>
    `;
    return;
  }

  let totalCameraChecks = 0;
  let totalCameraIssues = 0;
  const cameraIssueTally = {};

  const standardParams = [
    'સેન્ટર લાઈન',
    'ગોળી ની સાઈઝ',
    'ટીચિંગ સ્ટોન 1',
    'ટીચિંગ સ્ટોન 2',
    'ટીચિંગ સ્ટોન 3',
    'સાફસફાઈ'
  ];

  filteredRows.forEach(row => {
    headers.forEach((h, idx) => {
      if (idx > 3 && h.includes('કેમેરા')) {
        const valStr = String(row[idx] || '').trim();
        if (valStr !== '' && valStr !== '-') {
          totalCameraChecks++;
          let hasIssue = false;
          standardParams.forEach(p => {
            if (!valStr.includes(p)) {
              hasIssue = true;
            }
          });
          if (hasIssue) {
            const camKey = h.match(/કેમેરા\s*(નંબર)?\s*\d+/) ? h.match(/કેમેરા\s*(નંબર)?\s*\d+/)[0] : h;
            cameraIssueTally[camKey] = (cameraIssueTally[camKey] || 0) + 1;
            totalCameraIssues++;
          }
        }
      }
    });
  });

  const sortedIssues = Object.entries(cameraIssueTally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  let nameColIdx = 3;
  headers.forEach((h, idx) => {
    if (h.toLowerCase().includes('name') || h.includes('નામ') || h.includes('ચેકર')) {
      nameColIdx = idx;
    }
  });

  const checkerActivity = {};
  filteredRows.forEach(row => {
    const checker = String(row[nameColIdx] || 'System / ડેટા એન્ટ્રી').trim();
    checkerActivity[checker] = (checkerActivity[checker] || 0) + 1;
  });
  const sortedActivity = Object.entries(checkerActivity).sort((a, b) => b[1] - a[1]);

  filteredRows.sort((a, b) => {
    const da = parseDateCell(a[0]);
    const db = parseDateCell(b[0]);
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });

  const latestRow = filteredRows[0];
  const missedCamerasInLatest = [];
  headers.forEach((h, idx) => {
    if (idx > 3 && h.includes('કેમેરા')) {
      const camKey = h.match(/કેમેરા\s*(નંબર)?\s*\d+/) ? h.match(/કેમેરા\s*(નંબર)?\s*\d+/)[0] : h;
      const valStr = String(latestRow[idx] || '').trim();
      if (valStr === '' || valStr === '-') {
        missedCamerasInLatest.push(camKey);
      }
    }
  });

  const missedHtml = missedCamerasInLatest.length > 0
    ? `<div style="background:rgba(239, 68, 68, 0.04); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.15); padding:10px 14px; border-radius:8px; font-size:0.8rem; margin-top:12px;">
        <strong>⚠️ છેલ્લી એન્ટ્રીમાં બાકી રહી ગયેલા કેમેરા સબમિશન (${missedCamerasInLatest.length}):</strong>
        <div style="margin-top:8px; font-weight:600; display:flex; flex-wrap:wrap; gap:6px; max-height:85px; overflow-y:auto;">
          ${missedCamerasInLatest.map(m => `<span style="background:rgba(239, 68, 68, 0.08); padding:3px 8px; border-radius:6px; font-size:0.75rem;">${m}</span>`).join('')}
        </div>
       </div>`
    : `<div style="background:rgba(13, 148, 136, 0.05); color:#0d9488; border:1px solid rgba(13, 148, 136, 0.15); padding:10px 14px; border-radius:8px; font-size:0.8rem; margin-top:12px; font-weight:700; display:flex; align-items:center; gap:6px;">
        🟢 છેલ્લી એન્ટ્રીમાં બધા જ કેમેરા વ્યવસ્થિત ઓડિટ છે (All cameras verified and OK)
       </div>`;

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px;">
      
      <!-- Card 1: Main Stats -->
      <div class="card" style="border-left: 6px solid var(--primary); background: var(--card-bg); display:flex; flex-direction:column; justify-content:space-between; padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <div>
          <h3 style="color: var(--primary); font-size: 1.1rem; margin-bottom: 4px; font-weight:700;">📊 ઓવરઓલ એનાલિસિસ (Camera Stats)</h3>
          <p class="text-muted" style="font-size:0.8rem; margin-bottom: 16px;">પસંદ કરેલ સમયમાં કેમેરા ચેકિંગ વિગત</p>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div style="background:var(--bg-main); padding:14px; border-radius:8px; text-align:center; border: 1px solid var(--border-color);">
            <div style="font-size:0.75rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">કુલ એન્ટ્રીઓ</div>
            <div style="font-size:1.8rem; font-weight:800; color:var(--text-main); margin-top:4px;">${filteredRows.length}</div>
          </div>
          <div style="background:rgba(239, 68, 68, 0.05); padding:14px; border-radius:8px; text-align:center; border: 1px solid rgba(239, 68, 68, 0.15);">
            <div style="font-size:0.75rem; color:#ef4444; font-weight:600; text-transform:uppercase;">કેમેરા ખામીઓ</div>
            <div style="font-size:1.8rem; font-weight:800; color:#ef4444; margin-top:4px;">${totalCameraIssues}</div>
          </div>
        </div>
      </div>

      <!-- Card 2: Camera Issues Tally -->
      <div class="card" style="border-left: 6px solid var(--danger); background: var(--card-bg); padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <h3 style="color: var(--danger); font-size: 1.1rem; margin-bottom: 4px; font-weight:700;">🚨 રિપોર્ટ થયેલી ખામીઓ (Camera Issues)</h3>
        <p class="text-muted" style="font-size:0.8rem; margin-bottom: 16px;">કયા કેમેરામાં કેટલી વાર પેરામીટર અધૂરા મળ્યા:</p>
        <div style="max-height: 140px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; font-size:0.8rem; padding-right:4px;">
          ${sortedIssues.length > 0 ? sortedIssues.map(([m, count]) => {
            return `
              <div style="display:flex; justify-content:space-between; padding:6px 10px; background:rgba(239, 68, 68, 0.04); border-radius:6px; border:1px solid var(--border-color); align-items:center;">
                <strong style="color:var(--text-main);">${m}</strong>
                <span style="color:#ef4444; font-weight:700; background:rgba(239, 68, 68, 0.08); padding:2px 8px; border-radius:4px; font-size:0.75rem;">
                  ${count} વાર ખામી
                </span>
              </div>
            `;
          }).join('') : '<p class="text-muted" style="text-align:center; padding-top:20px;">બધા જ કેમેરા ઓકે છે / All cameras OK</p>'}
        </div>
      </div>

      <!-- Card 3: Checker Tally -->
      <div class="card" style="border-left: 6px solid #0f766e; background: var(--card-bg); padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <h3 style="color: #0f766e; font-size: 1.1rem; margin-bottom: 4px; font-weight:700;">👤 ચેકર ફોર્મ સબમિશન શેર (Checker Activity)</h3>
          <p class="text-muted" style="font-size:0.8rem; margin-bottom: 16px;">કોણે કેટલી એન્ટ્રી કરી અને તેનો હિસ્સો (Percentage Share):</p>
        </div>
        <div style="max-height: 140px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; font-size:0.8rem; padding-right:4px;">
          ${sortedActivity.length > 0 ? sortedActivity.map(([checker, count]) => {
            const share = filteredRows.length > 0 ? Math.round((count / filteredRows.length) * 100) : 0;
            return `
              <div>
                <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-weight:600;">
                  <span>👤 ${checker}</span>
                  <span>${count} એન્ટ્રી (${share}%)</span>
                </div>
                <div style="height:6px; background:var(--border-color); border-radius:3px; overflow:hidden;">
                  <div style="width:${share}%; height:100%; background:#0f766e; border-radius:3px;"></div>
                </div>
              </div>
            `;
          }).join('') : '<p class="text-muted" style="text-align:center; padding-top:20px;">કોઈ ડેટા નથી / No checker data</p>'}
        </div>
      </div>

    </div>
    ${missedHtml}
  `;
}

// Custom cell formatter for setup check checklist
function formatSetupCell(cellVal) {
  const val = String(cellVal || '').trim();
  if (val === '' || val === '-') {
    return `<span style="color:#ef4444; font-size:0.75rem; font-weight:600;">⚠️ Not Checked</span>`;
  }

  const standardParams = [
    'સ્ટોન ઓકે',
    'ઈમેજ ઓકે',
    'એલાઈનમેન્ટ ઓકે',
    'સ્ટેજ ઓકે',
    'વાઈટનર ઓકે',
    'સી ડ્રાઈવ ઓકે',
    'લોગ ઓકે',
    'નિયરેસ્ટ ઓકે',
    'સબ સપ્લાય ઓકે'
  ];

  const missing = [];
  standardParams.forEach(p => {
    if (!val.includes(p)) {
      missing.push(p);
    }
  });

  if (missing.length > 0) {
    return `<div style="color:#ef4444; font-size:0.75rem; font-weight:700; line-height:1.35;">
      ${missing.map(p => `❌ ${p} બાકી`).join('<br>')}
    </div>`;
  }

  return `<span style="color:#10b981; font-weight:700; font-size:0.8rem;">🟢 ✔️ All OK</span>`;
}

// Calculate missed machines or cameras in a single response row
function getMissedCountInRow(row, headers, formId) {
  let missedCount = 0;
  let totalCount = 0;
  
  headers.forEach((h, idx) => {
    if (idx > 3 && (h.includes('મશીન') || h.includes('કેમેરા'))) {
      totalCount++;
      const val = String(row[idx] || '').trim();
      if (val === '' || val === '-') {
        missedCount++;
      }
    }
  });
  return { missed: missedCount, total: totalCount };
}

// Custom cell formatter for Active Part checklist
function formatActivePartCell(cellVal) {
  const val = String(cellVal || '').trim();
  if (val === '' || val === '-') {
    return `<span style="color:#ef4444; font-size:0.75rem; font-weight:600;">⚠️ Not Checked</span>`;
  }
  
  if (val === '0' || val.toLowerCase() === 'ok' || val.toLowerCase() === 'ok') {
    return `<span style="color:#10b981; font-weight:700; font-size:0.8rem;">🟢 ✔️ All OK</span>`;
  }
  
  return `<span style="color:#ef4444; font-weight:800; font-size:0.8rem;">❌ ${val}</span>`;
}
