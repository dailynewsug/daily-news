// ============================================================
// DAILY NEWS UGANDA — Automated Jobs Importer
// Runs every 12 hours via GitHub Actions
// Sources: ReliefWeb, RemoteOK, Devex, WHO Africa, Fuzu, BrighterMonday
//
// CHANGES FROM PREVIOUS VERSION:
//  1. ReliefWeb  — simplified URL (field encoding was breaking the query)
//  2. UN Jobs    — removed (Cloudflare-blocked; replaced by Fuzu Uganda)
//  3. AfDB       — removed (Cloudflare-blocked; replaced by BrighterMonday)
//  4. Devex      — fixed RSS URL (.xml extension)
//  5. WHO Africa — fixed RSS URL (/careers/vacancies/rss)
//  6. Fuzu       — NEW: Uganda/East Africa focused job board (JSON API)
//  7. BrighterMonday Uganda — NEW: Uganda's largest local job board (RSS)
//  8. RemoteOK   — added title quality filter (removes placeholder listings)
//  9. Firestore  — paginated fetch unchanged (was already correct)
// ============================================================

const https = require('https');
const http  = require('http');

// ─── FIREBASE CONFIG ────────────────────────────────────────
const FIREBASE_PROJECT_ID = 'daily-news-a8c64';
const FIREBASE_API_KEY    = 'AIzaSyC4U6MWTPKDQZ_oICtSLdfnFP3a-HFILb4';
const FIRESTORE_BASE_URL  = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// ─── HELPERS ────────────────────────────────────────────────
function fetchUrl(url, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        let data = '';
        const req = client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, application/xml, text/xml, text/html, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                ...extraHeaders
            }
        }, res => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchUrl(res.headers.location, extraHeaders).then(resolve).catch(reject);
                return;
            }
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function postJson(url, body) {
    return new Promise((resolve, reject) => {
        const data    = JSON.stringify(body);
        const urlObj  = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path:     urlObj.pathname + urlObj.search,
            method:   'POST',
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };
        const req = https.request(options, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(new Error(`Invalid JSON response: ${body.substring(0, 200)}`)); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function parseXml(xml, tag) {
    const results = [];
    const regex   = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let match;
    while ((match = regex.exec(xml)) !== null) results.push(match[1]);
    return results;
}

function getXmlValue(item, tag) {
    const m = item.match(new RegExp(
        `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'
    ));
    if (!m) return '';
    return (m[1] || m[2] || '').replace(/<[^>]+>/g, '').trim();
}

function slugify(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 120);
}

function formatDate(dateStr) {
    try {
        return new Date(dateStr).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
        return new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    }
}

// ─── FIX: Filter out garbage/placeholder job titles from RemoteOK ────
// RemoteOK sometimes publishes listings with placeholder or very short titles
function isGarbageTitle(title) {
    if (!title || title.trim().length < 4) return true;
    const lower = title.toLowerCase().trim();
    const garbagePatterns = [
        /^job position$/i,
        /^replace with/i,
        /^vacancies?\s*$/i,
        /^staff\s*$/i,
        /^open position/i,
        /^positions?\s*$/i,
        /^hiring\s*$/i,
        /^jobs?\s*$/i,
        /^amo\s*$/i,
        /^pse\s*$/i,
    ];
    return garbagePatterns.some(p => p.test(lower));
}

function detectCategory(title, desc) {
    const text = (title + ' ' + desc).toLowerCase();
    if (/journalist|media|editor|reporter|broadcast|radio|tv|communication/.test(text))                              return 'Media & Journalism';
    if (/software|developer|engineer|it |tech|data|cyber|network|system|web dev|frontend|backend|fullstack/.test(text)) return 'Technology & IT';
    if (/ngo|un |unicef|unhcr|undp|who |world bank|government|ministry|public service|humanitarian|relief|aid/.test(text)) return 'Government & NGO';
    if (/finance|accountan|audit|bank|insurance|investment|economist|treasury/.test(text))                           return 'Business & Finance';
    if (/doctor|nurse|health|medical|clinical|pharmacy|hospital|physician|dentist/.test(text))                       return 'Health & Medical';
    if (/teacher|lecturer|professor|education|school|university|training|tutor/.test(text))                          return 'Education & Teaching';
    if (/engineer|construction|architect|civil|mechanical|electrical|structural/.test(text))                         return 'Engineering';
    if (/sales|marketing|brand|advertis|customer|client|retail|business dev/.test(text))                             return 'Sales & Marketing';
    if (/online|virtual|digital|content|social media|freelance|remote/.test(text))                                   return 'Online & Remote';
    return 'Other';
}

function detectJobType(title, desc) {
    const text = (title + ' ' + desc).toLowerCase();
    if (/remote|work from home|wfh/.test(text))                       return 'Remote';
    if (/hybrid/.test(text))                                           return 'Hybrid';
    if (/part.time|part time/.test(text))                              return 'Part Time';
    if (/contract|consultant|consultancy|freelance/.test(text))        return 'Contract';
    if (/intern|attachment|volunteer/.test(text))                      return 'Internship';
    if (/online|virtual/.test(text))                                   return 'Online';
    return 'Full Time';
}

function detectLocation(title, desc, defaultLoc) {
    const text = (title + ' ' + desc + ' ' + (defaultLoc || '')).toLowerCase();
    if (/kampala|uganda/.test(text))              return 'Kampala, Uganda';
    if (/nairobi|kenya/.test(text))               return 'Nairobi, Kenya';
    if (/dar es salaam|tanzania/.test(text))      return 'Dar es Salaam, Tanzania';
    if (/kigali|rwanda/.test(text))               return 'Kigali, Rwanda';
    if (/addis|ethiopia/.test(text))              return 'Addis Ababa, Ethiopia';
    if (/east africa/.test(text))                 return 'East Africa';
    if (/africa/.test(text))                      return 'Africa';
    if (/remote|worldwide|global|anywhere/.test(text)) return 'Remote';
    if (/hybrid/.test(text))                      return 'Hybrid';
    if (/online|virtual/.test(text))              return 'Online';
    return defaultLoc || 'International';
}

function isValidResponse(data, source) {
    if (!data || data.length < 50) {
        console.log(`  ⚠️  ${source}: Response too short (${data ? data.length : 0} chars) — likely empty or blocked`);
        return false;
    }
    const preview = data.substring(0, 300);
    if (/<html/i.test(preview) && !/<item/i.test(data) && !/"data"/.test(data)) {
        console.log(`  ⚠️  ${source}: Got HTML instead of XML/JSON — URL may be blocked or changed`);
        console.log(`     Preview: ${preview.replace(/\s+/g, ' ').substring(0, 150)}`);
        return false;
    }
    return true;
}

// ─── FIRESTORE: GET EXISTING JOB IDs (PAGINATED) ────────────
async function getExistingJobIds() {
    const ids = new Set();
    let pageToken = '';
    let page = 1;
    try {
        do {
            const url = `${FIRESTORE_BASE_URL}/jobs?key=${FIREBASE_API_KEY}&pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
            const data   = await fetchUrl(url);
            const parsed = JSON.parse(data);
            (parsed.documents || []).forEach(doc => {
                const fields = doc.fields || {};
                if (fields.sourceId) ids.add(fields.sourceId.stringValue);
            });
            pageToken = parsed.nextPageToken || '';
            console.log(`  📄 Page ${page}: loaded ${(parsed.documents || []).length} docs (total so far: ${ids.size})`);
            page++;
        } while (pageToken);
    } catch (e) {
        console.error('  ❌ Error fetching existing jobs:', e.message);
    }
    return ids;
}

// ─── FIRESTORE: SAVE JOB ────────────────────────────────────
async function saveJob(job) {
    try {
        const url  = `${FIRESTORE_BASE_URL}/jobs?key=${FIREBASE_API_KEY}`;
        const body = {
            fields: {
                title:        { stringValue: job.title        || '' },
                company:      { stringValue: job.company      || '' },
                category:     { stringValue: job.category     || 'Other' },
                type:         { stringValue: job.type         || 'Full Time' },
                location:     { stringValue: job.location     || 'International' },
                deadline:     { stringValue: job.deadline     || '' },
                description:  { stringValue: job.description  || '' },
                applyLink:    { stringValue: job.applyLink    || '' },
                salary:       { stringValue: job.salary       || '' },
                contactName:  { stringValue: 'Auto-imported' },
                contactEmail: { stringValue: 'jobs@dailynewsug.online' },
                plan:         { stringValue: 'Basic' },
                price:        { stringValue: '$0' },
                approved:     { booleanValue: true },
                source:       { stringValue: job.source       || '' },
                sourceId:     { stringValue: job.sourceId     || '' },
                createdAt:    { stringValue: new Date().toISOString() },
                date:         { stringValue: formatDate(new Date()) }
            }
        };
        await postJson(url, body);
        return true;
    } catch (e) {
        console.error(`  ❌ Error saving job "${job.title}":`, e.message);
        return false;
    }
}

// ════════════════════════════════════════════════════════════
// SOURCE 1: RELIEFWEB API
// FIX: Simplified URL — complex field encoding was causing 0 results.
//      The API returns all fields by default; no need to specify them.
// ════════════════════════════════════════════════════════════
async function fetchReliefWeb(existingIds) {
    console.log('\n📡 Fetching ReliefWeb jobs...');
    const jobs = [];
    try {
        // CHANGED: simpler URL without encoded field params that were breaking
        const url  = 'https://api.reliefweb.int/v1/jobs?appname=dailynewsug&limit=50&sort[]=date:desc&profile=full';
        const data = await fetchUrl(url);

        if (!isValidResponse(data, 'ReliefWeb')) return jobs;

        const parsed = JSON.parse(data);
        console.log(`  📦 Raw items from API: ${(parsed.data || []).length}`);

        for (const item of (parsed.data || [])) {
            const f        = item.fields || {};
            const sourceId = `reliefweb-${item.id}`;
            if (existingIds.has(sourceId)) continue;

            const title      = f.title || '';
            const desc       = (f.body || f.body_html || '').replace(/<[^>]+>/g, '').substring(0, 600);
            const company    = (f.source && f.source[0]) ? f.source[0].name : 'ReliefWeb';
            const country    = (f.country && f.country[0]) ? f.country[0].name : '';
            const city       = f.city ? (Array.isArray(f.city) ? f.city[0].name : f.city) : '';
            const locationRaw = [city, country].filter(Boolean).join(', ');
            const closingDate = f.closing_date
                ? (typeof f.closing_date === 'object' ? f.closing_date.value : f.closing_date).split('T')[0]
                : '';

            if (!title) continue;

            jobs.push({
                title,
                company,
                category:    detectCategory(title, desc),
                type:        detectJobType(title, desc),
                location:    detectLocation(title, desc, locationRaw),
                deadline:    closingDate,
                description: desc,
                applyLink:   f.url || (f.links && f.links.self ? f.links.self.href : '') || '',
                salary:      '',
                source:      'ReliefWeb',
                sourceId
            });
        }
        console.log(`  ✅ Found ${jobs.length} new jobs from ReliefWeb`);
    } catch (e) {
        console.error('  ❌ ReliefWeb error:', e.message);
    }
    return jobs;
}

// ════════════════════════════════════════════════════════════
// SOURCE 2: REMOTEOK API
// FIX: Added isGarbageTitle() filter to skip placeholder listings
//      like "Job Position", "Replace with job title", "Amo", "PSE" etc.
// ════════════════════════════════════════════════════════════
async function fetchRemoteOK(existingIds) {
    console.log('\n📡 Fetching RemoteOK jobs...');
    const jobs = [];
    try {
        const url  = 'https://remoteok.com/api';
        const data = await fetchUrl(url);

        if (!isValidResponse(data, 'RemoteOK')) return jobs;

        const parsed = JSON.parse(data);
        console.log(`  📦 Raw items from API: ${parsed.length - 1}`);

        for (const item of parsed.slice(1, 80)) { // fetch more since we filter
            if (!item.id) continue;
            const sourceId = `remoteok-${item.id}`;
            if (existingIds.has(sourceId)) continue;

            const title = item.position || '';
            const desc  = (item.description || '').replace(/<[^>]+>/g, '').substring(0, 600);

            // CHANGED: skip garbage/placeholder titles
            if (isGarbageTitle(title)) {
                console.log(`  ⏭️  Skipping garbage title: "${title}"`);
                continue;
            }

            jobs.push({
                title,
                company:     item.company || 'Remote Company',
                category:    detectCategory(title, desc),
                type:        'Remote',
                location:    'Remote',
                deadline:    '',
                description: desc,
                applyLink:   item.url || `https://remoteok.com/l/${item.id}`,
                salary:      item.salary_min
                    ? `$${item.salary_min.toLocaleString()} - $${item.salary_max ? item.salary_max.toLocaleString() : '?'}/yr`
                    : '',
                source:      'RemoteOK',
                sourceId
            });
        }
        console.log(`  ✅ Found ${jobs.length} new jobs from RemoteOK`);
    } catch (e) {
        console.error('  ❌ RemoteOK error:', e.message);
    }
    return jobs;
}

// ════════════════════════════════════════════════════════════
// SOURCE 3: DEVEX RSS
// FIX: Corrected URL from /jobs/rss → /jobs/rss.xml
// ════════════════════════════════════════════════════════════
async function fetchDevex(existingIds) {
    console.log('\n📡 Fetching Devex jobs...');
    const jobs = [];
    try {
        // CHANGED: added .xml to the URL
        const url = 'https://www.devex.com/jobs/rss.xml';
        const xml = await fetchUrl(url);

        if (!isValidResponse(xml, 'Devex')) return jobs;

        const items = parseXml(xml, 'item');
        console.log(`  📦 Raw items from RSS: ${items.length}`);

        for (const item of items.slice(0, 40)) {
            const title = getXmlValue(item, 'title');
            const desc  = getXmlValue(item, 'description').substring(0, 600);
            const link  = getXmlValue(item, 'link');
            if (!title) continue;

            const sourceId = `devex-${slugify(link || title)}`;
            if (!sourceId || existingIds.has(sourceId)) continue;

            jobs.push({
                title,
                company:     getXmlValue(item, 'author') || getXmlValue(item, 'dc:creator') || 'International Organisation',
                category:    detectCategory(title, desc),
                type:        detectJobType(title, desc),
                location:    detectLocation(title, desc, 'International'),
                deadline:    '',
                description: desc,
                applyLink:   link,
                salary:      '',
                source:      'Devex',
                sourceId
            });
        }
        console.log(`  ✅ Found ${jobs.length} new jobs from Devex`);
    } catch (e) {
        console.error('  ❌ Devex error:', e.message);
    }
    return jobs;
}

// ════════════════════════════════════════════════════════════
// SOURCE 4: WHO AFRICA RSS
// FIX: Corrected URL from /jobs/rss → /careers/vacancies/rss
// ════════════════════════════════════════════════════════════
async function fetchWHOAfrica(existingIds) {
    console.log('\n📡 Fetching WHO Africa jobs...');
    const jobs = [];
    try {
        // CHANGED: fixed RSS endpoint path
        const url = 'https://www.afro.who.int/careers/vacancies/rss';
        const xml = await fetchUrl(url);

        if (!isValidResponse(xml, 'WHO Africa')) return jobs;

        const items = parseXml(xml, 'item');
        console.log(`  📦 Raw items from RSS: ${items.length}`);

        for (const item of items.slice(0, 30)) {
            const title = getXmlValue(item, 'title');
            const desc  = getXmlValue(item, 'description').substring(0, 600);
            const link  = getXmlValue(item, 'link');
            if (!title) continue;

            const sourceId = `who-${slugify(link || title)}`;
            if (!sourceId || existingIds.has(sourceId)) continue;

            jobs.push({
                title,
                company:     'World Health Organization',
                category:    'Health & Medical',
                type:        detectJobType(title, desc),
                location:    detectLocation(title, desc, 'Africa'),
                deadline:    getXmlValue(item, 'pubDate') || '',
                description: desc,
                applyLink:   link,
                salary:      '',
                source:      'WHO Africa',
                sourceId
            });
        }
        console.log(`  ✅ Found ${jobs.length} new jobs from WHO Africa`);
    } catch (e) {
        console.error('  ❌ WHO Africa error:', e.message);
    }
    return jobs;
}

// ════════════════════════════════════════════════════════════
// SOURCE 5: FUZU — Uganda & East Africa focused job board
// NEW: Replaces UN Jobs (which was Cloudflare-blocked)
// Fuzu has a public JSON API with Uganda/East Africa jobs
// ════════════════════════════════════════════════════════════
async function fetchFuzu(existingIds) {
    console.log('\n📡 Fetching Fuzu (Uganda/East Africa) jobs...');
    const jobs = [];
    try {
        const url  = 'https://www.fuzu.com/api/v2/jobs?country=uganda&per_page=40&sort=recent';
        const data = await fetchUrl(url, { 'Accept': 'application/json' });

        if (!isValidResponse(data, 'Fuzu')) return jobs;

        // Fuzu may return HTML on block — double check
        if (data.trim().startsWith('<')) {
            console.log('  ⚠️  Fuzu: Returned HTML — trying fallback RSS...');
            return await fetchFuzuRSS(existingIds);
        }

        const parsed = JSON.parse(data);
        const items  = parsed.data || parsed.jobs || parsed.results || [];
        console.log(`  📦 Raw items from API: ${items.length}`);

        for (const item of items) {
            const id = item.id || item.slug || '';
            if (!id) continue;
            const sourceId = `fuzu-${id}`;
            if (existingIds.has(sourceId)) continue;

            const title = item.title || item.name || '';
            const desc  = (item.description || item.summary || item.excerpt || '').replace(/<[^>]+>/g, '').substring(0, 600);
            const company = item.company_name || (item.company && item.company.name) || 'Organisation';
            const location = item.location || item.city || 'Uganda';
            const deadline = item.deadline || item.expires_at || item.closing_date || '';

            if (!title || isGarbageTitle(title)) continue;

            jobs.push({
                title,
                company,
                category:    detectCategory(title, desc),
                type:        detectJobType(title, desc),
                location:    detectLocation(title, desc, location),
                deadline:    deadline ? deadline.split('T')[0] : '',
                description: desc,
                applyLink:   item.url || item.apply_url || `https://www.fuzu.com/jobs/${id}`,
                salary:      item.salary || '',
                source:      'Fuzu',
                sourceId
            });
        }
        console.log(`  ✅ Found ${jobs.length} new jobs from Fuzu`);
    } catch (e) {
        console.error('  ❌ Fuzu error:', e.message);
        // Try RSS fallback
        return await fetchFuzuRSS(existingIds);
    }
    return jobs;
}

// Fuzu RSS fallback if JSON API is blocked
async function fetchFuzuRSS(existingIds) {
    const jobs = [];
    try {
        const url = 'https://www.fuzu.com/jobs.rss?country=uganda';
        const xml = await fetchUrl(url);
        if (!isValidResponse(xml, 'Fuzu RSS')) return jobs;

        const items = parseXml(xml, 'item');
        console.log(`  📦 Fuzu RSS items: ${items.length}`);

        for (const item of items.slice(0, 40)) {
            const title = getXmlValue(item, 'title');
            const desc  = getXmlValue(item, 'description').substring(0, 600);
            const link  = getXmlValue(item, 'link');
            if (!title || isGarbageTitle(title)) continue;

            const sourceId = `fuzu-${slugify(link || title)}`;
            if (existingIds.has(sourceId)) continue;

            jobs.push({
                title,
                company:     getXmlValue(item, 'author') || 'Organisation',
                category:    detectCategory(title, desc),
                type:        detectJobType(title, desc),
                location:    detectLocation(title, desc, 'Uganda'),
                deadline:    '',
                description: desc,
                applyLink:   link,
                salary:      '',
                source:      'Fuzu',
                sourceId
            });
        }
        console.log(`  ✅ Found ${jobs.length} new jobs from Fuzu RSS`);
    } catch (e) {
        console.error('  ❌ Fuzu RSS error:', e.message);
    }
    return jobs;
}

// ════════════════════════════════════════════════════════════
// SOURCE 6: BRIGHTER MONDAY UGANDA
// NEW: Replaces AfDB (which was Cloudflare-blocked)
// Uganda's largest local job board — RSS feed
// ════════════════════════════════════════════════════════════
async function fetchBrighterMonday(existingIds) {
    console.log('\n📡 Fetching BrighterMonday Uganda jobs...');
    const jobs = [];
    try {
        const url = 'https://www.brightermonday.co.ug/jobs/rss';
        const xml = await fetchUrl(url);

        if (!isValidResponse(xml, 'BrighterMonday')) return jobs;

        const items = parseXml(xml, 'item');
        console.log(`  📦 Raw items from RSS: ${items.length}`);

        for (const item of items.slice(0, 40)) {
            const title = getXmlValue(item, 'title');
            const desc  = getXmlValue(item, 'description').substring(0, 600);
            const link  = getXmlValue(item, 'link');
            if (!title || isGarbageTitle(title)) continue;

            const sourceId = `bm-${slugify(link || title)}`;
            if (!sourceId || existingIds.has(sourceId)) continue;

            // BrighterMonday always Uganda-based
            const rawLocation = getXmlValue(item, 'location') || 'Uganda';

            jobs.push({
                title,
                company:     getXmlValue(item, 'author') || getXmlValue(item, 'dc:creator') || 'Uganda Company',
                category:    detectCategory(title, desc),
                type:        detectJobType(title, desc),
                location:    detectLocation(title, desc, rawLocation),
                deadline:    '',
                description: desc,
                applyLink:   link,
                salary:      getXmlValue(item, 'salary') || '',
                source:      'BrighterMonday',
                sourceId
            });
        }
        console.log(`  ✅ Found ${jobs.length} new jobs from BrighterMonday`);
    } catch (e) {
        console.error('  ❌ BrighterMonday error:', e.message);
    }
    return jobs;
}

// ════════════════════════════════════════════════════════════
// REMOVED SOURCES:
//  - UN Jobs:  Cloudflare blocks automated requests → returns HTML
//  - AfDB:     Cloudflare blocks automated requests → returns HTML
//  - Indeed:   Actively blocks bots, returns CAPTCHA
// These have been replaced with Fuzu and BrighterMonday above.
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// MAIN — RUN ALL SOURCES
// ════════════════════════════════════════════════════════════
async function main() {
    console.log('🚀 Daily News Uganda — Jobs Importer Starting...');
    console.log(`⏰ Run time: ${new Date().toISOString()}`);

    console.log('\n🔍 Checking existing jobs in Firebase...');
    const existingIds = await getExistingJobIds();
    console.log(`  ✅ Total existing sourceIds loaded: ${existingIds.size}`);

    // Fetch from all sources concurrently
    const [
        reliefwebJobs,
        remoteOkJobs,
        devexJobs,
        whoJobs,
        fuzuJobs,
        brighterMondayJobs
    ] = await Promise.allSettled([
        fetchReliefWeb(existingIds),
        fetchRemoteOK(existingIds),
        fetchDevex(existingIds),
        fetchWHOAfrica(existingIds),
        fetchFuzu(existingIds),
        fetchBrighterMonday(existingIds)
    ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : []));

    const allJobs = [
        ...reliefwebJobs,
        ...remoteOkJobs,
        ...devexJobs,
        ...whoJobs,
        ...fuzuJobs,
        ...brighterMondayJobs
    ];

    console.log(`\n📊 Total new jobs to import: ${allJobs.length}`);
    console.log(`   ReliefWeb:     ${reliefwebJobs.length}`);
    console.log(`   RemoteOK:      ${remoteOkJobs.length}`);
    console.log(`   Devex:         ${devexJobs.length}`);
    console.log(`   WHO Africa:    ${whoJobs.length}`);
    console.log(`   Fuzu:          ${fuzuJobs.length}`);
    console.log(`   BrighterMonday:${brighterMondayJobs.length}`);

    if (allJobs.length === 0) {
        console.log('✅ No new jobs to import. All up to date!');
        return;
    }

    // Save all to Firebase
    console.log('\n💾 Saving to Firebase...');
    let saved  = 0;
    let failed = 0;

    for (const job of allJobs) {
        const success = await saveJob(job);
        if (success) {
            saved++;
            console.log(`  ✅ Saved: ${job.title} (${job.company}) — ${job.source}`);
        } else {
            failed++;
        }
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n🎉 Import Complete!');
    console.log(`  ✅ Saved:            ${saved} jobs`);
    console.log(`  ❌ Failed:           ${failed} jobs`);
    console.log(`  ⏭️  Skipped (dupes):  already in Firebase`);
}

main().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});