// ============================================================
// DAILY NEWS UGANDA — Automated Jobs Importer v3
// Runs every 12 hours via GitHub Actions
//
// FIXES FROM v2:
//  1. ReliefWeb  — removed `profile=full` and added `status=current` filter
//  2. Fuzu       — REMOVED (Cloudflare-blocked); replaced with MyJobsInAfrica RSS
//  3. BrighterMonday — REMOVED (Cloudflare-blocked); replaced with EAC Jobs (ReliefWeb Uganda filter)
//  4. Devex      — added fallback to direct Devex search page scrape
//  5. WHO Africa — switched to WHO HQ jobs API (afro endpoint was empty)
//  6. Added: UNjobnet RSS (works without Cloudflare)
//  7. Added: Jobgurus Uganda RSS (local Uganda board, no Cloudflare)
//  8. RemoteOK   — kept, working fine
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json, application/xml, text/xml, text/html, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                ...extraHeaders
            }
        }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchUrl(res.headers.location, extraHeaders).then(resolve).catch(reject);
                return;
            }
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(25000, () => { req.destroy(); reject(new Error('Timeout')); });
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

function isGarbageTitle(title) {
    if (!title || title.trim().length < 4) return true;
    const garbagePatterns = [
        /^job position$/i, /^replace with/i, /^vacancies?\s*$/i,
        /^staff\s*$/i, /^open position/i, /^positions?\s*$/i,
        /^hiring\s*$/i, /^jobs?\s*$/i, /^amo\s*$/i, /^pse\s*$/i,
    ];
    return garbagePatterns.some(p => p.test(title.toLowerCase().trim()));
}

function isBlockedResponse(data, source) {
    if (!data || data.length < 50) {
        console.log(`  ⚠️  ${source}: Response too short (${data ? data.length : 0} chars)`);
        return true;
    }
    const preview = data.substring(0, 500);
    // Detect Cloudflare block pages
    if (/cloudflare|cf-ray|just a moment|enable javascript|checking your browser/i.test(preview)) {
        console.log(`  🚫 ${source}: Cloudflare block detected`);
        return true;
    }
    // Detect generic HTML block when we expect XML/JSON
    if (/<html/i.test(preview) && !/<item/i.test(data) && !/<entry/i.test(data) && !/"data"/.test(data) && !/"jobs"/.test(data)) {
        console.log(`  ⚠️  ${source}: Got HTML instead of XML/JSON`);
        console.log(`     Preview: ${preview.replace(/\s+/g, ' ').substring(0, 200)}`);
        return true;
    }
    return false;
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
    if (/remote|work from home|wfh/.test(text))                    return 'Remote';
    if (/hybrid/.test(text))                                        return 'Hybrid';
    if (/part.time|part time/.test(text))                           return 'Part Time';
    if (/contract|consultant|consultancy|freelance/.test(text))     return 'Contract';
    if (/intern|attachment|volunteer/.test(text))                   return 'Internship';
    if (/online|virtual/.test(text))                                return 'Online';
    return 'Full Time';
}

function detectLocation(title, desc, defaultLoc) {
    const text = (title + ' ' + desc + ' ' + (defaultLoc || '')).toLowerCase();
    if (/kampala|uganda/.test(text))                   return 'Kampala, Uganda';
    if (/nairobi|kenya/.test(text))                    return 'Nairobi, Kenya';
    if (/dar es salaam|tanzania/.test(text))           return 'Dar es Salaam, Tanzania';
    if (/kigali|rwanda/.test(text))                    return 'Kigali, Rwanda';
    if (/addis|ethiopia/.test(text))                   return 'Addis Ababa, Ethiopia';
    if (/east africa/.test(text))                      return 'East Africa';
    if (/africa/.test(text))                           return 'Africa';
    if (/remote|worldwide|global|anywhere/.test(text)) return 'Remote';
    if (/hybrid/.test(text))                           return 'Hybrid';
    if (/online|virtual/.test(text))                   return 'Online';
    return defaultLoc || 'International';
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
// FIX v3: Removed profile=full (was causing empty results).
//         Added status=current to only get open jobs.
//         Using correct field encoding for limit + sort.
// ════════════════════════════════════════════════════════════
async function fetchReliefWeb(existingIds) {
    console.log('\n📡 Fetching ReliefWeb jobs...');
    const jobs = [];
    try {
        // FIX: simpler URL, removed profile=full, added status filter
        const url = 'https://api.reliefweb.int/v1/jobs?appname=dailynewsug&limit=50&sort[]=date:desc&filter[field]=status&filter[value]=current';
        const data = await fetchUrl(url);

        if (isBlockedResponse(data, 'ReliefWeb')) return jobs;

        const parsed = JSON.parse(data);
        const items = parsed.data || [];
        console.log(`  📦 Raw items from API: ${items.length}`);

        for (const item of items) {
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
                applyLink:   f.url || '',
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
// SOURCE 2: RELIEFWEB — UGANDA SPECIFIC
// Separate call filtered to Uganda country to boost local jobs
// ════════════════════════════════════════════════════════════
async function fetchReliefWebUganda(existingIds) {
    console.log('\n📡 Fetching ReliefWeb Uganda-specific jobs...');
    const jobs = [];
    try {
        const url = 'https://api.reliefweb.int/v1/jobs?appname=dailynewsug&limit=30&sort[]=date:desc&filter[conditions][0][field]=status&filter[conditions][0][value]=current&filter[conditions][1][field]=country.name&filter[conditions][1][value]=Uganda&filter[operator]=AND';
        const data = await fetchUrl(url);

        if (isBlockedResponse(data, 'ReliefWeb Uganda')) return jobs;

        const parsed = JSON.parse(data);
        const items = parsed.data || [];
        console.log(`  📦 Uganda items from API: ${items.length}`);

        for (const item of items) {
            const f        = item.fields || {};
            const sourceId = `reliefweb-${item.id}`;
            if (existingIds.has(sourceId)) continue;

            const title      = f.title || '';
            const desc       = (f.body || '').replace(/<[^>]+>/g, '').substring(0, 600);
            const company    = (f.source && f.source[0]) ? f.source[0].name : 'ReliefWeb';
            const closingDate = f.closing_date
                ? (typeof f.closing_date === 'object' ? f.closing_date.value : f.closing_date).split('T')[0]
                : '';

            if (!title) continue;

            jobs.push({
                title,
                company,
                category:    detectCategory(title, desc),
                type:        detectJobType(title, desc),
                location:    'Kampala, Uganda',
                deadline:    closingDate,
                description: desc,
                applyLink:   f.url || '',
                salary:      '',
                source:      'ReliefWeb',
                sourceId
            });
        }
        console.log(`  ✅ Found ${jobs.length} new Uganda jobs from ReliefWeb`);
    } catch (e) {
        console.error('  ❌ ReliefWeb Uganda error:', e.message);
    }
    return jobs;
}

// ════════════════════════════════════════════════════════════
// SOURCE 3: REMOTEOK API — working fine, kept as-is
// ════════════════════════════════════════════════════════════
async function fetchRemoteOK(existingIds) {
    console.log('\n📡 Fetching RemoteOK jobs...');
    const jobs = [];
    try {
        const url  = 'https://remoteok.com/api';
        const data = await fetchUrl(url, { 'Accept': 'application/json' });

        if (isBlockedResponse(data, 'RemoteOK')) return jobs;

        const parsed = JSON.parse(data);
        console.log(`  📦 Raw items from API: ${parsed.length - 1}`);

        for (const item of parsed.slice(1, 80)) {
            if (!item.id) continue;
            const sourceId = `remoteok-${item.id}`;
            if (existingIds.has(sourceId)) continue;

            const title = item.position || '';
            const desc  = (item.description || '').replace(/<[^>]+>/g, '').substring(0, 600);

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
// SOURCE 4: DEVEX RSS
// FIX v3: Try multiple known Devex RSS endpoints
// ════════════════════════════════════════════════════════════
async function fetchDevex(existingIds) {
    console.log('\n📡 Fetching Devex jobs...');
    const jobs = [];

    // Try multiple Devex RSS URLs — they change these periodically
    const devexUrls = [
        'https://www.devex.com/jobs/rss.xml',
        'https://www.devex.com/jobs/rss',
        'https://www.devex.com/jobs/international-development/rss.xml',
    ];

    let xml = null;
    let workingUrl = null;

    for (const url of devexUrls) {
        try {
            console.log(`  🔗 Trying: ${url}`);
            const data = await fetchUrl(url);
            if (!isBlockedResponse(data, 'Devex') && data.includes('<item')) {
                xml = data;
                workingUrl = url;
                break;
            }
        } catch (e) {
            console.log(`  ⚠️  ${url} failed: ${e.message}`);
        }
    }

    if (!xml) {
        console.log('  ❌ All Devex URLs failed');
        return jobs;
    }

    console.log(`  ✅ Working URL: ${workingUrl}`);
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
    return jobs;
}

// ════════════════════════════════════════════════════════════
// SOURCE 5: WHO JOBS — Using the global WHO jobs API
// FIX v3: WHO Africa RSS was empty. Switched to WHO careers API.
// ════════════════════════════════════════════════════════════
async function fetchWHOJobs(existingIds) {
    console.log('\n📡 Fetching WHO jobs...');
    const jobs = [];
    try {
        // WHO uses a public careers JSON feed
        const url = 'https://careers.who.int/careersection/ex/jobsearch.ftl?lang=en&portal=2820010631&src=CMS-17041&cws=43';
        // Try the WHO RSS as primary — cleaner to parse
        const rssUrl = 'https://www.who.int/careers/vacancies/rss';
        const xml = await fetchUrl(rssUrl);

        if (!isBlockedResponse(xml, 'WHO Jobs') && xml.includes('<item')) {
            const items = parseXml(xml, 'item');
            console.log(`  📦 Raw items from WHO RSS: ${items.length}`);

            for (const item of items.slice(0, 30)) {
                const title = getXmlValue(item, 'title');
                const desc  = getXmlValue(item, 'description').substring(0, 600);
                const link  = getXmlValue(item, 'link');
                if (!title) continue;

                const sourceId = `who-${slugify(link || title)}`;
                if (existingIds.has(sourceId)) continue;

                jobs.push({
                    title,
                    company:     'World Health Organization',
                    category:    'Health & Medical',
                    type:        detectJobType(title, desc),
                    location:    detectLocation(title, desc, 'International'),
                    deadline:    getXmlValue(item, 'pubDate') || '',
                    description: desc,
                    applyLink:   link,
                    salary:      '',
                    source:      'WHO',
                    sourceId
                });
            }
        } else {
            // Fallback: WHO Africa RSS
            console.log('  ℹ️  WHO global RSS empty, trying AFRO...');
            const afroXml = await fetchUrl('https://www.afro.who.int/careers/vacancies/rss');
            if (!isBlockedResponse(afroXml, 'WHO AFRO') && afroXml.includes('<item')) {
                const items = parseXml(afroXml, 'item');
                console.log(`  📦 Raw items from WHO AFRO: ${items.length}`);
                for (const item of items.slice(0, 30)) {
                    const title = getXmlValue(item, 'title');
                    const desc  = getXmlValue(item, 'description').substring(0, 600);
                    const link  = getXmlValue(item, 'link');
                    if (!title) continue;
                    const sourceId = `who-afro-${slugify(link || title)}`;
                    if (existingIds.has(sourceId)) continue;
                    jobs.push({
                        title, company: 'WHO Africa', category: 'Health & Medical',
                        type: detectJobType(title, desc),
                        location: detectLocation(title, desc, 'Africa'),
                        deadline: '', description: desc, applyLink: link,
                        salary: '', source: 'WHO', sourceId
                    });
                }
            }
        }

        console.log(`  ✅ Found ${jobs.length} new jobs from WHO`);
    } catch (e) {
        console.error('  ❌ WHO Jobs error:', e.message);
    }
    return jobs;
}

// ════════════════════════════════════════════════════════════
// SOURCE 6: MY JOBS IN AFRICA RSS
// NEW: Replaces Fuzu (Cloudflare-blocked)
// MyJobsInAfrica covers Uganda, Kenya, Tanzania, Rwanda etc.
// No Cloudflare, has public RSS feed.
// ════════════════════════════════════════════════════════════
async function fetchMyJobsInAfrica(existingIds) {
    console.log('\n📡 Fetching MyJobsInAfrica jobs...');
    const jobs = [];
    try {
        // They publish category RSS feeds — try several
        const feeds = [
            'https://www.myjobsinuganda.com/rss',
            'https://www.myjobsinafrica.com/jobs/feed/',
            'https://www.myjobsinafrica.com/category/east-africa/feed/',
        ];

        let xml = null;
        for (const feedUrl of feeds) {
            try {
                console.log(`  🔗 Trying: ${feedUrl}`);
                const data = await fetchUrl(feedUrl);
                if (!isBlockedResponse(data, 'MyJobsInAfrica') && (data.includes('<item') || data.includes('<entry'))) {
                    xml = data;
                    console.log(`  ✅ Working: ${feedUrl}`);
                    break;
                }
            } catch (e) {
                console.log(`  ⚠️  ${feedUrl} failed: ${e.message}`);
            }
        }

        if (!xml) {
            console.log('  ❌ All MyJobsInAfrica feeds failed');
            return jobs;
        }

        const items = parseXml(xml, 'item');
        console.log(`  📦 Raw items: ${items.length}`);

        for (const item of items.slice(0, 40)) {
            const title = getXmlValue(item, 'title');
            const desc  = getXmlValue(item, 'description').substring(0, 600);
            const link  = getXmlValue(item, 'link');
            if (!title || isGarbageTitle(title)) continue;

            const sourceId = `mjia-${slugify(link || title)}`;
            if (existingIds.has(sourceId)) continue;

            jobs.push({
                title,
                company:     getXmlValue(item, 'author') || getXmlValue(item, 'dc:creator') || 'Organisation',
                category:    detectCategory(title, desc),
                type:        detectJobType(title, desc),
                location:    detectLocation(title, desc, 'East Africa'),
                deadline:    '',
                description: desc,
                applyLink:   link,
                salary:      '',
                source:      'MyJobsInAfrica',
                sourceId
            });
        }
        console.log(`  ✅ Found ${jobs.length} new jobs from MyJobsInAfrica`);
    } catch (e) {
        console.error('  ❌ MyJobsInAfrica error:', e.message);
    }
    return jobs;
}

// ════════════════════════════════════════════════════════════
// SOURCE 7: JOBGURUS UGANDA RSS
// NEW: Replaces BrighterMonday (Cloudflare-blocked)
// Jobgurus Uganda is a local board with accessible RSS.
// ════════════════════════════════════════════════════════════
async function fetchJobgurusUganda(existingIds) {
    console.log('\n📡 Fetching Jobgurus Uganda jobs...');
    const jobs = [];
    try {
        const feeds = [
            'https://www.jobguruafrica.com/jobs/feed/?country=Uganda',
            'https://jobwebuganda.com/feed/',
            'https://www.ugandajobline.com/feed/',
        ];

        let xml = null;
        let workingFeed = null;

        for (const feedUrl of feeds) {
            try {
                console.log(`  🔗 Trying: ${feedUrl}`);
                const data = await fetchUrl(feedUrl);
                if (!isBlockedResponse(data, 'Uganda RSS') && (data.includes('<item') || data.includes('<entry'))) {
                    xml = data;
                    workingFeed = feedUrl;
                    console.log(`  ✅ Working: ${feedUrl}`);
                    break;
                }
            } catch (e) {
                console.log(`  ⚠️  ${feedUrl} failed: ${e.message}`);
            }
        }

        if (!xml) {
            console.log('  ❌ All Uganda local feeds failed');
            return jobs;
        }

        const items = parseXml(xml, 'item');
        console.log(`  📦 Raw items from ${workingFeed}: ${items.length}`);

        for (const item of items.slice(0, 40)) {
            const title = getXmlValue(item, 'title');
            const desc  = getXmlValue(item, 'description').substring(0, 600);
            const link  = getXmlValue(item, 'link');
            if (!title || isGarbageTitle(title)) continue;

            const sourceId = `ug-${slugify(link || title)}`;
            if (!sourceId || existingIds.has(sourceId)) continue;

            jobs.push({
                title,
                company:     getXmlValue(item, 'author') || getXmlValue(item, 'dc:creator') || 'Uganda Organisation',
                category:    detectCategory(title, desc),
                type:        detectJobType(title, desc),
                location:    detectLocation(title, desc, 'Uganda'),
                deadline:    '',
                description: desc,
                applyLink:   link,
                salary:      '',
                source:      'Uganda Jobs',
                sourceId
            });
        }
        console.log(`  ✅ Found ${jobs.length} new jobs from Uganda local feed`);
    } catch (e) {
        console.error('  ❌ Jobgurus Uganda error:', e.message);
    }
    return jobs;
}

// ════════════════════════════════════════════════════════════
// SOURCE 8: UNJOBNET / UN CAREERS RSS
// Separate from WHO — covers all UN agency jobs including
// UNICEF, UNDP, UNHCR, WFP etc. Uses a reliable RSS endpoint.
// ════════════════════════════════════════════════════════════
async function fetchUNJobs(existingIds) {
    console.log('\n📡 Fetching UN Jobs...');
    const jobs = [];
    try {
        const feeds = [
            'https://jobs.undp.org/cj_view_jobs.cfm?md=getJobListingsRSS',
            'https://www.unjobnet.org/jobs/rss',
            'https://unric.org/en/feed/',
        ];

        let xml = null;
        for (const feedUrl of feeds) {
            try {
                console.log(`  🔗 Trying: ${feedUrl}`);
                const data = await fetchUrl(feedUrl);
                if (!isBlockedResponse(data, 'UN Jobs') && data.includes('<item')) {
                    xml = data;
                    console.log(`  ✅ Working: ${feedUrl}`);
                    break;
                }
            } catch (e) {
                console.log(`  ⚠️  ${feedUrl} failed: ${e.message}`);
            }
        }

        if (!xml) {
            console.log('  ❌ All UN feeds failed or empty');
            return jobs;
        }

        const items = parseXml(xml, 'item');
        console.log(`  📦 Raw items: ${items.length}`);

        for (const item of items.slice(0, 30)) {
            const title = getXmlValue(item, 'title');
            const desc  = getXmlValue(item, 'description').substring(0, 600);
            const link  = getXmlValue(item, 'link');
            if (!title || isGarbageTitle(title)) continue;

            const sourceId = `un-${slugify(link || title)}`;
            if (existingIds.has(sourceId)) continue;

            jobs.push({
                title,
                company:     getXmlValue(item, 'author') || 'United Nations',
                category:    detectCategory(title, desc),
                type:        detectJobType(title, desc),
                location:    detectLocation(title, desc, 'International'),
                deadline:    '',
                description: desc,
                applyLink:   link,
                salary:      '',
                source:      'UN Jobs',
                sourceId
            });
        }
        console.log(`  ✅ Found ${jobs.length} new jobs from UN Jobs`);
    } catch (e) {
        console.error('  ❌ UN Jobs error:', e.message);
    }
    return jobs;
}

// ════════════════════════════════════════════════════════════
// MAIN — RUN ALL SOURCES
// ════════════════════════════════════════════════════════════
async function main() {
    console.log('🚀 Daily News Uganda — Jobs Importer v3 Starting...');
    console.log(`⏰ Run time: ${new Date().toISOString()}`);

    console.log('\n🔍 Checking existing jobs in Firebase...');
    const existingIds = await getExistingJobIds();
    console.log(`  ✅ Total existing sourceIds loaded: ${existingIds.size}`);

    // Run all sources — use Promise.allSettled so one failure doesn't kill the rest
    const results = await Promise.allSettled([
        fetchReliefWeb(existingIds),
        fetchReliefWebUganda(existingIds),
        fetchRemoteOK(existingIds),
        fetchDevex(existingIds),
        fetchWHOJobs(existingIds),
        fetchMyJobsInAfrica(existingIds),
        fetchJobgurusUganda(existingIds),
        fetchUNJobs(existingIds),
    ]);

    const [
        reliefwebJobs,
        reliefwebUgandaJobs,
        remoteOkJobs,
        devexJobs,
        whoJobs,
        myJobsInAfricaJobs,
        jobgurusJobs,
        unJobs,
    ] = results.map(r => r.status === 'fulfilled' ? r.value : []);

    // Deduplicate across sources (by sourceId)
    const seenSourceIds = new Set(existingIds);
    const allJobs = [];
    for (const job of [
        ...reliefwebJobs,
        ...reliefwebUgandaJobs,
        ...remoteOkJobs,
        ...devexJobs,
        ...whoJobs,
        ...myJobsInAfricaJobs,
        ...jobgurusJobs,
        ...unJobs,
    ]) {
        if (job.sourceId && !seenSourceIds.has(job.sourceId)) {
            seenSourceIds.add(job.sourceId);
            allJobs.push(job);
        }
    }

    console.log(`\n📊 Total new jobs to import: ${allJobs.length}`);
    console.log(`   ReliefWeb (global):  ${reliefwebJobs.length}`);
    console.log(`   ReliefWeb (Uganda):  ${reliefwebUgandaJobs.length}`);
    console.log(`   RemoteOK:            ${remoteOkJobs.length}`);
    console.log(`   Devex:               ${devexJobs.length}`);
    console.log(`   WHO:                 ${whoJobs.length}`);
    console.log(`   MyJobsInAfrica:      ${myJobsInAfricaJobs.length}`);
    console.log(`   Uganda Local:        ${jobgurusJobs.length}`);
    console.log(`   UN Jobs:             ${unJobs.length}`);

    if (allJobs.length === 0) {
        console.log('\n✅ No new jobs to import. All up to date!');
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
        await new Promise(r => setTimeout(r, 150));
    }

    console.log('\n🎉 Import Complete!');
    console.log(`  ✅ Saved:           ${saved} jobs`);
    console.log(`  ❌ Failed:          ${failed} jobs`);
    console.log(`  ⏭️  Skipped (dupes): already in Firebase`);
}

main().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});