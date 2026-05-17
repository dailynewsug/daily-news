// ================================
//   DAILY NEWS - AUTO PUBLISHER
//   Runs every hour via GitHub Actions
// ================================

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const Parser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio');

// ================================
// FIREBASE SETUP
// ================================
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();
const parser = new Parser();

// ================================
// NEWS SOURCES
// Full article sources (Creative Commons / Open License)
// ================================
const FULL_SOURCES = [

    // POLITICS
    {
        url: 'https://news.un.org/feed/subscribe/en/news/topic/international-peace-and-security/feed/rss.xml',
        category: 'Politics',
        source: 'UN News'
    },
    {
        url: 'https://www.africanunion.org/feed/',
        category: 'Politics',
        source: 'African Union'
    },
    {
        url: 'https://www.eac.int/feed',
        category: 'Politics',
        source: 'East African Community'
    },

    // BUSINESS
    {
        url: 'https://news.un.org/feed/subscribe/en/news/topic/economic-development/feed/rss.xml',
        category: 'Business',
        source: 'UN News'
    },
    {
        url: 'https://reliefweb.int/updates/rss.xml?primary_country=UGA&theme=EC',
        category: 'Business',
        source: 'ReliefWeb'
    },

    // HEALTH
    {
        url: 'https://www.who.int/rss-feeds/news-english.xml',
        category: 'Health',
        source: 'WHO'
    },
    {
        url: 'https://reliefweb.int/updates/rss.xml?primary_country=UGA&theme=HE',
        category: 'Health',
        source: 'ReliefWeb Uganda'
    },

    // ENVIRONMENT
    {
        url: 'https://news.un.org/feed/subscribe/en/news/topic/climate-change/feed/rss.xml',
        category: 'Environment',
        source: 'UN News'
    },
    {
        url: 'https://reliefweb.int/updates/rss.xml?primary_country=UGA&theme=EN',
        category: 'Environment',
        source: 'ReliefWeb Uganda'
    },

    // TECHNOLOGY
    {
        url: 'https://globalvoices.org/category/topics/technology/feed/',
        category: 'Technology',
        source: 'Global Voices'
    },
    {
        url: 'https://en.wikinews.org/w/index.php?title=Category:Technology&feed=atom',
        category: 'Technology',
        source: 'Wikinews'
    },

    // SPORTS
    {
        url: 'https://en.wikinews.org/w/index.php?title=Category:Sports&feed=atom',
        category: 'Sports',
        source: 'Wikinews'
    },
    {
        url: 'https://www.cafonline.com/rss',
        category: 'Sports',
        source: 'CAF Online'
    },

    // EDUCATION
    {
        url: 'https://theconversation.com/africa/education/articles.atom',
        category: 'Education',
        source: 'The Conversation Africa'
    },
    {
        url: 'https://reliefweb.int/updates/rss.xml?primary_country=UGA&theme=ED',
        category: 'Education',
        source: 'ReliefWeb Uganda'
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
    },

    // UGANDA SPECIFIC
    {
        url: 'https://www.urn.or.ug/feed/',
        category: 'Politics',
        source: 'Uganda Radio Network'
    },
    {
        url: 'https://reliefweb.int/updates/rss.xml?primary_country=UGA',
        category: 'Health',
        source: 'ReliefWeb Uganda'
    },

    // AFRICA WIDE
    {
        url: 'https://allafrica.com/tools/headlines/rdf/africa/headlines.rdf',
        category: 'Politics',
        source: 'AllAfrica'
    },
    {
        url: 'https://africacheck.org/feed/',
        category: 'Politics',
        source: 'Africa Check'
    }
];

// ================================
// AGGREGATOR SOURCES
// Headlines + summaries + link back
// ================================
const AGGREGATOR_SOURCES = [
    {
        url: 'https://www.monitor.co.ug/Uganda/rssfeeds',
        category: 'Politics',
        source: 'Daily Monitor',
        aggregator: true
    },
    {
        url: 'https://www.newvision.co.ug/rss',
        category: 'Politics',
        source: 'New Vision',
        aggregator: true
    },
    {
        url: 'https://nilepost.co.ug/feed/',
        category: 'Politics',
        source: 'Nile Post',
        aggregator: true
    },
    {
        url: 'https://www.theeastafrican.co.ke/tea/rss',
        category: 'Business',
        source: 'The East African',
        aggregator: true
    },
    {
        url: 'https://www.bbc.co.uk/africa/index.xml',
        category: 'Politics',
        source: 'BBC Africa',
        aggregator: true
    },
    {
        url: 'https://www.aljazeera.com/xml/rss/all.xml',
        category: 'Politics',
        source: 'Al Jazeera',
        aggregator: true
    }
];

// ================================
// CHECK IF ARTICLE ALREADY EXISTS
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
// FETCH FULL ARTICLE CONTENT
// ================================
async function fetchFullContent(url) {
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; DailyNewsBot/1.0)'
            }
        });

        const $ = cheerio.load(response.data);

        // Remove unwanted elements
        $('script, style, nav, header, footer, .ad, .advertisement, .social-share, .comments').remove();

        // Try to find main article content
        let content = '';
        const selectors = [
            'article',
            '.article-body',
            '.article-content',
            '.post-content',
            '.entry-content',
            '.content-body',
            'main p'
        ];

        for (const selector of selectors) {
            const el = $(selector);
            if (el.length > 0) {
                content = el.text().trim();
                if (content.length > 200) break;
            }
        }

        // Find main image
        let imageUrl = '';
        const imgSelectors = [
            'article img',
            '.featured-image img',
            '.article-image img',
            'meta[property="og:image"]'
        ];

        for (const selector of imgSelectors) {
            const el = $(selector);
            if (el.length > 0) {
                imageUrl = el.attr('src') || el.attr('content') || '';
                if (imageUrl && imageUrl.startsWith('http')) break;
            }
        }

        return { content, imageUrl };

    } catch (error) {
        return { content: '', imageUrl: '' };
    }
}

// ================================
// PUBLISH ARTICLE TO FIREBASE
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
        console.log(`✅ Published: ${articleData.title}`);
    } catch (error) {
        console.error(`❌ Failed to publish: ${articleData.title}`, error.message);
    }
}

// ================================
// PROCESS FULL ARTICLE SOURCE
// ================================
async function processFullSource(source) {
    try {
        console.log(`📰 Fetching from ${source.source}...`);
        const feed = await parser.parseURL(source.url);

        let published = 0;

        for (const item of feed.items.slice(0, 5)) {
            if (!item.title || !item.link) continue;

            // Skip if already exists
            const exists = await articleExists(item.title);
            if (exists) continue;

            // Get full content
            const { content, imageUrl } = await fetchFullContent(item.link);

            const body = content ||
                item.contentEncoded ||
                item.content ||
                item.summary ||
                item.description ||
                '';

            if (body.length < 100) continue;

            await publishArticle({
                title: item.title,
                category: source.category,
                author: source.source,
                standfirst: item.summary || item.description || body.substring(0, 200),
                body: body,
                imageUrl: imageUrl || '',
                sourceUrl: item.link,
                sourceName: source.source,
                aggregator: false
            });

            published++;

            // Small delay between requests
            await new Promise(r => setTimeout(r, 1000));
        }

        console.log(`✅ ${source.source}: ${published} new articles published`);

    } catch (error) {
        console.error(`❌ Error processing ${source.source}:`, error.message);
    }
}

// ================================
// PROCESS AGGREGATOR SOURCE
// ================================
async function processAggregatorSource(source) {
    try {
        console.log(`🔗 Aggregating from ${source.source}...`);
        const feed = await parser.parseURL(source.url);

        let published = 0;

        for (const item of feed.items.slice(0, 5)) {
            if (!item.title || !item.link) continue;

            const exists = await articleExists(item.title);
            if (exists) continue;

            const summary = item.summary || item.description || item.content || '';
            const cleanSummary = summary.replace(/<[^>]*>/g, '').trim();

            if (cleanSummary.length < 50) continue;

            await publishArticle({
                title: item.title,
                category: source.category,
                author: source.source,
                standfirst: cleanSummary.substring(0, 300),
                body: `${cleanSummary}\n\nThis article was originally published by ${source.source}. Click the button below to read the full story.`,
                imageUrl: '',
                sourceUrl: item.link,
                sourceName: source.source,
                aggregator: true
            });

            published++;
            await new Promise(r => setTimeout(r, 500));
        }

        console.log(`✅ ${source.source}: ${published} new articles aggregated`);

    } catch (error) {
        console.error(`❌ Error aggregating ${source.source}:`, error.message);
    }
}

// ================================
// MAIN FUNCTION
// ================================
async function main() {
    console.log('🚀 Daily News Auto-Publisher starting...');
    console.log(`⏰ ${new Date().toISOString()}`);

    // Process full article sources
    console.log('\n📰 Processing full article sources...');
    for (const source of FULL_SOURCES) {
        await processFullSource(source);
    }

    // Process aggregator sources
    console.log('\n🔗 Processing aggregator sources...');
    for (const source of AGGREGATOR_SOURCES) {
        await processAggregatorSource(source);
    }

    console.log('\n✅ Auto-publisher completed successfully!');
}

main().catch(console.error);