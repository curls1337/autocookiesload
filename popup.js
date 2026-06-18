// Cookie Auto Loader Premium - Popup Controller

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const searchInput = document.getElementById('search-input');
  const countryFilter = document.getElementById('country-filter');
  const profileList = document.getElementById('profile-list');
  const visibleCount = document.getElementById('visible-count');
  const emptyState = document.getElementById('empty-state');
  
  const statTotalProfiles = document.getElementById('stat-total-profiles').querySelector('.stat-val');
  const statTotalCountries = document.getElementById('stat-total-countries').querySelector('.stat-val');
  
  const btnClearCookies = document.getElementById('btn-clear-cookies');
  const btnDeleteAll = document.getElementById('btn-delete-all');
  const toastContainer = document.getElementById('toast-container');

  // Application State
  let allProfiles = [];
  let activeProfileId = null;

  // Initialize
  loadStateFromStorage();
  setupEventListeners();

  // --- State & Storage ---

  function loadStateFromStorage() {
    chrome.storage.local.get(['profiles', 'activeProfileId'], (result) => {
      allProfiles = result.profiles || [];
      activeProfileId = result.activeProfileId || null;
      
      updateStats();
      populateCountryFilter();
      renderProfiles();
    });
  }

  function saveProfilesToStorage() {
    chrome.storage.local.set({ profiles: allProfiles }, () => {
      updateStats();
      populateCountryFilter();
      renderProfiles();
    });
  }

  function setActiveProfile(profileId) {
    activeProfileId = profileId;
    chrome.storage.local.set({ activeProfileId: profileId }, () => {
      renderProfiles();
    });
  }

  function updateStats() {
    statTotalProfiles.textContent = allProfiles.length;
    
    const countries = new Set(allProfiles.map(p => p.country).filter(Boolean));
    statTotalCountries.textContent = countries.size;
  }

  function populateCountryFilter() {
    const countries = [...new Set(allProfiles.map(p => p.country).filter(Boolean))].sort();
    
    // Keep the first default option
    countryFilter.innerHTML = '<option value="">All Countries</option>';
    
    countries.forEach(country => {
      const option = document.createElement('option');
      option.value = country;
      option.textContent = `${getFlagEmoji(country)} ${country}`;
      countryFilter.appendChild(option);
    });
  }

  // --- Event Listeners ---

  function setupEventListeners() {
    // Drop Zone Click -> Trigger File Input
    dropZone.addEventListener('click', () => fileInput.click());

    // File Input Selection
    fileInput.addEventListener('change', (e) => {
      handleFiles(e.target.files);
      fileInput.value = ''; // Reset to allow re-uploading same file
    });

    // Drag and Drop
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('dragover');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('dragover');
      }, false);
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      handleFiles(dt.files);
    });

    // Search and Filter
    searchInput.addEventListener('input', renderProfiles);
    countryFilter.addEventListener('change', renderProfiles);

    // Global Actions
    btnClearCookies.addEventListener('click', handleClearCookies);
    btnDeleteAll.addEventListener('click', handleDeleteAll);
  }

  // --- File Processing & Parsing ---

  function handleFiles(files) {
    if (!files || files.length === 0) return;

    let loadedCount = 0;
    let errorCount = 0;
    const promises = [];

    showToast(`Parsing ${files.length} file(s)...`, 'info');

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.endsWith('.txt')) {
        errorCount++;
        continue;
      }

      const promise = new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target.result;
          const parsed = parseCookieFile(text, file.name);
          
          if (parsed && parsed.cookies && parsed.cookies.length > 0) {
            // Check if profile already exists (by email/username) to update it, or add new
            const existingIndex = allProfiles.findIndex(p => p.email === parsed.metadata.email);
            const profileData = {
              id: parsed.metadata.email || `profile_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              email: parsed.metadata.email,
              country: parsed.metadata.country,
              plan: parsed.metadata.plan,
              profileName: parsed.metadata.profileName,
              domain: parsed.metadata.domain,
              cookies: parsed.cookies,
              importDate: Date.now(),
              fileName: file.name
            };

            if (existingIndex > -1) {
              allProfiles[existingIndex] = profileData;
            } else {
              allProfiles.push(profileData);
            }
            loadedCount++;
          } else {
            errorCount++;
          }
          resolve();
        };
        reader.onerror = () => {
          errorCount++;
          resolve();
        };
        reader.readAsText(file);
      });

      promises.push(promise);
    }

    Promise.all(promises).then(() => {
      if (loadedCount > 0) {
        saveProfilesToStorage();
        showToast(`Successfully imported ${loadedCount} profiles!`, 'success');
      }
      if (errorCount > 0) {
        showToast(`Failed to parse ${errorCount} file(s).`, 'error');
      }
    });
  }

  function parseCookieFile(text, fileName) {
    const lines = text.split(/\r?\n/);
    const cookies = [];
    const metadata = {
      email: '',
      profileName: '',
      plan: '',
      country: '',
      domain: ''
    };

    // Try parsing details from filename first
    // Expected format: [Premium] [AT] 1000@brtna.at.txt or [Premium] [US] some_email@domain.com.txt
    if (fileName) {
      const fnMatch = fileName.match(/^\[(.*?)\]\s*\[(.*?)\]\s*(.*?)\.txt$/i);
      if (fnMatch) {
        metadata.plan = fnMatch[1].trim();
        metadata.country = fnMatch[2].trim().toUpperCase();
        metadata.email = fnMatch[3].trim();
      } else {
        // Fallback email from name
        metadata.email = fileName.replace(/\.txt$/i, '');
      }
    }

    // JSON Parser Fallback
    const trimmedText = text.trim();
    if (trimmedText.startsWith('[') || trimmedText.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmedText);
        const cookiesArray = Array.isArray(parsed) ? parsed : [parsed];
        
        cookiesArray.forEach(c => {
          if (c.name && c.value) {
            const cDomain = c.domain || '.netflix.com';
            cookies.push({
              domain: cDomain,
              includeSubdomains: c.hostOnly === false,
              path: c.path || '/',
              secure: c.secure || false,
              expiry: c.expirationDate || (Math.floor(Date.now() / 1000) + 86400 * 365),
              name: c.name,
              value: c.value,
              httpOnly: c.httpOnly || false
            });
            if (!metadata.domain) {
              metadata.domain = cDomain.replace(/^\./, '');
            }
          }
        });

        if (cookies.length > 0) {
          if (!metadata.email) metadata.email = 'JSON Account ' + new Date().toLocaleDateString();
          if (!metadata.domain) metadata.domain = 'netflix.com';
          return { metadata, cookies };
        }
      } catch (e) {
        // Continue to Netscape parser
      }
    }

    // Standard Netscape Parser
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Extract metadata lines
      // E.g. – Email: 1000@brtna.at
      // E.g. – Profile: Benni\x20
      // E.g. – Plan: Premium
      // E.g. – Country: AT
      if (trimmed.includes('Email:')) {
        metadata.email = trimmed.split(/Email:\s*/i)[1].trim();
        return;
      }
      if (trimmed.includes('Profile:')) {
        metadata.profileName = trimmed.split(/Profile:\s*/i)[1].trim().replace(/\\x20/g, ' ');
        return;
      }
      if (trimmed.includes('Plan:')) {
        metadata.plan = trimmed.split(/Plan:\s*/i)[1].trim();
        return;
      }
      if (trimmed.includes('Country:')) {
        metadata.country = trimmed.split(/Country:\s*/i)[1].trim().toUpperCase();
        return;
      }

      // Check HttpOnly prefix
      const isHttpOnly = trimmed.startsWith('#HttpOnly_');
      if (trimmed.startsWith('#') && !isHttpOnly) {
        return; // Comment line
      }

      // Parse tab-delimited values
      const parts = trimmed.split('\t');
      if (parts.length >= 6) {
        let domain = parts[0];
        if (isHttpOnly) {
          domain = domain.substring(10); // strip #HttpOnly_
        }

        const includeSubdomains = parts[1].toUpperCase() === 'TRUE';
        const path = parts[2];
        const secure = parts[3].toUpperCase() === 'TRUE';
        
        let expiry = parseFloat(parts[4]);
        const name = parts[5];
        const value = parts[6] || '';

        // If expiry is in the past, update it to 1 year from now
        if (isNaN(expiry) || expiry < Date.now() / 1000) {
          expiry = Math.floor(Date.now() / 1000) + (86400 * 365);
        }

        cookies.push({
          domain,
          includeSubdomains,
          path,
          secure,
          expiry,
          name,
          value,
          httpOnly: isHttpOnly
        });

        if (!metadata.domain) {
          metadata.domain = domain.replace(/^\./, '');
        }
      }
    });

    if (cookies.length > 0) {
      if (!metadata.email) metadata.email = 'Unknown Profile';
      if (!metadata.domain) metadata.domain = 'netflix.com';
      return { metadata, cookies };
    }

    return null;
  }

  // --- Rendering UI ---

  function renderProfiles() {
    // Clear list
    profileList.innerHTML = '';

    const searchQuery = searchInput.value.toLowerCase();
    const selectedCountry = countryFilter.value;

    const filtered = allProfiles.filter(profile => {
      const matchesSearch = 
        profile.email.toLowerCase().includes(searchQuery) ||
        (profile.plan && profile.plan.toLowerCase().includes(searchQuery)) ||
        (profile.profileName && profile.profileName.toLowerCase().includes(searchQuery)) ||
        profile.country.toLowerCase().includes(searchQuery);

      const matchesCountry = !selectedCountry || profile.country === selectedCountry;

      return matchesSearch && matchesCountry;
    });

    // Update count indicator
    visibleCount.textContent = `${filtered.length} showing`;

    if (filtered.length === 0) {
      emptyState.style.display = 'flex';
      profileList.appendChild(emptyState);
    } else {
      emptyState.style.display = 'none';

      filtered.forEach(profile => {
        const card = createProfileCard(profile);
        profileList.appendChild(card);
      });
    }
  }

  function createProfileCard(profile) {
    const isActive = activeProfileId === profile.id;

    const card = document.createElement('div');
    card.className = `profile-card ${isActive ? 'active' : ''}`;
    card.dataset.id = profile.id;

    // Build Details Area
    const details = document.createElement('div');
    details.className = 'card-details';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = profile.profileName 
      ? `${profile.profileName} (${profile.email})`
      : profile.email;
    title.title = profile.email;
    details.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'card-meta';

    // Active Badge
    if (isActive) {
      const activeBadge = document.createElement('span');
      activeBadge.className = 'badge badge-active';
      activeBadge.textContent = 'Active';
      meta.appendChild(activeBadge);
    }

    // Country Badge
    if (profile.country) {
      const countryBadge = document.createElement('span');
      countryBadge.className = 'badge badge-country';
      countryBadge.textContent = `${getFlagEmoji(profile.country)} ${profile.country}`;
      meta.appendChild(countryBadge);
    }

    // Plan Badge
    if (profile.plan) {
      const planBadge = document.createElement('span');
      planBadge.className = 'badge badge-plan';
      planBadge.textContent = profile.plan;
      meta.appendChild(planBadge);
    }

    // Cookie Count Badge
    const cookieBadge = document.createElement('span');
    cookieBadge.className = 'badge badge-cookies';
    cookieBadge.textContent = `${profile.cookies.length} Cookies`;
    meta.appendChild(cookieBadge);

    details.appendChild(meta);
    card.appendChild(details);

    // Build Actions Area
    const actions = document.createElement('div');
    actions.className = 'card-actions';

    // Load Button
    const btnLoad = document.createElement('button');
    btnLoad.className = 'action-btn btn-load';
    btnLoad.title = isActive ? 'Active Account (Click to Reload)' : 'Inject and Load Cookies';
    btnLoad.innerHTML = isActive 
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
           <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
         </svg>`
      : `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
           <path d="M8 5v14l11-7z" />
         </svg>`;
    
    btnLoad.addEventListener('click', (e) => {
      e.stopPropagation();
      handleLoadProfile(profile);
    });
    actions.appendChild(btnLoad);

    // Delete Button
    const btnDelete = document.createElement('button');
    btnDelete.className = 'action-btn btn-delete-card';
    btnDelete.title = 'Remove profile from local storage';
    btnDelete.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>`;
    btnDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteProfile(profile.id);
    });
    actions.appendChild(btnDelete);

    card.appendChild(actions);
    return card;
  }

  // --- Actions Implementations ---

  async function handleLoadProfile(profile) {
    showToast(`Injecting cookies for ${profile.email}...`, 'info');
    
    try {
      // 1. Clear existing cookies on target domain
      await clearCookiesForDomain(profile.domain);
      
      // 2. Set all new cookies
      let setSuccessCount = 0;
      for (const cookie of profile.cookies) {
        const success = await injectCookie(cookie);
        if (success) setSuccessCount++;
      }

      console.log(`Set ${setSuccessCount} of ${profile.cookies.length} cookies.`);
      setActiveProfile(profile.id);
      showToast(`Active: ${profile.email}! Cookies injected.`, 'success');

      // 3. Open or reload the tab
      openOrRefreshTargetTab(profile.domain);

    } catch (error) {
      console.error('Failed loading profile cookies:', error);
      showToast(`Error injecting cookies: ${error.message}`, 'error');
    }
  }

  function handleDeleteProfile(profileId) {
    allProfiles = allProfiles.filter(p => p.id !== profileId);
    if (activeProfileId === profileId) {
      activeProfileId = null;
      chrome.storage.local.remove('activeProfileId');
    }
    saveProfilesToStorage();
    showToast('Profile deleted from extension database.', 'info');
  }

  async function handleClearCookies() {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs.length === 0) return;
      const activeTab = tabs[0];
      try {
        const url = new URL(activeTab.url);
        const domain = url.hostname;
        
        await clearCookiesForDomain(domain);
        
        // Reset active profile if it was using this domain
        const activeProfile = allProfiles.find(p => p.id === activeProfileId);
        if (activeProfile && activeProfile.domain.includes(domain)) {
          setActiveProfile(null);
        }

        showToast(`Cleared all cookies for ${domain}`, 'success');
        chrome.tabs.reload(activeTab.id);
      } catch (err) {
        showToast('Navigate to a website first to clear its cookies.', 'error');
      }
    });
  }

  function handleDeleteAll() {
    if (confirm('Are you sure you want to clear all imported cookie profiles?')) {
      allProfiles = [];
      activeProfileId = null;
      chrome.storage.local.clear(() => {
        updateStats();
        populateCountryFilter();
        renderProfiles();
        showToast('All saved profiles cleared.', 'success');
      });
    }
  }

  // --- Cookie API Helpers ---

  function clearCookiesForDomain(domain) {
    return new Promise((resolve, reject) => {
      // Support subdomains by matching .domain.com
      const domainPattern = domain.startsWith('.') ? domain : `.${domain}`;
      const baseDomain = domain.replace(/^\./, '');

      chrome.cookies.getAll({ domain: baseDomain }, async (cookies) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }

        const deletePromises = cookies.map(cookie => {
          return new Promise((resolveDel) => {
            const protocol = cookie.secure ? 'https://' : 'http://';
            // Construct exact URL needed for cookie removal
            const url = `${protocol}${cookie.domain.replace(/^\./, '')}${cookie.path}`;
            chrome.cookies.remove({
              url: url,
              name: cookie.name,
              storeId: cookie.storeId
            }, () => resolveDel());
          });
        });

        await Promise.all(deletePromises);
        resolve();
      });
    });
  }

  function injectCookie(cookie) {
    return new Promise((resolve) => {
      const domainWithoutDot = cookie.domain.replace(/^\./, '');
      const protocol = cookie.secure ? 'https://' : 'http://';
      const url = `${protocol}${domainWithoutDot}${cookie.path}`;

      const details = {
        url: url,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expiry
      };

      // Set cookie domain. Chrome requires leading dot for wildcard/domain cookies
      if (cookie.domain) {
        details.domain = cookie.domain;
      }

      chrome.cookies.set(details, (result) => {
        if (chrome.runtime.lastError) {
          console.warn(`Failed setting cookie ${cookie.name} for ${url}:`, chrome.runtime.lastError.message);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  function openOrRefreshTargetTab(domain) {
    const cleanDomain = domain.replace(/^\./, '');
    let targetUrl = `https://www.${cleanDomain}`;
    
    // Netflix specific routing helper
    if (cleanDomain.includes('netflix')) {
      targetUrl = 'https://www.netflix.com';
    }

    chrome.tabs.query({}, (tabs) => {
      // Try to find if there is already an open tab for this domain
      const existingTab = tabs.find(tab => tab.url && tab.url.includes(cleanDomain));

      if (existingTab) {
        // Update URL and activate it
        chrome.tabs.update(existingTab.id, { url: targetUrl, active: true });
        // Make sure its window is focused
        chrome.windows.update(existingTab.windowId, { focused: true });
      } else {
        // Query active tab in current window to see if we can overwrite it if it's newtab
        chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
          if (activeTabs.length > 0 && (activeTabs[0].url === 'chrome://newtab/' || activeTabs[0].url === 'about:blank' || activeTabs[0].url === '')) {
            chrome.tabs.update(activeTabs[0].id, { url: targetUrl });
          } else {
            chrome.tabs.create({ url: targetUrl });
          }
        });
      }
    });
  }

  // --- UI Utility Helpers ---

  function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '🏳️';
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    try {
      return String.fromCodePoint(...codePoints);
    } catch (e) {
      return '🏳️';
    }
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconSvg = '';
    if (type === 'success') {
      iconSvg = `<svg class="toast-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
    } else if (type === 'error') {
      iconSvg = `<svg class="toast-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
    } else {
      // Info icon
      iconSvg = `<svg class="toast-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
    }

    toast.innerHTML = `${iconSvg}<span>${message}</span>`;
    toastContainer.appendChild(toast);

    // Auto dismiss
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
});
