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
        console.error('❌ FIREBASE_SERVICE_ACCOUNT environment variable not found!');
        process.exit(1);
    }

    let serviceAccount;
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log('✅ Firebase credentials loaded successfully');
    } catch (error) {
        console.error('❌ Failed to parse Firebase credentials:', error.message);
        process.exit(1);
    }

    try {
        initializeApp({ credential: cert(serviceAccount) });
        console.log('✅ Firebase initialized successfully');
    } catch (error) {
        console.error('❌ Firebase initialization failed:', error.message);
        process.exit(1);
    }

    const db = getFirestore();
    const parser = new Parser({
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DailyNewsBot/1.0)' }
    });

    // ================================
    // FULL ARTICLE SOURCES
    // (Creative Commons / Open License)
    // ================================
    const FULL_SOURCES = [

        // POLITICS
        {
            url: 'https://news.un.org/feed/subscribe/en/news/topic/international-peace-and-security/feed/rss.xml',
            category: 'Politics',
            source: 'UN News'
        },
        {
            url: 'https://news.un.org/feed/subscribe/en/news/region/africa/feed/rss.xml',
            category: 'Politics',
            source: 'UN News Africa'
        },
        {
            url: 'https://ugandaradionetwork.net/feed/',
            category: 'Politics',
            source: 'Uganda Radio Network'
        },
        {
            url: 'https://reliefweb.int/country/uga/rss.xml',
            category: 'Politics',
            source: 'ReliefWeb Uganda'
        },

        // BUSINESS
        {
            url: 'https://news.un.org/feed/subscribe/en/news/topic/economic-development/feed/rss.xml',
            category: 'Business',
            source: 'UN News Business'
        },
        {
            url: 'https://reliefweb.int/updates/rss.xml?theme=EC&region=267',
            category: 'Business',
            source: 'ReliefWeb East Africa'
        },

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
        {
            url: 'https://reliefweb.int/updates/rss.xml?theme=HE&primary_country=UGA',
            category: 'Health',
            source: 'ReliefWeb Uganda Health'
        },

        // ENVIRONMENT
        {
            url: 'https://news.un.org/feed/subscribe/en/news/topic/climate-change/feed/rss.xml',
            category: 'Environment',
            source: 'UN News Climate'
        },
        {
            url: 'https://reliefweb.int/updates/rss.xml?theme=EN&region=267',
            category: 'Environment',
            source: 'ReliefWeb East Africa Environment'
        },

        // TECHNOLOGY
        {
            url: 'https://globalvoices.org/category/topics/technology/feed/',
            category: 'Technology',
            source: 'Global Voices Technology'
        },
        {
            url: 'https://globalvoices.org/category/regions/sub-saharan-africa/feed/',
            category: 'Technology',
            source: 'Global Voices Africa'
        },

        // SPORTS
        {
            url: 'https://en.wikinews.org/w/index.php?title=Category:Sports&feed=atom',
            category: 'Sports',
            source: 'Wikinews Sports'
        },
        {
            url: 'https://www.cafonline.com/rss/news',
            category: 'Sports',
            source: 'CAF Online'
        },
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
        {
            url: 'https://reliefweb.int/updates/rss.xml?theme=ED&primary_country=UGA',
            category: 'Education',
            source: 'ReliefWeb Uganda Education'
        },

        // OPINION
        {
            url: 'https://globalvoices.org/feed/',
            category: 'Opinion',
            source: 'Global Voices'
        },
        {
            url: 'https://theconversation.com/africa/articles.atom',
            category: 'Opinion',
            source: 'The Conversation Africa'
        }
    ];

    // ================================
    // AGGREGATOR SOURCES
    // (Headlines + summaries + source link)
    // ================================
    const AGGREGATOR_SOURCES = [

        // UGANDA
        {
            url: 'https://chimpreports.com/feed/',
            category: 'Politics',
            source: 'Chimp Reports',
            aggregator: true
        },
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
            url: 'https://www.aljazeera.com/xml/rss/all.xml',
            category: 'Politics',
            source: 'Al Jazeera',
            aggregator: true
        },
        {
            url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml',
            category: 'Politics',
            source: 'BBC Africa',
            aggregator: true
        },
        {
            url: 'https://www.theeastafrican.co.ke/rss/1000',
            category: 'Business',
            source: 'The East African',
            aggregator: true
        },
        {
            url: 'https://www.africanews.com/feed/rss',
            category: 'Politics',
            source: 'Africa News',
            aggregator: true
        },
        {
            url: 'https://allafrica.com/tools/headlines/rdf/africa/headlines.rdf',
            category: 'Politics',
            source: 'AllAfrica',
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
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DailyNewsBot/1.0)' }
            });

            const $ = cheerio.load(response.data);
            $('script, style, nav, header, footer, .ad, .advertisement, .social-share, .comments, .sidebar').remove();

            let content = '';
            const contentSelectors = [
                'article .content',
                'article .body',
                '.article-body',
                '.article-content',
                '.post-content',
                '.entry-content',
                '.content-body',
                'article p',
                'main p'
            ];

            for (const selector of contentSelectors) {
                const el = $(selector);
                if (el.length > 0) {
                    content = el.text().trim();
                    if (content.length > 200) break;
                }
            }

            // Fallback — get all paragraphs
            if (content.length < 200) {
                const paragraphs = [];
                $('p').each((i, el) => {
                    const text = $(el).text().trim();
                    if (text.length > 50) paragraphs.push(text);
                });
                content = paragraphs.join('\n\n');
            }

            // ================================
            // IMPROVED IMAGE FINDING
            // ================================
            let imageUrl = '';

            // Try og:image first (most reliable)
            const ogImage = $('meta[property="og:image"]');
            if (ogImage.length > 0) {
                imageUrl = ogImage.attr('content') || '';
            }

            // Try twitter:image
            if (!imageUrl) {
                const twImage = $('meta[name="twitter:image"]');
                if (twImage.length > 0) {
                    imageUrl = twImage.attr('content') || '';
                }
            }

            // Try featured image selectors
            if (!imageUrl) {
                const imgSelectors = [
                    '.featured-image img',
                    '.post-thumbnail img',
                    '.article-image img',
                    '.hero-image img',
                    'article img',
                    '.entry-content img',
                    'figure img',
                    'img[class*="featured"]',
                    'img[class*="hero"]',
                    'img[class*="main"]'
                ];

                for (const selector of imgSelectors) {
                    const img = $(selector).first();
                    if (img.length > 0) {
                        const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
                        if (src && src.startsWith('http') &&
                            !src.includes('logo') &&
                            !src.includes('icon') &&
                            !src.includes('avatar')) {
                            imageUrl = src;
                            break;
                        }
                    }
                }
            }

            // Make sure imageUrl is absolute
            if (imageUrl && !imageUrl.startsWith('http')) {
                imageUrl = '';
            }

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
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
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
                const body = content ||
                    item.contentEncoded ||
                    item.content ||
                    item.summary ||
                    item.description || '';

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

            console.log(`   ✅ ${source.source}: ${published} new articles published`);

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

                await publishArticle({
                    title: item.title,
                    category: source.category,
                    author: source.source,
                    standfirst: cleanSummary.substring(0, 300),
                    body: `${cleanSummary}\n\nThis article was originally published by ${source.source}. Read the full story at the original source.`,
                    imageUrl: '',
                    sourceUrl: item.link,
                    sourceName: source.source,
                    aggregator: true
                });

                published++;
                await new Promise(r => setTimeout(r, 500));
            }

            console.log(`   ✅ ${source.source}: ${published} new articles aggregated`);

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