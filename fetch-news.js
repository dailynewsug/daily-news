// ================================
//   DAILY NEWS - AUTO PUBLISHER
// ================================

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const Parser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio');

async function main() {
    console.log('🚀 Daily News Auto-Publisher starting...');
    console.log(`⏰ ${new Date().toISOString()}`);

    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
        console.error('❌ FIREBASE_SERVICE_ACCOUNT not found!');
        process.exit(1);
    }

    let serviceAccount;
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log('✅ Firebase credentials loaded');
    } catch (error) {
        console.error('❌ Failed to parse credentials:', error.message);
        process.exit(1);
    }

    try {
        initializeApp({ credential: cert(serviceAccount) });
        console.log('✅ Firebase initialized');
    } catch (error) {
        console.error('❌ Firebase init failed:', error.message);
        process.exit(1);
    }

    const db = getFirestore();
    const parser = new Parser({
        timeout: 15000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        }
    });

    // ================================
    // FULL ARTICLE SOURCES
    // ================================
    const FULL_SOURCES = [

        // HEALTH
        {
            url: 'https://www.who.int/rss-feeds/news-english.xml',
            category: 'Health',
            source: 'WHO'
        },
        {
            url: 'https://www.afro.who.int/rss.xml',
            category: 'Health',
            source: 'WHO Africa'
        },

        // SPORTS — Uganda
        {
            url: 'https://sportsoceanuganda.com/feed/',
            category: 'Sports',
            source: 'Sports Ocean Uganda'
        },

        // EDUCATION
        {
            url: 'https://theconversation.com/africa/education/articles.atom',
            category: 'Education',
            source: 'The Conversation Africa'
        },

        // OPINION
        {
            url: 'https://theconversation.com/africa/articles.atom',
            category: 'Opinion',
            source: 'The Conversation Africa'
        },

        // BUSINESS
        {
            url: 'https://www.theafricareport.com/feed/',
            category: 'Business',
            source: 'The Africa Report'
        }
    ];

    // ================================
    // AGGREGATOR SOURCES
    // ================================
    const AGGREGATOR_SOURCES = [

        // UGANDA
        {
            url: 'https://watchdoguganda.com/feed/',
            category: 'Politics',
            source: 'Watchdog Uganda',
            aggregator: true
        },
        {
            url: 'https://scribe.co.ug/feed/',
            category: 'Politics',
            source: 'The Scribe Uganda',
            aggregator: true
        },
        {
            url: 'https://exclusive.co.ug/feed/',
            category: 'Business',
            source: 'Exclusive Uganda',
            aggregator: true
        },
        {
            url: 'https://allafrica.com/tools/headlines/rdf/uganda/headlines.rdf',
            category: 'Politics',
            source: 'AllAfrica Uganda',
            aggregator: true
        },

        // EAST AFRICA & AFRICA
        {
            url: 'https://www.africanews.com/feed/rss',
            category: 'Politics',
            source: 'Africa News',
            aggregator: true
        },
        {
            url: 'https://allafrica.com/tools/headlines/rdf/eastafrica/headlines.rdf',
            category: 'Politics',
            source: 'AllAfrica East Africa',
            aggregator: true
        },
        {
            url: 'https://allafrica.com/tools/headlines/rdf/health/headlines.rdf',
            category: 'Health',
            source: 'AllAfrica Health',
            aggregator: true
        },
        {
            url: 'https://allafrica.com/tools/headlines/rdf/sport/headlines.rdf',
            category: 'Sports',
            source: 'AllAfrica Sports',
            aggregator: true
        },
        {
            url: 'https://allafrica.com/tools/headlines/rdf/business/headlines.rdf',
            category: 'Business',
            source: 'AllAfrica Business',
            aggregator: true
        },
        {
            url: 'https://allafrica.com/tools/headlines/rdf/environment/headlines.rdf',
            category: 'Environment',
            source: 'AllAfrica Environment',
            aggregator: true
        },

        // INTERNATIONAL — BBC (most reliable)
        {
            url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml',
            category: 'Politics',
            source: 'BBC Africa',
            aggregator: true
        },
        {
            url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
            category: 'Politics',
            source: 'BBC World',
            aggregator: true
        },
        {
            url: 'https://feeds.bbci.co.uk/news/health/rss.xml',
            category: 'Health',
            source: 'BBC Health',
            aggregator: true
        },
        {
            url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
            category: 'Technology',
            source: 'BBC Technology',
            aggregator: true
        },
        {
            url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
            category: 'Business',
            source: 'BBC Business',
            aggregator: true
        },
        {
            url: 'https://feeds.bbci.co.uk/sport/rss.xml',
            category: 'Sports',
            source: 'BBC Sport',
            aggregator: true
        },
        {
            url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
            category: 'Environment',
            source: 'BBC Environment',
            aggregator: true
        },
        {
            url: 'https://feeds.bbci.co.uk/news/education/rss.xml',
            category: 'Education',
            source: 'BBC Education',
            aggregator: true
        },

        // AL JAZEERA
        {
            url: 'https://www.aljazeera.com/xml/rss/all.xml',
            category: 'Politics',
            source: 'Al Jazeera',
            aggregator: true
        }
    ];

    // ================================
    // CHECK IF ARTICLE EXISTS
    // ================================
    async function articleExists(title) {
        try {
            const snapshot = await db.collection('articles')
                .where('title', '==', title)
                .limit(1)
                .get();
            return !snapshot.empty;
        } catch (error) {
            return false;
        }
    }

    // ================================
    // FETCH FULL CONTENT
    // ================================
    async function fetchFullContent(url) {
        try {
            const response = await axios.get(url, {
                timeout: 12000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });

            const $ = cheerio.load(response.data);
            $('script, style, nav, header, footer, .ad, .advertisement, .social-share, .comments, .sidebar, .related').remove();

            let content = '';
            const contentSelectors = [
                'article .content', 'article .body', '.article-body',
                '.article-content', '.post-content', '.entry-content',
                '.content-body', 'article p', 'main p', '.story-body p'
            ];

            for (const selector of contentSelectors) {
                const el = $(selector);
                if (el.length > 0) {
                    content = el.text().trim();
                    if (content.length > 200) break;
                }
            }

            if (content.length < 200) {
                const paragraphs = [];
                $('p').each((i, el) => {
                    const text = $(el).text().trim();
                    if (text.length > 50) paragraphs.push(text);
                });
                content = paragraphs.join('\n\n');
            }

            let imageUrl = '';
            const ogImage = $('meta[property="og:image"]');
            if (ogImage.length > 0) imageUrl = ogImage.attr('content') || '';

            if (!imageUrl) {
                const twImage = $('meta[name="twitter:image"]');
                if (twImage.length > 0) imageUrl = twImage.attr('content') || '';
            }

            if (!imageUrl) {
                const imgSelectors = [
                    '.featured-image img', '.post-thumbnail img',
                    '.article-image img', '.hero-image img',
                    'article img', 'figure img',
                    'img[class*="featured"]', 'img[class*="hero"]'
                ];
                for (const selector of imgSelectors) {
                    const img = $(selector).first();
                    if (img.length > 0) {
                        const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
                        if (src && src.startsWith('http') &&
                            !src.includes('logo') && !src.includes('icon') &&
                            !src.includes('avatar') && !src.includes('placeholder')) {
                            imageUrl = src;
                            break;
                        }
                    }
                }
            }

            if (imageUrl && !imageUrl.startsWith('http')) imageUrl = '';

            return { content, imageUrl };
        } catch (error) {
            return { content: '', imageUrl: '' };
        }
    }

    // ================================
    // PUBLISH ARTICLE
    // ================================
    async function publishArticle(articleData) {
        try {
            await db.collection('articles').add({
                ...articleData,
                createdAt: new Date().toISOString(),
                date: new Date().toLocaleDateString('en-GB', {
                    weekday: 'long', year: 'numeric',
                    month: 'long', day: 'numeric'
                })
            });
            console.log(`✅ Published: ${articleData.title.substring(0, 60)}...`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to publish: ${error.message}`);
            return false;
        }
    }

    // ================================
    // PROCESS FULL SOURCE
    // ================================
    async function processFullSource(source) {
        try {
            console.log(`📰 Fetching from ${source.source}...`);
            const feed = await parser.parseURL(source.url);
            console.log(`   Found ${feed.items.length} items`);

            let published = 0;
            for (const item of feed.items.slice(0, 3)) {
                if (!item.title || !item.link) continue;

                const exists = await articleExists(item.title);
                if (exists) {
                    console.log(`   ⏭ Already exists: ${item.title.substring(0, 40)}`);
                    continue;
                }

                const { content, imageUrl } = await fetchFullContent(item.link);
                const body = content || item.contentEncoded || item.content ||
                             item.summary || item.description || '';

                if (body.length < 50) {
                    console.log(`   ⚠ Skipping - content too short`);
                    continue;
                }

                const standfirst = item.summary || item.description || body.substring(0, 200);
                const cleanStandfirst = standfirst.replace(/<[^>]*>/g, '').trim().substring(0, 300);
                const cleanBody = body.replace(/<[^>]*>/g, '').trim();

                await publishArticle({
                    title: item.title,
                    category: source.category,
                    author: source.source,
                    standfirst: cleanStandfirst,
                    body: cleanBody,
                    imageUrl: imageUrl || '',
                    sourceUrl: item.link,
                    sourceName: source.source,
                    aggregator: false
                });

                published++;
                await new Promise(r => setTimeout(r, 1000));
            }

            console.log(`   ✅ ${source.source}: ${published} new articles`);

        } catch (error) {
            console.error(`❌ Error processing ${source.source}: ${error.message}`);
        }
    }

    // ================================
    // PROCESS AGGREGATOR SOURCE
    // ================================
    async function processAggregatorSource(source) {
        try {
            console.log(`🔗 Aggregating from ${source.source}...`);
            const feed = await parser.parseURL(source.url);
            console.log(`   Found ${feed.items.length} items`);

            let published = 0;
            for (const item of feed.items.slice(0, 3)) {
                if (!item.title || !item.link) continue;

                const exists = await articleExists(item.title);
                if (exists) continue;

                const summary = item.summary || item.description || item.content || '';
                const cleanSummary = summary.replace(/<[^>]*>/g, '').trim();

                if (cleanSummary.length < 30) continue;

                let imageUrl = '';
                if (item.enclosure && item.enclosure.url) {
                    imageUrl = item.enclosure.url;
                }

                await publishArticle({
                    title: item.title,
                    category: source.category,
                    author: source.source,
                    standfirst: cleanSummary.substring(0, 300),
                    body: `${cleanSummary}\n\nThis article was originally published by ${source.source}. Read the full story at the original source.`,
                    imageUrl,
                    sourceUrl: item.link,
                    sourceName: source.source,
                    aggregator: true
                });

                published++;
                await new Promise(r => setTimeout(r, 500));
            }

            console.log(`   ✅ ${source.source}: ${published} new articles`);

        } catch (error) {
            console.error(`❌ Error aggregating ${source.source}: ${error.message}`);
        }
    }

    // ================================
    // RUN ALL SOURCES
    // ================================
    console.log('\n📰 Processing full article sources...');
    for (const source of FULL_SOURCES) {
        await processFullSource(source);
    }

    console.log('\n🔗 Processing aggregator sources...');
    for (const source of AGGREGATOR_SOURCES) {
        await processAggregatorSource(source);
    }

    console.log('\n✅ Auto-publisher completed successfully!');
}

main().catch(error => {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
});